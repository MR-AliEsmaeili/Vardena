import { apiGet, apiPost, cleanParams } from './client';
import type {
  InventoryBackdateCheck,
  InventoryBackdateCheckQuery,
  InventoryItemListQuery,
  InventoryItem,
  InventoryKardexQuery,
  InventoryKardexResponse,
  InventoryMovement,
  InventoryMovementListQuery,
  InventoryTransferResult,
  InventoryUnit,
  InventoryUnitListQuery,
  InventoryValuationState,
  InventoryValuationStateListQuery,
  InventoryWarehouse,
  InventoryWarehouseListQuery,
  Paginated,
  PostInventoryMovementInput,
  PostInventoryTransferInput,
  RecalculateValuationInput,
  RecalculationResult,
} from './contracts';

/**
 * Inventory warehouse-operations + valuation API (ADR-0022, ADR-0039).
 *
 * Every function maps 1:1 onto an EXISTING endpoint and sends exactly the
 * parameters that endpoint declares. Quantities and money stay exact decimal
 * strings end to end; the UI never recomputes a valuation value.
 *
 * The three POSTs are financial mutations: they carry the caller-supplied
 * `operationKey` (inside the typed body) so a manual retry replays the
 * committed operation instead of double-posting. There is no auto-retry
 * anywhere in this layer (standards.md §6).
 */

/** Backend `MAX_PAGE_SIZE` — the reference pickers read whole active lists. */
export const INVENTORY_MAX_PAGE_SIZE = 500;

// ---------------------------------------------------------------------------
// Reference reads (master data for the pickers)
// ---------------------------------------------------------------------------

/** Active warehouses of the organization (`GET /warehouses`). */
export function listInventoryWarehouses(
  query: Omit<InventoryWarehouseListQuery, 'isActive' | 'page' | 'pageSize'>,
  signal?: AbortSignal,
): Promise<Paginated<InventoryWarehouse>> {
  return apiGet<Paginated<InventoryWarehouse>>('/warehouses', {
    params: cleanParams({
      page: 1,
      pageSize: INVENTORY_MAX_PAGE_SIZE,
      isActive: true,
      ...query,
    }),
    ...(signal ? { signal } : {}),
  });
}

/** Active stockable items (`GET /items`) — only they may enter stock. */
export function listInventoryItems(
  query: Omit<
    InventoryItemListQuery,
    'isStockable' | 'isActive' | 'page' | 'pageSize'
  >,
  signal?: AbortSignal,
): Promise<Paginated<InventoryItem>> {
  return apiGet<Paginated<InventoryItem>>('/items', {
    params: cleanParams({
      page: 1,
      pageSize: INVENTORY_MAX_PAGE_SIZE,
      isActive: true,
      isStockable: true,
      ...query,
    }),
    ...(signal ? { signal } : {}),
  });
}

/** Active units of the organization (`GET /units`). */
export function listInventoryUnits(
  query: Omit<InventoryUnitListQuery, 'isActive' | 'page' | 'pageSize'>,
  signal?: AbortSignal,
): Promise<Paginated<InventoryUnit>> {
  return apiGet<Paginated<InventoryUnit>>('/units', {
    params: cleanParams({
      page: 1,
      pageSize: INVENTORY_MAX_PAGE_SIZE,
      isActive: true,
      ...query,
    }),
    ...(signal ? { signal } : {}),
  });
}

// ---------------------------------------------------------------------------
// Movement ledger
// ---------------------------------------------------------------------------

/** Movement history (`GET /inventory/movements`). */
export function listInventoryMovements(
  query: InventoryMovementListQuery,
  signal?: AbortSignal,
): Promise<Paginated<InventoryMovement>> {
  return apiGet<Paginated<InventoryMovement>>('/inventory/movements', {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

/**
 * Post a receipt, issue or adjustment (`POST /inventory/movements`).
 *
 * `backdateConfirmed`/`repricing` are only sent after the user made the two
 * explicit backdating decisions; cost is optional and backend-gated by
 * `Inventory.Valuation.AssignCost`.
 */
export function postInventoryMovement(
  body: PostInventoryMovementInput,
): Promise<InventoryMovement> {
  return apiPost<InventoryMovement>('/inventory/movements', body);
}

/**
 * Post the two-leg transfer (`POST /inventory/transfers`).
 *
 * A backdated transfer is REJECTED by the backend with
 * `inventory.backdated_transfer_valuation_unresolved` (OQ-67 open) — there is
 * deliberately no confirmation/repricing pair here.
 */
export function postInventoryTransfer(
  body: PostInventoryTransferInput,
): Promise<InventoryTransferResult> {
  return apiPost<InventoryTransferResult>('/inventory/transfers', body);
}

// ---------------------------------------------------------------------------
// Kardex (quantity-only)
// ---------------------------------------------------------------------------

/**
 * Read the Kardex of one item and warehouse (`GET /inventory/kardex`).
 * The opaque `snapshot` from page 1 must be passed unchanged on later pages.
 */
export function readInventoryKardex(
  query: InventoryKardexQuery,
  signal?: AbortSignal,
): Promise<InventoryKardexResponse> {
  return apiGet<InventoryKardexResponse>('/inventory/kardex', {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

// ---------------------------------------------------------------------------
// Valuation (ADR-0039) — the Inventory Accounting reads and commands
// ---------------------------------------------------------------------------

/** Valuation-state worklist (`GET /inventory/valuation/states`). */
export function listInventoryValuationStates(
  query: InventoryValuationStateListQuery,
  signal?: AbortSignal,
): Promise<Paginated<InventoryValuationState>> {
  return apiGet<Paginated<InventoryValuationState>>(
    '/inventory/valuation/states',
    {
      params: cleanParams({ ...query }),
      ...(signal ? { signal } : {}),
    },
  );
}

/**
 * Backdate preview (`GET /inventory/valuation/backdate-check`).
 *
 * Gated by `Inventory.Movement.Create` (not a valuation permission) and
 * returns counts and dates only, so the operator about to post can be told
 * the consequence BEFORE committing — never an amount.
 */
export function checkInventoryBackdate(
  query: InventoryBackdateCheckQuery,
  signal?: AbortSignal,
): Promise<InventoryBackdateCheck> {
  return apiGet<InventoryBackdateCheck>('/inventory/valuation/backdate-check', {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

/**
 * Reprice exactly ONE item in ONE warehouse
 * (`POST /inventory/valuation/recalculations`). Explicit, bounded, audited;
 * requires `Inventory.Valuation.Recalculate`.
 */
export function recalculateInventoryValuation(
  body: RecalculateValuationInput,
): Promise<RecalculationResult> {
  return apiPost<RecalculationResult>(
    '/inventory/valuation/recalculations',
    body,
  );
}
