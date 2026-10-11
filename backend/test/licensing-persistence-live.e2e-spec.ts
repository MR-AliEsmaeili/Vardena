import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { InstallationIdentityService } from '../src/modules/licensing/application/installation-identity.service.js';
import { LicensesRepository } from '../src/modules/licensing/data/licenses.repository.js';
import { LicenseActivationService } from '../src/modules/licensing/application/license-activation.service.js';
import { LicenseImportService } from '../src/modules/licensing/application/license-import.service.js';
import { LicensingService } from '../src/modules/licensing/application/licensing.service.js';
import {
  generateAuthorityKeyPair,
  issueLicenseCode,
  issueLicenseFile,
} from '../src/tools/development-license-authority.js';
import { createTestApp } from './support/test-app.js';

const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

/**
 * PostgreSQL proof of the retained-version model (L-03, ADR-0046).
 *
 * The hermetic suite (`license-import.e2e-spec.ts`) proves the behaviour
 * against in-memory stores; this one proves the SQL side of it: the real
 * tables, the real unique indexes (one operation per installation, one
 * artifact per installation, one `is_self` installation) and the real
 * transaction. A second application instance over the same database is the
 * restart.
 *
 * The rollback case is the one no in-memory store can prove: a failure inside
 * the import transaction must leave the previous state byte-identical — no
 * version, no supersession stamp, no `applied` audit row.
 */
describe.skipIf(DATABASE_URL === undefined)(
  'Licensing persistence (live PostgreSQL)',
  () => {
    const authority = generateAuthorityKeyPair();
    let app: INestApplication;
    let prisma: PrismaService;

    async function boot(): Promise<INestApplication> {
      const base = loadAppConfig();
      const built = await createTestApp({
        override: (builder) =>
          builder.overrideProvider(APP_CONFIG).useValue({
            ...base,
            databaseUrl: DATABASE_URL,
            licensing: {
              ...base.licensing,
              provider: 'persistent',
              signingPublicKeys: [authority.publicKey],
            },
          }),
      });
      return built.app;
    }

    async function cleanup(service: PrismaService): Promise<void> {
      const client = await service.getClient<{
        $executeRawUnsafe(query: string): Promise<unknown>;
      }>();
      await client.$executeRawUnsafe(
        'DELETE FROM "licensing"."license_version_entitlements"',
      );
      await client.$executeRawUnsafe(
        'DELETE FROM "licensing"."license_audit_events"',
      );
      await client.$executeRawUnsafe(
        'DELETE FROM "licensing"."license_versions"',
      );
      await client.$executeRawUnsafe('DELETE FROM "licensing"."licenses"');
      await client.$executeRawUnsafe('DELETE FROM "licensing"."installations"');
      await client.$executeRawUnsafe('DELETE FROM "licensing"."customers"');
    }

    beforeAll(async () => {
      app = await boot();
      prisma = app.get(PrismaService);
      await cleanup(prisma);
    }, 60_000);

    afterAll(async () => {
      if (app === undefined) return;
      try {
        await cleanup(prisma);
      } finally {
        await app.close();
      }
    }, 60_000);

    it('persists the identity and the retained version across a restart', async () => {
      // 1. Fresh installation: identity is created once, nothing is licensed.
      const identity = await app.get(InstallationIdentityService).current();
      expect(identity.installationId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      await expect(app.get(LicensingService).current()).resolves.toMatchObject({
        status: 'UNLICENSED',
        active: false,
        installationId: identity.installationId,
      });

      // 2. Import persists the version (direct service call: the HTTP
      //    authorization path is covered by the hermetic suite).
      const { code } = issueLicenseCode(
        {
          installationId: identity.installationId,
          customerName: 'Live customer',
          organizationLimit: 2,
          moduleEntitlements: ['organization', 'users'],
        },
        authority.privateKey,
      );
      const imported = await app.get(LicenseImportService).importDocument(code);
      expect(imported).toMatchObject({
        changed: true,
        outcome: 'APPLIED',
        license: { active: true, status: 'ACTIVE', organizationLimit: 2 },
      });

      // 3. Restart: a brand-new application over the same database.
      await app.close();
      app = await boot();
      prisma = app.get(PrismaService);

      const reloaded = await app.get(InstallationIdentityService).current();
      expect(reloaded.installationId).toBe(identity.installationId);
      expect(reloaded.customerId).not.toBeNull();

      await expect(app.get(LicensingService).current()).resolves.toMatchObject({
        licensed: true,
        status: 'ACTIVE',
        active: true,
        installationId: identity.installationId,
        organizationLimit: 2,
      });

      // 4. Re-submitting the same code stays idempotent across the restart.
      await expect(
        app.get(LicenseActivationService).activate(code),
      ).resolves.toMatchObject({ changed: false, outcome: 'UNCHANGED' });

      // 5. A replacement (a different legacy code) supersedes the governing
      //    version and keeps exactly one eligible version.
      const replacement = issueLicenseCode(
        {
          installationId: identity.installationId,
          customerName: 'Live customer',
          organizationLimit: 5,
          moduleEntitlements: ['organization', 'users'],
        },
        authority.privateKey,
      ).code;
      await expect(
        app.get(LicenseActivationService).activate(replacement),
      ).resolves.toMatchObject({
        changed: true,
        license: { organizationLimit: 5 },
      });

      const client = await prisma.getClient<{
        $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
      }>();
      const eligible = await client.$queryRawUnsafe<Array<{ count: bigint }>>(
        'SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions" WHERE "superseded_at" IS NULL',
      );
      expect(Number(eligible[0]?.count)).toBe(1);
      const retained = await client.$queryRawUnsafe<Array<{ count: bigint }>>(
        'SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"',
      );
      expect(Number(retained[0]?.count)).toBe(2);

      // The raw license code is never persisted, and neither is the document:
      // only its irreversible SHA-256 lives on the version row.
      const versionColumns = await client.$queryRawUnsafe<
        Array<{ name: string }>
      >(
        `SELECT column_name AS name FROM information_schema.columns
           WHERE table_schema = 'licensing' AND table_name = 'license_versions'`,
      );
      const names = versionColumns.map((column) => column.name);
      expect(names).toContain('document_hash');
      expect(names).not.toContain('document');
      expect(names).not.toContain('code');

      // `licenses` is now the license identity: no dates, no limits, no hash.
      const licenseColumns = await client.$queryRawUnsafe<
        Array<{ name: string }>
      >(
        `SELECT column_name AS name FROM information_schema.columns
           WHERE table_schema = 'licensing' AND table_name = 'licenses'`,
      );
      const licenseNames = licenseColumns.map((column) => column.name);
      expect(licenseNames).not.toContain('code_hash');
      expect(licenseNames).not.toContain('valid_until');
      expect(licenseNames).not.toContain('replaced_at');

      const leaked = await client.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
           WHERE "license_versions"::text LIKE '%VLIC1%'
              OR "license_versions"::text LIKE '%VLIC2%'`,
      );
      expect(Number(leaked[0]?.count)).toBe(0);

      const hashes = await client.$queryRawUnsafe<
        Array<{ document_hash: string }>
      >(
        `SELECT "document_hash" FROM "licensing"."license_versions"
           WHERE "superseded_at" IS NULL`,
      );
      expect(hashes[0]?.document_hash).toBe(
        createHash('sha256').update(replacement.trim(), 'utf8').digest('hex'),
      );

      // The audit trail recorded the applied / unchanged / superseded events.
      const events = await client.$queryRawUnsafe<
        Array<{ event_type: string; outcome: string }>
      >(
        `SELECT "event_type", "outcome" FROM "licensing"."license_audit_events"
           ORDER BY "occurred_at", "id"`,
      );
      expect(events.map((event) => event.event_type)).toEqual([
        'license.import.applied',
        'license.import.unchanged',
        'license.version.superseded',
        'license.import.applied',
      ]);
    }, 120_000);

    it('rejects a license bound to another installation against the real database', async () => {
      const foreign = issueLicenseCode(
        { installationId: '01K7OTHERINSTALLATION0000' },
        authority.privateKey,
      ).code;

      await expect(
        app.get(LicenseActivationService).activate(foreign),
      ).rejects.toThrow(/different Vardena installation/);

      await expect(app.get(LicensingService).current()).resolves.toMatchObject({
        active: true,
      });
    }, 60_000);

    it('retains a signed future-dated version and resolves it by date', async () => {
      const identity = await app.get(InstallationIdentityService).current();
      const renewal = issueLicenseFile(
        {
          installationId: identity.installationId,
          validFrom: new Date('2027-01-01T00:00:00.000Z'),
          validUntil: new Date('2028-01-01T00:00:00.000Z'),
          organizationLimit: 9,
        },
        authority.privateKey,
      );

      const imported = await app
        .get(LicenseImportService)
        .importDocument(renewal.file);
      expect(imported).toMatchObject({ changed: true, outcome: 'APPLIED' });

      // Today the previous version still governs; the renewal is scheduled.
      await expect(app.get(LicensingService).current()).resolves.toMatchObject({
        active: true,
      });
      await expect(
        app.get(LicensingService).current(new Date('2027-06-01T00:00:00.000Z')),
      ).resolves.toMatchObject({
        active: true,
        organizationLimit: 9,
      });
    }, 60_000);

    it('rolls a failed import back completely (no partial write)', async () => {
      const identity = await app.get(InstallationIdentityService).current();
      const client = await prisma.getClient<{
        $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
      }>();

      const countOf = async (table: string): Promise<number> => {
        const rows = await client.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."${table}"`,
        );
        return Number(rows[0]?.count);
      };

      const versionsBefore = await countOf('license_versions');
      const auditBefore = await countOf('license_audit_events');
      const existing = await client.$queryRawUnsafe<
        Array<{ operation_id: string }>
      >(`SELECT "operation_id" FROM "licensing"."license_versions" LIMIT 1`);
      const existingOperationId = existing[0]!.operation_id;

      // A forced failure at the LAST statement of the transaction: the audit
      // rows and the license identity are written before the version insert,
      // and the duplicate operation id makes the insert fail. Everything this
      // command wrote must disappear with the failed transaction.
      const now = new Date();
      await expect(
        app.get(LicensesRepository).importVersion({
          installationId: identity.installationId,
          actorId: '01K7ROLLBACKACTOR0000000000',
          now,
          licenseId: '01K7DOOMEDLICENSE000000000',
          customerId: '01K7DOOMEDCUSTOMER00000000',
          customerName: 'Doomed customer',
          versionId: '01K7DOOMEDVERSION000000000',
          // Deliberately collides with a retained operation.
          operationId: existingOperationId,
          status: 'ACTIVE',
          provider: 'persistent',
          documentVersion: 2,
          documentHash: 'doomed-artifact-hash',
          keyId: null,
          source: 'file',
          validFrom: new Date('2029-01-01T00:00:00.000Z'),
          validUntil: new Date('2030-01-01T00:00:00.000Z'),
          organizationLimit: null,
          userLimit: null,
          entitlements: [],
          supersedesVersionId: null,
          auditEvents: [
            {
              installationId: identity.installationId,
              eventType: 'license.import.applied',
              outcome: 'APPLIED',
              operationId: existingOperationId,
              licenseId: '01K7DOOMEDLICENSE000000000',
              versionId: '01K7DOOMEDVERSION000000000',
              actorId: '01K7ROLLBACKACTOR0000000000',
              source: 'file',
              documentHash: 'doomed-artifact-hash',
              reason: null,
              detail: null,
              occurredAt: now,
            },
          ],
        }),
      ).rejects.toThrow();

      expect(await countOf('license_versions')).toBe(versionsBefore);
      expect(await countOf('license_audit_events')).toBe(auditBefore);
      const doomedLicense = await client.$queryRawUnsafe<
        Array<{ count: bigint }>
      >(
        `SELECT COUNT(*)::bigint AS count FROM "licensing"."licenses" WHERE "id" = $1`,
        '01K7DOOMEDLICENSE000000000',
      );
      const doomedCustomer = await client.$queryRawUnsafe<
        Array<{ count: bigint }>
      >(
        `SELECT COUNT(*)::bigint AS count FROM "licensing"."customers" WHERE "id" = $1`,
        '01K7DOOMEDCUSTOMER00000000',
      );
      expect(Number(doomedLicense[0]?.count)).toBe(0);
      expect(Number(doomedCustomer[0]?.count)).toBe(0);
    }, 60_000);

    it('refuses a duplicate operation at the database level', async () => {
      const identity = await app.get(InstallationIdentityService).current();
      const document = issueLicenseFile(
        {
          installationId: identity.installationId,
          validFrom: new Date('2031-01-01T00:00:00.000Z'),
          validUntil: new Date('2032-01-01T00:00:00.000Z'),
        },
        authority.privateKey,
      );

      await app.get(LicenseImportService).importDocument(document.file);
      await expect(
        app.get(LicenseImportService).importDocument(document.file),
      ).rejects.toThrow(/already been imported/);

      const client = await prisma.getClient<{
        $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
      }>();
      const rows = await client.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions" WHERE "operation_id" = $1`,
        document.payload.operationId,
      );
      expect(Number(rows[0]?.count)).toBe(1);
    }, 60_000);
  },
);
