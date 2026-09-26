import { useQuery } from '@tanstack/react-query';
import type { SortingState } from '@tanstack/react-table';
import { listTrialBalance } from '@/api/accounting.api';
import type { TrialBalanceQuery } from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';
import {
  optionalParam,
  type LedgerScopeValues,
} from '@/features/accounting/shared/report-filters';
import { sortingToParam } from '@/features/accounting/shared/use-report-query-state';

export interface TrialBalanceRequest {
  organizationId: string | null;
  filters: LedgerScopeValues | null;
  page: number;
  pageSize: number;
  sorting: SortingState;
}

/** Build the exact query the endpoint declares (no invented parameters). */
export function buildTrialBalanceQuery(
  organizationId: string,
  filters: LedgerScopeValues,
  page: number,
  pageSize: number,
  sorting: SortingState,
): TrialBalanceQuery {
  return {
    organizationId,
    financialAreaId: filters.financialAreaId,
    fiscalYearId: filters.fiscalYearId,
    accountingPeriodId: optionalParam(filters.accountingPeriodId),
    accountId: optionalParam(filters.accountId),
    accountCode: optionalParam(filters.accountCode),
    accountName: optionalParam(filters.accountName),
    dateFrom: optionalParam(filters.dateFrom),
    dateTo: optionalParam(filters.dateTo),
    page,
    pageSize,
    sort: sortingToParam(sorting),
  } as TrialBalanceQuery;
}

export function useTrialBalance({
  organizationId,
  filters,
  page,
  pageSize,
  sorting,
}: TrialBalanceRequest) {
  const enabled =
    organizationId !== null &&
    filters !== null &&
    filters.financialAreaId !== '' &&
    filters.fiscalYearId !== '';

  const query = enabled
    ? buildTrialBalanceQuery(organizationId, filters, page, pageSize, sorting)
    : null;

  return useQuery({
    queryKey: queryKeys.accounting.trialBalance(
      organizationId ?? 'none',
      (query ?? {}) as Record<string, unknown>,
    ),
    queryFn: ({ signal }) =>
      listTrialBalance(query as TrialBalanceQuery, signal),
    enabled,
    placeholderData: (previous) => previous,
  });
}
