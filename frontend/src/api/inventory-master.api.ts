import { apiGet, apiPatch, apiPost, cleanParams } from './client';
import type {
  CreateInventoryItemGroupInput,
  CreateInventoryItemInput,
  CreateInventoryUnitConversionInput,
  CreateInventoryUnitInput,
  CreateInventoryWarehouseInput,
  InventoryAvailability,
  InventoryAvailabilityQuery,
  InventoryBalance,
  InventoryItem,
  InventoryItemGroup,
  InventoryItemGroupListQuery,
  InventoryItemListQuery,
  InventoryItemWarehouseAvailability,
  InventoryItemWarehouseAvailabilityQuery,
  InventoryUnit,
  InventoryUnitConversion,
  InventoryUnitConversionListQuery,
  InventoryUnitListQuery,
  InventoryWarehouse,
  InventoryWarehouseListQuery,
  Paginated,
  UpdateInventoryItemGroupInput,
  UpdateInventoryItemInput,
  UpdateInventoryUnitInput,
  UpdateInventoryWarehouseInput,
} from './contracts';

/**
 * Inventory MASTER-DATA administration API
 * (`backend/src/modules/inventory/api/*` — Items/Warehouses/Units/
 * UnitConversions/ItemGroups controllers + the balances reads).
 *
 * One function per endpoint, exactly like `organization.api.ts`. Contract
 * facts encoded here and never "improved" away:
 * 1. **No DELETE** — the master-data lifecycle is `enable`/`disable` over
 *    `is_active` (master-data-strategy.md §7.4).
 * 2. **Unit conversions are never edited in place** — a change is a new
 *    effective-dated version (`Inventory.UnitConversion.Create` only).
 * 3. Every list/detail call carries `organizationId`; the backend re-asserts
 *    the scope on every request.
 * 4. Quantities and factors stay exact decimal STRINGS end to end.
 */

/** Backend `MAX_PAGE_SIZE` for reference reads. */
export const INVENTORY_MASTER_PAGE_SIZE = 500;

// ---------------------------------------------------------------------------
// Warehouses
// ---------------------------------------------------------------------------

export function listWarehousesAdmin(
  query: InventoryWarehouseListQuery,
  signal?: AbortSignal,
): Promise<Paginated<InventoryWarehouse>> {
  return apiGet<Paginated<InventoryWarehouse>>('/warehouses', {
    params: cleanParams(query),
    ...(signal ? { signal } : {}),
  });
}

export function getWarehouseAdmin(
  organizationId: string,
  warehouseId: string,
  signal?: AbortSignal,
): Promise<InventoryWarehouse> {
  return apiGet<InventoryWarehouse>(
    `/warehouses/${encodeURIComponent(warehouseId)}`,
    {
      params: { organizationId },
      ...(signal ? { signal } : {}),
    },
  );
}

export function createWarehouse(
  body: CreateInventoryWarehouseInput,
): Promise<InventoryWarehouse> {
  return apiPost<InventoryWarehouse, CreateInventoryWarehouseInput>(
    '/warehouses',
    body,
  );
}

export function updateWarehouse(
  organizationId: string,
  warehouseId: string,
  body: UpdateInventoryWarehouseInput,
): Promise<InventoryWarehouse> {
  return apiPatch<InventoryWarehouse, UpdateInventoryWarehouseInput>(
    `/warehouses/${encodeURIComponent(warehouseId)}`,
    body,
    { params: { organizationId } },
  );
}

/** The lifecycle is exactly these two transitions — there is no delete. */
export function setWarehouseActive(
  organizationId: string,
  warehouseId: string,
  action: 'enable' | 'disable',
): Promise<InventoryWarehouse> {
  return apiPost<InventoryWarehouse>(
    `/warehouses/${encodeURIComponent(warehouseId)}/${action}`,
    undefined,
    { params: { organizationId } },
  );
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export function listUnitsAdmin(
  query: InventoryUnitListQuery,
  signal?: AbortSignal,
): Promise<Paginated<InventoryUnit>> {
  return apiGet<Paginated<InventoryUnit>>('/units', {
    params: cleanParams(query),
    ...(signal ? { signal } : {}),
  });
}

export function getUnitAdmin(
  organizationId: string,
  unitId: string,
  signal?: AbortSignal,
): Promise<InventoryUnit> {
  return apiGet<InventoryUnit>(`/units/${encodeURIComponent(unitId)}`, {
    params: { organizationId },
    ...(signal ? { signal } : {}),
  });
}

export function createUnit(
  body: CreateInventoryUnitInput,
): Promise<InventoryUnit> {
  return apiPost<InventoryUnit, CreateInventoryUnitInput>('/units', body);
}

export function updateUnit(
  organizationId: string,
  unitId: string,
  body: UpdateInventoryUnitInput,
): Promise<InventoryUnit> {
  return apiPatch<InventoryUnit, UpdateInventoryUnitInput>(
    `/units/${encodeURIComponent(unitId)}`,
    body,
    { params: { organizationId } },
  );
}

export function setUnitActive(
  organizationId: string,
  unitId: string,
  action: 'enable' | 'disable',
): Promise<InventoryUnit> {
  return apiPost<InventoryUnit>(
    `/units/${encodeURIComponent(unitId)}/${action}`,
    undefined,
    { params: { organizationId } },
  );
}

// ---------------------------------------------------------------------------
// Item groups
// ---------------------------------------------------------------------------

export function listItemGroupsAdmin(
  query: InventoryItemGroupListQuery,
  signal?: AbortSignal,
): Promise<Paginated<InventoryItemGroup>> {
  return apiGet<Paginated<InventoryItemGroup>>('/item-groups', {
    params: cleanParams(query),
    ...(signal ? { signal } : {}),
  });
}

export function getItemGroupAdmin(
  organizationId: string,
  itemGroupId: string,
  signal?: AbortSignal,
): Promise<InventoryItemGroup> {
  return apiGet<InventoryItemGroup>(
    `/item-groups/${encodeURIComponent(itemGroupId)}`,
    {
      params: { organizationId },
      ...(signal ? { signal } : {}),
    },
  );
}

export function createItemGroup(
  body: CreateInventoryItemGroupInput,
): Promise<InventoryItemGroup> {
  return apiPost<InventoryItemGroup, CreateInventoryItemGroupInput>(
    '/item-groups',
    body,
  );
}

export function updateItemGroup(
  organizationId: string,
  itemGroupId: string,
  body: UpdateInventoryItemGroupInput,
): Promise<InventoryItemGroup> {
  return apiPatch<InventoryItemGroup, UpdateInventoryItemGroupInput>(
    `/item-groups/${encodeURIComponent(itemGroupId)}`,
    body,
    { params: { organizationId } },
  );
}

export function setItemGroupActive(
  organizationId: string,
  itemGroupId: string,
  action: 'enable' | 'disable',
): Promise<InventoryItemGroup> {
  return apiPost<InventoryItemGroup>(
    `/item-groups/${encodeURIComponent(itemGroupId)}/${action}`,
    undefined,
    { params: { organizationId } },
  );
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export function listItemsAdmin(
  query: InventoryItemListQuery,
  signal?: AbortSignal,
): Promise<Paginated<InventoryItem>> {
  return apiGet<Paginated<InventoryItem>>('/items', {
    params: cleanParams(query),
    ...(signal ? { signal } : {}),
  });
}

export function getItemAdmin(
  organizationId: string,
  itemId: string,
  signal?: AbortSignal,
): Promise<InventoryItem> {
  return apiGet<InventoryItem>(`/items/${encodeURIComponent(itemId)}`, {
    params: { organizationId },
    ...(signal ? { signal } : {}),
  });
}

export function createItem(
  body: CreateInventoryItemInput,
): Promise<InventoryItem> {
  return apiPost<InventoryItem, CreateInventoryItemInput>('/items', body);
}

export function updateItem(
  organizationId: string,
  itemId: string,
  body: UpdateInventoryItemInput,
): Promise<InventoryItem> {
  return apiPatch<InventoryItem, UpdateInventoryItemInput>(
    `/items/${encodeURIComponent(itemId)}`,
    body,
    { params: { organizationId } },
  );
}

export function setItemActive(
  organizationId: string,
  itemId: string,
  action: 'enable' | 'disable',
): Promise<InventoryItem> {
  return apiPost<InventoryItem>(
    `/items/${encodeURIComponent(itemId)}/${action}`,
    undefined,
    { params: { organizationId } },
  );
}

// ---------------------------------------------------------------------------
// Unit conversions — read + create a new version; never an in-place edit.
// ---------------------------------------------------------------------------

export function listUnitConversions(
  query: InventoryUnitConversionListQuery,
  signal?: AbortSignal,
): Promise<Paginated<InventoryUnitConversion>> {
  return apiGet<Paginated<InventoryUnitConversion>>('/unit-conversions', {
    params: cleanParams(query),
    ...(signal ? { signal } : {}),
  });
}

export function createUnitConversion(
  body: CreateInventoryUnitConversionInput,
): Promise<InventoryUnitConversion> {
  return apiPost<InventoryUnitConversion, CreateInventoryUnitConversionInput>(
    '/unit-conversions',
    body,
  );
}

// ---------------------------------------------------------------------------
// Balances (read-time projections)
// ---------------------------------------------------------------------------

/**
 * Stock balances list (`GET /inventory/balances`). This is the ADMIN read the
 * موجودی page uses — the dashboard reads the same endpoint through
 * `fetch-all-balances.ts`.
 */
export function listBalances(
  query: {
    organizationId: string;
    branchId?: string;
    warehouseId?: string;
    itemId?: string;
    page?: number;
    pageSize?: number;
    /** Backend whitelist: onHand | updatedAt | createdAt. */
    sort?: string;
  },
  signal?: AbortSignal,
): Promise<Paginated<InventoryBalance>> {
  return apiGet<Paginated<InventoryBalance>>('/inventory/balances', {
    params: cleanParams(query),
    ...(signal ? { signal } : {}),
  });
}

/** Availability of one item in one warehouse (`GET /inventory/balances/availability`). */
export function getAvailability(
  query: InventoryAvailabilityQuery,
  signal?: AbortSignal,
): Promise<InventoryAvailability> {
  return apiGet<InventoryAvailability>('/inventory/balances/availability', {
    params: cleanParams(query),
    ...(signal ? { signal } : {}),
  });
}

/** One item's availability across every warehouse (`GET …/availability-across-warehouses`). */
export function getAvailabilityAcrossWarehouses(
  query: InventoryItemWarehouseAvailabilityQuery,
  signal?: AbortSignal,
): Promise<InventoryItemWarehouseAvailability[]> {
  return apiGet<InventoryItemWarehouseAvailability[]>(
    '/inventory/balances/availability-across-warehouses',
    {
      params: cleanParams(query),
      ...(signal ? { signal } : {}),
    },
  );
}
