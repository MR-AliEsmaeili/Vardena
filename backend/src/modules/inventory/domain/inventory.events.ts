import type { DomainEvent } from '../../../kernel/events/domain-event-bus.js';

// ---------------------------------------------------------------------------
// Inventory module master-data domain events (docs/modules.md §Inventory
// "Publishes": `Item.Created/Updated/Archived etc.`; §Event catalog).
//
// Task 6 publishes master-data lifecycle events only. The transactional events
// (`InventoryReceipt.Created`, `InventoryIssue.Created`, `StockTransfer.Created`,
// `StockAdjustment.Created`) belong to the future Inventory implementation —
// Accounting subscribes to those (AR-16, ADR-0005), and nothing here pre-empts
// them.
//
// `Item.Enabled`/`Item.Disabled` are used instead of `Item.Archived` because
// Task 6 implements no archive state: the only lifecycle is `is_active`
// (master-data-strategy.md §7.4). If an archive marker is added later
// (§7.5), `Item.Archived` is added alongside — an event name is not reused
// with different semantics (AR-29).
//
// Payload policy: stable identifiers plus the business code, nothing else.
// ---------------------------------------------------------------------------

/** Payload shared by every organization-scoped master-data event. */
export interface MasterDataEventPayload {
  id: string;
  organizationId: string;
  code: string;
}

interface ScopedEvent<
  TType extends string,
  TAggregate extends string,
  TPayload = MasterDataEventPayload,
> extends DomainEvent {
  type: TType;
  aggregateType: TAggregate;
  aggregateId: string;
  payload: TPayload;
}

// ---- Item ------------------------------------------------------------------

export const ITEM_CREATED_EVENT = 'Item.Created' as const;
export const ITEM_UPDATED_EVENT = 'Item.Updated' as const;
export const ITEM_ENABLED_EVENT = 'Item.Enabled' as const;
export const ITEM_DISABLED_EVENT = 'Item.Disabled' as const;

export type ItemCreatedEvent = ScopedEvent<typeof ITEM_CREATED_EVENT, 'Item'>;
export type ItemUpdatedEvent = ScopedEvent<typeof ITEM_UPDATED_EVENT, 'Item'>;
export type ItemEnabledEvent = ScopedEvent<typeof ITEM_ENABLED_EVENT, 'Item'>;
export type ItemDisabledEvent = ScopedEvent<typeof ITEM_DISABLED_EVENT, 'Item'>;

// ---- Item group ------------------------------------------------------------

export const ITEM_GROUP_CREATED_EVENT = 'ItemGroup.Created' as const;
export const ITEM_GROUP_UPDATED_EVENT = 'ItemGroup.Updated' as const;
export const ITEM_GROUP_ENABLED_EVENT = 'ItemGroup.Enabled' as const;
export const ITEM_GROUP_DISABLED_EVENT = 'ItemGroup.Disabled' as const;

export type ItemGroupCreatedEvent = ScopedEvent<
  typeof ITEM_GROUP_CREATED_EVENT,
  'ItemGroup'
>;
export type ItemGroupUpdatedEvent = ScopedEvent<
  typeof ITEM_GROUP_UPDATED_EVENT,
  'ItemGroup'
>;
export type ItemGroupEnabledEvent = ScopedEvent<
  typeof ITEM_GROUP_ENABLED_EVENT,
  'ItemGroup'
>;
export type ItemGroupDisabledEvent = ScopedEvent<
  typeof ITEM_GROUP_DISABLED_EVENT,
  'ItemGroup'
>;

// ---- Unit ------------------------------------------------------------------

export const UNIT_CREATED_EVENT = 'Unit.Created' as const;
export const UNIT_UPDATED_EVENT = 'Unit.Updated' as const;
export const UNIT_ENABLED_EVENT = 'Unit.Enabled' as const;
export const UNIT_DISABLED_EVENT = 'Unit.Disabled' as const;

export type UnitCreatedEvent = ScopedEvent<typeof UNIT_CREATED_EVENT, 'Unit'>;
export type UnitUpdatedEvent = ScopedEvent<typeof UNIT_UPDATED_EVENT, 'Unit'>;
export type UnitEnabledEvent = ScopedEvent<typeof UNIT_ENABLED_EVENT, 'Unit'>;
export type UnitDisabledEvent = ScopedEvent<typeof UNIT_DISABLED_EVENT, 'Unit'>;

// ---- Unit conversion -------------------------------------------------------

export const UNIT_CONVERSION_CREATED_EVENT = 'UnitConversion.Created' as const;

/**
 * A new conversion version. `supersededConversionId` is the version this one
 * replaced (its `validTo` was closed at the new `validFrom`), so a consumer can
 * reconstruct the version chain without reading the table.
 */
export interface UnitConversionCreatedPayload {
  id: string;
  organizationId: string;
  /** Null for a global conversion. */
  itemId: string | null;
  fromUnitId: string;
  toUnitId: string;
  /** Decimal string; no rounding is applied (OQ-29). */
  factor: string;
  validFrom: string;
  supersededConversionId: string | null;
}

export type UnitConversionCreatedEvent = ScopedEvent<
  typeof UNIT_CONVERSION_CREATED_EVENT,
  'UnitConversion',
  UnitConversionCreatedPayload
>;

// ---- Warehouse -------------------------------------------------------------

export const WAREHOUSE_CREATED_EVENT = 'Warehouse.Created' as const;
export const WAREHOUSE_UPDATED_EVENT = 'Warehouse.Updated' as const;
export const WAREHOUSE_ENABLED_EVENT = 'Warehouse.Enabled' as const;
export const WAREHOUSE_DISABLED_EVENT = 'Warehouse.Disabled' as const;

export type WarehouseCreatedEvent = ScopedEvent<
  typeof WAREHOUSE_CREATED_EVENT,
  'Warehouse'
>;
export type WarehouseUpdatedEvent = ScopedEvent<
  typeof WAREHOUSE_UPDATED_EVENT,
  'Warehouse'
>;
export type WarehouseEnabledEvent = ScopedEvent<
  typeof WAREHOUSE_ENABLED_EVENT,
  'Warehouse'
>;
export type WarehouseDisabledEvent = ScopedEvent<
  typeof WAREHOUSE_DISABLED_EVENT,
  'Warehouse'
>;

/** Every event this module publishes in Task 6 (used by tests). */
export const INVENTORY_EVENT_TYPES = [
  ITEM_CREATED_EVENT,
  ITEM_UPDATED_EVENT,
  ITEM_ENABLED_EVENT,
  ITEM_DISABLED_EVENT,
  ITEM_GROUP_CREATED_EVENT,
  ITEM_GROUP_UPDATED_EVENT,
  ITEM_GROUP_ENABLED_EVENT,
  ITEM_GROUP_DISABLED_EVENT,
  UNIT_CREATED_EVENT,
  UNIT_UPDATED_EVENT,
  UNIT_ENABLED_EVENT,
  UNIT_DISABLED_EVENT,
  UNIT_CONVERSION_CREATED_EVENT,
  WAREHOUSE_CREATED_EVENT,
  WAREHOUSE_UPDATED_EVENT,
  WAREHOUSE_ENABLED_EVENT,
  WAREHOUSE_DISABLED_EVENT,
] as const;
