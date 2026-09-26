import { useQuery } from '@tanstack/react-query';
import type { SortingState } from '@tanstack/react-table';
import { listGeneralLedger } from '@/api/accounting.api';
import type { GeneralLedgerQuery } from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';
import {
  optionalParam,
  type LedgerScopeValues,
} from '@/features/accounting/shared/report-filters';
import { sortingToParam } from '@/features/accounting/shared/use-report-query-state';

export interface GeneralLedgerRequest {
  organizationId: string | null;
  filters: LedgerScopeValues | null;
  page: number;
  pageSize: number;
  sorting: SortingState;
}

/** Build the exact query the endpoint declares (no invented parameters). */
export function buildGeneralLedgerQuery(
  organizationId: string,
  filters: LedgerScopeValues,
  page: number,
  pageSize: number,
  sorting: SortingState,
): GeneralLedgerQuery {
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
  } as GeneralLedgerQuery;
}

/**
 * General Ledger rows for the applied scope.
 *
 * Disabled until an organization and a complete required scope exist, so the
 * screen never fires an incomplete request the API would reject.
 */
export function useGeneralLedger({
  organizationId,
  filters,
  page,
  pageSize,
  sorting,
}: GeneralLedgerRequest) {
  const enabled =
    organizationId !== null &&
    filters !== null &&
    filters.financialAreaId !== '' &&
    filters.fiscalYearId !== '';

  const query = enabled
    ? buildGeneralLedgerQuery(organizationId, filters, page, pageSize, sorting)
    : null;

  return useQuery({
    queryKey: queryKeys.accounting.generalLedger(
      organizationId ?? 'none',
      (query ?? {}) as Record<string, unknown>,
    ),
    queryFn: ({ signal }) =>
      listGeneralLedger(query as GeneralLedgerQuery, signal),
    enabled,
    placeholderData: (previous) => previous,
  });
}
