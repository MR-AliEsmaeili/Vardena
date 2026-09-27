import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import { AccountingConfigurationsService } from '../src/modules/accounting/application/accounting-configurations.service.js';
import { CodingStructuresService } from '../src/modules/accounting/application/coding-structures.service.js';
import { AccountsService } from '../src/modules/accounting/application/accounts.service.js';
import { BaseChartTemplatesService } from '../src/modules/accounting/application/base-chart-templates.service.js';
import { BaseChartAdoptionsService } from '../src/modules/accounting/application/base-chart-adoptions.service.js';
import { BaseChartAdoptionsRepository } from '../src/modules/accounting/data/base-chart-adoptions.repository.js';
import { createTestApp } from './support/test-app.js';

/**
 * Task 23 PostgreSQL integration suite.
 *
 * Unlike the contract-fast unit/application specs, this suite uses the real
 * Prisma repositories and a migrated PostgreSQL database. It proves relational
 * persistence, guarded lifecycle transitions, immutable history, COPY adoption,
 * closure/mandatory selection, leaf-only materialization, conflict no-mutation,
 * transaction rollback, and version independence. CI supplies
 * VARDENA_TEST_DATABASE_URL after `prisma migrate deploy`; local execution is
 * deliberately opt-in under the repository test-execution policy.
 */
const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

const LEVELS = [
  { levelIndex: 1, digitLength: 2, defaultIsPostable: true },
  { levelIndex: 2, digitLength: 2, defaultIsPostable: true },
  { levelIndex: 3, digitLength: 2, defaultIsPostable: true },
] as const;

const CONFIG_LEVELS = LEVELS.map((level) => ({
  ...level,
  title: `Level ${level.levelIndex}`,
  levelKind: null,
}));

const TREE = [
  node('R1', null, '10', false),
  node('R1C1', 'R1', '1010', false),
  node('R1C1L1', 'R1C1', '101001', true),
  node('R1C2', 'R1', '1020', true),
  node('R2', null, '20', false),
  node('R2C1', 'R2', '2010', true),
] as const;

const TREE_WITH_MANDATORY = TREE.map((entry) => ({
  ...entry,
  isMandatory: entry.nodeKey === 'R2C1',
}));

type QueryClient = {
  $queryRaw: <T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<T[]>;
  account: {
    count: (args: unknown) => Promise<number>;
  };
  baseChartAdoption: {
    count: (args: unknown) => Promise<number>;
  };
};

describe.skipIf(DATABASE_URL === undefined)(
  'Task 23 Base Chart repositories (PostgreSQL integration)',
  () => {
    const suffix = generateId().slice(-10);
    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let db: QueryClient;
    let templates: BaseChartTemplatesService;
    let adoptions: BaseChartAdoptionsService;
    let adoptionRepository: BaseChartAdoptionsRepository;
    let organizations: OrganizationsService;
    let coding: CodingStructuresService;
    let configurations: AccountingConfigurationsService;
    let accounts: AccountsService;
    let sequence = 0;

    beforeAll(async () => {
      const built = await createTestApp({
        override: (builder) =>
          builder
            .overrideProvider(APP_CONFIG)
            .useValue({ ...loadAppConfig(), databaseUrl: DATABASE_URL }),
      });
      app = built.app;
      prisma = built.module.get(PrismaService);
      db = await prisma.getClient<QueryClient>();
      templates = app.get(BaseChartTemplatesService);
      adoptions = app.get(BaseChartAdoptionsService);
      adoptionRepository = app.get(BaseChartAdoptionsRepository);
      organizations = app.get(OrganizationsService);
      coding = app.get(CodingStructuresService);
      configurations = app.get(AccountingConfigurationsService);
      accounts = app.get(AccountsService);
    }, 60_000);

    afterAll(async () => {
      await app?.close();
    }, 60_000);

    function next(label: string): string {
      sequence += 1;
      return `${label}-${suffix}-${sequence}`;
    }

    async function createOrganization(options?: {
      levels?: typeof CONFIG_LEVELS;
      withPins?: boolean;
    }): Promise<{
      organizationId: string;
      configurationId?: string;
      codingVersionId?: string;
    }> {
      const label = next('ORG');
      const organization = await organizations.createOrganization({
        code: label,
        name: `Task 23 ${label}`,
      });
      if (options?.withPins === false) {
        return { organizationId: organization.id };
      }
      const levels = options?.levels ?? CONFIG_LEVELS;
      const codingDraft = await coding.createVersion({
        organizationId: organization.id,
        code: 'BASE',
        maxDepth: levels.length,
        separator: '',
        levels,
      });
      const codingVersion = await coding.publishVersion(
        organization.id,
        codingDraft.id,
      );
      const configurationDraft = await configurations.createConfiguration({
        organizationId: organization.id,
        code: 'BASE',
        name: 'Base Chart Integration Configuration',
        levels,
      });
      const configuration = await configurations.publishConfiguration(
        organization.id,
        configurationDraft.id,
      );
      return {
        organizationId: organization.id,
        configurationId: configuration.id,
        codingVersionId: codingVersion.id,
      };
    }

    async function createDraft(
      nodes: ReadonlyArray<ReturnType<typeof node>> = TREE,
      levels: typeof LEVELS = LEVELS,
    ) {
      return templates.createTemplate({
        code: next('TPL'),
        title: 'Task 23 integration template',
        maxDepth: levels.length,
        levels,
        nodes,
      });
    }

    async function publish(
      nodes: ReadonlyArray<ReturnType<typeof node>> = TREE,
    ) {
      const created = await createDraft(nodes);
      const version = created.versions[0]!;
      await templates.approve(version.id);
      return {
        templateId: created.template.id,
        version: await templates.publish(version.id),
      };
    }

    async function persistedAccounts(organizationId: string) {
      return db.$queryRaw<{
        id: string;
        organization_id: string;
        code: string;
        parent_id: string | null;
        level: number;
        account_nature: string;
        is_postable: boolean;
        accounting_configuration_id: string;
        coding_structure_version_id: string;
      }>`
        SELECT "id", "organization_id", "code", "parent_id", "level",
               "account_nature", "is_postable",
               "accounting_configuration_id", "coding_structure_version_id"
          FROM "accounting"."accounts"
         WHERE "organization_id" = ${organizationId}
         ORDER BY "code"`;
    }

    it('persists template + draft v1 shape, adjacency and derived levels; validates every draft replacement', async () => {
      const created = await createDraft();
      expect(created.versions[0]).toMatchObject({
        versionNumber: 1,
        status: 'draft',
        maxDepth: 3,
      });

      const rows = await db.$queryRaw<{
        id: string;
        node_key: string;
        parent_node_key: string | null;
        parent_id: string | null;
        level: number;
      }>`
        SELECT "id", "node_key", "parent_node_key", "parent_id", "level"
          FROM "accounting"."base_chart_template_nodes"
         WHERE "version_id" = ${created.versions[0]!.id}
         ORDER BY "node_key"`;
      expect(rows).toHaveLength(6);
      expect(rows.find((row) => row.node_key === 'R1C1L1')).toMatchObject({
        parent_node_key: 'R1C1',
        level: 3,
      });
      const parent = rows.find((row) => row.node_key === 'R1C1')!;
      expect(rows.find((row) => row.node_key === 'R1C1L1')!.parent_id).toBe(
        parent.id,
      );

      const updatedNodes = TREE.map((entry) =>
        entry.nodeKey === 'R1C2'
          ? { ...entry, title: 'Edited draft title' }
          : entry,
      );
      const updated = await templates.updateVersionContent(
        created.versions[0]!.id,
        { nodes: updatedNodes },
      );
      expect(
        updated.nodes.find((entry) => entry.nodeKey === 'R1C2')?.title,
      ).toBe('Edited draft title');

      const before = await templates.getVersion(created.versions[0]!.id);
      await expect(
        templates.updateVersionContent(created.versions[0]!.id, {
          nodes: TREE.map((entry) =>
            entry.nodeKey === 'R1C1'
              ? { ...entry, parentNodeKey: 'MISSING' }
              : entry,
          ),
        }),
      ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
      await expect(
        templates.updateVersionContent(created.versions[0]!.id, {
          nodes: TREE.map((entry) =>
            entry.nodeKey === 'R1'
              ? { ...entry, parentNodeKey: 'R1C1' }
              : entry,
          ),
        }),
      ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
      expect(await templates.getVersion(created.versions[0]!.id)).toEqual(
        before,
      );
    }, 60_000);

    it('persists Draft → Approved → Published, supersedes with v2, and keeps both immutable histories', async () => {
      const created = await createDraft();
      const v1 = created.versions[0]!;
      await expect(templates.publish(v1.id)).rejects.toMatchObject({
        code: 'BusinessRuleViolation',
      });
      expect((await templates.approve(v1.id)).status).toBe('approved');
      expect((await templates.publish(v1.id)).status).toBe('published');
      await expect(
        templates.updateVersionContent(v1.id, { nodes: TREE }),
      ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });

      const v2 = await templates.createVersion({
        templateId: created.template.id,
        maxDepth: 3,
        levels: LEVELS,
        nodes: TREE.map((entry) => ({ ...entry, title: `${entry.title} v2` })),
      });
      await templates.approve(v2.id);
      expect((await templates.publish(v2.id)).status).toBe('published');
      const old = await templates.getVersion(v1.id);
      expect(old.status).toBe('superseded');
      expect(old.supersededByVersionId).toBe(v2.id);
      await expect(
        templates.updateVersionContent(v1.id, { nodes: TREE }),
      ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
      await expect(templates.approve(v1.id)).rejects.toMatchObject({
        code: 'BusinessRuleViolation',
      });
      const history = await templates.listVersions({
        templateId: created.template.id,
        page: 1,
        pageSize: 10,
      });
      expect(
        history.items.map((entry) => [entry.versionNumber, entry.status]),
      ).toEqual([
        [2, 'published'],
        [1, 'superseded'],
      ]);
    }, 60_000);

    it('full adoption COPY creates ordinary organization accounts with tree, nature and active configuration pins', async () => {
      const target = await createOrganization();
      const { version } = await publish();
      const adoption = await adoptions.adopt({
        organizationId: target.organizationId,
        templateVersionId: version.id,
      });
      expect(adoption.accountCount).toBe(TREE.length);

      const rows = await persistedAccounts(target.organizationId);
      expect(rows).toHaveLength(TREE.length);
      expect(new Set(rows.map((row) => row.organization_id))).toEqual(
        new Set([target.organizationId]),
      );
      expect(
        new Set(rows.map((row) => row.accounting_configuration_id)),
      ).toEqual(new Set([target.configurationId]));
      expect(
        new Set(rows.map((row) => row.coding_structure_version_id)),
      ).toEqual(new Set([target.codingVersionId]));
      const root = rows.find((row) => row.code === '10')!;
      const child = rows.find((row) => row.code === '1010')!;
      const leaf = rows.find((row) => row.code === '101001')!;
      expect(root).toMatchObject({
        parent_id: null,
        level: 1,
        account_nature: 'debit',
      });
      expect(child).toMatchObject({ parent_id: root.id, level: 2 });
      expect(leaf).toMatchObject({ parent_id: child.id, level: 3 });

      const accountColumns = await db.$queryRaw<{ column_name: string }>`
        SELECT "column_name"
          FROM "information_schema"."columns"
         WHERE "table_schema" = 'accounting'
           AND "table_name" = 'accounts'`;
      expect(accountColumns.map((row) => row.column_name)).not.toContain(
        'template_node_id',
      );
      const ledgerFk = await db.$queryRaw<{ target_table: string }>`
        SELECT ccu.table_name AS "target_table"
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
           AND tc.constraint_schema = kcu.constraint_schema
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
           AND ccu.constraint_schema = tc.constraint_schema
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND tc.table_schema = 'accounting'
           AND tc.table_name = 'ledger_entries'
           AND kcu.column_name = 'account_id'`;
      expect(ledgerFk).toEqual([{ target_table: 'accounts' }]);
    }, 60_000);

    it('partial adoption materializes exactly requested + ancestor closure', async () => {
      const target = await createOrganization();
      const { version } = await publish();
      const result = await adoptions.adopt({
        organizationId: target.organizationId,
        templateVersionId: version.id,
        selectedNodeKeys: ['R1C1L1'],
      });
      expect(result.accountCount).toBe(3);
      expect(
        (await persistedAccounts(target.organizationId)).map((row) => row.code),
      ).toEqual(['10', '1010', '101001']);
    }, 60_000);

    it('mandatory inclusion adds the mandatory node and its ancestors to a partial selection', async () => {
      const target = await createOrganization();
      const { version } = await publish(TREE_WITH_MANDATORY);
      const preview = await adoptions.preview({
        organizationId: target.organizationId,
        templateVersionId: version.id,
        selectedNodeKeys: ['R1C1L1'],
      });
      expect(preview.verdict).toBe('compatible');
      expect(preview.finalSet.map((entry) => entry.nodeKey)).toEqual([
        'R1',
        'R2',
        'R1C1',
        'R2C1',
        'R1C1L1',
      ]);
      await adoptions.adopt({
        organizationId: target.organizationId,
        templateVersionId: version.id,
        selectedNodeKeys: ['R1C1L1'],
      });
      expect(
        (await persistedAccounts(target.organizationId)).map((row) => row.code),
      ).toEqual(['10', '1010', '101001', '20', '2010']);
    }, 60_000);

    it('enforces leaf-only posting in authored content and in PostgreSQL materialization', async () => {
      await expect(
        createDraft(
          TREE.map((entry) =>
            entry.nodeKey === 'R1' ? { ...entry, isPostable: true } : entry,
          ),
        ),
      ).rejects.toMatchObject({
        code: 'BusinessRuleViolation',
        details: { problem: 'node_parent_postable' },
      });

      const target = await createOrganization();
      const { version } = await publish();
      await adoptions.adopt({
        organizationId: target.organizationId,
        templateVersionId: version.id,
      });
      const rows = await persistedAccounts(target.organizationId);
      expect(rows.find((row) => row.code === '10')?.is_postable).toBe(false);
      expect(rows.find((row) => row.code === '1010')?.is_postable).toBe(false);
      expect(rows.find((row) => row.code === '101001')?.is_postable).toBe(true);
      const nonLeaves = rows.filter((candidate) =>
        rows.some((other) => other.parent_id === candidate.id),
      );
      expect(nonLeaves.every((row) => !row.is_postable)).toBe(true);
    }, 60_000);

    it('scopes adoption reads by organization and duplicate adoption changes neither account nor adoption count', async () => {
      const orgA = await createOrganization();
      const orgB = await createOrganization();
      const { version } = await publish();
      const adopted = await adoptions.adopt({
        organizationId: orgA.organizationId,
        templateVersionId: version.id,
      });
      expect(
        await adoptionRepository.findById(orgB.organizationId, adopted.id),
      ).toBeNull();
      expect(await persistedAccounts(orgB.organizationId)).toEqual([]);

      const beforeAccounts = await db.account.count({
        where: { organizationId: orgA.organizationId },
      });
      const beforeAdoptions = await db.baseChartAdoption.count({
        where: { organizationId: orgA.organizationId },
      });
      await expect(
        adoptions.adopt({
          organizationId: orgA.organizationId,
          templateVersionId: version.id,
        }),
      ).rejects.toMatchObject({ code: 'Conflict' });
      expect(
        await db.account.count({
          where: { organizationId: orgA.organizationId },
        }),
      ).toBe(beforeAccounts);
      expect(
        await db.baseChartAdoption.count({
          where: { organizationId: orgA.organizationId },
        }),
      ).toBe(beforeAdoptions);
    }, 60_000);

    it('rejects adoption into an existing chart with 409 and no merge or adoption row', async () => {
      const target = await createOrganization();
      await accounts.createAccount({
        organizationId: target.organizationId,
        code: '99',
        title: 'Existing account',
        accountNature: 'debit',
        isPostable: true,
      });
      const { version } = await publish();
      await expect(
        adoptions.adopt({
          organizationId: target.organizationId,
          templateVersionId: version.id,
        }),
      ).rejects.toMatchObject({ code: 'Conflict' });
      expect(await persistedAccounts(target.organizationId)).toHaveLength(1);
      expect(
        await db.baseChartAdoption.count({
          where: { organizationId: target.organizationId },
        }),
      ).toBe(0);
    }, 60_000);

    it('rolls back every account when an in-transaction unique constraint fails', async () => {
      const target = await createOrganization();
      const { version } = await publish();
      const resolved = await templates.getVersion(version.id);
      const duplicateAccountId = generateId();
      const accountIdFor = new Map(
        resolved.nodes.map((entry) => [entry.id, duplicateAccountId]),
      );
      const beforeAccounts = await db.account.count({
        where: { organizationId: target.organizationId },
      });
      const beforeAdoptions = await db.baseChartAdoption.count({
        where: { organizationId: target.organizationId },
      });
      await expect(
        adoptionRepository.adoptChecked({
          adoptionId: generateId(),
          organizationId: target.organizationId,
          templateVersionId: version.id,
          selectedNodeKeys: null,
          accountingConfigurationId: target.configurationId!,
          codingStructureVersionId: target.codingVersionId!,
          accountIdFor,
          now: new Date(),
          actorId: null,
        }),
      ).rejects.toBeDefined();
      expect(
        await db.account.count({
          where: { organizationId: target.organizationId },
        }),
      ).toBe(beforeAccounts);
      expect(
        await db.baseChartAdoption.count({
          where: { organizationId: target.organizationId },
        }),
      ).toBe(beforeAdoptions);
    }, 60_000);

    it('keeps an organization adopted at v1 unchanged when v2 is published', async () => {
      const target = await createOrganization();
      const created = await createDraft();
      const v1 = created.versions[0]!;
      await templates.approve(v1.id);
      await templates.publish(v1.id);
      const adoption = await adoptions.adopt({
        organizationId: target.organizationId,
        templateVersionId: v1.id,
      });
      const before = await persistedAccounts(target.organizationId);

      const v2 = await templates.createVersion({
        templateId: created.template.id,
        maxDepth: 3,
        levels: LEVELS,
        nodes: TREE.map((entry) => ({
          ...entry,
          title: `${entry.title} changed`,
        })),
      });
      await templates.approve(v2.id);
      await templates.publish(v2.id);

      expect(await persistedAccounts(target.organizationId)).toEqual(before);
      expect(
        await adoptionRepository.findById(target.organizationId, adoption.id),
      ).toMatchObject({ templateVersionId: v1.id });
      expect((await templates.getVersion(v1.id)).status).toBe('superseded');
      expect((await templates.getVersion(v2.id)).status).toBe('published');
    }, 60_000);
  },
);

function node(
  nodeKey: string,
  parentNodeKey: string | null,
  code: string,
  isPostable: boolean,
) {
  return {
    nodeKey,
    parentNodeKey,
    code,
    title: `Node ${nodeKey}`,
    accountNature: 'debit' as const,
    isPostable,
    isMandatory: false,
    defaultIsActive: true,
  };
}
