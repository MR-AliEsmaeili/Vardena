import { apiGet, cleanParams } from './client';
import type {
  AccountBalance,
  AccountBalanceListQuery,
  AccountingDocument,
  AccountingDocumentListQuery,
  InventoryBalance,
  InventoryBalanceListQuery,
  Paginated,
  WorkflowInstance,
  WorkflowInstanceListQuery,
} from './contracts';

/**
 * Read surfaces consumed by the Dashboard (`Task 32`).
 *
 * Every function maps 1:1 onto an EXISTING endpoint and sends exactly the
 * query parameters that endpoint declares — the global validation pipe
 * rejects undeclared parameters with 400. All amounts stay exact decimal
 * strings as returned; the dashboard never recomputes a financial value
 * beyond displaying what the backend derived.
 */

/** Hard page cap of the backend list contract (`MAX_PAGE_SIZE`). */
export const MAX_PAGE_SIZE = 500;

// ---------------------------------------------------------------------------
// Accounting — recent documents (`GET /accounting-documents`)
// ---------------------------------------------------------------------------

/**
 * Document list for the dashboard table. The backend allow-lists
 * `documentDate`, `documentNumber`, `createdAt`, `updatedAt` as sort fields
 * (`AccountingDocumentsService.SORTABLE_FIELDS`) — an unsupported field is a
 * guaranteed 400, so only those ids ever become sortable columns.
 */
export function listAccountingDocuments(
  query: AccountingDocumentListQuery,
  signal?: AbortSignal,
): Promise<Paginated<AccountingDocument>> {
  return apiGet<Paginated<AccountingDocument>>('/accounting-documents', {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

// ---------------------------------------------------------------------------
// Accounting — period balances (`GET /accounting/balances`)
// ---------------------------------------------------------------------------

/**
 * Turnover projection rows for KPI aggregation and the period chart. Filters
 * beyond `organizationId` are optional and only forwarded when set.
 */
export function listAccountBalances(
  query: AccountBalanceListQuery,
  signal?: AbortSignal,
): Promise<Paginated<AccountBalance>> {
  return apiGet<Paginated<AccountBalance>>('/accounting/balances', {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

// ---------------------------------------------------------------------------
// Inventory — stock balances (`GET /inventory/balances`)
// ---------------------------------------------------------------------------

/**
 * Stock balances for the availability alert widget. The backend sorts only
 * `onHand`, `updatedAt`, `createdAt` (`InventoryBalancesService`); ascending
 * `onHand` surfaces the scarcest rows first.
 */
export function listInventoryBalances(
  query: InventoryBalanceListQuery,
  signal?: AbortSignal,
): Promise<Paginated<InventoryBalance>> {
  return apiGet<Paginated<InventoryBalance>>('/inventory/balances', {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

// ---------------------------------------------------------------------------
// Workflow — active bindings (`GET /workflow/instances`)
// ---------------------------------------------------------------------------

/**
 * Workflow bindings. The list carries ids only; an approval decision screen
 * is a separate capability the dashboard must not fake (capability gap
 * recorded in the task report).
 */
export function listWorkflowInstances(
  query: WorkflowInstanceListQuery,
  signal?: AbortSignal,
): Promise<Paginated<WorkflowInstance>> {
  return apiGet<Paginated<WorkflowInstance>>('/workflow/instances', {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}
