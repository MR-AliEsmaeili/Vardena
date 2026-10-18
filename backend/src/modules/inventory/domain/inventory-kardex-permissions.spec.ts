import { describe, expect, it } from 'vitest';
import { isValidPermissionCode } from '../../rbac/domain/permission-code.js';
import {
  INVENTORY_KARDEX_PERMISSION_DEFINITIONS,
  KARDEX_PERMISSIONS,
} from './inventory-kardex-permissions.js';

describe('Inventory quantity Kardex permission', () => {
  it('defines one dedicated, well-formed read permission', () => {
    expect(KARDEX_PERMISSIONS.VIEW).toBe('Inventory.Kardex.View');
    expect(INVENTORY_KARDEX_PERMISSION_DEFINITIONS).toHaveLength(1);
    expect(INVENTORY_KARDEX_PERMISSION_DEFINITIONS[0]).toMatchObject({
      code: 'Inventory.Kardex.View',
    });
    expect(isValidPermissionCode(KARDEX_PERMISSIONS.VIEW)).toBe(true);
  });
});
