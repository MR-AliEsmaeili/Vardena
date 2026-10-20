import { Inject, Injectable } from '@nestjs/common';
import {
  APP_CONFIG,
  type AppConfig,
} from '../../../kernel/config/app-config.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import {
  LicensesRepository,
  RevocationConflictError,
  type LicenseRevocationRecord,
} from '../data/licenses.repository.js';
import {
  parseTrustedLicenseKeys,
  type TrustedLicenseKey,
} from '../domain/license-document.js';
import {
  decodeRevocationTransport,
  parseRevocationDocument,
  RevocationDocumentError,
  type RevocationDocumentErrorReason,
  type RevocationPayload,
  type VerifiedRevocation,
} from '../domain/license-revocation.js';
import { LICENSING_PERMISSIONS } from '../domain/licensing-permissions.js';
import { InstallationIdentityService } from './installation-identity.service.js';

/**
 * Signed revocation import (OD-LIC-17; normative design
 * `docs/licensing/revocation-artifact-protocol.md`).
 *
 * The domain split mirrors the license import: `domain/license-revocation.ts`
 * answers "are these bytes an authentic, canonical revocation?" and this
 * service answers "does it belong to THIS installation, customer and license,
 * and may it be applied now?". Everything state-dependent runs here, in the
 * protocol's documented order (§4), and nothing is written until every check
 * has passed.
 *
 * Non-negotiable properties:
 * - **fail closed, first failure wins.** A rejection writes no state; the only
 *   side effect is an audit row (best effort) whose `reason` is the same stable
 *   machine reason the caller receives.
 * - **authorization first.** The permission is checked before the document is
 *   even decoded, so an unauthorized caller learns nothing about an artifact.
 * - **targeted only.** The signed `effect` is `LICENSE_ONLY`; exactly one
 *   license stops conferring entitlement and no version is rewritten.
 * - **no artifact retention on the customer side.** Only SHA-256 digests are
 *   stored — never the document, the signature or key material.
 * - **duplicates are not re-applied.** Same `revocationId` + same canonical
 *   bytes returns the historical first result (OD-LIC-18 by analogy); the same
 *   identity with different bytes, or a second revocation for a license that is
 *   already revoked, is refused and changes nothing.
 */

/** Transport tolerance for a future-dated `issuedAt` (protocol §4 step 10). */
export const REVOCATION_FUTURE_TOLERANCE_MS = 10 * 60 * 1000;

/**
 * Every reason this operation can answer with: the document-level ones plus
 * the state-dependent ones of protocol §4 steps 7–11.
 */
export type RevocationImportRejectionReason =
  | RevocationDocumentErrorReason
  | 'wrong-installation'
  | 'wrong-customer'
  | 'unknown-target'
  | 'future-dated'
  | 'stale-revocation'
  | 'conflicting-replay'
  | 'already-revoked';

/** The 409 subset: the artifact is authentic but retained state refuses it. */
const CONFLICT_REASONS: ReadonlySet<RevocationImportRejectionReason> = new Set([
  'conflicting-replay',
  'already-revoked',
]);

export interface LicenseRevocationImportResult {
  /** False when the artifact was already applied (idempotent replay). */
  changed: boolean;
  outcome: 'APPLIED' | 'UNCHANGED';
  /** The stored revocation — the historical one on a replay. */
  revocation: LicenseRevocationResultView;
  /** True only when this call performed the state change. */
  alreadyApplied: boolean;
}

export interface LicenseRevocationResultView {
  revocationId: string;
  licenseId: string;
  installationId: string;
  customerId: string;
  customerCode: string;
  targetOperationId: string;
  reason: string;
  reasonDetail: string | null;
  issuerKeyId: string;
  issuedAt: string;
  importedAt: string;
  importedBy: string | null;
  artifactSha256: string;
  canonicalPayloadSha256: string;
}

@Injectable()
export class LicenseRevocationService {
  private readonly trustedKeys: TrustedLicenseKey[];

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly authorization: AuthorizationService,
    private readonly identity: InstallationIdentityService,
    private readonly licenses: LicensesRepository,
    private readonly logger: JsonLogger,
  ) {
    // Parsed once at startup: a malformed authority key must fail the boot with
    // a clear message, not surface as a server error on an import.
    this.trustedKeys = parseTrustedLicenseKeys(
      config.licensing.signingPublicKeys,
    );
  }

  async importRevocation(
    rawDocument: string,
  ): Promise<LicenseRevocationImportResult> {
    await this.requireRevokePermission();
    const now = new Date();
    const installationId = await this.identity.currentIdOrNull();

    // 1–2. Transport and armor. Nothing here is trusted yet; the fields below
    // are used only to decide what to log, never to write state.
    let transport: {
      document: string;
      transport: 'file' | 'text';
      keyId: string | null;
    };
    try {
      transport = decodeRevocationTransport(rawDocument);
    } catch (error) {
      return this.rejectDocument(error, {
        now,
        installationId,
        source: 'file',
      });
    }

    // 3–6. Signature, payload, canonical form, issuer/key agreement.
    let verified: VerifiedRevocation;
    try {
      verified = parseRevocationDocument(transport.document, this.trustedKeys, {
        keyId: transport.keyId,
      });
    } catch (error) {
      return this.rejectDocument(error, {
        now,
        installationId,
        source: transport.transport,
      });
    }
    const payload = verified.payload;
    const documentHash = verified.payloadDigest;

    // 7. Installation binding. The signed identity must be THIS installation.
    //    An installation without an identity has no row to attribute an audit
    //    event to, so that refusal is logged only (never attributed to the
    //    signed id, which is not trusted yet).
    if (installationId === null) {
      this.logger.warn(
        'Revocation import rejected before an installation identity exists',
        { revocationId: payload.revocationId },
        LicenseRevocationService.name,
      );
      throw rejectionException(
        'wrong-installation',
        'This installation has no identity yet, so a revocation cannot be bound to it. Read the current license state first.',
      );
    }
    if (payload.installationId !== installationId) {
      return this.reject(
        'wrong-installation',
        {
          now,
          installationId,
          payload,
          source: transport.transport,
          documentHash,
        },
        'This revocation was issued for a different Vardena installation. Nothing was changed.',
      );
    }

    // 8. Customer binding: the local customer row must exist and match exactly.
    const customer = await this.licenses.findCustomer(payload.customerId);
    if (customer === null || customer.customerCode !== payload.customerCode) {
      return this.reject(
        'wrong-customer',
        {
          now,
          installationId,
          payload,
          source: transport.transport,
          documentHash,
        },
        'This revocation names a commercial customer this installation does not hold, or the customer code does not match that customer. Nothing was changed.',
      );
    }

    // 9. Target binding: the license must exist here, belong to that customer
    //    and installation, and the signed operation id must be one of its
    //    retained versions ('evidence of what was current', never a filter).
    const target = await this.licenses.findRevocationTarget(payload.licenseId);
    if (
      target === null ||
      target.installationId !== installationId ||
      target.customerId !== payload.customerId
    ) {
      return this.reject(
        'unknown-target',
        {
          now,
          installationId,
          payload,
          source: transport.transport,
          documentHash,
        },
        'This revocation names a license that does not exist on this installation for that customer. Nothing was changed.',
      );
    }
    const targetVersion = target.versions.find(
      (version) => version.operationId === payload.targetOperationId,
    );
    if (targetVersion === undefined) {
      return this.reject(
        'unknown-target',
        {
          now,
          installationId,
          payload,
          source: transport.transport,
          documentHash,
        },
        'This revocation names a license version this installation never retained. Nothing was changed.',
      );
    }

    // 10. Staleness. A revocation does not expire, but it may not be issued
    //     before the version it targets, and it may not be future-dated beyond
    //     the transport tolerance. When the retained version predates the
    //     `signed_issued_at` column the comparison is NOT assessable — it is
    //     skipped and never approximated from `imported_at` or `valid_from`
    //     (protocol §4 step 10).
    if (
      payload.issuedAt.getTime() >
      now.getTime() + REVOCATION_FUTURE_TOLERANCE_MS
    ) {
      return this.reject(
        'future-dated',
        {
          now,
          installationId,
          payload,
          source: transport.transport,
          documentHash,
        },
        'This revocation is dated in the future beyond the allowed transport tolerance. Nothing was changed.',
      );
    }
    if (
      targetVersion.signedIssuedAt !== null &&
      payload.issuedAt.getTime() < targetVersion.signedIssuedAt.getTime()
    ) {
      return this.reject(
        'stale-revocation',
        {
          now,
          installationId,
          payload,
          source: transport.transport,
          documentHash,
        },
        'This revocation predates the license version it targets, so it is stale. Review the license state and issue the revocation against the version that governs. Nothing was changed.',
      );
    }

    // 11. Replay and idempotency (protocol §6). The repository decides again
    //     inside the lock; this pass gives the informative answer and the
    //     historical result.
    const existing = await this.licenses.findRevocation(payload.revocationId);
    if (existing !== null) {
      if (
        existing.canonicalPayloadSha256 !== verified.payloadDigest ||
        existing.licenseId !== payload.licenseId
      ) {
        await this.recordRejection({
          installationId,
          payload,
          source: transport.transport,
          documentHash,
          reason: 'conflicting-replay',
          now,
        });
        throw AppException.conflict(
          'A revocation with this identity was already imported with different signed bytes. Nothing was changed.',
          { reason: 'conflicting-replay' },
        );
      }
      // Idempotent success: the historical first result, byte for byte.
      return {
        changed: false,
        outcome: 'UNCHANGED',
        revocation: toRevocationView(existing),
        alreadyApplied: true,
      };
    }
    if (target.revokedAt !== null) {
      await this.recordRejection({
        installationId,
        payload,
        source: transport.transport,
        documentHash,
        reason: 'already-revoked',
        now,
      });
      throw AppException.conflict(
        'This license is already revoked; the original revocation is retained and this later artifact does not overwrite it. Nothing was changed.',
        { reason: 'already-revoked', revocationId: target.revocationId },
      );
    }

    // 12. One transaction: revocation row, license stamp and typed audit event
    //     commit together or not at all.
    try {
      const applied = await this.licenses.applyRevocation({
        revocationId: payload.revocationId,
        licenseId: payload.licenseId,
        installationId,
        customerId: payload.customerId,
        customerCode: payload.customerCode,
        targetOperationId: payload.targetOperationId,
        reason: payload.reason,
        reasonDetail: payload.reasonDetail,
        issuerKeyId: verified.keyId,
        issuedAt: payload.issuedAt,
        now,
        actorId: getPrincipal()?.userId ?? null,
        source: transport.transport,
        artifactSha256: documentHash,
        canonicalPayloadSha256: verified.payloadDigest,
        targetVersionId: targetVersion.versionId,
        detail: revocationAuditDetail(payload),
      });
      return {
        changed: !applied.alreadyApplied,
        outcome: applied.alreadyApplied ? 'UNCHANGED' : 'APPLIED',
        revocation: toRevocationView(applied.revocation),
        alreadyApplied: applied.alreadyApplied,
      };
    } catch (error) {
      if (error instanceof RevocationConflictError) {
        return this.rejectConflict(error, {
          now,
          installationId,
          payload,
          source: transport.transport,
          documentHash,
        });
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------

  private async rejectConflict(
    error: RevocationConflictError,
    context: RejectionContext,
  ): Promise<never> {
    if (error.reason === 'already-revoked') {
      await this.recordRejection({
        installationId: context.installationId,
        payload: context.payload,
        source: context.source,
        documentHash: context.documentHash,
        reason: 'already-revoked',
        now: context.now,
      });
      throw AppException.conflict(
        'This license is already revoked; the original revocation is retained and this later artifact does not overwrite it. Nothing was changed.',
        {
          reason: 'already-revoked',
          revocationId: error.existing?.revocationId ?? null,
        },
      );
    }
    if (error.reason === 'conflicting-replay') {
      await this.recordRejection({
        installationId: context.installationId,
        payload: context.payload,
        source: context.source,
        documentHash: context.documentHash,
        reason: 'conflicting-replay',
        now: context.now,
      });
      throw AppException.conflict(
        'A revocation with this identity was already imported with different signed bytes. Nothing was changed.',
        { reason: 'conflicting-replay' },
      );
    }
    await this.recordRejection({
      installationId: context.installationId,
      payload: context.payload,
      source: context.source,
      documentHash: context.documentHash,
      reason: 'unknown-target',
      now: context.now,
    });
    throw rejectionException(
      'unknown-target',
      'The revocation target changed while it was being applied and no longer matches this installation, customer and license. Nothing was changed.',
    );
  }

  /**
   * A document-level rejection: transport, armor, signature, payload, canonical
   * form. The payload is not trusted here, so only the reason is recorded and
   * only when an installation identity exists; otherwise it is logged.
   */
  private async rejectDocument(
    error: unknown,
    context: {
      now: Date;
      installationId: string | null;
      source: string;
    },
  ): Promise<never> {
    const reason: RevocationDocumentErrorReason =
      error instanceof RevocationDocumentError ? error.reason : 'malformed';
    const message =
      error instanceof RevocationDocumentError
        ? error.message
        : 'The revocation document could not be verified.';
    if (context.installationId !== null) {
      await this.recordRejection({
        installationId: context.installationId,
        payload: null,
        source: context.source,
        documentHash: null,
        reason,
        now: context.now,
      });
    }
    this.logger.warn(
      'Revocation import rejected',
      { reason, installationId: context.installationId },
      LicenseRevocationService.name,
    );
    throw rejectionException(reason, message);
  }

  private async reject(
    reason: RevocationImportRejectionReason,
    context: RejectionContext,
    message: string,
  ): Promise<never> {
    await this.recordRejection({
      installationId: context.installationId,
      payload: context.payload,
      source: context.source,
      documentHash: context.documentHash,
      reason,
      now: context.now,
    });
    this.logger.warn(
      'Revocation import rejected',
      {
        reason,
        revocationId: context.payload.revocationId,
        licenseId: context.payload.licenseId,
        keyId: context.payload.issuerKeyId,
      },
      LicenseRevocationService.name,
    );
    throw rejectionException(reason, message);
  }

  /**
   * Append the typed rejection event. Best effort by design (the same rule the
   * license import applies): a rejection still happens if the audit row cannot
   * be written, and the failure is logged, never silently swallowed.
   */
  private async recordRejection(event: {
    installationId: string;
    payload: RevocationPayload | null;
    source: string;
    documentHash: string | null;
    reason: RevocationImportRejectionReason;
    now: Date;
  }): Promise<void> {
    try {
      await this.licenses.recordAuditEvent({
        installationId: event.installationId,
        eventType: 'license.revocation.rejected',
        outcome: 'REJECTED',
        operationId: event.payload?.targetOperationId ?? null,
        licenseId: event.payload?.licenseId ?? null,
        versionId: null,
        actorId: getPrincipal()?.userId ?? null,
        source: event.source,
        documentHash: event.documentHash,
        reason: event.reason,
        detail: revocationRejectionDetail(event.reason, event.payload),
        revocationId: event.payload?.revocationId ?? null,
        occurredAt: event.now,
      });
    } catch (error) {
      this.logger.error(
        'Failed to record a revocation rejection audit event',
        { reason: event.reason, error: (error as Error).message },
        LicenseRevocationService.name,
      );
    }
  }

  private async requireRevokePermission(): Promise<void> {
    await this.authorization.requireAllPermissions([
      LICENSING_PERMISSIONS.LICENSE_REVOKE,
    ]);
  }
}

interface RejectionContext {
  now: Date;
  installationId: string;
  payload: RevocationPayload;
  source: string;
  documentHash: string;
}

function rejectionException(
  reason: RevocationImportRejectionReason,
  message: string,
): AppException {
  const details = { reason };
  return CONFLICT_REASONS.has(reason)
    ? AppException.conflict(message, details)
    : AppException.businessRule(message, details);
}

/** Bounded, secret-free audit detail for an applied revocation. */
function revocationAuditDetail(payload: RevocationPayload): string {
  const base = `Signed revocation ${payload.revocationId} of license ${payload.licenseId} (target version ${payload.targetOperationId}); effect ${payload.effect}; reason ${payload.reason}.`;
  return payload.reasonDetail === null
    ? base
    : `${base} Detail: ${payload.reasonDetail}`.slice(0, 500);
}

function revocationRejectionDetail(
  reason: RevocationImportRejectionReason,
  payload: RevocationPayload | null,
): string {
  return payload === null
    ? `Revocation refused: ${reason}.`
    : `Revocation ${payload.revocationId} of license ${payload.licenseId} refused: ${reason}.`;
}

function toRevocationView(
  record: LicenseRevocationRecord,
): LicenseRevocationResultView {
  return {
    revocationId: record.revocationId,
    licenseId: record.licenseId,
    installationId: record.installationId,
    customerId: record.customerId,
    customerCode: record.customerCode,
    targetOperationId: record.targetOperationId,
    reason: record.reason,
    reasonDetail: record.reasonDetail,
    issuerKeyId: record.issuerKeyId,
    issuedAt: record.issuedAt.toISOString(),
    importedAt: record.importedAt.toISOString(),
    importedBy: record.importedBy,
    artifactSha256: record.artifactSha256,
    canonicalPayloadSha256: record.canonicalPayloadSha256,
  };
}
