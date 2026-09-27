import { describe, expect, it } from 'vitest';
import { runWithRequestContext } from '../../../kernel/correlation/request-context.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import {
  createInMemoryStores,
  seedUser,
} from '../../../../test/support/in-memory-repositories.js';
import { AuthorizationService } from './authorization.service.js';
import { PermissionRegistry } from './permission-registry.js';
import { PermissionSyncService } from './permission-sync.service.js';
import { SystemAdministratorRbacService } from './system-administrator-rbac.service.js';

/**
 * The future permission reconciliation contract (Task 26 follow-up).
 *
 * The architectural invariant under test: the `System Administrator` role is
 * derived from the canonical `PermissionRegistry`, so a permission registered
 * by a FUTURE module reaches `مدیر` on the next deployment run of
 * `bootstrap:system-admin` — with no administrator permission list, no
 * hardcoded count, no wildcard and no username/role-name rule.
 *
 * Every expectation below is computed from the registry, never from a literal
 * number, so the test stays valid as modules add permissions.
 */

const ADMIN = '01K6D3Q8GH0K97M5DFYBTZ8V7P';

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

function buildFixture() {
  const stores = createInMemoryStores();
  const registry = new PermissionRegistry();
  const sync = new PermissionSyncService(
    registry,
    stores.permissions,
    loggerStub(),
  );
  const service = new SystemAdministratorRbacService(
    registry,
    sync,
    stores.permissions,
    stores.roles,
  );
  const authorization = new AuthorizationService(
    stores.userRoles,
    loggerStub(),
  );
  return { stores, registry, service, authorization };
}

describe('System Administrator permission reconciliation contract', () => {
  it('derives the administrator role from the registry, never from a fixed count', async () => {
    const { stores, registry, service, authorization } = buildFixture();
    registry.register([
      { code: 'Users.User.View', description: 'View users.' },
      { code: 'Inventory.Item.View', description: 'View items.' },
    ]);
    await seedUser(stores, { id: ADMIN });

    const result = await service.ensureForUser(ADMIN);

    expect(result.permissionCount).toBe(registry.size);
    const effective = await stores.userRoles.listPermissionCodesForUser(ADMIN);
    expect([...effective].sort()).toEqual(
      registry
        .all()
        .map(({ code }) => code)
        .sort(),
    );
    // Ordinary RBAC evaluation, resolved by code — not by role or user name.
    await expect(
      authorization.hasAllPermissions(ADMIN, ['Users.User.View']),
    ).resolves.toBe(true);
    // No wildcard is ever mirrored or assigned.
    expect(effective).not.toContain('*');
    expect(effective.some((code) => code.includes('*'))).toBe(false);
  });

  it('adds a permission registered by a future module to the EXISTING administrator role on the next reconciliation', async () => {
    const { stores, registry, service, authorization } = buildFixture();
    registry.register([
      { code: 'Users.User.View', description: 'View users.' },
      { code: 'Inventory.Item.View', description: 'View items.' },
    ]);
    await seedUser(stores, { id: ADMIN });
    const first = await service.ensureForUser(ADMIN);

    // A future module (e.g. Sales) registers a new protected capability. It is
    // NOT added to any administrator list anywhere — only to the registry.
    registry.register([
      { code: 'Sales.Invoice.Export', description: 'Export invoices.' },
    ]);
    await expect(
      authorization.hasAllPermissions(ADMIN, ['Sales.Invoice.Export']),
    ).resolves.toBe(false);

    const second = await service.ensureForUser(ADMIN);

    // Same role, same assignment — only the missing grant is added.
    expect(second.roleId).toBe(first.roleId);
    expect(second.roleCreated).toBe(false);
    expect(second.userRoleCreated).toBe(false);
    expect(second.permissionCount).toBe(registry.size);
    expect(second.permissionCount).toBe(first.permissionCount + 1);
    await expect(
      authorization.hasAllPermissions(ADMIN, ['Sales.Invoice.Export']),
    ).resolves.toBe(true);
    await expect(
      authorization.hasAllPermissions(ADMIN, ['Users.User.View']),
    ).resolves.toBe(true);
  });

  it('keeps unrelated permissions granted to the administrator role by an operator', async () => {
    const { stores, registry, service } = buildFixture();
    registry.register([{ code: 'Users.User.View', description: 'View.' }]);
    await seedUser(stores, { id: ADMIN });
    const first = await service.ensureForUser(ADMIN);

    // An operator-granted extra permission that the registry does not contain.
    await stores.permissions.syncDefinitions(
      [{ code: 'Local.Custom.Do', description: 'Operator grant.' }],
      new Date(),
    );
    const [extra] = await stores.permissions.findByCodes(['Local.Custom.Do']);
    await stores.roles.addPermission({
      roleId: first.roleId,
      permissionId: extra!.id,
      now: new Date(),
      createdBy: null,
    });

    await service.ensureForUser(ADMIN);

    // Reconciliation only ADDS the registered catalog; it removes nothing.
    expect(stores.raw.roles.isPermissionAssigned(first.roleId, extra!.id)).toBe(
      true,
    );
  });

  it('denies an unregistered capability, proving authority comes from grants and not from the role name', async () => {
    const { stores, registry, service, authorization } = buildFixture();
    registry.register([{ code: 'Users.User.View', description: 'View.' }]);
    await seedUser(stores, { id: ADMIN });
    await service.ensureForUser(ADMIN);

    const role = await stores.roles.findByName('System Administrator');
    expect(role).not.toBeNull();
    // The role is literally named 'System Administrator' and the caller is the
    // bootstrap user, yet a code it does not hold is denied.
    await expect(
      authorization.hasAllPermissions(ADMIN, ['Sales.Invoice.Export']),
    ).resolves.toBe(false);
    // ...and the real request-path check denies it too.
    await expect(
      runWithRequestContext(
        {
          correlationId: 'corr-1',
          principal: { userId: ADMIN, sessionId: 's' },
        },
        () => authorization.requireAllPermissions(['Sales.Invoice.Export']),
      ),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });
  });
});
