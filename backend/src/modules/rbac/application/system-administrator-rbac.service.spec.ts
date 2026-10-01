import { licensingTestDouble } from '../../../../test/support/licensing.js';
import { describe, expect, it, vi } from 'vitest';
import { PermissionsRepository } from '../data/permissions.repository.js';
import { RolesRepository } from '../data/roles.repository.js';
import { PermissionRegistry } from './permission-registry.js';
import { PermissionSyncService } from './permission-sync.service.js';
import {
  SYSTEM_ADMINISTRATOR_ROLE_NAME,
  SystemAdministratorRbacService,
} from './system-administrator-rbac.service.js';

const USER_ID = '01K6D3Q8GH0K97M5DFYBTZ8V7P';
const ROLE_ID = '01K6D3Q8GH0K97M5DFYBTZ8V7Q';

describe('SystemAdministratorRbacService', () => {
  it('assigns every and only currently registered permission through normal RBAC rows', async () => {
    const registry = new PermissionRegistry();
    registry.register([
      { code: 'Users.User.View', description: 'View users.' },
      { code: 'Inventory.Item.View', description: 'View items.' },
      { code: 'Accounting.Account.View', description: 'View accounts.' },
    ]);
    const sync = vi.fn().mockResolvedValue({
      created: 3,
      updated: 0,
      total: 3,
    });
    const findByCodes = vi.fn().mockImplementation((codes: string[]) =>
      Promise.resolve(
        codes.map((code, index) => ({
          id: `permission-${index}`,
          code,
          description: `${code} description`,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      ),
    );
    const ensureRoleWithPermissionsForUser = vi.fn().mockResolvedValue({
      role: {
        id: ROLE_ID,
        name: SYSTEM_ADMINISTRATOR_ROLE_NAME,
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
      },
      permissionCount: 3,
      roleCreated: true,
      userRoleCreated: true,
    });
    const service = new SystemAdministratorRbacService(
      registry,
      { sync } as unknown as PermissionSyncService,
      { findByCodes } as unknown as PermissionsRepository,
      {
        ensureRoleWithPermissionsForUser,
      } as unknown as RolesRepository,
      licensingTestDouble(),
    );

    await expect(service.ensureForUser(USER_ID)).resolves.toEqual({
      roleId: ROLE_ID,
      permissionCount: 3,
      roleCreated: true,
      userRoleCreated: true,
    });
    const registeredCodes = registry.all().map(({ code }) => code);
    expect(findByCodes).toHaveBeenCalledWith(registeredCodes);
    expect(ensureRoleWithPermissionsForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        roleName: SYSTEM_ADMINISTRATOR_ROLE_NAME,
        userId: USER_ID,
        permissionIds: ['permission-0', 'permission-1', 'permission-2'],
      }),
    );
  });

  it('fails closed when the permission mirror cannot be synchronized', async () => {
    const registry = new PermissionRegistry();
    registry.register([
      { code: 'Users.User.View', description: 'View users.' },
    ]);
    const ensureRoleWithPermissionsForUser = vi.fn();
    const service = new SystemAdministratorRbacService(
      registry,
      {
        sync: vi.fn().mockResolvedValue(null),
      } as unknown as PermissionSyncService,
      { findByCodes: vi.fn() } as unknown as PermissionsRepository,
      {
        ensureRoleWithPermissionsForUser,
      } as unknown as RolesRepository,
      licensingTestDouble(),
    );

    await expect(service.ensureForUser(USER_ID)).rejects.toThrow(
      'permission catalog could not be synchronized',
    );
    expect(ensureRoleWithPermissionsForUser).not.toHaveBeenCalled();
  });

  it('fails closed rather than creating a partial administrator role', async () => {
    const registry = new PermissionRegistry();
    registry.register([
      { code: 'Users.User.View', description: 'View users.' },
      { code: 'Rbac.Role.View', description: 'View roles.' },
    ]);
    const ensureRoleWithPermissionsForUser = vi.fn();
    const service = new SystemAdministratorRbacService(
      registry,
      {
        sync: vi.fn().mockResolvedValue({ created: 2, updated: 0, total: 2 }),
      } as unknown as PermissionSyncService,
      {
        findByCodes: vi.fn().mockResolvedValue([
          {
            id: 'permission-0',
            code: 'Users.User.View',
            description: 'View users.',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      } as unknown as PermissionsRepository,
      {
        ensureRoleWithPermissionsForUser,
      } as unknown as RolesRepository,
      licensingTestDouble(),
    );

    await expect(service.ensureForUser(USER_ID)).rejects.toThrow(
      '1 registered permission(s) are missing',
    );
    expect(ensureRoleWithPermissionsForUser).not.toHaveBeenCalled();
  });
});
