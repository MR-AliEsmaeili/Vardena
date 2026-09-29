import { useQuery } from '@tanstack/react-query';
import { listFinancialAreas, listFiscalYears } from '@/api/accounting.api';
import { queryKeys } from '@/api/query-keys';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';

/**
 * Accounting reference data for the dashboard scope.
 *
 * The dashboard reads the accounting module's reference lists through the
 * application-wide API layer (`src/api`) — never through the accounting
 * feature — so feature boundaries stay intact while the query keys (and
 * therefore the HTTP cache) remain shared with the screens that own those
 * lists. Each hook is disabled without the endpoint's backend permission
 * (UX gating, AR-21) and carries the organization id in its key.
 */

export function useDashboardFinancialAreas(organizationId: string | null) {
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

export function useDashboardFiscalYears(
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
