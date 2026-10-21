import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  CreateInventoryItemGroupInput,
  InventoryItemGroup,
  InventoryItemGroupListQuery,
  UpdateInventoryItemGroupInput,
} from '@/api/contracts';
import {
  createItemGroup,
  getItemGroupAdmin,
  listItemGroupsAdmin,
  setItemGroupActive,
  updateItemGroup,
} from '@/api/inventory-master.api';
import { isOtherOrganizationScope, queryKeys } from '@/api/query-keys';
import type { AdminListState } from '@/lib/use-admin-list-state';

/**
 * Item group queries and mutations (`ItemGroupsController`).
 *
 * Groups form a hierarchy: `parentId` selects one parent, the service owns
 * the "same organization, no cycle" rules, and `update` with `parentId: null`
 * moves a group back to the root. Lifecycle is enable/disable — no delete.
 */

export const ITEM_GROUP_SORT_FIELDS: readonly string[] = [
  'code',
  'name',
  'createdAt',
  'updatedAt',
];
export const ITEM_GROUP_DEFAULT_SORT = 'code:asc';

export function buildItemGroupListQuery(
  organizationId: string,
  state: AdminListState,
  parentId: string,
): InventoryItemGroupListQuery {
  return {
    organizationId,
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    ...(state.search.trim() !== '' ? { search: state.search.trim() } : {}),
    ...(state.isActive !== undefined ? { isActive: state.isActive } : {}),
    // `''` = every group (all roots and children together).
    ...(parentId.trim() !== '' ? { parentId: parentId.trim() } : {}),
  };
}

export function useItemGroupList(
  organizationId: string | null,
  state: AdminListState,
  parentId: string,
) {
  const enabled = organizationId !== null;
  const query = enabled
    ? buildItemGroupListQuery(organizationId as string, state, parentId)
    : null;

  return useQuery({
    queryKey: queryKeys.inventory.itemGroupList(
      organizationId ?? 'none',
      (query ?? {}) as Record<string, unknown>,
    ),
    queryFn: ({ signal }) =>
      listItemGroupsAdmin(query as InventoryItemGroupListQuery, signal),
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

export function useItemGroupDetail(
  organizationId: string | null,
  itemGroupId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.inventory.itemGroupDetail(
      organizationId ?? 'none',
      itemGroupId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getItemGroupAdmin(
        organizationId as string,
        itemGroupId as string,
        signal,
      ),
    enabled: organizationId !== null && itemGroupId !== undefined,
  });
}

function useItemGroupInvalidation(organizationId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient
      .invalidateQueries({
        queryKey: queryKeys.inventory.itemGroupPrefix(organizationId),
      })
      .then(
        () => undefined,
        () => undefined,
      );
  };
}

function useItemGroupCacheUpdate(organizationId: string) {
  const queryClient = useQueryClient();
  return (group: InventoryItemGroup) => {
    queryClient.setQueryData(
      queryKeys.inventory.itemGroupDetail(organizationId, group.id),
      group,
    );
  };
}

export function useCreateItemGroupMutation(
  organizationId: string,
): UseMutationResult<
  InventoryItemGroup,
  Error,
  Omit<CreateInventoryItemGroupInput, 'organizationId'>
> {
  const invalidate = useItemGroupInvalidation(organizationId);
  const cache = useItemGroupCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'item-groups', 'create'],
    mutationFn: (
      values: Omit<CreateInventoryItemGroupInput, 'organizationId'>,
    ) => createItemGroup({ ...values, organizationId }),
    onSuccess: (group) => {
      cache(group);
      invalidate();
    },
  });
}

export interface UpdateItemGroupVariables {
  itemGroupId: string;
  values: UpdateInventoryItemGroupInput;
}

export function useUpdateItemGroupMutation(
  organizationId: string,
): UseMutationResult<InventoryItemGroup, Error, UpdateItemGroupVariables> {
  const invalidate = useItemGroupInvalidation(organizationId);
  const cache = useItemGroupCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'item-groups', 'update'],
    mutationFn: ({ itemGroupId, values }: UpdateItemGroupVariables) =>
      updateItemGroup(organizationId, itemGroupId, values),
    onSuccess: (group) => {
      cache(group);
      invalidate();
    },
  });
}

export function useItemGroupLifecycleMutation(
  organizationId: string,
): UseMutationResult<
  InventoryItemGroup,
  Error,
  { itemGroupId: string; action: 'enable' | 'disable' }
> {
  const invalidate = useItemGroupInvalidation(organizationId);
  const cache = useItemGroupCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'item-groups', 'lifecycle'],
    mutationFn: ({
      itemGroupId,
      action,
    }: {
      itemGroupId: string;
      action: 'enable' | 'disable';
    }) => setItemGroupActive(organizationId, itemGroupId, action),
    onSuccess: (group) => {
      cache(group);
      invalidate();
    },
  });
}
