import { Inject, Injectable } from '@nestjs/common';
import type { Response, Request } from 'express';
import {
  APP_CONFIG,
  type AppConfig,
} from '../../../kernel/config/app-config.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { getCorrelationId } from '../../../kernel/correlation/request-context.js';
import { setPrincipal } from '../../../kernel/correlation/request-context.js';
import { UsersService } from '../../users/application/users.service.js';
import type { User, UserDto } from '../../users/domain/user.js';
import { toUserDto } from '../../users/domain/user.js';
import { SessionsRepository } from '../data/sessions.repository.js';
import {
  LOGIN_FAILED_EVENT,
  SESSION_CREATED_EVENT,
  SESSION_REVOKED_EVENT,
  type LoginFailedEvent,
  type SessionCreatedEvent,
  type SessionRevokedEvent,
} from '../domain/identity.events.js';
import { isSessionValid, type Session } from '../domain/session.js';
import { SessionTokenService } from '../domain/session-token.service.js';

/**
 * Authentication application service (docs/modules.md §Identity, ADR-0007).
 *
 * Orchestrates: login, logout, session validation, cookie issuance, and
 * surfacing the current authenticated user. Sits between the transport
 * layer (controller + guard) and the data layer (SessionsRepository +
 * UsersService). Framework-free logic lives here; controllers stay thin.
 */
@Injectable()
export class AuthenticationService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly sessions: SessionsRepository,
    private readonly users: UsersService,
    private readonly tokens: SessionTokenService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------

  /**
   * Authenticate with username + password. On success:
   *   1. creates a server-side session (persisted, hashed token),
   *   2. issues the opaque httpOnly cookie,
   *   3. returns the safe user DTO.
   *
   * On ANY failure (unknown user, wrong password, disabled user) throws a
   * SINGLE generic `Unauthorized` so callers cannot distinguish the cause
   * (security.md §2, AR-24 — prevents username enumeration).
   *
   * The `Login.Failed` event is published with the real reason so future
   * Audit/lockout infrastructure can act on it (event consumers are trusted,
   * the client response is not).
   */
  async login(
    params: { username: string; password: string },
    ctx: { req: Request; res: Response },
  ): Promise<UserDto> {
    const username = params.username.trim();
    const ip = this.clientIp(ctx.req);
    const userAgent = this.userAgent(ctx.req);

    // 1+2. Locate user + verify password (timing-safe against unknown users).
    //    Returns a failure reason for AUDIT ONLY — never sent to the client.
    const { user, failureReason } = await this.users.verifyCredentials(
      username,
      params.password,
    );

    if (user === null) {
      const reason = failureReason ?? 'invalid_credentials';

      const event: LoginFailedEvent = {
        type: LOGIN_FAILED_EVENT,
        payload: { username, reason, ip },
        correlationId: getCorrelationId(),
        occurredAt: Date.now(),
      };
      await this.events.publish(event);

      this.logger.warn(
        'Login failed',
        { username, reason },
        AuthenticationService.name,
      );

      // Generic message — identical for every failure (AR-24).
      throw AppException.unauthorized('Invalid username or password.');
    }

    // 5. Create session.
    //
    // Session fixation defense: if the request already presents a session
    // cookie (e.g. from a previous, now-expired session) we ignore it — a
    // fresh token + cookie is always issued on successful login. We do NOT
    // revoke the old session here because logout already handles that; if
    // the presented cookie maps to a still-valid session belonging to a
    // DIFFERENT user that situation is harmless: we just overwrite the
    // cookie with a new session for the newly-authenticated user.
    const rawToken = this.tokens.generateToken();
    const tokenHash = this.tokens.hashToken(rawToken);
    const now = new Date();
    const session = await this.sessions.create({
      id: generateId(),
      userId: user.id,
      tokenHash,
      userAgent,
      ipAddress: ip,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(
        now.getTime() + this.config.auth.sessionIdleTimeoutMs,
      ),
      absoluteExpiresAt: new Date(
        now.getTime() + this.config.auth.sessionAbsoluteTimeoutMs,
      ),
    });

    // 6. Set cookie.
    this.issueSessionCookie(ctx.res, rawToken, session);

    // Set the principal on the request context so downstream handlers see it.
    setPrincipal({ userId: user.id, sessionId: session.id });

    // 7. Emit event + return safe user DTO.
    const created: SessionCreatedEvent = {
      type: SESSION_CREATED_EVENT,
      aggregateType: 'UserSession',
      aggregateId: session.id,
      payload: {
        sessionId: session.id,
        userId: user.id,
        username: user.username,
        ip,
      },
      correlationId: getCorrelationId(),
      occurredAt: Date.now(),
    };
    await this.events.publish(created);

    this.logger.log(
      'Login succeeded',
      { userId: user.id, sessionId: session.id },
      AuthenticationService.name,
    );

    return toUserDto(user);
  }

  // ---------------------------------------------------------------------------
  // Logout
  // ---------------------------------------------------------------------------

  /**
   * Revoke the current session server-side (ADR-0007). Safe to call
   * repeatedly: if there is no session, no error is thrown (idempotent).
   * After logout, replaying the same cookie will fail validation.
   */
  async logout(ctx: { req: Request; res: Response }): Promise<void> {
    const session = await this.resolveSessionFromRequest(ctx.req);
    if (session === null) {
      // Clear any stray cookie and return — logout is idempotent.
      this.clearSessionCookie(ctx.res);
      return;
    }
    const now = new Date();
    await this.sessions.revoke(session.id, now);

    const revoked: SessionRevokedEvent = {
      type: SESSION_REVOKED_EVENT,
      aggregateType: 'UserSession',
      aggregateId: session.id,
      payload: {
        sessionId: session.id,
        userId: session.userId,
        reason: 'logout',
      },
      correlationId: getCorrelationId(),
      occurredAt: now.getTime(),
    };
    await this.events.publish(revoked);

    this.clearSessionCookie(ctx.res);
    this.logger.log(
      'Logout',
      { userId: session.userId, sessionId: session.id },
      AuthenticationService.name,
    );
  }

  // ---------------------------------------------------------------------------
  // Session validation (used by the auth guard)
  // ---------------------------------------------------------------------------

  /**
   * Resolve the authenticated session + user for an incoming request.
   *
   * Returns `null` if any of the following hold:
   *   - no session cookie,
   *   - session not found (forged / purged),
   *   - session revoked,
   *   - idle/absolute expiry exceeded,
   *   - user no longer active.
   *
   * On success the sliding-expiry deadline is refreshed (touch) and the
   * principal is attached to the request context.
   */
  async authenticateRequest(
    req: Request,
  ): Promise<AuthenticatedContext | null> {
    const session = await this.resolveSessionFromRequest(req);
    if (session === null) return null;

    const now = new Date();
    if (!isSessionValid(session, now)) {
      // If it's expired (not revoked), emit an audit event.
      if (session.revokedAt === null) {
        const evt: SessionRevokedEvent = {
          type: SESSION_REVOKED_EVENT,
          aggregateType: 'UserSession',
          aggregateId: session.id,
          payload: {
            sessionId: session.id,
            userId: session.userId,
            reason: 'expired',
          },
          correlationId: getCorrelationId(),
          occurredAt: now.getTime(),
        };
        // Fire-and-forget; don't block the response on event dispatch.
        void this.events.publish(evt);
      }
      return null;
    }

    const user = await this.users.findActiveById(session.userId);
    if (user === null) {
      // User has been disabled/deleted since the session was created —
      // revoke it so replay is impossible.
      await this.sessions.revoke(session.id, now);
      const evt: SessionRevokedEvent = {
        type: SESSION_REVOKED_EVENT,
        aggregateType: 'UserSession',
        aggregateId: session.id,
        payload: {
          sessionId: session.id,
          userId: session.userId,
          reason: 'user_disabled',
        },
        correlationId: getCorrelationId(),
        occurredAt: now.getTime(),
      };
      void this.events.publish(evt);
      return null;
    }

    // Sliding expiry: bump lastSeenAt + idle deadline.
    // Fire-and-forget is acceptable here — a missed bump only shortens the
    // session, and we do NOT want a slow write to delay the response. Any
    // failure is logged but never breaks the authenticated request (the
    // session is already valid; the touch is a best-effort bookkeeping write).
    const newExpires = new Date(
      now.getTime() + this.config.auth.sessionIdleTimeoutMs,
    );
    Promise.resolve()
      .then(() =>
        this.sessions.touch(session.id, {
          lastSeenAt: now,
          expiresAt: newExpires,
        }),
      )
      .catch((error: Error) => {
        this.logger.warn(
          'Failed to refresh session lastSeenAt',
          { sessionId: session.id, error: error.message },
          AuthenticationService.name,
        );
      });

    const principal = { userId: user.id, sessionId: session.id };
    setPrincipal(principal);

    return { user, session };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async resolveSessionFromRequest(
    req: Request,
  ): Promise<Session | null> {
    const rawToken = this.readCookie(req);
    if (rawToken === null) return null;
    const tokenHash = this.tokens.hashToken(rawToken);
    const session = await this.sessions.findByTokenHash(tokenHash);
    return session;
  }

  private readCookie(req: Request): string | null {
    const header = req.headers.cookie;
    if (typeof header !== 'string' || header.length === 0) return null;
    const name = this.config.auth.cookieName;
    // Tiny cookie parser — avoids adding a dependency for one header read.
    // Uses indexOf('=') / substring — robust against '=' in values, and
    // wraps decodeURIComponent in a try/catch so malformed cookies don't
    // crash the request pipeline (AR-24).
    const pairs = header.split(';');
    for (const pair of pairs) {
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const key = pair.slice(0, eq).trim();
      if (key !== name) continue;
      const raw = pair.slice(eq + 1).trim();
      if (raw.length === 0) return null;
      try {
        return decodeURIComponent(raw);
      } catch {
        // Malformed encoding — treat as no valid cookie rather than 500.
        return null;
      }
    }
    return null;
  }

  private issueSessionCookie(
    res: Response,
    rawToken: string,
    session: Session,
  ): void {
    const { cookieName, cookiePath, cookieSecure, cookieSameSite } =
      this.config.auth;
    // `res.cookie({ maxAge })` is MILLISECONDS (Express converts it to the
    // `Max-Age` seconds directive itself). Dividing by 1000 here previously
    // shortened every session cookie by a factor of 1000 — with the default
    // 12-hour absolute cap the browser dropped the cookie after ~43 seconds,
    // so an ordinary working session appeared to log the user out at random
    // even though the server-side session was still perfectly valid.
    //
    // The cookie lifetime is the ABSOLUTE cap; idle expiry stays server-side
    // (and is slid forward on every authenticated request), so an active user
    // is never signed out before the cap and an idle one still expires.
    const maxAgeMs = Math.max(
      0,
      session.absoluteExpiresAt.getTime() - Date.now(),
    );
    res.cookie(cookieName, rawToken, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSameSite === 'none' ? 'none' : cookieSameSite,
      path: cookiePath,
      maxAge: maxAgeMs,
      // Do NOT set `domain` unless explicitly configured later: leaving it
      // off defaults to the current host (most-restrictive).
    });
  }

  private clearSessionCookie(res: Response): void {
    const { cookieName, cookiePath, cookieSecure, cookieSameSite } =
      this.config.auth;
    res.clearCookie(cookieName, {
      path: cookiePath,
      secure: cookieSecure,
      sameSite: cookieSameSite === 'none' ? 'none' : cookieSameSite,
      httpOnly: true,
    });
  }

  private clientIp(req: Request): string | null {
    return typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : null;
  }

  private userAgent(req: Request): string | null {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' && ua.length > 0 ? ua.slice(0, 500) : null;
  }
}

export interface AuthenticatedContext {
  user: User;
  session: Session;
}
