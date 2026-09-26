import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import { AccountingConfigurationsService } from '../src/modules/accounting/application/accounting-configurations.service.js';
import { AccountsService } from '../src/modules/accounting/application/accounts.service.js';
import { AccountsRepository } from '../src/modules/accounting/data/accounts.repository.js';
import { CodingStructureVersionNotActiveError } from '../src/modules/accounting/data/accounting-structure-errors.js';
import { CodingStructuresService } from '../src/modules/accounting/application/coding-structures.service.js';
import { MAX_LEVEL_KIND_LENGTH } from '../src/modules/accounting/domain/accounting-configuration.js';
import { createTestApp } from './support/test-app.js';

/**
 * Live-database suite for the Task 11 accounting-configuration foundation and
 * its remediation. Runs only when `VARDENA_TEST_DATABASE_URL` points at a
 * migrated disposable database (CI: the `postgres` service after
 * `prisma migrate deploy`).
 *
 * What this suite can prove on a database migrated from empty:
 * - real PostgreSQL constraints: `accounting_configuration_id` NOT NULL, the
 *   FK that rejects an accounting-configuration id placed in the
 *   coding-structure-version column (D7), `ON DELETE RESTRICT` on the
 *   configuration FK, and the PARTIAL unique index
 *   `uq_accounting_configurations_org_active` that Prisma cannot declare;
 * - the declared storage width of `level_kind` matches the API/domain contract;
 * - the ROOT write boundary re-checks the coding-structure version's ACTIVE
 *   status inside the locked transaction (`AccountsRepository.createChecked`),
 *   not only in the service's pre-flight resolution;
 * - D4: account creation does NOT touch `operationally_used_at`.
 *
 * What this suite deliberately does NOT claim — because a live suite running
 * against an empty-then-migrated database cannot observe it — is the populated
 * PRE-Task-11 backfill: orphan organizations, legacy configuration creation,
 * copied/ONE-level level sets, NOT NULL enforcement over existing rows, and
 * partial-index behaviour against data that already exists. That is verified
 * by the deterministic migration rehearsal against a disposable PostgreSQL:
 *   `node prisma/rehearsal/task-11-configuration-foundation/rehearse.mjs`
 *   (or `npm run test:migration-rehearsal`), which seeds populated pre-Task-11
 *   data, applies the migration under a lock probe and runs `verify.sql`.
 */

const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

interface RawClient {
  $queryRaw: <T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<T[]>;
}

describe.skipIf(DATABASE_URL === undefined)(
  'Accounting Configuration Foundation (live DB) — Task 11 + remediation',
  () => {
    const suffix = generateId().slice(-8);
    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let client: RawClient;
    let orgId = '';

    const LEVELS = [
      {
        levelIndex: 1,
        title: 'Group',
        digitLength: 2,
        defaultIsPostable: false,
      },
      {
        levelIndex: 2,
        title: 'Detail',
        digitLength: 3,
        defaultIsPostable: true,
        levelKind: 'detail',
      },
    ];
    const CODING_LEVELS = LEVELS;

    beforeAll(async () => {
      const built = await createTestApp({
        override: (builder) =>
          builder
            .overrideProvider(APP_CONFIG)
            .useValue({ ...loadAppConfig(), databaseUrl: DATABASE_URL }),
      });
      app = built.app;
      prisma = built.module.get(PrismaService);
      client = await prisma.getClient<RawClient>();
      const orgs = app.get(OrganizationsService);
      orgId = (
        await orgs.createOrganization({
          code: `CFG-${suffix}`,
          name: 'Cfg live org',
        })
      ).id;
    }, 60_000);

    afterAll(async () => {
      if (app === undefined) return;
      try {
        const cleanup = await prisma.getClient<{
          account: { deleteMany: (args: unknown) => Promise<unknown> };
          accountingConfigurationLevel: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          accountingConfiguration: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          codingStructureLevel: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          codingStructureVersion: {
            deleteMany: (args: unknown) => Promise<unknown>;
          };
          organization: { deleteMany: (args: unknown) => Promise<unknown> };
        }>();
        await cleanup.account.deleteMany({ where: { organizationId: orgId } });
        await cleanup.accountingConfigurationLevel.deleteMany({
          where: { organizationId: orgId },
        });
        await cleanup.accountingConfiguration.deleteMany({
          where: { organizationId: orgId },
        });
        await cleanup.codingStructureLevel.deleteMany({
          where: { organizationId: orgId },
        });
        await cleanup.codingStructureVersion.deleteMany({
          where: { organizationId: orgId },
        });
        await cleanup.organization.deleteMany({ where: { id: orgId } });
      } finally {
        await app.close();
      }
    }, 60_000);

    it('D1,D2: a root pins to the ACTIVE configuration AND the active coding version (distinct rows)', async () => {
      const configs = app!.get(AccountingConfigurationsService);
      const codings = app!.get(CodingStructuresService);
      const accounts = app!.get(AccountsService);

      const codingDraft = await codings.createVersion({
        organizationId: orgId,
        code: 'DEFAULT',
        maxDepth: 2,
        levels: CODING_LEVELS as never,
      });
      await codings.publishVersion(orgId, codingDraft.id);

      const draft = await configs.createConfiguration({
        organizationId: orgId,
        code: 'DEFAULT',
        name: 'Main',
        levels: LEVELS as never,
      });
      const published = await configs.publishConfiguration(orgId, draft.id);

      const acc = await accounts.createAccount({
        organizationId: orgId,
        code: '10',
        title: 'Assets',
        accountNature: 'debit',
      });
      expect(acc.accountingConfigurationId).toBe(published.id);
      expect(acc.codingStructureVersionId).toBe(codingDraft.id);

      const rows = await client.$queryRaw<{
        accounting_configuration_id: string;
        coding_structure_version_id: string;
      }>`
        SELECT "accounting_configuration_id", "coding_structure_version_id"
          FROM "accounting"."accounts"
         WHERE "id" = ${acc.id}`;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.accounting_configuration_id).toBe(published.id);
      expect(rows[0]!.coding_structure_version_id).toBe(codingDraft.id);
      expect(rows[0]!.accounting_configuration_id).not.toBe(
        rows[0]!.coding_structure_version_id,
      );
    }, 60_000);

    it('D6: a root without an ACTIVE accounting configuration fails with the typed BusinessRuleViolation', async () => {
      const configs = app!.get(AccountingConfigurationsService);
      const codings = app!.get(CodingStructuresService);
      const accounts = app!.get(AccountsService);
      const orgs = app!.get(OrganizationsService);

      const org2 = (
        await orgs.createOrganization({
          code: `CFG2-${suffix}`,
          name: 'Cfg live org 2',
        })
      ).id;

      // An ACTIVE coding structure but NO accounting configuration: the typed
      // error (D6 — no string matching) must become a 422 business rule whose
      // message names the accounting configuration.
      const codingDraft = await codings.createVersion({
        organizationId: org2,
        code: 'DEFAULT',
        maxDepth: 2,
        levels: CODING_LEVELS as never,
      });
      await codings.publishVersion(org2, codingDraft.id);

      let failure: { code?: string; message?: string } | null = null;
      try {
        await accounts.createAccount({
          organizationId: org2,
          code: '10',
          title: 'Assets',
          accountNature: 'debit',
        });
      } catch (error) {
        failure = error as { code?: string; message?: string };
      }
      expect(failure).not.toBeNull();
      expect(failure!.code).toBe('BusinessRuleViolation');
      expect(String(failure!.message)).toMatch(/accounting configuration/i);

      // Publish the configuration and the very same request succeeds.
      const draft = await configs.createConfiguration({
        organizationId: org2,
        code: 'DEFAULT',
        name: 'Main',
        levels: LEVELS as never,
      });
      await configs.publishConfiguration(org2, draft.id);
      const acc = await accounts.createAccount({
        organizationId: org2,
        code: '10',
        title: 'Assets',
        accountNature: 'debit',
      });
      expect(acc.accountingConfigurationId).toBeTruthy();
      expect(acc.codingStructureVersionId).toBeTruthy();

      // Cleanup org2 (same order the afterAll hook uses).
      const cleanup = await prisma.getClient<{
        account: { deleteMany: (args: unknown) => Promise<unknown> };
        accountingConfigurationLevel: {
          deleteMany: (args: unknown) => Promise<unknown>;
        };
        accountingConfiguration: {
          deleteMany: (args: unknown) => Promise<unknown>;
        };
        codingStructureLevel: {
          deleteMany: (args: unknown) => Promise<unknown>;
        };
        codingStructureVersion: {
          deleteMany: (args: unknown) => Promise<unknown>;
        };
        organization: { deleteMany: (args: unknown) => Promise<unknown> };
      }>();
      await cleanup.account.deleteMany({ where: { organizationId: org2 } });
      await cleanup.accountingConfigurationLevel.deleteMany({
        where: { organizationId: org2 },
      });
      await cleanup.accountingConfiguration.deleteMany({
        where: { organizationId: org2 },
      });
      await cleanup.codingStructureLevel.deleteMany({
        where: { organizationId: org2 },
      });
      await cleanup.codingStructureVersion.deleteMany({
        where: { organizationId: org2 },
      });
      await cleanup.organization.deleteMany({ where: { id: org2 } });
    }, 60_000);

    /**
     * Repaired FK-negative test. The previous version could not fail: it threw
     * its own error inside the `try`, caught it, and asserted only that the
     * caught MESSAGE matched /fk|foreign|mismatch/ — which its own message did.
     * Here the oracle is the DATABASE STATE (the row must not exist) and a
     * CONTROL insert proves the probe shape itself is valid.
     */
    it('D7: the coding_structure_version_id FK rejects the configuration id (control + DB-state oracle)', async () => {
      const configs = app!.get(AccountingConfigurationsService);
      const published = await configs.getActiveConfiguration(orgId);

      const versionRows = await client.$queryRaw<{ id: string }>`
        SELECT "id" FROM "accounting"."coding_structure_versions"
         WHERE "organization_id" = ${orgId} AND "status" = 'active'
         ORDER BY "version_number" DESC LIMIT 1`;
      expect(versionRows).toHaveLength(1);
      const validVersionId = versionRows[0]!.id;

      // Control: the exact INSERT shape with a VALID coding-version id must
      // succeed. Without this control the negative probe below could pass for
      // an unrelated reason (missing privilege, wrong column list, …).
      const controlId = generateId();
      await client.$queryRaw`
        INSERT INTO "accounting"."accounts"
          ("id", "organization_id", "code", "title", "parent_id", "level",
           "coding_structure_version_id", "accounting_configuration_id",
           "account_nature", "is_postable", "is_active", "created_at", "updated_at")
        VALUES (${controlId}, ${orgId}, '50', 'Control', NULL, 1,
                ${validVersionId}, ${published.id}, 'debit', false, true, NOW(), NOW())`;
      const control = await client.$queryRaw<{ id: string }>`
        SELECT "id" FROM "accounting"."accounts" WHERE "id" = ${controlId}`;
      expect(control).toHaveLength(1);

      // Negative: the accounting-configuration id in the coding-version column
      // must be rejected by the FK, and NO row may be written.
      const probeId = generateId();
      let rejection: unknown = null;
      try {
        await client.$queryRaw`
          INSERT INTO "accounting"."accounts"
            ("id", "organization_id", "code", "title", "parent_id", "level",
             "coding_structure_version_id", "accounting_configuration_id",
             "account_nature", "is_postable", "is_active", "created_at", "updated_at")
          VALUES (${probeId}, ${orgId}, '51', 'Fake', NULL, 1,
                  ${published.id}, ${published.id}, 'debit', false, true, NOW(), NOW())`;
      } catch (error) {
        rejection = error;
      }

      const written = await client.$queryRaw<{ id: string }>`
        SELECT "id" FROM "accounting"."accounts" WHERE "id" = ${probeId}`;
      expect(written).toHaveLength(0);
      expect(rejection).not.toBeNull();
      expect(String((rejection as Error).message)).toMatch(
        /foreign key|23503|P2003|fk_accounting_accounts_coding_structure_version/i,
      );
    }, 60_000);

    /**
     * Repaired partial-unique test. The previous version only counted ACTIVE
     * rows (`expect(count).toBe(1)`), which a plain non-partial index, a
     * missing index, or application-level superseding would all satisfy. Here
     * the index definition is asserted AND a violating raw INSERT is attempted
     * with a DRAFT control proving the probe shape is otherwise acceptable.
     */
    it('item 6: the PARTIAL unique index rejects a second ACTIVE configuration for one organization', async () => {
      const index = await client.$queryRaw<{ indexdef: string }>`
        SELECT "indexdef" FROM "pg_indexes"
         WHERE "schemaname" = 'accounting'
           AND "tablename" = 'accounting_configurations'
           AND "indexname" = 'uq_accounting_configurations_org_active'`;
      expect(index).toHaveLength(1);
      expect(index[0]!.indexdef).toMatch(/UNIQUE/i);
      expect(index[0]!.indexdef).toMatch(/WHERE/i);
      expect(index[0]!.indexdef).toMatch(/ACTIVE/i);

      // Control: the same INSERT with a non-ACTIVE status must be accepted, so
      // the rejection below is attributable to the partial index, not to the
      // row shape.
      const controlId = generateId();
      await client.$queryRaw`
        INSERT INTO "accounting"."accounting_configurations"
          ("id", "organization_id", "code", "name", "version_number", "status", "created_at", "updated_at")
        VALUES (${controlId}, ${orgId}, ${`PROBE-DRAFT-${suffix}`}, 'Draft control', 1, 'DRAFT', NOW(), NOW())`;
      const control = await client.$queryRaw<{ id: string }>`
        SELECT "id" FROM "accounting"."accounting_configurations" WHERE "id" = ${controlId}`;
      expect(control).toHaveLength(1);

      // Violating INSERT: a second ACTIVE configuration for the same org.
      const probeId = generateId();
      let rejection: unknown = null;
      try {
        await client.$queryRaw`
          INSERT INTO "accounting"."accounting_configurations"
            ("id", "organization_id", "code", "name", "version_number", "status", "created_at", "updated_at")
          VALUES (${probeId}, ${orgId}, ${`PROBE-ACTIVE-${suffix}`}, 'Second ACTIVE probe', 1, 'ACTIVE', NOW(), NOW())`;
      } catch (error) {
        rejection = error;
      }
      const written = await client.$queryRaw<{ id: string }>`
        SELECT "id" FROM "accounting"."accounting_configurations" WHERE "id" = ${probeId}`;
      expect(written).toHaveLength(0);
      expect(rejection).not.toBeNull();
      expect(String((rejection as Error).message)).toMatch(
        /unique|23505|duplicate key/i,
      );

      const actives = await client.$queryRaw<{ count: number }>`
        SELECT COUNT(*)::int AS "count"
          FROM "accounting"."accounting_configurations"
         WHERE "organization_id" = ${orgId} AND "status" = 'ACTIVE'`;
      expect(actives[0]!.count).toBe(1);
    }, 60_000);

    /**
     * The part of the D3 story a live database migrated from empty CAN prove:
     * the final schema state. The populated backfill (orphan organizations,
     * legacy configurations, copied/ONE-level level sets) is NOT observable
     * here and is verified by `rehearse.mjs` / `verify.sql` instead — see the
     * suite header.
     */
    it('D3 (final schema state): NOT NULL backfilled column, no NULL rows, FK RESTRICT on delete', async () => {
      const colInfo = await client.$queryRaw<{ is_nullable: string }>`
        SELECT "is_nullable" FROM information_schema.columns
         WHERE table_schema = 'accounting' AND table_name = 'accounts'
           AND column_name = 'accounting_configuration_id'`;
      expect(colInfo).toHaveLength(1);
      expect(colInfo[0]!.is_nullable).toBe('NO');

      const nullCount = await client.$queryRaw<{ count: number }>`
        SELECT COUNT(*)::int AS "count" FROM "accounting"."accounts"
         WHERE "accounting_configuration_id" IS NULL`;
      expect(nullCount[0]!.count).toBe(0);

      // A configuration referenced by an account cannot be deleted (RESTRICT,
      // not CASCADE): the legacy configs the migration creates depend on this.
      const configs = app!.get(AccountingConfigurationsService);
      const active = await configs.getActiveConfiguration(orgId);
      let rejected = false;
      try {
        await client.$queryRaw`
          DELETE FROM "accounting"."accounting_configurations" WHERE "id" = ${active.id}`;
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
      const stillThere = await client.$queryRaw<{ id: string }>`
        SELECT "id" FROM "accounting"."accounting_configurations" WHERE "id" = ${active.id}`;
      expect(stillThere).toHaveLength(1);
    }, 60_000);

    it('item 5: level_kind is stored at its declared width — 20 characters round-trip, 21 are refused', async () => {
      const configs = app!.get(AccountingConfigurationsService);

      const width = await client.$queryRaw<{
        character_maximum_length: number;
      }>`
        SELECT "character_maximum_length" FROM information_schema.columns
         WHERE table_schema = 'accounting'
           AND table_name = 'accounting_configuration_levels'
           AND column_name = 'level_kind'`;
      expect(width[0]!.character_maximum_length).toBe(MAX_LEVEL_KIND_LENGTH);

      // A 20-character label is stored verbatim — never truncated.
      const twenty = 'k'.repeat(MAX_LEVEL_KIND_LENGTH);
      const draft = await configs.createConfiguration({
        organizationId: orgId,
        code: 'KIND20',
        name: 'Kind width',
        levels: [
          {
            levelIndex: 1,
            title: 'Group',
            digitLength: 2,
            defaultIsPostable: false,
            levelKind: twenty,
          },
        ],
      });
      expect(draft.levels[0]!.levelKind).toBe(twenty);

      // 21 characters are refused by the API/domain contract (400) before the
      // database sees them; nothing is written and nothing is truncated.
      let failure: { code?: string } | null = null;
      try {
        await configs.createConfiguration({
          organizationId: orgId,
          code: 'KIND21',
          name: 'Kind too long',
          levels: [
            {
              levelIndex: 1,
              title: 'Group',
              digitLength: 2,
              defaultIsPostable: false,
              levelKind: 'k'.repeat(MAX_LEVEL_KIND_LENGTH + 1),
            },
          ],
        });
      } catch (error) {
        failure = error as { code?: string };
      }
      expect(failure).not.toBeNull();
      expect(failure!.code).toBe('BadRequest');
      const kindRows = await client.$queryRaw<{ count: number }>`
        SELECT COUNT(*)::int AS "count"
          FROM "accounting"."accounting_configuration_levels"
         WHERE "organization_id" = ${orgId} AND "level_kind" = ${'k'.repeat(21)}`;
      expect(kindRows[0]!.count).toBe(0);
    }, 60_000);

    it('item 3: the ROOT write boundary refuses a coding version that is no longer active', async () => {
      const configs = app!.get(AccountingConfigurationsService);
      const codings = app!.get(CodingStructuresService);
      const repository = app!.get(AccountsRepository);

      // v1 is published (ACTIVE); publishing v2 supersedes it. The service
      // would never resolve the superseded version again, so the write
      // boundary is exercised directly — exactly the state a concurrent
      // publish creates between resolution and the locked insert.
      const v1 = await codings.createVersion({
        organizationId: orgId,
        code: 'BOUNDARY',
        maxDepth: 2,
        levels: CODING_LEVELS as never,
      });
      await codings.publishVersion(orgId, v1.id);
      const v2 = await codings.createVersion({
        organizationId: orgId,
        code: 'BOUNDARY',
        maxDepth: 2,
        levels: CODING_LEVELS as never,
      });
      await codings.publishVersion(orgId, v2.id);

      const active = await configs.getActiveConfiguration(orgId);
      const levels = active.levels.map((level) => ({
        levelIndex: level.levelIndex,
        digitLength: level.digitLength,
        defaultIsPostable: level.defaultIsPostable,
      }));
      const structure = (versionId: string) => ({
        accountingConfigurationId: active.id,
        versionId,
        maxDepth: levels.length,
        levels,
        // ODR-1 (Task 19): the boundary snapshot carries the coding half of
        // the pair too; CODING_LEVELS and the ACTIVE configuration's levels
        // describe the same shape in this fixture, so coherence holds.
        codingLevels: CODING_LEVELS,
      });

      let failure: unknown = null;
      try {
        await repository.createChecked({
          id: generateId(),
          organizationId: orgId,
          code: '70',
          title: 'Stale pin',
          parentId: null,
          accountNature: 'debit',
          isPostable: false,
          structure: structure(v1.id),
          now: new Date(),
          actorId: null,
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(CodingStructureVersionNotActiveError);
      const staleRows = await client.$queryRaw<{ count: number }>`
        SELECT COUNT(*)::int AS "count" FROM "accounting"."accounts"
         WHERE "organization_id" = ${orgId} AND "code" = '70'`;
      expect(staleRows[0]!.count).toBe(0);

      // The ACTIVE version is accepted by the same boundary.
      const created = await repository.createChecked({
        id: generateId(),
        organizationId: orgId,
        code: '71',
        title: 'Fresh pin',
        parentId: null,
        accountNature: 'debit',
        isPostable: false,
        structure: structure(v2.id),
        now: new Date(),
        actorId: null,
      });
      expect(created.codingStructureVersionId).toBe(v2.id);
      expect(created.accountingConfigurationId).toBe(active.id);
    }, 60_000);

    it('D4: markOperationallyUsed deferred — NOT called on Account creation (first Voucher, not Account)', async () => {
      const configs = app!.get(AccountingConfigurationsService);
      const accounts = app!.get(AccountsService);

      const before = await configs.getActiveConfiguration(orgId);
      expect(before.operationallyUsedAt).toBeNull();
      expect(before.isOperationallyUsed).toBe(false);

      await accounts.createAccount({
        organizationId: orgId,
        code: '60',
        title: 'Deferred marker probe',
        accountNature: 'debit',
      });

      const after = await configs.getConfiguration(orgId, before.id);
      expect(after.operationallyUsedAt).toBeNull();
    }, 60_000);
  },
);
