import type { AccountBalance, Paginated } from '@/api/contracts';
import { listAccountBalances, MAX_PAGE_SIZE } from '@/api/dashboard.api';
import type { DashboardScope } from './use-dashboard-scope';

interface BalanceScope {
  organizationId: string;
  scope: DashboardScope;
}

/**
 * Read the complete balance projection for one dashboard scope.
 *
 * Requests are deliberately sequential and bounded by the first response's
 * pagination metadata. This avoids an uncontrolled request fan-out while
 * preserving TanStack Query cancellation through the same AbortSignal on
 * every page. Decimal fields are collected unchanged.
 */
export async function fetchAllAccountBalances(
  { organizationId, scope }: BalanceScope,
  signal?: AbortSignal,
): Promise<Paginated<AccountBalance>> {
  const readPage = (page: number) =>
    listAccountBalances(
      {
        organizationId,
        financialAreaId: scope.financialAreaId,
        fiscalYearId: scope.fiscalYearId,
        page,
        pageSize: MAX_PAGE_SIZE,
      },
      signal,
    );

  signal?.throwIfAborted();
  const firstPage = await readPage(1);
  const items = [...firstPage.items];

  if (firstPage.total === 0) {
    return { ...firstPage, items: [] };
  }

  if (
    !Number.isSafeInteger(firstPage.total) ||
    firstPage.total < 0 ||
    !Number.isSafeInteger(firstPage.pageSize) ||
    firstPage.pageSize < 1 ||
    firstPage.pageSize > MAX_PAGE_SIZE
  ) {
    throw new Error('balances endpoint returned invalid pagination metadata');
  }

  const totalPages = Math.ceil(firstPage.total / firstPage.pageSize);
  for (let page = 2; page <= totalPages; page += 1) {
    signal?.throwIfAborted();
    // Sequential by design: dashboard pagination must not fan out hundreds of requests.
    // eslint-disable-next-line no-await-in-loop
    const nextPage = await readPage(page);
    items.push(...nextPage.items);
  }

  return {
    items,
    total: firstPage.total,
    page: 1,
    pageSize: firstPage.pageSize,
  };
}
