import { useQuery } from '@tanstack/react-query';
import { listBalances } from '@/api/inventory-master.api';
import { isOtherOrganizationScope, queryKeys } from '@/api/query-keys';
import type { AdminListState } from '@/lib/use-admin-list-state';

/**
 * Stock balances (`GET /inventory/balances`) — a READ-TIME projection, not
 * master data: there is nothing to create, edit, enable or disable here.
 * Every number is an exact decimal string from the backend; the page only
 * formats it.
 *
 * The endpoint has no `search` and no `isActive` — its own filters are
 * branch / warehouse / item, and its sort whitelist is
 * onHand | updatedAt | createdAt.
 */

export const BALANCE_SORT_FIELDS: readonly string[] = [
  'onHand',
  'createdAt',
  'updatedAt',
];
export const BALANCE_DEFAULT_SORT = 'updatedAt:desc';

export interface BalanceListExtras {
  warehouseId: string;
  itemId: string;
}

export function buildBalanceListQuery(
  organizationId: string,
  state: AdminListState,
  extras: BalanceListExtras,
) {
  return {
    organizationId,
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    ...(extras.warehouseId !== '' ? { warehouseId: extras.warehouseId } : {}),
    ...(extras.itemId !== '' ? { itemId: extras.itemId } : {}),
  };
}

export function useBalanceList(
  organizationId: string | null,
  state: AdminListState,
  extras: BalanceListExtras,
) {
  const enabled = organizationId !== null;
  const query = enabled
    ? buildBalanceListQuery(organizationId as string, state, extras)
    : null;

  return useQuery({
    queryKey: queryKeys.inventory.balances(
      organizationId ?? 'none',
      (query ?? {}) as Record<string, unknown>,
    ),
    queryFn: ({ signal }) =>
      listBalances(query as NonNullable<typeof query>, signal),
    enabled,
    placeholderData: (previous, previousQuery) =>
      previousQuery !== undefined &&
      !isOtherOrganizationScope(
        previousQuery.queryKey,
        organizationId ?? 'none',
      )
        ? previous
        : undefined,
  });
}
