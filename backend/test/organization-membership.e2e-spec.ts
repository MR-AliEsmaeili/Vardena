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
import {
  createInMemoryStores,
  foreignKeyViolation,
  type InMemoryStores,
} from './support/in-memory-repositories.js';
import {
  createMasterDataStores,
  type MasterDataStores,
} from './support/master-data-repositories.js';
import { createTestApp } from './support/test-app.js';

/**
 * Organization membership administration (e2e, Task 19 ODR-3).
 *
 * Boots the real application through the production HTTP pipeline. Only data
 * access is faked — and one fidelity seam is added on purpose: the real
 * `organization_memberships` table carries a user FK (P2003 → 404 "user does
 * not exist"), which the in-memory fake cannot know. The wrapper below adds
 * exactly that check against the in-memory users store, so the HTTP contract
 * under test is the real one.
 *
 * What this proves over the unit specs: the bootstrap rule (the FIRST grant
 * needs no grantor membership — the permission is the authority, otherwise a
 * fresh deployment could never authorize anyone), the grant/revoke lifecycle
 * over HTTP (204 / 409 duplicate / 404 unknown user or org / 404 revoking a
 * non-member), permission enforcement per operation (403), and the ODR-3
 * boundary itself: a principal reads an organization ONLY while a membership
 * row exists — permission alone never crosses organizations.
 */
describe('Organization membership administration (e2e)', () => {
  let app: INestApplication;
  let stores: InMemoryStores;
  let master: MasterDataStores;
  let users: UsersService;
  let roles: RolesService;
  let userRoles: UserRolesService;

  const ADMIN = { username: 'admin', password: 'admin-secret' };
  const MEMBER = { username: 'member', password: 'member-secret' };
  const PLAIN = { username: 'plain', password: 'plain-secret' };

  let admin: ReturnType<typeof request.agent>;
  let member: ReturnType<typeof request.agent>;
  let plain: ReturnType<typeof request.agent>;

  const state = {
    adminId: '',
    memberId: '',
    plainId: '',
    orgId: '',
    otherOrgId: '',
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

  beforeAll(async () => {
    stores = createInMemoryStores();
    master = createMasterDataStores();

    // The user-FK fidelity seam (see the suite header): the fake answers
    // P2003 exactly like PostgreSQL would for an unknown user_id.
    const raw = master.raw.memberships;
    const membershipsWithUserFk = {
      findMembership: (userId: string, organizationId: string) =>
        raw.findMembership(userId, organizationId),
      listForOrganization: (params: {
        organizationId: string;
        skip: number;
        take: number;
      }) => raw.listForOrganization(params),
      create: async (input: {
        userId: string;
        organizationId: string;
        now: Date;
        createdBy: string | null;
      }) => {
        const user = await stores.users.findById(input.userId);
        if (user === null) {
          throw foreignKeyViolation();
        }
        return raw.create(input);
      },
      remove: (userId: string, organizationId: string) =>
        raw.remove(userId, organizationId),
    };

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
          .useValue(membershipsWithUserFk),
    });
    app = rebuilt.app;
    users = app.get(UsersService);
    roles = app.get(RolesService);
    userRoles = app.get(UserRolesService);

    const allCodes = app
      .get(PermissionRegistry)
      .all()
      .map((definition) => definition.code);

    // The Task 19 vocabulary must be registered at startup (AR-22).
    for (const code of [
      'Organization.Membership.View',
      'Organization.Membership.Grant',
      'Organization.Membership.Revoke',
    ]) {
      if (!allCodes.includes(code)) {
        throw new Error(`Membership permission not registered: ${code}`);
      }
    }

    // ADMIN holds everything — and is deliberately a member of NOTHING: the
    // first grant must not require a grantor membership (bootstrap rule).
    const adminUser = await users.createUser({
      username: ADMIN.username,
      password: ADMIN.password,
    });
    state.adminId = adminUser.id;
    const adminRole = await roles.createRole({
      name: 'Admin',
      description: 'All permissions (test fixture)',
      permissionCodes: allCodes,
    });
    await userRoles.assignRoleToUser(adminRole.id, adminUser.id);

    // MEMBER will be granted and revoked: it may READ organizations (so the
    // membership's effect is observable) but holds no membership admin verb.
    const memberUser = await users.createUser({
      username: MEMBER.username,
      password: MEMBER.password,
    });
    state.memberId = memberUser.id;
    const memberRole = await roles.createRole({
      name: 'OrgReader',
      description: 'Organization reads only (test fixture)',
      permissionCodes: ['Organization.View'],
    });
    await userRoles.assignRoleToUser(memberRole.id, memberUser.id);

    // PLAIN is authenticated but holds nothing at all (403 posture).
    const plainUser = await users.createUser({
      username: PLAIN.username,
      password: PLAIN.password,
    });
    state.plainId = plainUser.id;

    admin = request.agent(app.getHttpServer());
    member = request.agent(app.getHttpServer());
    plain = request.agent(app.getHttpServer());
    await admin.post('/api/v1/auth/login').send(ADMIN).expect(200);
    await member.post('/api/v1/auth/login').send(MEMBER).expect(200);
    await plain.post('/api/v1/auth/login').send(PLAIN).expect(200);

    // Two organizations exist; nobody is a member of either yet.
    const org = await admin
      .post('/api/v1/organizations')
      .send({ code: 'ACME', name: 'Acme Industries' })
      .expect(201);
    state.orgId = org.body.id as string;
    const other = await admin
      .post('/api/v1/organizations')
      .send({ code: 'OTHER', name: 'Other Co' })
      .expect(201);
    state.otherOrgId = other.body.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects anonymous membership calls with 401 (not 403)', async () => {
    const anonymous = request(app.getHttpServer());
    for (const path of [`/api/v1/organizations/${state.orgId}/members`]) {
      const res = await anonymous.get(path).expect(401);
      expect(res.body.code).toBe('Unauthorized');
    }
  });

  it('requires the membership permissions per operation (403, not 401)', async () => {
    // PLAIN is authenticated but holds nothing.
    const list = await plain
      .get(`/api/v1/organizations/${state.orgId}/members`)
      .expect(403);
    expect(list.body.code).toBe('PermissionDenied');

    const grant = await plain
      .post(`/api/v1/organizations/${state.orgId}/members`)
      .send({ userId: state.memberId })
      .expect(403);
    expect(grant.body.code).toBe('PermissionDenied');

    const revoke = await plain
      .delete(`/api/v1/organizations/${state.orgId}/members/${state.memberId}`)
      .expect(403);
    expect(revoke.body.code).toBe('PermissionDenied');
  });

  it('bootstrap: the FIRST grant needs no grantor membership — the permission is the authority', async () => {
    // ADMIN is a member of NOTHING. The very first membership of the very
    // first organization must still be grantable, or a fresh deployment
    // could never authorize anyone (the deadlock ODR-3 explicitly avoids).
    await admin
      .post(`/api/v1/organizations/${state.orgId}/members`)
      .send({ userId: state.memberId })
      .expect(204);
  });

  it('lists the granted member (paged, membership-administration view)', async () => {
    const res = await admin
      .get(`/api/v1/organizations/${state.orgId}/members`)
      .expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      userId: state.memberId,
      organizationId: state.orgId,
    });
    // The API never exposes audit actor ids (AR-24).
    expect(res.body.items[0]).not.toHaveProperty('createdBy');
  });

  it('refuses a duplicate grant with 409', async () => {
    const res = await admin
      .post(`/api/v1/organizations/${state.orgId}/members`)
      .send({ userId: state.memberId })
      .expect(409);
    expect(res.body.code).toBe('Conflict');
  });

  it('refuses a grant for an unknown user with 404 (user FK)', async () => {
    const res = await admin
      .post(`/api/v1/organizations/${state.orgId}/members`)
      .send({ userId: '01UNKNOWN0000000000000000X' })
      .expect(404);
    expect(res.body.code).toBe('EntityNotFound');
  });

  it('refuses a grant for an unknown organization with 404', async () => {
    const res = await admin
      .post('/api/v1/organizations/01UNKNOWN0000000000000000X/members')
      .send({ userId: state.memberId })
      .expect(404);
    expect(res.body.code).toBe('EntityNotFound');
  });

  it('the granted member can read the organization — and ONLY that one', async () => {
    // Membership + permission → the organization is readable.
    await member.get(`/api/v1/organizations/${state.orgId}`).expect(200);

    // The SAME permission on ANOTHER organization → 404, indistinguishable
    // from an unknown id: permission alone does not cross organizations.
    const foreign = await member
      .get(`/api/v1/organizations/${state.otherOrgId}`)
      .expect(404);
    expect(foreign.body.code).toBe('EntityNotFound');

    const unknown = await member
      .get('/api/v1/organizations/01UNKNOWN0000000000000000X')
      .expect(404);
    expect(unknown.body.code).toBe('EntityNotFound');
  });

  it('revokes the membership (204); the member loses access immediately', async () => {
    await admin
      .delete(`/api/v1/organizations/${state.orgId}/members/${state.memberId}`)
      .expect(204);

    // The permission is unchanged — the membership was the authorization.
    const denied = await member
      .get(`/api/v1/organizations/${state.orgId}`)
      .expect(404);
    expect(denied.body.code).toBe('EntityNotFound');

    // The list is empty again.
    const list = await admin
      .get(`/api/v1/organizations/${state.orgId}/members`)
      .expect(200);
    expect(list.body.total).toBe(0);
  });

  it('refuses to revoke a membership that does not exist (404)', async () => {
    const res = await admin
      .delete(`/api/v1/organizations/${state.orgId}/members/${state.memberId}`)
      .expect(404);
    expect(res.body.code).toBe('EntityNotFound');
  });

  it('a second organization stays isolated throughout (no wildcard access)', async () => {
    // ADMIN grants MEMBER into orgId only; otherOrgId must stay untouched.
    await admin
      .post(`/api/v1/organizations/${state.orgId}/members`)
      .send({ userId: state.memberId })
      .expect(204);
    const otherList = await admin
      .get(`/api/v1/organizations/${state.otherOrgId}/members`)
      .expect(200);
    expect(otherList.body.total).toBe(0);
    await member.get(`/api/v1/organizations/${state.otherOrgId}`).expect(404);
  });
});
