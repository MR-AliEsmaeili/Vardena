import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { AppException } from '../src/kernel/errors/app-exception.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { InstallationIdentityService } from '../src/modules/licensing/application/installation-identity.service.js';
import {
  ImportConflictError,
  LicensesRepository,
  type ImportLicenseVersionCommand,
} from '../src/modules/licensing/data/licenses.repository.js';
import { licenseDocumentHash } from '../src/modules/licensing/domain/license-document.js';
import { generateId } from '../src/kernel/ids/ulid.js';
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
    /**
     * One installation belongs to one commercial customer (Owner decision
     * 2026-10-12, Q4). Every document this suite issues for the SELF
     * installation therefore names the same customer unless a test overrides it
     * on purpose to exercise the refusal or the explicit transfer.
     */
    const SELF_CUSTOMER = '01K7LIVECUSTOMER000000000000';
    let app: INestApplication;
    let prisma: PrismaService;

    /**
     * `issueLicenseFile` with the suite's commercial customer. Explicit
     * `customerId` in `options` still wins, which is how the tests that
     * exercise the customer rules build their documents.
     */
    function licenseFor(
      options: Parameters<typeof issueLicenseFile>[0],
      key: Parameters<typeof issueLicenseFile>[1] = authority.privateKey,
      file: { keyId?: string } = {},
    ): IssuedFile {
      return issueLicenseFile(
        { customerId: SELF_CUSTOMER, ...options },
        key,
        file,
      );
    }

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
          // The suite's customer: this first import is what binds the
          // installation, and every later document in this file names it.
          customerId: SELF_CUSTOMER,
          customerName: 'Live customer',
          organizationLimit: 2,
          moduleEntitlements: ['organization', 'users'],
          // Bounded on purpose: its end is where the signed renewal of the
          // `retains a signed future-dated version` case begins, so that
          // renewal is adjacent rather than an overlapping range.
          validUntil: new Date('2027-01-01T00:00:00.000Z'),
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

      // 5. A replacement text code that would take over from an instant that
      //    is already past is refused and writes nothing (OQ-86): the legacy
      //    transport cannot name the version it would retire, so the same
      //    fail-closed temporal rule protects the past here too.
      const backdated = issueLicenseCode(
        {
          installationId: identity.installationId,
          customerId: SELF_CUSTOMER,
          customerName: 'Live customer',
          organizationLimit: 5,
          moduleEntitlements: ['organization', 'users'],
        },
        authority.privateKey,
      ).code;
      await expect(
        app.get(LicenseActivationService).activate(backdated),
      ).rejects.toThrow(/already in the past/);

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
      // The refused replacement wrote nothing: one retained version, and it is
      // the one that governs.
      expect(Number(retained[0]?.count)).toBe(1);

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
        createHash('sha256').update(code.trim(), 'utf8').digest('hex'),
      );

      // The audit trail recorded the applied / unchanged / rejected events.
      const events = await client.$queryRawUnsafe<
        Array<{ event_type: string; outcome: string }>
      >(
        `SELECT "event_type", "outcome" FROM "licensing"."license_audit_events"
           ORDER BY "occurred_at", "id"`,
      );
      expect(events.map((event) => event.event_type)).toEqual([
        'license.import.applied',
        'license.import.unchanged',
        'license.import.rejected',
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
      const renewal = licenseFor(
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
          customerTransfer: null,
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
          customerTransfer: null,
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
      const document = licenseFor(
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
        const left = licenseFor(
          {
            installationId: identity.installationId,
            ...window,
            organizationLimit: 20 + index,
          },
          authority.privateKey,
        );
        const right = licenseFor(
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
      const document = licenseFor(
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
      const target = licenseFor(
        {
          installationId: identity.installationId,
          validFrom: new Date('2036-07-01T00:00:00.000Z'),
          validUntil: new Date('2037-01-01T00:00:00.000Z'),
          organizationLimit: 50,
        },
        authority.privateKey,
      );
      await app.get(LicenseImportService).importDocument(target.file);

      const left = licenseFor(
        {
          installationId: identity.installationId,
          validFrom: new Date('2036-10-01T00:00:00.000Z'),
          validUntil: new Date('2037-01-01T00:00:00.000Z'),
          organizationLimit: 51,
          supersedesOperationId: target.payload.operationId,
        },
        authority.privateKey,
      );
      const right = licenseFor(
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
      // Nothing else was retired: exactly one row carries a supersession —
      // this case's target. The legacy replacement of the first case was
      // refused by the temporal rule, so it never stamped anything.
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "superseded_at" IS NOT NULL`,
        ),
      ).toBe(1);
    }, 90_000);

    it('refuses a renewal that re-binds a license to another customer, and keeps the customer', async () => {
      const identity = await app.get(InstallationIdentityService).current();
      const licenseId = '01K7REBINDLICENSE00000000001';
      // The installation is already bound to the suite's customer, so the
      // first document must name it; only the refused renewal tries to move
      // the license to another customer.
      const customerA = SELF_CUSTOMER;
      const customerB = '01K7REBINDCUSTOMERB000000002';
      const first = licenseFor(
        {
          installationId: identity.installationId,
          licenseId,
          customerId: customerA,
          customerName: 'Customer A',
          validFrom: new Date('2050-01-01T00:00:00.000Z'),
          validUntil: new Date('2051-01-01T00:00:00.000Z'),
        },
        authority.privateKey,
      );
      const second = licenseFor(
        {
          installationId: identity.installationId,
          licenseId,
          customerId: customerB,
          customerName: 'Customer B',
          validFrom: new Date('2051-01-01T00:00:00.000Z'),
          validUntil: new Date('2052-01-01T00:00:00.000Z'),
        },
        authority.privateKey,
      );

      await expect(
        app.get(LicenseImportService).importDocument(first.file),
      ).resolves.toMatchObject({ changed: true, outcome: 'APPLIED' });

      const refused = await importOutcome(second);
      expect(refused).toMatchObject({
        applied: false,
        status: 409,
        reason: 'license-binding-conflict',
      });

      // The commercial identity was not re-bound, and the refused renewal left
      // no version and no applied event behind.
      expect(
        await query<{ customer_id: string }>(
          `SELECT "customer_id" FROM "licensing"."licenses" WHERE "id" = $1`,
          licenseId,
        ),
      ).toEqual([{ customer_id: customerA }]);
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "operation_id" = $1`,
          second.payload.operationId,
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_audit_events"
            WHERE "reason" = 'license-binding-conflict'`,
        ),
      ).toBeGreaterThanOrEqual(1);
    }, 60_000);

    it('refuses an explicit supersession that reduces capacity, in the transaction too (PDR-11 §8.6)', async () => {
      const identity = await app.get(InstallationIdentityService).current();
      const licenseId = '01K7REDUCELICENSE00000000001';
      const governing = licenseFor(
        {
          installationId: identity.installationId,
          licenseId,
          validFrom: new Date('2090-01-01T00:00:00.000Z'),
          validUntil: new Date('2091-01-01T00:00:00.000Z'),
          organizationLimit: 5,
          userLimit: 20,
        },
        authority.privateKey,
      );
      await expect(
        app.get(LicenseImportService).importDocument(governing.file),
      ).resolves.toMatchObject({ changed: true, outcome: 'APPLIED' });

      // The document names the version it retires and takes a limit away. The
      // signed name proves WHICH version is replaced; it cannot resolve a
      // capacity conflict, so the import is refused — by the SAME evaluation
      // the transaction re-runs under the installation lock.
      const reducing = licenseFor(
        {
          installationId: identity.installationId,
          licenseId,
          validFrom: new Date('2090-06-01T00:00:00.000Z'),
          validUntil: new Date('2091-06-01T00:00:00.000Z'),
          organizationLimit: 4,
          userLimit: 20,
          supersedesOperationId: governing.payload.operationId,
        },
        authority.privateKey,
      );

      const refused = await importOutcome(reducing);
      expect(refused).toMatchObject({
        applied: false,
        status: 409,
        reason: 'reduction-requires-resolution',
      });

      // Nothing was written and nothing was retired: one retained version for
      // this license, no stamp on it, no version for the refused operation, and
      // its limits are exactly what the applied document carried (no clamping).
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "license_id" = $1`,
          licenseId,
        ),
      ).toBe(1);
      expect(
        await query<{
          organization_limit: number;
          user_limit: number;
          superseded_at: string | null;
          governs_until: string | null;
          superseded_by_version_id: string | null;
        }>(
          `SELECT "organization_limit", "user_limit", "superseded_at",
                  "governs_until", "superseded_by_version_id"
             FROM "licensing"."license_versions" WHERE "license_id" = $1`,
          licenseId,
        ),
      ).toEqual([
        {
          organization_limit: 5,
          user_limit: 20,
          superseded_at: null,
          governs_until: null,
          superseded_by_version_id: null,
        },
      ]);
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "operation_id" = $1`,
          reducing.payload.operationId,
        ),
      ).toBe(0);
      expect(
        await query<{ reason: string }>(
          `SELECT "reason" FROM "licensing"."license_audit_events"
            WHERE "event_type" = 'license.import.rejected'
              AND "operation_id" = $1`,
          reducing.payload.operationId,
        ),
      ).toEqual([{ reason: 'reduction-requires-resolution' }]);

      // The guard is a reduction check, not a ban on explicit supersession: a
      // successor that keeps or grows the grant is still applied.
      const keeping = licenseFor(
        {
          installationId: identity.installationId,
          licenseId,
          validFrom: new Date('2090-06-01T00:00:00.000Z'),
          validUntil: new Date('2091-06-01T00:00:00.000Z'),
          organizationLimit: 9,
          userLimit: 20,
          supersedesOperationId: governing.payload.operationId,
        },
        authority.privateKey,
      );
      await expect(
        app.get(LicenseImportService).importDocument(keeping.file),
      ).resolves.toMatchObject({ changed: true, outcome: 'APPLIED' });
      const retired = await query<{ governs_until: Date | null }>(
        `SELECT "governs_until" FROM "licensing"."license_versions"
          WHERE "operation_id" = $1`,
        governing.payload.operationId,
      );
      expect(retired.map((row) => row.governs_until?.toISOString())).toEqual([
        '2090-06-01T00:00:00.000Z',
      ]);
    }, 60_000);

    it('refuses a license identifier that another installation owns, as a conflict and not a database error', async () => {
      const identity = await app.get(InstallationIdentityService).current();
      const client = await prisma.getClient<{
        $executeRawUnsafe(
          query: string,
          ...values: unknown[]
        ): Promise<unknown>;
      }>();
      const foreignCustomer = '01K7FOREIGNCUSTOMER0000000001';
      const foreignInstallation = '01K7FOREIGNINSTALLATION00001';
      const foreignLicense = '01K7FOREIGNLICENSE000000001';
      await client.$executeRawUnsafe(
        `INSERT INTO "licensing"."customers" ("id", "display_name", "created_at", "updated_at")
         VALUES ($1, 'Foreign customer', now(), now())`,
        foreignCustomer,
      );
      await client.$executeRawUnsafe(
        `INSERT INTO "licensing"."installations" ("id", "name", "is_self", "created_at", "updated_at")
         VALUES ($1, 'Foreign installation', false, now(), now())`,
        foreignInstallation,
      );
      await client.$executeRawUnsafe(
        `INSERT INTO "licensing"."licenses" ("id", "installation_id", "customer_id", "created_at", "updated_at")
         VALUES ($1, $2, $3, now(), now())`,
        foreignLicense,
        foreignInstallation,
        foreignCustomer,
      );

      // The document names THIS installation's own customer (an import never
      // re-binds it — Owner decision 2026-10-12, Q4), so the only rule left to
      // refuse it is the license identifier already belonging to another
      // installation. Nothing else about it conflicts.
      const document = licenseFor(
        {
          installationId: identity.installationId,
          licenseId: foreignLicense,
          customerId: SELF_CUSTOMER,
          customerName: 'Live customer',
          validFrom: new Date('2052-01-01T00:00:00.000Z'),
          validUntil: new Date('2053-01-01T00:00:00.000Z'),
        },
        authority.privateKey,
      );

      const outcome = await importOutcome(document);
      expect(outcome).toMatchObject({
        applied: false,
        status: 409,
        reason: 'license-binding-conflict',
      });
      expect(
        await query<{ installation_id: string }>(
          `SELECT "installation_id" FROM "licensing"."licenses" WHERE "id" = $1`,
          foreignLicense,
        ),
      ).toEqual([{ installation_id: foreignInstallation }]);
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "operation_id" = $1`,
          document.payload.operationId,
        ),
      ).toBe(0);
    }, 60_000);

    /**
     * The repository command for a document verified elsewhere. The race
     * cases drive the repository directly for the second installation, because
     * the import service only accepts documents of the installation it runs
     * for. The command carries the signed payload's identity and the hash of
     * the signed artifact, exactly as the service would build it.
     */
    function commandFor(
      installationId: string,
      issued: IssuedFile,
      customerName: string,
    ): ImportLicenseVersionCommand {
      const { payload } = issued;
      const now = new Date();
      const versionId = generateId();
      const documentHash = licenseDocumentHash(issued.document);
      return {
        installationId,
        actorId: null,
        now,
        licenseId: payload.licenseId,
        customerId: payload.customerId,
        customerName,
        versionId,
        operationId: payload.operationId,
        status: payload.status,
        provider: 'persistent',
        documentVersion: payload.version,
        documentHash,
        keyId: null,
        source: 'file',
        validFrom: payload.validFrom,
        validUntil: payload.validUntil,
        organizationLimit: payload.organizationLimit,
        userLimit: payload.userLimit,
        entitlements: [],
        supersession: { kind: 'none' },
        // Tests that exercise the explicit transfer set this explicitly; every
        // other command states "this import is not a transfer".
        customerTransfer: null,
        expectedSupersessionVersionId: null,
        // The service always commits the `applied` evidence with the version.
        auditEvents: [
          {
            installationId,
            eventType: 'license.import.applied',
            outcome: 'APPLIED',
            operationId: payload.operationId,
            licenseId: payload.licenseId,
            versionId,
            actorId: null,
            source: 'file',
            documentHash,
            reason: null,
            detail: null,
            occurredAt: now,
          },
        ],
      };
    }

    async function insertForeignInstallation(
      installationId: string,
    ): Promise<void> {
      const client = await prisma.getClient<{
        $executeRawUnsafe(
          query: string,
          ...values: unknown[]
        ): Promise<unknown>;
      }>();
      await client.$executeRawUnsafe(
        `INSERT INTO "licensing"."installations" ("id", "name", "is_self", "created_at", "updated_at")
         VALUES ($1, 'Foreign installation', false, now(), now())`,
        installationId,
      );
    }

    /** Wait until a backend is blocked on a lock inside the given table. */
    async function waitForLockWaitOn(table: string): Promise<void> {
      for (let attempt = 0; attempt < 400; attempt += 1) {
        const rows = await query<{ waiting: number }>(
          `SELECT COUNT(*)::int AS waiting FROM pg_stat_activity
            WHERE datname = current_database()
              AND wait_event_type = 'Lock'
              AND query ILIKE $1`,
          `%${table}%`,
        );
        if ((rows[0]?.waiting ?? 0) > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`no import reached a lock wait on ${table}`);
    }

    it('refuses a license identifier another installation committed while this import was in flight, as license-binding-conflict', async () => {
      // Two DISTINCT installations, one license identifier. The installation
      // row lock serializes imports of one installation only, so nothing but
      // the license identifier itself can stop both from claiming it.
      //
      // Deterministic interleaving: the self import is paused at its customer
      // write (a row lock held by this test). It has already read the
      // identifier as unused. The foreign installation then commits the
      // identifier. Released, the self import's insert must lose the race.
      const identity = await app.get(InstallationIdentityService).current();
      const selfInstallation = identity.installationId;
      const foreignInstallation = generateId();
      await insertForeignInstallation(foreignInstallation);
      const selfCustomer = generateId();
      const foreignCustomer = generateId();
      const client0 = await prisma.getClient<{
        $executeRawUnsafe(
          query: string,
          ...values: unknown[]
        ): Promise<unknown>;
        $transaction<T>(
          fn: (tx: {
            $queryRawUnsafe<TRow>(
              sql: string,
              ...args: unknown[]
            ): Promise<TRow[]>;
          }) => Promise<T>,
          options: { timeout: number; maxWait: number },
        ): Promise<T>;
      }>();
      await client0.$executeRawUnsafe(
        `INSERT INTO "licensing"."customers" ("id", "display_name", "created_at", "updated_at")
         VALUES ($1, 'Self customer', now(), now())`,
        selfCustomer,
      );
      // Test fixture: bind this installation to the customer the document will
      // name. A document may only name the binding it already has (a customer
      // change is the separate, explicit transfer operation), so the race under
      // test must be run on an installation whose binding matches its document.
      await client0.$executeRawUnsafe(
        `UPDATE "licensing"."installations" SET "customer_id" = $1, "updated_at" = now()
          WHERE "id" = $2`,
        selfCustomer,
        selfInstallation,
      );
      const installationBefore = await query<{ customer_id: string | null }>(
        `SELECT "customer_id" FROM "licensing"."installations" WHERE "id" = $1`,
        selfInstallation,
      );

      const license = generateId();
      const window = {
        validFrom: new Date('2060-01-01T00:00:00.000Z'),
        validUntil: new Date('2061-01-01T00:00:00.000Z'),
      };
      const selfDocument = licenseFor(
        {
          installationId: selfInstallation,
          licenseId: license,
          customerId: selfCustomer,
          // Deliberately different from the display name the fixture wrote, so
          // the post-race assertion proves the loser's customer write rolled
          // back and was not merely overwritten with the same value.
          customerName: 'Self customer (import)',
          ...window,
        },
        authority.privateKey,
      );
      const foreignDocument = licenseFor(
        {
          installationId: foreignInstallation,
          licenseId: license,
          customerId: foreignCustomer,
          customerName: 'Foreign customer',
          ...window,
        },
        authority.privateKey,
      );

      let holdAcquired!: () => void;
      const acquired = new Promise<void>((resolve) => {
        holdAcquired = resolve;
      });
      let releaseHold!: () => void;
      const released = new Promise<void>((resolve) => {
        releaseHold = resolve;
      });
      // The pause is the import's own first statement: `SELECT … FOR UPDATE`
      // on this installation's row. The self import therefore cannot have read
      // anything authoritative yet, and re-reads the winner's committed rows
      // when the lock is released.
      const holding = client0.$transaction(
        async (tx) => {
          await tx.$queryRawUnsafe(
            `SELECT "id" FROM "licensing"."installations" WHERE "id" = $1 FOR UPDATE`,
            selfInstallation,
          );
          holdAcquired();
          await released;
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
      await acquired;

      let selfOutcome: Promise<unknown>;
      let winnerLicense: string | null = null;
      try {
        selfOutcome = importOutcome(selfDocument).catch((error: unknown) => ({
          unhandled: error,
        }));
        await waitForLockWaitOn('"licensing"."installations"');
        const winner = await app
          .get(LicensesRepository)
          .importVersion(
            commandFor(
              foreignInstallation,
              foreignDocument,
              'Foreign customer',
            ),
          );
        winnerLicense = winner.version.licenseId;
      } finally {
        releaseHold();
        await holding;
      }
      expect(winnerLicense).toBe(license);

      const outcome = await selfOutcome;
      // The loser gets the documented 409 for a binding conflict: not a
      // duplicate, not an unhandled database error.
      expect(outcome).toMatchObject({
        applied: false,
        status: 409,
        reason: 'license-binding-conflict',
      });

      // The committed owner is the foreign installation, untouched.
      expect(
        await query<{ installation_id: string; customer_id: string }>(
          `SELECT "installation_id", "customer_id" FROM "licensing"."licenses" WHERE "id" = $1`,
          license,
        ),
      ).toEqual([
        { installation_id: foreignInstallation, customer_id: foreignCustomer },
      ]);
      // Exactly the winner's version; nothing from the loser.
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "license_id" = $1`,
          license,
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "operation_id" = $1`,
          selfDocument.payload.operationId,
        ),
      ).toBe(0);
      // The loser's customer write and installation update rolled back.
      expect(
        await query<{ display_name: string }>(
          `SELECT "display_name" FROM "licensing"."customers" WHERE "id" = $1`,
          selfCustomer,
        ),
      ).toEqual([{ display_name: 'Self customer' }]);
      expect(
        await query<{ customer_id: string | null }>(
          `SELECT "customer_id" FROM "licensing"."installations" WHERE "id" = $1`,
          selfInstallation,
        ),
      ).toEqual(installationBefore);
      // The refusal is audited as a rejection with its real reason.
      expect(
        await query<{ reason: string }>(
          `SELECT "reason" FROM "licensing"."license_audit_events"
            WHERE "event_type" = 'license.import.rejected'
              AND "operation_id" = $1`,
          selfDocument.payload.operationId,
        ),
      ).toEqual([{ reason: 'license-binding-conflict' }]);
    }, 120_000);

    it('lets exactly one of two installations keep a license identifier that both imports claim at once', async () => {
      // No forced interleaving: five rounds of simultaneous imports of two
      // signed documents for two installations sharing one fresh identifier.
      // Whatever the interleaving, the outcome must be the same: one committed
      // owner, the other import refused with the binding conflict.
      const identity = await app.get(InstallationIdentityService).current();
      const foreignInstallation = generateId();
      await insertForeignInstallation(foreignInstallation);
      const repository = app.get(LicensesRepository);
      // One customer per installation (Owner decision 2026-10-12, Q4): the
      // first import binds the foreign installation, so every later round must
      // name the same customer or it would be refused for the customer change
      // instead of for the identifier race under test. The self side names the
      // binding the installation actually has, whatever earlier tests left.
      const binding = await query<{ customer_id: string | null }>(
        `SELECT "customer_id" FROM "licensing"."installations" WHERE "id" = $1`,
        identity.installationId,
      );
      const selfCustomer = binding[0]?.customer_id ?? generateId();
      const foreignCustomer = generateId();

      for (const round of [0, 1, 2, 3, 4]) {
        const license = generateId();
        const window = {
          validFrom: new Date(`${2070 + round}-01-01T00:00:00.000Z`),
          validUntil: new Date(`${2070 + round}-07-01T00:00:00.000Z`),
        };
        const selfDocument = licenseFor(
          {
            installationId: identity.installationId,
            licenseId: license,
            // The installation's own customer: the race under test is about
            // the license identifier, not about a customer change.
            customerId: selfCustomer,
            customerName: `Self round ${round}`,
            ...window,
          },
          authority.privateKey,
        );
        const foreignDocument = licenseFor(
          {
            installationId: foreignInstallation,
            licenseId: license,
            customerId: foreignCustomer,
            customerName: `Foreign round ${round}`,
            ...window,
          },
          authority.privateKey,
        );

        const settled = await Promise.allSettled([
          repository.importVersion(
            commandFor(identity.installationId, selfDocument, `Self ${round}`),
          ),
          repository.importVersion(
            commandFor(
              foreignInstallation,
              foreignDocument,
              `Foreign ${round}`,
            ),
          ),
        ]);
        const applied = settled.filter(
          (
            result,
          ): result is PromiseFulfilledResult<
            Awaited<ReturnType<LicensesRepository['importVersion']>>
          > => result.status === 'fulfilled',
        );
        const lost = settled.filter(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected',
        );
        expect(applied, `round ${round}`).toHaveLength(1);
        expect(lost, `round ${round}`).toHaveLength(1);
        const loser = lost[0]!.reason;
        expect(loser, `round ${round}`).toBeInstanceOf(ImportConflictError);
        expect((loser as ImportConflictError).reason).toBe(
          'license-binding-conflict',
        );

        const winner = applied[0]!.value;
        expect(
          await query<{ installation_id: string; customer_id: string }>(
            `SELECT "installation_id", "customer_id" FROM "licensing"."licenses" WHERE "id" = $1`,
            license,
          ),
        ).toEqual([
          {
            installation_id: winner.version.installationId,
            customer_id: winner.version.customerId,
          },
        ]);
        expect(
          await count(
            `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
              WHERE "license_id" = $1`,
            license,
          ),
        ).toBe(1);
      }
    }, 120_000);

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
