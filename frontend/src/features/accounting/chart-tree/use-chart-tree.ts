import { useQuery } from '@tanstack/react-query';
import { fetchChartTreePages } from '@/api/accounting.api';
import { queryKeys } from '@/api/query-keys';

/**
 * Chart tree of the current organization.
 *
 * Organization scope is part of the query key, so the cache can never serve
 * one organization's chart for another.
 */
export function useChartTree(organizationId: string | null) {
  return useQuery({
    queryKey: queryKeys.accounting.chartTree(organizationId ?? 'none'),
    queryFn: ({ signal }) =>
      fetchChartTreePages(organizationId as string, signal),
    enabled: organizationId !== null,
    staleTime: 60_000,
  });
}
