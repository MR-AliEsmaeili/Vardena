import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { PermissionRegistry } from '../src/modules/rbac/application/permission-registry.js';
import { RolesService } from '../src/modules/rbac/application/roles.service.js';
import { UserRolesService } from '../src/modules/rbac/application/user-roles.service.js';
import { UsersService } from '../src/modules/users/application/users.service.js';
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import { OrganizationMembershipsRepository } from '../src/modules/organization/data/organization-memberships.repository.js';
import { AccountingConfigurationsService } from '../src/modules/accounting/application/accounting-configurations.service.js';
import { CodingStructuresService } from '../src/modules/accounting/application/coding-structures.service.js';
import { AccountsService } from '../src/modules/accounting/application/accounts.service.js';
import { createTestApp } from './support/test-app.js';

/**
 * Task 23 API-level E2E journey against real PostgreSQL.
 *
 * The production Nest bootstrap, session authentication, AuthGuard,
 * AuthorizationGuard, organization-membership chokepoint, controllers,
 * services, Prisma repositories, migration-created tables and constraints are
 * all real. No data repository is mocked. CI discovers this `*.e2e-spec.ts`
 * file in its existing E2E step and supplies the migrated database.
 */
const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

const LEVELS = [
  {
    levelIndex: 1,
    title: 'Level 1',
    digitLength: 2,
    defaultIsPostable: false,
    levelKind: 'group',
  },
  {
    levelIndex: 2,
    title: 'Level 2',
    digitLength: 2,
    defaultIsPostable: false,
    levelKind: 'general',
  },
  {
    levelIndex: 3,
    title: 'Level 3',
    digitLength: 2,
    defaultIsPostable: true,
    levelKind: 'detail',
  },
] as const;

const TEMPLATE_LEVELS = LEVELS.map(
  ({ levelIndex, digitLength, defaultIsPostable }) => ({
    levelIndex,
    digitLength,
    defaultIsPostable,
  }),
);

const TEMPLATE_NODES = [
  templateNode('R1', null, '10', false),
  templateNode('R1C1', 'R1', '1010', false),
  templateNode('R1C1L1', 'R1C1', '101001', true),
  templateNode('R1C2', 'R1', '1020', true),
  templateNode('R2', null, '20', false),
  { ...templateNode('R2C1', 'R2', '2010', true), isMandatory: true },
];

type QueryClient = {
  account: {
    findMany: (args: unknown) => Promise<
      Array<{
        id: string;
        code: string;
        parentId: string | null;
        level: number;
        isPostable: boolean;
        title: string;
      }>
    >;
    count: (args: unknown) => Promise<number>;
  };
  baseChartAdoption: {
    count: (args: unknown) => Promise<number>;
  };
};

describe.skipIf(DATABASE_URL === undefined)(
  'Task 23 Base Chart HTTP API (live PostgreSQL E2E)',
  () => {
    const suffix = generateId().slice(-10).toLowerCase();
    const ADMIN = {
      username: `bc_admin_${suffix}`,
      password: 'task-23-admin-password',
    };
    const OUTSIDER = {
      username: `bc_out_${suffix}`,
      password: 'task-23-outsider-password',
    };

    let app: INestApplication | undefined;
    let db: QueryClient;
    let admin: ReturnType<typeof request.agent>;
    let outsider: ReturnType<typeof request.agent>;
    let adminUserId = '';
    let outsiderUserId = '';
    let orgA = '';
    let orgPartial = '';
    let orgNonEmpty = '';
    let orgIncompatible = '';
    let orgOutsider = '';
    let templateId = '';
    let v1Id = '';
    let adoptionAId = '';
    let orgABaseline: Awaited<ReturnType<typeof readAccounts>> = [];
    let sequence = 0;

    beforeAll(async () => {
      const built = await createTestApp({
        override: (builder) =>
          builder
            .overrideProvider(APP_CONFIG)
            .useValue({ ...loadAppConfig(), databaseUrl: DATABASE_URL }),
      });
      app = built.app;
      const prisma = built.module.get(PrismaService);
      db = await prisma.getClient<QueryClient>();

      const users = app.get(UsersService);
      const roles = app.get(RolesService);
      const userRoles = app.get(UserRolesService);
      const allCodes = app
        .get(PermissionRegistry)
        .all()
        .map((definition) => definition.code);
      for (const permission of [
        'Accounting.BaseChart.View',
        'Accounting.BaseChart.Configure',
        'Accounting.BaseChart.Adopt',
      ]) {
        expect(allCodes).toContain(permission);
      }

      const adminUser = await users.createUser(ADMIN);
      adminUserId = adminUser.id;
      const outsiderUser = await users.createUser(OUTSIDER);
      outsiderUserId = outsiderUser.id;
      const role = await roles.createRole({
        name: `Task 23 E2E ${suffix}`,
        description: 'Task 23 live E2E fixture',
        permissionCodes: allCodes,
      });
      await userRoles.assignRoleToUser(role.id, adminUser.id);
      await userRoles.assignRoleToUser(role.id, outsiderUser.id);

      admin = request.agent(app.getHttpServer());
      outsider = request.agent(app.getHttpServer());
      await admin.post('/api/v1/auth/login').send(ADMIN).expect(200);
      await outsider.post('/api/v1/auth/login').send(OUTSIDER).expect(200);

      orgA = await createPinnedOrganization('A', LEVELS, [adminUserId]);
      orgPartial = await createPinnedOrganization('PART', LEVELS, [
        adminUserId,
      ]);
      orgNonEmpty = await createPinnedOrganization('NONEMPTY', LEVELS, [
        adminUserId,
      ]);
      orgIncompatible = await createPinnedOrganization(
        'INCOMPAT',
        LEVELS.slice(0, 2),
        [adminUserId],
      );
      orgOutsider = await createPinnedOrganization('OUT', LEVELS, [
        outsiderUserId,
      ]);

      await app.get(AccountsService).createAccount({
        organizationId: orgNonEmpty,
        code: '99',
        title: 'Pre-existing account',
        accountNature: 'DEBIT',
        isPostable: true,
      });
    }, 60_000);

    afterAll(async () => {
      await app?.close();
    }, 60_000);

    async function createPinnedOrganization(
      label: string,
      levels: ReadonlyArray<(typeof LEVELS)[number]>,
      memberIds: string[],
    ): Promise<string> {
      sequence += 1;
      const organization = await app!
        .get(OrganizationsService)
        .createOrganization({
          code: `BC-${label}-${suffix}-${sequence}`.toUpperCase(),
          name: `Task 23 E2E ${label}`,
        });
      const coding = app!.get(CodingStructuresService);
      const codingDraft = await coding.createVersion({
        organizationId: organization.id,
        code: 'BASE',
        maxDepth: levels.length,
        separator: '',
        levels,
      });
      await coding.publishVersion(organization.id, codingDraft.id);
      const configurations = app!.get(AccountingConfigurationsService);
      const configurationDraft = await configurations.createConfiguration({
        organizationId: organization.id,
        code: 'BASE',
        name: 'Task 23 E2E configuration',
        levels,
      });
      await configurations.publishConfiguration(
        organization.id,
        configurationDraft.id,
      );
      const memberships = app!.get(OrganizationMembershipsRepository);
      for (const userId of memberIds) {
        await memberships.create({
          userId,
          organizationId: organization.id,
          now: new Date(),
          createdBy: null,
        });
      }
      return organization.id;
    }

    async function readAccounts(organizationId: string) {
      return db.account.findMany({
        where: { organizationId },
        orderBy: [{ code: 'asc' }],
      });
    }

    it('E2E-1: Create Template → Draft v1 → Approve → Publish', async () => {
      const created = await admin
        .post('/api/v1/base-chart-templates')
        .send({
          code: `E2E-${suffix}`.toUpperCase(),
          title: 'Task 23 API journey',
          maxDepth: 3,
          levels: TEMPLATE_LEVELS,
          nodes: TEMPLATE_NODES,
        })
        .expect(201);
      templateId = created.body.template.id as string;
      v1Id = created.body.versions[0].id as string;
      expect(created.body.versions[0]).toMatchObject({
        versionNumber: 1,
        status: 'draft',
      });
      await admin
        .post(`/api/v1/base-chart-template-versions/${v1Id}/approve`)
        .send({})
        .expect(200)
        .expect(({ body }) => expect(body.status).toBe('approved'));
      await admin
        .post(`/api/v1/base-chart-template-versions/${v1Id}/publish`)
        .send({})
        .expect(200)
        .expect(({ body }) => expect(body.status).toBe('published'));
    }, 60_000);

    it('E2E-2: Published Version → Preview Adoption → Compatible', async () => {
      const response = await admin
        .post('/api/v1/accounting/adopt-base-chart/preview')
        .send({ organizationId: orgA, templateVersionId: v1Id })
        .expect(201);
      expect(response.body).toMatchObject({
        verdict: 'compatible',
        finalNodeCount: TEMPLATE_NODES.length,
      });
      expect(await readAccounts(orgA)).toEqual([]);
    }, 60_000);

    it('E2E-3: Published Version → Adopt → organization Account rows', async () => {
      const response = await admin
        .post('/api/v1/accounting/adopt-base-chart')
        .send({ organizationId: orgA, templateVersionId: v1Id })
        .expect(201);
      adoptionAId = response.body.id as string;
      expect(response.body.accountCount).toBe(TEMPLATE_NODES.length);
      orgABaseline = await readAccounts(orgA);
      expect(orgABaseline).toHaveLength(TEMPLATE_NODES.length);
      expect(orgABaseline.find((row) => row.code === '101001')).toMatchObject({
        level: 3,
        isPostable: true,
      });
    }, 60_000);

    it('E2E-4: Partial Adoption applies ancestor closure + mandatory inclusion', async () => {
      const preview = await admin
        .post('/api/v1/accounting/adopt-base-chart/preview')
        .send({
          organizationId: orgPartial,
          templateVersionId: v1Id,
          selectedNodeKeys: ['R1C1L1'],
        })
        .expect(201);
      expect(
        preview.body.finalSet.map(
          (entry: { nodeKey: string }) => entry.nodeKey,
        ),
      ).toEqual(['R1', 'R2', 'R1C1', 'R2C1', 'R1C1L1']);
      await admin
        .post('/api/v1/accounting/adopt-base-chart')
        .send({
          organizationId: orgPartial,
          templateVersionId: v1Id,
          selectedNodeKeys: ['R1C1L1'],
        })
        .expect(201);
      expect((await readAccounts(orgPartial)).map((row) => row.code)).toEqual([
        '10',
        '1010',
        '101001',
        '20',
        '2010',
      ]);
    }, 60_000);

    it('E2E-5: duplicate adoption returns 409 and creates no duplicate accounts', async () => {
      const accountCount = await db.account.count({
        where: { organizationId: orgA },
      });
      const adoptionCount = await db.baseChartAdoption.count({
        where: { organizationId: orgA },
      });
      const response = await admin
        .post('/api/v1/accounting/adopt-base-chart')
        .send({ organizationId: orgA, templateVersionId: v1Id })
        .expect(409);
      expect(response.body.code).toBe('Conflict');
      expect(await db.account.count({ where: { organizationId: orgA } })).toBe(
        accountCount,
      );
      expect(
        await db.baseChartAdoption.count({ where: { organizationId: orgA } }),
      ).toBe(adoptionCount);
    }, 60_000);

    it('E2E-6: a non-empty organization gets 409 and no mutation', async () => {
      const before = await readAccounts(orgNonEmpty);
      await admin
        .post('/api/v1/accounting/adopt-base-chart')
        .send({ organizationId: orgNonEmpty, templateVersionId: v1Id })
        .expect(409);
      expect(await readAccounts(orgNonEmpty)).toEqual(before);
      expect(
        await db.baseChartAdoption.count({
          where: { organizationId: orgNonEmpty },
        }),
      ).toBe(0);
    }, 60_000);

    it('E2E-7: an incompatible active configuration refuses adoption', async () => {
      const preview = await admin
        .post('/api/v1/accounting/adopt-base-chart/preview')
        .send({ organizationId: orgIncompatible, templateVersionId: v1Id })
        .expect(201);
      expect(preview.body).toMatchObject({ verdict: 'incompatible' });
      await admin
        .post('/api/v1/accounting/adopt-base-chart')
        .send({ organizationId: orgIncompatible, templateVersionId: v1Id })
        .expect(422);
      expect(await readAccounts(orgIncompatible)).toEqual([]);
    }, 60_000);

    it('E2E-8: a published version refuses attempted content mutation', async () => {
      const response = await admin
        .put(`/api/v1/base-chart-template-versions/${v1Id}/content`)
        .send({ nodes: TEMPLATE_NODES })
        .expect(422);
      expect(response.body.code).toBe('BusinessRuleViolation');
      const current = await admin
        .get(`/api/v1/base-chart-template-versions/${v1Id}`)
        .expect(200);
      expect(current.body.status).toBe('published');
    }, 60_000);

    it('E2E-9: Org B principal cannot access Org A adoption or account scope', async () => {
      await outsider
        .get(`/api/v1/accounting/base-chart-adoptions/${adoptionAId}`)
        .query({ organizationId: orgA })
        .expect(404);
      await outsider
        .get('/api/v1/accounting/base-chart-adoptions')
        .query({ organizationId: orgA, page: 1, pageSize: 20 })
        .expect(404);
      const ownScope = await outsider
        .get('/api/v1/accounting/base-chart-adoptions')
        .query({ organizationId: orgOutsider, page: 1, pageSize: 20 })
        .expect(200);
      expect(ownScope.body.items).toEqual([]);
    }, 60_000);

    it('E2E-10: publishing v2 supersedes v1 without mutating Org A copied chart', async () => {
      const draft = await admin
        .post('/api/v1/base-chart-template-versions')
        .send({
          templateId,
          maxDepth: 3,
          levels: TEMPLATE_LEVELS,
          nodes: TEMPLATE_NODES.map((entry) => ({
            ...entry,
            title: `${entry.title} v2`,
          })),
        })
        .expect(201);
      const v2Id = draft.body.id as string;
      await admin
        .post(`/api/v1/base-chart-template-versions/${v2Id}/approve`)
        .send({})
        .expect(200);
      await admin
        .post(`/api/v1/base-chart-template-versions/${v2Id}/publish`)
        .send({})
        .expect(200);
      expect(await readAccounts(orgA)).toEqual(orgABaseline);
      const adoption = await admin
        .get(`/api/v1/accounting/base-chart-adoptions/${adoptionAId}`)
        .query({ organizationId: orgA })
        .expect(200);
      expect(adoption.body.templateVersionId).toBe(v1Id);
      const oldVersion = await admin
        .get(`/api/v1/base-chart-template-versions/${v1Id}`)
        .expect(200);
      expect(oldVersion.body).toMatchObject({
        status: 'superseded',
        supersededByVersionId: v2Id,
      });
    }, 60_000);
  },
);

function templateNode(
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
    accountNature: 'DEBIT',
    isPostable,
    isMandatory: false,
    defaultIsActive: true,
  };
}
