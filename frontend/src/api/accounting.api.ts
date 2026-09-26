import { apiGet, cleanParams } from './client';
import type {
  Account,
  AccountStatement,
  AccountStatementQuery,
  AccountingPeriod,
  ChartTreeNode,
  ChartTreeQuery,
  FinancialArea,
  FiscalYear,
  GeneralLedgerQuery,
  GeneralLedgerRow,
  Paginated,
  TrialBalanceQuery,
  TrialBalanceRow,
} from './contracts';

/**
 * Accounting read surfaces (`backend/src/modules/accounting/api`).
 *
 * Every function maps 1:1 onto an EXISTING endpoint and sends exactly the
 * query parameters that endpoint declares — the global validation pipe
 * rejects any undeclared parameter with 400, and this layer never invents a
 * filter, a sort field or a computed value. All amounts stay exact decimal
 * strings as returned; nothing is recomputed client-side.
 */

/** Hard page cap of the backend list contract (`MAX_PAGE_SIZE`). */
export const MAX_PAGE_SIZE = 500;

/** Bounded page fan-out for the chart tree (see `fetchChartTreePages`). */
export const CHART_TREE_MAX_PAGES = 10;

// ---------------------------------------------------------------------------
// Reference data for report filters
// ---------------------------------------------------------------------------

export function listFinancialAreas(
  params: { organizationId: string; isActive?: boolean },
  signal?: AbortSignal,
): Promise<Paginated<FinancialArea>> {
  return apiGet<Paginated<FinancialArea>>('/financial-areas', {
    params: cleanParams({
      organizationId: params.organizationId,
      isActive: params.isActive,
      page: 1,
      pageSize: MAX_PAGE_SIZE,
      sort: 'code:asc',
    }),
    ...(signal ? { signal } : {}),
  });
}

export function listFiscalYears(
  params: { organizationId: string; financialAreaId?: string | undefined },
  signal?: AbortSignal,
): Promise<Paginated<FiscalYear>> {
  return apiGet<Paginated<FiscalYear>>('/fiscal-years', {
    params: cleanParams({
      organizationId: params.organizationId,
      financialAreaId: params.financialAreaId,
      page: 1,
      pageSize: MAX_PAGE_SIZE,
      sort: 'code:asc',
    }),
    ...(signal ? { signal } : {}),
  });
}

export function listAccountingPeriods(
  params: { organizationId: string; fiscalYearId: string },
  signal?: AbortSignal,
): Promise<Paginated<AccountingPeriod>> {
  return apiGet<Paginated<AccountingPeriod>>('/accounting-periods', {
    params: cleanParams({
      organizationId: params.organizationId,
      fiscalYearId: params.fiscalYearId,
      page: 1,
      pageSize: MAX_PAGE_SIZE,
    }),
    ...(signal ? { signal } : {}),
  });
}

/**
 * Postable accounts for the statement picker. `isPostable=true` mirrors the
 * statement contract (decision D1: a non-postable account answers 422), and
 * `search` is the endpoint's own substring filter — the list stays
 * server-filtered and bounded instead of pulling the whole chart.
 */
export function listPostableAccounts(
  params: { organizationId: string; search?: string | undefined },
  signal?: AbortSignal,
): Promise<Paginated<Account>> {
  return apiGet<Paginated<Account>>('/accounts', {
    params: cleanParams({
      organizationId: params.organizationId,
      isPostable: true,
      isActive: true,
      search: params.search,
      page: 1,
      pageSize: 50,
      sort: 'code:asc',
    }),
    ...(signal ? { signal } : {}),
  });
}

// ---------------------------------------------------------------------------
// Chart Tree (Task 19, ODR-2) — read-only, fixed code-ascending order
// ---------------------------------------------------------------------------

export function listChartTree(
  params: Pick<ChartTreeQuery, 'organizationId'> & {
    page?: number;
    pageSize?: number;
  },
  signal?: AbortSignal,
): Promise<Paginated<ChartTreeNode>> {
  return apiGet<Paginated<ChartTreeNode>>('/accounting/chart-tree', {
    params: cleanParams({
      organizationId: params.organizationId,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? MAX_PAGE_SIZE,
      // No `sort`: the chart-tree order is FIXED (code ascending) and an
      // explicit sort is rejected with 400.
    }),
    ...(signal ? { signal } : {}),
  });
}

export interface ChartTreePagesResult {
  nodes: ChartTreeNode[];
  total: number;
  /** True when the chart is larger than the bounded page fan-out. */
  truncated: boolean;
}

/**
 * Read the chart tree for nesting.
 *
 * Nesting a parent/child structure needs the nodes of the subtree, and the
 * contract only offers a flat, code-ascending page (`pageSize` ≤ 500). This
 * helper therefore walks pages in order up to a HARD bound
 * (`CHART_TREE_MAX_PAGES`) and reports `truncated` instead of looping
 * unbounded over an arbitrarily large chart.
 */
export async function fetchChartTreePages(
  organizationId: string,
  signal?: AbortSignal,
): Promise<ChartTreePagesResult> {
  const nodes: ChartTreeNode[] = [];
  let page = 1;
  let total = 0;

  for (; page <= CHART_TREE_MAX_PAGES; page += 1) {
    // Sequential on purpose: the next page is only requested when the
    // previous one proved there are more rows, so a small chart costs exactly
    // one request and a large one is never fanned out in parallel.
    // oxlint-disable-next-line no-await-in-loop
    const result = await listChartTree(
      { organizationId, page, pageSize: MAX_PAGE_SIZE },
      signal,
    );
    total = result.total;
    nodes.push(...result.items);
    if (result.items.length === 0 || nodes.length >= result.total) break;
  }

  return { nodes, total, truncated: nodes.length < total };
}

// ---------------------------------------------------------------------------
// Account Statement (Task 17B) — one account, one fiscal year
// ---------------------------------------------------------------------------

export function getAccountStatement(
  query: AccountStatementQuery,
  signal?: AbortSignal,
): Promise<AccountStatement> {
  return apiGet<AccountStatement>('/accounting/account-statements', {
    // No `sort`: the statement order is fixed and an explicit sort is a 400.
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

// ---------------------------------------------------------------------------
// General Ledger / Trial Balance (Task 18) — server-paged, allow-listed sort
// ---------------------------------------------------------------------------

export function listGeneralLedger(
  query: GeneralLedgerQuery,
  signal?: AbortSignal,
): Promise<Paginated<GeneralLedgerRow>> {
  return apiGet<Paginated<GeneralLedgerRow>>('/accounting/general-ledger', {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

export function listTrialBalance(
  query: TrialBalanceQuery,
  signal?: AbortSignal,
): Promise<Paginated<TrialBalanceRow>> {
  return apiGet<Paginated<TrialBalanceRow>>('/accounting/trial-balance', {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}
