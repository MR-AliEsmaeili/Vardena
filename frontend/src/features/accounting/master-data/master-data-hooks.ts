import { useQuery } from '@tanstack/react-query';
import {
  getAccount,
  listAccountingPeriodsPage,
  listAccounts,
  listFinancialAreasPage,
  listFiscalYearsPage,
} from '@/api/accounting.api';
import type { AccountListQuery } from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';

export interface ListState {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  scopeId?: string;
}

export function useFinancialAreaList(
  organizationId: string | null,
  state: ListState,
) {
  return useQuery({
    queryKey: queryKeys.accounting.financialAreaList(organizationId ?? 'none', {
      ...state,
    }),
    queryFn: ({ signal }) =>
      listFinancialAreasPage(
        {
          organizationId: organizationId as string,
          page: state.page,
          pageSize: state.pageSize,
          ...(state.search ? { search: state.search } : {}),
          ...(state.status === 'active'
            ? { isActive: true }
            : state.status === 'inactive'
              ? { isActive: false }
              : {}),
          sort: 'code:asc',
        },
        signal,
      ),
    enabled: organizationId !== null,
  });
}

export function useFiscalYearList(
  organizationId: string | null,
  state: ListState,
) {
  return useQuery({
    queryKey: queryKeys.accounting.fiscalYearList(organizationId ?? 'none', {
      ...state,
    }),
    queryFn: ({ signal }) =>
      listFiscalYearsPage(
        {
          organizationId: organizationId as string,
          page: state.page,
          pageSize: state.pageSize,
          ...(state.scopeId ? { financialAreaId: state.scopeId } : {}),
          ...(state.search ? { search: state.search } : {}),
          ...(state.status === 'open' ||
          state.status === 'closed' ||
          state.status === 'sealed'
            ? { status: state.status }
            : {}),
          sort: 'code:asc',
        },
        signal,
      ),
    enabled: organizationId !== null,
  });
}

export function useAccountingPeriodList(
  organizationId: string | null,
  state: ListState,
) {
  return useQuery({
    queryKey: queryKeys.accounting.accountingPeriodList(
      organizationId ?? 'none',
      { ...state },
    ),
    queryFn: ({ signal }) =>
      listAccountingPeriodsPage(
        {
          organizationId: organizationId as string,
          page: state.page,
          pageSize: state.pageSize,
          ...(state.scopeId ? { fiscalYearId: state.scopeId } : {}),
          ...(state.status === 'open' ||
          state.status === 'closed' ||
          state.status === 'sealed'
            ? { status: state.status }
            : {}),
          sort: 'sequence:asc',
        },
        signal,
      ),
    enabled: organizationId !== null,
  });
}

export function useAccountList(
  organizationId: string | null,
  state: ListState & {
    level: number | undefined;
    postable: boolean | undefined;
  },
) {
  const query: AccountListQuery | null =
    organizationId === null
      ? null
      : ({
          organizationId,
          page: state.page,
          pageSize: state.pageSize,
          ...(state.search ? { search: state.search } : {}),
          ...(state.level !== undefined ? { level: state.level } : {}),
          ...(state.postable !== undefined
            ? { isPostable: state.postable }
            : {}),
          sort: 'code:asc',
        } as AccountListQuery);
  return useQuery({
    queryKey: queryKeys.accounting.accountList(
      organizationId ?? 'none',
      query ?? {},
    ),
    queryFn: ({ signal }) => listAccounts(query as AccountListQuery, signal),
    enabled: query !== null,
  });
}

export function useAccountDetail(
  organizationId: string | null,
  accountId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.accounting.accountDetail(
      organizationId ?? 'none',
      accountId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getAccount(organizationId as string, accountId as string, signal),
    enabled: organizationId !== null && accountId !== undefined,
  });
}
