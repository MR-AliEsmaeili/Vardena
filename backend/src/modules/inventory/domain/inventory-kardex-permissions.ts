import type { PermissionDefinition } from '../../rbac/domain/permission-definition.js';

/** Permission codes owned by the quantity-only Inventory Kardex read surface. */
export const KARDEX_PERMISSIONS = {
  VIEW: 'Inventory.Kardex.View',
} as const;

export const INVENTORY_KARDEX_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] =
  [
    {
      code: KARDEX_PERMISSIONS.VIEW,
      description:
        'View the quantity Kardex for one item and warehouse, including ledger-derived running quantities.',
    },
  ];
