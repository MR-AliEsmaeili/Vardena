import type { PermissionDefinition } from '../../rbac/domain/permission-definition.js';

/**
 * The Inventory module's master-data permissions (AR-22, ADR-0006).
 *
 * Only master data is covered here — the transactional half of the module
 * (receipts, issues, transfers, adjustments, stock queries) is future work and
 * brings its own permissions (`Inventory.Receipt.*` etc. from
 * docs/security.md §3).
 *
 * Codes follow `Module.Entity.Action` with the same action vocabulary as the
 * Users and Organization modules (`Edit`, plus separate `Enable`/`Disable`).
 *
 * `UnitConversion` deliberately has **no `Edit` and no `Enable`/`Disable`**:
 * conversions are effective-dated configuration, and ADR-0020 §4 /
 * master-data-strategy.md §7 forbid editing used configuration in place. The
 * only way to change a conversion is to create a new version, which is what
 * `Inventory.UnitConversion.Create` authorises. That is why the Task 6 brief's
 * `UnitConversion.Update` does not exist here — Task 5 wins.
 *
 * No `*.Delete` anywhere: master-data lifecycle is `is_active`
 * (master-data-strategy.md §7.4); deletion semantics are OQ-36.
 */

function lifecycle(
  entity: 'Item' | 'ItemGroup' | 'Unit' | 'Warehouse',
  label: string,
): {
  VIEW: string;
  CREATE: string;
  EDIT: string;
  ENABLE: string;
  DISABLE: string;
  definitions: readonly PermissionDefinition[];
} {
  const codes = {
    VIEW: `Inventory.${entity}.View`,
    CREATE: `Inventory.${entity}.Create`,
    EDIT: `Inventory.${entity}.Edit`,
    ENABLE: `Inventory.${entity}.Enable`,
    DISABLE: `Inventory.${entity}.Disable`,
  } as const;
  return {
    ...codes,
    definitions: [
      { code: codes.VIEW, description: `View ${label} records and lists.` },
      { code: codes.CREATE, description: `Create ${label} records.` },
      { code: codes.EDIT, description: `Edit ${label} records.` },
      {
        code: codes.ENABLE,
        description: `Re-enable a disabled ${label} record.`,
      },
      {
        code: codes.DISABLE,
        description: `Disable a ${label} record (blocks new usage, keeps history readable).`,
      },
    ],
  };
}

const ITEM = lifecycle('Item', 'item');
const ITEM_GROUP = lifecycle('ItemGroup', 'item group');
const UNIT = lifecycle('Unit', 'unit of measure');
const WAREHOUSE = lifecycle('Warehouse', 'warehouse');

/** Conversion versioning: read + create a new version. No in-place edit. */
const UNIT_CONVERSION = {
  VIEW: 'Inventory.UnitConversion.View',
  CREATE: 'Inventory.UnitConversion.Create',
  definitions: [
    {
      code: 'Inventory.UnitConversion.View',
      description:
        'View unit conversion versions (global and item-specific), including historical ones.',
    },
    {
      code: 'Inventory.UnitConversion.Create',
      description:
        'Create a new unit conversion version. Existing versions are never edited in place; a change is a new effective-dated version.',
    },
  ] as readonly PermissionDefinition[],
} as const;

export const ITEM_PERMISSIONS = {
  VIEW: ITEM.VIEW,
  CREATE: ITEM.CREATE,
  EDIT: ITEM.EDIT,
  ENABLE: ITEM.ENABLE,
  DISABLE: ITEM.DISABLE,
} as const;

export const ITEM_GROUP_PERMISSIONS = {
  VIEW: ITEM_GROUP.VIEW,
  CREATE: ITEM_GROUP.CREATE,
  EDIT: ITEM_GROUP.EDIT,
  ENABLE: ITEM_GROUP.ENABLE,
  DISABLE: ITEM_GROUP.DISABLE,
} as const;

export const UNIT_PERMISSIONS = {
  VIEW: UNIT.VIEW,
  CREATE: UNIT.CREATE,
  EDIT: UNIT.EDIT,
  ENABLE: UNIT.ENABLE,
  DISABLE: UNIT.DISABLE,
} as const;

export const UNIT_CONVERSION_PERMISSIONS = {
  VIEW: UNIT_CONVERSION.VIEW,
  CREATE: UNIT_CONVERSION.CREATE,
} as const;

export const WAREHOUSE_PERMISSIONS = {
  VIEW: WAREHOUSE.VIEW,
  CREATE: WAREHOUSE.CREATE,
  EDIT: WAREHOUSE.EDIT,
  ENABLE: WAREHOUSE.ENABLE,
  DISABLE: WAREHOUSE.DISABLE,
} as const;

export const INVENTORY_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] =
  [
    ...ITEM.definitions,
    ...ITEM_GROUP.definitions,
    ...UNIT.definitions,
    ...UNIT_CONVERSION.definitions,
    ...WAREHOUSE.definitions,
  ];
