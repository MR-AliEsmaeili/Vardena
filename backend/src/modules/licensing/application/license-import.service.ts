import { Inject, Injectable } from '@nestjs/common';
import type { KeyObject } from 'node:crypto';
import {
  APP_CONFIG,
  type AppConfig,
} from '../../../kernel/config/app-config.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import {
  isUniqueViolation,
  uniqueViolationTouches,
} from '../../../kernel/prisma/prisma-errors.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import {
  ImportConflictError,
  LicensesRepository,
  type ImportVersionResult,
  type LicenseAuditEventCommand,
} from '../data/licenses.repository.js';
import {
  LICENSE_CODE_PREFIX,
  licenseCodeHash,
  parseLicenseCode,
  toInstallationLicense as legacyToInstallationLicense,
  type LicenseCodeErrorReason,
  type LicensePayload,
} from '../domain/license-code.js';
import {
  decodeLicenseTransport,
  licenseDocumentHash,
  licenseVersionEntitlements,
  parseLicenseDocument,
  parseTrustedLicenseKeys,
  LicenseCodeError,
  LicenseDocumentError,
  type LicenseDocumentErrorReason,
  type LicenseVersionPayload,
  type TrustedLicenseKey,
} from '../domain/license-document.js';
import type {
  EvaluatedLicense,
  LicenseEntitlement,
} from '../domain/license.js';
import {
  evaluateImportConflicts,
  resolveEffectiveVersion,
  type CustomerTransferIntent,
  type GapRecoveryIntent,
  type ImportCandidate,
  type ImportConflict,
  type ImportSupersessionIntent,
  type LicenseUsageSnapshot,
  type LicenseVersionSource,
  type ReductionConflict,
  type ReductionResolutionIntent,
  type RetainedLicenseVersion,
} from '../domain/license-version.js';
import { LICENSING_PERMISSIONS } from '../domain/licensing-permissions.js';
import { LICENSE_USAGE_PORT, type LicenseUsagePort } from './license-usage.js';
import { InstallationIdentityService } from './installation-identity.service.js';
import { LicensingService } from './licensing.service.js';
import { PERSISTENT_LICENSE_PROVIDER_NAME } from './persistent-license.provider.js';

/**
 * An audit event whose installation may not exist yet: the pipeline refuses
 * documents before an identity exists, and those refusals are logged instead
 * of attributed to a row that does not exist.
 */
type AuditAttempt = Omit<LicenseAuditEventCommand, 'installationId'> & {
  installationId: string | null;
};

export interface LicenseImportResult {
  /** False when a repeated legacy code was already the governing version. */
  changed: boolean;
  outcome: 'APPLIED' | 'UNCHANGED';
  license: EvaluatedLicense;
}

/**
 * The receipt of the explicit, audited installation customer transfer (Owner
 * decision 2026-10-12, Q4). Both extra fields are read from the same
 * transaction that wrote the change, so the receipt can never disagree with
 * the typed `license.installation.customer-transferred` audit event.
 */
export interface LicenseCustomerTransferResult extends LicenseImportResult {
  /** The installation's commercial customer before the transfer. */
  previousCustomerId: string | null;
  /** The installation's business customer code before the transfer (L-06). */
  previousCustomerCode: string | null;
  /**
   * The license that governed this installation immediately before the
   * transfer, as the transaction observed it under the installation lock
   * (L-06, PDR-14 §3.5.4); null when nothing was governing then. The NEW
   * license identity is `license.licenseId` in this same receipt.
   */
  previousLicenseId: string | null;
  /** True when the transaction changed the installation's binding. */
  bindingChanged: boolean;
  /**
   * The operator-supplied reason exactly as recorded on the typed
   * `license.installation.customer-transferred` audit event (L-06, PDR-14
   * §3.5.4), so a consumer never has to infer it from the current license
   * snapshot or parse the audit trail.
   */
  reason: string;
}

/**
 * The receipt of the dedicated post-gap recovery (Owner decision 2026-10-12,
 * OQ-87 Option B, PDR-13). The lapse facts are read from the same transaction
 * that wrote the typed `license.import.recovered` event, so the receipt can
 * never disagree with the audit trail.
 */
export interface LicenseGapRecoveryResult extends LicenseImportResult {
  /** The license whose retained coverage had ended before the recovery. */
  lapsedLicenseId: string | null;
  /** When that coverage ended; the recovery starts strictly after it. */
  coverageEnd: string | null;
  /** Present only when this recovery also resolved a §8.6 reduction. */
  resolvedPredecessorVersionId?: string;
  /** The concrete conflicts authorized by the combined recovery operation. */
  resolvedConflicts?: ReductionConflict[];
}

/**
 * The receipt of an explicit reduction resolution (PDR-11 §8.6, L-04). The
 * resolved conflicts are the ones the importing transaction recomputed under
 * the installation and allocation locks — exactly what the typed
 * `license.import.reduction-resolved` audit event records.
 */
export interface LicenseReductionResolutionResult extends LicenseImportResult {
  /** The version whose grant was reduced with explicit authorization. */
  resolvedPredecessorVersionId: string;
  /** The conflicts the resolution authorized (machine-readable kinds). */
  resolvedConflicts: ReductionConflict[];
}

/**
 * What the pipeline returns: the public import result plus the facts each
 * dedicated operation's receipt needs — all read from the transaction that
 * wrote them.
 */
interface LicenseImportExecution extends LicenseImportResult {
  previousCustomerId: string | null;
  previousCustomerCode: string | null;
  bindingChanged: boolean;
  /** The license governing before an explicit transfer; null otherwise. */
  previousLicenseId: string | null;
  /** Set when this transaction WAS the dedicated gap recovery. */
  recovery: ImportVersionResult['recovery'];
  /** Set when this transaction WAS a reduction resolution. */
  resolution: ImportVersionResult['resolution'];
}

/**
 * Caller-supplied intent of an import. Every intent is set ONLY by its
 * dedicated operation, each of which requires its own permission on top of
 * `Licensing.License.Activate`:
 *
 * - `customerTransfer` — the explicit installation customer transfer (Q4);
 *   without it an import whose customer differs from the installation's
 *   binding is refused (`installation-customer-mismatch`).
 * - `gapRecovery` — the dedicated post-gap recovery (OQ-87 Option B, PDR-13);
 *   without it a new-identity candidate that would start after the retained
 *   coverage end is refused
 *   (`post-gap-recovery-requires-dedicated-operation`), so ordinary import is
 *   never a post-gap recovery path.
 * - `reductionResolution` — the explicit reduction resolution (PDR-11 §8.6,
 *   L-04); without it a reduction that conflicts with current usage or the
 *   retained grant is refused with its concrete conflicts. It may accompany
 *   `gapRecovery` only through `recoverAfterGap` (L-07 / OD-LIC-05), where the
 *   same operation requires ResolveReduction as a third permission. A
 *   document, a retry or a supersession name is never this resolution.
 */
export interface LicenseImportOptions {
  customerTransfer?: CustomerTransferIntent | null;
  gapRecovery?: GapRecoveryIntent | null;
  reductionResolution?: ReductionResolutionIntent | null;
}

type ConflictOperation = 'import' | 'recovery' | 'resolution';

/**
 * One rejection reason, surfaced to the API as exactly one message and stored
 * (bounded to 60 characters) in the audit trail. `LicenseDocumentErrorReason`
 * carries the transport/authenticity reasons; the rest are installation-state
 * decisions that only the application layer can make.
 */
export type LicenseImportRejectionReason =
  | LicenseDocumentErrorReason
  | LicenseCodeErrorReason
  | 'installation-mismatch'
  | 'not-active'
  | 'expired-document'
  | 'not-yet-valid'
  | 'backdated-supersession'
  | 'duplicate-operation'
  | 'overlapping-range'
  | 'unknown-supersession'
  | 'license-binding-conflict'
  | 'customer-code-mismatch'
  | 'installation-customer-mismatch'
  | 'transfer-requires-different-customer'
  | 'transfer-requires-signed-document'
  | 'resolution-requires-signed-document'
  | 'renewal-gap'
  | 'reduction-requires-resolution'
  | 'post-gap-recovery-requires-dedicated-operation'
  | 'recovery-not-applicable'
  | 'resolution-not-applicable'
  | 'recovery-requires-signed-document';

/**
 * 409 reasons: the document is authentic but conflicts with retained state.
 * `backdated-supersession` is deliberately NOT here: like `expired-document`,
 * the defect is in the document's own temporal window relative to the import,
 * so it is answered 422 and the form asks for a re-issued document.
 *
 * `installation-customer-mismatch`, `transfer-requires-different-customer`,
 * `renewal-gap` and `reduction-requires-resolution` joined the family with the
 * Owner decisions of 2026-10-12 (Q4, OQ-80 G2, OQ-80 Option B with PDR-11
 * §8.6); PDR-14 §3.5.4 renamed the transfer refusal from the earlier
 * `transfer-not-applicable`.
 * `post-gap-recovery-requires-dedicated-operation`, `recovery-not-applicable`
 * and `resolution-not-applicable` carry the OQ-87 Option B decision (PDR-13)
 * and the L-04 resolution flow of the same date.
 * `transfer-requires-signed-document` and `recovery-requires-signed-document`
 * are the document-level siblings: the legacy text artifact can express
 * neither a customer transfer nor a recovery, so the fix is a signed
 * document (422).
 */
const CONFLICT_REASONS: ReadonlySet<LicenseImportRejectionReason> = new Set([
  'duplicate-operation',
  'overlapping-range',
  'unknown-supersession',
  'license-binding-conflict',
  'customer-code-mismatch',
  'installation-customer-mismatch',
  'transfer-requires-different-customer',
  'renewal-gap',
  'reduction-requires-resolution',
  'post-gap-recovery-requires-dedicated-operation',
  'recovery-not-applicable',
  'resolution-not-applicable',
]);

/**
 * The single import pipeline for signed license versions (L-03, ADR-0046,
 * design §4). Both transports — a `vardena-license` file envelope and a bare
 * `VLIC2` artifact — and the legacy `VLIC1` text code enter here, so there is
 * exactly one place where a license can be trusted, bound, validated and
 * persisted.
 *
 * Order of the pipeline (nothing is written until every stage passes):
 *   1. authorization — `Licensing.License.Activate` (re-checked here, AR-21);
 *   2. transport      — envelope or bare artifact;
 *   3. version        — supported payload version;
 *   4. authenticity   — Ed25519 signature against the trusted keys;
 *   5. payload        — canonical, typed, semantic shape;
 *   6. binding        — the payload names the identity THIS installation
 *                       already has (never created here);
 *   7. semantics      — active status, window not already over;
 *   8. replay         — operation id (and artifact hash) not already applied;
 *   9. conflicts      — overlap only through an explicit signed supersession,
 *                       and never a supersession that would hand over in the
 *                       past (`evaluateImportConflicts`, the ONE authority);
 *  10. persistence    — ONE transaction (customer, license, version,
 *                       entitlements, supersession stamps, audit event) that
 *                       RE-RUNS steps 8 and 9 under the per-installation
 *                       database lock before it writes (design §3.4).
 *
 * The read-side pass of steps 8/9 and the authoritative pass inside the
 * transaction share one implementation, so they cannot drift apart; the
 * transaction's verdict is the one that decides.
 *
 * Security properties that hold by construction:
 * - a rejection writes **nothing**; no state is ever replaced or deactivated by
 *   an invalid document;
 * - identifiers from an unverified document are never trusted (not even for the
 *   audit trail): only the reason and a bounded detail are recorded before the
 *   signature is verified;
 * - the raw document, its signature and any key material are never persisted —
 *   only the SHA-256 of the artifact;
 * - the private key does not exist on this side at all: the service holds public
 *   keys only, and there is no endpoint or configuration that can sign.
 */
@Injectable()
export class LicenseImportService {
  /**
   * Parsed once at startup so a malformed authority key fails the boot with a
   * clear message instead of surfacing as a server error on import.
   */
  private readonly trustedKeys: TrustedLicenseKey[];
  private readonly publicKeys: KeyObject[];

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly authorization: AuthorizationService,
    private readonly identity: InstallationIdentityService,
    private readonly licenses: LicensesRepository,
    private readonly licensing: LicensingService,
    @Inject(LICENSE_USAGE_PORT) private readonly usage: LicenseUsagePort,
    private readonly logger: JsonLogger,
  ) {
    this.trustedKeys = parseTrustedLicenseKeys(
      config.licensing.signingPublicKeys,
    );
    this.publicKeys = this.trustedKeys.map((entry) => entry.key);
  }

  /**
   * Import a signed license document (file envelope or bare artifact). Legacy
   * `VLIC1` codes are accepted through the same route for compatibility and
   * are handled by `applyLegacyCode`. This is the ORDINARY import: it carries
   * no operation intent, so it can never transfer a customer, recover a lapse
   * or resolve a reduction conflict — each of those has its own dedicated,
   * permission-gated, audited operation.
   */
  async importDocument(
    rawDocument: string,
    options: LicenseImportOptions = {},
  ): Promise<LicenseImportResult> {
    return await this.runImport(rawDocument, options);
  }

  /**
   * The dedicated post-gap recovery operation (Owner decision 2026-10-12,
   * OQ-87 Option B, PDR-13).
   *
   * This is the ONLY path that may apply a NEW license identity whose window
   * starts after the installation's retained coverage has ended. It is not a
   * new pipeline: the same import stages verify the document and the same
   * transaction applies it — with the recovery intent, which the conflict
   * authority accepts only here (and only for a candidate that really is
   * post-gap). The transaction writes the typed `license.import.recovered`
   * event (the new version, the lapsed license and its coverage end, the
   * actor, the source, the instant and the operator's reason) together with
   * the version, so a failure leaves the retained state untouched.
   *
   * A post-gap reduction is measured against the version whose effective
   * coverage ended last. If it conflicts, the caller may supply a third,
   * explicit `reductionResolutionReason`; this invokes the existing
   * ResolveReduction permission check in addition to Activate and
   * RecoverAfterGap, and both typed applied events are written atomically.
   * The lapsed predecessor is measured and audited but never superseded by the
   * recovery. A supersession target is not applicable to a post-gap recovery.
   *
   * Everything else is unchanged on purpose: the document must verify, be
   * bound to THIS installation and its current customer (a recovery never
   * transfers), pass every overlap/identity/binding rule, and a legacy `VLIC1`
   * code is refused (`recovery-requires-signed-document`) — a recovery is a
   * capability of the signed document exchange, exactly like a customer
   * transfer.
   */
  async recoverAfterGap(
    rawDocument: string,
    reason: string,
    reductionResolutionReason?: string,
  ): Promise<LicenseGapRecoveryResult> {
    assertOperationReason(reason, 'recovery');
    if (reductionResolutionReason !== undefined) {
      assertOperationReason(reductionResolutionReason, 'resolution');
    }
    const execution = await this.runImport(rawDocument, {
      gapRecovery: { reason },
      reductionResolution:
        reductionResolutionReason === undefined
          ? null
          : { reason: reductionResolutionReason },
    });
    const resolution = execution.resolution;
    return {
      changed: execution.changed,
      outcome: execution.outcome,
      license: execution.license,
      lapsedLicenseId: execution.recovery?.lapsedLicenseId ?? null,
      coverageEnd: execution.recovery?.coverageEnd?.toISOString() ?? null,
      ...(resolution === null || resolution === undefined
        ? {}
        : {
            resolvedPredecessorVersionId: resolution.predecessorVersionId,
            resolvedConflicts: [...resolution.conflicts],
          }),
    };
  }

  /**
   * The explicit reduction-resolution operation (PDR-11 §8.6, L-04).
   *
   * This is the ONLY path that may apply a version whose capacity or
   * entitlement reduction conflicts with current usage or the retained grant.
   * The caller has seen the explained conflicts (the ordinary import answers
   * 409 `reduction-requires-resolution` with the concrete limits, current
   * usage and removed entitlements); supplying an authorized, reasoned
   * resolution here applies the document AND the resolution in ONE
   * transaction, which audits the resolution as the typed
   * `license.import.reduction-resolved` event with the conflicts it actually
   * authorized — recomputed under the installation and allocation locks, so
   * the audit row can never describe conflicts the committed state did not
   * have.
   *
   * Everything else is unchanged: signature, binding, identity, overlap,
   * term rules (an open end is still closable only by an explicit signed
   * supersession — a resolution never authorizes that arm), and the
   * fail-closed behaviour for an absent, invalid or insufficient resolution.
   * A resolution request whose document does not conflict is refused
   * (`resolution-not-applicable`): an operator cannot resolve what does not
   * conflict, and retrying the same document is never a resolution.
   */
  async resolveReduction(
    rawDocument: string,
    reason: string,
  ): Promise<LicenseReductionResolutionResult> {
    assertOperationReason(reason, 'resolution');
    const execution = await this.runImport(rawDocument, {
      reductionResolution: { reason },
    });
    const resolution = execution.resolution;
    if (resolution === null || resolution === undefined) {
      // Unreachable: the domain rule refuses a resolution that never meets a
      // conflict, so any committed resolution import resolved real ones.
      throw new Error(
        'A reduction resolution committed without resolving conflicts; refusing rather than answering an empty receipt.',
      );
    }
    return {
      changed: execution.changed,
      outcome: execution.outcome,
      license: execution.license,
      resolvedPredecessorVersionId: resolution.predecessorVersionId,
      resolvedConflicts: [...resolution.conflicts],
    };
  }

  /**
   * The pipeline itself. It returns the transaction's own receipt — which
   * carries the previous customer and whether the binding changed — so the
   * transfer operation can answer with the exact facts it committed; the
   * ordinary import narrows that to `LicenseImportResult`.
   */
  private async runImport(
    rawDocument: string,
    options: LicenseImportOptions,
  ): Promise<LicenseImportExecution> {
    await this.requireActivatePermission();
    if (options.customerTransfer != null) {
      await this.requireCustomerTransferPermission();
    }
    if (options.gapRecovery != null) {
      await this.requireGapRecoveryPermission();
    }
    if (options.reductionResolution != null) {
      await this.requireResolveReductionPermission();
    }
    const now = new Date();
    // Read-only: import never creates, recreates or adopts an installation
    // identity (ADR-0046 Decision 6). The identity's commercial customer is
    // what the customer-binding rules below evaluate against: a document that
    // names another customer is refused unless the caller carries the explicit
    // transfer intent (Owner decision 2026-10-12, Q4).
    const installation = await this.identity.existingOrNull();
    const installationId = installation?.installationId ?? null;
    const installationCustomerId = installation?.customerId ?? null;
    // Read-side usage for the §8.6 pre-check (L-04). Informational only: the
    // authoritative counts are read again INSIDE the import transaction, after
    // the allocation advisory locks, so a concurrent creation can never slip
    // past the check. A counting failure here degrades to "unknown", which the
    // conflict evaluation fails closed on — never to "no conflict".
    const precheckUsage: LicenseUsageSnapshot | null =
      installationId === null
        ? null
        : await this.usage.snapshot(installationId).catch(() => null);

    let transport: {
      document: string;
      transport: 'file' | 'text';
      keyId: string | null;
    };
    try {
      transport = decodeLicenseTransport(rawDocument);
    } catch (error) {
      return this.rejectUnverified(error, installationId, 'text', now);
    }

    if (transport.document.startsWith(`${LICENSE_CODE_PREFIX}.`)) {
      // Compatibility alias: the legacy text code keeps its documented L-02
      // lifecycle semantics (see `applyLegacyCode`).
      return this.applyLegacyCode(
        transport.document,
        installationId,
        installationCustomerId,
        now,
        options,
      );
    }

    let payload: LicenseVersionPayload;
    let keyId: string;
    try {
      const verified = parseLicenseDocument(
        transport.document,
        this.trustedKeys,
        { keyId: transport.keyId },
      );
      payload = verified.payload;
      keyId = verified.keyId;
    } catch (error) {
      return this.rejectUnverified(
        error,
        installationId,
        transport.transport,
        now,
      );
    }

    const documentHash = licenseDocumentHash(transport.document);

    // 6. Installation binding. A document issued for another installation is
    //    rejected here; the client never chooses the trusted identity.
    if (installationId === null || payload.installationId !== installationId) {
      return this.rejectVerified(
        'installation-mismatch',
        {
          now,
          installationId,
          payload,
          keyId,
          source: transport.transport,
          documentHash,
        },
        installationId === null
          ? 'This installation has no identity yet, so the document cannot be bound to it. Read the current license state first and request a document for that installation id.'
          : 'This license document was issued for a different Vardena installation.',
      );
    }

    // 7. Semantics that do not depend on other versions. (Shape validation —
    //    interval order, limits, entitlement codes — already ran inside
    //    `parseLicenseDocument`; this slice does NOT compare limits against
    //    current usage — PDR-11 §8.6 is a later slice and never destructive.)
    if (payload.status !== 'ACTIVE') {
      return this.rejectVerified(
        'not-active',
        {
          now,
          installationId,
          payload,
          keyId,
          source: transport.transport,
          documentHash,
        },
        'This license version is suspended or expired and cannot be imported.',
      );
    }
    if (
      payload.validUntil !== null &&
      payload.validUntil.getTime() <= now.getTime()
    ) {
      return this.rejectVerified(
        'expired-document',
        {
          now,
          installationId,
          payload,
          keyId,
          source: transport.transport,
          documentHash,
        },
        'This license document has already ended and cannot be imported.',
      );
    }

    // 8./9. Replay and version conflicts — evaluated by the ONE authority the
    //    data layer re-runs inside the import transaction, under the
    //    per-installation lock (design §3.4). This read-side pass is a fast,
    //    informative rejection: it is the authoritative pass in
    //    `LicensesRepository.importVersion` that decides, so a concurrent
    //    import can never invalidate it silently.
    const versions = await this.licenses.listVersions(installationId);
    const customerPrecheck =
      typeof this.licenses.findCustomersForImport === 'function'
        ? await this.licenses.findCustomersForImport({
            customerId: payload.customerId,
            customerCode: payload.customerCode,
            installationCustomerId,
          })
        : { installationCustomerCode: null, knownCustomers: [] };
    const supersession: ImportSupersessionIntent =
      payload.supersedesOperationId === null
        ? { kind: 'none' }
        : { kind: 'explicit', operationId: payload.supersedesOperationId };
    const candidate: ImportCandidate = {
      validFrom: payload.validFrom,
      validUntil: payload.validUntil,
      licenseId: payload.licenseId,
      customerId: payload.customerId,
      customerCode: payload.customerCode,
      organizationLimit: payload.organizationLimit,
      userLimit: payload.userLimit,
      deviceLimit: payload.deviceLimit,
      deviceLimitSpecified: payload.deviceLimitSpecified,
      entitlements: licenseVersionEntitlements(payload),
    };
    const precheck = evaluateImportConflicts({
      candidate,
      operationId: payload.operationId,
      documentHash,
      supersession,
      versions,
      at: now,
      installationCustomerId,
      installationCustomerCode: customerPrecheck.installationCustomerCode,
      knownCustomers: customerPrecheck.knownCustomers,
      customerTransfer: options.customerTransfer ?? null,
      usage: precheckUsage,
      gapRecovery: options.gapRecovery ?? null,
      reductionResolution: options.reductionResolution ?? null,
    });
    if (precheck.conflict !== null) {
      return this.rejectVerified(
        precheck.conflict.reason,
        {
          now,
          installationId,
          payload,
          keyId,
          source: transport.transport,
          documentHash,
        },
        documentConflictMessage(precheck.conflict, conflictOperation(options)),
        precheck.conflict.overlapping,
        precheck.conflict.reduction,
      );
    }
    const supersedes = precheck.supersedes;

    // 10. Persist as ONE transaction (which re-runs the evaluation above under
    //     the installation lock before it writes anything).
    const execution = await this.persist(
      {
        installationId,
        payload,
        keyId,
        source: transport.transport,
        documentHash,
        supersession,
        supersedes,
        now,
        customerTransfer: options.customerTransfer ?? null,
        gapRecovery: options.gapRecovery ?? null,
        reductionResolution: options.reductionResolution ?? null,
        readUsage: () => this.usage.snapshot(installationId!),
      },
      executionEventType(options),
    );

    if (execution.bindingChanged) {
      this.logger.log(
        'Installation customer transferred',
        {
          installationId,
          previousCustomerId: execution.previousCustomerId,
          customerId: execution.version.customerId,
          operationId: execution.version.operationId,
        },
        LicenseImportService.name,
      );
    }

    this.logger.log(
      'License version imported',
      {
        installationId,
        licenseId: execution.version.licenseId,
        versionId: execution.version.versionId,
        keyId,
        supersededVersionId: supersedes?.versionId ?? null,
        operation:
          options.gapRecovery != null
            ? options.reductionResolution != null
              ? 'gap-recovery-with-reduction-resolution'
              : 'gap-recovery'
            : options.reductionResolution != null
              ? 'reduction-resolution'
              : 'import',
      },
      LicenseImportService.name,
    );

    return {
      changed: true,
      outcome: 'APPLIED',
      license: await this.licensing.current(now),
      previousCustomerId: execution.previousCustomerId,
      previousCustomerCode: execution.previousCustomerCode,
      bindingChanged: execution.bindingChanged,
      previousLicenseId: execution.previousLicenseId,
      recovery: execution.recovery,
      resolution: execution.resolution,
    };
  }

  /**
   * The explicit, audited installation customer transfer (Owner decision
   * 2026-10-12, Q4).
   *
   * This is the ONLY path that may change which commercial customer an
   * installation belongs to. It is not a new pipeline: the same import stages
   * verify the document and the same transaction applies it — with the
   * customer-transfer intent, which the conflict authority accepts only here
   * (and only when the transfer would actually change the binding). The
   * transaction writes the typed `license.installation.customer-transferred`
   * event (old customer, new customer, installation, operation, actor, source,
   * timestamp, outcome and the operator's reason) *and* the binding change
   * together, so a failure leaves the previous binding and retained license
   * state untouched.
   *
   * A document that merely names a different customer is still not a transfer:
   * on the normal import path that is refused as
   * `installation-customer-mismatch`, and a transfer request that names the
   * customer the installation already has is refused as
   * `transfer-requires-different-customer` (PDR-14 §3.5.4: nothing to
   * transfer; the document can be imported normally instead).
   */
  async transferCustomer(
    rawDocument: string,
    reason: string,
  ): Promise<LicenseCustomerTransferResult> {
    assertOperationReason(reason, 'transfer');
    const execution = await this.runImport(rawDocument, {
      customerTransfer: { reason },
    });
    return {
      changed: execution.changed,
      outcome: execution.outcome,
      license: execution.license,
      previousCustomerId: execution.previousCustomerId,
      previousCustomerCode: execution.previousCustomerCode,
      previousLicenseId: execution.previousLicenseId,
      bindingChanged: execution.bindingChanged,
      // PDR-14 §3.5.4: the operator reason is part of the receipt. The trimmed
      // form is returned because that is exactly what the typed audit event
      // recorded, so the receipt can never disagree with the trail.
      reason: reason.trim(),
    };
  }

  /**
   * The legacy `VLIC1` text code (L-02 compatibility alias inside the same
   * pipeline). Its documented lifecycle semantics are preserved exactly:
   * the code must be active *now* (an expired or not-yet-valid code is still
   * refused), re-submitting the same code is an idempotent no-op, and a
   * different valid code replaces the version that governs at that moment.
   *
   * The lifecycle rule is why CF-2 is fixed for signed documents only: a
   * future-dated renewal must be delivered as a v2 document, which is the
   * primary transport. Behaviour for legacy codes is not silently changed.
   */
  private async applyLegacyCode(
    rawCode: string,
    installationId: string | null,
    installationCustomerId: string | null,
    now: Date,
    options: LicenseImportOptions,
  ): Promise<LicenseImportExecution> {
    const customerTransfer = options.customerTransfer ?? null;
    const gapRecovery = options.gapRecovery ?? null;
    const reductionResolution = options.reductionResolution ?? null;
    // Read-side usage for the §8.6 pre-check on the legacy path (L-04);
    // informational only — the transaction re-reads under the locks.
    const precheckUsage: LicenseUsageSnapshot | null =
      installationId === null
        ? null
        : await this.usage.snapshot(installationId).catch(() => null);
    let payload: LicensePayload;
    try {
      payload = parseLicenseCode(rawCode.trim(), this.publicKeys);
    } catch (error) {
      return this.rejectUnverified(error, installationId, 'legacy-code', now);
    }
    const documentHash = licenseCodeHash(rawCode.trim());

    if (installationId === null || payload.installationId !== installationId) {
      return this.rejectLegacy(
        'installation-mismatch',
        { now, installationId, payload, source: 'legacy-code', documentHash },
        installationId === null
          ? 'This installation has no identity yet, so the license code cannot be bound to it.'
          : 'This license code was issued for a different Vardena installation.',
      );
    }

    // A customer transfer is a capability of the signed document exchange: the
    // legacy text code keeps its documented L-02 semantics and gains none, so a
    // transfer request carrying one is refused with a document-level verdict
    // rather than silently applied. Post-gap recovery is the same kind of
    // capability (OQ-87 Option B, PDR-13) and is refused for the same reason.
    if (customerTransfer !== null) {
      return this.rejectLegacy(
        'transfer-requires-signed-document',
        { now, installationId, payload, source: 'legacy-code', documentHash },
        'A customer transfer requires a signed license document; the legacy text code cannot express one. Issue the transfer as a signed document.',
      );
    }
    if (gapRecovery !== null) {
      return this.rejectLegacy(
        'recovery-requires-signed-document',
        { now, installationId, payload, source: 'legacy-code', documentHash },
        'A post-gap recovery requires a signed license document; the legacy text code cannot carry one. Issue the recovery as a signed document.',
      );
    }
    if (reductionResolution !== null) {
      return this.rejectLegacy(
        'resolution-requires-signed-document',
        { now, installationId, payload, source: 'legacy-code', documentHash },
        'A reduction resolution requires a signed license document; the legacy text code cannot carry one and the resolution must name, through the verified payload, the version it takes over. Apply the reduction with a signed document through the resolution operation.',
      );
    }

    // Documented L-02 lifecycle: evaluate exactly as the read path does.
    const evaluation = this.licensing.evaluate(
      legacyToInstallationLicense(payload, PERSISTENT_LICENSE_PROVIDER_NAME),
      now,
    );
    if (!evaluation.active) {
      const reason: LicenseImportRejectionReason =
        evaluation.inactiveReason === 'expired'
          ? 'expired-document'
          : evaluation.inactiveReason === 'not-yet-valid'
            ? 'not-yet-valid'
            : 'not-active';
      return this.rejectLegacy(
        reason,
        { now, installationId, payload, source: 'legacy-code', documentHash },
        legacyInactiveMessage(evaluation.inactiveReason),
      );
    }

    // Idempotency by artifact hash, exactly as L-02 stored `code_hash`. The
    // no-op is only honest while that code is still what governs: a retained
    // but superseded code cannot be re-applied, because a retained version's
    // eligibility is never silently rewritten.
    const versions = await this.licenses.listVersions(installationId);
    const resolved = resolveEffectiveVersion(versions, now);
    const existing = versions.find(
      (version) => version.operationId === legacyOperationId(documentHash),
    );
    if (
      existing !== undefined &&
      resolved.version?.versionId === existing.versionId
    ) {
      await this.recordAudit({
        installationId,
        eventType: 'license.import.unchanged',
        outcome: 'UNCHANGED',
        operationId: existing.operationId,
        licenseId: existing.licenseId,
        versionId: existing.versionId,
        actorId: getPrincipal()?.userId ?? null,
        source: 'legacy-code',
        documentHash,
        reason: null,
        detail: 'the submitted code is already the governing version',
        occurredAt: now,
      });
      return {
        changed: false,
        outcome: 'UNCHANGED',
        license: await this.licensing.current(now),
        previousCustomerId: null,
        previousCustomerCode: null,
        bindingChanged: false,
        previousLicenseId: null,
        recovery: null,
        resolution: null,
      };
    }
    if (existing !== undefined) {
      return this.rejectLegacy(
        'duplicate-operation',
        { now, installationId, payload, source: 'legacy-code', documentHash },
        'This license code has already been imported and is retained; it is no longer the version that governs.',
      );
    }

    // Replacement semantics for the version that governs now. A text code
    // cannot express WHICH version it replaces, so it may overlap at most one
    // still-governing version that has no recorded supersession; anything else
    // is refused rather than guessed (fail-closed; same authority as v2 —
    // `evaluateImportConflicts`, re-run under the lock inside the transaction).
    const customerPrecheck =
      typeof this.licenses.findCustomersForImport === 'function'
        ? await this.licenses.findCustomersForImport({
            customerId: payload.customerId,
            customerCode: payload.customerCode,
            installationCustomerId,
          })
        : { installationCustomerCode: null, knownCustomers: [] };
    const supersession: ImportSupersessionIntent = { kind: 'implicit' };
    const precheck = evaluateImportConflicts({
      candidate: {
        validFrom: payload.validFrom,
        validUntil: payload.validUntil,
        licenseId: payload.licenseId,
        customerId: payload.customerId,
        customerCode: payload.customerCode,
        organizationLimit: payload.organizationLimit,
        userLimit: payload.userLimit,
        deviceLimit: payload.deviceLimit,
        deviceLimitSpecified: payload.deviceLimitSpecified,
        entitlements: legacyEntitlements(payload),
      },
      operationId: legacyOperationId(documentHash),
      documentHash,
      supersession,
      versions,
      at: now,
      installationCustomerId,
      installationCustomerCode: customerPrecheck.installationCustomerCode,
      knownCustomers: customerPrecheck.knownCustomers,
      customerTransfer: null,
      usage: precheckUsage,
    });
    if (precheck.conflict !== null) {
      return this.rejectLegacy(
        precheck.conflict.reason,
        { now, installationId, payload, source: 'legacy-code', documentHash },
        legacyConflictMessage(precheck.conflict),
        precheck.conflict.overlapping,
        precheck.conflict.reduction,
      );
    }
    const supersedes = precheck.supersedes;

    const execution = await this.persist(
      {
        installationId,
        payload,
        keyId: null,
        source: 'legacy-code',
        documentHash,
        supersession,
        supersedes,
        now,
        customerTransfer: null,
        gapRecovery: null,
        reductionResolution: null,
        readUsage: () => this.usage.snapshot(installationId!),
        legacy: true,
      },
      'license.import.applied',
    );

    if (execution.bindingChanged) {
      this.logger.log(
        'Installation customer transferred',
        {
          installationId,
          previousCustomerId: execution.previousCustomerId,
          customerId: execution.version.customerId,
          operationId: execution.version.operationId,
        },
        LicenseImportService.name,
      );
    }

    this.logger.log(
      'Legacy license code activated',
      {
        installationId,
        licenseId: execution.version.licenseId,
        versionId: execution.version.versionId,
        supersededVersionId: supersedes?.versionId ?? null,
      },
      LicenseImportService.name,
    );

    return {
      changed: true,
      outcome: 'APPLIED',
      license: await this.licensing.current(now),
      previousCustomerId: execution.previousCustomerId,
      previousCustomerCode: execution.previousCustomerCode,
      bindingChanged: execution.bindingChanged,
      previousLicenseId: execution.previousLicenseId,
      recovery: execution.recovery,
      resolution: execution.resolution,
    };
  }

  /**
   * The transactional write. A concurrent import that already applied this
   * operation (or retired the supersession target) surfaces as a conflict —
   * the database constraints are the authority, not the read-side pre-check.
   */
  private async persist(
    context: {
      installationId: string;
      payload: LicenseVersionPayload | LicensePayload;
      keyId: string | null;
      source: LicenseVersionSource;
      documentHash: string;
      /** What the artifact declares about the version it replaces. */
      supersession: ImportSupersessionIntent;
      /** Resolved by the read-side pass; the transaction must retire exactly it. */
      supersedes: RetainedLicenseVersion | null;
      now: Date;
      /** Explicit transfer intent; audited by the transaction that applies it. */
      customerTransfer: CustomerTransferIntent | null;
      /** Dedicated recovery intent; its APPLIED event is built in-transaction. */
      gapRecovery: GapRecoveryIntent | null;
      /** Dedicated resolution intent; its APPLIED event is built in-transaction. */
      reductionResolution: ReductionResolutionIntent | null;
      /** §8.6 usage read, run inside the transaction after the locks (L-04). */
      readUsage: () => Promise<LicenseUsageSnapshot>;
      legacy?: boolean;
    },
    eventType: string,
  ): Promise<ImportVersionResult> {
    const legacy = context.legacy === true;
    const operationId = legacy
      ? legacyOperationId(context.documentHash)
      : (context.payload as LicenseVersionPayload).operationId;
    const entitlements = legacy
      ? legacyEntitlements(context.payload as LicensePayload)
      : licenseVersionEntitlements(context.payload as LicenseVersionPayload);
    const versionId = generateId();
    // A signed document that names no supersession but was accepted because it
    // starts later than the version it overlaps hands over under OQ-80 Option B;
    // the hand-over is stamped exactly like an explicit one and the audit row
    // records that it was the precedence rule, not a signed instruction.
    const implicitPrecedence =
      context.supersession.kind === 'none' && context.supersedes !== null;
    // Dedicated operation APPLIED events are built by the transaction from
    // the locked state (the lapsed license for a recovery, the resolved
    // conflicts for a resolution). A combined recovery/resolution writes both
    // typed events there. The service supplies no generic applied event on
    // these paths — only a supersession stamp it can already name.
    const dedicated =
      context.gapRecovery !== null || context.reductionResolution !== null;
    try {
      return await this.licenses.importVersion({
        installationId: context.installationId,
        actorId: getPrincipal()?.userId ?? null,
        now: context.now,
        licenseId: context.payload.licenseId,
        customerId: context.payload.customerId,
        customerCode: context.payload.customerCode,
        customerName: context.payload.customerName,
        versionId,
        operationId,
        status: context.payload.status,
        provider: PERSISTENT_LICENSE_PROVIDER_NAME,
        documentVersion: context.payload.version,
        documentHash: context.documentHash,
        keyId: context.keyId,
        source: context.source,
        validFrom: context.payload.validFrom,
        validUntil: context.payload.validUntil,
        organizationLimit: context.payload.organizationLimit,
        userLimit: context.payload.userLimit,
        deviceLimit: context.payload.deviceLimit,
        deviceLimitSpecified: context.payload.deviceLimitSpecified,
        entitlements,
        supersession: context.supersession,
        customerTransfer: context.customerTransfer,
        gapRecovery: context.gapRecovery,
        reductionResolution: context.reductionResolution,
        readUsage: context.readUsage,
        expectedSupersessionVersionId: context.supersedes?.versionId ?? null,
        auditEvents: [
          ...(context.supersedes === null
            ? []
            : [
                supersededAuditEvent(
                  context.supersedes,
                  context.source,
                  context.now,
                  implicitPrecedence,
                ),
              ]),
          ...(dedicated
            ? []
            : [
                {
                  installationId: context.installationId,
                  eventType,
                  outcome: 'APPLIED' as const,
                  operationId,
                  licenseId: context.payload.licenseId,
                  versionId,
                  actorId: getPrincipal()?.userId ?? null,
                  source: context.source,
                  documentHash: context.documentHash,
                  reason: null,
                  detail:
                    context.supersedes === null
                      ? null
                      : implicitPrecedence
                        ? 'superseded a retained version under the later-start precedence rule (OQ-80 Option B)'
                        : 'superseded a retained version',
                  occurredAt: context.now,
                },
              ]),
        ],
      });
    } catch (error) {
      if (error instanceof ImportConflictError) {
        return this.rejectAppliedConflict(
          error.conflict.reason,
          {
            installationId: context.installationId,
            licenseId: context.payload.licenseId,
            operationId,
            documentHash: context.documentHash,
            source: context.source,
            now: context.now,
          },
          conflictLostRaceMessage(
            error.conflict,
            legacy,
            context.gapRecovery !== null
              ? 'recovery'
              : context.reductionResolution !== null
                ? 'resolution'
                : 'import',
          ),
          error.conflict.overlapping,
          error.conflict.reduction,
        );
      }
      // Only the version's own identity constraints (operation id, artifact hash)
      // are a replay. Any other unique violation is not a duplicate and must not
      // be reported as one: a license identifier claimed concurrently is refused
      // inside the transaction (`license-binding-conflict`), and anything else is
      // an unexpected database error that surfaces as one.
      if (
        isUniqueViolation(error) &&
        uniqueViolationTouches(error, ['operation', 'document'])
      ) {
        return this.rejectAppliedConflict(
          'duplicate-operation',
          {
            installationId: context.installationId,
            licenseId: context.payload.licenseId,
            operationId,
            documentHash: context.documentHash,
            source: context.source,
            now: context.now,
          },
          'This license version has already been imported.',
        );
      }
      throw error;
    }
  }

  /**
   * A conflict discovered by the database during the write (a concurrent
   * import won the race). It is audited like any other rejection — the
   * document verified, so its identity is trusted — and never surfaces as an
   * unhandled error.
   */
  private async rejectAppliedConflict(
    reason: LicenseImportRejectionReason,
    context: {
      installationId: string;
      licenseId: string;
      operationId: string;
      documentHash: string;
      source: string;
      now: Date;
    },
    message: string,
    overlapCount?: number,
    reduction?: ImportConflict['reduction'],
  ): Promise<never> {
    await this.recordAudit({
      installationId: context.installationId,
      eventType: 'license.import.rejected',
      outcome: 'REJECTED',
      operationId: context.operationId,
      licenseId: context.licenseId,
      versionId: null,
      actorId: getPrincipal()?.userId ?? null,
      source: context.source,
      documentHash: context.documentHash,
      reason,
      detail: message,
      occurredAt: context.now,
    });
    this.logger.warn(
      'License import refused inside the import transaction',
      {
        reason,
        installationId: context.installationId,
        source: context.source,
        ...(overlapCount === undefined ? {} : { overlapping: overlapCount }),
      },
      LicenseImportService.name,
    );
    throw rejectionException(reason, message, reduction);
  }

  /** Rejection before the document verified: no identifier is trusted. */
  private async rejectUnverified(
    error: unknown,
    installationId: string | null,
    source: string,
    now: Date,
  ): Promise<never> {
    const reason = rejectionReasonOf(error);
    const message = rejectionMessage(error, reason);
    await this.recordAudit({
      installationId,
      eventType: 'license.import.rejected',
      outcome: 'REJECTED',
      operationId: null,
      licenseId: null,
      versionId: null,
      actorId: getPrincipal()?.userId ?? null,
      source,
      // Nothing about an unverified submission is recorded — not even a hash
      // of it. Only the reason and the bounded detail are kept.
      documentHash: null,
      reason,
      detail: message,
      occurredAt: now,
    });
    this.logger.warn(
      'License import rejected',
      { reason, installationId, source },
      LicenseImportService.name,
    );
    throw rejectionException(reason, message);
  }

  /** Rejection after the signature verified: identity is trusted and recorded. */
  private async rejectVerified(
    reason: LicenseImportRejectionReason,
    context: {
      now: Date;
      installationId: string | null;
      payload: LicenseVersionPayload;
      keyId: string;
      source: string;
      documentHash: string;
    },
    message: string,
    overlapCount?: number,
    reduction?: ImportConflict['reduction'],
  ): Promise<never> {
    await this.recordAudit({
      installationId: context.installationId,
      eventType: 'license.import.rejected',
      outcome: 'REJECTED',
      operationId: context.payload.operationId,
      licenseId: context.payload.licenseId,
      versionId: null,
      actorId: getPrincipal()?.userId ?? null,
      source: context.source,
      documentHash: context.documentHash,
      reason,
      detail: message,
      occurredAt: context.now,
    });
    this.logger.warn(
      'License import rejected',
      {
        reason,
        installationId: context.installationId,
        operationId: context.payload.operationId,
        keyId: context.keyId,
        source: context.source,
        ...(overlapCount === undefined ? {} : { overlapping: overlapCount }),
      },
      LicenseImportService.name,
    );
    throw rejectionException(reason, message, reduction);
  }

  /** Legacy rejection helper: the code verified, so its identity is trusted. */
  private async rejectLegacy(
    reason: LicenseImportRejectionReason,
    context: {
      now: Date;
      installationId: string | null;
      payload: LicensePayload;
      source: string;
      documentHash: string;
    },
    message: string,
    overlapCount?: number,
    reduction?: ImportConflict['reduction'],
  ): Promise<never> {
    await this.recordAudit({
      installationId: context.installationId,
      eventType: 'license.import.rejected',
      outcome: 'REJECTED',
      operationId: legacyOperationId(context.documentHash),
      licenseId: context.payload.licenseId,
      versionId: null,
      actorId: getPrincipal()?.userId ?? null,
      source: context.source,
      documentHash: context.documentHash,
      reason,
      detail: message,
      occurredAt: context.now,
    });
    this.logger.warn(
      'License activation rejected',
      {
        reason,
        installationId: context.installationId,
        licenseId: context.payload.licenseId,
        ...(overlapCount === undefined ? {} : { overlapping: overlapCount }),
      },
      LicenseImportService.name,
    );
    throw rejectionException(reason, message, reduction);
  }

  /**
   * Append an audit event. Auditing a *rejection* is best-effort by design: if
   * the trail cannot be written, the rejection still happens (the caller is
   * about to throw anyway) and the failure is logged — never silently dropped,
   * and never allowed to mask the rejection itself. An installation without an
   * identity has no row to attribute the event to, so it is logged only.
   */
  private async recordAudit(event: AuditAttempt): Promise<void> {
    if (event.installationId === null) {
      this.logger.warn(
        'Licensing audit event has no installation to attribute it to',
        { eventType: event.eventType, outcome: event.outcome },
        LicenseImportService.name,
      );
      return;
    }
    try {
      await this.licenses.recordAuditEvent({
        ...event,
        installationId: event.installationId,
      });
    } catch (error) {
      this.logger.error(
        'Failed to record a licensing audit event',
        {
          eventType: event.eventType,
          outcome: event.outcome,
          reason: (error as Error).message,
        },
        LicenseImportService.name,
      );
    }
  }

  private async requireActivatePermission(): Promise<void> {
    await this.authorization.requireAllPermissions([
      LICENSING_PERMISSIONS.LICENSE_ACTIVATE,
    ]);
  }

  /**
   * The transfer authority (Owner decision 2026-10-12, Q4). Re-checked in the
   * application service (AR-21) so no caller — a controller, a worker, a future
   * scheduler — can reach the operation without holding it, and every caller
   * still needs `Licensing.License.Activate` as well.
   */
  private async requireCustomerTransferPermission(): Promise<void> {
    await this.authorization.requireAllPermissions([
      LICENSING_PERMISSIONS.LICENSE_ACTIVATE,
      LICENSING_PERMISSIONS.INSTALLATION_TRANSFER_CUSTOMER,
    ]);
  }

  /**
   * The post-gap recovery authority (Owner decision 2026-10-12, OQ-87 Option
   * B, PDR-13). Re-checked in the application service (AR-21) so no caller —
   * a controller, a worker, a future scheduler — can reach the operation
   * without holding it, and every caller still needs
   * `Licensing.License.Activate` as well.
   */
  private async requireGapRecoveryPermission(): Promise<void> {
    await this.authorization.requireAllPermissions([
      LICENSING_PERMISSIONS.LICENSE_ACTIVATE,
      LICENSING_PERMISSIONS.INSTALLATION_RECOVER_AFTER_GAP,
    ]);
  }

  /**
   * The reduction-resolution authority (PDR-11 §8.6, L-04). Re-checked in the
   * application service (AR-21) like every other operation permission: no
   * document field, no retry and no supersession name can act as this
   * authorization.
   */
  private async requireResolveReductionPermission(): Promise<void> {
    await this.authorization.requireAllPermissions([
      LICENSING_PERMISSIONS.LICENSE_ACTIVATE,
      LICENSING_PERMISSIONS.LICENSE_RESOLVE_REDUCTION,
    ]);
  }
}

/**
 * The required, validated operator reason of a dedicated operation. The DTO
 * validates the shape; this re-checks the 3–500 character boundary at the
 * application layer so a non-HTTP caller (a worker, a future scheduler) cannot
 * bypass it — an unexplained operation is not auditable, and the Owner
 * decision requires the reason.
 */
function assertOperationReason(reason: string, operation: string): void {
  if (
    typeof reason !== 'string' ||
    operationReasonLength(reason.trim()) < 3 ||
    operationReasonLength(reason) > 500
  ) {
    throw AppException.badRequest(
      `A ${operation} reason between 3 and 500 characters is required.`,
    );
  }
}

/** Match class-validator's Unicode character counting for @MinLength/@MaxLength. */
function operationReasonLength(value: string): number {
  const presentationSequences =
    value.match(/[^\uFE0F\uFE0E][\uFE0F\uFE0E]/g) ?? [];
  const surrogatePairs = value.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g) ?? [];
  return value.length - presentationSequences.length - surrogatePairs.length;
}

/** The human-facing conflict context, kept distinct for combined operations. */
function conflictOperation(options: LicenseImportOptions): ConflictOperation {
  if (options.gapRecovery != null) return 'recovery';
  if (options.reductionResolution != null) return 'resolution';
  return 'import';
}

/** The audit event type of an applied import, by operation kind. */
function executionEventType(options: LicenseImportOptions): string {
  if (options.gapRecovery != null) return 'license.import.recovered';
  if (options.reductionResolution != null) {
    return 'license.import.reduction-resolved';
  }
  return 'license.import.applied';
}

/** Entitlements of a legacy payload in the retained-version shape. */
function legacyEntitlements(payload: LicensePayload): LicenseEntitlement[] {
  return [
    ...payload.moduleEntitlements.map((code) => ({
      kind: 'MODULE' as const,
      code,
    })),
    ...payload.featureEntitlements.map((code) => ({
      kind: 'FEATURE' as const,
      code,
    })),
  ];
}

/** Deterministic operation identity of a legacy text code. */
export function legacyOperationId(documentHash: string): string {
  return `legacy-code:${documentHash}`;
}

/**
 * The retirement of a retained version, in the typed audit trail.
 *
 * `reason` carries the machine-readable hand-over mode for an applied event:
 * `'implicit-precedence'` for the OQ-80 Option B hand-over (the document named
 * no predecessor; the later start governs) and `null` for an explicit, signed
 * supersession. That is what makes the two distinguishable in the trail — the
 * event type alone cannot answer whether an operator instructed the retirement
 * or the precedence rule applied it.
 */
function supersededAuditEvent(
  superseded: RetainedLicenseVersion,
  source: string,
  now: Date,
  implicitPrecedence: boolean,
): LicenseAuditEventCommand {
  return {
    installationId: superseded.installationId,
    eventType: 'license.version.superseded',
    outcome: 'APPLIED',
    operationId: superseded.operationId,
    licenseId: superseded.licenseId,
    versionId: superseded.versionId,
    actorId: getPrincipal()?.userId ?? null,
    source,
    documentHash: null,
    reason: implicitPrecedence ? 'implicit-precedence' : null,
    detail: implicitPrecedence
      ? 'superseded by a later-starting version, which governs from its own validFrom (OQ-80 Option B)'
      : 'superseded by a later imported version',
    occurredAt: now,
  };
}

function rejectionReasonOf(error: unknown): LicenseImportRejectionReason {
  if (error instanceof LicenseDocumentError) return error.reason;
  if (error instanceof LicenseCodeError) return error.reason;
  return 'malformed';
}

function rejectionMessage(
  error: unknown,
  reason: LicenseImportRejectionReason,
): string {
  if (
    error instanceof LicenseDocumentError ||
    error instanceof LicenseCodeError
  ) {
    return error.message;
  }
  // A non-license error is a bug, not a verdict — but the client still gets a
  // stable, non-revealing answer while the failure is logged above.
  return `The license document could not be read (${reason}).`;
}

function legacyInactiveMessage(
  reason: EvaluatedLicense['inactiveReason'],
): string {
  switch (reason) {
    case 'expired':
      return 'This license code has expired and cannot be activated.';
    case 'not-yet-valid':
      return 'This license code is not valid yet and cannot be activated.';
    case 'status':
      return 'This license code is suspended or revoked and cannot be activated.';
    default:
      return 'This license code cannot be activated.';
  }
}

/**
 * The 409 message of each conflict reason for a SIGNED document. Stable
 * wording: the frontend maps the machine-readable `reason`, operators read the
 * message.
 */
function documentConflictMessage(
  conflict: ImportConflict,
  operation: ConflictOperation,
): string {
  switch (conflict.reason) {
    case 'duplicate-operation':
      return 'This license version has already been imported.';
    case 'unknown-supersession':
      return 'The license version this document retires is not a retained, eligible version of this installation.';
    case 'overlapping-range':
      return 'This license version overlaps a retained version, including versions that have already been retired, and does not start later than the version it would take over. Issue a document that starts later and takes it over, that explicitly retires it, or a non-overlapping renewal.';
    case 'license-binding-conflict':
      return LICENSE_BINDING_CONFLICT_MESSAGE;
    case 'customer-code-mismatch':
      return CUSTOMER_CODE_MISMATCH_MESSAGE;
    case 'backdated-supersession':
      return 'This license version would retire the version it names from an instant that is already in the past, which would rewrite which version governed then. Issue the document with a start that has not yet passed, or after the version it retires has ended.';
    case 'installation-customer-mismatch':
      return INSTALLATION_CUSTOMER_MISMATCH_MESSAGE;
    case 'transfer-requires-different-customer':
      return TRANSFER_REQUIRES_DIFFERENT_CUSTOMER_MESSAGE;
    case 'renewal-gap':
      return 'This renewal would start after the license it renews has ended, leaving a gap in coverage. Issue the renewal to start at or before the end of the version it follows.';
    case 'reduction-requires-resolution':
      if (operation === 'recovery') {
        return 'This post-gap recovery reduces capacity or entitlements in conflict with current usage or the lapsed grant; the concrete conflicts are in the response details. Nothing was changed. To authorize this reduction, retry the same dedicated gap-recovery operation with a reductionResolutionReason and hold Activate, RecoverAfterGap, and ResolveReduction permissions. Do not submit this post-gap document to the separate reduction-resolution route.';
      }
      return 'This version reduces the modules or capacity of the version it retires or takes over, and the reduction conflicts with current usage or the retained grant — the concrete limits, usage and entitlements are in the conflict details. Nothing was changed. A reduction may be applied only through the dedicated resolution operation (its own permission, a recorded reason); an open end is never operator-resolvable.';
    case 'post-gap-recovery-requires-dedicated-operation':
      return "This license document carries a new license identity and would start after this installation's license coverage has already ended, which makes it a post-gap recovery. Post-gap recovery is permitted only through the dedicated recovery operation, which requires its own permission and a recorded reason. Nothing was changed.";
    case 'recovery-not-applicable':
      if (operation === 'recovery') {
        return 'This document cannot be applied as a post-gap recovery in the current retained state. A recovery requires a new license identity, a start strictly after ended coverage, and no supersession target; correct and reissue the signed document. If coverage has not lapsed, use ordinary import instead. Nothing was changed.';
      }
      return RECOVERY_NOT_APPLICABLE_MESSAGE;
    case 'resolution-not-applicable':
      if (operation === 'recovery') {
        return 'This recovery has no capacity or entitlement conflict to resolve. Retry the dedicated gap-recovery operation without a reductionResolutionReason. Nothing was changed.';
      }
      return RESOLUTION_NOT_APPLICABLE_MESSAGE;
  }
}

/**
 * A license identifier is bound to a different customer or installation. Shared
 * by the signed and the legacy wording: the binding is the same fact for both.
 * Nothing is written; the commercial identity is never re-bound by an import.
 */
const LICENSE_BINDING_CONFLICT_MESSAGE =
  'This license identifier is already bound to a different customer or installation, so the document cannot add a version to it. Nothing was changed.';

/**
 * The signed `(customerId, customerCode)` pair disagrees with a persisted or
 * retained customer record (L-06, PDR-14 / OD-LIC-03). Either `customerId` is
 * already bound to a different `customerCode`, or `customerCode` is already
 * bound to a different `customerId`.
 */
const CUSTOMER_CODE_MISMATCH_MESSAGE =
  'This license document carries a customer code that does not match the customer record (either the customer id is already bound to a different customer code, or the customer code belongs to a different customer id). Nothing was changed.';

/**
 * The installation-level binding (Owner decision 2026-10-12, Q4). Distinct from
 * the license-identifier binding above: this document is for another customer
 * than the one this installation belongs to, and an import never moves an
 * installation between customers.
 */
const INSTALLATION_CUSTOMER_MISMATCH_MESSAGE =
  'This license document belongs to a different customer than this installation is bound to, and importing a license never changes that binding. Nothing was changed. A customer transfer is a separate, explicitly authorized operation.';

/** A transfer request whose target is the customer the installation already has. */
const TRANSFER_REQUIRES_DIFFERENT_CUSTOMER_MESSAGE =
  'This installation is already bound to the customer this transfer names, so there is nothing to transfer. Import the document instead.';

/**
 * A recovery request whose candidate is not a post-gap one (OQ-87 Option B,
 * PDR-13): coverage has not lapsed, so there is nothing to recover. Mirrors
 * `transfer-requires-different-customer`: a repeat or a concurrent recovery
 * of live coverage refuses instead of silently re-applying.
 */
const RECOVERY_NOT_APPLICABLE_MESSAGE =
  'The license coverage of this installation has not lapsed, so there is nothing to recover. Import this document through the ordinary import instead.';

/**
 * A resolution request whose document does not conflict with current usage or
 * the retained grant (L-04): there is no reduction to resolve, and retrying a
 * document is never a resolution.
 */
const RESOLUTION_NOT_APPLICABLE_MESSAGE =
  'This document does not conflict with current usage or the retained grant, so there is no capacity or entitlement reduction to resolve. Import this document through the ordinary import instead.';

/** The legacy-code wording of the same conflicts (L-02 vocabulary). */
function legacyConflictMessage(conflict: ImportConflict): string {
  switch (conflict.reason) {
    case 'duplicate-operation':
      return 'This license code has already been imported and is retained; it is no longer the version that governs.';
    case 'unknown-supersession':
      return 'This license code cannot replace the version it overlaps.';
    case 'overlapping-range':
      return 'This license code overlaps more than one retained version, or a version that is already retired, and cannot be applied.';
    case 'license-binding-conflict':
      return LICENSE_BINDING_CONFLICT_MESSAGE;
    case 'customer-code-mismatch':
      return CUSTOMER_CODE_MISMATCH_MESSAGE;
    case 'backdated-supersession':
      return 'This license code would replace the current version from an instant that is already in the past, which would rewrite which version governed then. Start the code at or after the end of the version it follows, or retire that version with a signed document whose start has not yet passed.';
    case 'installation-customer-mismatch':
      return INSTALLATION_CUSTOMER_MISMATCH_MESSAGE;
    case 'transfer-requires-different-customer':
      return TRANSFER_REQUIRES_DIFFERENT_CUSTOMER_MESSAGE;
    case 'renewal-gap':
      return 'This license code would start after the license it renews has ended, leaving a gap in coverage. Start the code at or before the end of the version it follows.';
    case 'reduction-requires-resolution':
      return 'This license code would reduce the modules or capacity of the version it replaces, and the reduction conflicts with current usage or the retained grant — the concrete limits, usage and entitlements are in the conflict details. Nothing was changed. A reduction may be applied only through the dedicated resolution operation, which requires its own permission and a recorded reason.';
    case 'post-gap-recovery-requires-dedicated-operation':
      return "This license code carries a new license identity and would start after this installation's license coverage has already ended, which makes it a post-gap recovery. Post-gap recovery is permitted only through the dedicated recovery operation with a signed license document. Nothing was changed.";
    case 'recovery-not-applicable':
      return RECOVERY_NOT_APPLICABLE_MESSAGE;
    case 'resolution-not-applicable':
      return RESOLUTION_NOT_APPLICABLE_MESSAGE;
  }
}

/**
 * The message of a conflict the transaction discovered (the read-side pass
 * passed, then a concurrent import committed first). Same reasons, phrased for
 * the loser of the race.
 */
function conflictLostRaceMessage(
  conflict: ImportConflict,
  legacy: boolean,
  operation: ConflictOperation,
): string {
  if (conflict.reason === 'duplicate-operation') {
    return legacy
      ? 'This license code has already been imported and is retained; it is no longer the version that governs.'
      : 'This license version has already been imported.';
  }
  if (conflict.reason === 'unknown-supersession') {
    return 'The license version this document retires was superseded by a concurrent import.';
  }
  if (conflict.reason === 'license-binding-conflict') {
    return LICENSE_BINDING_CONFLICT_MESSAGE;
  }
  if (conflict.reason === 'customer-code-mismatch') {
    return CUSTOMER_CODE_MISMATCH_MESSAGE;
  }
  if (conflict.reason === 'installation-customer-mismatch') {
    return INSTALLATION_CUSTOMER_MISMATCH_MESSAGE;
  }
  if (conflict.reason === 'transfer-requires-different-customer') {
    return TRANSFER_REQUIRES_DIFFERENT_CUSTOMER_MESSAGE;
  }
  if (conflict.reason === 'renewal-gap') {
    return 'This renewal would start after the license it renews has ended, leaving a gap in coverage. Issue the renewal to start at or before the end of the version it follows.';
  }
  if (conflict.reason === 'reduction-requires-resolution') {
    if (operation === 'recovery') {
      return 'The transaction found a capacity or entitlement reduction conflict while applying this post-gap recovery. Nothing was changed. Retry the same dedicated gap-recovery operation with a reductionResolutionReason and the Activate, RecoverAfterGap, and ResolveReduction permissions; do not use the separate reduction-resolution route for this post-gap document.';
    }
    return legacy
      ? 'This license code would reduce the modules or capacity of the version it replaces, and the reduction conflicts with current usage or the retained grant — the concrete limits, usage and entitlements are in the conflict details. Nothing was changed.'
      : 'This version reduces the modules or capacity of the version it retires or takes over, and the reduction conflicts with current usage or the retained grant — the concrete limits, usage and entitlements are in the conflict details. Nothing was changed.';
  }
  if (conflict.reason === 'post-gap-recovery-requires-dedicated-operation') {
    return 'This license document would cover a lapse with a new license identity. Post-gap recovery is permitted only through the dedicated recovery operation, which requires its own permission and a recorded reason. Nothing was changed.';
  }
  if (conflict.reason === 'recovery-not-applicable') {
    return operation === 'recovery'
      ? 'The transaction found that this document is not applicable as a post-gap recovery. Recovery requires a new identity after ended coverage and cannot retire a supersession target. Nothing was changed; review the current license state and issue a document for the correct operation.'
      : RECOVERY_NOT_APPLICABLE_MESSAGE;
  }
  if (conflict.reason === 'resolution-not-applicable') {
    return operation === 'recovery'
      ? 'The transaction found no capacity or entitlement conflict for this recovery, so there is no reduction to resolve. Nothing was changed; retry gap recovery without a reductionResolutionReason.'
      : RESOLUTION_NOT_APPLICABLE_MESSAGE;
  }
  if (conflict.reason === 'backdated-supersession') {
    // Not a race: the temporal rule is evaluated against the locked state, so
    // this can only surface when the import instant moved past the hand-over.
    return legacy
      ? 'This license code would replace the current version from an instant that is already in the past, which would rewrite which version governed then. Start the code at or after the end of the version it follows, or retire that version with a signed document whose start has not yet passed.'
      : 'This license version would retire the version it names from an instant that is already in the past, which would rewrite which version governed then. Issue the document with a start that has not yet passed, or after the version it retires has ended.';
  }
  return legacy
    ? 'This license code overlaps a retained version that a concurrent import changed, and cannot be applied.'
    : 'This license version overlaps a version a concurrent import retained. Nothing was changed; review the license state and retry.';
}

function rejectionException(
  reason: LicenseImportRejectionReason,
  message: string,
  reduction?: ImportConflict['reduction'],
): AppException {
  const details: { reason: string; reduction?: ImportConflict['reduction'] } = {
    reason,
  };
  if (reduction !== undefined) details.reduction = reduction;
  return CONFLICT_REASONS.has(reason)
    ? AppException.conflict(message, details)
    : AppException.businessRule(message, details);
}
