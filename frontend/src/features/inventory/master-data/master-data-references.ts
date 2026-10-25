import { useQuery } from '@tanstack/react-query';
import {
  listItemsAdmin,
  listItemGroupsAdmin,
  listUnitsAdmin,
  listWarehousesAdmin,
} from '@/api/inventory-master.api';
import { listBranches } from '@/api/organization.api';
import { queryKeys } from '@/api/query-keys';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';

/**
 * Reference reads behind the pickers of the inventory master-data feature
 * (a warehouse's branch, an item's group, a conversion's item/units).
 *
 * Same rules the organization feature encodes (`admin-references.ts`):
 * - each list is gated by the backend permission of its own endpoint;
 * - the query key carries the organization id;
 * - the window is BOUNDED — nothing fetches "everything"; a truncation is
 *   stated, never silently shown as a complete list;
 * - only ACTIVE records are offered where the backend would refuse an
 *   inactive reference (branches, units, groups, items in the pickers of
 *   transactional forms).
 */

export const REFERENCE_PAGE_SIZE = 200;

export interface ReferenceOptions<TItem> {
  items: TItem[];
  /** True when the organization holds more records than the window shows. */
  truncated: boolean;
  isPending: boolean;
  /** True when the session may not read this reference list at all. */
  unavailable: boolean;
}

/**
 * The part of a TanStack Query result this module reads.
 *
 * `data` — never the query object itself — carries the page: these endpoints
 * answer `{ items, total, page, pageSize }`, so `items`/`total` live one level
 * down. Reading them off the query result silently yields an empty list.
 */
interface Queryable {
  data?: { items?: unknown[]; total?: number } | undefined;
  isPending: boolean;
  isError: boolean;
  fetchStatus: string;
}

function toOptions<TItem>(
  query: Queryable,
  allowed: boolean,
  permissionsLoaded: boolean,
): ReferenceOptions<TItem> {
  const items = (query.data?.items ?? []) as TItem[];
  return {
    items,
    truncated: (query.data?.total ?? 0) > items.length,
    isPending: query.isPending && query.fetchStatus !== 'idle',
    unavailable: (permissionsLoaded && !allowed) || query.isError,
  };
}

/** Active branches — a warehouse must belong to one enabled branch. */
export function useActiveBranchOptions(organizationId: string | null) {
  const permissions = usePermissions();
  const allowed = permissions.has(PERMISSIONS.organization.branchView);
  const query = useQuery({
    queryKey: queryKeys.organizations.branchList(organizationId ?? 'none', {
      reference: 'active',
    }),
    queryFn: ({ signal }) =>
      listBranches(
        {
          organizationId: organizationId as string,
          isActive: true,
          page: 1,
          pageSize: REFERENCE_PAGE_SIZE,
          sort: 'code:asc',
        },
        signal,
      ),
    enabled: organizationId !== null && permissions.loaded && allowed,
    staleTime: 5 * 60_000,
  });

  return toOptions(query, allowed, permissions.loaded) as ReferenceOptions<{
    id: string;
    code: string;
    name: string;
  }>;
}

/** Active item groups — an item/group parent must be an active group. */
export function useActiveItemGroupOptions(organizationId: string | null) {
  const permissions = usePermissions();
  const allowed = permissions.has(PERMISSIONS.inventory.itemGroupView);
  const query = useQuery({
    queryKey: queryKeys.inventory.itemGroupList(organizationId ?? 'none', {
      reference: 'active',
    }),
    queryFn: ({ signal }) =>
      listItemGroupsAdmin(
        {
          organizationId: organizationId as string,
          isActive: true,
          page: 1,
          pageSize: REFERENCE_PAGE_SIZE,
          sort: 'code:asc',
        },
        signal,
      ),
    enabled: organizationId !== null && permissions.loaded && allowed,
    staleTime: 5 * 60_000,
  });

  return toOptions(query, allowed, permissions.loaded) as ReferenceOptions<{
    id: string;
    code: string;
    name: string;
  }>;
}

/** Active warehouses — for balance filters and availability reads. */
export function useActiveWarehouseOptions(organizationId: string | null) {
  const permissions = usePermissions();
  const allowed = permissions.has(PERMISSIONS.inventory.warehouseView);
  const query = useQuery({
    queryKey: queryKeys.inventory.warehouseList(organizationId ?? 'none', {
      reference: 'active',
    }),
    queryFn: ({ signal }) =>
      listWarehousesAdmin(
        {
          organizationId: organizationId as string,
          isActive: true,
          page: 1,
          pageSize: REFERENCE_PAGE_SIZE,
          sort: 'code:asc',
        },
        signal,
      ),
    enabled: organizationId !== null && permissions.loaded && allowed,
    staleTime: 5 * 60_000,
  });

  return toOptions(query, allowed, permissions.loaded) as ReferenceOptions<{
    id: string;
    code: string;
    name: string;
  }>;
}

/** Active units — an item's base unit must be an active unit. */
export function useActiveUnitOptions(organizationId: string | null) {
  const permissions = usePermissions();
  const allowed = permissions.has(PERMISSIONS.inventory.unitView);
  const query = useQuery({
    queryKey: queryKeys.inventory.unitList(organizationId ?? 'none', {
      reference: 'active',
    }),
    queryFn: ({ signal }) =>
      listUnitsAdmin(
        {
          organizationId: organizationId as string,
          isActive: true,
          page: 1,
          pageSize: REFERENCE_PAGE_SIZE,
          sort: 'code:asc',
        },
        signal,
      ),
    enabled: organizationId !== null && permissions.loaded && allowed,
    staleTime: 5 * 60_000,
  });

  return toOptions(query, allowed, permissions.loaded) as ReferenceOptions<{
    id: string;
    code: string;
    name: string;
  }>;
}

/** Active items — a conversion's scope item must be an active item. */
export function useActiveItemOptions(organizationId: string | null) {
  const permissions = usePermissions();
  const allowed = permissions.has(PERMISSIONS.inventory.itemView);
  const query = useQuery({
    queryKey: queryKeys.inventory.itemList(organizationId ?? 'none', {
      reference: 'active',
    }),
    queryFn: ({ signal }) =>
      listItemsAdmin(
        {
          organizationId: organizationId as string,
          isActive: true,
          page: 1,
          pageSize: REFERENCE_PAGE_SIZE,
          sort: 'code:asc',
        },
        signal,
      ),
    enabled: organizationId !== null && permissions.loaded && allowed,
    staleTime: 5 * 60_000,
  });

  return toOptions(query, allowed, permissions.loaded) as ReferenceOptions<{
    id: string;
    code: string;
    name: string;
  }>;
}
