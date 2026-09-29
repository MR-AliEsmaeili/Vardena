import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountBalance, Paginated } from '@/api/contracts';
import { testAccountBalances } from '@/test/fixtures';
import { aggregateKpis } from '../lib/kpis';
import { fetchAllAccountBalances } from './fetch-all-balances';

vi.mock('@/api/dashboard.api', () => ({
  listAccountBalances: vi.fn(),
  MAX_PAGE_SIZE: 500,
}));

const dashboardApi = await import('@/api/dashboard.api');
const scope = {
  organizationId: 'org-1',
  scope: { financialAreaId: 'area-1', fiscalYearId: 'year-1' },
};

function row(index: number, amount = '1.00'): AccountBalance {
  return {
    ...testAccountBalances[0],
    id: `balance-${index}`,
    accountId: `account-${index}`,
    periodDebitAmount: amount,
    periodCreditAmount: '0.00',
    periodNetAmount: amount,
  } as AccountBalance;
}

function page(
  items: AccountBalance[],
  total: number,
  pageNumber: number,
): Paginated<AccountBalance> {
  return { items, total, page: pageNumber, pageSize: 500 };
}

beforeEach(() => {
  vi.mocked(dashboardApi.listAccountBalances).mockReset();
});

describe('fetchAllAccountBalances', () => {
  it('reads one page when the complete scope has at most 500 rows', async () => {
    const rows = Array.from({ length: 500 }, (_, index) => row(index));
    vi.mocked(dashboardApi.listAccountBalances).mockResolvedValue(
      page(rows, rows.length, 1),
    );

    const result = await fetchAllAccountBalances(scope);

    expect(result.items).toHaveLength(500);
    expect(dashboardApi.listAccountBalances).toHaveBeenCalledTimes(1);
  });

  it('reads all rows across two pages and preserves decimal strings', async () => {
    const rows = Array.from({ length: 501 }, (_, index) =>
      row(index, index === 500 ? '0.125' : '1.00'),
    );
    vi.mocked(dashboardApi.listAccountBalances).mockImplementation(
      async (query) =>
        query.page === 1
          ? page(rows.slice(0, 500), rows.length, 1)
          : page(rows.slice(500), rows.length, 2),
    );

    const result = await fetchAllAccountBalances(scope);

    expect(result.items).toHaveLength(501);
    expect(result.items[500]?.periodDebitAmount).toBe('0.125');
    expect(dashboardApi.listAccountBalances).toHaveBeenCalledTimes(2);
  });

  it('consumes more than 1000 rows using the exact metadata-bounded pages', async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => row(index));
    vi.mocked(dashboardApi.listAccountBalances).mockImplementation(
      async (query) => {
        const start = ((query.page ?? 1) - 1) * 500;
        return page(
          rows.slice(start, start + 500),
          rows.length,
          query.page ?? 1,
        );
      },
    );

    const result = await fetchAllAccountBalances(scope);

    expect(result.items).toHaveLength(1001);
    expect(dashboardApi.listAccountBalances).toHaveBeenCalledTimes(3);
    expect(
      vi
        .mocked(dashboardApi.listAccountBalances)
        .mock.calls.map(([query]) => query.page),
    ).toEqual([1, 2, 3]);
  });

  it('aggregates values that fall on different page boundaries', async () => {
    const first = [row(1, '10.25')];
    const second = [row(2, '2.005')];
    vi.mocked(dashboardApi.listAccountBalances)
      .mockResolvedValueOnce(page(first, 501, 1))
      .mockResolvedValueOnce(page(second, 501, 2));

    const result = await fetchAllAccountBalances(scope);

    expect(aggregateKpis(result.items).totalDebit).toBe('12.255');
  });

  it('forwards cancellation and stops before requesting another page', async () => {
    const controller = new AbortController();
    vi.mocked(dashboardApi.listAccountBalances).mockImplementation(async () => {
      controller.abort();
      return page([row(1)], 501, 1);
    });

    await expect(
      fetchAllAccountBalances(scope, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(dashboardApi.listAccountBalances).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dashboardApi.listAccountBalances).mock.calls[0]?.[1]).toBe(
      controller.signal,
    );
  });

  it('returns an empty result without requesting a phantom next page', async () => {
    vi.mocked(dashboardApi.listAccountBalances).mockResolvedValue(
      page([], 0, 1),
    );

    const result = await fetchAllAccountBalances(scope);

    expect(result.items).toEqual([]);
    expect(dashboardApi.listAccountBalances).toHaveBeenCalledTimes(1);
  });
});
