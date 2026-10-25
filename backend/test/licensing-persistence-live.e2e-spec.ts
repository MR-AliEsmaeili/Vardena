import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
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
import {
  serializeDeveloperLicenseFile,
  signDeveloperLicenseDocument,
  type DeveloperLicensePayload,
} from '../src/modules/licensing/domain/developer-license-document.js';
import { parsePrivateKey } from '../src/modules/licensing/domain/license-code.js';
import {
  canonicalizeRevocation,
  type RevocationPayload,
} from '../src/modules/licensing/domain/license-revocation.js';
import { LicenseRevocationService } from '../src/modules/licensing/application/license-revocation.service.js';
import { sign as cryptoSign, createPrivateKey } from 'node:crypto';
import { generateId } from '../src/kernel/ids/ulid.js';
import { LicenseActivationService } from '../src/modules/licensing/application/license-activation.service.js';
import { LicenseImportService } from '../src/modules/licensing/application/license-import.service.js';
import { PersistentLicenseProvider } from '../src/modules/licensing/application/persistent-license.provider.js';
import { LicensingService } from '../src/modules/licensing/application/licensing.service.js';
import { LICENSING_PERMISSIONS } from '../src/modules/licensing/domain/licensing-permissions.js';
import { RolesService } from '../src/modules/rbac/application/roles.service.js';
import { UserRolesService } from '../src/modules/rbac/application/user-roles.service.js';
import { UsersService } from '../src/modules/users/application/users.service.js';
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
    const developerAuthority = generateAuthorityKeyPair();
    const developerKeyId = 'developer-live-authority';
    /**
     * One installation belongs to one commercial customer (Owner decision
     * 2026-10-12, Q4). Every document this suite issues for the SELF
     * installation therefore names the same customer unless a test overrides it
     * on purpose to exercise the refusal or the explicit transfer.
     */
    const SELF_CUSTOMER = '01K7LIVECUSTOMER000000000000';
    const AUDIT_OPERATOR_PASSWORD = 'Audit-boundary-live-password';
    const auditActorUserIds: string[] = [];
    const auditActorRoleIds: string[] = [];
    let app: INestApplication;
    let prisma: PrismaService;

    /**
     * `issueLicenseFile` with the suite's commercial customer. Explicit
     * `customerId` in `options` still wins, which is how the tests that
     * exercise the customer rules build their documents.
     */
    function licenseFor(
      options: Partial<Parameters<typeof issueLicenseFile>[0]> & {
        installationId: string;
      },
      key: Parameters<typeof issueLicenseFile>[1] = authority.privateKey,
      file: { keyId?: string } = {},
    ): IssuedFile {
      const customerId =
        options.customer?.customerId ?? options.customerId ?? SELF_CUSTOMER;
      return issueLicenseFile(
        {
          customerId,
          customerCode:
            options.customer?.customerCode ??
            options.customerCode ??
            (customerId === SELF_CUSTOMER
              ? 'CUST-LIVE-SELF'
              : `CUST-${customerId.replace(/[^A-Za-z0-9]/g, '').slice(-12)}`),
          ...options,
        },
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
              developerLicensesEnabled: true,
              developerSigningPublicKeys: [
                `${developerKeyId}:${developerAuthority.publicKey}`,
              ],
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
      await client.$executeRawUnsafe(
        'DELETE FROM "licensing"."license_revocations"',
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

    interface AuditOperatorFixture {
      id: string;
      username: string;
    }

    /** Create a real, initially inactive actor and grant only the requested permissions. */
    async function createAuditOperator(
      label: string,
      permissionCodes: readonly string[],
    ): Promise<AuditOperatorFixture> {
      const suffix = generateId();
      const username = `audit-${label}-${suffix.toLowerCase()}`;
      const user = await app.get(UsersService).createUser({
        username,
        password: AUDIT_OPERATOR_PASSWORD,
        isActive: false,
      });
      auditActorUserIds.push(user.id);
      const role = await app.get(RolesService).createRole({
        name: `Live audit ${label} ${suffix}`,
        permissionCodes: [...permissionCodes],
      });
      auditActorRoleIds.push(role.id);
      await app.get(UserRolesService).assignRoleToUser(role.id, user.id);
      return { id: user.id, username };
    }

    async function activateAuditOperators(
      operators: readonly AuditOperatorFixture[],
    ): Promise<void> {
      const users = app.get(UsersService);
      for (const operator of operators) await users.enableUser(operator.id);
    }

    async function loginAuditOperator(
      username: string,
    ): Promise<ReturnType<typeof request.agent>> {
      const agent = request.agent(app.getHttpServer());
      await agent
        .post('/api/v1/auth/login')
        .send({ username, password: AUDIT_OPERATOR_PASSWORD })
        .expect(200);
      return agent;
    }

    async function cleanupAuditActors(): Promise<void> {
      const userIds = [...auditActorUserIds];
      const roleIds = [...auditActorRoleIds];
      auditActorUserIds.length = 0;
      auditActorRoleIds.length = 0;
      if (
        prisma === undefined ||
        (userIds.length === 0 && roleIds.length === 0)
      ) {
        return;
      }
      const client = await prisma.getClient<{
        $executeRawUnsafe(
          query: string,
          ...values: unknown[]
        ): Promise<unknown>;
      }>();
      const placeholders = (ids: readonly string[]) =>
        ids.map((_, index) => `$${index + 1}`).join(', ');
      if (userIds.length > 0) {
        const userArgs = placeholders(userIds);
        await client.$executeRawUnsafe(
          `DELETE FROM "identity"."sessions" WHERE "user_id" IN (${userArgs})`,
          ...userIds,
        );
        await client.$executeRawUnsafe(
          `DELETE FROM "rbac"."user_roles" WHERE "user_id" IN (${userArgs})`,
          ...userIds,
        );
      }
      if (roleIds.length > 0) {
        const roleArgs = placeholders(roleIds);
        await client.$executeRawUnsafe(
          `DELETE FROM "rbac"."role_permissions" WHERE "role_id" IN (${roleArgs})`,
          ...roleIds,
        );
        await client.$executeRawUnsafe(
          `DELETE FROM "rbac"."roles" WHERE "id" IN (${roleArgs})`,
          ...roleIds,
        );
      }
      if (userIds.length > 0) {
        const userArgs = placeholders(userIds);
        await client.$executeRawUnsafe(
          `DELETE FROM "users"."users" WHERE "id" IN (${userArgs})`,
          ...userIds,
        );
      }
    }

    /**
     * Delete the live licensing fixture and boot a fresh app so its immutable
     * in-process installation-identity cache cannot outlive the deleted row.
     */
    async function resetApplicationForFreshInstallation(): Promise<void> {
      await cleanupAuditActors();
      await cleanup(prisma);
      await app.close();
      app = await boot();
      prisma = app.get(PrismaService);
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
        await cleanupAuditActors();
        await cleanup(prisma);
      } finally {
        await app.close();
      }
    }, 60_000);

    afterEach(async () => {
      try {
        await cleanupAuditActors();
      } finally {
        vi.useRealTimers();
      }
    });

    /**
     * OD-LIC-17 persistence: the revocation row, the license stamp and the
     * typed audit event commit together, the unique index keeps one revocation
     * per license, and the license-level state is what the read path uses.
     *
     * These assertions are SQL-level on purpose — the migration's CHECK on
     * `licenses (revoked_at, revocation_id)` and the unique index on
     * `license_revocations.license_id` are exactly what an in-memory store
     * cannot prove.
     */
    async function revocationArtifact(
      installationId: string,
      licenseId: string,
      operationId: string,
      overrides: Partial<RevocationPayload> = {},
    ): Promise<{
      document: string;
      payload: RevocationPayload;
    }> {
      const keyId = `sha256-${createHash('sha256')
        .update(Buffer.from(authority.publicKey, 'base64'))
        .digest('hex')
        .slice(0, 16)}`;
      const payload: RevocationPayload = {
        v: 1,
        kind: 'SERVER_LICENSE_REVOCATION',
        revocationId: generateId(),
        licenseId,
        targetOperationId: operationId,
        customerId: SELF_CUSTOMER,
        customerCode: 'CUST-LIVE-SELF',
        installationId,
        effect: 'LICENSE_ONLY',
        reason: 'CONTRACT_TERMINATION',
        reasonDetail: 'Live persistence test.',
        issuerKeyId: keyId,
        issuedAt: new Date(),
        ...overrides,
      };
      const body = Buffer.from(canonicalizeRevocation(payload), 'utf8');
      const signature = cryptoSign(
        null,
        body,
        createPrivateKey({
          key: Buffer.from(authority.privateKey, 'base64'),
          format: 'der',
          type: 'pkcs8',
        }),
      );
      return {
        payload,
        document: [
          'VREV1',
          body.toString('base64url'),
          signature.toString('base64url'),
        ].join('.'),
      };
    }

    it('persists an official Developer License with no commercial customer', async () => {
      await cleanup(prisma);
      try {
        const identity = await app.get(InstallationIdentityService).current();
        const payload: DeveloperLicensePayload = {
          version: 1,
          kind: 'DEVELOPER_LICENSE_VERSION',
          licenseType: 'DEVELOPER',
          operationId: 'developer-live-operation-001',
          licenseId: 'developer-live-license-001',
          developerId: 'developer-live-holder',
          developerName: 'Developer Live Holder',
          installationId: identity.installationId,
          status: 'ACTIVE',
          validFrom: new Date('2020-01-01T00:00:00.000Z'),
          validUntil: new Date('2099-01-01T00:00:00.000Z'),
          organizationLimit: 2,
          userLimit: 10,
          deviceLimit: 0,
          moduleEntitlements: ['organization', 'users'],
          featureEntitlements: ['developer-tools'],
          supersedesOperationId: null,
          issuerKeyId: developerKeyId,
          issuedAt: new Date('2020-01-01T00:00:00.000Z'),
        };
        const document = signDeveloperLicenseDocument(
          payload,
          parsePrivateKey(developerAuthority.privateKey),
        );

        await expect(
          app
            .get(LicenseImportService)
            .importDocument(
              serializeDeveloperLicenseFile(document, developerKeyId),
            ),
        ).resolves.toMatchObject({
          changed: true,
          license: {
            licenseType: 'DEVELOPER',
            customerId: null,
            developerId: payload.developerId,
          },
        });

        expect(
          await query<{
            license_type: string;
            customer_id: string | null;
            developer_id: string | null;
          }>(
            `SELECT "license_type"::text, "customer_id", "developer_id"
             FROM "licensing"."licenses" WHERE "id" = $1`,
            payload.licenseId,
          ),
        ).toEqual([
          {
            license_type: 'DEVELOPER',
            customer_id: null,
            developer_id: payload.developerId,
          },
        ]);
        expect(
          await count(
            'SELECT COUNT(*)::bigint AS count FROM "licensing"."customers"',
          ),
        ).toBe(0);
      } finally {
        await cleanup(prisma);
        // The installation identity service caches the identity it created.
        // Reboot after deleting this test's isolated holder so the following
        // commercial persistence chain starts from a truly fresh process and
        // database together rather than retaining a stale in-memory identity.
        await app.close();
        app = await boot();
        prisma = app.get(PrismaService);
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
          customerCode: 'CUST-LIVE-SELF',
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
          customerCode: 'CUST-LIVE-SELF',
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
      // L-06 (PDR-14 §3.4): issuance requires an explicit customer identity and
      // business code. The suite's own customer is named so the ONLY defect of
      // this code is the foreign installation the test asserts on.
      const foreign = issueLicenseCode(
        {
          installationId: '01K7OTHERINSTALLATION0000',
          customerId: SELF_CUSTOMER,
          customerCode: 'CUST-LIVE-SELF',
        },
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
          customerCode: 'CUST-DOOMED-01',
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
          signedIssuedAt: null,
          governsFrom: null,
          validUntil: new Date('2030-01-01T00:00:00.000Z'),
          organizationLimit: null,
          userLimit: null,
          deviceLimit: null,
          deviceLimitSpecified: false,
          entitlements: [],
          supersession: { kind: 'none' },
          customerTransfer: null,
          expectedSupersessionVersionId: null,
          gapRecovery: null,
          reductionResolution: null,
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
          customerCode: 'CUST-DOOMED-01',
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
          signedIssuedAt: null,
          governsFrom: null,
          validUntil: new Date('2030-01-01T00:00:00.000Z'),
          organizationLimit: null,
          userLimit: null,
          deviceLimit: null,
          deviceLimitSpecified: false,
          entitlements: [
            { kind: 'MODULE', code: 'accounting' },
            { kind: 'MODULE', code: 'accounting' },
          ],
          supersession: { kind: 'none' },
          customerTransfer: null,
          expectedSupersessionVersionId: null,
          gapRecovery: null,
          reductionResolution: null,
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
          validFrom: new Date('2028-01-01T00:00:00.000Z'),
          validUntil: new Date('2029-01-01T00:00:00.000Z'),
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
        { from: '2029-01-01T00:00:00.000Z', until: '2029-07-01T00:00:00.000Z' },
        { from: '2029-07-01T00:00:00.000Z', until: '2030-01-01T00:00:00.000Z' },
        { from: '2030-01-01T00:00:00.000Z', until: '2030-07-01T00:00:00.000Z' },
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
          validFrom: new Date('2030-07-01T00:00:00.000Z'),
          validUntil: new Date('2031-07-01T00:00:00.000Z'),
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
          validFrom: new Date('2031-07-01T00:00:00.000Z'),
          validUntil: new Date('2032-01-01T00:00:00.000Z'),
          organizationLimit: 50,
        },
        authority.privateKey,
      );
      await app.get(LicenseImportService).importDocument(target.file);

      const left = licenseFor(
        {
          installationId: identity.installationId,
          validFrom: new Date('2031-10-01T00:00:00.000Z'),
          validUntil: new Date('2032-01-01T00:00:00.000Z'),
          organizationLimit: 51,
          supersedesOperationId: target.payload.operationId,
        },
        authority.privateKey,
      );
      const right = licenseFor(
        {
          installationId: identity.installationId,
          validFrom: new Date('2031-08-01T00:00:00.000Z'),
          validUntil: new Date('2032-01-01T00:00:00.000Z'),
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
          validFrom: new Date('2032-01-01T00:00:00.000Z'),
          validUntil: new Date('2033-01-01T00:00:00.000Z'),
        },
        authority.privateKey,
      );
      const second = licenseFor(
        {
          installationId: identity.installationId,
          licenseId,
          customerId: customerB,
          customerName: 'Customer B',
          validFrom: new Date('2033-01-01T00:00:00.000Z'),
          validUntil: new Date('2034-01-01T00:00:00.000Z'),
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
      // The suite's earlier tests chain adjacent windows and leave retained
      // coverage ending exactly where this test's first document starts. Since
      // L-05, a contiguous new-identity candidate is measured against the
      // deterministic continuation baseline, and this test's deliberately
      // small grant (5/20, two entitlements — chosen so the successor's
      // reduction conflicts deterministically) would reduce against the
      // unlimited chain link. Resetting isolates the test: on a fresh
      // installation the first document is a first license (no baseline), so
      // the ONLY reduction in play is the explicit supersession under test.
      await resetApplicationForFreshInstallation();
      const identity = await app.get(InstallationIdentityService).current();
      const licenseId = '01K7REDUCELICENSE00000000001';
      const governing = licenseFor(
        {
          installationId: identity.installationId,
          licenseId,
          validFrom: new Date('2033-01-01T00:00:00.000Z'),
          validUntil: new Date('2034-01-01T00:00:00.000Z'),
          organizationLimit: 5,
          userLimit: 20,
          // Entitlements make the reduction conflict deterministic in a
          // shared CI database: `documents` is granted here and taken away by
          // the successor, so the conflict fires on the retained grant alone
          // regardless of how many organizations exist at that moment (the
          // capacity arm fires additionally when usage is above the new
          // limit).
          moduleEntitlements: ['accounting', 'documents'],
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
          validFrom: new Date('2033-06-01T00:00:00.000Z'),
          validUntil: new Date('2034-06-01T00:00:00.000Z'),
          organizationLimit: 4,
          userLimit: 20,
          moduleEntitlements: ['accounting'],
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
          validFrom: new Date('2033-06-01T00:00:00.000Z'),
          validUntil: new Date('2034-06-01T00:00:00.000Z'),
          organizationLimit: 9,
          userLimit: 20,
          moduleEntitlements: ['accounting', 'documents'],
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
        '2033-06-01T00:00:00.000Z',
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
        `INSERT INTO "licensing"."customers" ("id", "customer_code", "display_name", "created_at", "updated_at")
         VALUES ($1, 'CUST-FOREIGN-01', 'Foreign customer', now(), now())`,
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
          validFrom: new Date('2034-06-01T00:00:00.000Z'),
          validUntil: new Date('2035-06-01T00:00:00.000Z'),
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
        customerCode: payload.customerCode,
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
        signedIssuedAt: 'issuedAt' in payload ? payload.issuedAt : null,
        governsFrom: null,
        validUntil: payload.validUntil,
        organizationLimit: payload.organizationLimit,
        userLimit: payload.userLimit,
        deviceLimit: payload.deviceLimit,
        deviceLimitSpecified: payload.deviceLimitSpecified,
        entitlements: [],
        supersession: { kind: 'none' },
        // Tests that exercise the explicit transfer set this explicitly; every
        // other command states "this import is not a transfer".
        customerTransfer: null,
        expectedSupersessionVersionId: null,
        gapRecovery: null,
        reductionResolution: null,
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
        `INSERT INTO "licensing"."customers" ("id", "customer_code", "display_name", "created_at", "updated_at")
         VALUES ($1, $2, 'Self customer', now(), now())`,
        selfCustomer,
        `CUST-${selfCustomer.replace(/[^A-Za-z0-9]/g, '').slice(-12)}`,
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
        validFrom: new Date('2034-06-01T00:00:00.000Z'),
        validUntil: new Date('2035-06-01T00:00:00.000Z'),
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
      const repository = app.get(LicensesRepository);
      // Each round races a FRESH pair of foreign installations driven through
      // the repository command: one customer per installation (Owner decision
      // 2026-10-12, Q4), so the only rule that can refuse a loser is the
      // identifier race under test. Fresh installations have no retained
      // coverage, so no round can be preempted by the OQ-87 post-gap routing
      // (a new identity starting after an installation's coverage end is
      // post-gap recovery), and no round interferes with the self
      // installation's retained state. A round's loser writes nothing, so
      // every round is independent.
      for (const round of [0, 1, 2, 3, 4]) {
        const leftInstallation = generateId();
        const rightInstallation = generateId();
        await insertForeignInstallation(leftInstallation);
        await insertForeignInstallation(rightInstallation);
        const leftCustomer = generateId();
        const rightCustomer = generateId();
        const license = generateId();
        const window = {
          validFrom: new Date(`${2036 + round}-01-01T00:00:00.000Z`),
          validUntil: new Date(`${2036 + round}-07-01T00:00:00.000Z`),
        };
        const leftDocument = licenseFor(
          {
            installationId: leftInstallation,
            licenseId: license,
            customerId: leftCustomer,
            customerName: `Left round ${round}`,
            ...window,
          },
          authority.privateKey,
        );
        const rightDocument = licenseFor(
          {
            installationId: rightInstallation,
            licenseId: license,
            customerId: rightCustomer,
            customerName: `Right round ${round}`,
            ...window,
          },
          authority.privateKey,
        );

        const settled = await Promise.allSettled([
          repository.importVersion(
            commandFor(leftInstallation, leftDocument, `Left ${round}`),
          ),
          repository.importVersion(
            commandFor(rightInstallation, rightDocument, `Right ${round}`),
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

    it('persists a signed post-gap recovery with a 500-character reason in PostgreSQL', async () => {
      await resetApplicationForFreshInstallation();
      vi.useFakeTimers({ toFake: ['Date'] });
      const identity = await app.get(InstallationIdentityService).current();
      const T0 = new Date('2026-01-01T00:00:00.000Z');
      const LAPSE_END = new Date('2026-03-01T00:00:00.000Z');
      const AFTER_LAPSE = new Date('2026-06-01T00:00:00.000Z');
      const operator = await createAuditOperator('recovery', [
        LICENSING_PERMISSIONS.LICENSE_ACTIVATE,
        LICENSING_PERMISSIONS.INSTALLATION_RECOVER_AFTER_GAP,
      ]);
      const ordinaryOperator = await createAuditOperator('recovery-ordinary', [
        LICENSING_PERMISSIONS.LICENSE_ACTIVATE,
      ]);
      const lapsed = licenseFor(
        {
          installationId: identity.installationId,
          licenseId: generateId(),
          validFrom: new Date('2025-01-01T00:00:00.000Z'),
          validUntil: LAPSE_END,
          organizationLimit: 1000,
          userLimit: 1000,
          moduleEntitlements: ['organization', 'users', 'rbac'],
        },
        authority.privateKey,
      );

      vi.setSystemTime(T0);
      await app.get(LicenseImportService).importDocument(lapsed.file);
      await activateAuditOperators([operator, ordinaryOperator]);
      vi.setSystemTime(AFTER_LAPSE);
      const ordinaryAgent = await loginAuditOperator(ordinaryOperator.username);
      const agent = await loginAuditOperator(operator.username);
      const recovery = licenseFor(
        {
          installationId: identity.installationId,
          licenseId: generateId(),
          validFrom: AFTER_LAPSE,
          validUntil: new Date('2028-01-01T00:00:00.000Z'),
          organizationLimit: 1000,
          userLimit: 1000,
          moduleEntitlements: ['organization', 'users', 'rbac'],
        },
        authority.privateKey,
      );
      const reason = 'R'.repeat(500);
      expect(reason).toHaveLength(500);

      const denied = await ordinaryAgent
        .post('/api/v1/license/gap-recovery')
        .send({ document: recovery.file, reason })
        .expect(403);
      expect(denied.body.code).toBe('PermissionDenied');
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "operation_id" = $1`,
          recovery.payload.operationId,
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_audit_events"
            WHERE "event_type" = 'license.import.recovered'
              AND "operation_id" = $1`,
          recovery.payload.operationId,
        ),
      ).toBe(0);
      expect(
        await query<{ superseded_at: Date | null }>(
          `SELECT "superseded_at" FROM "licensing"."license_versions"
            WHERE "operation_id" = $1`,
          lapsed.payload.operationId,
        ),
      ).toEqual([{ superseded_at: null }]);

      const response = await agent
        .post('/api/v1/license/gap-recovery')
        .send({ document: recovery.file, reason });
      const versionsAfter = await query<{
        id: string;
        operation_id: string;
        license_id: string;
        superseded_at: Date | null;
      }>(
        `SELECT "id", "operation_id", "license_id", "superseded_at"
           FROM "licensing"."license_versions"
          WHERE "installation_id" = $1
          ORDER BY "imported_at", "id"`,
        identity.installationId,
      );
      const recoveryEventsAfter = await query<{
        id: string;
        detail: string | null;
        previous_license_id: string | null;
      }>(
        `SELECT "id", "detail", "previous_license_id"
           FROM "licensing"."license_audit_events"
          WHERE "event_type" = 'license.import.recovered'
            AND "operation_id" = $1`,
        recovery.payload.operationId,
      );

      // The pre-fix 500 response must leave only the lapsed version and no
      // recovery audit event; the transaction must not partially commit.
      if (response.status !== 200) {
        expect(versionsAfter).toHaveLength(1);
        expect(versionsAfter[0]?.license_id).toBe(lapsed.payload.licenseId);
        expect(versionsAfter[0]?.superseded_at).toBeNull();
        expect(recoveryEventsAfter).toHaveLength(0);
      }
      expect(
        response.status,
        `HTTP ${response.status}: ${JSON.stringify(response.body)}`,
      ).toBe(200);
      expect(response.body).toMatchObject({
        changed: true,
        outcome: 'APPLIED',
        lapsedLicenseId: lapsed.payload.licenseId,
        coverageEnd: LAPSE_END.toISOString(),
      });
      expect(versionsAfter).toHaveLength(2);
      expect(versionsAfter[1]).toMatchObject({
        operation_id: recovery.payload.operationId,
        license_id: recovery.payload.licenseId,
        superseded_at: null,
      });

      const recoveryEvent = await query<{
        detail: string | null;
        previous_license_id: string | null;
        license_id: string | null;
        version_id: string | null;
        actor_id: string | null;
        source: string;
        operation_id: string | null;
        occurred_at: Date;
      }>(
        `SELECT "detail", "previous_license_id", "license_id", "version_id",
                "actor_id", "source", "operation_id", "occurred_at"
           FROM "licensing"."license_audit_events"
          WHERE "event_type" = 'license.import.recovered'
            AND "operation_id" = $1`,
        recovery.payload.operationId,
      ).then((rows) => rows[0]);
      expect(recoveryEvent).toBeDefined();
      expect(recoveryEvent?.detail).toBeDefined();
      expect(recoveryEvent?.detail?.length).toBeGreaterThan(500);
      expect(recoveryEvent?.detail).toContain(LAPSE_END.toISOString());
      expect(recoveryEvent?.detail?.endsWith(reason)).toBe(true);
      expect(recoveryEvent).toMatchObject({
        previous_license_id: lapsed.payload.licenseId,
        license_id: recovery.payload.licenseId,
        version_id: versionsAfter[1]?.id,
        actor_id: operator.id,
        source: 'file',
        operation_id: recovery.payload.operationId,
      });
      expect(recoveryEvent?.occurred_at.toISOString()).toBe(
        AFTER_LAPSE.toISOString(),
      );
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_audit_events"
            WHERE "event_type" = 'license.import.recovered'
              AND "operation_id" = $1`,
          recovery.payload.operationId,
        ),
      ).toBe(1);

      const replay = await agent
        .post('/api/v1/license/gap-recovery')
        .send({ document: recovery.file, reason });
      expect(replay.status).toBe(409);
      expect(replay.body.details).toMatchObject({
        reason: 'duplicate-operation',
      });
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "operation_id" = $1`,
          recovery.payload.operationId,
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_audit_events"
            WHERE "event_type" = 'license.import.recovered'
              AND "operation_id" = $1`,
          recovery.payload.operationId,
        ),
      ).toBe(1);
    }, 120_000);

    it('commits a post-gap reduction resolution and its two audit events atomically in PostgreSQL', async () => {
      await resetApplicationForFreshInstallation();
      vi.useFakeTimers({ toFake: ['Date'] });
      const identity = await app.get(InstallationIdentityService).current();
      const T0 = new Date('2026-01-01T00:00:00.000Z');
      const LAPSE_END = new Date('2026-03-01T00:00:00.000Z');
      const AFTER_LAPSE = new Date('2026-06-01T00:00:00.000Z');
      const operator = await createAuditOperator('combined-recovery', [
        LICENSING_PERMISSIONS.LICENSE_ACTIVATE,
        LICENSING_PERMISSIONS.INSTALLATION_RECOVER_AFTER_GAP,
        LICENSING_PERMISSIONS.LICENSE_RESOLVE_REDUCTION,
      ]);
      const secondActiveUser = await createAuditOperator('recovery-usage', [
        LICENSING_PERMISSIONS.LICENSE_ACTIVATE,
      ]);
      const lapsed = licenseFor(
        {
          installationId: identity.installationId,
          licenseId: generateId(),
          validFrom: new Date('2025-01-01T00:00:00.000Z'),
          validUntil: LAPSE_END,
          organizationLimit: 1000,
          userLimit: 1000,
          moduleEntitlements: ['organization', 'users', 'rbac'],
        },
        authority.privateKey,
      );

      vi.setSystemTime(T0);
      await app.get(LicenseImportService).importDocument(lapsed.file);
      await activateAuditOperators([operator, secondActiveUser]);
      const activeUserCount = await app
        .get(UsersService)
        .countLicensedActiveUsers();
      expect(activeUserCount).toBeGreaterThan(1);

      vi.setSystemTime(AFTER_LAPSE);
      const agent = await loginAuditOperator(operator.username);
      const recovery = licenseFor(
        {
          installationId: identity.installationId,
          licenseId: generateId(),
          validFrom: AFTER_LAPSE,
          validUntil: new Date('2028-01-01T00:00:00.000Z'),
          organizationLimit: 1000,
          userLimit: 1,
          moduleEntitlements: ['organization', 'users', 'rbac'],
        },
        authority.privateKey,
      );
      const reason = 'Renewal order arrived after the prior coverage ended.';
      const resolutionReason =
        'Customer approved the lower user limit after reviewing active users.';
      const appliedEvents = [
        'license.import.recovered',
        'license.import.reduction-resolved',
      ];

      // Force the second typed event insert to fail after the recovery event
      // insert has run. The exception must roll back the version and BOTH
      // events; after removing the trigger, the same signed document can be
      // retried successfully.
      const client = await prisma.getClient<{
        $executeRawUnsafe(
          query: string,
          ...values: unknown[]
        ): Promise<unknown>;
      }>();
      await client.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION licensing.fail_l07_resolution_audit()
         RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN
           IF NEW."event_type" = 'license.import.reduction-resolved' THEN
             RAISE EXCEPTION 'forced L-07 resolution audit failure';
           END IF;
           RETURN NEW;
         END;
         $$`,
      );
      await client.$executeRawUnsafe(
        `CREATE TRIGGER fail_l07_resolution_audit
         BEFORE INSERT ON "licensing"."license_audit_events"
         FOR EACH ROW EXECUTE FUNCTION licensing.fail_l07_resolution_audit()`,
      );
      try {
        await agent
          .post('/api/v1/license/gap-recovery')
          .send({
            document: recovery.file,
            reason,
            reductionResolutionReason: resolutionReason,
          })
          .expect(500);
        expect(
          await count(
            `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
              WHERE "operation_id" = $1`,
            recovery.payload.operationId,
          ),
        ).toBe(0);
        expect(
          await count(
            `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_audit_events"
              WHERE "operation_id" = $1
                AND "event_type" IN ($2, $3)`,
            recovery.payload.operationId,
            ...appliedEvents,
          ),
        ).toBe(0);
        expect(
          await query<{ superseded_at: Date | null }>(
            `SELECT "superseded_at" FROM "licensing"."license_versions"
              WHERE "operation_id" = $1`,
            lapsed.payload.operationId,
          ),
        ).toEqual([{ superseded_at: null }]);
      } finally {
        await client.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS fail_l07_resolution_audit
             ON "licensing"."license_audit_events"`,
        );
        await client.$executeRawUnsafe(
          'DROP FUNCTION IF EXISTS licensing.fail_l07_resolution_audit()',
        );
      }

      const response = await agent
        .post('/api/v1/license/gap-recovery')
        .send({
          document: recovery.file,
          reason,
          reductionResolutionReason: resolutionReason,
        })
        .expect(200);
      expect(response.body).toMatchObject({
        changed: true,
        outcome: 'APPLIED',
        lapsedLicenseId: lapsed.payload.licenseId,
        coverageEnd: LAPSE_END.toISOString(),
        resolvedConflicts: [
          {
            kind: 'user-capacity',
            limit: 1,
            currentUsage: activeUserCount,
          },
        ],
      });
      expect(response.body.resolvedPredecessorVersionId).toBeDefined();

      expect(
        await query<{
          event_type: string;
          operation_id: string | null;
          license_id: string | null;
          version_id: string | null;
          previous_license_id: string | null;
          detail: string | null;
        }>(
          `SELECT "event_type", "operation_id", "license_id", "version_id",
                  "previous_license_id", "detail"
             FROM "licensing"."license_audit_events"
            WHERE "operation_id" = $1 AND "event_type" IN ($2, $3)
            ORDER BY "event_type"`,
          recovery.payload.operationId,
          ...appliedEvents,
        ),
      ).toMatchObject([
        {
          event_type: 'license.import.recovered',
          operation_id: recovery.payload.operationId,
          license_id: recovery.payload.licenseId,
          previous_license_id: lapsed.payload.licenseId,
        },
        {
          event_type: 'license.import.reduction-resolved',
          operation_id: recovery.payload.operationId,
          license_id: recovery.payload.licenseId,
          previous_license_id: null,
        },
      ]);
      const events = await query<{ event_type: string; detail: string | null }>(
        `SELECT "event_type", "detail"
           FROM "licensing"."license_audit_events"
          WHERE "operation_id" = $1 AND "event_type" IN ($2, $3)`,
        recovery.payload.operationId,
        ...appliedEvents,
      );
      expect(events).toHaveLength(2);
      expect(
        events.find((event) => event.event_type === 'license.import.recovered')
          ?.detail,
      ).toContain(reason);
      expect(
        events.find(
          (event) => event.event_type === 'license.import.reduction-resolved',
        )?.detail,
      ).toContain(resolutionReason);
      expect(
        events.find(
          (event) => event.event_type === 'license.import.reduction-resolved',
        )?.detail,
      ).toContain('user-capacity');
      expect(
        events.find(
          (event) => event.event_type === 'license.import.reduction-resolved',
        )?.detail,
      ).toContain(
        `conflicts=[{"kind":"user-capacity","limit":1,"currentUsage":${activeUserCount}}]`,
      );
      expect(
        await query<{ superseded_at: Date | null; governs_until: Date | null }>(
          `SELECT "superseded_at", "governs_until" FROM "licensing"."license_versions"
            WHERE "operation_id" = $1`,
          lapsed.payload.operationId,
        ),
      ).toEqual([{ superseded_at: null, governs_until: null }]);
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "operation_id" = $1`,
          recovery.payload.operationId,
        ),
      ).toBe(1);
    }, 120_000);

    it('persists an authorized L-04 resolution with a 500-character reason in PostgreSQL', async () => {
      await resetApplicationForFreshInstallation();
      const identity = await app.get(InstallationIdentityService).current();
      const ordinaryOperator = await createAuditOperator('ordinary', [
        LICENSING_PERMISSIONS.LICENSE_ACTIVATE,
      ]);
      const resolver = await createAuditOperator('resolution', [
        LICENSING_PERMISSIONS.LICENSE_ACTIVATE,
        LICENSING_PERMISSIONS.LICENSE_RESOLVE_REDUCTION,
      ]);
      const governing = licenseFor(
        {
          installationId: identity.installationId,
          licenseId: generateId(),
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: new Date('2034-01-01T00:00:00.000Z'),
          organizationLimit: null,
          userLimit: 10_000,
          moduleEntitlements: ['organization', 'users', 'rbac'],
        },
        authority.privateKey,
      );
      await app.get(LicenseImportService).importDocument(governing.file);
      await activateAuditOperators([ordinaryOperator, resolver]);

      const users = app.get(UsersService);
      for (let index = 0; index < 10; index += 1) {
        const usageUser = await users.createUser({
          username: `audit-usage-${generateId().toLowerCase()}`,
          password: AUDIT_OPERATOR_PASSWORD,
        });
        auditActorUserIds.push(usageUser.id);
      }
      const actualUsage = await users.countLicensedActiveUsers();
      const reducedLimit = 11;
      expect(actualUsage).toBeGreaterThan(reducedLimit);

      const reducing = licenseFor(
        {
          installationId: identity.installationId,
          licenseId: governing.payload.licenseId,
          validFrom: new Date('2033-01-01T00:00:00.000Z'),
          validUntil: new Date('2034-06-01T00:00:00.000Z'),
          organizationLimit: null,
          userLimit: reducedLimit,
          moduleEntitlements: ['organization', 'users', 'rbac'],
          supersedesOperationId: governing.payload.operationId,
        },
        authority.privateKey,
      );
      const ordinaryAgent = await loginAuditOperator(ordinaryOperator.username);
      const resolutionAgent = await loginAuditOperator(resolver.username);
      const refused = await ordinaryAgent
        .post('/api/v1/license/import')
        .send({ document: reducing.file });
      expect(refused.status).toBe(409);
      expect(refused.body.details.reason).toBe('reduction-requires-resolution');
      const refusalConflict = (
        refused.body.details.reduction.conflicts as Array<{
          kind: string;
          limit: number;
          currentUsage: number;
        }>
      ).find(({ kind }) => kind === 'user-capacity');
      expect(refusalConflict).toMatchObject({
        kind: 'user-capacity',
        limit: reducedLimit,
      });
      expect(refusalConflict?.currentUsage).toBeGreaterThan(reducedLimit);
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "operation_id" = $1`,
          reducing.payload.operationId,
        ),
      ).toBe(0);
      expect(
        await query<{ superseded_at: Date | null }>(
          `SELECT "superseded_at" FROM "licensing"."license_versions"
            WHERE "operation_id" = $1`,
          governing.payload.operationId,
        ),
      ).toEqual([{ superseded_at: null }]);

      const reason = 'S'.repeat(500);
      expect(reason).toHaveLength(500);
      const denied = await ordinaryAgent
        .post('/api/v1/license/reduction-resolution')
        .send({ document: reducing.file, reason })
        .expect(403);
      expect(denied.body.code).toBe('PermissionDenied');
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "operation_id" = $1`,
          reducing.payload.operationId,
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_audit_events"
            WHERE "event_type" = 'license.import.reduction-resolved'
              AND "operation_id" = $1`,
          reducing.payload.operationId,
        ),
      ).toBe(0);
      expect(
        await query<{ superseded_at: Date | null }>(
          `SELECT "superseded_at" FROM "licensing"."license_versions"
            WHERE "operation_id" = $1`,
          governing.payload.operationId,
        ),
      ).toEqual([{ superseded_at: null }]);

      const response = await resolutionAgent
        .post('/api/v1/license/reduction-resolution')
        .send({ document: reducing.file, reason });
      const resolvedVersionCount = await count(
        `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
          WHERE "operation_id" = $1`,
        reducing.payload.operationId,
      );
      const resolvedAuditCount = await count(
        `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_audit_events"
          WHERE "event_type" = 'license.import.reduction-resolved'
            AND "operation_id" = $1`,
        reducing.payload.operationId,
      );
      const predecessorAfter = await query<{
        superseded_at: Date | null;
        governs_until: Date | null;
        superseded_by_version_id: string | null;
      }>(
        `SELECT "superseded_at", "governs_until", "superseded_by_version_id"
           FROM "licensing"."license_versions"
          WHERE "operation_id" = $1`,
        governing.payload.operationId,
      );
      if (response.status !== 200) {
        expect(resolvedVersionCount).toBe(0);
        expect(resolvedAuditCount).toBe(0);
        expect(predecessorAfter).toEqual([
          {
            superseded_at: null,
            governs_until: null,
            superseded_by_version_id: null,
          },
        ]);
      }
      expect(
        response.status,
        `HTTP ${response.status}: ${JSON.stringify(response.body)}`,
      ).toBe(200);
      expect(response.body).toMatchObject({
        changed: true,
        outcome: 'APPLIED',
        resolvedPredecessorVersionId: expect.any(String),
      });
      const resolvedConflict = (
        response.body.resolvedConflicts as Array<{
          kind: string;
          limit: number;
          currentUsage: number;
        }>
      ).find(({ kind }) => kind === 'user-capacity');
      expect(resolvedConflict).toMatchObject({
        kind: 'user-capacity',
        limit: reducedLimit,
      });
      expect(resolvedConflict?.currentUsage).toBeGreaterThan(reducedLimit);
      expect(resolvedVersionCount).toBe(1);
      expect(resolvedAuditCount).toBe(1);

      const resolvedVersion = await query<{
        id: string;
        operation_id: string;
        supersedes_version_id: string | null;
      }>(
        `SELECT "id", "operation_id", "supersedes_version_id"
           FROM "licensing"."license_versions"
          WHERE "operation_id" = $1`,
        reducing.payload.operationId,
      ).then((rows) => rows[0]);
      expect(resolvedVersion).toMatchObject({
        operation_id: reducing.payload.operationId,
        supersedes_version_id: response.body.resolvedPredecessorVersionId,
      });
      expect(predecessorAfter).toEqual([
        {
          superseded_at: expect.any(Date),
          governs_until: new Date('2033-01-01T00:00:00.000Z'),
          superseded_by_version_id: resolvedVersion?.id,
        },
      ]);

      const resolvedAudit = await query<{
        detail: string | null;
        license_id: string | null;
        version_id: string | null;
        actor_id: string | null;
        source: string;
        operation_id: string | null;
        occurred_at: Date;
      }>(
        `SELECT "detail", "license_id", "version_id", "actor_id", "source",
                "operation_id", "occurred_at"
           FROM "licensing"."license_audit_events"
          WHERE "event_type" = 'license.import.reduction-resolved'
            AND "operation_id" = $1`,
        reducing.payload.operationId,
      ).then((rows) => rows[0]);
      expect(resolvedAudit?.detail).toBeDefined();
      expect(resolvedAudit?.detail?.length).toBeGreaterThan(500);
      expect(resolvedAudit?.detail).toContain(
        response.body.resolvedPredecessorVersionId,
      );
      expect(resolvedAudit?.detail).toContain('[user-capacity]');
      expect(resolvedAudit?.detail?.endsWith(reason)).toBe(true);
      expect(resolvedAudit).toMatchObject({
        license_id: governing.payload.licenseId,
        version_id: resolvedVersion?.id,
        actor_id: resolver.id,
        source: 'file',
        operation_id: reducing.payload.operationId,
      });
      expect(resolvedAudit?.occurred_at).toBeInstanceOf(Date);

      const replay = await resolutionAgent
        .post('/api/v1/license/reduction-resolution')
        .send({ document: reducing.file, reason });
      expect(replay.status).toBe(409);
      expect(replay.body.details).toMatchObject({
        reason: 'duplicate-operation',
      });
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "operation_id" = $1`,
          reducing.payload.operationId,
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_audit_events"
            WHERE "event_type" = 'license.import.reduction-resolved'
              AND "operation_id" = $1`,
          reducing.payload.operationId,
        ),
      ).toBe(1);
    }, 120_000);

    it('persists the L-05 renewal-path resolution: refusal writes nothing, the baseline is never stamped, the typed event names it', async () => {
      await resetApplicationForFreshInstallation();
      const identity = await app.get(InstallationIdentityService).current();
      const ordinaryOperator = await createAuditOperator('ordinary', [
        LICENSING_PERMISSIONS.LICENSE_ACTIVATE,
      ]);
      const resolver = await createAuditOperator('resolution', [
        LICENSING_PERMISSIONS.LICENSE_ACTIVATE,
        LICENSING_PERMISSIONS.LICENSE_RESOLVE_REDUCTION,
      ]);
      const governing = licenseFor(
        {
          installationId: identity.installationId,
          licenseId: generateId(),
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: new Date('2034-01-01T00:00:00.000Z'),
          organizationLimit: null,
          userLimit: 10_000,
          moduleEntitlements: ['organization', 'users', 'rbac'],
        },
        authority.privateKey,
      );
      await app.get(LicenseImportService).importDocument(governing.file);
      await activateAuditOperators([ordinaryOperator, resolver]);

      const users = app.get(UsersService);
      for (let index = 0; index < 10; index += 1) {
        const usageUser = await users.createUser({
          username: `renewal-usage-${generateId().toLowerCase()}`,
          password: AUDIT_OPERATOR_PASSWORD,
        });
        auditActorUserIds.push(usageUser.id);
      }
      const actualUsage = await users.countLicensedActiveUsers();
      const reducedLimit = 11;
      expect(actualUsage).toBeGreaterThan(reducedLimit);

      // A contiguous renewal: it starts exactly at the governing window's end
      // and retires NOTHING (no supersedesOperationId) — the path that had no
      // reduction check before L-05.
      const renewal = licenseFor(
        {
          installationId: identity.installationId,
          licenseId: governing.payload.licenseId,
          validFrom: new Date('2034-01-01T00:00:00.000Z'),
          validUntil: new Date('2035-06-01T00:00:00.000Z'),
          organizationLimit: null,
          userLimit: reducedLimit,
          moduleEntitlements: ['organization', 'users', 'rbac'],
        },
        authority.privateKey,
      );
      const governingVersion = await query<{ id: string }>(
        `SELECT "id" FROM "licensing"."license_versions"
          WHERE "operation_id" = $1`,
        governing.payload.operationId,
      ).then((rows) => rows[0]);
      expect(governingVersion).toBeDefined();

      const ordinaryAgent = await loginAuditOperator(ordinaryOperator.username);
      const refused = await ordinaryAgent
        .post('/api/v1/license/import')
        .send({ document: renewal.file });
      expect(refused.status).toBe(409);
      expect(refused.body.details.reason).toBe('reduction-requires-resolution');
      expect(refused.body.details.reduction.predecessorVersionId).toBe(
        governingVersion?.id,
      );
      const refusalConflict = (
        refused.body.details.reduction.conflicts as Array<{
          kind: string;
          limit: number;
          currentUsage: number;
        }>
      ).find(({ kind }) => kind === 'user-capacity');
      expect(refusalConflict).toMatchObject({
        kind: 'user-capacity',
        limit: reducedLimit,
      });
      expect(refusalConflict?.currentUsage).toBeGreaterThan(reducedLimit);
      // Nothing was written, and the baseline keeps its unstamped history.
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "operation_id" = $1`,
          renewal.payload.operationId,
        ),
      ).toBe(0);

      const denied = await ordinaryAgent
        .post('/api/v1/license/reduction-resolution')
        .send({
          document: renewal.file,
          reason: 'Renewal confirmed by customer.',
        })
        .expect(403);
      expect(denied.body.code).toBe('PermissionDenied');
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_audit_events"
            WHERE "event_type" = 'license.import.reduction-resolved'`,
        ),
      ).toBe(0);

      const resolutionAgent = await loginAuditOperator(resolver.username);
      const response = await resolutionAgent
        .post('/api/v1/license/reduction-resolution')
        .send({
          document: renewal.file,
          reason: 'Renewal confirmed by customer.',
        });
      expect(
        response.status,
        `HTTP ${response.status}: ${JSON.stringify(response.body)}`,
      ).toBe(200);
      expect(response.body).toMatchObject({
        changed: true,
        outcome: 'APPLIED',
        // The receipt names the BASELINE — the version whose grant was
        // measured — and the renewal retired nothing.
        resolvedPredecessorVersionId: governingVersion?.id,
      });
      const resolvedConflict = (
        response.body.resolvedConflicts as Array<{
          kind: string;
          limit: number;
          currentUsage: number;
        }>
      ).find(({ kind }) => kind === 'user-capacity');
      expect(resolvedConflict).toMatchObject({
        kind: 'user-capacity',
        limit: reducedLimit,
      });

      const renewalVersion = await query<{
        id: string;
        supersedes_version_id: string | null;
      }>(
        `SELECT "id", "supersedes_version_id" FROM "licensing"."license_versions"
          WHERE "operation_id" = $1`,
        renewal.payload.operationId,
      ).then((rows) => rows[0]);
      expect(renewalVersion).toBeDefined();
      // No retirement was recorded on the renewal: a resolution authorizes a
      // reduction, it does not retire the version it is measured against.
      expect(renewalVersion?.supersedes_version_id).toBeNull();
      const predecessorAfter = await query<{
        superseded_at: Date | null;
        governs_until: Date | null;
        superseded_by_version_id: string | null;
      }>(
        `SELECT "superseded_at", "governs_until", "superseded_by_version_id"
           FROM "licensing"."license_versions"
          WHERE "operation_id" = $1`,
        governing.payload.operationId,
      );
      expect(predecessorAfter).toEqual([
        {
          superseded_at: null,
          governs_until: null,
          superseded_by_version_id: null,
        },
      ]);

      const resolvedAudit = await query<{
        detail: string | null;
        license_id: string | null;
        version_id: string | null;
        actor_id: string | null;
        source: string;
      }>(
        `SELECT "detail", "license_id", "version_id", "actor_id", "source"
           FROM "licensing"."license_audit_events"
          WHERE "event_type" = 'license.import.reduction-resolved'
            AND "operation_id" = $1`,
        renewal.payload.operationId,
      ).then((rows) => rows[0]);
      // The typed event names the baseline and the conflicts the transaction
      // recomputed under the installation and allocation locks.
      expect(resolvedAudit?.detail).toContain(governingVersion?.id ?? '');
      expect(resolvedAudit?.detail).toContain('[user-capacity]');
      expect(resolvedAudit).toMatchObject({
        license_id: governing.payload.licenseId,
        version_id: renewalVersion?.id,
        actor_id: resolver.id,
        source: 'file',
      });

      const replay = await resolutionAgent
        .post('/api/v1/license/reduction-resolution')
        .send({
          document: renewal.file,
          reason: 'Renewal confirmed by customer.',
        });
      expect(replay.status).toBe(409);
      expect(replay.body.details).toMatchObject({
        reason: 'duplicate-operation',
      });
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "operation_id" = $1`,
          renewal.payload.operationId,
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_audit_events"
            WHERE "event_type" = 'license.import.reduction-resolved'
              AND "operation_id" = $1`,
          renewal.payload.operationId,
        ),
      ).toBe(1);
    }, 120_000);

    it('enforces customer_code uniqueness, preserves stored display_name/customer_code on import, and rejects customer-code-mismatch (L-06, PDR-14)', async () => {
      // Self-contained: a fresh installation with its own contiguous history,
      // so the verdicts below cannot depend on the retained windows that
      // earlier tests in this file left behind (a renewal starting after that
      // coverage ended is post-gap recovery under PDR-13, not an import).
      await resetApplicationForFreshInstallation();
      const identity = await app.get(InstallationIdentityService).current();
      const repository = app.get(LicensesRepository);
      // One unchanged grant throughout, so the §8.6 / L-05 continuation guard
      // has nothing to refuse and only the customer rules are exercised.
      const grant = {
        organizationLimit: null,
        userLimit: 100,
        moduleEntitlements: ['organization', 'users', 'rbac'],
      };

      const baseline = licenseFor({
        installationId: identity.installationId,
        licenseId: generateId(),
        customerId: SELF_CUSTOMER,
        customerCode: 'CUST-LIVE-SELF',
        customerName: 'Live customer',
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2046-01-01T00:00:00.000Z'),
        ...grant,
      });
      const bound = await importOutcome(baseline);
      expect(bound, bound.message).toMatchObject({ applied: true });
      expect(await repository.findCustomerById(SELF_CUSTOMER)).toMatchObject({
        customerId: SELF_CUSTOMER,
        customerCode: 'CUST-LIVE-SELF',
        displayName: 'Live customer',
      });

      // Rename the bound customer's display_name via updateCustomerDisplayName;
      // customerId and customerCode stay unchanged.
      const renamed = await repository.updateCustomerDisplayName({
        customerId: SELF_CUSTOMER,
        displayName: 'Renamed Live Customer Ltd.',
      });
      expect(renamed.customerId).toBe(SELF_CUSTOMER);
      expect(renamed.customerCode).toBe('CUST-LIVE-SELF');
      expect(renamed.displayName).toBe('Renamed Live Customer Ltd.');

      // A contiguous renewal under a NEW licenseId (the L-05 path) whose signed
      // customerName differs applies, and does NOT overwrite the stored
      // display_name or customer_code. `importOutcome` reports status 0 on
      // success (no HTTP layer is involved).
      const renewalWithDifferentName = licenseFor({
        installationId: identity.installationId,
        customerId: SELF_CUSTOMER,
        customerCode: 'CUST-LIVE-SELF',
        customerName: 'Different Label In Artifact',
        validFrom: new Date('2046-01-01T00:00:00.000Z'),
        validUntil: new Date('2047-01-01T00:00:00.000Z'),
        ...grant,
      });
      expect(renewalWithDifferentName.payload.licenseId).not.toBe(
        baseline.payload.licenseId,
      );
      const applied = await importOutcome(renewalWithDifferentName);
      expect(applied, applied.message).toMatchObject({
        applied: true,
        status: 0,
      });

      const afterImport = await repository.findCustomerById(SELF_CUSTOMER);
      expect(afterImport).toMatchObject({
        customerId: SELF_CUSTOMER,
        customerCode: 'CUST-LIVE-SELF',
        displayName: 'Renamed Live Customer Ltd.',
      });

      // The same customerId with a different customerCode fails closed with
      // 409 customer-code-mismatch, and nothing is written.
      const mismatchedCode = licenseFor({
        installationId: identity.installationId,
        customerId: SELF_CUSTOMER,
        customerCode: 'CUST-WRONG-LIVE-99',
        customerName: 'Renamed Live Customer Ltd.',
        validFrom: new Date('2047-01-01T00:00:00.000Z'),
        validUntil: new Date('2048-01-01T00:00:00.000Z'),
        ...grant,
      });
      const refused = await importOutcome(mismatchedCode);
      expect(refused).toMatchObject({
        applied: false,
        status: 409,
        reason: 'customer-code-mismatch',
      });
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "operation_id" = $1`,
          mismatchedCode.payload.operationId,
        ),
      ).toBe(0);

      // Another customerId claiming the bound customer's code is the same
      // conflict: no customer row is created for it and the binding is kept.
      const otherCustomer = '01K7LIVEOTHERCUSTOMER00000';
      const codeReuse = licenseFor({
        installationId: identity.installationId,
        customerId: otherCustomer,
        customerCode: 'CUST-LIVE-SELF',
        customerName: 'Other Customer',
        validFrom: new Date('2047-01-01T00:00:00.000Z'),
        validUntil: new Date('2048-01-01T00:00:00.000Z'),
        ...grant,
      });
      const reuseRefused = await importOutcome(codeReuse);
      expect(reuseRefused).toMatchObject({
        applied: false,
        status: 409,
        reason: 'customer-code-mismatch',
      });
      expect(await repository.findCustomerById(otherCustomer)).toBeNull();
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "operation_id" = $1`,
          codeReuse.payload.operationId,
        ),
      ).toBe(0);

      // The database itself enforces uq_customers_customer_code.
      const client = await prisma.getClient<{
        $executeRawUnsafe(
          query: string,
          ...values: unknown[]
        ): Promise<unknown>;
      }>();
      await expect(
        client.$executeRawUnsafe(
          `INSERT INTO "licensing"."customers" ("id", "customer_code", "display_name", "created_at", "updated_at")
           VALUES ($1, 'CUST-LIVE-SELF', 'Duplicate code', now(), now())`,
          otherCustomer,
        ),
      ).rejects.toThrow();
      expect(await repository.findCustomerById(otherCustomer)).toBeNull();
    }, 60_000);

    /**
     * OD-LIC-06 / OQ-88 — a signed renewal, committed by the real transaction.
     *
     * PO decisions (design §13): Q-1 = `boundary`, so the renewal starts
     * governing at the target's exclusive end and the signed new end is applied
     * exactly; Q-2 = `coverage_end`, so the state reports the end of the
     * unbroken chain. What only PostgreSQL can prove is pinned here: the
     * persisted `governs_from`, the target's `governs_until` being its OWN end,
     * the typed audit row, the read-model projection and the atomicity of a
     * refusal.
     *
     * The suite shares ONE installation across its cases (only `beforeAll` and
     * `afterAll` clean the licensing tables), and the case before this block
     * resets the installation and leaves a chain ending at 2047-01-01. Every
     * window below therefore starts at the coverage end that chain actually
     * retained at that point in the file: the new identity is adjacent to it
     * (never overlapping and never leaving a gap) and the renewal then hands
     * over at the target's own end. A window placed anywhere else would be
     * refused by rules this change must not weaken.
     */
    const DAY_MS = 24 * 60 * 60 * 1000;
    const YEAR_MS = 365 * DAY_MS;
    const MONTH_MS = 30 * DAY_MS;
    /**
     * The grant the preceding case left on the chain. A renewal must never look
     * like a §8.6 reduction, so these documents keep it exactly: unlimited
     * organizations, 100 users, the same three modules.
     */
    const RETAINED_GRANT = {
      organizationLimit: null,
      userLimit: 100,
      moduleEntitlements: ['organization', 'users', 'rbac'],
    };

    /** The instant the installation's retained coverage currently ends. */
    async function retainedCoverageEnd(): Promise<Date> {
      const snapshot = await app
        .get(PersistentLicenseProvider)
        .versionHistory(new Date());
      expect(snapshot.coverageEnd).not.toBeNull();
      return new Date(snapshot.coverageEnd as string);
    }

    it('persists an early renewal at the target end, never truncating its term', async () => {
      const identity = await app.get(InstallationIdentityService).current();
      const installationId = identity.installationId;
      // Adjacent to the retained chain: no overlap with it and no gap.
      const termStart = await retainedCoverageEnd();
      const termEnd = new Date(termStart.getTime() + YEAR_MS);
      const renewedUntil = new Date(termEnd.getTime() + YEAR_MS);
      // Signed a month into the term it continues: the whole point of the
      // protocol is that the governance instant is derived, not signed.
      const issuedAt = new Date(termStart.getTime() + MONTH_MS);

      const target = licenseFor({
        installationId,
        validFrom: termStart,
        validUntil: termEnd,
        ...RETAINED_GRANT,
      });
      const first = await importOutcome(target);
      expect(first, first.message).toMatchObject({ applied: true });

      const renewal = licenseFor({
        installationId,
        validFrom: issuedAt,
        validUntil: renewedUntil,
        issuedAt,
        renewsOperationId: target.payload.operationId,
        ...RETAINED_GRANT,
      });
      const second = await importOutcome(renewal);
      expect(second, second.message).toMatchObject({ applied: true });

      const rows = await query<{
        id: string;
        operation_id: string;
        license_id: string;
        governs_from: Date | null;
        valid_from: Date;
        valid_until: Date | null;
        governs_until: Date | null;
        superseded_by_version_id: string | null;
      }>(
        `SELECT "id", "operation_id", "license_id", "governs_from",
                "valid_from", "valid_until", "governs_until",
                "superseded_by_version_id"
           FROM "licensing"."license_versions"
          WHERE "installation_id" = $1 AND "operation_id" IN ($2, $3)
          ORDER BY "imported_at", "id"`,
        installationId,
        target.payload.operationId,
        renewal.payload.operationId,
      );
      // Every earlier case in this file left retained rows behind on this
      // installation, so the assertion is scoped to this renewal and its target.
      expect(rows).toHaveLength(2);
      const [targetRow, renewalRow] = rows;

      // The renewal row stores the DERIVED start and keeps the signed facts.
      expect(new Date(renewalRow!.governs_from!).toISOString()).toBe(
        termEnd.toISOString(),
      );
      expect(new Date(renewalRow!.valid_from).toISOString()).toBe(
        issuedAt.toISOString(),
      );
      expect(new Date(renewalRow!.valid_until!).toISOString()).toBe(
        renewedUntil.toISOString(),
      );
      // The target is stamped at its OWN end: nothing was truncated, and the
      // target's signed window is untouched.
      expect(new Date(targetRow!.governs_until!).toISOString()).toBe(
        termEnd.toISOString(),
      );
      expect(new Date(targetRow!.valid_until!).toISOString()).toBe(
        termEnd.toISOString(),
      );
      expect(targetRow!.superseded_by_version_id).not.toBeNull();
      expect(
        (
          await query<{ id: string }>(
            `SELECT "id" FROM "licensing"."license_versions" WHERE "id" = $1`,
            targetRow!.superseded_by_version_id,
          )
        ).length,
      ).toBe(1);

      // The typed audit facts are recorded, and no generic APPLIED row shadows
      // them: exactly one `license.import.renewed` plus the target's
      // `license.version.superseded`.
      const events = await query<{
        event_type: string;
        reason: string | null;
        renewed_version_id: string | null;
        renewed_from: Date | null;
        renewed_until: Date | null;
        previous_license_id: string | null;
        operation_id: string | null;
      }>(
        `SELECT "event_type", "reason", "renewed_version_id", "renewed_from",
                "renewed_until", "previous_license_id", "operation_id"
           FROM "licensing"."license_audit_events"
          WHERE "installation_id" = $1
          ORDER BY "occurred_at", "id"`,
        installationId,
      );
      const renewed = events.filter(
        (event) =>
          event.event_type === 'license.import.renewed' &&
          event.operation_id === renewal.payload.operationId,
      );
      expect(renewed).toHaveLength(1);
      expect(renewed[0]).toMatchObject({
        // The typed fact names the RENEWED row; the chain edge on that row
        // names the renewal. They must agree in both directions.
        renewed_version_id: targetRow!.id,
        // The renewal was issued under a NEW license identity, so the
        // immediately preceding license is retained as context (PDR-14 §3.5.4
        // precedent); it is never a foreign key.
        previous_license_id: targetRow!.license_id,
        operation_id: renewal.payload.operationId,
      });
      expect(new Date(renewed[0]!.renewed_from!).toISOString()).toBe(
        termEnd.toISOString(),
      );
      expect(new Date(renewed[0]!.renewed_until!).toISOString()).toBe(
        renewedUntil.toISOString(),
      );
      const superseded = events.filter(
        (event) =>
          event.event_type === 'license.version.superseded' &&
          event.operation_id === target.payload.operationId,
      );
      expect(superseded).toHaveLength(1);
      expect(superseded[0]!.reason).toBeNull();
      expect(
        events.filter(
          (event) =>
            event.event_type === 'license.import.applied' &&
            event.operation_id === renewal.payload.operationId,
        ),
      ).toHaveLength(0);

      // The read model reports the signed operation id, the derived effective
      // start, and the chain end (PO decision Q-2). The instant is inside the
      // target's term, so the renewal is genuinely scheduled there.
      const duringTarget = new Date(termStart.getTime() + DAY_MS);
      const history = await app
        .get(PersistentLicenseProvider)
        .versionHistory(duringTarget);
      const renewalSummary = history.versions.find(
        (version) => version.operationId === renewal.payload.operationId,
      );
      expect(renewalSummary).toMatchObject({
        effectiveFrom: termEnd.toISOString(),
        validFrom: issuedAt.toISOString(),
      });
      expect(history.coverageEnd).toBe(renewedUntil.toISOString());
      expect(history.scheduled?.operationId).toBe(renewal.payload.operationId);

      // Before the boundary the TARGET still governs and the renewal is only
      // scheduled; at the boundary the renewal takes over.
      const before = await app
        .get(LicensingService)
        .current(new Date(termEnd.getTime() - 1));
      expect(before).toMatchObject({ active: true, userLimit: 100 });
      const atBoundary = await app.get(LicensingService).current(termEnd);
      expect(atBoundary).toMatchObject({ active: true, userLimit: 100 });
      const after = await app
        .get(LicensingService)
        .current(new Date(termEnd.getTime() + 180 * DAY_MS));
      expect(after).toMatchObject({ active: true });
    }, 60_000);

    it('refuses a stale renewal target in the transaction and writes nothing', async () => {
      const identity = await app.get(InstallationIdentityService).current();
      const installationId = identity.installationId;
      const termStart = await retainedCoverageEnd();
      const termEnd = new Date(termStart.getTime() + YEAR_MS);
      const renewedUntil = new Date(termEnd.getTime() + YEAR_MS);
      const issuedAt = new Date(termStart.getTime() + MONTH_MS);

      const first = licenseFor({
        installationId,
        validFrom: termStart,
        validUntil: termEnd,
        ...RETAINED_GRANT,
      });
      const firstOutcome = await importOutcome(first);
      expect(firstOutcome, firstOutcome.message).toMatchObject({
        applied: true,
      });
      const renewal = licenseFor({
        installationId,
        validFrom: issuedAt,
        validUntil: renewedUntil,
        issuedAt,
        renewsOperationId: first.payload.operationId,
        ...RETAINED_GRANT,
      });
      const renewalOutcome = await importOutcome(renewal);
      expect(renewalOutcome, renewalOutcome.message).toMatchObject({
        applied: true,
      });

      const versionsBefore = await count(
        `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
          WHERE "installation_id" = $1`,
        installationId,
      );
      const auditBefore = await count(
        `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_audit_events"
          WHERE "installation_id" = $1`,
        installationId,
      );

      // The tail is now the applied renewal, so renewing the ORIGINAL target
      // again would stack two extensions of the same term.
      const staleIssuedAt = new Date(renewedUntil.getTime() - MONTH_MS);
      const stale = licenseFor({
        installationId,
        validFrom: staleIssuedAt,
        validUntil: new Date(renewedUntil.getTime() + YEAR_MS),
        issuedAt: staleIssuedAt,
        renewsOperationId: first.payload.operationId,
        ...RETAINED_GRANT,
      });
      const refused = await importOutcome(stale);
      // The named version already carries a recorded supersession, which the
      // design classifies as an unknown target (it is no longer renewable at
      // all); nothing is written either way.
      expect(refused).toMatchObject({
        applied: false,
        status: 409,
        reason: 'renewal-target-unknown',
      });

      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "installation_id" = $1`,
          installationId,
        ),
      ).toBe(versionsBefore);
      // A refusal is audited as exactly one rejection — never as an APPLIED
      // fact, a renewal fact or a version.
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_audit_events"
            WHERE "installation_id" = $1`,
          installationId,
        ),
      ).toBe(auditBefore + 1);
      const latest = await query<{
        event_type: string;
        outcome: string;
        operation_id: string | null;
        reason: string | null;
      }>(
        `SELECT "event_type", "outcome", "operation_id", "reason"
           FROM "licensing"."license_audit_events"
          WHERE "installation_id" = $1
          ORDER BY "occurred_at" DESC, "id" DESC
          LIMIT 1`,
        installationId,
      );
      expect(latest[0]).toMatchObject({
        event_type: 'license.import.rejected',
        outcome: 'REJECTED',
        operation_id: stale.payload.operationId,
        reason: 'renewal-target-unknown',
      });
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_versions"
            WHERE "operation_id" = $1`,
          stale.payload.operationId,
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_audit_events"
            WHERE "event_type" = 'license.import.renewed' AND "operation_id" = $1`,
          stale.payload.operationId,
        ),
      ).toBe(0);
    }, 60_000);

    it('lets exactly one of two concurrent renewals of the same target commit', async () => {
      const identity = await app.get(InstallationIdentityService).current();
      const installationId = identity.installationId;
      const termStart = await retainedCoverageEnd();
      const termEnd = new Date(termStart.getTime() + YEAR_MS);

      const target = licenseFor({
        installationId,
        validFrom: termStart,
        validUntil: termEnd,
        ...RETAINED_GRANT,
      });
      const targetOutcome = await importOutcome(target);
      expect(targetOutcome, targetOutcome.message).toMatchObject({
        applied: true,
      });

      const leftIssuedAt = new Date(termStart.getTime() + 10 * DAY_MS);
      const rightIssuedAt = new Date(termStart.getTime() + 20 * DAY_MS);
      const left = licenseFor({
        installationId,
        validFrom: leftIssuedAt,
        validUntil: new Date(termEnd.getTime() + YEAR_MS),
        issuedAt: leftIssuedAt,
        renewsOperationId: target.payload.operationId,
        ...RETAINED_GRANT,
      });
      const right = licenseFor({
        installationId,
        validFrom: rightIssuedAt,
        validUntil: new Date(termEnd.getTime() + 2 * YEAR_MS),
        issuedAt: rightIssuedAt,
        renewsOperationId: target.payload.operationId,
        ...RETAINED_GRANT,
      });

      const outcomes = await raceImports([left, right]);
      expect(outcomes.filter((outcome) => outcome.applied)).toHaveLength(1);
      for (const refused of outcomes.filter((outcome) => !outcome.applied)) {
        expect(refused.status).toBe(409);
        // The loser resolves against the winner's committed rows: either the
        // target now carries a recorded supersession (`renewal-target-unknown`)
        // or the tail moved to the winner (`renewal-target-not-current`).
        expect([
          'renewal-target-unknown',
          'renewal-target-not-current',
        ]).toContain(refused.reason);
      }

      // One committed renewal at the target's end; the target is stamped once.
      const rows = await query<{
        operation_id: string;
        governs_from: Date | null;
        superseded_at: Date | null;
      }>(
        `SELECT "operation_id", "governs_from", "superseded_at"
           FROM "licensing"."license_versions"
          WHERE "installation_id" = $1 AND "operation_id" IN ($2, $3, $4)
          ORDER BY "imported_at", "id"`,
        installationId,
        target.payload.operationId,
        left.payload.operationId,
        right.payload.operationId,
      );
      const renewals = rows.filter((row) => row.governs_from !== null);
      expect(renewals).toHaveLength(1);
      const winner =
        outcomes.find((outcome) => outcome.applied)?.document.payload
          .operationId ?? null;
      expect(renewals[0]!.operation_id).toBe(winner);
      expect(
        rows.filter(
          (row) =>
            row.operation_id === target.payload.operationId &&
            row.superseded_at !== null,
        ),
      ).toHaveLength(1);
    }, 60_000);

    it('persists a revocation, keeps one row per license and refuses every later version', async () => {
      await resetApplicationForFreshInstallation();
      const identity = await app.get(InstallationIdentityService).current();
      const issued = licenseFor({
        installationId: identity.installationId,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2027-01-01T00:00:00.000Z'),
      });
      await app.get(LicenseImportService).importDocument(issued.file);

      const artifact = await revocationArtifact(
        identity.installationId,
        issued.payload.licenseId,
        issued.payload.operationId,
      );
      const result = await app
        .get(LicenseRevocationService)
        .importRevocation(artifact.document);
      expect(result).toMatchObject({
        changed: true,
        outcome: 'APPLIED',
        alreadyApplied: false,
        revocation: {
          revocationId: artifact.payload.revocationId,
          licenseId: issued.payload.licenseId,
          targetOperationId: issued.payload.operationId,
          reason: 'CONTRACT_TERMINATION',
          issuerKeyId: artifact.payload.issuerKeyId,
        },
      });

      // 1. The license row is stamped, and both columns are set together.
      const stamped = await query<{
        revoked_at: Date | null;
        revocation_id: string | null;
      }>(
        `SELECT "revoked_at", "revocation_id" FROM "licensing"."licenses"
          WHERE "id" = $1`,
        issued.payload.licenseId,
      );
      expect(stamped[0]?.revocation_id).toBe(artifact.payload.revocationId);
      expect(stamped[0]?.revoked_at).toBeInstanceOf(Date);

      // 2. Exactly one revocation row for that license, with both digests.
      const row = await query<{
        artifact_sha256: string;
        canonical_payload_sha256: string;
        revocation_id: string;
      }>(
        `SELECT "revocation_id", "artifact_sha256", "canonical_payload_sha256"
           FROM "licensing"."license_revocations" WHERE "license_id" = $1`,
        issued.payload.licenseId,
      );
      expect(row).toHaveLength(1);
      expect(row[0]?.artifact_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(row[0]?.canonical_payload_sha256).toMatch(/^[0-9a-f]{64}$/);

      // 3. The typed audit event carries the revocation identity.
      const audit = await query<{
        event_type: string;
        outcome: string;
        revocation_id: string | null;
      }>(
        `SELECT "event_type", "outcome", "revocation_id"
           FROM "licensing"."license_audit_events"
          WHERE "installation_id" = $1 AND "event_type" = 'license.revocation.imported'`,
        identity.installationId,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        outcome: 'APPLIED',
        revocation_id: artifact.payload.revocationId,
      });

      // 4. A byte-identical duplicate is idempotent: no second row, no second
      //    audit event, and the historical first result comes back.
      const replay = await app
        .get(LicenseRevocationService)
        .importRevocation(artifact.document);
      expect(replay).toMatchObject({
        changed: false,
        outcome: 'UNCHANGED',
        alreadyApplied: true,
      });
      expect(replay.revocation.importedAt).toBe(result.revocation.importedAt);
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_revocations" WHERE "license_id" = $1`,
          issued.payload.licenseId,
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT COUNT(*)::bigint AS count FROM "licensing"."license_audit_events"
            WHERE "installation_id" = $1 AND "event_type" = 'license.revocation.imported'`,
          identity.installationId,
        ),
      ).toBe(1);

      // 5. A second, different revocation for the same license is refused by
      //    the service AND by the unique index if it ever reached the table.
      const later = await revocationArtifact(
        identity.installationId,
        issued.payload.licenseId,
        issued.payload.operationId,
      );
      await expect(
        app.get(LicenseRevocationService).importRevocation(later.document),
      ).rejects.toMatchObject({
        details: { reason: 'already-revoked' },
      });

      let uniqueViolation = false;
      try {
        await query(
          `INSERT INTO "licensing"."license_revocations"
             ("revocation_id","license_id","installation_id","customer_id","customer_code",
              "target_operation_id","reason","reason_detail","issuer_key_id","issued_at",
              "imported_at","artifact_sha256","canonical_payload_sha256")
           VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10,$11,$12)`,
          later.payload.revocationId,
          issued.payload.licenseId,
          identity.installationId,
          SELF_CUSTOMER,
          'CUST-LIVE-SELF',
          issued.payload.operationId,
          'FRAUD',
          later.payload.issuerKeyId,
          new Date(),
          new Date(),
          'a'.repeat(64),
          'b'.repeat(64),
        );
      } catch {
        uniqueViolation = true;
      }
      expect(uniqueViolation).toBe(true);

      // 6. No version may be applied to the revoked license — including the
      //    exact artifact that created it.
      await expect(
        app.get(LicenseImportService).importDocument(issued.file),
      ).rejects.toMatchObject({ details: { reason: 'license-revoked' } });

      // 7. The evaluated state reports revocation, never expiry/Grace.
      await expect(app.get(LicensingService).current()).resolves.toMatchObject({
        status: 'ACTIVE',
        active: false,
        inactiveReason: 'revoked',
        accessMode: 'BLOCKED',
        graceEndsAt: null,
        revokedAt: expect.any(Date) as unknown as Date,
      });
    }, 60_000);
  },
);
