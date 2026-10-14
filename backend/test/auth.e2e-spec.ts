import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppException } from '../src/kernel/errors/app-exception.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import {
  PrismaService,
  type DatabaseTransaction,
} from '../src/kernel/prisma/prisma.service.js';
import type { Session } from '../src/modules/identity/domain/session.js';
import { SessionsRepository } from '../src/modules/identity/data/sessions.repository.js';
import { PermissionsRepository } from '../src/modules/rbac/data/permissions.repository.js';
import { RolesRepository } from '../src/modules/rbac/data/roles.repository.js';
import { UserRolesRepository } from '../src/modules/rbac/data/user-roles.repository.js';
import { PermissionRegistry } from '../src/modules/rbac/application/permission-registry.js';
import { RolesService } from '../src/modules/rbac/application/roles.service.js';
import { UserRolesService } from '../src/modules/rbac/application/user-roles.service.js';
import type { User } from '../src/modules/users/domain/user.js';
import { UsersRepository } from '../src/modules/users/data/users.repository.js';
import {
  UsersService,
  type VerifyCredentialsResult,
} from '../src/modules/users/application/users.service.js';
import { PasswordService } from '../src/modules/users/domain/password.service.js';
import { createInMemoryStores } from './support/in-memory-repositories.js';
import { createTestApp } from './support/test-app.js';

/**
 * Authentication e2e tests (ADR-0007, security.md §2).
 *
 * Boots the full Nest app through the production HTTP pipeline
 * (`configureApp`) and exercises the auth endpoints end-to-end. Both
 * Prisma-backed repositories (UsersRepository, SessionsRepository) are
 * replaced with in-memory fakes so the suite runs without a live Postgres,
 * while still exercising real password hashing (argon2id), cookie
 * handling, rate limiting, the auth guard, and session lifecycle.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let fakeUsers: UsersService;
  let fakeSessions: SessionsRepository;

  const TEST_USER = {
    username: 'alice',
    password: 'hunter2hunter2',
  };

  beforeAll(async () => {
    fakeUsers = buildInMemoryUsers();
    fakeSessions = buildInMemorySessions();

    const rebuilt = await createTestApp({
      override: (builder) =>
        builder
          .overrideProvider(PrismaService)
          .useValue(buildPrismaStub())
          .overrideProvider(UsersService)
          .useValue(fakeUsers)
          .overrideProvider(SessionsRepository)
          .useValue(fakeSessions),
    });
    app = rebuilt.app;

    await fakeUsers.createUser({
      username: TEST_USER.username,
      password: TEST_USER.password,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ---- login -------------------------------------------------------------

  it('POST /auth/login returns a safe user DTO (no password hash)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(TEST_USER)
      .expect(200);
    expect(res.body).toMatchObject({
      username: TEST_USER.username,
      isActive: true,
    });
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(res.body).not.toHaveProperty('password');
  });

  it('login sets an HttpOnly, SameSite=Lax cookie; Secure off in NODE_ENV=test', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(TEST_USER)
      .expect(200);
    const cookies = readSetCookies(res);
    const cookie = cookies.find((c) => c.startsWith('vardena_session='));
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/');
    expect(cookie).toMatch(/SameSite=Lax/);
    // NODE_ENV=test => Secure defaults to false for HTTP local dev.
    expect(cookie).not.toMatch(/;\s*Secure(;|$)/);
  });

  it('login rejects unknown username with generic Unauthorized (no enumeration)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'nobody', password: 'whatever' })
      .expect(401);
    expect(res.body.code).toBe('Unauthorized');
    expect(res.body.message).toBe('Invalid username or password.');
  });

  it('login rejects wrong password with the SAME generic error', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: TEST_USER.username, password: 'wrong-pw' })
      .expect(401);
    expect(res.body.code).toBe('Unauthorized');
    expect(res.body.message).toBe('Invalid username or password.');
  });

  it('login rejects disabled users with the same generic message', async () => {
    const created = await fakeUsers.createUser({
      username: 'disabled_guy',
      password: 'pw',
    });
    await fakeUsers.disableUser(created.id);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'disabled_guy', password: 'pw' })
      .expect(401);
    expect(res.body.code).toBe('Unauthorized');
    expect(res.body.message).toBe('Invalid username or password.');
  });

  it('login validates empty body (400 ValidationFailed)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({})
      .expect(400);
    expect(res.body.code).toBe('ValidationFailed');
  });

  // ---- me ----------------------------------------------------------------

  it('GET /auth/me is 401 without a session', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .expect(401);
    expect(res.body.code).toBe('Unauthorized');
  });

  it('GET /auth/me returns the authenticated user after login (cookie jar)', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/login').send(TEST_USER).expect(200);
    const res = await agent.get('/api/v1/auth/me').expect(200);
    expect(res.body.username).toBe(TEST_USER.username);
    expect(res.body).not.toHaveProperty('passwordHash');
  });

  // ---- logout ------------------------------------------------------------

  it('POST /auth/logout revokes the session server-side (replay fails)', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/login').send(TEST_USER).expect(200);
    await agent.get('/api/v1/auth/me').expect(200);
    await agent.post('/api/v1/auth/logout').expect(204);
    const res = await agent.get('/api/v1/auth/me').expect(401);
    expect(res.body.code).toBe('Unauthorized');
  });

  it('POST /auth/logout is idempotent (204 with no session)', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/logout').expect(204);
  });

  // ---- rate limit --------------------------------------------------------

  it('login endpoint is rate-limited (stricter than global)', async () => {
    const http = request(app.getHttpServer());
    let rateLimited = false;
    // The login rate limit is 10 per 15 minutes. Fire up to 20 attempts
    // against an unknown-user endpoint.
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await http
        .post('/api/v1/auth/login')
        .send({ username: `ratelimited_${i}`, password: 'x' });
      if (res.status === 429) {
        rateLimited = true;
        expect(res.body.code).toBe('RateLimitExceeded');
        expect(res.headers['retry-after']).toBeDefined();
        break;
      }
    }
    expect(rateLimited).toBe(true);
  });

  // ---- openapi -----------------------------------------------------------

  it('openapi documents the auth endpoints', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    const paths = res.body.paths as Record<string, unknown>;
    expect(paths['/api/v1/auth/login']).toBeDefined();
    expect(paths['/api/v1/auth/logout']).toBeDefined();
    expect(paths['/api/v1/auth/me']).toBeDefined();
    expect(paths['/api/v1/auth/change-password']).toBeDefined();
  });
});

describe('Auth — mandatory password change & self-service change-password (e2e)', () => {
  let app: INestApplication;
  let users: UsersService;
  let roles: RolesService;
  let userRoles: UserRolesService;

  beforeAll(async () => {
    const stores = createInMemoryStores();
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
    users = app.get(UsersService);
    roles = app.get(RolesService);
    userRoles = app.get(UserRolesService);

    const admin = await users.createUser({
      username: 'bootstrap-admin',
      password: 'initial-password-123',
      mustChangePassword: true,
    });
    const allCodes = app
      .get(PermissionRegistry)
      .all()
      .map((definition) => definition.code);
    const adminRole = await roles.createRole({
      name: 'SystemAdminTest',
      description: 'Test admin role',
      permissionCodes: allCodes,
    });
    await userRoles.assignRoleToUser(adminRole.id, admin.id);
  });

  afterAll(async () => {
    await app.close();
  });

  it('flags forced-password-change users on login and /auth/me, blocks protected APIs with 403, and unlocks after POST /api/v1/auth/change-password', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        username: 'bootstrap-admin',
        password: 'initial-password-123',
      })
      .expect(200);

    expect(loginRes.body).toMatchObject({
      username: 'bootstrap-admin',
      isActive: true,
      mustChangePassword: true,
    });
    const cookie = readSetCookies(loginRes)[0]!;

    // Allowed while restricted: GET /api/v1/auth/me
    const meBefore = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(meBefore.body).toMatchObject({
      username: 'bootstrap-admin',
      mustChangePassword: true,
    });

    // Blocked while restricted: AuthGuard-only bootstrap endpoints AND
    // AuthorizationGuard-protected business endpoints, even when the user
    // holds all RBAC permissions.
    const blockedPermissions = await request(app.getHttpServer())
      .get('/api/v1/permissions/effective')
      .set('Cookie', cookie)
      .expect(403);
    expect(blockedPermissions.body).toMatchObject({
      code: 'PermissionDenied',
      details: { reason: 'password_change_required' },
    });

    const blockedLicense = await request(app.getHttpServer())
      .get('/api/v1/license/current')
      .set('Cookie', cookie)
      .expect(403);
    expect(blockedLicense.body).toMatchObject({
      code: 'PermissionDenied',
      details: { reason: 'password_change_required' },
    });

    const blockedUsers = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Cookie', cookie)
      .expect(403);
    expect(blockedUsers.body).toMatchObject({
      code: 'PermissionDenied',
      details: { reason: 'password_change_required' },
    });

    // Rejected password-change attempts keep mustChangePassword=true and
    // keep the session alive.
    const wrongCurrent = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Cookie', cookie)
      .send({
        currentPassword: 'wrong-password',
        newPassword: 'rotated-strong-password-456',
      })
      .expect(400);
    expect(wrongCurrent.body).toMatchObject({
      code: 'ValidationFailed',
      details: [{ field: 'currentPassword', code: 'invalidCurrentPassword' }],
    });

    const samePassword = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Cookie', cookie)
      .send({
        currentPassword: 'initial-password-123',
        newPassword: 'initial-password-123',
      })
      .expect(400);
    expect(samePassword.body).toMatchObject({
      code: 'ValidationFailed',
      details: [{ field: 'newPassword', code: 'mustDifferFromCurrent' }],
    });

    const tooShort = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Cookie', cookie)
      .send({
        currentPassword: 'initial-password-123',
        newPassword: 'short',
      })
      .expect(400);
    expect(tooShort.body).toMatchObject({
      code: 'ValidationFailed',
    });

    // Reject client-supplied userId (forbidNonWhitelisted).
    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Cookie', cookie)
      .send({
        userId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        currentPassword: 'initial-password-123',
        newPassword: 'rotated-strong-password-456',
      })
      .expect(400);

    // Start a second session for the same user to verify other-session revocation.
    const secondLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        username: 'bootstrap-admin',
        password: 'initial-password-123',
      })
      .expect(200);
    const secondCookie = readSetCookies(secondLogin)[0]!;

    // Valid self-service password change clears mustChangePassword and keeps
    // the current session active while revoking the second session.
    const changedRes = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Cookie', cookie)
      .send({
        currentPassword: 'initial-password-123',
        newPassword: 'rotated-strong-password-456',
      })
      .expect(200);

    expect(changedRes.body).toMatchObject({
      username: 'bootstrap-admin',
      isActive: true,
      mustChangePassword: false,
    });
    expect(changedRes.body).not.toHaveProperty('passwordHash');

    // Current session immediately reflects mustChangePassword=false on /auth/me.
    const meAfter = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(meAfter.body).toMatchObject({
      username: 'bootstrap-admin',
      mustChangePassword: false,
    });

    // Other session was revoked on password change.
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', secondCookie)
      .expect(401);

    // Protected endpoints are immediately unlocked for the same session.
    await request(app.getHttpServer())
      .get('/api/v1/permissions/effective')
      .set('Cookie', cookie)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/license/current')
      .set('Cookie', cookie)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Cookie', cookie)
      .expect(200);

    // Old password no longer authenticates; new password authenticates with mustChangePassword=false.
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        username: 'bootstrap-admin',
        password: 'initial-password-123',
      })
      .expect(401);

    const relogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        username: 'bootstrap-admin',
        password: 'rotated-strong-password-456',
      })
      .expect(200);
    expect(relogin.body).toMatchObject({
      username: 'bootstrap-admin',
      mustChangePassword: false,
    });
  });

  it('allows a restricted user to log out while mustChangePassword=true and rejects unauthenticated password changes with 401', async () => {
    await users.createUser({
      username: 'restricted-logout',
      password: 'initial-password-123',
      mustChangePassword: true,
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .send({
        currentPassword: 'initial-password-123',
        newPassword: 'rotated-strong-password-456',
      })
      .expect(401);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        username: 'restricted-logout',
        password: 'initial-password-123',
      })
      .expect(200);
    const cookie = readSetCookies(loginRes)[0]!;

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .expect(204);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(401);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPrismaStub(): PrismaService {
  return {
    getClient: async () => {
      throw new Error('Prisma unexpectedly touched in auth e2e test');
    },
    checkHealth: async () => {},
    onModuleDestroy: async () => {},
    describeConnection: () => 'mock',
  } as unknown as PrismaService;
}

function readSetCookies(res: { headers: Record<string, unknown> }): string[] {
  const sc = res.headers['set-cookie'];
  if (Array.isArray(sc)) return sc as string[];
  if (typeof sc === 'string') return [sc];
  return [];
}

/**
 * In-memory UsersService. Uses a real PasswordService so argon2id hashing
 * and verification are exercised end-to-end.
 */
function buildInMemoryUsers(): UsersService {
  const passwordService = new PasswordService();
  const store = new Map<string, User>();
  const byUsername = new Map<string, string>();

  return {
    async verifyCredentials(
      username: string,
      password: string,
    ): Promise<VerifyCredentialsResult> {
      const id = byUsername.get(username.trim());
      const user = id !== undefined ? (store.get(id) ?? null) : null;
      if (user === null) {
        await passwordService.verify(
          '$argon2id$v=19$m=19456,t=2,p=1$c29tZWR1bW15c2FsdHhzYWx0eHhhc2g$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMN',
          password,
        );
        return { user: null, failureReason: 'invalid_credentials' };
      }
      const ok = await passwordService.verify(user.passwordHash, password);
      if (!ok) return { user: null, failureReason: 'invalid_credentials' };
      if (!user.isActive || user.deletedAt !== null) {
        return { user: null, failureReason: 'user_disabled' };
      }
      return { user, failureReason: null };
    },
    async withCurrentCredentials<T>(
      expected: User,
      work: (tx: DatabaseTransaction) => Promise<T>,
    ) {
      const current = store.get(expected.id);
      if (
        current === undefined ||
        !current.isActive ||
        current.deletedAt !== null ||
        current.passwordHash !== expected.passwordHash
      )
        return null;
      return work({} as DatabaseTransaction);
    },
    async findActiveById(id: string) {
      const u = store.get(id) ?? null;
      if (u === null || !u.isActive || u.deletedAt !== null) return null;
      return u;
    },
    async findById(id: string) {
      return store.get(id) ?? null;
    },
    async findByUsername(username: string) {
      const id = byUsername.get(username.trim());
      return id !== undefined ? (store.get(id) ?? null) : null;
    },
    async createUser(params: {
      username: string;
      password: string;
      isActive?: boolean;
      mustChangePassword?: boolean;
    }) {
      const username = params.username.trim();
      if (byUsername.has(username)) {
        throw AppException.conflict(
          'A user with that username already exists.',
        );
      }
      const now = new Date();
      const user: User = {
        id: generateId(),
        username,
        passwordHash: await passwordService.hash(params.password),
        isActive: params.isActive ?? true,
        mustChangePassword: params.mustChangePassword ?? false,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      store.set(user.id, user);
      byUsername.set(user.username, user.id);
      return {
        id: user.id,
        username: user.username,
        isActive: user.isActive,
        mustChangePassword: user.mustChangePassword,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      };
    },
    async disableUser(userId: string) {
      const u = store.get(userId);
      if (u === undefined) throw AppException.notFound('User', userId);
      u.isActive = false;
      u.updatedAt = new Date();
    },
    async changeOwnPassword(
      userId: string,
      params: { currentPassword: string; newPassword: string },
      commitSessions: (tx: DatabaseTransaction) => Promise<void>,
    ) {
      const u = store.get(userId);
      if (u === undefined || !u.isActive || u.deletedAt !== null) {
        throw AppException.unauthorized('Authentication is required.');
      }
      const matches = await passwordService.verify(
        u.passwordHash,
        params.currentPassword,
      );
      if (!matches) {
        throw AppException.validation([
          {
            field: 'currentPassword',
            message: 'Current password is incorrect.',
            code: 'invalidCurrentPassword',
          },
        ]);
      }
      if (
        params.newPassword.length < 8 ||
        params.newPassword.trim().length === 0
      ) {
        throw AppException.validation([
          {
            field: 'newPassword',
            message: 'New password must be at least 8 characters.',
            code: 'minLength',
          },
        ]);
      }
      if (
        params.newPassword === params.currentPassword ||
        (await passwordService.verify(u.passwordHash, params.newPassword))
      ) {
        throw AppException.validation([
          {
            field: 'newPassword',
            message:
              'New password must be different from the current password.',
            code: 'mustDifferFromCurrent',
          },
        ]);
      }
      const hash = await passwordService.hash(params.newPassword);
      await commitSessions({} as DatabaseTransaction);
      u.passwordHash = hash;
      u.mustChangePassword = false;
      u.updatedAt = new Date();
      return u;
    },
  } as unknown as UsersService;
}

/** In-memory SessionsRepository (mirrors the API of the real one). */
function buildInMemorySessions(): SessionsRepository {
  const byId = new Map<string, Session>();
  const byTokenHash = new Map<string, Session>();

  const repo = {
    async lockById(sessionId: string) {
      return byId.get(sessionId) ?? null;
    },
    async create(input: {
      id: string;
      userId: string;
      tokenHash: string;
      userAgent: string | null;
      ipAddress: string | null;
      createdAt: Date;
      lastSeenAt: Date;
      expiresAt: Date;
      absoluteExpiresAt: Date;
    }) {
      const session: Session = {
        id: input.id,
        userId: input.userId,
        tokenHash: input.tokenHash,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
        createdAt: input.createdAt,
        lastSeenAt: input.lastSeenAt,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
        revokedAt: null,
      };
      byId.set(session.id, session);
      byTokenHash.set(session.tokenHash, session);
      return session;
    },
    async findById(id: string) {
      return byId.get(id) ?? null;
    },
    async findByTokenHash(hash: string) {
      return byTokenHash.get(hash) ?? null;
    },
    async touch(id: string, data: { lastSeenAt: Date; expiresAt: Date }) {
      const s = byId.get(id);
      if (s === undefined) return;
      s.lastSeenAt = data.lastSeenAt;
      s.expiresAt = data.expiresAt;
    },
    async revoke(id: string, revokedAt: Date) {
      const s = byId.get(id);
      if (s === undefined) return;
      s.revokedAt = revokedAt;
    },
    async revokeAllForUser(
      userId: string,
      exceptSessionId: string | null,
      revokedAt: Date,
    ) {
      let count = 0;
      for (const s of byId.values()) {
        if (s.userId !== userId) continue;
        if (s.revokedAt !== null) continue;
        if (exceptSessionId !== null && s.id === exceptSessionId) continue;
        s.revokedAt = revokedAt;
        count += 1;
      }
      return count;
    },
  };

  return repo as unknown as SessionsRepository;
}
// redundant guard: ensure early cast so missing-private-field is ignored.
void (buildInMemorySessions as () => SessionsRepository);
