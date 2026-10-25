/**
 * In-memory stand-ins for the Licensing module's Prisma repositories (L-03
 * version model).
 *
 * They model the database guarantees the real tables carry, because the
 * behaviour under test depends on them:
 *   - at most one `is_self` installation row (partial unique index);
 *   - at most one retained version per `(installation_id, operation_id)` and
 *     per `(installation_id, document_hash)` — a duplicate raises the same
 *     `P2002` classification the kernel maps to a conflict;
 *   - `importVersion` RE-EVALUATES the version invariant
 *     (`evaluateImportConflicts`) before it writes, exactly like the real
 *     transaction does under its installation row lock, and throws the same
 *     `ImportConflictError` the service maps to 409;
 *   - supersession is a guarded stamp: a version that is already superseded
 *     cannot be superseded again inside one import.
 *
 * JavaScript is single-threaded and `importVersion` here has no `await` between
 * its evaluation and its writes, so the fake is atomic by construction: the
 * live PostgreSQL suite (`licensing-persistence-live.e2e-spec.ts`) is what
 * proves the real `FOR UPDATE` lock closes the race between processes.
 *
 * The stores outlive the Nest application that uses them, which is exactly
 * what makes a restart testable: a second `createTestApp()` over the SAME
 * stores is the same installation with the same retained versions.
 */
import type { InstallationsRepository } from '../../src/modules/licensing/data/installations.repository.js';
import type {
  ApplyRevocationCommand,
  ImportLicenseVersionCommand,
  ImportVersionResult,
  LicenseAuditEventCommand,
  LicenseAuditEventRow,
  LicenseRevocationRecord,
  LicensesRepository,
} from '../../src/modules/licensing/data/licenses.repository.js';
import {
  ImportConflictError,
  recoveryAuditEvent,
  renewalAuditEvent,
  resolutionAuditEvent,
  RevocationConflictError,
  transferAuditEvent,
} from '../../src/modules/licensing/data/licenses.repository.js';
import {
  assertValidCustomerName,
  assertValidCustomerRecord,
  LicenseCustomerError,
  type LicenseCustomer,
} from '../../src/modules/licensing/domain/customer.js';
import type { InstallationIdentity } from '../../src/modules/licensing/domain/installation.js';
import {
  evaluateImportConflicts,
  lapsedLicenseContext,
  reductionConflicts,
  resolveEffectiveVersion,
  supersessionCeaseInstant,
  type RetainedLicenseVersion,
} from '../../src/modules/licensing/domain/license-version.js';

export interface LicensingStores {
  installations: InstallationsRepository;
  licenses: LicensesRepository;
  /** Every retained version ever imported, in import order. */
  versions: RetainedLicenseVersion[];
  /** Every audit event ever written, in write order. */
  auditEvents: LicenseAuditEventRow[];
  /** Every applied revocation (one per license, enforced below). */
  revocations: LicenseRevocationRecord[];
  /** License-level revocation state, keyed by license id. */
  revoked: Map<string, { revokedAt: Date; revocationId: string }>;
  self: () => InstallationIdentity | null;
  customers: Map<string, string>;
  customerCodes: Map<string, string>;
  customerRecords: Map<string, LicenseCustomer>;
}

/** A Prisma-shaped unique violation, as the kernel classifier expects. */
function uniqueViolation(target: string): Error & { code: string } {
  return Object.assign(new Error(`Unique constraint failed on ${target}`), {
    code: 'P2002',
    meta: { target },
  });
}

export function createLicensingStores(
  seed: { installation?: InstallationIdentity } = {},
): LicensingStores {
  let self: InstallationIdentity | null = seed.installation ?? null;
  const versions: RetainedLicenseVersion[] = [];
  const auditEvents: LicenseAuditEventRow[] = [];
  const customers = new Map<string, string>();
  const customerCodes = new Map<string, string>();
  const customerRecords = new Map<string, LicenseCustomer>();
  const revocations: LicenseRevocationRecord[] = [];
  const revoked = new Map<string, { revokedAt: Date; revocationId: string }>();
  /** `license_versions.signed_issued_at`, which the domain row does not carry. */
  const signedIssuedAt = new Map<string, Date | null>();
  let eventCounter = 0;

  const installations = {
    async findSelf(): Promise<InstallationIdentity | null> {
      return self === null ? null : { ...self };
    },
    async createSelf(params: {
      id: string;
      name: string;
      now: Date;
    }): Promise<InstallationIdentity> {
      // The unique index decides a race: an existing identity is adopted.
      if (self !== null) return { ...self };
      self = {
        installationId: params.id,
        name: params.name,
        customerId: null,
        createdAt: params.now,
      };
      return { ...self };
    },
    async attachCustomer(
      installationId: string,
      customerId: string,
    ): Promise<void> {
      if (self !== null && self.installationId === installationId) {
        self = { ...self, customerId };
      }
    },
  } as unknown as InstallationsRepository;

  const licenses = {
    async listVersions(
      installationId: string,
    ): Promise<RetainedLicenseVersion[]> {
      return versions
        .filter((version) => version.installationId === installationId)
        .map(cloneVersion)
        .sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
    },

    async findVersion(
      installationId: string,
      by: { operationId: string } | { documentHash: string },
    ): Promise<RetainedLicenseVersion | null> {
      const row =
        'operationId' in by
          ? versions.find(
              (candidate) =>
                candidate.installationId === installationId &&
                candidate.operationId === by.operationId,
            )
          : versions.find(
              (candidate) =>
                candidate.installationId === installationId &&
                candidate.documentHash === by.documentHash,
            );
      return row === undefined ? null : cloneVersion(row);
    },

    async findCustomerById(
      customerId: string,
    ): Promise<LicenseCustomer | null> {
      const record = customerRecords.get(customerId);
      return record === undefined ? null : { ...record };
    },

    async findCustomerByCode(
      customerCode: string,
    ): Promise<LicenseCustomer | null> {
      for (const record of customerRecords.values()) {
        if (record.customerCode === customerCode) {
          return { ...record };
        }
      }
      return null;
    },

    async findCustomersForImport(params: {
      customerId: string;
      customerCode: string;
      installationCustomerId: string | null;
    }): Promise<{
      installationCustomerCode: string | null;
      knownCustomers: Array<{ customerId: string; customerCode: string }>;
    }> {
      const installationCustomerCode =
        params.installationCustomerId === null
          ? null
          : (customerRecords.get(params.installationCustomerId)?.customerCode ??
            null);
      const knownCustomers = [...customerRecords.values()].map((record) => ({
        customerId: record.customerId,
        customerCode: record.customerCode,
      }));
      return { installationCustomerCode, knownCustomers };
    },

    async createCustomer(params: {
      customerId: string;
      customerCode: string;
      displayName: string;
      now?: Date;
    }): Promise<LicenseCustomer> {
      const validated = assertValidCustomerRecord(params);
      if (customerRecords.has(validated.customerId)) {
        throw new LicenseCustomerError(
          'duplicate-customer',
          `Customer id "${validated.customerId}" already exists.`,
        );
      }
      for (const existing of customerRecords.values()) {
        if (existing.customerCode === validated.customerCode) {
          throw new LicenseCustomerError(
            'duplicate-customer',
            `Customer code "${validated.customerCode}" already exists.`,
          );
        }
      }
      const now = params.now ?? new Date();
      const record: LicenseCustomer = {
        customerId: validated.customerId,
        customerCode: validated.customerCode,
        displayName: validated.displayName,
        createdAt: now,
        updatedAt: now,
      };
      customerRecords.set(record.customerId, record);
      customers.set(record.customerId, record.displayName);
      customerCodes.set(record.customerId, record.customerCode);
      return { ...record };
    },

    async updateCustomerDisplayName(params: {
      customerId: string;
      displayName: string;
      now?: Date;
    }): Promise<LicenseCustomer> {
      const displayName = assertValidCustomerName(params.displayName);
      const existing = customerRecords.get(params.customerId);
      if (existing === undefined) {
        throw new LicenseCustomerError(
          'customer-not-found',
          `Customer "${params.customerId}" does not exist.`,
        );
      }
      const updated: LicenseCustomer = {
        ...existing,
        displayName,
        updatedAt: params.now ?? new Date(),
      };
      customerRecords.set(updated.customerId, updated);
      customers.set(updated.customerId, updated.displayName);
      return { ...updated };
    },

    async importVersion(
      command: ImportLicenseVersionCommand,
    ): Promise<ImportVersionResult> {
      // OD-LIC-17: a revoked license accepts no version — not a renewal, not a
      // supersession, not an exact replay. Checked first, under the same
      // "lock" every other invariant runs under.
      if (revoked.has(command.licenseId)) {
        throw new ImportConflictError({
          reason: 'license-revoked',
          overlapping: 0,
        });
      }
      // The authoritative invariant pass, exactly like the real transaction
      // (which runs it under the installation row lock).
      const retained = versions.filter(
        (version) => version.installationId === command.installationId,
      );
      // Cross-installation binding: a license identifier retained for another
      // installation is refused.
      if (
        versions.some(
          (version) =>
            version.licenseId === command.licenseId &&
            version.installationId !== command.installationId,
        )
      ) {
        throw new ImportConflictError({
          reason: 'license-binding-conflict',
          overlapping: 0,
        });
      }
      // The evaluation sees the installation's committed customer (the value
      // the real transaction reads under the row lock) and the caller's
      // transfer intent. `customerTransfer` is required on the command exactly
      // so that every call site states which of the two it is.
      const installationCustomerId =
        self !== null && self.installationId === command.installationId
          ? self.customerId
          : null;
      const installationCustomerCode =
        installationCustomerId === null
          ? null
          : (customerRecords.get(installationCustomerId)?.customerCode ?? null);
      const knownCustomers = [...customerRecords.values()].map((record) => ({
        customerId: record.customerId,
        customerCode: record.customerCode,
      }));
      // §8.6 usage read (L-04): the caller supplies the read as a closure; the
      // in-memory store has no allocation locks, but the read still happens
      // after the caller's own evaluation would have — parity with the real
      // transaction, which reads under the advisory locks.
      const usage = command.readUsage ? await command.readUsage() : null;
      const evaluation = evaluateImportConflicts({
        candidate: {
          validFrom: command.validFrom,
          validUntil: command.validUntil,
          licenseId: command.licenseId,
          licenseType: command.licenseType ?? 'COMMERCIAL',
          customerId: command.customerId,
          customerCode: command.customerCode,
          developerId: command.developerId ?? null,
          developerName: command.developerName ?? null,
          organizationLimit: command.organizationLimit,
          userLimit: command.userLimit,
          deviceLimit: command.deviceLimit,
          deviceLimitSpecified: command.deviceLimitSpecified,
          entitlements: command.entitlements,
        },
        operationId: command.operationId,
        documentHash: command.documentHash,
        supersession: command.supersession,
        versions: retained,
        at: command.now,
        installationCustomerId,
        installationCustomerCode,
        knownCustomers,
        customerTransfer: command.customerTransfer,
        usage,
        gapRecovery: command.gapRecovery,
        reductionResolution: command.reductionResolution,
      });
      if (evaluation.conflict !== null) {
        throw new ImportConflictError(evaluation.conflict);
      }
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
      // The real repository refuses a command whose `governs_from` disagrees
      // with the authoritative evaluation; the fake mirrors it so a service
      // that derived the instant itself cannot pass the hermetic suite.
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

      if (
        (command.licenseType ?? 'COMMERCIAL') === 'COMMERCIAL' &&
        command.customerId !== null &&
        command.customerCode !== null &&
        command.customerName !== null &&
        !customerRecords.has(command.customerId)
      ) {
        for (const existing of customerRecords.values()) {
          if (existing.customerCode === command.customerCode) {
            throw new ImportConflictError({
              reason: 'customer-code-mismatch',
              overlapping: 0,
            });
          }
        }
        const record: LicenseCustomer = {
          customerId: command.customerId,
          customerCode: command.customerCode,
          displayName: command.customerName,
          createdAt: command.now,
          updatedAt: command.now,
        };
        customerRecords.set(command.customerId, record);
        customers.set(command.customerId, command.customerName);
        customerCodes.set(command.customerId, command.customerCode);
      }
      const previousCustomerId = installationCustomerId;
      const previousCustomerCode = installationCustomerCode;
      const bindingChanged =
        self !== null &&
        self.installationId === command.installationId &&
        previousCustomerId !== command.customerId;
      // L-06 (PDR-14 §3.5.4): the license governing immediately before an
      // explicit transfer, resolved from the retained versions this call read —
      // the same authority and the same rule the real repository applies under
      // the installation lock.
      const previousLicenseId =
        command.customerTransfer !== null && bindingChanged
          ? (resolveEffectiveVersion(retained, command.now).version
              ?.licenseId ?? null)
          : null;
      if (bindingChanged && self !== null) {
        self = { ...self, customerId: command.customerId };
      }
      // The typed transfer and dedicated-operation events are written by the
      // transaction, exactly like the real repository does — from the values
      // the locks protect.
      const recovery =
        command.gapRecovery != null
          ? {
              lapsedLicenseId:
                lapsedLicenseContext(retained)?.licenseId ?? null,
              coverageEnd: lapsedLicenseContext(retained)?.coverageEnd ?? null,
            }
          : null;
      const resolution =
        command.reductionResolution != null
          ? (() => {
              // The evaluation's resolution subject: the retired predecessor,
              // or — L-05 — the continuation baseline of a renewal that
              // retires nothing. Never stamped (see the real repository).
              const predecessor = evaluation.resolutionSubject;
              if (predecessor === null) {
                throw new Error(
                  'A reduction resolution was applied without a resolution subject.',
                );
              }
              return {
                predecessorVersionId: predecessor.versionId,
                conflicts: reductionConflicts(
                  predecessor,
                  {
                    organizationLimit: command.organizationLimit,
                    userLimit: command.userLimit,
                    deviceLimit: command.deviceLimit,
                    deviceLimitSpecified: command.deviceLimitSpecified,
                    entitlements: command.entitlements,
                  },
                  usage ?? null,
                ),
              };
            })()
          : null;
      const auditEvents = [
        ...(bindingChanged && previousCustomerId !== null
          ? [
              transferAuditEvent(
                command,
                previousCustomerId,
                previousCustomerCode,
                previousLicenseId,
              ),
            ]
          : []),
        ...command.auditEvents,
        ...(recovery !== null
          ? [
              recoveryAuditEvent(
                command,
                recovery.coverageEnd !== null &&
                  recovery.lapsedLicenseId !== null
                  ? {
                      licenseId: recovery.lapsedLicenseId,
                      coverageEnd: recovery.coverageEnd,
                    }
                  : null,
              ),
            ]
          : []),
        ...(resolution !== null
          ? [
              resolutionAuditEvent(
                command,
                resolution.predecessorVersionId,
                resolution.conflicts,
              ),
            ]
          : []),
        ...(evaluation.renewal !== null
          ? [
              renewalAuditEvent(
                command,
                evaluation.renewal,
                supersedes !== null &&
                  supersedes.licenseId !== command.licenseId
                  ? supersedes.licenseId
                  : null,
              ),
            ]
          : []),
      ];
      const created: RetainedLicenseVersion = {
        versionId: command.versionId,
        licenseId: command.licenseId,
        licenseType: command.licenseType ?? 'COMMERCIAL',
        customerId: command.customerId,
        customerCode: command.customerCode,
        developerId: command.developerId ?? null,
        developerName: command.developerName ?? null,
        installationId: command.installationId,
        operationId: command.operationId,
        status: command.status,
        provider: command.provider,
        documentVersion: command.documentVersion,
        documentHash: command.documentHash,
        keyId: command.keyId,
        validFrom: command.validFrom,
        governsFrom: command.governsFrom,
        validUntil: command.validUntil,
        organizationLimit: command.organizationLimit,
        userLimit: command.userLimit,
        deviceLimit: command.deviceLimit,
        deviceLimitSpecified: command.deviceLimitSpecified,
        entitlements: command.entitlements.map((entry) => ({ ...entry })),
        supersededAt: null,
        governsUntil: null,
        supersededByVersionId: null,
        supersedesVersionId: supersedes?.versionId ?? null,
        importedAt: command.now,
        source: command.source,
      };
      // The real unique indexes fire on this insert: a duplicate operation (or
      // artifact) that somehow passed the evaluation still cannot create two
      // versions.
      if (
        versions.some(
          (version) =>
            version.installationId === command.installationId &&
            version.operationId === command.operationId,
        )
      ) {
        throw uniqueViolation('installation_id, operation_id');
      }
      if (
        versions.some(
          (version) =>
            version.installationId === command.installationId &&
            version.documentHash === command.documentHash,
        )
      ) {
        throw uniqueViolation('installation_id, document_hash');
      }
      versions.push(created);
      signedIssuedAt.set(created.versionId, command.signedIssuedAt);

      // The stamp follows the version row, exactly like the real transaction
      // (`superseded_by_version_id` has a foreign key to the new row).
      if (supersedes !== null) {
        const target = versions.find(
          (version) => version.versionId === supersedes.versionId,
        );
        if (target === undefined || target.supersededAt !== null) {
          // The real transaction aborts on a guarded zero-row update.
          throw new ImportConflictError({
            reason: 'unknown-supersession',
            overlapping: 0,
          });
        }
        target.supersededAt = command.now;
        target.governsUntil = supersessionCeaseInstant(command);
        target.supersededByVersionId = command.versionId;
      }

      for (const event of auditEvents) {
        recordEvent(event);
      }
      return {
        version: cloneVersion(created),
        previousCustomerId,
        previousCustomerCode,
        bindingChanged,
        previousLicenseId,
        recovery,
        resolution,
      };
    },

    async findCustomer(
      customerId: string,
    ): Promise<{ customerId: string; customerCode: string } | null> {
      const record = customerRecords.get(customerId);
      return record === undefined
        ? null
        : { customerId: record.customerId, customerCode: record.customerCode };
    },

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
      const retained = versions.filter(
        (version) => version.licenseId === licenseId,
      );
      if (retained.length === 0) return null;
      const first = retained[0] as RetainedLicenseVersion;
      const state = revoked.get(licenseId);
      return {
        licenseId,
        installationId: first.installationId,
        customerId: first.customerId,
        revokedAt: state?.revokedAt ?? null,
        revocationId: state?.revocationId ?? null,
        versions: retained.map((version) => ({
          versionId: version.versionId,
          operationId: version.operationId,
          signedIssuedAt: signedIssuedAt.get(version.versionId) ?? null,
        })),
      };
    },

    async findLicenseRevocationState(
      licenseId: string,
    ): Promise<{ revokedAt: Date | null } | null> {
      if (!versions.some((version) => version.licenseId === licenseId)) {
        return null;
      }
      return { revokedAt: revoked.get(licenseId)?.revokedAt ?? null };
    },

    async findRevocation(
      revocationId: string,
    ): Promise<LicenseRevocationRecord | null> {
      const row = revocations.find(
        (candidate) => candidate.revocationId === revocationId,
      );
      return row === undefined ? null : { ...row };
    },

    async findRevocationForLicense(
      licenseId: string,
    ): Promise<LicenseRevocationRecord | null> {
      const row = revocations.find(
        (candidate) => candidate.licenseId === licenseId,
      );
      return row === undefined ? null : { ...row };
    },

    async applyRevocation(command: ApplyRevocationCommand): Promise<{
      revocation: LicenseRevocationRecord;
      alreadyApplied: boolean;
    }> {
      const existing = revocations.find(
        (candidate) => candidate.revocationId === command.revocationId,
      );
      if (existing !== undefined) {
        if (
          existing.canonicalPayloadSha256 !== command.canonicalPayloadSha256 ||
          existing.licenseId !== command.licenseId
        ) {
          throw new RevocationConflictError('conflicting-replay');
        }
        return { revocation: { ...existing }, alreadyApplied: true };
      }
      const forLicense = revocations.find(
        (candidate) => candidate.licenseId === command.licenseId,
      );
      if (forLicense !== undefined) {
        throw new RevocationConflictError('already-revoked', {
          revocationId: forLicense.revocationId,
          revokedAt: forLicense.importedAt.toISOString(),
        });
      }
      const retained = versions.filter(
        (version) => version.licenseId === command.licenseId,
      );
      if (
        retained.length === 0 ||
        retained[0]?.installationId !== command.installationId ||
        retained[0]?.customerId !== command.customerId
      ) {
        throw new RevocationConflictError('unknown-target');
      }
      if (revoked.has(command.licenseId)) {
        const state = revoked.get(command.licenseId);
        throw new RevocationConflictError('already-revoked', {
          revocationId: state?.revocationId ?? command.licenseId,
          revokedAt:
            state?.revokedAt.toISOString() ?? command.now.toISOString(),
        });
      }
      const row: LicenseRevocationRecord = {
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
      };
      revocations.push(row);
      revoked.set(command.licenseId, {
        revokedAt: command.now,
        revocationId: command.revocationId,
      });
      recordEvent({
        installationId: command.installationId,
        eventType: 'license.revocation.imported',
        outcome: 'APPLIED',
        operationId: command.targetOperationId,
        licenseId: command.licenseId,
        versionId: command.targetVersionId,
        actorId: command.actorId,
        source: command.source,
        documentHash: command.artifactSha256,
        reason: command.reason,
        detail: command.detail,
        revocationId: command.revocationId,
        occurredAt: command.now,
      });
      return { revocation: { ...row }, alreadyApplied: false };
    },

    async recordAuditEvent(event: LicenseAuditEventCommand): Promise<void> {
      recordEvent(event);
    },

    async listAuditEvents(
      installationId: string,
      limit = 100,
    ): Promise<LicenseAuditEventRow[]> {
      return auditEvents
        .filter((event) => event.installationId === installationId)
        .slice(0, limit)
        .map((event) => ({ ...event }));
    },
  } as unknown as LicensesRepository;

  function recordEvent(event: LicenseAuditEventCommand): void {
    eventCounter += 1;
    auditEvents.push({
      ...event,
      id: `audit-${String(eventCounter).padStart(6, '0')}`,
    });
  }

  return {
    installations,
    licenses,
    versions,
    auditEvents,
    revocations,
    revoked,
    self: () => (self === null ? null : { ...self }),
    customers,
    customerCodes,
    customerRecords,
  };
}

function cloneVersion(version: RetainedLicenseVersion): RetainedLicenseVersion {
  return {
    ...version,
    entitlements: version.entitlements.map((entry) => ({ ...entry })),
  };
}
