import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { AppException } from '../src/kernel/errors/app-exception.js';
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
 *
 * The concurrency cases at the end are the other thing no in-memory store can
 * prove (PDR-11 corrective review, Defect 2): concurrent imports of one
 * installation run on separate pooled connections, take the real
 * `FOR UPDATE` installation lock and must leave at most one committed version
 * window. The invariant is also re-asserted directly in SQL, so the proof does
 * not depend on the application agreeing with itself.
 */
/** The artifact `issueLicenseFile` returns (envelope + verified payload). */
type IssuedFile = ReturnType<typeof issueLicenseFile>;

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

    /** Parameterized raw SQL over the migrated database. */
    async function query<T>(sql: string, ...values: unknown[]): Promise<T[]> {
      const client = await prisma.getClient<{
        $queryRawUnsafe<TRow>(
          statement: string,
          ...args: unknown[]
        ): Promise<TRow[]>;
      }>();
      return client.$queryRawUnsafe<T>(sql, ...values);
    }

    async function count(sql: string, ...values: unknown[]): Promise<number> {
      const rows = await query<{ count: bigint }>(sql, ...values);
      return Number(rows[0]?.count ?? 0);
    }

    /**
     * The applied events of ONE installation, oldest first.
     *
     * Scoping the check to the installation is what makes it an invariant worth
     * asserting: the audit table also holds `rejected`, `unchanged` and
     * `license.version.superseded` rows, so counting the table (or counting
     * applied rows across installations) measures the history of everything
     * else that has ever run against this database rather than the race under
     * test.
     */
    async function appliedOperations(
      installationId: string,
    ): Promise<Array<string | null>> {
      const rows = await query<{ operation_id: string | null }>(
        `SELECT "operation_id" FROM "licensing"."license_audit_events"
          WHERE "event_type" = 'license.import.applied'
            AND "installation_id" = $1
          ORDER BY "occurred_at", "id"`,
        installationId,
      );
      return rows.map((row) => row.operation_id);
    }

    /** The installation's audit rows, for a failure message that names them. */
    async function auditTrail(installationId: string): Promise<string> {
      return JSON.stringify(
        await query(
          `SELECT "event_type", "outcome", "operation_id", "source", "occurred_at"
             FROM "licensing"."license_audit_events"
            WHERE "installation_id" = $1
            ORDER BY "occurred_at", "id"`,
          installationId,
        ),
      );
    }

    /** One import attempt and what it left behind. */
    interface ImportOutcome {
      document: IssuedFile;
      applied: boolean;
      /** HTTP status the caller would see (0 when the import applied). */
      status: number;
      message: string;
      reason: unknown;
    }

    async function importOutcome(document: IssuedFile): Promise<ImportOutcome> {
      try {
        await app.get(LicenseImportService).importDocument(document.file);
        return {
          document,
          applied: true,
          status: 0,
          message: '',
          reason: null,
        };
      } catch (error) {
        if (error instanceof AppException) {
          return {
            document,
            applied: false,
            status: error.getStatus(),
            message: error.message,
            reason: (error.details as { reason?: unknown } | null)?.reason,
          };
        }
        throw error;
      }
    }

    /**
     * Drive several imports at once on separate pooled connections. The pool
     * is warmed first so the race is not decided by connection setup.
     */
    async function raceImports(
      documents: readonly IssuedFile[],
    ): Promise<ImportOutcome[]> {
      await app.get(LicensingService).current();
      return Promise.all(documents.map((document) => importOutcome(document)));
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
      //    version and keeps exactly one eligible version. Its window ends
      //    exactly where the future-dated renewal of the next case begins
      //    (half-open `[validFrom, validUntil)`), so that renewal is a
      //    non-overlapping renewal rather than an overlapping range.
      const replacement = issueLicenseCode(
        {
          installationId: identity.installationId,
          customerName: 'Live customer',
          organizationLimit: 5,
          moduleEntitlements: ['organization', 'users'],
          validUntil: new Date('2027-01-01T00:00:00.000Z'),
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

    it('refuses a duplicate operation inside the transaction and writes nothing', async () => {
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

      // The authoritative in-transaction evaluation refuses the duplicate
      // BEFORE anything is written: the customer, the license identity, the
      // version, its entitlements and the audit rows must all stay absent.
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
          supersession: { kind: 'none' },
          expectedSupersessionVersionId: null,
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

    it('rolls a LATE failure back completely (no partial write)', async () => {
      const identity = await app.get(InstallationIdentityService).current();
      const countOf = async (table: string): Promise<number> =>
        count(`SELECT COUNT(*)::bigint AS count FROM "licensing"."${table}"`);

      const versionsBefore = await countOf('license_versions');
      const auditBefore = await countOf('license_audit_events');
      const licensesBefore = await countOf('licenses');
      const customersBefore = await countOf('customers');
      const installationsBefore = await countOf('installations');
      const now = new Date();

      // A failure AFTER the customer/license/installation writes: the
      // duplicated entitlement collides with the real unique index
      // `(version_id, kind, code)` while the version is being inserted, so the
      // transaction aborts with everything already written still uncommitted.
      await expect(
        app.get(LicensesRepository).importVersion({
          installationId: identity.installationId,
          actorId: '01K7ROLLBACKACTOR0000000000',
          now,
          licenseId: '01K7DOOMEDLICENSE000000000',
          customerId: '01K7DOOMEDCUSTOMER00000000',
          customerName: 'Doomed customer',
          versionId: '01K7DOOMEDVERSION000000001',
          operationId: 'doomed-operation-late-failure',
          status: 'ACTIVE',
          provider: 'persistent',
          documentVersion: 2,
          documentHash: 'doomed-artifact-hash-late',
          keyId: null,
          source: 'file',
          validFrom: new Date('2029-01-01T00:00:00.000Z'),
          validUntil: new Date('2030-01-01T00:00:00.000Z'),
          organizationLimit: null,
          userLimit: null,
          entitlements: [
            { kind: 'MODULE', code: 'accounting' },
            { kind: 'MODULE', code: 'accounting' },
          ],
          supersession: { kind: 'none' },
          expectedSupersessionVersionId: null,
          auditEvents: [
            {
              installationId: identity.installationId,
              eventType: 'license.import.applied',
              outcome: 'APPLIED',
              operationId: 'doomed-operation-late-failure',
              licenseId: '01K7DOOMEDLICENSE000000000',
              versionId: '01K7DOOMEDVERSION000000001',
              actorId: '01K7ROLLBACKACTOR0000000000',
              source: 'file',
              documentHash: 'doomed-artifact-hash-late',
              reason: null,
              detail: null,
              occurredAt: now,
            },
          ],
        }),
      ).rejects.toThrow();

      // Nothing this command wrote survives: no version, no entitlement, no
      // customer/license identity, no applied audit event.
      expect(await countOf('license_versions')).toBe(versionsBefore);
      expect(await countOf('license_audit_events')).toBe(auditBefore);
      expect(await countOf('licenses')).toBe(licensesBefore);
      expect(await countOf('customers')).toBe(customersBefore);
      expect(await countOf('installations')).toBe(installationsBefore);
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_version_entitlements"
            WHERE "version_id" = $1`,
          '01K7DOOMEDVERSION000000001',
        ),
      ).toBe(0);
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
    // -----------------------------------------------------------------------
    // Concurrency (PDR-11 corrective review, Defect 2)
    // -----------------------------------------------------------------------

    it('commits exactly one of two concurrent imports with the same window', async () => {
      const identity = await app.get(InstallationIdentityService).current();
      // Far-future windows on purpose: the race must not depend on the wall
      // clock, and these must not overlap the cases above.
      const rounds = [
        { from: '2033-01-01T00:00:00.000Z', until: '2033-07-01T00:00:00.000Z' },
        { from: '2033-07-01T00:00:00.000Z', until: '2034-01-01T00:00:00.000Z' },
        { from: '2034-01-01T00:00:00.000Z', until: '2034-07-01T00:00:00.000Z' },
      ];

      for (const [index, round] of rounds.entries()) {
        const window = {
          validFrom: new Date(round.from),
          validUntil: new Date(round.until),
        };
        // Two DISTINCT documents (different operations, different artifacts)
        // that claim the same window: the database constraints alone cannot
        // tell them apart, only the locked evaluation can.
        const left = issueLicenseFile(
          {
            installationId: identity.installationId,
            ...window,
            organizationLimit: 20 + index,
          },
          authority.privateKey,
        );
        const right = issueLicenseFile(
          {
            installationId: identity.installationId,
            ...window,
            organizationLimit: 30 + index,
          },
          authority.privateKey,
        );
        const appliedBefore = await appliedOperations(identity.installationId);

        const outcomes = await raceImports([left, right]);

        const winner = outcomes.find((outcome) => outcome.applied);
        const loser = outcomes.find((outcome) => !outcome.applied);
        expect(winner).toBeDefined();
        expect(loser).toBeDefined();
        // The loser gets the documented conflict…
        expect(loser).toMatchObject({ status: 409 });
        expect(loser?.message).toMatch(/overlaps/);
        // …and the winner is the ONLY version of that window.
        expect(
          await count(
            `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
              WHERE "operation_id" = $1`,
            winner!.document.payload.operationId,
          ),
        ).toBe(1);
        expect(
          await count(
            `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
              WHERE "operation_id" = $1`,
            loser!.document.payload.operationId,
          ),
        ).toBe(0);
        // No partial write: one applied event (the winner's), the loser's
        // attempt left no version, no entitlement, no supersession stamp and
        // no applied event.
        expect(
          await count(
            `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_audit_events"
              WHERE "event_type" = 'license.import.applied' AND "operation_id" = $1`,
            winner!.document.payload.operationId,
          ),
        ).toBe(1);
        expect(
          await count(
            `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_audit_events"
              WHERE "event_type" = 'license.import.applied' AND "operation_id" = $1`,
            loser!.document.payload.operationId,
          ),
        ).toBe(0);
        // Exactly ONE applied event was added, and it is the winner's: the
        // loser's refusal is written as a `license.import.rejected` row, never
        // as an applied one (a rejection must not look like an application).
        const appliedAfter = await appliedOperations(identity.installationId);
        expect(appliedAfter, await auditTrail(identity.installationId)).toEqual(
          [...appliedBefore, winner!.document.payload.operationId],
        );
        expect(
          await count(
            `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions" AS version
              WHERE NOT EXISTS (
                SELECT 1 FROM "licensing"."license_version_entitlements" AS entitlement
                 WHERE entitlement."version_id" = version."id"
              )
                AND NOT EXISTS (
                SELECT 1 FROM "licensing"."license_versions" AS other
                 WHERE other."installation_id" = version."installation_id"
                   AND other."id" <> version."id"
              )`,
          ),
        ).toBe(0);
        // No supersession was recorded by a losing importer.
        expect(
          await count(
            `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
              WHERE "superseded_at" IS NULL AND "superseded_by_version_id" IS NOT NULL`,
          ),
        ).toBe(0);

        // The read path agrees once the race is over: one effective version,
        // the winner's limits, no ambiguity.
        const mid = new Date(new Date(round.from).getTime() + 86_400_000);
        const evaluated = await app.get(LicensingService).current(mid);
        expect(evaluated).toMatchObject({ active: true });
        expect(evaluated.organizationLimit).toBe(
          winner!.document === left ? 20 + index : 30 + index,
        );
      }
    }, 90_000);

    it('applies a replayed document exactly once under concurrency', async () => {
      const identity = await app.get(InstallationIdentityService).current();
      const document = issueLicenseFile(
        {
          installationId: identity.installationId,
          validFrom: new Date('2035-01-01T00:00:00.000Z'),
          validUntil: new Date('2036-01-01T00:00:00.000Z'),
          organizationLimit: 40,
        },
        authority.privateKey,
      );

      const outcomes = await raceImports([document, document]);

      expect(outcomes.filter((outcome) => outcome.applied)).toHaveLength(1);
      const loser = outcomes.find((outcome) => !outcome.applied);
      expect(loser).toMatchObject({ status: 409 });
      expect(loser?.message).toMatch(/already been imported|already imported/);
      // Per-operation AND per-document replay protection survived the race.
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "operation_id" = $1`,
          document.payload.operationId,
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "operation_id" = $1 OR "document_hash" = $2`,
          document.payload.operationId,
          createHash('sha256')
            .update(document.file.trim(), 'utf8')
            .digest('hex'),
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_audit_events"
            WHERE "event_type" = 'license.import.applied' AND "operation_id" = $1`,
          document.payload.operationId,
        ),
      ).toBe(1);
    }, 60_000);

    it('lets exactly one of two concurrent successors retire a version', async () => {
      const identity = await app.get(InstallationIdentityService).current();
      // A scheduled version nobody has retired yet: the shared target.
      const target = issueLicenseFile(
        {
          installationId: identity.installationId,
          validFrom: new Date('2036-07-01T00:00:00.000Z'),
          validUntil: new Date('2037-01-01T00:00:00.000Z'),
          organizationLimit: 50,
        },
        authority.privateKey,
      );
      await app.get(LicenseImportService).importDocument(target.file);

      const left = issueLicenseFile(
        {
          installationId: identity.installationId,
          validFrom: new Date('2036-10-01T00:00:00.000Z'),
          validUntil: new Date('2037-01-01T00:00:00.000Z'),
          organizationLimit: 51,
          supersedesOperationId: target.payload.operationId,
        },
        authority.privateKey,
      );
      const right = issueLicenseFile(
        {
          installationId: identity.installationId,
          validFrom: new Date('2036-08-01T00:00:00.000Z'),
          validUntil: new Date('2037-01-01T00:00:00.000Z'),
          organizationLimit: 52,
          supersedesOperationId: target.payload.operationId,
        },
        authority.privateKey,
      );

      const outcomes = await raceImports([left, right]);

      const winner = outcomes.find((outcome) => outcome.applied);
      const loser = outcomes.find((outcome) => !outcome.applied);
      expect(winner).toBeDefined();
      // The version is retired ONCE: the loser's document names a version
      // that can no longer be retired, and gets the documented conflict.
      expect(loser).toMatchObject({ status: 409 });
      expect(loser?.message).toMatch(
        /not a retained, eligible version|superseded by a concurrent import/,
      );

      // Exactly one successor row exists; the other attempt wrote nothing.
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "operation_id" IN ($1, $2)`,
          left.payload.operationId,
          right.payload.operationId,
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "operation_id" = $1`,
          loser!.document.payload.operationId,
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_audit_events"
            WHERE "event_type" = 'license.import.applied' AND "operation_id" = $1`,
          loser!.document.payload.operationId,
        ),
      ).toBe(0);

      // The target was retired by exactly the winner, and its hand-over is
      // the winner's own start — recorded-at and governs-until differ.
      const targetRow = await query<{
        id: string;
        superseded_by_version_id: string | null;
        superseded_at: Date | null;
        governs_until: Date | null;
      }>(
        `SELECT "id", "superseded_by_version_id", "superseded_at", "governs_until"
           FROM "licensing"."license_versions" WHERE "operation_id" = $1`,
        target.payload.operationId,
      );
      const winnerRow = await query<{ id: string }>(
        `SELECT "id" FROM "licensing"."license_versions" WHERE "operation_id" = $1`,
        winner!.document.payload.operationId,
      );
      expect(targetRow[0]?.superseded_by_version_id).toBe(winnerRow[0]?.id);
      expect(targetRow[0]?.superseded_at).not.toBeNull();
      expect(targetRow[0]?.governs_until?.toISOString()).toBe(
        winner!.document.payload.validFrom.toISOString(),
      );

      // The evaluation follows the hand-over exactly: the target governs one
      // millisecond before the winner starts, the winner from that instant on.
      const handover = winner!.document.payload.validFrom;
      await expect(
        app.get(LicensingService).current(new Date(handover.getTime() - 1)),
      ).resolves.toMatchObject({ active: true, organizationLimit: 50 });
      await expect(
        app.get(LicensingService).current(handover),
      ).resolves.toMatchObject({
        active: true,
        organizationLimit: winner!.document === left ? 51 : 52,
        licenseId: winner!.document.payload.licenseId,
      });
      // Nothing else was retired: exactly two rows carry a supersession — the
      // first case's replaced legacy code and this case's target.
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "superseded_at" IS NOT NULL`,
        ),
      ).toBe(2);
    }, 90_000);

    it('keeps every retained effective window disjoint', async () => {
      // The static invariant, checked in SQL rather than through the
      // application: `[valid_from, min(valid_until, governs_until))` of an
      // installation's retained versions must be pairwise non-overlapping, so
      // no instant can ever be governed twice.
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count
             FROM "licensing"."license_versions" AS a
             JOIN "licensing"."license_versions" AS b
               ON b."installation_id" = a."installation_id" AND b."id" > a."id"
            WHERE tstzrange(
                    a."valid_from",
                    LEAST(COALESCE(a."valid_until", 'infinity'::timestamptz),
                          COALESCE(a."governs_until", 'infinity'::timestamptz)),
                    '[)'
                  )
               && tstzrange(
                    b."valid_from",
                    LEAST(COALESCE(b."valid_until", 'infinity'::timestamptz),
                          COALESCE(b."governs_until", 'infinity'::timestamptz)),
                    '[)'
                  )`,
        ),
      ).toBe(0);
      // Recorded-at and governs-until are always set together (the pair check).
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE ("superseded_at" IS NULL) <> ("governs_until" IS NULL)`,
        ),
      ).toBe(0);
      // Every applied audit event has the version it claims to describe.
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_audit_events" AS event
            WHERE event."event_type" = 'license.import.applied'
              AND event."operation_id" IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM "licensing"."license_versions" AS version
                 WHERE version."operation_id" = event."operation_id"
              )`,
        ),
      ).toBe(0);
      // And no rejected attempt left any version behind.
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions" AS version
            WHERE NOT EXISTS (
              SELECT 1 FROM "licensing"."license_audit_events" AS event
               WHERE event."event_type" = 'license.import.applied'
                 AND event."operation_id" = version."operation_id"
            )`,
        ),
      ).toBe(0);
    }, 120_000);
  },
);
