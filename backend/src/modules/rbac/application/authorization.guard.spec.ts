import { licensingTestDouble } from '../../../../test/support/licensing.js';
import {
  InternalServerErrorException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import {
  runWithRequestContext,
  type RequestContext,
} from '../../../kernel/correlation/request-context.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import {
  createInMemoryStores,
  seedUser,
} from '../../../../test/support/in-memory-repositories.js';
import { AuthorizationGuard } from './authorization.guard.js';
import { AuthorizationService } from './authorization.service.js';

const USER_WITH = 'user-with';
const USER_WITHOUT = 'user-without';
const GRANTED = 'Users.User.View';
const REQUIRED = ['Users.User.View'];

interface Harness {
  guard: AuthorizationGuard;
  warn: ReturnType<typeof vi.fn>;
  setRequired: (codes: string[] | undefined) => void;
}

function loggerStub(warn?: ReturnType<typeof vi.fn>): JsonLogger {
  return {
    log: () => {},
    warn: warn ?? (() => {}),
    error: () => {},
  } as unknown as JsonLogger;
}

function context(): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', url: '/api/v1/users' }),
    }),
  } as unknown as ExecutionContext;
}

function httpContext(principal?: {
  userId: string;
  sessionId: string;
}): RequestContext {
  return principal === undefined
    ? { correlationId: 'corr-1' }
    : { correlationId: 'corr-1', principal };
}

async function buildHarness(): Promise<Harness> {
  const stores = createInMemoryStores();
  await seedUser(stores, { id: USER_WITH, username: 'granted' });
  await seedUser(stores, { id: USER_WITHOUT, username: 'denied' });
  const warn = vi.fn();
  const authorization = new AuthorizationService(
    stores.userRoles,
    loggerStub(warn),
    licensingTestDouble(),
  );

  const synced = await stores.raw.permissions.syncDefinitions(
    [{ code: GRANTED, description: 'View users' }],
    new Date(),
  );
  void synced;
  const permission = await stores.raw.permissions.findByCode(GRANTED);
  const role = await stores.raw.roles.createWithPermissions({
    id: 'role-viewer',
    name: 'Viewer',
    description: null,
    permissionIds: permission === null ? [] : [permission.id],
    now: new Date(),
    createdBy: null,
  });
  await stores.raw.userRoles.assign({
    userId: USER_WITH,
    roleId: role.id,
    now: new Date(),
    createdBy: null,
  });

  let required: string[] | undefined = REQUIRED;
  const reflector = {
    getAllAndOverride: () => required,
  } as unknown as Reflector;

  return {
    guard: new AuthorizationGuard(reflector, authorization, loggerStub(warn)),
    warn,
    setRequired: (codes) => {
      required = codes;
    },
  };
}

describe('AuthorizationGuard', () => {
  it('fails closed (500) when a route declares no permission', async () => {
    const harness = await buildHarness();
    harness.setRequired(undefined);
    await expect(harness.guard.canActivate(context())).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );

    harness.setRequired([]);
    await expect(harness.guard.canActivate(context())).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('throws 401 for an anonymous request that declares a permission', async () => {
    const harness = await buildHarness();
    await runWithRequestContext(httpContext(), async () => {
      await expect(harness.guard.canActivate(context())).rejects.toMatchObject({
        code: 'Unauthorized',
      });
    });
  });

  it('throws 403 with a generic message when the principal lacks the permission', async () => {
    const harness = await buildHarness();
    await runWithRequestContext(
      httpContext({ userId: USER_WITHOUT, sessionId: 'sess-2' }),
      async () => {
        await expect(
          harness.guard.canActivate(context()),
        ).rejects.toMatchObject({
          code: 'PermissionDenied',
          message: 'You do not have permission to perform this action.',
        });
      },
    );
    expect(harness.warn).toHaveBeenCalledTimes(1);
  });

  it('requires EVERY declared code: holding only one of two is a 403 (ALL semantics)', async () => {
    const harness = await buildHarness();
    harness.setRequired([GRANTED, 'Users.User.Create']);

    await runWithRequestContext(
      httpContext({ userId: USER_WITH, sessionId: 'sess-1' }),
      async () => {
        await expect(
          harness.guard.canActivate(context()),
        ).rejects.toMatchObject({
          code: 'PermissionDenied',
        });
      },
    );
  });

  it('allows the request when the principal holds every required code', async () => {
    const harness = await buildHarness();
    await runWithRequestContext(
      httpContext({ userId: USER_WITH, sessionId: 'sess-1' }),
      async () => {
        await expect(harness.guard.canActivate(context())).resolves.toBe(true);
      },
    );
    expect(harness.warn).not.toHaveBeenCalled();
  });
});
