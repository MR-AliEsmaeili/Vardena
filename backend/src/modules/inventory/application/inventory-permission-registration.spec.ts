import { describe, expect, it } from 'vitest';
import { PermissionRegistry } from '../../rbac/application/permission-registry.js';
import { KARDEX_PERMISSIONS } from '../domain/inventory-kardex-permissions.js';
import { InventoryPermissionRegistration } from './inventory-permission-registration.js';

describe('InventoryPermissionRegistration', () => {
  it('registers the dedicated quantity Kardex permission', () => {
    const registry = new PermissionRegistry();
    new InventoryPermissionRegistration(registry).onModuleInit();

    expect(registry.has(KARDEX_PERMISSIONS.VIEW)).toBe(true);
  });
});
