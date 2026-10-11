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
 *   - supersession is a guarded stamp: a version that is already superseded
 *     cannot be superseded again inside one import (the real transaction
 *     aborts and the service answers 409).
 *
 * The stores outlive the Nest application that uses them, which is exactly
 * what makes a restart testable: a second `createTestApp()` over the SAME
 * stores is the same installation with the same retained versions.
 */
import type { InstallationsRepository } from '../../src/modules/licensing/data/installations.repository.js';
import type {
  ImportLicenseVersionCommand,
  LicenseAuditEventCommand,
  LicenseAuditEventRow,
  LicensesRepository,
} from '../../src/modules/licensing/data/licenses.repository.js';
import { SupersessionConflictError } from '../../src/modules/licensing/data/licenses.repository.js';
import type { InstallationIdentity } from '../../src/modules/licensing/domain/installation.js';
import type { RetainedLicenseVersion } from '../../src/modules/licensing/domain/license-version.js';

export interface LicensingStores {
  installations: InstallationsRepository;
  licenses: LicensesRepository;
  /** Every retained version ever imported, in import order. */
  versions: RetainedLicenseVersion[];
  /** Every audit event ever written, in write order. */
  auditEvents: LicenseAuditEventRow[];
  self: () => InstallationIdentity | null;
  customers: Map<string, string>;
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

    async importVersion(
      command: ImportLicenseVersionCommand,
    ): Promise<RetainedLicenseVersion> {
      // Unique guards first, exactly like the real indexes.
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

      if (command.supersedesVersionId !== null) {
        const target = versions.find(
          (version) => version.versionId === command.supersedesVersionId,
        );
        if (target === undefined || target.supersededAt !== null) {
          // The real transaction aborts on a guarded zero-row update.
          throw new SupersessionConflictError();
        }
        target.supersededAt = command.now;
        target.supersededByVersionId = command.versionId;
      }

      customers.set(command.customerId, command.customerName);
      if (self !== null && self.installationId === command.installationId) {
        self = { ...self, customerId: command.customerId };
      }
      const created: RetainedLicenseVersion = {
        versionId: command.versionId,
        licenseId: command.licenseId,
        customerId: command.customerId,
        installationId: command.installationId,
        operationId: command.operationId,
        status: command.status,
        provider: command.provider,
        documentVersion: command.documentVersion,
        documentHash: command.documentHash,
        keyId: command.keyId,
        validFrom: command.validFrom,
        validUntil: command.validUntil,
        organizationLimit: command.organizationLimit,
        userLimit: command.userLimit,
        entitlements: command.entitlements.map((entry) => ({ ...entry })),
        supersededAt: null,
        supersededByVersionId: null,
        supersedesVersionId: command.supersedesVersionId,
        importedAt: command.now,
        source: command.source,
      };
      versions.push(created);
      for (const event of command.auditEvents) {
        recordEvent(event);
      }
      return cloneVersion(created);
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
    self: () => (self === null ? null : { ...self }),
    customers,
  };
}

function cloneVersion(version: RetainedLicenseVersion): RetainedLicenseVersion {
  return {
    ...version,
    entitlements: version.entitlements.map((entry) => ({ ...entry })),
  };
}
