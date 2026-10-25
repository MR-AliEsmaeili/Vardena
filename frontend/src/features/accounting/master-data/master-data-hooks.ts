import { useQuery } from '@tanstack/react-query';
import {
  getAccount,
  getActiveAccountingConfiguration,
  listAccountingPeriodsPage,
  listAccounts,
  listFinancialAreasPage,
  listFiscalYearsPage,
  MAX_PAGE_SIZE,
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

/**
 * The ACTIVE accounting configuration — the level set (titles, digit
 * lengths, postable defaults) the backend validates new accounts against.
 * `null` data means "no active configuration" (the API client's 404
 * mapping); the account form must not guess a structure in that state.
 */
export function useActiveAccountingConfiguration(
  organizationId: string | null,
) {
  return useQuery({
    queryKey: queryKeys.accounting.accountingConfigurationActive(
      organizationId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getActiveAccountingConfiguration(organizationId as string, signal),
    enabled: organizationId !== null,
    staleTime: 5 * 60_000,
  });
}

/**
 * Eligible PARENT accounts for the create form: active, non-postable
 * (aggregate) nodes, server-filtered and code-ordered. A postable account
 * can never receive children (§14 rule 2), so it is not offered; the
 * backend re-validates eligibility on submit regardless. Bounded by the
 * list contract's hard page cap — deliberately NOT the accounts grid's
 * current page, which made valid parents disappear under paging/filters.
 */
export function useAccountParentCandidates(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.accounting.accountList(organizationId ?? 'none', {
      purpose: 'parent-candidates',
    }),
    queryFn: ({ signal }) =>
      listAccounts(
        {
          organizationId: organizationId as string,
          isActive: true,
          isPostable: false,
          page: 1,
          pageSize: MAX_PAGE_SIZE,
          sort: 'code:asc',
        },
        signal,
      ),
    enabled: organizationId !== null,
    staleTime: 30_000,
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
