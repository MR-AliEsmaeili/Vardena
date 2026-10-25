import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  type DatabaseTransaction,
} from '../../../kernel/prisma/prisma.service.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import {
  assertValidCustomerName,
  assertValidCustomerRecord,
  LicenseCustomerError,
  type LicenseCustomer,
} from '../domain/customer.js';
import type {
  EntitlementKind,
  LicenseEntitlement,
  LicenseLimit,
  LicenseStatus,
  PersistedLicenseType,
} from '../domain/license.js';
import {
  evaluateImportConflicts,
  lapsedLicenseContext,
  reductionConflicts,
  resolveEffectiveVersion,
  supersessionCeaseInstant,
  type CustomerTransferIntent,
  type GapRecoveryIntent,
  type ImportConflict,
  type ImportConflictReason,
  type ImportSupersessionIntent,
  type LicenseUsageSnapshot,
  type LicenseVersionSource,
  type ReductionConflict,
  type ReductionResolutionIntent,
  type RetainedLicenseVersion,
} from '../domain/license-version.js';
import { licenseAllocationLockKey } from '../domain/license-allocation-lock.js';

/**
 * Data access for `licensing.licenses`, `licensing.license_versions`,
 * `licensing.license_version_entitlements` and `licensing.license_audit_events`
 * (AR-07: the Licensing module owns these tables and no other module reads
 * them).
 *
 * Three guarantees live here, not in the application layer:
 *
 * - **One transaction per import.** The commercial customer, the license
 *   identity, the supersession stamp, the version, its entitlements and the
 *   `applied` audit event are written together or not at all, so a failed
 *   import can neither deactivate a valid installation nor leave a half-applied
 *   version behind.
 * - **One importer per installation at a time.** The transaction takes a
 *   `FOR UPDATE` row lock on the installation BEFORE it reads the retained
 *   versions, and re-evaluates the version invariant inside the lock
 *   (`evaluateImportConflicts` — the same pure authority the read-side
 *   pre-check uses). A concurrent import of the same installation therefore
 *   blocks until the winner commits and then evaluates against the winner's
 *   committed rows, so two incompatible version windows can never both commit.
 *   The lock is a database row lock, not a process mutex: the API and any
 *   worker process share it (design §3.4, ADR-0046 Decision 9).
 * - **The replay guards are database constraints.** A version is unique by
 *   `(installation_id, operation_id)` and by `(installation_id,
 *   document_hash)`, and the supersession stamp is a guarded update
 *   (`WHERE superseded_at IS NULL`). Those indexes and guards back the lock up
 *   as defence in depth; they are not what makes the check race-safe.
 *
 * `PRISMA CANNOT EXPRESS SELECT … FOR UPDATE`, hence the one parameterized raw
 * statement below — the same documented exemption the Accounting modules carry
 * (AR-11, `docs/modules.md`). The transaction runs in READ COMMITTED (the
 * PostgreSQL default, requested explicitly below): every statement takes a
 * fresh snapshot, so the checks that run after the lock is granted see exactly
 * the winner's committed rows. Under REPEATABLE READ the snapshot would
 * predate the wait and the re-check would be stale.
 *
 * What is NOT stored: the submitted document, its signature, or any key
 * material. Only the SHA-256 `document_hash` is kept; it is irreversible and is
 * all that duplicate detection and audit need.
 */

/**
 * A stored revocation, as the customer installation retains it (protocol §8).
 * Typed, append-only, and never derived from a client-supplied field: every
 * value here came from verified signed bytes or from the import transaction.
 */
export interface LicenseRevocationRecord {
  revocationId: string;
  licenseId: string;
  installationId: string;
  customerId: string;
  customerCode: string;
  targetOperationId: string;
  reason: string;
  reasonDetail: string | null;
  issuerKeyId: string;
  issuedAt: Date;
  importedAt: Date;
  importedBy: string | null;
  /** SHA-256 of the exact armored artifact received. */
  artifactSha256: string;
  /** SHA-256 of the canonical signed payload bytes. */
  canonicalPayloadSha256: string;
}

/** Everything the revocation transaction writes, all of it verified upstream. */
export type ApplyRevocationCommand = Omit<
  LicenseRevocationRecord,
  'importedAt' | 'importedBy'
> & {
  now: Date;
  actorId: string | null;
  source: string;
  /** The retained version row id the audit event names (not signed). */
  targetVersionId: string | null;
  /** Bounded, secret-free audit detail (the stable reason + target facts). */
  detail: string;
};

export type RevocationConflictReason =
  'conflicting-replay' | 'already-revoked' | 'unknown-target';

/**
 * A verified revocation that could not be applied because of retained state.
 * Mirrors `ImportConflictError`: the application layer maps each reason to its
 * documented HTTP answer and message, and the transaction is rolled back.
 */
export class RevocationConflictError extends Error {
  constructor(
    readonly reason: RevocationConflictReason,
    readonly existing?: { revocationId: string; revokedAt: string },
  ) {
    super(revocationConflictMessage(reason));
    this.name = 'RevocationConflictError';
  }
}

function revocationConflictMessage(reason: RevocationConflictReason): string {
  switch (reason) {
    case 'conflicting-replay':
      return 'The same revocation identity was already imported with different signed bytes.';
    case 'already-revoked':
      return 'This license is already revoked; the original revocation is retained.';
    case 'unknown-target':
      return 'The revocation target is not a license of this installation and customer.';
  }
}

export interface ImportLicenseVersionCommand {
  installationId: string;
  /** The acting user, for the audit trail. */
  actorId: string | null;
  now: Date;
  licenseId: string;
  /** Omitted by pre-type callers and fixtures; defaults to COMMERCIAL. */
  licenseType?: PersistedLicenseType;
  customerId: string | null;
  customerCode: string | null;
  customerName: string | null;
  developerId?: string | null;
  developerName?: string | null;
  /** Locally generated version identity (ULID). */
  versionId: string;
  operationId: string;
  status: LicenseStatus;
  provider: string;
  documentVersion: number;
  documentHash: string;
  keyId: string | null;
  source: LicenseVersionSource;
  validFrom: Date;
  /**
   * The signed `issuedAt` of the artifact, retained as a typed fact so a later
   * revocation can be refused when it predates the version it targets
   * (`stale-revocation`, OD-LIC-17). Null only for legacy text codes, which
   * carry no signed issuance instant.
   */
  signedIssuedAt: Date | null;
  /**
   * The instant this version starts governing when it differs from the signed
   * `validFrom` (a renewal's renewed-term boundary). Null on every ordinary
   * import. Written as `governs_from` and used as the predecessor's
   * `governs_until`, so the stamp and the new row cannot disagree
   * (OD-LIC-06 §4.2/§4.3).
   */
  governsFrom: Date | null;
  validUntil: Date | null;
  organizationLimit: LicenseLimit;
  userLimit: LicenseLimit;
  deviceLimit: LicenseLimit;
  deviceLimitSpecified: boolean;
  entitlements: readonly LicenseEntitlement[];
  /**
   * How the artifact declares its relation to the version it replaces: nothing
   * (a signed document), an explicit signed supersession, or the implicit
   * replacement a legacy `VLIC1` text code performs (domain
   * `ImportSupersessionIntent`). A signed document with `none` that starts
   * later than the version it overlaps takes it over under OQ-80 Option B; the
   * hand-over is stamped and audited exactly like an explicit one.
   */
  supersession: ImportSupersessionIntent;
  /**
   * The explicit, authorized customer-transfer intent (Owner decision
   * 2026-10-12, Q4). Null on every other path — and with it null, an import
   * whose customer differs from the installation's current binding is refused
   * (`installation-customer-mismatch`), so an import can never transfer.
   */
  customerTransfer: CustomerTransferIntent | null;
  /**
   * The dedicated post-gap recovery intent (Owner decision 2026-10-12,
   * OQ-87 Option B, PDR-13). Null on every other path — and with it null, a
   * new-identity candidate that would start after the retained coverage end
   * is refused (`post-gap-recovery-requires-dedicated-operation`), so an
   * ordinary import can never recover a lapse.
   */
  gapRecovery: GapRecoveryIntent | null;
  /**
   * The explicit reduction-resolution intent (PDR-11 §8.6, L-04). Null on
   * every other path — and with it null, a reduction that conflicts with
   * current usage or the retained grant is refused with its concrete
   * conflicts, so an ordinary import can never resolve one silently.
   */
  reductionResolution: ReductionResolutionIntent | null;
  /**
   * Reads current organization/user usage INSIDE the import transaction,
   * after the licensed-allocation advisory locks are taken, so the §8.6
   * conflict check cannot be raced by a concurrent creation. The counts come
   * from the modules that own the records (application contracts only); a
   * null count fails closed (`usage-unavailable`).
   */
  readUsage?: (() => Promise<LicenseUsageSnapshot>) | null;
  /**
   * The version the application layer resolved as the supersession target; the
   * pre-built `license.version.superseded` audit event names it. The
   * transaction must retire EXACTLY this version or refuse the import, so the
   * audit row can never name a version the transaction did not actually
   * retire.
   */
  expectedSupersessionVersionId: string | null;
  /**
   * Audit rows written INSIDE the same transaction, so an applied change and
   * its evidence are committed together (AR-23).
   */
  auditEvents: readonly LicenseAuditEventCommand[];
}

export interface LicenseAuditEventCommand {
  installationId: string;
  eventType: string;
  outcome: 'APPLIED' | 'REJECTED' | 'UNCHANGED';
  operationId: string | null;
  licenseId: string | null;
  versionId: string | null;
  /** Device subject for device lifecycle events; null for license-only events. */
  deviceId?: string | null;
  /** Replacement request subject for replacement lifecycle events. */
  replacementRequestId?: string | null;
  actorId: string | null;
  source: string;
  documentHash: string | null;
  reason: string | null;
  detail: string | null;
  /**
   * The customer the installation was bound to BEFORE an explicit transfer.
   * Set only on `license.installation.customer-transferred` events (Owner
   * decision 2026-10-12, Q4); null everywhere else.
   */
  previousCustomerId?: string | null;
  /** The business customer code BEFORE that transfer (L-06, PDR-14). */
  previousCustomerCode?: string | null;
  /** The customer it is bound to AFTER that transfer. */
  newCustomerId?: string | null;
  /** The business customer code AFTER that transfer (L-06, PDR-14). */
  newCustomerCode?: string | null;
  /**
   * The license whose retained coverage had ended before a dedicated
   * post-gap recovery (Owner decision 2026-10-12, OQ-87). Set only on
   * `license.import.recovered` events; null everywhere else.
   */
  previousLicenseId?: string | null;
  /** The version a renewal extended; set only on `license.import.renewed`. */
  renewedVersionId?: string | null;
  /** The instant a renewal starts governing (the renewed version's end). */
  renewedFrom?: Date | null;
  /** The Owner-signed new end date a renewal applies. */
  renewedUntil?: Date | null;
  /** The signed revocation identity on revocation events (OD-LIC-17). */
  revocationId?: string | null;
  occurredAt: Date;
}

/**
 * The version invariant refused this import inside the transaction (a
 * concurrent import won the race, or the retained state changed under it). The
 * service turns the reason into the documented 409 answer — never a silent
 * skip and never a 500. The transaction has already rolled back when this is
 * thrown: no version, no entitlement, no supersession stamp, no applied audit
 * event survive.
 */
export class ImportConflictError extends Error {
  constructor(readonly conflict: ImportConflict) {
    super(conflictErrorDefaultMessage(conflict.reason));
    this.name = 'ImportConflictError';
  }

  get reason(): ImportConflictReason {
    return this.conflict.reason;
  }
}

/**
 * The default message of a conflict the repository discovered. The API's own
 * wording per reason lives in the application layer; this one is only what an
 * `ImportConflictError` carries when it escapes (it does not in practice — the
 * service maps every reason to its documented message).
 */
function conflictErrorDefaultMessage(reason: ImportConflictReason): string {
  switch (reason) {
    case 'duplicate-operation':
      return 'This license version has already been imported.';
    case 'unknown-supersession':
      return 'The version named by this document is no longer eligible for supersession.';
    case 'license-binding-conflict':
      return 'This license identifier is already bound to a different holder or installation.';
    case 'license-type-conflict':
      return 'Commercial and developer license history cannot be mixed on one installation.';
    case 'customer-code-mismatch':
      return 'This license document carries a customer code that does not match the customer record.';
    case 'installation-customer-mismatch':
      return 'This license document belongs to a different customer than the installation is bound to.';
    case 'transfer-requires-different-customer':
      return 'The installation is already bound to the customer this transfer names.';
    case 'renewal-gap':
      return 'This renewal would leave a gap in the license coverage.';
    case 'renewal-target-unknown':
      return 'The license version this renewal names is not an eligible retained version of this installation.';
    case 'renewal-target-not-current':
      return "The license version this renewal names is not the last version of the installation's coverage chain.";
    case 'renewal-target-perpetual':
      return 'The license version this renewal names never ends, so there is no term boundary to renew.';
    case 'renewal-not-an-extension':
      return 'This renewal ends at or before the end of the version it renews, so it does not extend the license.';
    case 'reduction-requires-resolution':
      return 'This version reduces the entitlement or capacity it would take over, which requires an explicit resolution.';
    case 'post-gap-recovery-requires-dedicated-operation':
      return 'This license document would cover a lapse with a new license identity, which is allowed only through the dedicated recovery operation.';
    case 'recovery-not-applicable':
      return 'The license coverage of this installation has not lapsed, so there is nothing to recover.';
    case 'resolution-not-applicable':
      return 'This document does not conflict with current usage or the retained grant, so there is no reduction to resolve.';
    case 'backdated-supersession':
      return 'This license version would retire a version from an instant that is already in the past.';
    case 'overlapping-range':
      return 'This license version overlaps a retained version.';
    case 'license-revoked':
      return 'This license has been revoked by a signed revocation artifact.';
  }
}

export interface LicenseAuditEventRow extends LicenseAuditEventCommand {
  id: string;
}

/**
 * What ONE import transaction committed: the retained version it created, and
 * the installation's commercial customer before it ran. Both come from the
 * same transaction, so a receipt built from them can never disagree with the
 * audit trail (a concurrent transfer cannot make the reported "from" value
 * stale). A dedicated operation's receipt additionally carries the facts its
 * audit event recorded — the lapsed license for a recovery, the resolved
 * conflicts for a reduction resolution — read from the same transaction.
 */
export interface ImportVersionResult {
  version: RetainedLicenseVersion;
  /** The installation's customer before this import (null = was unbound). */
  previousCustomerId: string | null;
  /** The installation's customer code before this import (null = was unbound). */
  previousCustomerCode: string | null;
  /** True when this import changed the installation's customer binding. */
  bindingChanged: boolean;
  /**
   * The license that governed this installation immediately before an explicit
   * customer transfer took effect (L-06, PDR-14 §3.5.4) — the retained version
   * this document retired or took over, read under the installation lock. Null
   * on a non-transfer import, and null on a transfer whose installation had no
   * governing license at that instant.
   */
  previousLicenseId: string | null;
  /** Set only when this transaction WAS the dedicated gap recovery. */
  recovery: {
    /** The license whose retained coverage had ended (the lapse). */
    lapsedLicenseId: string | null;
    /** When that coverage ended; recovery starts strictly after it. */
    coverageEnd: Date | null;
  } | null;
  /** Set only when this transaction WAS a reduction resolution (L-04). */
  resolution: {
    /** The version whose grant was reduced with explicit authorization. */
    predecessorVersionId: string;
    /** The conflicts the resolution authorized, as audited. */
    conflicts: ReductionConflict[];
  } | null;
}

interface VersionRow {
  id: string;
  licenseId: string;
  installationId: string;
  operationId: string;
  status: LicenseStatus;
  provider: string;
  documentVersion: number;
  documentHash: string;
  keyId: string | null;
  validFrom: Date;
  governsFrom?: Date | null;
  validUntil: Date | null;
  organizationLimit: number | null;
  userLimit: number | null;
  deviceLimit: number | null;
  deviceLimitSpecified: boolean;
  supersededAt: Date | null;
  governsUntil: Date | null;
  supersededByVersionId: string | null;
  supersedesVersionId: string | null;
  importedAt: Date;
  source: string;
  entitlements: Array<{ kind: EntitlementKind; code: string }>;
  license: {
    licenseType: PersistedLicenseType;
    customerId: string | null;
    customer?: { customerCode: string } | null;
    developerId: string | null;
    developerName: string | null;
  };
}

interface VersionDelegate {
  findMany(args: {
    where: { installationId: string };
    include: {
      entitlements: { select: { kind: true; code: true } };
      license: {
        select: {
          licenseType: true;
          customerId: true;
          customer: { select: { customerCode: true } };
          developerId: true;
          developerName: true;
        };
      };
    };
  }): Promise<VersionRow[]>;
  findFirst(args: {
    where: {
      installationId: string;
      operationId?: string;
      documentHash?: string;
    };
    include: {
      entitlements: { select: { kind: true; code: true } };
      license: {
        select: {
          licenseType: true;
          customerId: true;
          customer: { select: { customerCode: true } };
          developerId: true;
          developerName: true;
        };
      };
    };
  }): Promise<VersionRow | null>;
  updateMany(args: {
    where: {
      id: string;
      installationId: string;
      supersededAt: null;
    };
    data: {
      supersededAt: Date;
      governsUntil: Date;
      supersededByVersionId: string;
      updatedAt: Date;
    };
  }): Promise<{ count: number }>;
  create(args: {
    data: {
      id: string;
      licenseId: string;
      installationId: string;
      operationId: string;
      status: LicenseStatus;
      provider: string;
      documentVersion: number;
      documentHash: string;
      keyId: string | null;
      source: string;
      validFrom: Date;
      signedIssuedAt: Date | null;
      governsFrom: Date | null;
      validUntil: Date | null;
      organizationLimit: number | null;
      userLimit: number | null;
      deviceLimit: number | null;
      deviceLimitSpecified: boolean;
      importedAt: Date;
      importedBy: string | null;
      supersedesVersionId: string | null;
      createdAt: Date;
      updatedAt: Date;
      entitlements: {
        create: Array<{
          id: string;
          kind: EntitlementKind;
          code: string;
          createdAt: Date;
          updatedAt: Date;
        }>;
      };
    };
    include: {
      entitlements: { select: { kind: true; code: true } };
      license: {
        select: {
          licenseType: true;
          customerId: true;
          customer: { select: { customerCode: true } };
          developerId: true;
          developerName: true;
        };
      };
    };
  }): Promise<VersionRow>;
}

interface CustomerRow {
  id: string;
  customerCode: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

interface CustomerDelegate {
  findUnique(args: {
    where: { id?: string; customerCode?: string };
  }): Promise<CustomerRow | null>;
  create(args: {
    data: {
      id: string;
      customerCode: string;
      displayName: string;
      createdAt: Date;
      updatedAt: Date;
      createdBy?: string | null;
      updatedBy?: string | null;
    };
  }): Promise<CustomerRow>;
  update(args: {
    where: { id: string };
    data: {
      displayName: string;
      updatedAt: Date;
      updatedBy?: string | null;
    };
  }): Promise<CustomerRow>;
}

interface LicenseDelegate {
  /** Binding + license-level revocation state projection. */
  findUnique(args: {
    where: { id: string };
    select: {
      installationId: true;
      licenseType: true;
      customerId: true;
      developerId: true;
      revokedAt: true;
    };
  }): Promise<{
    installationId: string;
    licenseType: PersistedLicenseType;
    customerId: string | null;
    developerId: string | null;
    revokedAt: Date | null;
  } | null>;
  /**
   * The revocation target projection: the license row (all scalars, including
   * `revoked_at`/`revocation_id`) plus the retained versions that can prove the
   * signed `targetOperationId` and supply the version's signed issuance instant
   * for the staleness rule. Uses `include` (not `select`) so it is a real
   * Prisma call, not an invented delegate method.
   */
  findUnique(args: {
    where: { id: string };
    include: {
      versions: {
        select: { id: true; operationId: true; signedIssuedAt: true };
      };
    };
  }): Promise<LicenseTargetRow | null>;
  create(args: {
    data: {
      id: string;
      installationId: string;
      licenseType: PersistedLicenseType;
      customerId: string | null;
      developerId: string | null;
      developerName: string | null;
      createdAt: Date;
      updatedAt: Date;
    };
  }): Promise<unknown>;
  updateMany(args: {
    where: {
      id: string;
      installationId?: string;
      licenseType?: PersistedLicenseType;
      customerId?: string | null;
      developerId?: string | null;
      /** Guarded revocation stamp: an already-revoked row is never rewritten. */
      revokedAt?: null;
    };
    data: {
      updatedAt: Date;
      revokedAt?: Date;
      revocationId?: string;
    };
  }): Promise<{ count: number }>;
  upsert(args: {
    where: { id: string };
    create: {
      id: string;
      installationId: string;
      customerId: string;
      createdAt: Date;
      updatedAt: Date;
    };
    update: { customerId: string; updatedAt: Date };
  }): Promise<unknown>;
}

interface LicenseTargetRow {
  id: string;
  installationId: string;
  licenseType: PersistedLicenseType;
  customerId: string | null;
  developerId: string | null;
  developerName: string | null;
  revokedAt: Date | null;
  revocationId: string | null;
  versions: Array<{
    id: string;
    operationId: string;
    signedIssuedAt: Date | null;
  }>;
}

interface LicenseRevocationRow {
  revocationId: string;
  licenseId: string;
  installationId: string;
  customerId: string;
  customerCode: string;
  targetOperationId: string;
  reason: string;
  reasonDetail: string | null;
  issuerKeyId: string;
  issuedAt: Date;
  importedAt: Date;
  importedBy: string | null;
  artifactSha256: string;
  canonicalPayloadSha256: string;
}

interface LicenseRevocationDelegate {
  findUnique(args: {
    where: { revocationId: string } | { licenseId: string };
  }): Promise<LicenseRevocationRow | null>;
  create(args: {
    data: LicenseRevocationRow & {
      createdAt: Date;
      updatedAt: Date;
      createdBy?: string | null;
      updatedBy?: string | null;
    };
  }): Promise<LicenseRevocationRow>;
}

interface InstallationDelegate {
  update(args: {
    where: { id: string };
    data: { customerId: string; updatedAt: Date };
  }): Promise<unknown>;
}

interface AuditDelegate {
  create(args: {
    data: {
      id: string;
      installationId: string;
      eventType: string;
      outcome: string;
      operationId: string | null;
      licenseId: string | null;
      versionId: string | null;
      deviceId: string | null;
      replacementRequestId: string | null;
      actorId: string | null;
      source: string;
      documentHash: string | null;
      reason: string | null;
      detail: string | null;
      previousCustomerId: string | null;
      previousCustomerCode: string | null;
      newCustomerId: string | null;
      newCustomerCode: string | null;
      previousLicenseId: string | null;
      renewedVersionId: string | null;
      renewedFrom: Date | null;
      renewedUntil: Date | null;
      /** OD-LIC-17: the signed revocation an applied/rejected event belongs to. */
      revocationId?: string | null;
      occurredAt: Date;
      createdAt: Date;
      updatedAt: Date;
    };
  }): Promise<unknown>;
  findMany(args: {
    where: { installationId: string };
    orderBy: { occurredAt: 'asc' | 'desc' };
    take?: number;
  }): Promise<
    Array<{
      id: string;
      installationId: string;
      eventType: string;
      outcome: string;
      operationId: string | null;
      licenseId: string | null;
      versionId: string | null;
      deviceId: string | null;
      replacementRequestId: string | null;
      actorId: string | null;
      source: string;
      documentHash: string | null;
      reason: string | null;
      detail: string | null;
      previousCustomerId: string | null;
      previousCustomerCode: string | null;
      newCustomerId: string | null;
      newCustomerCode: string | null;
      previousLicenseId: string | null;
      renewedVersionId: string | null;
      renewedFrom: Date | null;
      renewedUntil: Date | null;
      revocationId: string | null;
      occurredAt: Date;
    }>
  >;
}

/**
 * The raw statement interface, as the Accounting locking helpers declare it:
 * Prisma's typed delegates cannot express `SELECT … FOR UPDATE`.
 */
type RawQuery = <T>(
  query: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>;

export interface LicensesTxClient {
  licenseVersion: VersionDelegate;
  licenseCustomer: CustomerDelegate;
  license: LicenseDelegate;
  installation: InstallationDelegate;
  licenseAuditEvent: AuditDelegate;
  licenseRevocation: LicenseRevocationDelegate;
  $queryRaw: RawQuery;
}

type Client = LicensesTxClient & {
  $transaction<T>(
    fn: (tx: LicensesTxClient) => Promise<T>,
    options?: { isolationLevel?: string; timeout?: number },
  ): Promise<T>;
};

/**
 * READ COMMITTED — what makes the post-lock re-read see the winner's rows —
 * plus the bounded wait for the installation lock. A loser waits at most
 * {@link LOCK_WAIT_TIMEOUT_MS}; beyond that the transaction is aborted by
 * Prisma and NOTHING is written (the caller retries). An import is a few
 * milliseconds of work, so a wait that long means something is wrong with the
 * database, not with the license state — which is why an abort surfaces as a
 * server error rather than a license conflict.
 */
const LOCK_WAIT_TIMEOUT_MS = 10_000;
const READ_COMMITTED = {
  isolationLevel: 'ReadCommitted',
  timeout: LOCK_WAIT_TIMEOUT_MS,
} as const;

@Injectable()
export class LicensesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  /** Every retained version of the installation, oldest first. */
  async listVersions(
    installationId: string,
  ): Promise<RetainedLicenseVersion[]> {
    return readVersions(await this.client(), installationId);
  }

  /**
   * Serialize a device mutation with license imports, then resolve the current
   * signed version from the same post-lock database snapshot. The opaque
   * transaction capability is only consumed by this Licensing data layer.
   */
  async lockForDeviceAllocation(
    transaction: DatabaseTransaction,
    installationId: string,
    at: Date,
  ): Promise<{
    installation: { id: string; customerId: string | null };
    effectiveVersion: RetainedLicenseVersion | null;
  }> {
    const tx = await this.prisma.getClient<Client>(transaction);
    const installation = await lockInstallationRow(tx, installationId);
    await lockDeviceAllocation(tx, installationId);
    const versions = await readVersions(tx, installationId);
    return {
      installation,
      effectiveVersion: resolveEffectiveVersion(versions, at).version,
    };
  }

  /**
   * A retained version of one operation, or one document artifact. Used by the
   * import path's duplicate checks; the database indexes behind these columns
   * are what actually make the checks race-safe.
   */
  async findVersion(
    installationId: string,
    by: { operationId: string } | { documentHash: string },
  ): Promise<RetainedLicenseVersion | null> {
    const client = await this.client();
    const row = await client.licenseVersion.findFirst({
      where: {
        installationId,
        ...('operationId' in by
          ? { operationId: by.operationId }
          : { documentHash: by.documentHash }),
      },
      include: {
        entitlements: { select: { kind: true, code: true } },
        license: {
          select: {
            licenseType: true,
            customerId: true,
            customer: { select: { customerCode: true } },
            developerId: true,
            developerName: true,
          },
        },
      },
    });
    return row === null ? null : toRetainedVersion(row);
  }

  /** Read a persisted licensing customer by internal `customerId` (L-06). */
  async findCustomerById(customerId: string): Promise<LicenseCustomer | null> {
    const client = await this.client();
    const row = await client.licenseCustomer.findUnique({
      where: { id: customerId },
    });
    return row === null ? null : toLicenseCustomer(row);
  }

  /** Read a persisted licensing customer by business `customerCode` (L-06). */
  async findCustomerByCode(
    customerCode: string,
  ): Promise<LicenseCustomer | null> {
    const client = await this.client();
    const row = await client.licenseCustomer.findUnique({
      where: { customerCode },
    });
    return row === null ? null : toLicenseCustomer(row);
  }

  /**
   * Read the persisted customer rows relevant to one import pre-check so the
   * read-side evaluation sees the same `(customerId, customerCode)` bindings as
   * the authoritative in-transaction check.
   */
  async findCustomersForImport(params: {
    customerId: string;
    customerCode: string;
    installationCustomerId: string | null;
  }): Promise<{
    installationCustomerCode: string | null;
    knownCustomers: Array<{ customerId: string; customerCode: string }>;
  }> {
    const lookup = await readCustomersForImport(await this.client(), params);
    return {
      installationCustomerCode: lookup.installationCustomerCode,
      knownCustomers: lookup.knownCustomers,
    };
  }

  /**
   * Create a licensing customer with a valid, unique business `customerCode`
   * (L-06, PDR-14). Never derives `customerCode` from `displayName` or
   * defaults `customerCode` to `customerId`.
   */
  async createCustomer(params: {
    customerId: string;
    customerCode: string;
    displayName: string;
    now?: Date;
    actorId?: string | null;
  }): Promise<LicenseCustomer> {
    const validated = assertValidCustomerRecord(params);
    const now = params.now ?? new Date();
    const client = await this.client();
    const existingById = await client.licenseCustomer.findUnique({
      where: { id: validated.customerId },
    });
    if (existingById !== null) {
      throw new LicenseCustomerError(
        'duplicate-customer',
        `Customer id "${validated.customerId}" already exists.`,
      );
    }
    const existingByCode = await client.licenseCustomer.findUnique({
      where: { customerCode: validated.customerCode },
    });
    if (existingByCode !== null) {
      throw new LicenseCustomerError(
        'duplicate-customer',
        `Customer code "${validated.customerCode}" already exists.`,
      );
    }
    try {
      const created = await client.licenseCustomer.create({
        data: {
          id: validated.customerId,
          customerCode: validated.customerCode,
          displayName: validated.displayName,
          createdAt: now,
          updatedAt: now,
          createdBy: params.actorId ?? null,
          updatedBy: params.actorId ?? null,
        },
      });
      return toLicenseCustomer(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new LicenseCustomerError(
          'duplicate-customer',
          'Customer id or customerCode already exists.',
        );
      }
      throw error;
    }
  }

  /**
   * Rename a customer's `displayName` (`display_name`) without altering
   * `customerId` (`id`) or `customerCode` (`customer_code`) (L-06, PDR-14).
   */
  async updateCustomerDisplayName(params: {
    customerId: string;
    displayName: string;
    now?: Date;
    actorId?: string | null;
  }): Promise<LicenseCustomer> {
    const displayName = assertValidCustomerName(params.displayName);
    const now = params.now ?? new Date();
    const client = await this.client();
    const existing = await client.licenseCustomer.findUnique({
      where: { id: params.customerId },
    });
    if (existing === null) {
      throw new LicenseCustomerError(
        'customer-not-found',
        `Customer "${params.customerId}" does not exist.`,
      );
    }
    const updated = await client.licenseCustomer.update({
      where: { id: params.customerId },
      data: {
        displayName,
        updatedAt: now,
        updatedBy: params.actorId ?? null,
      },
    });
    return toLicenseCustomer(updated);
  }

  /**
   * Persist one import as ONE transaction. A partial failure rolls back
   * everything: no license, no version, no entitlement, no supersession and no
   * `applied` audit event survive.
   */
  async importVersion(
    command: ImportLicenseVersionCommand,
  ): Promise<ImportVersionResult> {
    const licenseType = command.licenseType ?? 'COMMERCIAL';
    const developerId = command.developerId ?? null;
    const developerName = command.developerName ?? null;
    const client = await this.client();
    const committed = await client.$transaction(async (tx) => {
      // 1. Serialize every import of THIS installation. The lock is held until
      //    commit, so the checks below cannot race a concurrent importer: the
      //    loser waits here and then reads the winner's committed rows. The
      //    locked row also carries the installation's commercial customer, which
      //    the customer-binding rules below evaluate against.
      const installation = await lockInstallationRow(
        tx,
        command.installationId,
      );

      // 1a. OD-LIC-17: a revoked license accepts no version at all — not a
      //     renewal, not a supersession, not a replay of the artifact that was
      //     already applied. The check runs under the installation lock, so a
      //     concurrent revocation either committed first (and is seen here) or
      //     waits and then sees this import; the two can never interleave.
      //     Nothing is written before this point, so the refusal is total.
      const revokedTarget = await tx.license.findUnique({
        where: { id: command.licenseId },
        select: {
          installationId: true,
          licenseType: true,
          customerId: true,
          developerId: true,
          revokedAt: true,
        },
      });
      if (revokedTarget?.revokedAt != null) {
        throw new ImportConflictError({
          reason: 'license-revoked',
          overlapping: 0,
        });
      }

      // 1b. Serialize the §8.6 usage read (L-04) against the licensed
      //     allocation paths. Organization creation and active-user
      //     activation count + write under these same transaction-scoped
      //     advisory locks; holding both here means a concurrent creation is
      //     either fully committed before this transaction's counts (and is
      //     counted) or still waiting (and is not). The counts themselves are
      //     read through the owning modules' application contracts, never
      //     through their tables.
      let usage: LicenseUsageSnapshot | null = null;
      if (command.readUsage !== undefined && command.readUsage !== null) {
        await lockLicenseUsageAllocation(tx, command.installationId);
        usage = await command.readUsage();
      }

      // 2. Authoritative invariant check. The read-side pre-check in the
      //    service may have run before another import committed; THIS one runs
      //    under the lock, so it decides.
      const retained = await readVersions(tx, command.installationId);
      const customerLookup =
        licenseType === 'COMMERCIAL' &&
        command.customerId !== null &&
        command.customerCode !== null
          ? await readCustomersForImport(tx, {
              customerId: command.customerId,
              customerCode: command.customerCode,
              installationCustomerId: installation.customerId,
            })
          : {
              byId: null,
              installationCustomerCode: null,
              knownCustomers: [],
            };
      const candidate = {
        validFrom: command.validFrom,
        validUntil: command.validUntil,
        licenseId: command.licenseId,
        licenseType: licenseType,
        customerId: command.customerId,
        customerCode: command.customerCode,
        developerId: developerId,
        developerName: developerName,
        organizationLimit: command.organizationLimit,
        userLimit: command.userLimit,
        deviceLimit: command.deviceLimit,
        deviceLimitSpecified: command.deviceLimitSpecified,
        entitlements: command.entitlements,
      };
      const evaluation = evaluateImportConflicts({
        candidate,
        operationId: command.operationId,
        documentHash: command.documentHash,
        supersession: command.supersession,
        versions: retained,
        at: command.now,
        installationCustomerId: installation.customerId,
        installationCustomerCode: customerLookup.installationCustomerCode,
        knownCustomers: customerLookup.knownCustomers,
        customerTransfer: command.customerTransfer,
        usage,
        gapRecovery: command.gapRecovery,
        reductionResolution: command.reductionResolution,
      });
      if (evaluation.conflict !== null) {
        throw new ImportConflictError(evaluation.conflict);
      }

      // 3. The transaction must retire exactly the version the application
      //    layer resolved (the `license.version.superseded` audit row it
      //    already built names that version). If the state moved under it, the
      //    import is refused rather than recording an audit row that describes
      //    a retirement that did not happen.
      const supersedes = evaluation.supersedes;
      if (
        (supersedes?.versionId ?? null) !==
        command.expectedSupersessionVersionId
      ) {
        throw new ImportConflictError({
          reason:
            command.supersession.kind === 'implicit'
              ? 'overlapping-range'
              : command.supersession.kind === 'renewal'
                ? 'renewal-target-unknown'
                : 'unknown-supersession',
          overlapping: supersedes === null ? 0 : 1,
        });
      }

      // 3b. A renewal's effective start is derived INSIDE the locked
      //     evaluation, and the row is written with exactly that instant. A
      //     disagreement between the command and the authoritative evaluation
      //     — or a `governs_from` on a document that is not a renewal — is
      //     refused before anything is written, so the new row, the target's
      //     stamp and the audit trail can never describe different terms
      //     (OD-LIC-06 §4.3 step 5).
      const authoritativeRenewalStart = evaluation.renewal?.governsFrom ?? null;
      const commandRenewalStart = command.governsFrom ?? null;
      if (
        (authoritativeRenewalStart === null) !==
          (commandRenewalStart === null) ||
        (authoritativeRenewalStart !== null &&
          commandRenewalStart !== null &&
          authoritativeRenewalStart.getTime() !== commandRenewalStart.getTime())
      ) {
        throw new ImportConflictError({
          reason:
            command.supersession.kind === 'renewal'
              ? 'renewal-target-not-current'
              : 'overlapping-range',
          overlapping: 0,
        });
      }

      // 2b. Cross-installation binding. A license identifier belongs to exactly
      //     one installation and one customer (PDR-11 §2.1, ADR-0046 Decision 2).
      //     The retained-version check above only sees THIS installation's rows,
      //     so the license row itself is checked here, under the same lock, before
      //     anything is upserted. Without this check a foreign identifier reached
      //     the composite foreign key and surfaced as an unmapped database error.
      const boundLicense = await tx.license.findUnique({
        where: { id: command.licenseId },
        select: {
          installationId: true,
          licenseType: true,
          customerId: true,
          developerId: true,
          revokedAt: true,
        },
      });
      if (
        boundLicense !== null &&
        (boundLicense.installationId !== command.installationId ||
          boundLicense.licenseType !== licenseType ||
          (licenseType === 'COMMERCIAL'
            ? boundLicense.customerId !== command.customerId
            : boundLicense.developerId !== developerId))
      ) {
        throw new ImportConflictError({
          reason: 'license-binding-conflict',
          overlapping: 0,
        });
      }

      // L-06 (PDR-14 / OD-LIC-03): Create the customer row only when
      // `command.customerId` is not yet persisted; NEVER overwrite an existing
      // customer's stored `display_name` or `customer_code` on import.
      if (licenseType === 'COMMERCIAL' && customerLookup.byId === null) {
        if (
          command.customerId === null ||
          command.customerCode === null ||
          command.customerName === null
        ) {
          throw new ImportConflictError({
            reason: 'customer-code-mismatch',
            overlapping: 0,
          });
        }
        try {
          await tx.licenseCustomer.create({
            data: {
              id: command.customerId,
              customerCode: command.customerCode,
              displayName: command.customerName,
              createdAt: command.now,
              updatedAt: command.now,
            },
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ImportConflictError({
              reason: 'customer-code-mismatch',
              overlapping: 0,
            });
          }
          throw error;
        }
      }
      // The license identifier is claimed by a plain INSERT, never an upsert. An
      // upsert is `INSERT … ON CONFLICT DO UPDATE` when the row already exists:
      // on a concurrent claim by ANOTHER installation (which the installation
      // lock does not serialize) it would silently adopt that row and re-bind its
      // customer, and the version insert would then fail on the composite
      // foreign key as an unmapped error. The primary key arbitrates the race
      // instead: a losing insert waits for the winner's commit and fails with a
      // unique violation, which is the documented binding conflict. Nothing
      // written here survives, because the throw rolls the transaction back.
      if (boundLicense === null) {
        try {
          await tx.license.create({
            data: {
              id: command.licenseId,
              installationId: command.installationId,
              licenseType: licenseType,
              customerId: command.customerId,
              developerId: developerId,
              developerName: developerName,
              createdAt: command.now,
              updatedAt: command.now,
            },
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ImportConflictError({
              reason: 'license-binding-conflict',
              overlapping: 0,
            });
          }
          throw error;
        }
      } else {
        // Already bound to THIS installation and customer (checked above under
        // the lock). The guarded touch keeps the binding asserted in SQL too.
        const touched = await tx.license.updateMany({
          where: {
            id: command.licenseId,
            installationId: command.installationId,
            licenseType: licenseType,
            customerId: command.customerId,
            developerId: developerId,
          },
          data: { updatedAt: command.now },
        });
        if (touched.count !== 1) {
          throw new ImportConflictError({
            reason: 'license-binding-conflict',
            overlapping: 0,
          });
        }
      }
      // The installation's commercial-customer binding (L-02). Reaching this
      // point means the evaluation above allowed it: either the binding is
      // unchanged (a first binding or the same customer), or the caller carried
      // the explicit transfer intent (Owner decision 2026-10-12, Q4). The write
      // is skipped when nothing changes, so an ordinary import touches the
      // binding not at all.
      const previousCustomerId = installation.customerId;
      const previousCustomerCode = customerLookup.installationCustomerCode;
      const bindingChanged =
        licenseType === 'COMMERCIAL' &&
        previousCustomerId !== command.customerId;
      if (bindingChanged) {
        if (command.customerId === null) {
          throw new ImportConflictError({
            reason: 'license-type-conflict',
            overlapping: 0,
          });
        }
        await tx.installation.update({
          where: { id: command.installationId },
          data: { customerId: command.customerId, updatedAt: command.now },
        });
      }
      // An explicit transfer is audited as its own typed event, written from
      // the values the lock guarantees: the customer that was, the customer
      // that is, the license that governed before, the operation, the actor,
      // the source, the instant and the operator's reason. It is built HERE
      // rather than by the caller because only the transaction knows the real
      // "previous" values under concurrency.
      //
      // L-06 (PDR-14 §3.5.4): the license that governed this installation
      // immediately before the transfer took effect. It is resolved HERE from
      // `retained` — the versions this transaction read UNDER the installation
      // lock — never from the unlocked pre-check, so a concurrent writer
      // cannot make the audit row name a predecessor that was not governing.
      //
      // `resolveEffectiveVersion` is the same authority the read path uses, so
      // the recorded predecessor is exactly the license an as-of query would
      // have returned at that instant: the version this document retired or
      // took over when it overlapped one, and the still-governing version when
      // the transfer document is a future-dated or contiguous successor. Null
      // when nothing was governing then.
      //
      // Recorded only for a transfer that actually changed the binding: every
      // other import leaves the column null as before (PDR-13 records the
      // recovery's own predecessor on `license.import.recovered`).
      const previousLicenseId =
        command.customerTransfer !== null && bindingChanged
          ? (resolveEffectiveVersion(retained, command.now).version
              ?.licenseId ?? null)
          : null;
      const auditEvents =
        bindingChanged && previousCustomerId !== null
          ? [
              ...command.auditEvents,
              transferAuditEvent(
                command,
                previousCustomerId,
                previousCustomerCode,
                previousLicenseId,
              ),
            ]
          : [...command.auditEvents];

      // Dedicated-operation APPLIED events are built HERE, inside the
      // transaction, from the facts only the lock guarantees — exactly like
      // the transfer event above. A combined recovery/resolution writes both
      // typed events independently. The service deliberately does not build
      // them: the retained list the pre-check read may already have moved by
      // the time the lock was granted, and the audit rows must describe the
      // lapse and resolution as the transaction found them.
      let recoveryReceipt: ImportVersionResult['recovery'] = null;
      let resolutionReceipt: ImportVersionResult['resolution'] = null;
      if (command.gapRecovery !== null) {
        const lapsed = lapsedLicenseContext(retained);
        recoveryReceipt = {
          lapsedLicenseId: lapsed?.licenseId ?? null,
          coverageEnd: lapsed?.coverageEnd ?? null,
        };
        auditEvents.push(recoveryAuditEvent(command, lapsed));
      }
      if (command.reductionResolution !== null) {
        // The evaluation's resolution subject is the version whose grant the
        // resolution authorized reducing: the retired predecessor on a
        // hand-over path, the L-05 continuation baseline of a renewal that
        // retires nothing, or the L-07 latest lapsed version for a recovery.
        // The subject is audited and reported but deliberately NOT stamped
        // unless it is independently the actual `supersedes` target; a
        // resolution authorizes a reduction, it does not itself retire the
        // version it is measured against.
        const predecessor = evaluation.resolutionSubject;
        // Reaching this point means the evaluation applied the resolution to
        // real conflicts (the domain rule refuses an unused resolution), so
        // the subject exists and the recomputed conflicts are exactly the
        // ones the resolution authorized.
        if (predecessor === null) {
          throw new Error(
            'A reduction resolution was applied without a resolution subject; refusing rather than auditing an empty resolution.',
          );
        }
        const conflicts = reductionConflicts(predecessor, candidate, usage);
        resolutionReceipt = {
          predecessorVersionId: predecessor.versionId,
          conflicts,
        };
        auditEvents.push(
          resolutionAuditEvent(command, predecessor.versionId, conflicts),
        );
      }

      // The renewal's APPLIED event is built HERE from the locked facts, like
      // the transfer/recovery/resolution events above. It is the only
      // `license.import.renewed` row any import can write, and it is written in
      // the same transaction as the version, its entitlements and the target's
      // stamp — a failure writes none of them.
      if (evaluation.renewal !== null) {
        const renewedPreviousLicenseId =
          supersedes !== null && supersedes.licenseId !== command.licenseId
            ? supersedes.licenseId
            : null;
        auditEvents.push(
          renewalAuditEvent(
            command,
            evaluation.renewal,
            renewedPreviousLicenseId,
          ),
        );
      }

      const version = await tx.licenseVersion.create({
        data: {
          id: command.versionId,
          licenseId: command.licenseId,
          installationId: command.installationId,
          operationId: command.operationId,
          status: command.status,
          provider: command.provider,
          documentVersion: command.documentVersion,
          documentHash: command.documentHash,
          keyId: command.keyId,
          source: command.source,
          validFrom: command.validFrom,
          signedIssuedAt: command.signedIssuedAt,
          governsFrom: command.governsFrom,
          validUntil: command.validUntil,
          organizationLimit: command.organizationLimit,
          userLimit: command.userLimit,
          deviceLimit: command.deviceLimit,
          deviceLimitSpecified: command.deviceLimitSpecified,
          importedAt: command.now,
          importedBy: command.actorId,
          supersedesVersionId: supersedes?.versionId ?? null,
          createdAt: command.now,
          updatedAt: command.now,
          entitlements: {
            create: command.entitlements.map((entitlement) => ({
              id: generateId(),
              kind: entitlement.kind,
              code: entitlement.code,
              createdAt: command.now,
              updatedAt: command.now,
            })),
          },
        },
        include: {
          entitlements: { select: { kind: true, code: true } },
          license: {
            select: {
              licenseType: true,
              customerId: true,
              customer: { select: { customerCode: true } },
              developerId: true,
              developerName: true,
            },
          },
        },
      });

      // Supersession is stamped AFTER the new version exists: the
      // `superseded_by_version_id` foreign key points at this very row and
      // PostgreSQL checks it immediately. `superseded_at` records WHEN the
      // supersession was recorded; `governs_until` records WHEN the
      // predecessor stops governing — the successor's own `validFrom`, which
      // for a future-dated renewal is later. The predecessor therefore keeps
      // governing today (PDR-11 §3.2, CF-1) and the hand-over is exact.
      if (supersedes !== null) {
        const superseded = await tx.licenseVersion.updateMany({
          where: {
            id: supersedes.versionId,
            installationId: command.installationId,
            // Guarded: a version is retired at most once. Redundant under the
            // installation lock, kept as defence in depth.
            supersededAt: null,
          },
          data: {
            supersededAt: command.now,
            governsUntil: supersessionCeaseInstant(command),
            supersededByVersionId: command.versionId,
            updatedAt: command.now,
          },
        });
        if (superseded.count === 0) {
          throw new ImportConflictError({
            reason: 'unknown-supersession',
            overlapping: 0,
          });
        }
      }

      for (const event of auditEvents) {
        await tx.licenseAuditEvent.create({
          data: {
            id: generateId(),
            installationId: event.installationId,
            eventType: event.eventType,
            outcome: event.outcome,
            operationId: event.operationId,
            licenseId: event.licenseId,
            versionId: event.versionId,
            deviceId: event.deviceId ?? null,
            replacementRequestId: event.replacementRequestId ?? null,
            actorId: event.actorId,
            source: event.source,
            documentHash: event.documentHash,
            reason: event.reason,
            detail: event.detail,
            previousCustomerId: event.previousCustomerId ?? null,
            previousCustomerCode: event.previousCustomerCode ?? null,
            newCustomerId: event.newCustomerId ?? null,
            newCustomerCode: event.newCustomerCode ?? null,
            previousLicenseId: event.previousLicenseId ?? null,
            renewedVersionId: event.renewedVersionId ?? null,
            renewedFrom: event.renewedFrom ?? null,
            renewedUntil: event.renewedUntil ?? null,
            occurredAt: event.occurredAt,
            createdAt: event.occurredAt,
            updatedAt: event.occurredAt,
          },
        });
      }

      return {
        version,
        previousCustomerId,
        previousCustomerCode,
        bindingChanged,
        previousLicenseId,
        recovery: recoveryReceipt,
        resolution: resolutionReceipt,
      };
    }, READ_COMMITTED);
    return {
      version: toRetainedVersion(committed.version),
      previousCustomerId: committed.previousCustomerId,
      previousCustomerCode: committed.previousCustomerCode,
      bindingChanged: committed.bindingChanged,
      previousLicenseId: committed.previousLicenseId,
      recovery: committed.recovery,
      resolution: committed.resolution,
    };
  }

  // -------------------------------------------------------------------------
  // Signed revocation (OD-LIC-17, docs/licensing/revocation-artifact-protocol.md)
  // -------------------------------------------------------------------------

  /** The local commercial customer of a signed `customerId`, if any. */
  async findCustomer(
    customerId: string,
  ): Promise<{ customerId: string; customerCode: string } | null> {
    const client = await this.client();
    const row = await client.licenseCustomer.findUnique({
      where: { id: customerId },
    });
    return row === null
      ? null
      : { customerId: row.id, customerCode: row.customerCode };
  }

  /**
   * The license a revocation names, its license-level revocation state and its
   * retained versions. Read-only and outside the lock on purpose: the
   * transaction re-checks the target under the installation lock before it
   * writes, so this projection is an informative pre-check, never the decision.
   */
  async findRevocationTarget(licenseId: string): Promise<{
    licenseId: string;
    installationId: string;
    customerId: string | null;
    revokedAt: Date | null;
    revocationId: string | null;
    versions: Array<{
      versionId: string;
      operationId: string;
      signedIssuedAt: Date | null;
    }>;
  } | null> {
    const client = await this.client();
    const row = await client.license.findUnique({
      where: { id: licenseId },
      include: {
        versions: {
          select: { id: true, operationId: true, signedIssuedAt: true },
        },
      },
    });
    if (row === null) return null;
    return {
      licenseId: row.id,
      installationId: row.installationId,
      customerId: row.customerId,
      revokedAt: row.revokedAt,
      revocationId: row.revocationId,
      versions: row.versions.map((version) => ({
        versionId: version.id,
        operationId: version.operationId,
        signedIssuedAt: version.signedIssuedAt,
      })),
    };
  }

  /**
   * The license-level revocation state alone — the read-path query the provider
   * runs for the effective version's license. One primary-key projection, no
   * version join, no second source of truth.
   */
  /**
   * Read-side revocation state of one license row. `installationId` is returned
   * so a caller can keep the cross-installation refusal in the binding rules: a
   * license id owned by another installation is a `license-binding-conflict`,
   * never a revocation of this installation.
   */
  async findLicenseRevocationState(
    licenseId: string,
  ): Promise<{ installationId: string; revokedAt: Date | null } | null> {
    const client = await this.client();
    const row = await client.license.findUnique({
      where: { id: licenseId },
      select: {
        installationId: true,
        licenseType: true,
        customerId: true,
        developerId: true,
        revokedAt: true,
      },
    });
    return row === null
      ? null
      : { installationId: row.installationId, revokedAt: row.revokedAt };
  }

  async findRevocation(
    revocationId: string,
  ): Promise<LicenseRevocationRecord | null> {
    const client = await this.client();
    const row = await client.licenseRevocation.findUnique({
      where: { revocationId },
    });
    return row === null ? null : toRevocationRecord(row);
  }

  async findRevocationForLicense(
    licenseId: string,
  ): Promise<LicenseRevocationRecord | null> {
    const client = await this.client();
    const row = await client.licenseRevocation.findUnique({
      where: { licenseId },
    });
    return row === null ? null : toRevocationRecord(row);
  }

  /**
   * Apply one verified revocation: insert the revocation, stamp the license
   * and write the typed audit event in ONE transaction, under the same
   * per-installation row lock every license import takes.
   *
   * Replay/idempotency (protocol §6) is decided HERE as well as in the
   * service, because only the lock makes it authoritative:
   *   - same `revocationId` with the same canonical payload → the stored row is
   *     returned and nothing is written (`alreadyApplied`);
   *   - same `revocationId` with different bytes → `conflicting-replay`, which
   *     implies key misuse or operator error;
   *   - a different `revocationId` for an already-revoked license →
   *     `already-revoked` with the original row, never an overwrite.
   */
  async applyRevocation(
    command: ApplyRevocationCommand,
  ): Promise<{ revocation: LicenseRevocationRecord; alreadyApplied: boolean }> {
    const client = await this.client();
    return await client.$transaction(async (tx) => {
      await lockInstallationRow(tx, command.installationId);

      const existing = await tx.licenseRevocation.findUnique({
        where: { revocationId: command.revocationId },
      });
      if (existing !== null) {
        if (
          existing.canonicalPayloadSha256 !== command.canonicalPayloadSha256 ||
          existing.licenseId !== command.licenseId
        ) {
          throw new RevocationConflictError('conflicting-replay');
        }
        return {
          revocation: toRevocationRecord(existing),
          alreadyApplied: true,
        };
      }

      const forLicense = await tx.licenseRevocation.findUnique({
        where: { licenseId: command.licenseId },
      });
      if (forLicense !== null) {
        throw new RevocationConflictError('already-revoked', {
          revocationId: forLicense.revocationId,
          revokedAt: forLicense.importedAt.toISOString(),
        });
      }

      // The license must belong to THIS installation and THIS customer. The
      // service checked it outside the lock; this is the authoritative check.
      const license = await tx.license.findUnique({
        where: { id: command.licenseId },
        select: {
          installationId: true,
          licenseType: true,
          customerId: true,
          developerId: true,
          revokedAt: true,
        },
      });
      if (
        license === null ||
        license.installationId !== command.installationId ||
        license.customerId !== command.customerId
      ) {
        throw new RevocationConflictError('unknown-target');
      }
      if (license.revokedAt !== null) {
        throw new RevocationConflictError('already-revoked', {
          revocationId: command.licenseId,
          revokedAt: license.revokedAt.toISOString(),
        });
      }

      const revocation = await tx.licenseRevocation.create({
        data: {
          revocationId: command.revocationId,
          licenseId: command.licenseId,
          installationId: command.installationId,
          customerId: command.customerId,
          customerCode: command.customerCode,
          targetOperationId: command.targetOperationId,
          reason: command.reason,
          reasonDetail: command.reasonDetail,
          issuerKeyId: command.issuerKeyId,
          issuedAt: command.issuedAt,
          importedAt: command.now,
          importedBy: command.actorId,
          artifactSha256: command.artifactSha256,
          canonicalPayloadSha256: command.canonicalPayloadSha256,
          createdAt: command.now,
          updatedAt: command.now,
        },
      });
      const stamped = await tx.license.updateMany({
        where: { id: command.licenseId, revokedAt: null },
        data: {
          revokedAt: command.now,
          revocationId: command.revocationId,
          updatedAt: command.now,
        },
      });
      if (stamped.count !== 1) {
        throw new RevocationConflictError('already-revoked');
      }
      await tx.licenseAuditEvent.create({
        data: {
          id: generateId(),
          installationId: command.installationId,
          eventType: 'license.revocation.imported',
          outcome: 'APPLIED',
          operationId: command.targetOperationId,
          licenseId: command.licenseId,
          versionId: command.targetVersionId,
          deviceId: null,
          replacementRequestId: null,
          actorId: command.actorId,
          source: command.source,
          documentHash: command.artifactSha256,
          reason: command.reason,
          detail: command.detail,
          previousCustomerId: null,
          previousCustomerCode: null,
          newCustomerId: null,
          newCustomerCode: null,
          previousLicenseId: null,
          renewedVersionId: null,
          renewedFrom: null,
          renewedUntil: null,
          revocationId: command.revocationId,
          occurredAt: command.now,
          createdAt: command.now,
          updatedAt: command.now,
        },
      });
      return {
        revocation: toRevocationRecord(revocation),
        alreadyApplied: false,
      };
    }, READ_COMMITTED);
  }

  /**
   * Append one audit event through the separate, best-effort path used for
   * rejections (these inserts do not share the state-change transaction).
   * Their machine-readable reason remains bounded to the rejection vocabulary,
   * and incidental rejection detail is capped here. Successful APPLIED events
   * use the typed builders below and are written in the state-change
   * transaction without truncating their operator reason or required context.
   */
  async recordAuditEvent(command: LicenseAuditEventCommand): Promise<void> {
    const client = await this.client();
    await client.licenseAuditEvent.create({
      data: {
        id: generateId(),
        installationId: command.installationId,
        eventType: command.eventType,
        outcome: command.outcome,
        operationId: command.operationId,
        licenseId: command.licenseId,
        versionId: command.versionId,
        deviceId: command.deviceId ?? null,
        replacementRequestId: command.replacementRequestId ?? null,
        actorId: command.actorId,
        source: command.source,
        documentHash: command.documentHash,
        reason: clampText(command.reason, 60),
        detail: clampText(command.detail, 500),
        previousCustomerId: command.previousCustomerId ?? null,
        previousCustomerCode: command.previousCustomerCode ?? null,
        newCustomerId: command.newCustomerId ?? null,
        newCustomerCode: command.newCustomerCode ?? null,
        previousLicenseId: command.previousLicenseId ?? null,
        renewedVersionId: command.renewedVersionId ?? null,
        renewedFrom: command.renewedFrom ?? null,
        renewedUntil: command.renewedUntil ?? null,
        revocationId: command.revocationId ?? null,
        occurredAt: command.occurredAt,
        createdAt: command.occurredAt,
        updatedAt: command.occurredAt,
      },
    });
  }

  /** The installation's audit trail, oldest first (bounded by `limit`). */
  async listAuditEvents(
    installationId: string,
    limit = 100,
  ): Promise<LicenseAuditEventRow[]> {
    const client = await this.client();
    const rows = await client.licenseAuditEvent.findMany({
      where: { installationId },
      orderBy: { occurredAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      installationId: row.installationId,
      eventType: row.eventType,
      outcome: row.outcome as LicenseAuditEventCommand['outcome'],
      operationId: row.operationId,
      licenseId: row.licenseId,
      versionId: row.versionId,
      deviceId: row.deviceId,
      replacementRequestId: row.replacementRequestId,
      actorId: row.actorId,
      source: row.source,
      documentHash: row.documentHash,
      reason: row.reason,
      detail: row.detail,
      previousCustomerId: row.previousCustomerId,
      previousCustomerCode: row.previousCustomerCode,
      newCustomerId: row.newCustomerId,
      newCustomerCode: row.newCustomerCode,
      previousLicenseId: row.previousLicenseId,
      renewedVersionId: row.renewedVersionId,
      renewedFrom: row.renewedFrom,
      renewedUntil: row.renewedUntil,
      occurredAt: row.occurredAt,
    }));
  }
}

/**
 * Every retained version of one installation, oldest first — the shared read of
 * the pre-check (outside a transaction) and of the authoritative in-transaction
 * evaluation.
 */
function toRevocationRecord(
  row: LicenseRevocationRow,
): LicenseRevocationRecord {
  return {
    revocationId: row.revocationId,
    licenseId: row.licenseId,
    installationId: row.installationId,
    customerId: row.customerId,
    customerCode: row.customerCode,
    targetOperationId: row.targetOperationId,
    reason: row.reason,
    reasonDetail: row.reasonDetail,
    issuerKeyId: row.issuerKeyId,
    issuedAt: row.issuedAt,
    importedAt: row.importedAt,
    importedBy: row.importedBy,
    artifactSha256: row.artifactSha256,
    canonicalPayloadSha256: row.canonicalPayloadSha256,
  };
}

async function readVersions(
  client: LicensesTxClient,
  installationId: string,
): Promise<RetainedLicenseVersion[]> {
  const rows = await client.licenseVersion.findMany({
    where: { installationId },
    include: {
      entitlements: { select: { kind: true, code: true } },
      license: {
        select: {
          licenseType: true,
          customerId: true,
          customer: { select: { customerCode: true } },
          developerId: true,
          developerName: true,
        },
      },
    },
  });
  return rows
    .map(toRetainedVersion)
    .sort(
      (a, b) =>
        (a.governsFrom ?? a.validFrom).getTime() -
        (b.governsFrom ?? b.validFrom).getTime(),
    );
}

async function readCustomersForImport(
  client: LicensesTxClient,
  params: {
    customerId: string;
    customerCode: string;
    installationCustomerId: string | null;
  },
): Promise<{
  byId: CustomerRow | null;
  installationCustomerCode: string | null;
  knownCustomers: Array<{ customerId: string; customerCode: string }>;
}> {
  const byId = await client.licenseCustomer.findUnique({
    where: { id: params.customerId },
  });
  const byCode = await client.licenseCustomer.findUnique({
    where: { customerCode: params.customerCode },
  });
  const bound =
    params.installationCustomerId === null
      ? null
      : params.installationCustomerId === params.customerId
        ? byId
        : await client.licenseCustomer.findUnique({
            where: { id: params.installationCustomerId },
          });
  const map = new Map<string, { customerId: string; customerCode: string }>();
  for (const row of [byId, byCode, bound]) {
    if (row !== null) {
      map.set(row.id, { customerId: row.id, customerCode: row.customerCode });
    }
  }
  return {
    byId,
    installationCustomerCode: bound?.customerCode ?? null,
    knownCustomers: [...map.values()],
  };
}

function toLicenseCustomer(row: CustomerRow): LicenseCustomer {
  return {
    customerId: row.id,
    customerCode: row.customerCode,
    displayName: row.displayName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Take the per-installation import lock: `SELECT … FOR UPDATE` on the
 * installation row, held until the transaction ends. The locked row's
 * commercial customer is returned, because the customer-binding rules are
 * evaluated against the value that cannot move while this transaction runs.
 *
 * This is the entire concurrency strategy for version windows (design §3.4):
 * every import of one installation serializes here, so the conflict evaluation
 * that follows reads a state no other importer can change until this one has
 * committed or rolled back. It is a DATABASE lock — two API processes, an API
 * and a worker, or two containers behind a load balancer all take the same
 * lock; nothing about it is process-local.
 *
 * Lock order is a single step (installation → rows this transaction writes),
 * so no deadlock cycle exists; the installation row is the only row this
 * transaction locks before touching its own tables. An explicit customer
 * transfer takes the same lock, so two concurrent transfers of one installation
 * serialize and the loser re-evaluates against the winner's committed binding.
 *
 * Raw SQL is the documented exemption (AR-11): Prisma cannot express
 * `FOR UPDATE`. The statement is parameterized — the installation id is never
 * interpolated.
 *
 * @throws Error when the installation row does not exist. The service resolves
 *   the identity before importing and installations are never deleted, so a
 *   missing row is a bug: the import must fail closed rather than write a
 *   version for an identity that is gone.
 */
export async function lockInstallationRow(
  tx: LicensesTxClient,
  installationId: string,
): Promise<{ id: string; customerId: string | null }> {
  // The alias is NOT decoration: raw SQL returns the column names as written,
  // so without `AS "customerId"` the row would carry `customer_id` and the
  // caller would read `undefined` for the binding — silently turning the
  // authoritative customer check into a no-op and writing a transfer audit
  // event for an ordinary first import. The live PostgreSQL suite caught
  // exactly that; every column this function returns is aliased explicitly.
  // `$queryRaw<T>` is declared to resolve `T[]` (the driver adapter's shape),
  // so `T` is ONE row.
  const rows = await tx.$queryRaw<{ id: string; customerId: string | null }>`
    SELECT "id" AS "id", "customer_id" AS "customerId"
      FROM "licensing"."installations"
     WHERE "id" = ${installationId}
     FOR UPDATE`;
  const row = rows[0];
  if (row === undefined) {
    throw new Error(
      `Installation "${installationId}" no longer exists; the license import was refused.`,
    );
  }
  return { id: row.id, customerId: row.customerId };
}

/**
 * The typed audit event of one explicit customer transfer (Owner decision
 * 2026-10-12, Q4; L-06, PDR-14 §3.5.4): old customer, new customer, installation,
 * operation, actor, source, document hash, outcome, instant and the complete
 * operator reason are preserved in their typed fields and `detail` (the
 * machine-readable classifier is the event type itself). `reason` stays null:
 * it carries rejection reasons, and the audit schema documents `detail` as the
 * place a successful event retains the full reason.
 *
 * The license pair PDR-14 §3.5.4 requires is carried as:
 * - `previousLicenseId` — the license that governed this installation
 *   immediately before the transfer took effect, computed by the importing
 *   transaction under the installation lock (never inferred from an unlocked
 *   pre-check); null when the installation had no governing license then.
 * - `licenseId` — the NEW license identity the transfer applied, following the
 *   existing `licenseId` convention every other audit event uses for the
 *   license it describes.
 */
export function transferAuditEvent(
  command: ImportLicenseVersionCommand,
  previousCustomerId: string,
  previousCustomerCode: string | null = null,
  previousLicenseId: string | null = null,
): LicenseAuditEventCommand {
  const reason = command.customerTransfer?.reason.trim() ?? '';
  return {
    installationId: command.installationId,
    eventType: 'license.installation.customer-transferred',
    outcome: 'APPLIED',
    operationId: command.operationId,
    licenseId: command.licenseId,
    versionId: command.versionId,
    actorId: command.actorId,
    source: command.source,
    documentHash: command.documentHash,
    reason: null,
    detail:
      `transfer from license ${previousLicenseId ?? 'none'} ` +
      `to ${command.customerId} license ${command.licenseId}` +
      `${reason === '' ? '' : `: ${reason}`}`,
    previousCustomerId,
    previousCustomerCode,
    newCustomerId: command.customerId,
    newCustomerCode: command.customerCode,
    previousLicenseId,
    occurredAt: command.now,
  };
}

/**
 * The typed audit event of the dedicated post-gap recovery (Owner decision
 * 2026-10-12, OQ-87 Option B, PDR-13). It is the operation's APPLIED event:
 * the retained version, the recovery reason, and — in machine-readable
 * columns and detail — the lapse it recovers from: which license's coverage
 * had ended and when. `previousLicenseId` is set ONLY here; the
 * installation and its customer are unchanged by a recovery (a document for
 * another customer is refused before this point).
 *
 * Built inside the importing transaction from the locked retained state, so
 * the named lapse is the one the transaction actually saw.
 */
export function recoveryAuditEvent(
  command: ImportLicenseVersionCommand,
  lapsed: { licenseId: string; coverageEnd: Date } | null,
): LicenseAuditEventCommand {
  const reason = command.gapRecovery?.reason.trim() ?? '';
  return {
    installationId: command.installationId,
    eventType: 'license.import.recovered',
    outcome: 'APPLIED',
    operationId: command.operationId,
    licenseId: command.licenseId,
    versionId: command.versionId,
    actorId: command.actorId,
    source: command.source,
    documentHash: command.documentHash,
    reason: null,
    detail:
      `post-gap recovery after license ${lapsed?.licenseId ?? 'unknown'}` +
      ` (coverage ended ${lapsed?.coverageEnd.toISOString() ?? 'unknown'})` +
      `${reason === '' ? '' : `: ${reason}`}`,
    previousLicenseId: lapsed?.licenseId ?? null,
    occurredAt: command.now,
  };
}

/**
 * The typed APPLIED event of an applied renewal (OD-LIC-06 §8.3, `license.import.renewed`).
 *
 * Built INSIDE the importing transaction from the authoritative evaluation, so
 * the version it names as extended is the one the transaction actually
 * validated and stamped under the installation lock — never the read-side
 * pre-check's opinion. The signed new end date is recorded exactly as signed,
 * and `previous_license_id` carries the identity change when the renewal used
 * a different `licenseId` (the event's own `licenseId` is the new one).
 */
export function renewalAuditEvent(
  command: ImportLicenseVersionCommand,
  renewal: { renewedVersionId: string; governsFrom: Date },
  previousLicenseId: string | null,
): LicenseAuditEventCommand {
  return {
    installationId: command.installationId,
    eventType: 'license.import.renewed',
    outcome: 'APPLIED',
    operationId: command.operationId,
    licenseId: command.licenseId,
    versionId: command.versionId,
    actorId: command.actorId,
    source: command.source,
    documentHash: command.documentHash,
    reason: null,
    detail:
      `renewed version ${renewal.renewedVersionId}: governs from ` +
      `${renewal.governsFrom.toISOString()} until ` +
      `${command.validUntil?.toISOString() ?? 'perpetual'}`,
    previousLicenseId,
    renewedVersionId: renewal.renewedVersionId,
    renewedFrom: renewal.governsFrom,
    renewedUntil: command.validUntil,
    occurredAt: command.now,
  };
}

/**
 * The typed audit event of an explicit reduction resolution (PDR-11 §8.6,
 * L-04). It is the operation's APPLIED event: the retained version, the
 * operator's reason, and the concrete conflicts the resolution authorized
 * (against the predecessor it names), recomputed inside the transaction under
 * the installation and allocation locks — so the audit row can never describe
 * conflicts the committed state did not have.
 */
export function resolutionAuditEvent(
  command: ImportLicenseVersionCommand,
  predecessorVersionId: string,
  conflicts: readonly ReductionConflict[],
): LicenseAuditEventCommand {
  const reason = command.reductionResolution?.reason.trim() ?? '';
  const summary = conflicts
    .map((conflict) => conflict.kind)
    .sort()
    .join('+');
  // The event keeps the full server-recomputed conflict facts (not client input):
  // limits, usage, scopes, and removed entitlements remain independently
  // auditable alongside the stable kind summary.
  const conflictFacts = JSON.stringify(conflicts);
  return {
    installationId: command.installationId,
    eventType: 'license.import.reduction-resolved',
    outcome: 'APPLIED',
    operationId: command.operationId,
    licenseId: command.licenseId,
    versionId: command.versionId,
    actorId: command.actorId,
    source: command.source,
    documentHash: command.documentHash,
    reason: null,
    detail:
      `resolved reduction of version ${predecessorVersionId}` +
      ` [${summary}] conflicts=${conflictFacts}` +
      `${reason === '' ? '' : `: ${reason}`}`,
    occurredAt: command.now,
  };
}

/**
 * Take the licensed-allocation advisory locks for one installation — the SAME
 * transaction-scoped locks organization creation and active-user
 * activation/creation hold while they count and write. An importing
 * transaction takes them before reading §8.6 usage (L-04), so a concurrent
 * creation is either committed and counted, or waiting and not; it can never
 * slip between the conflict check and the commit. Raw SQL with the shared key
 * builder is the documented exemption (AR-11); nothing here is interpolated
 * beyond the parameter.
 */
export async function lockDeviceAllocation(
  tx: LicensesTxClient,
  installationId: string,
): Promise<void> {
  await tx.$queryRaw<unknown>`SELECT pg_advisory_xact_lock(hashtextextended(${licenseAllocationLockKey(installationId, 'devices')}, 0))::text AS "locked"`;
}

export async function lockLicenseUsageAllocation(
  tx: LicensesTxClient,
  installationId: string,
): Promise<void> {
  await tx.$queryRaw<unknown>`SELECT pg_advisory_xact_lock(hashtextextended(${licenseAllocationLockKey(installationId, 'active-users')}, 0))::text AS "locked"`;
  await tx.$queryRaw<unknown>`SELECT pg_advisory_xact_lock(hashtextextended(${licenseAllocationLockKey(installationId, 'organizations')}, 0))::text AS "locked"`;
  await lockDeviceAllocation(tx, installationId);
}

function toRetainedVersion(row: VersionRow): RetainedLicenseVersion {
  return {
    versionId: row.id,
    licenseId: row.licenseId,
    licenseType: row.license.licenseType,
    customerId: row.license.customerId,
    customerCode: row.license.customer?.customerCode ?? null,
    developerId: row.license.developerId,
    developerName: row.license.developerName,
    installationId: row.installationId,
    operationId: row.operationId,
    status: row.status,
    provider: row.provider,
    documentVersion: row.documentVersion,
    documentHash: row.documentHash,
    keyId: row.keyId,
    validFrom: row.validFrom,
    governsFrom: row.governsFrom ?? null,
    validUntil: row.validUntil,
    organizationLimit: row.organizationLimit,
    userLimit: row.userLimit,
    deviceLimit: row.deviceLimit,
    deviceLimitSpecified: row.deviceLimitSpecified,
    entitlements: row.entitlements.map(({ kind, code }) => ({
      kind,
      code,
    })) as LicenseEntitlement[],
    supersededAt: row.supersededAt,
    governsUntil: row.governsUntil,
    supersededByVersionId: row.supersededByVersionId,
    supersedesVersionId: row.supersedesVersionId,
    importedAt: row.importedAt,
    source: row.source as LicenseVersionSource,
  };
}

/** Cap incidental detail on the separate best-effort rejection audit path. */
function clampText(value: string | null, limit: number): string | null {
  if (value === null || value.length <= limit) return value;
  return value.slice(0, limit);
}
