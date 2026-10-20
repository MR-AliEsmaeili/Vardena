import { describe, expect, it, vi } from 'vitest';
import type { InstallationLicense } from '../domain/license.js';
import type { LicenseProvider } from './license-provider.js';
import { LicensingService } from './licensing.service.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { PermissionRegistry } from '../../rbac/application/permission-registry.js';
import { PermissionsService } from '../../rbac/application/permissions.service.js';
import type { UserRolesRepository } from '../../rbac/data/user-roles.repository.js';
import type { PermissionsRepository } from '../../rbac/data/permissions.repository.js';
import type { JsonLogger } from '../../../kernel/logging/json-logger.service.js';

function licensing(
  modules: string[],
  status: InstallationLicense['status'] = 'ACTIVE',
): LicensingService {
  const provider: LicenseProvider = {
    getLicense: async () => ({
      customerId: 'customer-a',
      customerCode: 'CUST-A',
      installationId: 'installation-a',
      licenseId: 'license-a',
      status,
      validFrom: new Date('2020-01-01T00:00:00Z'),
      validUntil: null,
      organizationLimit: null,
      userLimit: null,
      deviceLimit: null,
      deviceLimitSpecified: false,
      provider: 'test',
      revokedAt: null,
      entitlements: modules.map((code) => ({ kind: 'MODULE' as const, code })),
    }),
  };
  return new LicensingService(provider);
}

const logger = { warn: vi.fn() } as unknown as JsonLogger;

describe('License → RBAC integration', () => {
  it('licensed assignment plus role storage can be effective while stale unlicensed assignment is ineffective', async () => {
    const stored = ['Accounting.Account.View', 'Inventory.Item.View'];
    const roles = {
      listPermissionCodesForUser: vi.fn().mockResolvedValue(stored),
    } as unknown as UserRolesRepository;
    const authorization = new AuthorizationService(
      roles,
      logger,
      licensing(['accounting']),
    );
    await expect(
      authorization.effectivePermissionCodes('user-a'),
    ).resolves.toEqual(['Accounting.Account.View']);
    await expect(
      authorization.hasAllPermissions('user-a', ['Accounting.Account.View']),
    ).resolves.toBe(true);
    await expect(
      authorization.hasAnyPermission('user-a', ['Inventory.Item.View']),
    ).resolves.toBe(false);
    expect(stored).toEqual(['Accounting.Account.View', 'Inventory.Item.View']);
  });

  it('an inactive license denies access even when the RBAC assignment remains stored', async () => {
    const roles = {
      listPermissionCodesForUser: vi
        .fn()
        .mockResolvedValue(['Accounting.Account.View']),
    } as unknown as UserRolesRepository;
    const authorization = new AuthorizationService(
      roles,
      logger,
      licensing(['accounting'], 'SUSPENDED'),
    );
    await expect(
      authorization.effectivePermissionCodes('user-a'),
    ).resolves.toEqual([]);
  });

  it('rejects assigning an unlicensed registered permission at the backend boundary', async () => {
    const registry = new PermissionRegistry();
    registry.register([
      { code: 'Accounting.Account.View', description: 'view accounts' },
      { code: 'Inventory.Item.View', description: 'view items' },
    ]);
    const repository = {
      findByCode: vi.fn(async (code: string) => ({
        id: code,
        code,
        description: code,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    } as unknown as PermissionsRepository;
    const permissions = new PermissionsService(
      registry,
      repository,
      licensing(['accounting']),
    );
    await expect(
      permissions.resolveAssignablePermission('Accounting.Account.View'),
    ).resolves.toMatchObject({ code: 'Accounting.Account.View' });
    await expect(
      permissions.resolveAssignablePermission('Inventory.Item.View'),
    ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
  });
});
