import { useQuery } from '@tanstack/react-query';
import { getAccountStatement } from '@/api/accounting.api';
import type { AccountStatementQuery } from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';
import {
  optionalParam,
  type StatementScopeValues,
} from '@/features/accounting/shared/report-filters';

export interface AccountStatementRequest {
  organizationId: string | null;
  filters: StatementScopeValues | null;
  page: number;
  pageSize: number;
}

/**
 * Build the exact query the endpoint declares.
 *
 * `organizationId`, `accountId` and `fiscalYearId` are required by the
 * contract; the financial area and the accounting period are optional
 * narrowing parameters. No `sort` is ever sent: the statement order is fixed
 * (`documentDate, voucherNumber, lineNo, id`) and an explicit sort is
 * rejected with 400.
 */
export function buildAccountStatementQuery(
  organizationId: string,
  filters: StatementScopeValues,
  page: number,
  pageSize: number,
): AccountStatementQuery {
  return {
    organizationId,
    accountId: filters.accountId,
    fiscalYearId: filters.fiscalYearId,
    financialAreaId: optionalParam(filters.financialAreaId),
    accountingPeriodId: optionalParam(filters.accountingPeriodId),
    page,
    pageSize,
  } as AccountStatementQuery;
}

export function useAccountStatement({
  organizationId,
  filters,
  page,
  pageSize,
}: AccountStatementRequest) {
  const enabled =
    organizationId !== null &&
    filters !== null &&
    filters.accountId !== '' &&
    filters.fiscalYearId !== '';

  const query = enabled
    ? buildAccountStatementQuery(organizationId, filters, page, pageSize)
    : null;

  return useQuery({
    queryKey: queryKeys.accounting.accountStatement(
      organizationId ?? 'none',
      (query ?? {}) as Record<string, unknown>,
    ),
    queryFn: ({ signal }) =>
      getAccountStatement(query as AccountStatementQuery, signal),
    enabled,
    placeholderData: (previous) => previous,
  });
}
