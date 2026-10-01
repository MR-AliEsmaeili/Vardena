import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { UsersRepository } from '../src/modules/users/data/users.repository.js';
import { SessionsRepository } from '../src/modules/identity/data/sessions.repository.js';
import { PermissionsRepository } from '../src/modules/rbac/data/permissions.repository.js';
import { RolesRepository } from '../src/modules/rbac/data/roles.repository.js';
import { UserRolesRepository } from '../src/modules/rbac/data/user-roles.repository.js';
import { UsersService } from '../src/modules/users/application/users.service.js';
import { createInMemoryStores } from './support/in-memory-repositories.js';
import { createTestApp } from './support/test-app.js';

/**
 * Session continuity (ADR-0007, docs/security.md §2).
 *
 * Vardena has no access token: authentication is ONE opaque server-side
 * session with a sliding idle deadline and a hard absolute cap — the
 * equivalent of "short-lived credential + long-lived revocable session" in a
 * token architecture. These tests pin the two halves of the contract:
 *
 *  U) ordinary continuous use never signs the user out. The browser keeps the
 *     cookie for the ABSOLUTE lifetime (the `Max-Age` regression below: the
 *     cookie used to be issued 1000× too short, so a 12-hour session died in
 *     the browser after ~43 seconds), and each authenticated request slides
 *     the idle deadline forward server-side;
 *  V) a revoked or idle-expired session still requires a real login. No
 *     permanent credential is issued and nothing refreshes itself forever.
 */
describe('Session continuity (e2e)', () => {
  const IDLE_MS = 400;
  const ABSOLUTE_MS = 12 * 60 * 60 * 1000;
  const USER = { username: 'session-user', password: 'session-password' };

  let app: INestApplication;
  let stores: ReturnType<typeof createInMemoryStores>;

  beforeAll(async () => {
    stores = createInMemoryStores();
    const base = loadAppConfig();
    const built = await createTestApp({
      override: (builder) =>
        builder
          .overrideProvider(APP_CONFIG)
          .useValue({
            ...base,
            auth: {
              ...base.auth,
              sessionIdleTimeoutMs: IDLE_MS,
              sessionAbsoluteTimeoutMs: ABSOLUTE_MS,
            },
          })
          .overrideProvider(PrismaService)
          .useValue({
            getClient: () => {
              throw new Error('Prisma must be overridden.');
            },
            onModuleInit: async () => {},
            onModuleDestroy: async () => {},
            enableShutdownHooks: () => {},
          })
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
    app = built.app;
    await app.get(UsersService).createUser(USER);
  });

  afterAll(async () => {
    await app.close();
  });

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  async function loggedIn(): Promise<{
    agent: ReturnType<typeof request.agent>;
    setCookie: string;
  }> {
    const agent = request.agent(app.getHttpServer());
    const response = await agent
      .post('/api/v1/auth/login')
      .send(USER)
      .expect(200);
    const header = response.headers['set-cookie'];
    const cookies = Array.isArray(header) ? header : [header as string];
    return {
      agent,
      setCookie: cookies.find((value) =>
        value.startsWith('vardena_session='),
      ) as string,
    };
  }

  it('U issues a cookie that lives for the full absolute session lifetime', async () => {
    const { setCookie } = await loggedIn();

    const maxAge = Number(/Max-Age=(\d+)/.exec(setCookie)?.[1]);
    // Express converts the millisecond option to a seconds directive.
    expect(maxAge).toBeGreaterThan(ABSOLUTE_MS / 1000 - 60);
    expect(maxAge).toBeLessThanOrEqual(ABSOLUTE_MS / 1000);
    expect(setCookie).toContain('HttpOnly');
  });

  it('U ordinary continuous use keeps the session alive past the idle window', async () => {
    const { agent } = await loggedIn();

    // Three requests spaced below the idle timeout, spanning more than twice
    // the window in total: without the sliding refresh the third would 401.
    for (let index = 0; index < 3; index += 1) {
      await sleep(IDLE_MS * 0.6);
      await agent.get('/api/v1/auth/me').expect(200);
      await agent.get('/api/v1/license/current').expect(200);
    }
  });

  it('V an idle session beyond the window requires a real login again', async () => {
    const { agent } = await loggedIn();
    await agent.get('/api/v1/auth/me').expect(200);

    await sleep(IDLE_MS * 2.5);

    await agent.get('/api/v1/auth/me').expect(401);
    // The same browser can log in again — nothing is permanently broken.
    await agent.post('/api/v1/auth/login').send(USER).expect(200);
    await agent.get('/api/v1/auth/me').expect(200);
  });

  it('V a revoked (logged-out) session is rejected even inside the window', async () => {
    const { agent } = await loggedIn();
    await agent.post('/api/v1/auth/logout').expect(204);

    await agent.get('/api/v1/auth/me').expect(401);
  });
});
