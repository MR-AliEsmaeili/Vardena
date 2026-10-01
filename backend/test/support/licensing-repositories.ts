/**
 * In-memory stand-ins for the Licensing module's Prisma repositories.
 *
 * They model the two database guarantees the real tables carry, because the
 * behaviour under test depends on them:
 *   - at most one `is_self` installation row (partial unique index), and
 *   - at most one non-replaced license per installation (partial unique
 *     index) — replacement stamps the previous row instead of deleting it.
 *
 * The stores outlive the Nest application that uses them, which is exactly
 * what makes a restart testable: a second `createTestApp()` over the SAME
 * stores is the same installation with the same persisted license.
 */
import type { InstallationsRepository } from '../../src/modules/licensing/data/installations.repository.js';
import type {
  ActivateLicenseCommand,
  LicensesRepository,
  PersistedLicense,
} from '../../src/modules/licensing/data/licenses.repository.js';
import type { InstallationIdentity } from '../../src/modules/licensing/domain/installation.js';

export interface LicensingStores {
  installations: InstallationsRepository;
  licenses: LicensesRepository;
  /** Every license row ever activated, newest last (audit assertions). */
  rows: LicenseRow[];
  self: () => InstallationIdentity | null;
  customers: Map<string, string>;
}

interface LicenseRow extends PersistedLicense {
  replacedAt: Date | null;
  activatedBy: string | null;
}

export function createLicensingStores(
  seed: { installation?: InstallationIdentity } = {},
): LicensingStores {
  let self: InstallationIdentity | null = seed.installation ?? null;
  const rows: LicenseRow[] = [];
  const customers = new Map<string, string>();

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
    async findCurrent(
      installationId: string,
    ): Promise<PersistedLicense | null> {
      const row = rows.find(
        (candidate) =>
          candidate.installationId === installationId &&
          candidate.replacedAt === null,
      );
      return row === undefined ? null : clone(row);
    },
    async activate(command: ActivateLicenseCommand): Promise<PersistedLicense> {
      customers.set(command.customerId, command.customerName);
      if (self !== null && self.installationId === command.installationId) {
        self = { ...self, customerId: command.customerId };
      }
      for (const row of rows) {
        if (
          row.installationId === command.installationId &&
          row.replacedAt === null
        ) {
          row.replacedAt = command.now;
        }
      }
      const created: LicenseRow = {
        ...command.license,
        installationId: command.installationId,
        customerId: command.customerId,
        codeHash: command.codeHash,
        activatedAt: command.now,
        activatedBy: command.activatedBy,
        replacedAt: null,
      };
      rows.push(created);
      return clone(created);
    },
  } as unknown as LicensesRepository;

  return {
    installations,
    licenses,
    rows,
    self: () => (self === null ? null : { ...self }),
    customers,
  };
}

function clone(row: LicenseRow): PersistedLicense {
  return {
    customerId: row.customerId,
    installationId: row.installationId,
    licenseId: row.licenseId,
    status: row.status,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    organizationLimit: row.organizationLimit,
    userLimit: row.userLimit,
    entitlements: row.entitlements.map((entitlement) => ({ ...entitlement })),
    provider: row.provider,
    codeHash: row.codeHash,
    activatedAt: row.activatedAt,
  };
}
