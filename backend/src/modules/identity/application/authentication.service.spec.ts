import type { Request, Response } from 'express';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AppConfig } from '../../../kernel/config/app-config.js';
import type { DomainEventBus } from '../../../kernel/events/domain-event-bus.js';
import type { DatabaseTransaction } from '../../../kernel/prisma/prisma.service.js';
import { loadAppConfig } from '../../../kernel/config/app-config.js';
import type { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { UsersService } from '../../users/application/users.service.js';
import { SessionsRepository } from '../data/sessions.repository.js';
import { SessionTokenService } from '../domain/session-token.service.js';
import { AuthenticationService } from './authentication.service.js';
import type { Session } from '../domain/session.js';
import type { User } from '../../users/domain/user.js';
import { runWithRequestContext } from '../../../kernel/correlation/request-context.js';

// Shape of the minimal Response mock the tests construct.
interface MockRes {
  cookie: ReturnType<typeof vi.fn>;
  clearCookie: ReturnType<typeof vi.fn>;
}

const testConfig: AppConfig = loadAppConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/db',
});

function makeUser(overrides: Partial<User> = {}): User {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    username: 'alice',
    passwordHash: 'hash',
    isActive: true,
    mustChangePassword: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  const now = new Date();
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    userId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    tokenHash: 'deadbeef',
    userAgent: null,
    ipAddress: '127.0.0.1',
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + testConfig.auth.sessionIdleTimeoutMs),
    absoluteExpiresAt: new Date(
      now.getTime() + testConfig.auth.sessionAbsoluteTimeoutMs,
    ),
    revokedAt: null,
    ...overrides,
  };
}

function mockReq(cookieHeader?: string): Request {
  return {
    ip: '127.0.0.1',
    headers: {
      'user-agent': 'vitest',
      cookie: cookieHeader,
    },
  } as unknown as Request;
}

function mockRes(): Response {
  const res: MockRes = {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  };
  return res as unknown as Response;
}

describe('AuthenticationService', () => {
  let sessions: SessionsRepository;
  let tokens: SessionTokenService;
  let users: UsersService;
  let events: DomainEventBus;
  let logger: JsonLogger;
  let service: AuthenticationService;

  beforeEach(() => {
    sessions = {
      create: vi.fn(),
      findById: vi.fn(),
      findByTokenHash: vi.fn(),
      touch: vi.fn(),
      revoke: vi.fn(),
      revokeAllForUser: vi.fn(),
      lockById: vi.fn().mockResolvedValue(makeSession()),
    } as unknown as SessionsRepository;
    tokens = new SessionTokenService();
    users = {
      verifyCredentials: vi.fn(),
      withCurrentCredentials: vi.fn(async (_user, work) =>
        work({} as DatabaseTransaction),
      ),
      findActiveById: vi.fn(),
      findById: vi.fn(),
      findByUsername: vi.fn(),
      createUser: vi.fn(),
      disableUser: vi.fn(),
      changeOwnPassword: vi.fn(),
    } as unknown as UsersService;
    events = {
      on: vi.fn(),
      publish: vi.fn().mockResolvedValue(undefined),
    } as unknown as DomainEventBus;
    logger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as JsonLogger;
    service = new AuthenticationService(
      testConfig,
      sessions,
      users,
      tokens,
      logger,
      events,
    );
  });

  function inContext<T>(fn: () => T): T {
    return runWithRequestContext(
      { correlationId: '01ARZ3NDEKTSV4RRFFQ69G5FAX' },
      fn,
    );
  }

  describe('login', () => {
    it('creates a session and sets the httpOnly cookie on success', async () => {
      const user = makeUser();
      vi.mocked(users.verifyCredentials).mockResolvedValue({
        user,
        failureReason: null,
      });
      vi.mocked(sessions.create).mockImplementation(async (input) =>
        makeSession({
          id: input.id,
          userId: input.userId,
          tokenHash: input.tokenHash,
        }),
      );

      const res = mockRes();
      const dto = await inContext(() =>
        service.login(
          { username: 'alice', password: 'pw' },
          { req: mockReq(), res },
        ),
      );

      expect(dto.id).toBe(user.id);
      expect(dto.username).toBe('alice');
      // Password hash never returned.
      expect(dto).not.toHaveProperty('passwordHash');
      expect(sessions.create).toHaveBeenCalledTimes(1);
      expect(res.cookie).toHaveBeenCalledTimes(1);
      const call = vi.mocked((res as unknown as MockRes).cookie).mock.calls[0]!;
      const cookieName = call[0] as string;
      const cookieValue = call[1] as string;
      const opts = call[2] as {
        httpOnly: boolean;
        sameSite: string;
        secure: boolean;
        path: string;
      };
      expect(cookieName).toBe('vardena_session');
      expect(typeof cookieValue).toBe('string');
      expect(cookieValue.length).toBeGreaterThan(20);
      expect(opts.httpOnly).toBe(true);
      expect(opts.sameSite).toBe('lax');
      // NODE_ENV=test -> cookieSecure defaults to false for local dev.
      expect(opts.secure).toBe(false);
      expect(opts.path).toBe('/');
      // SessionCreated event published.
      expect(events.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'UserSession.Created' }),
      );
    });

    it('rejects with generic Unauthorized on bad credentials (no user enumeration)', async () => {
      vi.mocked(users.verifyCredentials).mockResolvedValue({
        user: null,
        failureReason: 'invalid_credentials',
      });
      const res = mockRes();
      const err = await inContext(() =>
        service
          .login({ username: 'nope', password: 'x' }, { req: mockReq(), res })
          .catch((e) => e),
      );
      expect(err.code).toBe('Unauthorized');
      expect(err.message).toBe('Invalid username or password.');
      expect(sessions.create).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
      expect(events.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'Login.Failed' }),
      );
    });

    it('returns the SAME generic error for disabled users', async () => {
      vi.mocked(users.verifyCredentials).mockResolvedValue({
        user: null,
        failureReason: 'user_disabled',
      });
      const res = mockRes();
      const err = await inContext(() =>
        service
          .login({ username: 'alice', password: 'pw' }, { req: mockReq(), res })
          .catch((e) => e),
      );
      expect(err.code).toBe('Unauthorized');
      expect(err.message).toBe('Invalid username or password.');
    });
  });

  describe('logout', () => {
    it('revokes the session server-side and clears the cookie', async () => {
      const session = makeSession();
      const rawToken = 'raw-token-value';
      const cookie = `vardena_session=${encodeURIComponent(rawToken)}; Path=/`;
      vi.mocked(sessions.findByTokenHash).mockResolvedValue(session);
      vi.spyOn(tokens, 'hashToken').mockReturnValue(session.tokenHash);

      const res = mockRes();
      await inContext(() => service.logout({ req: mockReq(cookie), res }));

      expect(sessions.revoke).toHaveBeenCalledWith(
        session.id,
        expect.any(Date),
      );
      expect(res.clearCookie).toHaveBeenCalledWith(
        'vardena_session',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(events.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UserSession.Revoked',
          payload: expect.objectContaining({ reason: 'logout' }),
        }),
      );
    });

    it('is safe to call when no session exists (idempotent)', async () => {
      const res = mockRes();
      await expect(
        inContext(() => service.logout({ req: mockReq(), res })),
      ).resolves.toBeUndefined();
      expect(sessions.revoke).not.toHaveBeenCalled();
    });
  });

  describe('authenticateRequest', () => {
    it('returns null when no cookie is present', async () => {
      const result = await inContext(() =>
        service.authenticateRequest(mockReq()),
      );
      expect(result).toBeNull();
    });

    it('returns null for a revoked session', async () => {
      const session = makeSession({ revokedAt: new Date() });
      vi.spyOn(tokens, 'hashToken').mockReturnValue(session.tokenHash);
      vi.mocked(sessions.findByTokenHash).mockResolvedValue(session);
      const result = await inContext(() =>
        service.authenticateRequest(mockReq(`vardena_session=raw; Path=/`)),
      );
      expect(result).toBeNull();
    });

    it('returns null when user is no longer active and revokes the session', async () => {
      const session = makeSession();
      vi.spyOn(tokens, 'hashToken').mockReturnValue(session.tokenHash);
      vi.mocked(sessions.findByTokenHash).mockResolvedValue(session);
      vi.mocked(users.findActiveById).mockResolvedValue(null);

      const result = await inContext(() =>
        service.authenticateRequest(mockReq(`vardena_session=raw; Path=/`)),
      );
      expect(result).toBeNull();
      expect(sessions.revoke).toHaveBeenCalledWith(
        session.id,
        expect.any(Date),
      );
    });

    it('returns the user+session and attaches the principal on success', async () => {
      const user = makeUser();
      const session = makeSession();
      vi.spyOn(tokens, 'hashToken').mockReturnValue(session.tokenHash);
      vi.mocked(sessions.findByTokenHash).mockResolvedValue(session);
      vi.mocked(sessions.findById).mockResolvedValue(session);
      vi.mocked(users.findActiveById).mockResolvedValue(user);

      const result = await inContext(() =>
        service.authenticateRequest(mockReq(`vardena_session=raw; Path=/`)),
      );
      expect(result).not.toBeNull();
      expect(result!.user.id).toBe(user.id);
      expect(result!.session.id).toBe(session.id);
      // Sliding expiry touch is fired (fire-and-forget) — we can't await it
      // synchronously but the call should have been scheduled.
      // Give the microtask queue a tick:
      await new Promise((r) => setTimeout(r, 10));
      expect(sessions.touch).toHaveBeenCalledWith(
        session.id,
        expect.objectContaining({ lastSeenAt: expect.any(Date) }),
      );
    });
  });

  describe('changePassword', () => {
    it('changes the authenticated user password, clears mustChangePassword, and revokes other sessions while keeping current session active', async () => {
      const updatedUser = makeUser({ mustChangePassword: false });
      vi.mocked(users.changeOwnPassword).mockImplementation(
        async (_id, _params, commit) => {
          await commit({} as DatabaseTransaction);
          return updatedUser;
        },
      );
      vi.mocked(sessions.revokeAllForUser).mockResolvedValue(2);

      const dto = await runWithRequestContext(
        {
          correlationId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
          principal: {
            userId: updatedUser.id,
            sessionId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
            mustChangePassword: true,
          },
        },
        () =>
          service.changePassword({
            currentPassword: 'old-password',
            newPassword: 'new-strong-password',
          }),
      );

      expect(dto.id).toBe(updatedUser.id);
      expect(dto.mustChangePassword).toBe(false);
      expect(users.changeOwnPassword).toHaveBeenCalledWith(
        updatedUser.id,
        {
          currentPassword: 'old-password',
          newPassword: 'new-strong-password',
        },
        expect.any(Function),
      );
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
        updatedUser.id,
        '01ARZ3NDEKTSV4RRFFQ69G5FAW',
        expect.any(Date),
        expect.any(Object),
      );
      expect(events.publish).toHaveBeenCalledTimes(1);
      expect(events.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UserSession.Revoked',
          payload: expect.objectContaining({
            sessionId: '*',
            userId: updatedUser.id,
            reason: 'password_change',
          }),
        }),
      );
    });

    it('rejects with Unauthorized when no principal is present in request context', async () => {
      await expect(
        inContext(() =>
          service.changePassword({
            currentPassword: 'old-password',
            newPassword: 'new-strong-password',
          }),
        ),
      ).rejects.toMatchObject({ code: 'Unauthorized' });
      expect(users.changeOwnPassword).not.toHaveBeenCalled();
    });
  });
});
