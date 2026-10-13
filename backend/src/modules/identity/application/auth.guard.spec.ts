import { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthGuard } from './auth.guard.js';
import { AuthenticationService } from './authentication.service.js';
import { runWithRequestContext } from '../../../kernel/correlation/request-context.js';

describe('AuthGuard', () => {
  function buildContext({ hasSession }: { hasSession: boolean }): {
    ctx: ExecutionContext;
    auth: AuthenticationService;
  } {
    const auth = {
      authenticateRequest: vi
        .fn()
        .mockResolvedValue(
          hasSession ? { user: { id: 'u' }, session: { id: 's' } } : null,
        ),
    } as unknown as AuthenticationService;

    const req = {};
    const res = {};
    const http = {
      getRequest: () => req,
      getResponse: () => res,
    };
    const ctx = {
      switchToHttp: () => http,
    } as unknown as ExecutionContext;
    return { ctx, auth };
  }

  it('allows the request when a valid session is present', async () => {
    const { ctx, auth } = buildContext({ hasSession: true });
    const guard = new AuthGuard(auth);
    await runWithRequestContext({ correlationId: 'c' }, async () => {
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  it('throws Unauthorized when no valid session is present', async () => {
    const { ctx, auth } = buildContext({ hasSession: false });
    const guard = new AuthGuard(auth);
    await runWithRequestContext({ correlationId: 'c' }, async () => {
      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        code: 'Unauthorized',
      });
    });
  });
});
