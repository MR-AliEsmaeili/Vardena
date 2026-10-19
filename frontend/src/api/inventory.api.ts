import { apiDelete, apiGet, apiPatch, apiPost, cleanParams } from './client';
import type {
  CancelInventoryDocumentInput,
  CreateInventoryDocumentInput,
  FinalizeInventoryDocumentInput,
  InventoryBackdateCheck,
  InventoryBackdateCheckQuery,
  InventoryItemListQuery,
  InventoryItem,
  InventoryDocument,
  InventoryDocumentListQuery,
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
  UpdateInventoryDocumentInput,
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
 * A BACKDATED transfer is supported (C-59C): the backend values the pair with
 * the coupled two-key replay, which restates both warehouses from the
 * transfer's date. It is refused with the shared backdating code
 * (`inventory.backdated_document`) until `backdateConfirmed` is sent, and a
 * confirmed one requires `Inventory.Valuation.Recalculate`. There is no
 * repricing choice on this surface: the pair is valued together (PDR-08
 * OD-TRF-01/05). The two-step confirmation dialog is a recorded UI follow-up;
 * this surface currently renders the refusal as a business error.
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
    { vardenaRequestActivity: { message: 'processing' } },
  );
}

// ---------------------------------------------------------------------------
// Business documents (C-58) — Receipt / Issue / Transfer
//
// Explicit COMMANDS, mirroring `InventoryBusinessDocumentsController`: there
// is no generic "set status" call, because finalize (posts the ledger),
// accounting-post (crosses the immutability boundary), seal (terminal) and
// cancel (reverses) are materially different operations. Every single-
// resource route carries the organization scope as a query parameter, and a
// document of another organization answers 404 — never 403.
// ---------------------------------------------------------------------------

const DOCUMENTS_PATH = '/inventory/business-documents';

/** Documents list (`GET /inventory/business-documents`). */
export function listInventoryDocuments(
  query: InventoryDocumentListQuery,
  signal?: AbortSignal,
): Promise<Paginated<InventoryDocument>> {
  return apiGet<Paginated<InventoryDocument>>(DOCUMENTS_PATH, {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

/** One document with its lines (`GET …/:id`). */
export function readInventoryDocument(
  id: string,
  organizationId: string,
  signal?: AbortSignal,
): Promise<InventoryDocument> {
  return apiGet<InventoryDocument>(`${DOCUMENTS_PATH}/${id}`, {
    params: cleanParams({ organizationId }),
    ...(signal ? { signal } : {}),
  });
}

/** Create a DRAFT (`POST …`): no stock effect, no document number. */
export function createInventoryDocument(
  body: CreateInventoryDocumentInput,
): Promise<InventoryDocument> {
  return apiPost<InventoryDocument>(DOCUMENTS_PATH, body);
}

/** Edit before Accounting Post (`PATCH …/:id`). */
export function updateInventoryDocument(
  id: string,
  organizationId: string,
  body: UpdateInventoryDocumentInput,
): Promise<InventoryDocument> {
  return apiPatch<InventoryDocument>(`${DOCUMENTS_PATH}/${id}`, body, {
    params: cleanParams({ organizationId }),
  });
}

/** Delete a DRAFT (`DELETE …/:id`). A posted document is cancelled instead. */
export function deleteInventoryDocument(
  id: string,
  organizationId: string,
): Promise<void> {
  return apiDelete<void>(`${DOCUMENTS_PATH}/${id}`, {
    params: cleanParams({ organizationId }),
  });
}

/** Finalize: allocate the number and post the ledger effect (`POST …/:id/finalize`). */
export function finalizeInventoryDocument(
  id: string,
  organizationId: string,
  body: FinalizeInventoryDocumentInput = {},
): Promise<InventoryDocument> {
  return apiPost<InventoryDocument>(`${DOCUMENTS_PATH}/${id}/finalize`, body, {
    params: cleanParams({ organizationId }),
    vardenaRequestActivity: { message: 'processing' },
  });
}

/** Cross the Accounting Post boundary (`POST …/:id/accounting-post`). */
export function accountingPostInventoryDocument(
  id: string,
  organizationId: string,
): Promise<InventoryDocument> {
  return apiPost<InventoryDocument>(
    `${DOCUMENTS_PATH}/${id}/accounting-post`,
    {},
    {
      params: cleanParams({ organizationId }),
      vardenaRequestActivity: { message: 'processing' },
    },
  );
}

/** Seal permanently (`POST …/:id/seal`). Terminal. */
export function sealInventoryDocument(
  id: string,
  organizationId: string,
): Promise<InventoryDocument> {
  return apiPost<InventoryDocument>(
    `${DOCUMENTS_PATH}/${id}/seal`,
    {},
    {
      params: cleanParams({ organizationId }),
      vardenaRequestActivity: { message: 'processing' },
    },
  );
}

/** Cancel before Accounting Post (`POST …/:id/cancel`): reverses the effect. */
export function cancelInventoryDocument(
  id: string,
  organizationId: string,
  body: CancelInventoryDocumentInput = {},
): Promise<InventoryDocument> {
  return apiPost<InventoryDocument>(`${DOCUMENTS_PATH}/${id}/cancel`, body, {
    params: cleanParams({ organizationId }),
    vardenaRequestActivity: { message: 'processing' },
  });
}
