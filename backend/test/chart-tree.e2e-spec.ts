import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { UsersRepository } from '../src/modules/users/data/users.repository.js';
import { UsersService } from '../src/modules/users/application/users.service.js';
import { SessionsRepository } from '../src/modules/identity/data/sessions.repository.js';
import { PermissionsRepository } from '../src/modules/rbac/data/permissions.repository.js';
import { RolesRepository } from '../src/modules/rbac/data/roles.repository.js';
import { UserRolesRepository } from '../src/modules/rbac/data/user-roles.repository.js';
import { PermissionRegistry } from '../src/modules/rbac/application/permission-registry.js';
import { RolesService } from '../src/modules/rbac/application/roles.service.js';
import { UserRolesService } from '../src/modules/rbac/application/user-roles.service.js';
import { OrganizationsRepository } from '../src/modules/organization/data/organizations.repository.js';
import { OrganizationMembershipsRepository } from '../src/modules/organization/data/organization-memberships.repository.js';
import { CodingStructuresRepository } from '../src/modules/accounting/data/coding-structures.repository.js';
import { AccountingConfigurationsRepository } from '../src/modules/accounting/data/accounting-configurations.repository.js';
import { AccountsRepository } from '../src/modules/accounting/data/accounts.repository.js';
import { AccountingDocumentLinesRepository } from '../src/modules/accounting/data/accounting-document-lines.repository.js';
import {
  createInMemoryStores,
  type InMemoryStores,
} from './support/in-memory-repositories.js';
import {
  createMasterDataStores,
  type MasterDataStores,
} from './support/master-data-repositories.js';
import {
  createStructureStores,
  type StructureStores,
} from './support/accounting-structure-repositories.js';
import { createTestApp } from './support/test-app.js';

/**
 * Task 19 focused e2e (ODR-2 + ODR-1, through HTTP):
 *
 * - the Accounting-owned Chart Tree read surface: one GET lists the whole
 *   chart flat in the FIXED canonical order (code ascending) with the
 *   hierarchy fields, inactive nodes included, no figures; one GET reads a
 *   single node with the 404 isolation posture;
 * - the authorization boundary over HTTP: 401 anonymous, 403 without
 *   `Accounting.Account.View`, 404 for a principal without membership
 *   (permission alone does not cross organizations — ODR-3), 422 for a
 *   disabled organization;
 * - the Explicit Configuration Coherence Rule (ODR-1) through the accounts
 *   API, staged in organization B: a coherent ACTIVE pair still accepts
 *   writes; after the coding structure diverges from the still-ACTIVE
 *   accounting configuration, a new account is refused with 422
 *   `BusinessRuleViolation` naming the coherence rule — and reads stay
 *   untouched.
 *
 * Boots the real application through the production HTTP pipeline; only data
 * access is faked.
 */
describe('Chart Tree read surface and pin coherence (e2e, Task 19)', () => {
  let app: INestApplication;
  let stores: InMemoryStores;
  let master: MasterDataStores;
  let structure: StructureStores;
  let users: UsersService;
  let roles: RolesService;
  let userRoles: UserRolesService;

  const ROOT = { username: 'root', password: 'root-secret' };
  const VIEWER = { username: 'viewer', password: 'viewer-secret' };
  const OUTSIDER = { username: 'outsider', password: 'outsider-secret' };
  const PLAIN = { username: 'plain', password: 'plain-secret' };

  let root: ReturnType<typeof request.agent>;
  let viewer: ReturnType<typeof request.agent>;
  let outsider: ReturnType<typeof request.agent>;
  let plain: ReturnType<typeof request.agent>;

  const state = {
    rootId: '',
    orgA: '',
    orgB: '',
    orgC: '',
    cashId: '',
    bankId: '',
  };

  function buildPrismaStub(): PrismaService {
    const fail = (): never => {
      throw new Error('PrismaService must not be touched in e2e tests.');
    };
    return {
      getClient: fail,
      onModuleInit: async () => {},
      onModuleDestroy: async () => {},
      enableShutdownHooks: () => {},
    } as unknown as PrismaService;
  }

  /** The coherent 2 + 3 layout both roots are published with. */
  const COHERENT_LEVELS = [
    {
      levelIndex: 1,
      title: 'گروه',
      digitLength: 2,
      defaultIsPostable: false,
      levelKind: 'group',
    },
    {
      levelIndex: 2,
      title: 'تفصیلی',
      digitLength: 3,
      defaultIsPostable: true,
      levelKind: 'detail',
    },
  ];

  async function publishCoding(
    organizationId: string,
    levels: typeof COHERENT_LEVELS,
  ): Promise<string> {
    const draft = await root
      .post('/api/v1/coding-structures')
      .send({
        organizationId,
        code: 'DEFAULT',
        maxDepth: levels.length,
        separator: '-',
        levels,
      })
      .expect(201);
    await root
      .post(`/api/v1/coding-structures/${draft.body.id}/publish`)
      .query({ organizationId })
      .expect(200);
    return draft.body.id as string;
  }

  async function publishConfiguration(
    organizationId: string,
    levels: typeof COHERENT_LEVELS,
  ): Promise<string> {
    const draft = await root
      .post('/api/v1/accounting-configurations')
      .send({
        organizationId,
        code: 'DEFAULT',
        name: 'Default Accounting Config',
        levels,
      })
      .expect(201);
    await root
      .post(`/api/v1/accounting-configurations/${draft.body.id}/publish`)
      .query({ organizationId })
      .expect(200);
    return draft.body.id as string;
  }

  beforeAll(async () => {
    stores = createInMemoryStores();
    master = createMasterDataStores();
    structure = createStructureStores();
    const rebuilt = await createTestApp({
      override: (builder) =>
        builder
          .overrideProvider(PrismaService)
          .useValue(buildPrismaStub())
          .overrideProvider(UsersRepository)
          .useValue(stores.users)
          .overrideProvider(SessionsRepository)
          .useValue(stores.sessions)
          .overrideProvider(PermissionsRepository)
          .useValue(stores.permissions)
          .overrideProvider(RolesRepository)
          .useValue(stores.roles)
          .overrideProvider(UserRolesRepository)
          .useValue(stores.userRoles)
          .overrideProvider(OrganizationsRepository)
          .useValue(master.organizations)
          .overrideProvider(OrganizationMembershipsRepository)
          .useValue(master.memberships)
          .overrideProvider(CodingStructuresRepository)
          .useValue(structure.structures)
          .overrideProvider(AccountingConfigurationsRepository)
          .useValue(structure.configurations)
          .overrideProvider(AccountsRepository)
          .useValue(structure.accounts)
          .overrideProvider(AccountingDocumentLinesRepository)
          .useValue({ countForAccount: async () => 0 }),
    });
    app = rebuilt.app;
    users = app.get(UsersService);
    roles = app.get(RolesService);
    userRoles = app.get(UserRolesService);

    const allCodes = app
      .get(PermissionRegistry)
      .all()
      .map((definition) => definition.code);

    const rootUser = await users.createUser({
      username: ROOT.username,
      password: ROOT.password,
    });
    state.rootId = rootUser.id;
    const rootRole = await roles.createRole({
      name: 'Root',
      description: 'All permissions (test fixture)',
      permissionCodes: allCodes,
    });
    await userRoles.assignRoleToUser(rootRole.id, rootUser.id);

    // VIEWER holds every *.View code (including Accounting.Account.View).
    const viewerUser = await users.createUser({
      username: VIEWER.username,
      password: VIEWER.password,
    });
    const viewerRole = await roles.createRole({
      name: 'Viewer',
      description: 'Read-only (test fixture)',
      permissionCodes: allCodes.filter((code) => code.endsWith('.View')),
    });
    await userRoles.assignRoleToUser(viewerRole.id, viewerUser.id);

    // OUTSIDER holds the SAME View codes but is a member of org B only —
    // the ODR-3 probe: permission alone must not reach organization A.
    const outsiderUser = await users.createUser({
      username: OUTSIDER.username,
      password: OUTSIDER.password,
    });
    const outsiderRole = await roles.createRole({
      name: 'Outsider',
      description: 'Read-only of another organization (test fixture)',
      permissionCodes: allCodes.filter((code) => code.endsWith('.View')),
    });
    await userRoles.assignRoleToUser(outsiderRole.id, outsiderUser.id);

    // PLAIN is a member of A but holds NO permission at all (403 posture).
    const plainUser = await users.createUser({
      username: PLAIN.username,
      password: PLAIN.password,
    });

    root = request.agent(app.getHttpServer());
    viewer = request.agent(app.getHttpServer());
    outsider = request.agent(app.getHttpServer());
    plain = request.agent(app.getHttpServer());
    await root.post('/api/v1/auth/login').send(ROOT).expect(200);
    await viewer.post('/api/v1/auth/login').send(VIEWER).expect(200);
    await outsider.post('/api/v1/auth/login').send(OUTSIDER).expect(200);
    await plain.post('/api/v1/auth/login').send(PLAIN).expect(200);

    // Three organizations. A carries the chart under test; B is the
    // outsider's own organization (and the coherence stage later); C exists
    // only to be disabled.
    state.orgA = (
      await root
        .post('/api/v1/organizations')
        .send({ code: 'ACMEA', name: 'Acme A' })
        .expect(201)
    ).body.id as string;
    state.orgB = (
      await root
        .post('/api/v1/organizations')
        .send({ code: 'ACMEB', name: 'Acme B' })
        .expect(201)
    ).body.id as string;
    state.orgC = (
      await root
        .post('/api/v1/organizations')
        .send({ code: 'ACMEC', name: 'Acme C' })
        .expect(201)
    ).body.id as string;

    // ODR-3: root and viewer are legitimate members of A; the outsider is a
    // member of B only.
    master.raw.memberships.seed(state.rootId, state.orgA);
    master.raw.memberships.seed(state.rootId, state.orgB);
    master.raw.memberships.seed(state.rootId, state.orgC);
    master.raw.memberships.seed(viewerUser.id, state.orgA);
    master.raw.memberships.seed(outsiderUser.id, state.orgB);
    master.raw.memberships.seed(plainUser.id, state.orgA);

    // Organization A: coherent published pair + a small chart, created out
    // of code order on purpose.
    await publishCoding(state.orgA, COHERENT_LEVELS);
    await publishConfiguration(state.orgA, COHERENT_LEVELS);
    await root
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgA,
        code: '20',
        title: 'Receivables',
        accountNature: 'debit',
      })
      .expect(201);
    const cash = await root
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgA,
        code: '10',
        title: 'Cash',
        accountNature: 'debit',
      })
      .expect(201);
    state.cashId = cash.body.id as string;
    const bank = await root
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgA,
        code: '10101',
        title: 'Cash — bank',
        accountNature: 'debit',
        parentId: state.cashId,
      })
      .expect(201);
    state.bankId = bank.body.id as string;

    // A foreign account row of organization C — seeded directly (C has no
    // published pair), so the by-id isolation probe uses a REAL foreign id
    // exactly like the administration suite does. It lives in C, not B,
    // because B is the coherence stage's organization below.
    structure.raw.state.accounts.insert({
      id: '01FOREIGN0000000000000000X',
      organizationId: state.orgC,
      code: '10',
      title: 'Foreign chart',
      parentId: null,
      level: 1,
      codingStructureVersionId: null,
      accountingConfigurationId: null,
      accountNature: 'debit',
      isPostable: false,
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      createdBy: null,
      updatedBy: null,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ---- read surface (ODR-2) ------------------------------------------------

  it('rejects anonymous chart-tree calls with 401 (not 403)', async () => {
    const anonymous = request(app.getHttpServer());
    const res = await anonymous
      .get('/api/v1/accounting/chart-tree')
      .query({ organizationId: state.orgA })
      .expect(401);
    expect(res.body.code).toBe('Unauthorized');
  });

  it('lists the whole chart flat, in the FIXED code-ascending order', async () => {
    const res = await root
      .get('/api/v1/accounting/chart-tree')
      .query({ organizationId: state.orgA })
      .expect(200);
    expect(res.body.total).toBe(3);
    expect(res.body.items.map((item: { code: string }) => item.code)).toEqual([
      '10',
      '10101',
      '20',
    ]);

    const bank = res.body.items.find(
      (item: { code: string }) => item.code === '10101',
    );
    expect(bank).toMatchObject({
      id: state.bankId,
      organizationId: state.orgA,
      title: 'Cash — bank',
      parentId: state.cashId,
      level: 2,
      isPostable: true,
      isActive: true,
      accountNature: 'debit',
    });
    // The two configuration pins are part of the node (ODR-1 surface).
    expect(bank.codingStructureVersionId).toBeTruthy();
    expect(bank.accountingConfigurationId).toBeTruthy();
    // No financial figures, no invented classification (ODR-2).
    expect(bank).not.toHaveProperty('balance');
    expect(bank).not.toHaveProperty('accountType');

    const cashRoot = res.body.items.find(
      (item: { code: string }) => item.code === '10',
    );
    expect(cashRoot).toMatchObject({ parentId: null, level: 1 });
  });

  it('reads one node; foreign and unknown ids answer 404', async () => {
    const one = await root
      .get(`/api/v1/accounting/chart-tree/${state.bankId}`)
      .query({ organizationId: state.orgA })
      .expect(200);
    expect(one.body).toMatchObject({ code: '10101', level: 2 });

    const foreign = await root
      .get('/api/v1/accounting/chart-tree/01FOREIGN0000000000000000X')
      .query({ organizationId: state.orgA })
      .expect(404);
    expect(foreign.body.code).toBe('EntityNotFound');

    const unknown = await root
      .get('/api/v1/accounting/chart-tree/01UNKNOWN0000000000000000X')
      .query({ organizationId: state.orgA })
      .expect(404);
    expect(unknown.body.code).toBe('EntityNotFound');
  });

  it('keeps disabled (inactive) nodes in the tree — accounts are never deleted', async () => {
    await root
      .post(`/api/v1/accounts/${state.bankId}/disable`)
      .query({ organizationId: state.orgA })
      .expect(200);

    const res = await root
      .get('/api/v1/accounting/chart-tree')
      .query({ organizationId: state.orgA })
      .expect(200);
    expect(res.body.total).toBe(3);
    const bank = res.body.items.find(
      (item: { code: string }) => item.code === '10101',
    );
    expect(bank).toMatchObject({ isActive: false });
  });

  it('rejects an explicit sort — the order is part of the contract', async () => {
    const res = await root
      .get('/api/v1/accounting/chart-tree')
      .query({ organizationId: state.orgA, sort: 'code:desc' })
      .expect(400);
    expect(res.body.code).toBe('BadRequest');
  });

  it('bounds pagination and reports the full total', async () => {
    const res = await root
      .get('/api/v1/accounting/chart-tree')
      .query({ organizationId: state.orgA, page: 2, pageSize: 2 })
      .expect(200);
    expect(res.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(res.body.items.map((item: { code: string }) => item.code)).toEqual([
      '20',
    ]);
  });

  it('enforces the permission (403) and the membership boundary (404) separately', async () => {
    // PLAIN: a member of A, but NO permission → 403 (authenticated,
    // unauthorized), never a 404 that would hide the permission rule.
    const noPermission = await plain
      .get('/api/v1/accounting/chart-tree')
      .query({ organizationId: state.orgA })
      .expect(403);
    expect(noPermission.body.code).toBe('PermissionDenied');

    // VIEWER: permission + membership → readable.
    await viewer
      .get('/api/v1/accounting/chart-tree')
      .query({ organizationId: state.orgA })
      .expect(200);

    // OUTSIDER: the SAME permission, but a member of B only → organization A
    // answers 404, indistinguishable from an unknown id.
    const denied = await outsider
      .get('/api/v1/accounting/chart-tree')
      .query({ organizationId: state.orgA })
      .expect(404);
    expect(denied.body.code).toBe('EntityNotFound');

    // The outsider's OWN organization is readable (empty, but 200 — never a
    // silent cross-org leak).
    const own = await outsider
      .get('/api/v1/accounting/chart-tree')
      .query({ organizationId: state.orgB })
      .expect(200);
    expect(own.body.total).toBe(0);
  });

  it('a disabled organization answers 422 (usability, not existence)', async () => {
    await root.post(`/api/v1/organizations/${state.orgC}/disable`).expect(200);
    const res = await root
      .get('/api/v1/accounting/chart-tree')
      .query({ organizationId: state.orgC })
      .expect(422);
    expect(res.body.code).toBe('BusinessRuleViolation');
  });

  // ---- pin coherence through HTTP (ODR-1), staged in organization B -------

  it('a coherent ACTIVE pair still accepts account writes', async () => {
    await publishCoding(state.orgB, COHERENT_LEVELS);
    await publishConfiguration(state.orgB, COHERENT_LEVELS);

    const created = await root
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgB,
        code: '30',
        title: 'Equity',
        accountNature: 'credit',
      })
      .expect(201);
    expect(created.body).toMatchObject({ code: '30', level: 1 });
    expect(created.body.codingStructureVersionId).toBeTruthy();
    expect(created.body.accountingConfigurationId).toBeTruthy();
  });

  it('a divergent ACTIVE pair is refused with 422 naming the coherence rule — and reads stay untouched', async () => {
    // Supersede organization B's coding structure with a narrower level 2;
    // the accounting configuration (still 2 + 3) stays ACTIVE. The ACTIVE
    // pair now disagrees on the defined shape.
    await publishCoding(state.orgB, [
      {
        levelIndex: 1,
        title: 'گروه',
        digitLength: 2,
        defaultIsPostable: false,
        levelKind: 'group',
      },
      {
        levelIndex: 2,
        title: 'تفصیلی',
        digitLength: 2,
        defaultIsPostable: true,
        levelKind: 'detail',
      },
    ]);

    // A new root under the divergent pair: refused — never a silent pin
    // choice.
    const refused = await root
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgB,
        code: '31',
        title: 'Equity — retained',
        accountNature: 'credit',
      })
      .expect(422);
    expect(refused.body.code).toBe('BusinessRuleViolation');
    expect(refused.body.details).toMatchObject({
      rule: 'coding_digit_length_mismatch',
    });

    // Nothing was written: the chart still holds exactly the coherent-era
    // account, and reads are never blocked by the divergence.
    const tree = await root
      .get('/api/v1/accounting/chart-tree')
      .query({ organizationId: state.orgB })
      .expect(200);
    expect(tree.body.total).toBe(1);
    expect(tree.body.items.map((item: { code: string }) => item.code)).toEqual([
      '30',
    ]);
  });
});
