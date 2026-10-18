import { describe, expect, it } from 'vitest';
import { licensingTestDouble } from '../../../../test/support/licensing.js';
import {
  runWithRequestContext,
  type RequestContext,
} from '../../../kernel/correlation/request-context.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AuthorizationService } from './authorization.service.js';

function svc(validUntil: Date | null) {
  const licensing = licensingTestDouble({ validUntil });
  const logger = {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
  // userRoles is unused on the system-context path exercised here.
  return new AuthorizationService(undefined as never, logger, licensing);
}

describe('OQ-45 system-context (worker/queued) enforcement', () => {
  it('refuses a mutation permission in READ_ONLY without an HTTP principal', async () => {
    // licensingTestDouble validFrom is 2020; expiry in the past => READ_ONLY now.
    const service = svc(new Date('2020-02-01T00:00:00.000Z'));
    await expect(
      service.requireAllPermissions(['Accounting.Document.Create']),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });
  });
  it('allows reads and active-license mutations in system context', async () => {
    await expect(
      svc(new Date('2020-02-01T00:00:00.000Z')).requireAllPermissions([
        'Accounting.Document.View',
      ]),
    ).resolves.toBeUndefined();
    await expect(
      svc(null).requireAllPermissions(['Accounting.Document.Create']),
    ).resolves.toBeUndefined();
  });
});

/**
 * OQ-45 / ADR-0049 at the HTTP boundary.
 *
 * The system-context suite above proves the queued-work defence. These cases
 * prove the same policy on the path every browser request takes:
 * `AuthorizationGuard` → `AuthorizationService.hasAllPermissions` →
 * `LicensingService.filterLicensedPermissions`. A role assignment is NOT
 * evidence of an effective permission — the license filter runs on every call,
 * with no cache, exactly as it does for the guard.
 */
/** Every module the development test license entitles. */
const ALL_MODULE_ENTITLEMENTS = [
  'accounting',
  'documents',
  'inventory',
  'organization',
  'rbac',
  'users',
  'workflow',
].map((code) => ({ kind: 'MODULE' as const, code }));

function svcForPrincipal(
  codes: readonly string[],
  validUntil: Date | null,
  entitlements: readonly {
    kind: 'MODULE';
    code: string;
  }[] = ALL_MODULE_ENTITLEMENTS,
) {
  const licensing = licensingTestDouble({ validUntil, entitlements });
  const logger = {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
  const userRoles = {
    listPermissionCodesForUser: async () => [...codes],
  } as never;
  return new AuthorizationService(userRoles, logger, licensing);
}

function principalContext(): RequestContext {
  return {
    correlationId: 'corr-readonly',
    principal: { userId: 'user-1', sessionId: 'session-1' },
  };
}

/** One day past the signed expiry: inside the 14-day window, so GRACE. */
const GRACE_VALID_UNTIL = new Date(Date.now() - 24 * 60 * 60 * 1000);
/** Far past the signed expiry: beyond 14x24h, so READ_ONLY. */
const READ_ONLY_VALID_UNTIL = new Date('2020-02-01T00:00:00.000Z');

describe('OQ-45 HTTP-context enforcement (effective permissions)', () => {
  it('refuses a mutation the principal holds when the license is READ_ONLY', async () => {
    const service = svcForPrincipal(
      ['Accounting.Document.Create'],
      READ_ONLY_VALID_UNTIL,
    );
    await runWithRequestContext(principalContext(), async () => {
      await expect(
        service.requireAllPermissions(['Accounting.Document.Create']),
      ).rejects.toMatchObject({ code: 'PermissionDenied' });
      // The assignment is not a permission: it is simply not effective.
      await expect(service.effectivePermissionCodes('user-1')).resolves.toEqual(
        [],
      );
    });
  });

  it('keeps entitled reads and the platform Licensing codes in READ_ONLY', async () => {
    const service = svcForPrincipal(
      [
        'Accounting.Document.View',
        'Accounting.Document.Create',
        'Licensing.License.Activate',
      ],
      READ_ONLY_VALID_UNTIL,
    );
    await runWithRequestContext(principalContext(), async () => {
      await expect(service.effectivePermissionCodes('user-1')).resolves.toEqual(
        ['Accounting.Document.View', 'Licensing.License.Activate'],
      );
      await expect(
        service.requireAllPermissions(['Accounting.Document.View']),
      ).resolves.toBeUndefined();
      await expect(
        service.requireAllPermissions(['Licensing.License.Activate']),
      ).resolves.toBeUndefined();
    });
  });

  it('keeps entitled mutations and reads during GRACE', async () => {
    const service = svcForPrincipal(
      ['Accounting.Document.Create', 'Accounting.Document.View'],
      GRACE_VALID_UNTIL,
    );
    await runWithRequestContext(principalContext(), async () => {
      await expect(service.effectivePermissionCodes('user-1')).resolves.toEqual(
        ['Accounting.Document.Create', 'Accounting.Document.View'],
      );
      await expect(
        service.requireAllPermissions(['Accounting.Document.Create']),
      ).resolves.toBeUndefined();
    });
  });

  it('grants nothing new in READ_ONLY: an unentitled module read stays refused', async () => {
    // The license entitles `accounting` only. `Rbac.Role.View` is a read code,
    // but Read-Only grants no entitlement the license does not already carry,
    // so the code stays ineffective rather than becoming a new grant.
    const service = svcForPrincipal(
      ['Rbac.Role.View', 'Accounting.Document.View'],
      READ_ONLY_VALID_UNTIL,
      [{ kind: 'MODULE' as const, code: 'accounting' }],
    );
    await runWithRequestContext(principalContext(), async () => {
      await expect(service.effectivePermissionCodes('user-1')).resolves.toEqual(
        ['Accounting.Document.View'],
      );
      await expect(
        service.requireAllPermissions(['Rbac.Role.View']),
      ).rejects.toMatchObject({ code: 'PermissionDenied' });
    });
  });

  it('keeps the previous platform-only behaviour for a BLOCKED license', async () => {
    const licensing = licensingTestDouble({
      validUntil: null,
      validFrom: new Date('2099-01-01T00:00:00.000Z'),
    });
    const logger = {
      log: () => {},
      warn: () => {},
      error: () => {},
    } as unknown as JsonLogger;
    const userRoles = {
      listPermissionCodesForUser: async () => [
        'Accounting.Document.View',
        'Accounting.Document.Create',
        'Licensing.License.Activate',
      ],
    } as never;
    const service = new AuthorizationService(userRoles, logger, licensing);

    await runWithRequestContext(principalContext(), async () => {
      await expect(service.effectivePermissionCodes('user-1')).resolves.toEqual(
        ['Licensing.License.Activate'],
      );
      await expect(
        service.requireAllPermissions(['Accounting.Document.View']),
      ).rejects.toMatchObject({ code: 'PermissionDenied' });
      await expect(
        service.requireAllPermissions(['Licensing.License.Activate']),
      ).resolves.toBeUndefined();
    });
  });
});
