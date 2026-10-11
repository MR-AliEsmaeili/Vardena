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
import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import {
  LicensesRepository,
  SupersessionConflictError,
  type LicenseAuditEventCommand,
} from '../data/licenses.repository.js';
import {
  LICENSE_CODE_PREFIX,
  licenseCodeHash,
  parseLicenseCode,
  parsePublicKey,
  toInstallationLicense as legacyToInstallationLicense,
  type LicenseCodeErrorReason,
  type LicensePayload,
} from '../domain/license-code.js';
import {
  decodeLicenseTransport,
  licenseDocumentHash,
  licenseVersionEntitlements,
  parseLicenseDocument,
  splitTrustedKeyEntry,
  toTrustedKeys,
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
  findVersionByOperationId,
  isSuperseded,
  overlappingVersions,
  resolveEffectiveVersion,
  type LicenseVersionSource,
  type RetainedLicenseVersion,
} from '../domain/license-version.js';
import { LICENSING_PERMISSIONS } from '../domain/licensing-permissions.js';
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
  | 'duplicate-operation'
  | 'overlapping-range'
  | 'unknown-supersession';

/** 409 reasons: the document is authentic but conflicts with retained state. */
const CONFLICT_REASONS: ReadonlySet<LicenseImportRejectionReason> = new Set([
  'duplicate-operation',
  'overlapping-range',
  'unknown-supersession',
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
 *   9. conflicts      — overlap only through an explicit signed supersession;
 *  10. persistence    — ONE transaction (customer, license, version,
 *                       entitlements, supersession stamps, audit event).
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
    private readonly logger: JsonLogger,
  ) {
    const seen = new Set<string>();
    const parsed = config.licensing.signingPublicKeys.map((entry, index) => {
      const { id, material } = splitTrustedKeyEntry(entry);
      let key: KeyObject;
      try {
        key = parsePublicKey(material);
      } catch {
        throw new Error(
          `LICENSE_SIGNING_PUBLIC_KEYS entry ${index + 1} is not a valid Ed25519 public key (PEM or base64 DER).`,
        );
      }
      return id === null ? { key } : { id, key };
    });
    const trusted = toTrustedKeys(parsed);
    for (const key of trusted) {
      if (seen.has(key.id)) {
        throw new Error(
          `LICENSE_SIGNING_PUBLIC_KEYS contains the duplicate key id "${key.id}".`,
        );
      }
      seen.add(key.id);
    }
    this.trustedKeys = trusted;
    this.publicKeys = trusted.map((entry) => entry.key);
  }

  /**
   * Import a signed license document (file envelope or bare artifact). Legacy
   * `VLIC1` codes are accepted through the same route for compatibility and
   * are handled by `applyLegacyCode`.
   */
  async importDocument(rawDocument: string): Promise<LicenseImportResult> {
    await this.requireActivatePermission();
    const now = new Date();
    // Read-only: import never creates, recreates or adopts an installation
    // identity (ADR-0046 Decision 6).
    const installationId = await this.identity.existingIdOrNull();

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
      return this.applyLegacyCode(transport.document, installationId, now);
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

    // 8. Replay. A v2 operation is applied at most once: the second attempt is
    //    refused (409) and changes nothing, which is also what makes retrying
    //    an ambiguous failure safe (PDR-11 §10.8).
    const versions = await this.licenses.listVersions(installationId);
    if (findVersionByOperationId(versions, payload.operationId) !== null) {
      return this.rejectVerified(
        'duplicate-operation',
        {
          now,
          installationId,
          payload,
          keyId,
          source: transport.transport,
          documentHash,
        },
        'This license version has already been imported.',
      );
    }
    const byHash = await this.licenses.findVersion(installationId, {
      documentHash,
    });
    if (byHash !== null) {
      return this.rejectVerified(
        'duplicate-operation',
        {
          now,
          installationId,
          payload,
          keyId,
          source: transport.transport,
          documentHash,
        },
        'This license version has already been imported.',
      );
    }

    // 9. Version conflicts. Overlap is only allowed through an explicit signed
    //    supersession (design §3.3); the open product question about a general
    //    precedence rule (PDR-11 PQ-5 → OQ-80) is deliberately NOT decided.
    let supersedes: RetainedLicenseVersion | null = null;
    if (payload.supersedesOperationId !== null) {
      supersedes = findVersionByOperationId(
        versions,
        payload.supersedesOperationId,
      );
      if (supersedes === null || isSuperseded(supersedes)) {
        return this.rejectVerified(
          'unknown-supersession',
          {
            now,
            installationId,
            payload,
            keyId,
            source: transport.transport,
            documentHash,
          },
          'The license version this document retires is not a retained, eligible version of this installation.',
        );
      }
    }
    const overlapping = overlappingVersions(payload, versions).filter(
      (version) => version.versionId !== supersedes?.versionId,
    );
    if (overlapping.length > 0) {
      return this.rejectVerified(
        'overlapping-range',
        {
          now,
          installationId,
          payload,
          keyId,
          source: transport.transport,
          documentHash,
        },
        'This license version overlaps a retained version. Issue a document that explicitly retires it, or a non-overlapping renewal.',
        overlapping.length,
      );
    }

    // 10. Persist as ONE transaction.
    const version = await this.persist(
      {
        installationId,
        payload,
        keyId,
        source: transport.transport,
        documentHash,
        supersedes,
        now,
      },
      'license.import.applied',
    );

    this.logger.log(
      'License version imported',
      {
        installationId,
        licenseId: version.licenseId,
        versionId: version.versionId,
        keyId,
        supersededVersionId: supersedes?.versionId ?? null,
      },
      LicenseImportService.name,
    );

    return {
      changed: true,
      outcome: 'APPLIED',
      license: await this.licensing.current(now),
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
    now: Date,
  ): Promise<LicenseImportResult> {
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
      };
    }
    if (existing !== undefined) {
      return this.rejectLegacy(
        'duplicate-operation',
        { now, installationId, payload, source: 'legacy-code', documentHash },
        'This license code has already been imported and is retained; it is no longer the version that governs.',
      );
    }

    // Replacement semantics for the version that governs now. Overlap with any
    // other retained version cannot be expressed by a text code, so it is
    // refused rather than guessed (fail-closed; same default as v2).
    const overlapping = overlappingVersions(payload, versions);
    if (overlapping.length > 1) {
      return this.rejectLegacy(
        'overlapping-range',
        { now, installationId, payload, source: 'legacy-code', documentHash },
        'This license code overlaps more than one retained version and cannot be applied.',
        overlapping.length,
      );
    }
    const supersedes = overlapping[0] ?? null;

    const version = await this.persist(
      {
        installationId,
        payload,
        keyId: null,
        source: 'legacy-code',
        documentHash,
        supersedes,
        now,
        legacy: true,
      },
      'license.import.applied',
    );

    this.logger.log(
      'Legacy license code activated',
      {
        installationId,
        licenseId: version.licenseId,
        versionId: version.versionId,
        supersededVersionId: supersedes?.versionId ?? null,
      },
      LicenseImportService.name,
    );

    return {
      changed: true,
      outcome: 'APPLIED',
      license: await this.licensing.current(now),
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
      supersedes: RetainedLicenseVersion | null;
      now: Date;
      legacy?: boolean;
    },
    eventType: string,
  ): Promise<RetainedLicenseVersion> {
    const legacy = context.legacy === true;
    const operationId = legacy
      ? legacyOperationId(context.documentHash)
      : (context.payload as LicenseVersionPayload).operationId;
    const entitlements = legacy
      ? legacyEntitlements(context.payload as LicensePayload)
      : licenseVersionEntitlements(context.payload as LicenseVersionPayload);
    const versionId = generateId();
    try {
      return await this.licenses.importVersion({
        installationId: context.installationId,
        actorId: getPrincipal()?.userId ?? null,
        now: context.now,
        licenseId: context.payload.licenseId,
        customerId: context.payload.customerId,
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
        entitlements,
        supersedesVersionId: context.supersedes?.versionId ?? null,
        auditEvents: [
          ...(context.supersedes === null
            ? []
            : [
                supersededAuditEvent(
                  context.supersedes,
                  context.source,
                  context.now,
                ),
              ]),
          {
            installationId: context.installationId,
            eventType,
            outcome: 'APPLIED',
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
                : 'superseded a retained version',
            occurredAt: context.now,
          },
        ],
      });
    } catch (error) {
      if (error instanceof SupersessionConflictError) {
        return this.rejectAppliedConflict(
          'unknown-supersession',
          {
            installationId: context.installationId,
            licenseId: context.payload.licenseId,
            operationId,
            documentHash: context.documentHash,
            source: context.source,
            now: context.now,
          },
          'The license version this document retires was superseded by a concurrent import.',
        );
      }
      if (isUniqueViolation(error)) {
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
      'License import rejected by the database guard',
      {
        reason,
        installationId: context.installationId,
        source: context.source,
      },
      LicenseImportService.name,
    );
    throw rejectionException(reason, message);
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
    throw rejectionException(reason, message);
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
    throw rejectionException(reason, message);
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

function supersededAuditEvent(
  superseded: RetainedLicenseVersion,
  source: string,
  now: Date,
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
    reason: null,
    detail: 'superseded by a later imported version',
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

function rejectionException(
  reason: LicenseImportRejectionReason,
  message: string,
): AppException {
  return CONFLICT_REASONS.has(reason)
    ? AppException.conflict(message, { reason })
    : AppException.businessRule(message, { reason });
}
