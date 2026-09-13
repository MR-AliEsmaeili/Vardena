import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { loadAppConfig } from '../../../kernel/config/app-config.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { DeploymentOrganizationScopeGuard } from './deployment-scope.guard.js';
import { DEPLOYMENT_SCOPE_PATH_PARAM } from './deployment-scope.decorator.js';

/**
 * Deployment organization pin guard (ADR-0025). These tests pin the
 * authorization decision itself — every request naming an organization must
 * name the pinned one, and the pin is a complete no-op while unset (the
 * ADR-0021 structural-scoping era).
 */

const PIN = '01M2D8QVMY3ZQ1J5APCH7S5J00';
const OTHER = '01M2D8QVMY3ZQ1J5APCH7S5J01';
const VALID_DB = 'postgresql://vardena:secret@localhost:5432/vardena';

interface HarnessParts {
  pin: string | null;
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
  pathParam?: string;
}

function harness(parts: HarnessParts): {
  check: DeploymentOrganizationScopeGuard;
  context: ExecutionContext;
} {
  const reflector = new Reflector();
  // Only the path-param metadata the guard reads matters here; every other
  // lookup has no metadata in a hand-built context and resolves to undefined.
  reflector.getAllAndOverride = ((key: string | symbol) =>
    key === DEPLOYMENT_SCOPE_PATH_PARAM
      ? parts.pathParam
      : undefined) as unknown as typeof reflector.getAllAndOverride;
  const req = {
    body: parts.body ?? {},
    query: parts.query ?? {},
    params: parts.params ?? {},
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => class TestController {},
  } as unknown as ExecutionContext;
  const check = new DeploymentOrganizationScopeGuard(
    {
      ...loadAppConfig({ DATABASE_URL: VALID_DB }),
      deploymentOrganizationId: parts.pin,
    },
    reflector,
  );
  return { check, context };
}

/** Assert the guard answers an out-of-scope request with 404 EntityNotFound. */
function expect404(parts: HarnessParts): void {
  const { check, context } = harness(parts);
  try {
    check.canActivate(context);
  } catch (error) {
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).code).toBe('EntityNotFound');
    expect((error as AppException).getStatus()).toBe(404);
    return;
  }
  throw new Error('Expected the guard to throw, but it allowed the request.');
}

function allows(parts: HarnessParts): void {
  const { check, context } = harness(parts);
  expect(check.canActivate(context)).toBe(true);
}

describe('DeploymentOrganizationScopeGuard', () => {
  it('is a complete no-op while no pin is configured', () => {
    allows({
      pin: null,
      body: { organizationId: OTHER },
      query: { organizationId: OTHER },
    });
  });

  it('allows requests that name no organization (login, health, users, RBAC)', () => {
    allows({ pin: PIN });
  });

  it('allows a body organizationId equal to the pin', () => {
    allows({ pin: PIN, body: { organizationId: PIN } });
  });

  it('rejects a body organizationId outside the pin with 404', () => {
    expect404({ pin: PIN, body: { organizationId: OTHER } });
  });

  it('rejects a query organizationId outside the pin with 404', () => {
    expect404({ pin: PIN, query: { organizationId: OTHER } });
  });

  it('checks every value when organizationId is repeated in the query', () => {
    allows({ pin: PIN, query: { organizationId: [PIN, PIN] } });
    expect404({ pin: PIN, query: { organizationId: [PIN, OTHER] } });
  });

  it('confines marked organization-root routes through their path parameter', () => {
    allows({ pin: PIN, params: { id: PIN }, pathParam: 'id' });
    expect404({ pin: PIN, params: { id: OTHER }, pathParam: 'id' });
  });

  it('checks body, query and path parameter together', () => {
    allows({
      pin: PIN,
      body: { organizationId: PIN },
      query: { organizationId: PIN },
      params: { id: PIN },
      pathParam: 'id',
    });
    expect404({
      pin: PIN,
      body: { organizationId: PIN },
      query: { organizationId: OTHER },
    });
  });
});
