import type { INestApplication } from '@nestjs/common';
import type { TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
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
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import {
  createInMemoryStores,
  type InMemoryStores,
} from './support/in-memory-repositories.js';
import {
  createMasterDataStores,
  type MasterDataStores,
} from './support/master-data-repositories.js';
import { createTestApp } from './support/test-app.js';

/**
 * Organization BOOTSTRAP discovery (e2e) — `GET /api/v1/organizations/mine`.
 *
 * What this proves over the unit specs
 * (`organizations-bootstrap.service.spec.ts`): the HTTP contract itself —
 * authentication (401), that NO `Organization.Organization.*` permission is
 * required (membership alone is the authorization, unlike
 * `GET /organizations`), tenant isolation between two independent users, and
 * that a disabled organization drops out of the bootstrap list even while a
 * membership row still exists for it.
 */
function prismaStub(): PrismaService {
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

describe('Organization bootstrap discovery (e2e)', () => {
  let app: INestApplication;
  let stores: InMemoryStores;
  let master: MasterDataStores;
  let users: UsersService;
  let roles: RolesService;
  let userRoles: UserRolesService;

  const USER_A = { username: 'bootstrap-user-a', password: 'user-a-secret' };
  const USER_B = { username: 'bootstrap-user-b', password: 'user-b-secret' };
  const ADMIN_VIEW_ONLY = {
    username: 'bootstrap-admin-view',
    password: 'admin-view-secret',
  };

  let userAAgent: ReturnType<typeof request.agent>;
  let userBAgent: ReturnType<typeof request.agent>;
  let adminViewOnlyAgent: ReturnType<typeof request.agent>;

  const state = {
    orgAId: '',
    orgBId: '',
    disabledOrgId: '',
  };

  beforeAll(async () => {
    stores = createInMemoryStores();
    master = createMasterDataStores();

    const rebuilt = await createTestApp({
      override: (builder) =>
        builder
          .overrideProvider(PrismaService)
          .useValue(prismaStub())
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
          .useValue(master.memberships),
    });
    app = rebuilt.app;
    users = app.get(UsersService);
    roles = app.get(RolesService);
    userRoles = app.get(UserRolesService);

    const allCodes = app
      .get(PermissionRegistry)
      .all()
      .map((definition) => definition.code);

    const organizations = app.get(OrganizationsService);
    state.orgAId = (
      await organizations.createOrganization({ code: 'BOOT-A', name: 'Org A' })
    ).id;
    state.orgBId = (
      await organizations.createOrganization({ code: 'BOOT-B', name: 'Org B' })
    ).id;
    state.disabledOrgId = (
      await organizations.createOrganization({
        code: 'BOOT-X',
        name: 'Org X (will be disabled)',
      })
    ).id;
    await organizations.disableOrganization(state.disabledOrgId);

    // USER_A: a plain member of org A and the disabled org, with NO RBAC
    // permissions at all — proves the bootstrap read needs none.
    const userA = await users.createUser({
      username: USER_A.username,
      password: USER_A.password,
    });
    master.raw.memberships.seed(userA.id, state.orgAId);
    master.raw.memberships.seed(userA.id, state.disabledOrgId);

    // USER_B: a plain member of org B only — the isolation counterpart.
    const userB = await users.createUser({
      username: USER_B.username,
      password: USER_B.password,
    });
    master.raw.memberships.seed(userB.id, state.orgBId);

    // ADMIN_VIEW_ONLY: holds the FULL `Organization.Organization.View`
    // administration permission (and could therefore list every organization
    // through `GET /organizations`) but is a member of NOTHING. The
    // bootstrap read must still answer `[]` for it: permission is not
    // membership.
    const adminViewOnly = await users.createUser({
      username: ADMIN_VIEW_ONLY.username,
      password: ADMIN_VIEW_ONLY.password,
    });
    const adminRole = await roles.createRole({
      name: 'Bootstrap view-only admin',
      description: 'Holds every permission, member of nothing (test fixture)',
      permissionCodes: allCodes,
    });
    await userRoles.assignRoleToUser(adminRole.id, adminViewOnly.id);

    userAAgent = request.agent(app.getHttpServer());
    userBAgent = request.agent(app.getHttpServer());
    adminViewOnlyAgent = request.agent(app.getHttpServer());
    await userAAgent.post('/api/v1/auth/login').send(USER_A).expect(200);
    await userBAgent.post('/api/v1/auth/login').send(USER_B).expect(200);
    await adminViewOnlyAgent
      .post('/api/v1/auth/login')
      .send(ADMIN_VIEW_ONLY)
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an anonymous request with 401 (not 403, not an empty list)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/organizations/mine')
      .expect(401);
    expect(res.body.code).toBe('Unauthorized');
  });

  it('requires NO Organization.Organization.View permission — a plain member with zero permissions succeeds', async () => {
    const res = await userAAgent.get('/api/v1/organizations/mine').expect(200);
    const ids = (res.body as Array<{ id: string }>).map((item) => item.id);
    expect(ids).toEqual([state.orgAId]);
  });

  it('isolation: a member of A never receives B, and vice versa', async () => {
    const aView = await userAAgent
      .get('/api/v1/organizations/mine')
      .expect(200);
    expect(
      (aView.body as Array<{ id: string }>).map((item) => item.id),
    ).not.toContain(state.orgBId);

    const bView = await userBAgent
      .get('/api/v1/organizations/mine')
      .expect(200);
    const bIds = (bView.body as Array<{ id: string }>).map((item) => item.id);
    expect(bIds).toEqual([state.orgBId]);
    expect(bIds).not.toContain(state.orgAId);
  });

  it('answers [] for a principal holding full administration permission but no membership', async () => {
    const res = await adminViewOnlyAgent
      .get('/api/v1/organizations/mine')
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('excludes a disabled organization even while the membership row still exists', async () => {
    const res = await userAAgent.get('/api/v1/organizations/mine').expect(200);
    const ids = (res.body as Array<{ id: string }>).map((item) => item.id);
    expect(ids).not.toContain(state.disabledOrgId);
    // The still-active membership of the active org A is unaffected.
    expect(ids).toEqual([state.orgAId]);
  });

  it('never exposes the administration-only fields (no createdBy/updatedBy leak)', async () => {
    const res = await userAAgent.get('/api/v1/organizations/mine').expect(200);
    const [organization] = res.body as Array<Record<string, unknown>>;
    expect(organization).toMatchObject({
      id: state.orgAId,
      code: 'BOOT-A',
      name: 'Org A',
      isActive: true,
    });
    expect(organization).not.toHaveProperty('createdBy');
    expect(organization).not.toHaveProperty('updatedBy');
  });
});

/**
 * Deployment-pinned mode (ADR-0025): a second, independent boot so the pin's
 * effect on `GET /organizations/mine` is proven without disturbing the
 * unpinned suite above (same two-phase-boot technique as
 * `deployment-scope.e2e-spec.ts`).
 */
describe('Organization bootstrap discovery under a deployment pin (e2e)', () => {
  let app: INestApplication;
  let pinnedOrgId = '';
  let foreignOrgId = '';

  const MEMBER = { username: 'pin-boot-member', password: 'pin-boot-secret' };
  const OUTSIDER = {
    username: 'pin-boot-outsider',
    password: 'pin-boot-outsider-secret',
  };
  let memberAgent: ReturnType<typeof request.agent>;
  let outsiderAgent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    const stores = createInMemoryStores();
    const master = createMasterDataStores();

    const withRepositories = (
      builder: TestingModuleBuilder,
    ): TestingModuleBuilder =>
      builder
        .overrideProvider(PrismaService)
        .useValue(prismaStub())
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
        .useValue(master.memberships);

    // ---- Phase 1: un-pinned seed app ---------------------------------
    const seeded = await createTestApp({ override: withRepositories });
    const seedApp = seeded.app;
    try {
      const seedUsers = seedApp.get(UsersService);
      const memberUser = await seedUsers.createUser({
        username: MEMBER.username,
        password: MEMBER.password,
      });
      const outsiderUser = await seedUsers.createUser({
        username: OUTSIDER.username,
        password: OUTSIDER.password,
      });

      const organizations = seedApp.get(OrganizationsService);
      pinnedOrgId = (
        await organizations.createOrganization({
          code: 'PINBOOT',
          name: 'Pinned Co',
        })
      ).id;
      foreignOrgId = (
        await organizations.createOrganization({
          code: 'FOREIGN',
          name: 'Foreign Co',
        })
      ).id;

      // MEMBER belongs to the (future) pinned organization only.
      master.raw.memberships.seed(memberUser.id, pinnedOrgId);
      // OUTSIDER belongs to the FOREIGN organization only — the pin must
      // never let this membership surface it on `/organizations/mine`.
      master.raw.memberships.seed(outsiderUser.id, foreignOrgId);
    } finally {
      await seedApp.close();
    }

    // ---- Phase 2: pinned app over the same in-memory tables -----------
    const pinnedApp = await createTestApp({
      override: (builder) =>
        withRepositories(builder)
          .overrideProvider(APP_CONFIG)
          .useValue({
            ...loadAppConfig(),
            deploymentOrganizationId: pinnedOrgId,
          }),
    });
    app = pinnedApp.app;

    memberAgent = request.agent(app.getHttpServer());
    outsiderAgent = request.agent(app.getHttpServer());
    await memberAgent.post('/api/v1/auth/login').send(MEMBER).expect(200);
    await outsiderAgent.post('/api/v1/auth/login').send(OUTSIDER).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns exactly the pinned organization for a member of it', async () => {
    const res = await memberAgent.get('/api/v1/organizations/mine').expect(200);
    const ids = (res.body as Array<{ id: string }>).map((item) => item.id);
    expect(ids).toEqual([pinnedOrgId]);
  });

  it('never leaks a foreign organization even though a real membership of it exists', async () => {
    const res = await outsiderAgent
      .get('/api/v1/organizations/mine')
      .expect(200);
    expect(res.body).toEqual([]);
  });
});
