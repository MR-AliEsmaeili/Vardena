import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import type {
  EntitlementKind,
  InstallationLicense,
  LicenseStatus,
} from '../domain/license.js';

/**
 * Data access for `licensing.licenses` + `licensing.license_entitlements`
 * + `licensing.customers` (AR-07: the Licensing module owns these tables and
 * no other module reads them).
 *
 * The *current* license of an installation is the single row with
 * `replaced_at IS NULL`; a partial unique index makes that a database
 * guarantee rather than a convention. Replacement never deletes history: the
 * previous row is stamped `replaced_at` and stays for audit.
 *
 * What is NOT stored: the raw license code. Only its SHA-256 hash is written
 * (`code_hash`), which is all that idempotent re-activation needs. Nothing in
 * these tables can be turned back into a usable license code.
 */

export interface PersistedLicense extends InstallationLicense {
  codeHash: string;
  activatedAt: Date;
}

export interface ActivateLicenseCommand {
  installationId: string;
  customerId: string;
  customerName: string;
  license: InstallationLicense;
  /**
   * SHA-256 of the submitted code. The raw code is deliberately NOT part of
   * this command: it never leaves the activation service.
   */
  codeHash: string;
  activatedBy: string | null;
  now: Date;
}

interface LicenseRow {
  id: string;
  installationId: string;
  customerId: string;
  status: LicenseStatus;
  provider: string;
  codeHash: string;
  validFrom: Date;
  validUntil: Date | null;
  organizationLimit: number | null;
  userLimit: number | null;
  activatedAt: Date;
  entitlements: Array<{ kind: EntitlementKind; code: string }>;
}

interface LicenseDelegate {
  findFirst(args: {
    where: { installationId: string; replacedAt: null };
    include: { entitlements: { select: { kind: true; code: true } } };
  }): Promise<LicenseRow | null>;
  updateMany(args: {
    where: { installationId: string; replacedAt: null };
    data: { replacedAt: Date; updatedAt: Date };
  }): Promise<{ count: number }>;
  create(args: {
    data: {
      id: string;
      installationId: string;
      customerId: string;
      status: LicenseStatus;
      provider: string;
      codeHash: string;
      validFrom: Date;
      validUntil: Date | null;
      organizationLimit: number | null;
      userLimit: number | null;
      activatedAt: Date;
      activatedBy: string | null;
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
    include: { entitlements: { select: { kind: true; code: true } } };
  }): Promise<LicenseRow>;
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

interface InstallationDelegate {
  update(args: {
    where: { id: string };
    data: { customerId: string; updatedAt: Date };
  }): Promise<unknown>;
}

interface Tx {
  license: LicenseDelegate;
  licenseCustomer: CustomerDelegate;
  installation: InstallationDelegate;
}

type Client = Tx & {
  $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
};

@Injectable()
export class LicensesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  /** The persisted current license of the installation, or null. */
  async findCurrent(installationId: string): Promise<PersistedLicense | null> {
    const client = await this.client();
    const row = await client.license.findFirst({
      where: { installationId, replacedAt: null },
      include: { entitlements: { select: { kind: true, code: true } } },
    });
    return row === null ? null : toPersisted(row);
  }

  /**
   * Persist an activation as ONE transaction: the commercial customer, the
   * installation → customer binding, the replacement stamp on the previous
   * current license, and the new license with its entitlements. A partial
   * failure can therefore never leave an installation with two current
   * licenses or with none after it had a valid one.
   */
  async activate(command: ActivateLicenseCommand): Promise<PersistedLicense> {
    const client = await this.client();
    const row = await client.$transaction(async (tx) => {
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
      await tx.installation.update({
        where: { id: command.installationId },
        data: { customerId: command.customerId, updatedAt: command.now },
      });
      await tx.license.updateMany({
        where: { installationId: command.installationId, replacedAt: null },
        data: { replacedAt: command.now, updatedAt: command.now },
      });
      return tx.license.create({
        data: {
          id: command.license.licenseId,
          installationId: command.installationId,
          customerId: command.customerId,
          status: command.license.status,
          provider: command.license.provider,
          codeHash: command.codeHash,
          validFrom: command.license.validFrom,
          validUntil: command.license.validUntil,
          organizationLimit: command.license.organizationLimit,
          userLimit: command.license.userLimit,
          activatedAt: command.now,
          activatedBy: command.activatedBy,
          createdAt: command.now,
          updatedAt: command.now,
          entitlements: {
            create: command.license.entitlements.map((entitlement) => ({
              id: generateId(),
              kind: entitlement.kind,
              code: entitlement.code,
              createdAt: command.now,
              updatedAt: command.now,
            })),
          },
        },
        include: { entitlements: { select: { kind: true, code: true } } },
      });
    });
    return toPersisted(row);
  }
}

function toPersisted(row: LicenseRow): PersistedLicense {
  return {
    customerId: row.customerId,
    installationId: row.installationId,
    licenseId: row.id,
    status: row.status,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    organizationLimit: row.organizationLimit,
    userLimit: row.userLimit,
    entitlements: row.entitlements.map(({ kind, code }) => ({ kind, code })),
    provider: row.provider,
    codeHash: row.codeHash,
    activatedAt: row.activatedAt,
  };
}
