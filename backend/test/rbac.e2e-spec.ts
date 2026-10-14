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
import {
  createInMemoryStores,
  type InMemoryStores,
} from './support/in-memory-repositories.js';
import { createTestApp } from './support/test-app.js';

/**
 * Users + RBAC journey (e2e) — task §19.
 *
 * Boots the real application through the production HTTP pipeline against the
 * in-memory repositories: real controllers, real guards (AuthGuard +
 * AuthorizationGuard), real application services, real permission registry +
 * startup mirror sync, real argon2id hashing. Only data access is faked.
 *
 * The journey is the acceptance scenario:
 *   create user → create role → assign permission → assign role → login →
 *   protected endpoint 200 → remove permission → SAME session → 403.
 *
 * The first administrator cannot be created through these endpoints (creating
 * a user already requires a permission), so the test bootstraps one in the
 * documented *system context* — the same path an initial deployment seed uses.
 * Everything after that goes over HTTP.
 */
describe('Users + RBAC (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request.agent>;
  let stores: InMemoryStores;
  let users: UsersService;
  let roles: RolesService;
  let userRoles: UserRolesService;

  const ROOT = { username: 'root', password: 'root-secret' };
  const ALICE = { username: 'alice', password: 'alice-secret' };

  // Journey state, filled by the steps below (order matters — one scenario).
  const state = { rootId: '', aliceId: '', viewerRoleId: '' };

  let root: ReturnType<typeof request.agent>;
  let alice: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    stores = createInMemoryStores();
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
          .useValue(stores.userRoles),
    });
    app = rebuilt.app;
    http = request(app.getHttpServer());
    users = app.get(UsersService);
    roles = app.get(RolesService);
    userRoles = app.get(UserRolesService);

    // Bootstrap administrator: system context (no HTTP request in flight), so
    // authorization is the caller's concern by design. OQ-19 tracks the
    // production procedure; the mechanism itself needs no special case.
    const rootUser = await users.createUser({
      username: ROOT.username,
      password: ROOT.password,
    });
    state.rootId = rootUser.id;
    const allCodes = app
      .get(PermissionRegistry)
      .all()
      .map((definition) => definition.code);
    const rootRole = await roles.createRole({
      name: 'Root',
      description: 'Bootstrap administrator (test fixture)',
      permissionCodes: allCodes,
    });
    await userRoles.assignRoleToUser(rootRole.id, rootUser.id);

    root = request.agent(app.getHttpServer());
    alice = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  // ---- 401 before 403 ------------------------------------------------------

  it('rejects anonymous calls to every protected endpoint with 401 (not 403)', async () => {
    for (const path of [
      '/api/v1/users',
      '/api/v1/roles',
      '/api/v1/permissions',
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await http.get(path).expect(401);
      expect(res.body.code).toBe('Unauthorized');
    }
    const created = await http
      .post('/api/v1/users')
      .send({ username: 'nobody', password: 'x' })
      .expect(401);
    expect(created.body.code).toBe('Unauthorized');
    // Nothing leaks without a session.
    expect(created.body).not.toHaveProperty('items');
  });

  // ---- bootstrap administrator works --------------------------------------

  it('lets the bootstrap administrator login and use the protected endpoints', async () => {
    await root.post('/api/v1/auth/login').send(ROOT).expect(200);

    const effective = await root
      .get('/api/v1/permissions/effective')
      .expect(200);
    expect(effective.body.userId).toBe(state.rootId);
    expect(effective.body.permissions).toContain('Users.User.Create');
    expect(effective.body.permissions).toContain('Rbac.Role.Create');
    expect(effective.body.permissions).toContain('Rbac.UserRole.Assign');

    const list = await root.get('/api/v1/users').expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({
      username: 'root',
      isActive: true,
    });

    const roleList = await root.get('/api/v1/roles').expect(200);
    expect(roleList.body.items[0]).toMatchObject({ name: 'Root' });

    const permissionList = await root.get('/api/v1/permissions').expect(200);
    expect(permissionList.body.total).toBe(app.get(PermissionRegistry).size);
  });

  // ---- create user -------------------------------------------------------

  it('creates a user over HTTP and never returns the password hash', async () => {
    const res = await root.post('/api/v1/users').send(ALICE).expect(201);

    expect(res.body).toMatchObject({
      username: ALICE.username,
      isActive: true,
      mustChangePassword: false,
    });
    expect(Object.keys(res.body).sort()).toEqual([
      'createdAt',
      'id',
      'isActive',
      'mustChangePassword',
      'updatedAt',
      'username',
    ]);
    state.aliceId = res.body.id as string;

    // The stored row has an argon2id hash — never the plaintext.
    const stored = stores.raw.users.raw(state.aliceId);
    expect(stored?.passwordHash).not.toBe(ALICE.password);
    expect(stored?.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('reports a duplicate username as 409 and a malformed body as 400', async () => {
    const duplicate = await root.post('/api/v1/users').send(ALICE).expect(409);
    expect(duplicate.body.code).toBe('Conflict');

    const invalid = await root
      .post('/api/v1/users')
      .send({ username: '', password: 'x' })
      .expect(400);
    expect(invalid.body.code).toBe('ValidationFailed');
  });

  // ---- a fresh account has no permissions yet -----------------------------

  it('lets the new user login but denies the protected endpoint (403, not 401)', async () => {
    await alice.post('/api/v1/auth/login').send(ALICE).expect(200);

    const res = await alice.get('/api/v1/users').expect(403);
    expect(res.body.code).toBe('PermissionDenied');
    // Generic message: the client is not told which permission it would need.
    expect(res.body.message).toBe(
      'You do not have permission to perform this action.',
    );
  });

  // ---- create role → assign permission → assign role ----------------------

  it('creates a role, assigns one permission, then assigns the role to the user', async () => {
    const role = await root
      .post('/api/v1/roles')
      .send({ name: 'Viewer', description: 'Can view users' })
      .expect(201);
    state.viewerRoleId = role.body.id as string;
    expect(role.body.permissionCount).toBe(0);

    await root
      .post(`/api/v1/roles/${state.viewerRoleId}/permissions`)
      .send({ code: 'Users.User.View' })
      .expect(204);

    const detail = await root
      .get(`/api/v1/roles/${state.viewerRoleId}`)
      .expect(200);
    expect(
      (detail.body.permissions as Array<{ code: string }>).map((p) => p.code),
    ).toEqual(['Users.User.View']);

    await root
      .post(`/api/v1/roles/${state.viewerRoleId}/users`)
      .send({ userId: state.aliceId })
      .expect(204);
    expect(
      stores.raw.userRoles.isAssigned(state.aliceId, state.viewerRoleId),
    ).toBe(true);
  });

  it('grants the endpoint to the SAME session with no new login', async () => {
    const res = await alice.get('/api/v1/users').expect(200);
    expect(res.body.total).toBe(2);
    expect(
      (res.body.items as Array<{ username: string }>)
        .map((user) => user.username)
        .sort(),
    ).toEqual(['alice', 'root']);

    const effective = await alice
      .get('/api/v1/permissions/effective')
      .expect(200);
    expect(effective.body.permissions).toEqual(['Users.User.View']);

    // ...but RBAC administration stays denied: one permission is one
    // permission, and routes that need several need ALL of them.
    await alice.get('/api/v1/roles').expect(403);
    await alice.post('/api/v1/roles').send({ name: 'Nope' }).expect(403);
    await alice
      .post(`/api/v1/roles/${state.viewerRoleId}/permissions`)
      .send({ code: 'Users.User.Create' })
      .expect(403);
    await alice.get('/api/v1/permissions').expect(403);
  });

  // ---- revocation is immediate -------------------------------------------

  it('removing the permission revokes access for the SAME session (403)', async () => {
    // The session is demonstrably alive right before the change.
    await alice.get('/api/v1/users').expect(200);

    await root
      .delete(`/api/v1/roles/${state.viewerRoleId}/permissions/Users.User.View`)
      .expect(204);

    const res = await alice.get('/api/v1/users').expect(403);
    expect(res.body.code).toBe('PermissionDenied');

    // Still authenticated — this is authorization, not a logout.
    const effective = await alice
      .get('/api/v1/permissions/effective')
      .expect(200);
    expect(effective.body.permissions).toEqual([]);
    await alice.get('/api/v1/auth/me').expect(200);
  });

  it('removing the role from the user has the same effect', async () => {
    await root
      .post(`/api/v1/roles/${state.viewerRoleId}/permissions`)
      .send({ code: 'Users.User.View' })
      .expect(204);
    await alice.get('/api/v1/users').expect(200);

    await root
      .delete(`/api/v1/roles/${state.viewerRoleId}/users/${state.aliceId}`)
      .expect(204);
    await alice.get('/api/v1/users').expect(403);
  });

  // ---- a client cannot grant itself anything by crafting a payload ---------

  it('rejects payloads that try to set state the API does not own (400)', async () => {
    for (const body of [
      { username: 'sneaky1', password: 'x', isActive: false },
      { username: 'sneaky2', password: 'x', roles: ['Root'] },
      { username: 'sneaky3', password: 'x', passwordHash: '$argon2id$x' },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await root.post('/api/v1/users').send(body).expect(400);
      expect(res.body.code).toBe('ValidationFailed');
    }
    // None of the rejected payloads created anything.
    for (const username of ['sneaky1', 'sneaky2', 'sneaky3']) {
      // eslint-disable-next-line no-await-in-loop
      expect(await stores.users.findByUsername(username)).toBeNull();
    }
  });

  it('rejects permission changes smuggled into a role edit (400)', async () => {
    const res = await root
      .patch(`/api/v1/roles/${state.viewerRoleId}`)
      .send({ name: 'Viewer renamed', permissionCodes: ['Rbac.Role.View'] })
      .expect(400);
    expect(res.body.code).toBe('ValidationFailed');
  });

  it('rejects an invented permission code (404) and a malformed one (400)', async () => {
    const unknown = await root
      .post(`/api/v1/roles/${state.viewerRoleId}/permissions`)
      .send({ code: 'Accounting.Invoice.Create' })
      .expect(404);
    expect(unknown.body.code).toBe('EntityNotFound');

    const malformed = await root
      .post(`/api/v1/roles/${state.viewerRoleId}/permissions`)
      .send({ code: 'not-a-permission' })
      .expect(400);
    expect(malformed.body.code).toBe('ValidationFailed');
  });

  it('refuses to assign a role to a user that does not exist (404)', async () => {
    await root
      .post(`/api/v1/roles/${state.viewerRoleId}/users`)
      .send({ userId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }) // well-formed ULID, unknown
      .expect(404);
  });

  it('refuses a duplicate role name (409) and a duplicate permission (409)', async () => {
    await root.post('/api/v1/roles').send({ name: 'Viewer' }).expect(409);

    // A second assignment of the same code is a 409 (the pair is the primary
    // key of `rbac.role_permissions`).
    await root
      .post(`/api/v1/roles/${state.viewerRoleId}/permissions`)
      .send({ code: 'Users.User.Edit' })
      .expect(204);
    await root
      .post(`/api/v1/roles/${state.viewerRoleId}/permissions`)
      .send({ code: 'Users.User.Edit' })
      .expect(409);
  });

  // ---- disable revokes sessions (Identity consumes User.Disabled) ---------

  it('disabling a user revokes the existing session immediately (200 then 401)', async () => {
    const disabled = await root
      .post(`/api/v1/users/${state.aliceId}/disable`)
      .expect(200);
    expect(disabled.body.isActive).toBe(false);

    const res = await alice.get('/api/v1/users').expect(401);
    expect(res.body.code).toBe('Unauthorized');

    // The account can no longer authenticate, and can be re-enabled.
    await alice.post('/api/v1/auth/login').send(ALICE).expect(401);
    const reEnabled = await root
      .post(`/api/v1/users/${state.aliceId}/enable`)
      .expect(200);
    expect(reEnabled.body.isActive).toBe(true);
  });

  it('lets an administrator reset a password, and the new one works', async () => {
    await root
      .post(`/api/v1/users/${state.aliceId}/password-reset`)
      .send({ newPassword: 'brand-new-secret' })
      .expect(204);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: ALICE.username, password: 'brand-new-secret' })
      .expect(200);
  });

  // ---- contract ----------------------------------------------------------

  it('documents the users and RBAC endpoints in the OpenAPI document', async () => {
    const res = await http.get('/api/docs-json').expect(200);
    const paths = res.body.paths as Record<string, unknown>;
    for (const path of [
      '/api/v1/users',
      '/api/v1/users/{id}',
      '/api/v1/users/{id}/enable',
      '/api/v1/users/{id}/disable',
      '/api/v1/users/{id}/password-reset',
      '/api/v1/roles',
      '/api/v1/roles/{id}',
      '/api/v1/roles/{id}/permissions',
      '/api/v1/roles/{id}/permissions/{code}',
      '/api/v1/roles/{id}/users',
      '/api/v1/roles/{id}/users/{userId}',
      '/api/v1/permissions',
      '/api/v1/permissions/effective',
    ]) {
      expect(paths[path], `missing ${path}`).toBeDefined();
    }
    // No delete endpoint for roles or users (open questions OQ-18/OQ-20).
    expect(paths['/api/v1/roles/{id}']).not.toHaveProperty('delete');
    expect(paths['/api/v1/users/{id}']).not.toHaveProperty('delete');
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPrismaStub(): PrismaService {
  return {
    getClient: async () => {
      throw new Error('Prisma unexpectedly touched in the RBAC e2e test');
    },
    checkHealth: async () => {},
    onModuleDestroy: async () => {},
    describeConnection: () => 'mock',
  } as unknown as PrismaService;
}
