import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import {
  ALLOW_WHEN_PASSWORD_CHANGE_REQUIRED_METADATA,
  AuthGuard,
} from './auth.guard.js';
import { AuthenticationService } from './authentication.service.js';
import { runWithRequestContext } from '../../../kernel/correlation/request-context.js';

describe('AuthGuard', () => {
  function buildContext({
    hasSession,
    mustChangePassword = false,
    allowWhenRestricted = false,
  }: {
    hasSession: boolean;
    mustChangePassword?: boolean;
    allowWhenRestricted?: boolean;
  }): {
    ctx: ExecutionContext;
    auth: AuthenticationService;
    reflector: Reflector;
  } {
    const auth = {
      authenticateRequest: vi.fn().mockResolvedValue(
        hasSession
          ? {
              user: { id: 'u', mustChangePassword },
              session: { id: 's' },
            }
          : null,
      ),
    } as unknown as AuthenticationService;

    const reflector = {
      getAllAndOverride: vi.fn((key: string) =>
        key === ALLOW_WHEN_PASSWORD_CHANGE_REQUIRED_METADATA
          ? allowWhenRestricted
          : undefined,
      ),
    } as unknown as Reflector;

    const req = {};
    const res = {};
    const http = {
      getRequest: () => req,
      getResponse: () => res,
    };
    const ctx = {
      switchToHttp: () => http,
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
    return { ctx, auth, reflector };
  }

  it('allows the request when a valid session is present', async () => {
    const { ctx, auth, reflector } = buildContext({ hasSession: true });
    const guard = new AuthGuard(auth, reflector);
    await runWithRequestContext({ correlationId: 'c' }, async () => {
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  it('throws Unauthorized when no valid session is present', async () => {
    const { ctx, auth, reflector } = buildContext({ hasSession: false });
    const guard = new AuthGuard(auth, reflector);
    await runWithRequestContext({ correlationId: 'c' }, async () => {
      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        code: 'Unauthorized',
      });
    });
  });

  it('blocks ordinary protected routes with 403 PermissionDenied when mustChangePassword=true', async () => {
    const { ctx, auth, reflector } = buildContext({
      hasSession: true,
      mustChangePassword: true,
      allowWhenRestricted: false,
    });
    const guard = new AuthGuard(auth, reflector);
    await runWithRequestContext({ correlationId: 'c' }, async () => {
      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        code: 'PermissionDenied',
        details: { reason: 'password_change_required' },
      });
    });
  });

  it('allows routes decorated with @AllowWhenPasswordChangeRequired() when mustChangePassword=true', async () => {
    const { ctx, auth, reflector } = buildContext({
      hasSession: true,
      mustChangePassword: true,
      allowWhenRestricted: true,
    });
    const guard = new AuthGuard(auth, reflector);
    await runWithRequestContext({ correlationId: 'c' }, async () => {
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });
});
