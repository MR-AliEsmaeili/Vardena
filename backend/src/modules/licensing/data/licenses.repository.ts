import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import type {
  EntitlementKind,
  LicenseEntitlement,
  LicenseLimit,
  LicenseStatus,
} from '../domain/license.js';
import {
  evaluateImportConflicts,
  lapsedLicenseContext,
  reductionConflicts,
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
import { licenseAllocationLockKey } from '../application/license-usage.js';

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

export interface ImportLicenseVersionCommand {
  installationId: string;
  /** The acting user, for the audit trail. */
  actorId: string | null;
  now: Date;
  licenseId: string;
  customerId: string;
  customerName: string;
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
  validUntil: Date | null;
  organizationLimit: LicenseLimit;
  userLimit: LicenseLimit;
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
  /** The customer it is bound to AFTER that transfer. */
  newCustomerId?: string | null;
  /**
   * The license whose retained coverage had ended before a dedicated
   * post-gap recovery (Owner decision 2026-10-12, OQ-87). Set only on
   * `license.import.recovered` events; null everywhere else.
   */
  previousLicenseId?: string | null;
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
      return 'This license identifier is already bound to a different customer or installation.';
    case 'installation-customer-mismatch':
      return 'This license document belongs to a different customer than the installation is bound to.';
    case 'transfer-not-applicable':
      return 'The installation is already bound to the customer this transfer names.';
    case 'renewal-gap':
      return 'This renewal would leave a gap in the license coverage.';
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
  /** True when this import changed the installation's customer binding. */
  bindingChanged: boolean;
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
  validUntil: Date | null;
  organizationLimit: number | null;
  userLimit: number | null;
  supersededAt: Date | null;
  governsUntil: Date | null;
  supersededByVersionId: string | null;
  supersedesVersionId: string | null;
  importedAt: Date;
  source: string;
  entitlements: Array<{ kind: EntitlementKind; code: string }>;
  license: { customerId: string };
}

interface VersionDelegate {
  findMany(args: {
    where: { installationId: string };
    include: {
      entitlements: { select: { kind: true; code: true } };
      license: { select: { customerId: true } };
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
      license: { select: { customerId: true } };
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
      validUntil: Date | null;
      organizationLimit: number | null;
      userLimit: number | null;
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
      license: { select: { customerId: true } };
    };
  }): Promise<VersionRow>;
}

interface CustomerDelegate {
  upsert(args: {
    where: { id: string };
    create: {
      id: string;
      displayName: string;
      createdAt: Date;
      updatedAt: Date;
    };
    update: { displayName: string; updatedAt: Date };
  }): Promise<unknown>;
}

interface LicenseDelegate {
  findUnique(args: {
    where: { id: string };
    select: { installationId: true; customerId: true };
  }): Promise<{ installationId: string; customerId: string } | null>;
  create(args: {
    data: {
      id: string;
      installationId: string;
      customerId: string;
      createdAt: Date;
      updatedAt: Date;
    };
  }): Promise<unknown>;
  updateMany(args: {
    where: { id: string; installationId: string; customerId: string };
    data: { updatedAt: Date };
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
      actorId: string | null;
      source: string;
      documentHash: string | null;
      reason: string | null;
      detail: string | null;
      previousCustomerId: string | null;
      newCustomerId: string | null;
      previousLicenseId: string | null;
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
      actorId: string | null;
      source: string;
      documentHash: string | null;
      reason: string | null;
      detail: string | null;
      previousCustomerId: string | null;
      newCustomerId: string | null;
      previousLicenseId: string | null;
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
        license: { select: { customerId: true } },
      },
    });
    return row === null ? null : toRetainedVersion(row);
  }

  /**
   * Persist one import as ONE transaction. A partial failure rolls back
   * everything: no license, no version, no entitlement, no supersession and no
   * `applied` audit event survive.
   */
  async importVersion(
    command: ImportLicenseVersionCommand,
  ): Promise<ImportVersionResult> {
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
      const candidate = {
        validFrom: command.validFrom,
        validUntil: command.validUntil,
        licenseId: command.licenseId,
        customerId: command.customerId,
        organizationLimit: command.organizationLimit,
        userLimit: command.userLimit,
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
              : 'unknown-supersession',
          overlapping: supersedes === null ? 0 : 1,
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
        select: { installationId: true, customerId: true },
      });
      if (
        boundLicense !== null &&
        (boundLicense.installationId !== command.installationId ||
          boundLicense.customerId !== command.customerId)
      ) {
        throw new ImportConflictError({
          reason: 'license-binding-conflict',
          overlapping: 0,
        });
      }

      await tx.licenseCustomer.upsert({
        where: { id: command.customerId },
        create: {
          id: command.customerId,
          displayName: command.customerName,
          createdAt: command.now,
          updatedAt: command.now,
        },
        update: {
          displayName: command.customerName,
          updatedAt: command.now,
        },
      });
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
              customerId: command.customerId,
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
            customerId: command.customerId,
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
      const bindingChanged = previousCustomerId !== command.customerId;
      if (bindingChanged) {
        await tx.installation.update({
          where: { id: command.installationId },
          data: { customerId: command.customerId, updatedAt: command.now },
        });
      }
      // An explicit transfer is audited as its own typed event, written from
      // the values the lock guarantees: the customer that was, the customer
      // that is, the operation, the actor, the source, the instant and the
      // operator's reason. It is built HERE rather than by the caller because
      // only the transaction knows the real "previous" value under concurrency.
      const auditEvents =
        bindingChanged && previousCustomerId !== null
          ? [
              ...command.auditEvents,
              transferAuditEvent(command, previousCustomerId),
            ]
          : [...command.auditEvents];

      // A dedicated operation's APPLIED event is built HERE, inside the
      // transaction, from the facts only the lock guarantees — exactly like
      // the transfer event above. The service deliberately does not build it:
      // the retained list the pre-check read may already have moved by the
      // time the lock was granted, and the audit row must describe the
      // retirement/lapse as the transaction found it.
      let recoveryReceipt: ImportVersionResult['recovery'] = null;
      let resolutionReceipt: ImportVersionResult['resolution'] = null;
      if (command.gapRecovery !== null) {
        const lapsed = lapsedLicenseContext(retained);
        recoveryReceipt = {
          lapsedLicenseId: lapsed?.licenseId ?? null,
          coverageEnd: lapsed?.coverageEnd ?? null,
        };
        auditEvents.push(recoveryAuditEvent(command, lapsed));
      } else if (command.reductionResolution !== null) {
        const predecessor = evaluation.supersedes;
        // Reaching this point means the evaluation applied the resolution to
        // real conflicts (the domain rule refuses an unused resolution), so
        // the predecessor exists and the recomputed conflicts are exactly the
        // ones the resolution authorized.
        if (predecessor === null) {
          throw new Error(
            'A reduction resolution was applied without a retired predecessor; refusing rather than auditing an empty resolution.',
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
          validUntil: command.validUntil,
          organizationLimit: command.organizationLimit,
          userLimit: command.userLimit,
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
          license: { select: { customerId: true } },
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
            actorId: event.actorId,
            source: event.source,
            documentHash: event.documentHash,
            reason: event.reason,
            detail: event.detail,
            previousCustomerId: event.previousCustomerId ?? null,
            newCustomerId: event.newCustomerId ?? null,
            previousLicenseId: event.previousLicenseId ?? null,
            occurredAt: event.occurredAt,
            createdAt: event.occurredAt,
            updatedAt: event.occurredAt,
          },
        });
      }

      return {
        version,
        previousCustomerId,
        bindingChanged,
        recovery: recoveryReceipt,
        resolution: resolutionReceipt,
      };
    }, READ_COMMITTED);
    return {
      version: toRetainedVersion(committed.version),
      previousCustomerId: committed.previousCustomerId,
      bindingChanged: committed.bindingChanged,
      recovery: committed.recovery,
      resolution: committed.resolution,
    };
  }

  /**
   * Append one audit event. Rejections are recorded through a separate insert
   * (they never share the state-change transaction), and the caller treats a
   * logging failure as secondary to the rejection itself.
   *
   * The bounded columns (`reason` VarChar(60), `detail` VarChar(500)) are
   * clamped here, not trusted to every call site: an audit event must never be
   * LOST because its human detail ran long — the machine-readable facts
   * (event type, outcome, ids, reason token) are the evidence, the detail is
   * supplementary.
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
        actorId: command.actorId,
        source: command.source,
        documentHash: command.documentHash,
        reason: clampText(command.reason, 60),
        detail: clampText(command.detail, 500),
        previousCustomerId: command.previousCustomerId ?? null,
        newCustomerId: command.newCustomerId ?? null,
        previousLicenseId: command.previousLicenseId ?? null,
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
      actorId: row.actorId,
      source: row.source,
      documentHash: row.documentHash,
      reason: row.reason,
      detail: row.detail,
      previousCustomerId: row.previousCustomerId,
      newCustomerId: row.newCustomerId,
      previousLicenseId: row.previousLicenseId,
      occurredAt: row.occurredAt,
    }));
  }
}

/**
 * Every retained version of one installation, oldest first — the shared read of
 * the pre-check (outside a transaction) and of the authoritative in-transaction
 * evaluation.
 */
async function readVersions(
  client: LicensesTxClient,
  installationId: string,
): Promise<RetainedLicenseVersion[]> {
  const rows = await client.licenseVersion.findMany({
    where: { installationId },
    include: {
      entitlements: { select: { kind: true, code: true } },
      license: { select: { customerId: true } },
    },
  });
  return rows
    .map(toRetainedVersion)
    .sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
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
 * 2026-10-12, Q4): old customer, new customer, installation, operation, actor,
 * source, document hash, outcome, instant — and the operator's reason, bounded
 * to the column and stored in `detail` (the machine-readable classifier is the
 * event type itself). `reason` stays null: it carries rejection reasons.
 */
export function transferAuditEvent(
  command: ImportLicenseVersionCommand,
  previousCustomerId: string,
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
      `transfer to ${command.customerId}${reason === '' ? '' : `: ${reason}`}`.slice(
        0,
        500,
      ),
    previousCustomerId,
    newCustomerId: command.customerId,
    occurredAt: command.now,
  };
}

/**
 * The typed audit event of the dedicated post-gap recovery (Owner decision
 * 2026-10-12, OQ-87 Option B, PDR-13). It is the operation's APPLIED event:
 * the retained version, the recovery reason, and — in machine-readable
 * columns and bounded detail — the lapse it recovers from: which license's
 * coverage had ended and when. `previousLicenseId` is set ONLY here; the
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
      `${reason === '' ? '' : `: ${reason}`}`.slice(0, 500),
    previousLicenseId: lapsed?.licenseId ?? null,
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
      ` [${summary}]${reason === '' ? '' : `: ${reason}`}`.slice(0, 500),
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
export async function lockLicenseUsageAllocation(
  tx: LicensesTxClient,
  installationId: string,
): Promise<void> {
  await tx.$queryRaw<unknown>`SELECT pg_advisory_xact_lock(hashtextextended(${licenseAllocationLockKey(installationId, 'active-users')}, 0))::text AS "locked"`;
  await tx.$queryRaw<unknown>`SELECT pg_advisory_xact_lock(hashtextextended(${licenseAllocationLockKey(installationId, 'organizations')}, 0))::text AS "locked"`;
}

function toRetainedVersion(row: VersionRow): RetainedLicenseVersion {
  return {
    versionId: row.id,
    licenseId: row.licenseId,
    customerId: row.license.customerId,
    installationId: row.installationId,
    operationId: row.operationId,
    status: row.status,
    provider: row.provider,
    documentVersion: row.documentVersion,
    documentHash: row.documentHash,
    keyId: row.keyId,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    organizationLimit: row.organizationLimit,
    userLimit: row.userLimit,
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

/** Clamp a bounded audit column: an event is never lost to a long detail. */
function clampText(value: string | null, limit: number): string | null {
  if (value === null || value.length <= limit) return value;
  return value.slice(0, limit);
}
