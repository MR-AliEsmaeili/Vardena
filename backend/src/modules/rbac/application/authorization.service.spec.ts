import { describe, expect, it } from 'vitest';
import {
  runWithRequestContext,
  type RequestContext,
} from '../../../kernel/correlation/request-context.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import {
  createInMemoryStores,
  seedUser,
} from '../../../../test/support/in-memory-repositories.js';
import { AuthorizationService } from './authorization.service.js';

const USER = 'user-1';
const NOBODY = 'user-unknown';

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

function contextFor(userId?: string): RequestContext {
  return userId === undefined
    ? { correlationId: 'corr-1' }
    : { correlationId: 'corr-1', principal: { userId, sessionId: 'sess-1' } };
}

/**
 * Fixture with three permissions and a helper that grants them to a user via
 * roles — the same path the API uses, so evaluation is exercised end-to-end
 * (registry → mirror → role → assignment → check).
 */
async function buildFixture(): Promise<{
  authorization: AuthorizationService;
  grant: (userId: string, roleName: string, codes: string[]) => Promise<string>;
  revokePermission: (roleId: string, code: string) => Promise<boolean>;
}> {
  const stores = createInMemoryStores();
  await seedUser(stores, { id: USER, username: 'alice' });
  const authorization = new AuthorizationService(
    stores.userRoles,
    loggerStub(),
  );

  const permissionId = async (code: string): Promise<string> => {
    await stores.raw.permissions.syncDefinitions(
      [{ code, description: code }],
      new Date(),
    );
    const found = await stores.raw.permissions.findByCode(code);
    if (found === null) throw new Error(`fixture: permission ${code} missing`);
    return found.id;
  };

  return {
    authorization,
    async grant(userId, roleName, codes) {
      const permissionIds: string[] = [];
      for (const code of codes) permissionIds.push(await permissionId(code));
      const role = await stores.raw.roles.createWithPermissions({
        id: `role-${roleName}`,
        name: roleName,
        description: null,
        permissionIds,
        now: new Date(),
        createdBy: null,
      });
      await stores.raw.userRoles.assign({
        userId,
        roleId: role.id,
        now: new Date(),
        createdBy: null,
      });
      return role.id;
    },
    async revokePermission(roleId, code) {
      return stores.raw.roles.removePermission(
        roleId,
        await permissionId(code),
      );
    },
  };
}

describe('AuthorizationService', () => {
  it('computes effective permissions as the union over the user roles', async () => {
    const { authorization, grant } = await buildFixture();
    await grant(USER, 'Role A', ['Users.User.View', 'Users.User.Create']);
    await grant(USER, 'Role B', ['Users.User.View']);

    // Two roles both granting Users.User.View still yield one entry.
    await expect(authorization.effectivePermissionCodes(USER)).resolves.toEqual(
      ['Users.User.Create', 'Users.User.View'],
    );
    await expect(
      authorization.effectivePermissionCodes(NOBODY),
    ).resolves.toEqual([]);
  });

  it('hasAllPermissions requires EVERY code; hasAnyPermission requires one', async () => {
    const { authorization, grant } = await buildFixture();
    await grant(USER, 'Role A', ['Users.User.View', 'Users.User.Create']);

    await expect(
      authorization.hasAllPermissions(USER, [
        'Users.User.View',
        'Users.User.Create',
      ]),
    ).resolves.toBe(true);
    await expect(
      authorization.hasAllPermissions(USER, [
        'Users.User.View',
        'Rbac.Role.View',
      ]),
    ).resolves.toBe(false);
    await expect(
      authorization.hasAnyPermission(USER, [
        'Rbac.Role.View',
        'Users.User.View',
      ]),
    ).resolves.toBe(true);
    await expect(
      authorization.hasAnyPermission(USER, ['Rbac.Role.View']),
    ).resolves.toBe(false);
    await expect(authorization.hasAllPermissions(USER, [])).resolves.toBe(true);
  });

  it('reads current state on every call: removing a permission revokes it immediately', async () => {
    const { authorization, grant, revokePermission } = await buildFixture();
    const roleId = await grant(USER, 'Role A', ['Users.User.Create']);

    await expect(
      authorization.hasAllPermissions(USER, ['Users.User.Create']),
    ).resolves.toBe(true);
    await revokePermission(roleId, 'Users.User.Create');
    await expect(
      authorization.hasAllPermissions(USER, ['Users.User.Create']),
    ).resolves.toBe(false);
    await expect(authorization.effectivePermissionCodes(USER)).resolves.toEqual(
      [],
    );
  });

  it('requireAllPermissions is a no-op outside a request context (system context)', async () => {
    const { authorization } = await buildFixture();
    await expect(
      authorization.requireAllPermissions(['Users.User.Delete']),
    ).resolves.toBeUndefined();
  });

  it('requireAllPermissions throws 401 for an anonymous request', async () => {
    const { authorization } = await buildFixture();
    await runWithRequestContext(contextFor(), async () => {
      await expect(
        authorization.requireAllPermissions(['Users.User.View']),
      ).rejects.toMatchObject({ code: 'Unauthorized' });
    });
  });

  it('requireAllPermissions throws 403 (PermissionDenied) when a code is missing', async () => {
    const { authorization, grant } = await buildFixture();
    await grant(USER, 'Role A', ['Users.User.View']);

    await runWithRequestContext(contextFor(USER), async () => {
      await expect(
        authorization.requireAllPermissions([
          'Users.User.View',
          'Rbac.Role.View',
        ]),
      ).rejects.toMatchObject({ code: 'PermissionDenied' });
    });
  });

  it('requireAllPermissions resolves for a principal holding every code', async () => {
    const { authorization, grant } = await buildFixture();
    await grant(USER, 'Role A', ['Users.User.View', 'Users.User.Create']);

    await runWithRequestContext(contextFor(USER), async () => {
      await expect(
        authorization.requireAllPermissions([
          'Users.User.View',
          'Users.User.Create',
        ]),
      ).resolves.toBeUndefined();
    });
  });
});
