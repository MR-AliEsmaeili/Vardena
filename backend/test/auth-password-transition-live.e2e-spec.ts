import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import {
  DOMAIN_EVENT_BUS,
  DomainEventBus,
} from '../src/kernel/events/domain-event-bus.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { SessionsRepository } from '../src/modules/identity/data/sessions.repository.js';
import { UsersService } from '../src/modules/users/application/users.service.js';
import { UsersRepository } from '../src/modules/users/data/users.repository.js';
import { PasswordService } from '../src/modules/users/domain/password.service.js';
import { USER_PASSWORD_CHANGED_EVENT } from '../src/modules/users/domain/user.events.js';
import { createTestApp } from './support/test-app.js';

const databaseUrl = process.env['VARDENA_TEST_DATABASE_URL'];

// CI only. No database bootstrap here; the backend job migrates its disposable
// PostgreSQL service first. Cleanup targets only the users created by this file.
describe.skipIf(databaseUrl === undefined)(
  'F-12 atomic credential transition (live PostgreSQL)',
  () => {
    let app: INestApplication;
    const ids: string[] = [];
    let unsubscribe: (() => void) | undefined;

    beforeAll(async () => {
      ({ app } = await createTestApp({
        override: (builder) =>
          builder
            .overrideProvider(APP_CONFIG)
            .useValue({ ...loadAppConfig(), databaseUrl }),
      }));
    }, 30_000);
    afterEach(async () => {
      vi.restoreAllMocks();
      unsubscribe?.();
      const client = await app.get(PrismaService).getClient<{
        user: {
          deleteMany(args: {
            where: { id: { in: string[] } };
          }): Promise<unknown>;
        };
      }>();
      await client.user.deleteMany({ where: { id: { in: ids.splice(0) } } });
    });
    afterAll(async () => {
      await app?.close();
    });

    async function fixture() {
      const initial = randomUUID();
      const replacement = randomUUID();
      const user = await app.get(UsersService).createUser({
        username: `f12-${randomUUID()}`,
        password: initial,
        mustChangePassword: true,
      });
      ids.push(user.id);
      const current = request.agent(app.getHttpServer());
      const other = request.agent(app.getHttpServer());
      for (const agent of [current, other]) {
        const login = await agent
          .post('/api/v1/auth/login')
          .send({ username: user.username, password: initial })
          .expect(200);
        expect(login.body.mustChangePassword).toBe(true);
      }
      const before = await app.get(UsersRepository).findById(user.id);
      const changed = vi.fn();
      unsubscribe = app
        .get<DomainEventBus>(DOMAIN_EVENT_BUS)
        .on(USER_PASSWORD_CHANGED_EVENT, changed);
      const change = (newPassword = replacement) =>
        current
          .post('/api/v1/auth/change-password')
          .send({ currentPassword: initial, newPassword });
      return {
        user,
        initial,
        replacement,
        current,
        other,
        before,
        changed,
        change,
      };
    }

    it('serializes two verified changes: one commit, one refusal, current session survives and other cookie cannot replay', async () => {
      const f = await fixture();
      const password = app.get(PasswordService);
      const hash = password.hash.bind(password);
      const ready = signal();
      const release = signal();
      let arrivals = 0;
      vi.spyOn(password, 'hash').mockImplementation(async (value) => {
        const result = await hash(value);
        if (++arrivals === 2) ready.resolve();
        await release.promise;
        return result;
      });
      const candidates = [f.replacement, randomUUID()];
      const pending = Promise.all(
        candidates.map((value) => f.change(value).then((res) => res)),
      );
      try {
        await waitFor(ready.promise);
      } finally {
        release.resolve();
      }
      const results = await pending;
      expect(results.map((res) => res.status).sort()).toEqual([200, 401]);
      const winner = results.findIndex((res) => res.status === 200);
      expect(f.changed).toHaveBeenCalledTimes(1);
      const stored = await app.get(UsersRepository).findById(f.user.id);
      expect(stored?.mustChangePassword).toBe(false);
      await expect(
        password.verify(stored!.passwordHash, candidates[winner]!),
      ).resolves.toBe(true);
      await expect(
        password.verify(stored!.passwordHash, candidates[1 - winner]!),
      ).resolves.toBe(false);
      await f.current.get('/api/v1/license/current').expect(200);
      await f.current.get('/api/v1/users').expect(403); // No RBAC bypass after unlocking.
      await f.other.get('/api/v1/auth/me').expect(401);
      expect(results[winner]!.body).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(f.changed.mock.calls)).not.toContain(f.initial);
      expect(JSON.stringify(f.changed.mock.calls)).not.toContain(
        stored!.passwordHash,
      );
    }, 20_000);

    it('rolls back real credential/flag/session writes on revocation failure, keeps quarantine, and permits a clean retry', async () => {
      const f = await fixture();
      const sessions = app.get(SessionsRepository);
      const revoke = sessions.revokeAllForUser.bind(sessions);
      const fault = vi
        .spyOn(sessions, 'revokeAllForUser')
        .mockImplementationOnce(async (...args) => {
          // This performs the ACTUAL SQL update before failing: rollback is not
          // proved by a mock that throws before anything has been written.
          expect(await revoke(...args)).toBe(1);
          throw new Error('simulated revocation failure');
        });
      const failure = await f.change().expect(500);
      expect(JSON.stringify(failure.body)).not.toContain(f.initial);
      expect(await app.get(UsersRepository).findById(f.user.id)).toEqual(
        f.before,
      );
      expect(f.changed).not.toHaveBeenCalled();
      for (const agent of [f.current, f.other]) {
        const me = await agent.get('/api/v1/auth/me').expect(200);
        expect(me.body.mustChangePassword).toBe(true);
        const blocked = await agent.get('/api/v1/license/current').expect(403);
        expect(blocked.body.details.reason).toBe('password_change_required');
      }
      fault.mockRestore();
      const success = await f.change().expect(200);
      expect(success.body.mustChangePassword).toBe(false);
      await f.current.get('/api/v1/license/current').expect(200);
      await f.other.get('/api/v1/auth/me').expect(401);
      expect(f.changed).toHaveBeenCalledTimes(1);
    }, 20_000);

    it('does not persist a session for a login verified with the old credential across a committed change', async () => {
      const f = await fixture();
      const users = app.get(UsersService);
      const verify = users.verifyCredentials.bind(users);
      vi.spyOn(users, 'verifyCredentials').mockImplementationOnce(
        async (...args) => {
          const old = await verify(...args);
          await f.change().expect(200);
          return old;
        },
      );
      const create = vi.spyOn(app.get(SessionsRepository), 'create');
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: f.user.username, password: f.initial })
        .expect(401);
      expect(login.body.message).toBe('Invalid username or password.');
      expect(login.headers['set-cookie']).toBeUndefined();
      expect(create).not.toHaveBeenCalled();
      await f.current.get('/api/v1/auth/me').expect(200);
      await f.other.get('/api/v1/auth/me').expect(401);
    }, 20_000);

    it('rolls back if logout revokes the initiating session after verification started', async () => {
      const f = await fixture();
      const password = app.get(PasswordService);
      const hash = password.hash.bind(password);
      vi.spyOn(password, 'hash').mockImplementationOnce(async (value) => {
        await f.current.post('/api/v1/auth/logout').expect(204);
        return hash(value);
      });
      await f.change().expect(401);
      expect(await app.get(UsersRepository).findById(f.user.id)).toEqual(
        f.before,
      );
      expect(f.changed).not.toHaveBeenCalled();
      const me = await f.other.get('/api/v1/auth/me').expect(200);
      expect(me.body.mustChangePassword).toBe(true);
    }, 20_000);
  },
);

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function waitFor(ready: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('credential barrier was not reached')),
          5_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
