import { useQuery } from '@tanstack/react-query';
import {
  listAccountingPeriods,
  listFinancialAreas,
  listFiscalYears,
  listPostableAccounts,
} from '@/api/accounting.api';
import { queryKeys } from '@/api/query-keys';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';

/**
 * Reference data for the accounting report filters.
 *
 * Each list is a real, organization-scoped endpoint of the Accounting module
 * and each is gated by its own backend permission, so the hooks stay disabled
 * when the session clearly lacks it (a guaranteed 403 is not worth sending).
 * Every query key carries the organization id, so switching organization can
 * never reuse another organization's reference data.
 */

export function useFinancialAreas(organizationId: string | null) {
  const permissions = usePermissions();
  return useQuery({
    queryKey: queryKeys.accounting.financialAreas(organizationId ?? 'none'),
    queryFn: ({ signal }) =>
      listFinancialAreas({ organizationId: organizationId as string }, signal),
    enabled:
      organizationId !== null &&
      permissions.loaded &&
      permissions.has(PERMISSIONS.accounting.financialAreaView),
    staleTime: 5 * 60_000,
  });
}

export function useFiscalYears(
  organizationId: string | null,
  financialAreaId: string | null,
) {
  const permissions = usePermissions();
  return useQuery({
    queryKey: queryKeys.accounting.fiscalYears(
      organizationId ?? 'none',
      financialAreaId,
    ),
    queryFn: ({ signal }) =>
      listFiscalYears(
        {
          organizationId: organizationId as string,
          financialAreaId: financialAreaId ?? undefined,
        },
        signal,
      ),
    enabled:
      organizationId !== null &&
      permissions.loaded &&
      permissions.has(PERMISSIONS.accounting.fiscalYearView),
    staleTime: 5 * 60_000,
  });
}

export function useAccountingPeriods(
  organizationId: string | null,
  fiscalYearId: string | null,
) {
  const permissions = usePermissions();
  return useQuery({
    queryKey: queryKeys.accounting.accountingPeriods(
      organizationId ?? 'none',
      fiscalYearId,
    ),
    queryFn: ({ signal }) =>
      listAccountingPeriods(
        {
          organizationId: organizationId as string,
          fiscalYearId: fiscalYearId as string,
        },
        signal,
      ),
    enabled:
      organizationId !== null &&
      fiscalYearId !== null &&
      permissions.loaded &&
      permissions.has(PERMISSIONS.accounting.accountingPeriodView),
    staleTime: 5 * 60_000,
  });
}

/**
 * Postable accounts for the statement picker. The search term is sent to the
 * API (`search`) — the chart is never downloaded to filter it locally.
 */
export function usePostableAccounts(
  organizationId: string | null,
  search: string,
) {
  const permissions = usePermissions();
  const trimmed = search.trim();
  return useQuery({
    queryKey: queryKeys.accounting.postableAccounts(
      organizationId ?? 'none',
      trimmed,
    ),
    queryFn: ({ signal }) =>
      listPostableAccounts(
        {
          organizationId: organizationId as string,
          search: trimmed === '' ? undefined : trimmed,
        },
        signal,
      ),
    enabled:
      organizationId !== null &&
      permissions.loaded &&
      permissions.has(PERMISSIONS.accounting.accountView),
    staleTime: 60_000,
  });
}
