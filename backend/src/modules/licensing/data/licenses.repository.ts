import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import type {
  EntitlementKind,
  LicenseEntitlement,
  LicenseLimit,
  LicenseStatus,
} from '../domain/license.js';
import type {
  LicenseVersionSource,
  RetainedLicenseVersion,
} from '../domain/license-version.js';

/**
 * Data access for `licensing.licenses`, `licensing.license_versions`,
 * `licensing.license_version_entitlements` and `licensing.license_audit_events`
 * (AR-07: the Licensing module owns these tables and no other module reads
 * them).
 *
 * Two guarantees live here, not in the application layer:
 *
 * - **One transaction per import.** The commercial customer, the license
 *   identity, the supersession stamp, the version, its entitlements and the
 *   `applied` audit event are written together or not at all, so a failed
 *   import can neither deactivate a valid installation nor leave a half-applied
 *   version behind.
 * - **The replay guards are database constraints.** A version is unique by
 *   `(installation_id, operation_id)` and by `(installation_id,
 *   document_hash)`, so two concurrent imports of the same operation cannot
 *   create two versions even if both pass the read-side checks.
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
  /** Resolved by the application layer from the document's declaration. */
  supersedesVersionId: string | null;
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
  occurredAt: Date;
}

/**
 * The version a document declared as superseded was no longer eligible when
 * the transaction ran (a concurrent import won). The service turns this into a
 * conflict — never a silent skip and never a 500.
 */
export class SupersessionConflictError extends Error {
  constructor() {
    super(
      'The version named by this document is no longer eligible for supersession.',
    );
    this.name = 'SupersessionConflictError';
  }
}

export interface LicenseAuditEventRow extends LicenseAuditEventCommand {
  id: string;
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
      occurredAt: Date;
    }>
  >;
}

interface Tx {
  licenseVersion: VersionDelegate;
  licenseCustomer: CustomerDelegate;
  license: LicenseDelegate;
  installation: InstallationDelegate;
  licenseAuditEvent: AuditDelegate;
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

  /** Every retained version of the installation, oldest first. */
  async listVersions(
    installationId: string,
  ): Promise<RetainedLicenseVersion[]> {
    const client = await this.client();
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
  ): Promise<RetainedLicenseVersion> {
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
      await tx.license.upsert({
        where: { id: command.licenseId },
        create: {
          id: command.licenseId,
          installationId: command.installationId,
          customerId: command.customerId,
          createdAt: command.now,
          updatedAt: command.now,
        },
        update: { customerId: command.customerId, updatedAt: command.now },
      });
      // The installation keeps its commercial-customer binding (L-02), so an
      // operator can still see which customer this deployment belongs to.
      await tx.installation.update({
        where: { id: command.installationId },
        data: { customerId: command.customerId, updatedAt: command.now },
      });

      if (command.supersedesVersionId !== null) {
        // The application layer verified the target is retained and eligible;
        // this guarded update keeps that true under a concurrent import.
        const superseded = await tx.licenseVersion.updateMany({
          where: {
            id: command.supersedesVersionId,
            installationId: command.installationId,
            supersededAt: null,
          },
          data: {
            supersededAt: command.now,
            supersededByVersionId: command.versionId,
            updatedAt: command.now,
          },
        });
        if (superseded.count === 0) {
          throw new SupersessionConflictError();
        }
      }

      for (const event of command.auditEvents) {
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
            occurredAt: event.occurredAt,
            createdAt: event.occurredAt,
            updatedAt: event.occurredAt,
          },
        });
      }

      return tx.licenseVersion.create({
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
          supersedesVersionId: command.supersedesVersionId,
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
    });
    return toRetainedVersion(row);
  }

  /**
   * Append one audit event. Rejections are recorded through a separate insert
   * (they never share the state-change transaction), and the caller treats a
   * logging failure as secondary to the rejection itself.
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
        reason: command.reason,
        detail: command.detail,
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
      occurredAt: row.occurredAt,
    }));
  }
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
    supersededByVersionId: row.supersededByVersionId,
    supersedesVersionId: row.supersedesVersionId,
    importedAt: row.importedAt,
    source: row.source as LicenseVersionSource,
  };
}
