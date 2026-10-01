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
 * What this proves over the unit specs (ODR-3, post-merge correction):
 * membership administration is ORGANIZATION-BOUND over real HTTP — a
 * principal holding `Organization.Membership.{View,Grant,Revoke}` may
 * administer only an organization it is itself a member of, and a non-member
 * gets 404 (never 403, never 200: no existence leak). The single exception is
 * the BOOTSTRAP grant: the first member of an organization whose membership
 * set is empty may be granted by a non-member holding
 * `Organization.Membership.Grant`; the exception closes as soon as one member
 * exists and re-opens only if the set becomes empty again. Also covered: the
 * grant/revoke lifecycle (204 / 409 duplicate / 404 unknown user or org / 404
 * revoking a non-member), per-operation permission enforcement (403), and the
 * data-path boundary itself (a principal reads an organization ONLY while a
 * membership row exists).
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
  const OUTSIDER = { username: 'outsider', password: 'outsider-secret' };

  let admin: ReturnType<typeof request.agent>;
  let member: ReturnType<typeof request.agent>;
  let plain: ReturnType<typeof request.agent>;
  let outsider: ReturnType<typeof request.agent>;

  const state = {
    adminId: '',
    memberId: '',
    plainId: '',
    outsiderId: '',
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
      hasAnyMember: (organizationId: string) =>
        raw.hasAnyMember(organizationId),
      listOrganizationIdsForUser: (userId: string) =>
        raw.listOrganizationIdsForUser(userId),
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

    // ADMIN holds everything — and starts a member of NOTHING, so the
    // bootstrap grant of the first member is exercised for real.
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
      permissionCodes: ['Organization.Organization.View'],
    });
    await userRoles.assignRoleToUser(memberRole.id, memberUser.id);

    // PLAIN is authenticated but holds nothing at all (403 posture).
    const plainUser = await users.createUser({
      username: PLAIN.username,
      password: PLAIN.password,
    });
    state.plainId = plainUser.id;

    // OUTSIDER holds every membership-administration permission and is
    // deliberately never made a member of anything: it is the standing proof
    // that permission alone is not authority over an organization.
    const outsiderUser = await users.createUser({
      username: OUTSIDER.username,
      password: OUTSIDER.password,
    });
    state.outsiderId = outsiderUser.id;
    const outsiderRole = await roles.createRole({
      name: 'MembershipAdminNoMembership',
      description: 'Membership verbs without any membership (test fixture)',
      permissionCodes: [
        'Organization.Membership.View',
        'Organization.Membership.Grant',
        'Organization.Membership.Revoke',
      ],
    });
    await userRoles.assignRoleToUser(outsiderRole.id, outsiderUser.id);

    admin = request.agent(app.getHttpServer());
    member = request.agent(app.getHttpServer());
    plain = request.agent(app.getHttpServer());
    outsider = request.agent(app.getHttpServer());
    await admin.post('/api/v1/auth/login').send(ADMIN).expect(200);
    await member.post('/api/v1/auth/login').send(MEMBER).expect(200);
    await plain.post('/api/v1/auth/login').send(PLAIN).expect(200);
    await outsider.post('/api/v1/auth/login').send(OUTSIDER).expect(200);

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

  it('bootstrap: the first grant is allowed ONLY because the target organization has zero members', async () => {
    // ADMIN is a member of NOTHING, and the organization has no member at
    // all — the one case in which `Organization.Membership.Grant` alone is
    // authority (otherwise a fresh organization could never be populated).
    // ADMIN bootstraps ITSELF as the first member.
    await admin
      .post(`/api/v1/organizations/${state.orgId}/members`)
      .send({ userId: state.adminId })
      .expect(204);
  });

  it('a NON-MEMBER with Organization.Membership.Grant cannot grant once the organization already has a member (404)', async () => {
    // The bootstrap exception closed the moment the first member existed;
    // it is not a standing bypass. OUTSIDER holds every membership verb and
    // is a member of nothing.
    const res = await outsider
      .post(`/api/v1/organizations/${state.orgId}/members`)
      .send({ userId: state.memberId })
      .expect(404);
    expect(res.body.code).toBe('EntityNotFound');
    // Indistinguishable from an unknown organization: no existence leak.
    const unknown = await outsider
      .post('/api/v1/organizations/01AAAAAAAAAAAAAAAAAAAAAAAA/members')
      .send({ userId: state.memberId })
      .expect(404);
    expect(unknown.body.code).toBe(res.body.code);
  });

  it('a NON-MEMBER cannot list the members of an organization (404 isolation)', async () => {
    const res = await outsider
      .get(`/api/v1/organizations/${state.orgId}/members`)
      .expect(404);
    expect(res.body.code).toBe('EntityNotFound');
    const unknown = await outsider
      .get('/api/v1/organizations/01AAAAAAAAAAAAAAAAAAAAAAAA/members')
      .expect(404);
    expect(unknown.body.code).toBe(res.body.code);
  });

  it('a NON-MEMBER cannot revoke a membership (404 isolation)', async () => {
    const res = await outsider
      .delete(`/api/v1/organizations/${state.orgId}/members/${state.adminId}`)
      .expect(404);
    expect(res.body.code).toBe('EntityNotFound');
  });

  it('a MEMBER holding Grant may grant another user (the normal path)', async () => {
    await admin
      .post(`/api/v1/organizations/${state.orgId}/members`)
      .send({ userId: state.memberId })
      .expect(204);
  });

  it('lists the members for a MEMBER holding View (paged, grant order)', async () => {
    const res = await admin
      .get(`/api/v1/organizations/${state.orgId}/members`)
      .expect(200);
    expect(res.body.total).toBe(2);
    expect(
      (res.body.items as Array<{ userId: string }>).map((row) => row.userId),
    ).toEqual([state.adminId, state.memberId]);
    expect(res.body.items[1]).toMatchObject({
      userId: state.memberId,
      organizationId: state.orgId,
    });
    // The API never exposes audit actor ids (AR-24).
    expect(res.body.items[1]).not.toHaveProperty('createdBy');
    // The refused non-member calls above changed nothing.
    expect(
      (res.body.items as Array<{ userId: string }>).map((row) => row.userId),
    ).not.toContain(state.outsiderId);
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
      .send({ userId: '01AAAAAAAAAAAAAAAAAAAAAAAA' })
      .expect(404);
    expect(res.body.code).toBe('EntityNotFound');
  });

  it('refuses a grant for an unknown organization with 404', async () => {
    const res = await admin
      .post('/api/v1/organizations/01AAAAAAAAAAAAAAAAAAAAAAAA/members')
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
      .get('/api/v1/organizations/01AAAAAAAAAAAAAAAAAAAAAAAA')
      .expect(404);
    expect(unknown.body.code).toBe('EntityNotFound');
  });

  it('a MEMBER holding Revoke revokes another member (204); access is lost immediately', async () => {
    await admin
      .delete(`/api/v1/organizations/${state.orgId}/members/${state.memberId}`)
      .expect(204);

    // The permission is unchanged — the membership was the authorization.
    const denied = await member
      .get(`/api/v1/organizations/${state.orgId}`)
      .expect(404);
    expect(denied.body.code).toBe('EntityNotFound');

    // Only the grantor's own bootstrap membership is left.
    const list = await admin
      .get(`/api/v1/organizations/${state.orgId}/members`)
      .expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({ userId: state.adminId });
  });

  it('refuses to revoke a membership that does not exist (404)', async () => {
    const res = await admin
      .delete(`/api/v1/organizations/${state.orgId}/members/${state.memberId}`)
      .expect(404);
    expect(res.body.code).toBe('EntityNotFound');
  });

  it('a second organization is administered independently (no wildcard access)', async () => {
    // otherOrgId is still empty, so ADMIN may bootstrap it — and ONLY it:
    // being a member of orgId grants nothing over otherOrgId, and vice versa.
    await admin
      .post(`/api/v1/organizations/${state.otherOrgId}/members`)
      .send({ userId: state.adminId })
      .expect(204);
    const otherList = await admin
      .get(`/api/v1/organizations/${state.otherOrgId}/members`)
      .expect(200);
    expect(otherList.body.total).toBe(1);

    // MEMBER (no membership anywhere now) still sees nothing.
    await member.get(`/api/v1/organizations/${state.otherOrgId}`).expect(404);

    // OUTSIDER holds every membership verb and is a member of neither
    // organization: both are 404 for it, although both exist and it just
    // bootstrapped nothing.
    await outsider
      .get(`/api/v1/organizations/${state.otherOrgId}/members`)
      .expect(404);
    await outsider
      .post(`/api/v1/organizations/${state.otherOrgId}/members`)
      .send({ userId: state.memberId })
      .expect(404);
  });

  it('the LAST member may revoke themselves; the organization re-enters bootstrap', async () => {
    // ADMIN is the only member of otherOrgId and revokes itself.
    await admin
      .delete(
        `/api/v1/organizations/${state.otherOrgId}/members/${state.adminId}`,
      )
      .expect(204);

    // The membership set is empty → the bootstrap exception applies again,
    // so a non-member holding Grant may create the first member once more.
    await outsider
      .post(`/api/v1/organizations/${state.otherOrgId}/members`)
      .send({ userId: state.memberId })
      .expect(204);

    // …and it closes again at once: OUTSIDER is still not a member.
    const second = await outsider
      .post(`/api/v1/organizations/${state.otherOrgId}/members`)
      .send({ userId: state.plainId })
      .expect(404);
    expect(second.body.code).toBe('EntityNotFound');
    const list = await outsider
      .get(`/api/v1/organizations/${state.otherOrgId}/members`)
      .expect(404);
    expect(list.body.code).toBe('EntityNotFound');
  });

  it('cross-organization: a member of one organization cannot administer the other', async () => {
    // MEMBER is now a member of otherOrgId only. Give it the membership
    // verbs and prove they stop at its own organization boundary.
    const crossRole = await roles.createRole({
      name: 'MembershipAdminMemberOfOther',
      description: 'Membership verbs held by a member of otherOrg (fixture)',
      permissionCodes: [
        'Organization.Membership.View',
        'Organization.Membership.Grant',
        'Organization.Membership.Revoke',
      ],
    });
    await userRoles.assignRoleToUser(crossRole.id, state.memberId);

    // Its own organization: allowed.
    const own = await member
      .get(`/api/v1/organizations/${state.otherOrgId}/members`)
      .expect(200);
    expect(own.body.total).toBe(1);

    // The other organization (which has members): 404 for every verb.
    await member
      .get(`/api/v1/organizations/${state.orgId}/members`)
      .expect(404);
    await member
      .post(`/api/v1/organizations/${state.orgId}/members`)
      .send({ userId: state.plainId })
      .expect(404);
    await member
      .delete(`/api/v1/organizations/${state.orgId}/members/${state.adminId}`)
      .expect(404);

    // And the foreign organization's membership set is untouched.
    const untouched = await admin
      .get(`/api/v1/organizations/${state.orgId}/members`)
      .expect(200);
    expect(untouched.body.total).toBe(1);
  });
});
