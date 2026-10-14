import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createInMemoryStores } from '../../../../test/support/in-memory-repositories.js';
import { licensingTestDouble } from '../../../../test/support/licensing.js';
import { loadAppConfig } from '../../../kernel/config/app-config.js';
import { runWithRequestContext } from '../../../kernel/correlation/request-context.js';
import { DomainEventBus } from '../../../kernel/events/domain-event-bus.js';
import type { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { UsersService } from '../../users/application/users.service.js';
import type { PasswordService } from '../../users/domain/password.service.js';
import { USER_PASSWORD_CHANGED_EVENT } from '../../users/domain/user.events.js';
import { SessionTokenService } from '../domain/session-token.service.js';
import { AuthenticationService } from './authentication.service.js';

// Hermetic application regressions. PostgreSQL transaction/lock behavior is
// separately exercised by auth-password-transition-live.e2e-spec.ts in CI.
async function fixture() {
  const stores = createInMemoryStores();
  const config = loadAppConfig({
    DATABASE_URL: 'postgresql://unused@127.0.0.1:1/db',
  });
  const logger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as JsonLogger;
  const events = new DomainEventBus();
  const changed = vi.fn();
  events.on(USER_PASSWORD_CHANGED_EVENT, changed);
  const password = {
    hash: vi.fn(async (value: string) => `test-hash:${value}`),
    verify: vi.fn(
      async (hash: string, value: string) => hash === `test-hash:${value}`,
    ),
  } as unknown as PasswordService;
  const licensing = licensingTestDouble();
  const users = new UsersService(
    stores.users,
    password,
    new AuthorizationService(stores.userRoles, logger, licensing),
    logger,
    events,
    licensing,
  );
  const tokens = new SessionTokenService();
  const auth = new AuthenticationService(
    config,
    stores.sessions,
    users,
    tokens,
    logger,
    events,
  );
  const now = new Date();
  const user = await stores.users.create({
    id: 'user',
    username: 'user',
    passwordHash: 'test-hash:initial-password',
    isActive: true,
    mustChangePassword: true,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
  });
  const rawToken = tokens.generateToken();
  for (const id of ['current', 'other']) {
    await stores.sessions.create({
      id,
      userId: user.id,
      tokenHash: tokens.hashToken(
        id === 'other' ? rawToken : tokens.generateToken(),
      ),
      userAgent: null,
      ipAddress: null,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      absoluteExpiresAt: new Date(now.getTime() + 120_000),
    });
  }
  const change = (newPassword = 'replacement-password') =>
    runWithRequestContext(
      {
        correlationId: 'transition',
        principal: {
          userId: user.id,
          sessionId: 'current',
          mustChangePassword: true,
        },
      },
      () =>
        auth.changePassword({
          currentPassword: 'initial-password',
          newPassword,
        }),
    );
  const request = {
    headers: { cookie: `${config.auth.cookieName}=${rawToken}` },
  } as Request;
  return { stores, users, auth, password, changed, user, change, request };
}

describe('F-12 credential transition regressions', () => {
  it('only one concurrent change can consume the verified current credential', async () => {
    const f = await fixture();
    const arrived = signal();
    const release = signal();
    let count = 0;
    vi.mocked(f.password.hash).mockImplementation(async (value) => {
      if (++count === 2) arrived.resolve();
      await release.promise;
      return `test-hash:${value}`;
    });
    const results = Promise.allSettled([
      f.change('replacement-one'),
      f.change('replacement-two'),
    ]);
    await arrived.promise;
    release.resolve();
    const settled = await results;
    expect(
      settled.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      settled.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(f.changed).toHaveBeenCalledTimes(1);
  });

  it('rolls back the credential, restriction and sessions when revocation fails after a write', async () => {
    const f = await fixture();
    const revoke = f.stores.sessions.revokeAllForUser.bind(f.stores.sessions);
    vi.spyOn(f.stores.sessions, 'revokeAllForUser').mockImplementation(
      async (...args) => {
        await revoke(...args);
        throw new Error('simulated revocation failure');
      },
    );
    await expect(f.change()).rejects.toThrow('simulated revocation failure');
    expect(await f.stores.users.findById(f.user.id)).toEqual(f.user);
    expect((await f.stores.sessions.findById('other'))?.revokedAt).toBeNull();
    expect(f.changed).not.toHaveBeenCalled();
  });

  it('does not promote a revoked restricted session when session and user reads straddle commit', async () => {
    const f = await fixture();
    const find = f.stores.sessions.findByTokenHash.bind(f.stores.sessions);
    vi.spyOn(f.stores.sessions, 'findByTokenHash').mockImplementationOnce(
      async (hash) => {
        const oldSession = { ...(await find(hash))! };
        await f.change();
        return oldSession;
      },
    );
    await expect(
      runWithRequestContext({ correlationId: 'read-race' }, () =>
        f.auth.authenticateRequest(f.request),
      ),
    ).resolves.toBeNull();
  });

  it('refuses a login whose old credential was verified before the change but whose session is created after it', async () => {
    const f = await fixture();
    const verify = f.users.verifyCredentials.bind(f.users);
    vi.spyOn(f.users, 'verifyCredentials').mockImplementationOnce(
      async (...args) => {
        const oldCredential = await verify(...args);
        await f.change();
        return oldCredential;
      },
    );
    const response = { cookie: vi.fn() } as unknown as Response;
    const create = vi.spyOn(f.stores.sessions, 'create');
    await expect(
      runWithRequestContext({ correlationId: 'login-race' }, () =>
        f.auth.login(
          { username: 'user', password: 'initial-password' },
          { req: f.request, res: response },
        ),
      ),
    ).rejects.toMatchObject({ code: 'Unauthorized' });
    expect(create).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it.each(['disable', 'delete', 'reset'] as const)(
    'does not write after a concurrent %s invalidates verification',
    async (action) => {
      const f = await fixture();
      vi.mocked(f.password.hash).mockImplementationOnce(async (value) => {
        await f.stores.users.update(f.user.id, {
          ...(action === 'disable'
            ? { isActive: false }
            : action === 'delete'
              ? { deletedAt: new Date() }
              : { passwordHash: 'test-hash:reset-password' }),
          updatedAt: new Date(),
          updatedBy: 'administrator',
        });
        return `test-hash:${value}`;
      });
      await expect(f.change()).rejects.toMatchObject({ code: 'Unauthorized' });
      const stored = await f.stores.users.findById(f.user.id);
      expect(stored?.passwordHash).toBe(
        action === 'reset' ? 'test-hash:reset-password' : f.user.passwordHash,
      );
      expect(stored?.mustChangePassword).toBe(true);
      expect(f.changed).not.toHaveBeenCalled();
    },
  );

  it.each(['missing', 'foreign', 'idle-expired', 'absolute-expired'] as const)(
    'refuses a %s initiating session without unlocking the account',
    async (state) => {
      const f = await fixture();
      const session = (await f.stores.sessions.findById('current'))!;
      if (state === 'missing')
        vi.spyOn(f.stores.sessions, 'findById').mockResolvedValueOnce(null);
      if (state === 'foreign') session.userId = 'another-user';
      if (state === 'idle-expired') session.expiresAt = new Date(0);
      if (state === 'absolute-expired') session.absoluteExpiresAt = new Date(0);
      await expect(f.change()).rejects.toMatchObject({ code: 'Unauthorized' });
      expect(await f.stores.users.findById(f.user.id)).toEqual(f.user);
      expect((await f.stores.sessions.findById('other'))?.revokedAt).toBeNull();
      expect(f.changed).not.toHaveBeenCalled();
    },
  );

  it('rolls back when the initiating session was revoked during password verification', async () => {
    const f = await fixture();
    vi.mocked(f.password.hash).mockImplementationOnce(async (value) => {
      await f.stores.sessions.revoke('current', new Date());
      return `test-hash:${value}`;
    });
    await expect(f.change()).rejects.toMatchObject({ code: 'Unauthorized' });
    expect(await f.stores.users.findById(f.user.id)).toEqual(f.user);
    expect((await f.stores.sessions.findById('other'))?.revokedAt).toBeNull();
    expect(f.changed).not.toHaveBeenCalled();
  });
});

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
