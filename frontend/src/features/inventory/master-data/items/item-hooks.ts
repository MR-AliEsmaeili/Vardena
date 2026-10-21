import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  CreateInventoryItemInput,
  InventoryItem,
  InventoryItemListQuery,
  UpdateInventoryItemInput,
} from '@/api/contracts';
import {
  createItem,
  getItemAdmin,
  listItemsAdmin,
  setItemActive,
  updateItem,
} from '@/api/inventory-master.api';
import { isOtherOrganizationScope, queryKeys } from '@/api/query-keys';
import type { AdminListState } from '@/lib/use-admin-list-state';

/**
 * Item queries and mutations (`ItemsController`).
 *
 * Two contract facts shape this module:
 * - `itemKind` is CREATE-ONLY — it is immutable afterwards, so the update
 *   mutation never sends it and the edit form renders it read-only;
 * - clearing a group (`itemGroupId: null`) and clearing the negative-stock
 *   override are legal updates, so update inputs keep them nullable.
 *
 * Sort whitelist: code | name | itemKind | createdAt | updatedAt.
 */

export const ITEM_SORT_FIELDS: readonly string[] = [
  'code',
  'name',
  'itemKind',
  'createdAt',
  'updatedAt',
];
export const ITEM_DEFAULT_SORT = 'code:asc';

export interface ItemListExtras {
  itemKind: string;
  itemGroupId: string;
}

export function buildItemListQuery(
  organizationId: string,
  state: AdminListState,
  extras: ItemListExtras,
): InventoryItemListQuery {
  return {
    organizationId,
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    ...(state.search.trim() !== '' ? { search: state.search.trim() } : {}),
    ...(state.isActive !== undefined ? { isActive: state.isActive } : {}),
    ...(extras.itemKind !== ''
      ? {
          itemKind: extras.itemKind as NonNullable<
            InventoryItemListQuery['itemKind']
          >,
        }
      : {}),
    ...(extras.itemGroupId !== '' ? { itemGroupId: extras.itemGroupId } : {}),
  };
}

export function useItemList(
  organizationId: string | null,
  state: AdminListState,
  extras: ItemListExtras,
) {
  const enabled = organizationId !== null;
  const query = enabled
    ? buildItemListQuery(organizationId as string, state, extras)
    : null;

  return useQuery({
    queryKey: queryKeys.inventory.itemList(
      organizationId ?? 'none',
      (query ?? {}) as Record<string, unknown>,
    ),
    queryFn: ({ signal }) =>
      listItemsAdmin(query as InventoryItemListQuery, signal),
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

export function useItemDetail(
  organizationId: string | null,
  itemId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.inventory.itemDetail(
      organizationId ?? 'none',
      itemId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getItemAdmin(organizationId as string, itemId as string, signal),
    enabled: organizationId !== null && itemId !== undefined,
  });
}

function useItemInvalidation(organizationId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient
      .invalidateQueries({
        queryKey: queryKeys.inventory.itemPrefix(organizationId),
      })
      .then(
        () => undefined,
        () => undefined,
      );
  };
}

function useItemCacheUpdate(organizationId: string) {
  const queryClient = useQueryClient();
  return (item: InventoryItem) => {
    queryClient.setQueryData(
      queryKeys.inventory.itemDetail(organizationId, item.id),
      item,
    );
  };
}

export function useCreateItemMutation(
  organizationId: string,
): UseMutationResult<
  InventoryItem,
  Error,
  Omit<CreateInventoryItemInput, 'organizationId'>
> {
  const invalidate = useItemInvalidation(organizationId);
  const cache = useItemCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'items', 'create'],
    mutationFn: (values: Omit<CreateInventoryItemInput, 'organizationId'>) =>
      createItem({ ...values, organizationId }),
    onSuccess: (item) => {
      cache(item);
      invalidate();
    },
  });
}

export interface UpdateItemVariables {
  itemId: string;
  values: UpdateInventoryItemInput;
}

export function useUpdateItemMutation(
  organizationId: string,
): UseMutationResult<InventoryItem, Error, UpdateItemVariables> {
  const invalidate = useItemInvalidation(organizationId);
  const cache = useItemCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'items', 'update'],
    mutationFn: ({ itemId, values }: UpdateItemVariables) =>
      updateItem(organizationId, itemId, values),
    onSuccess: (item) => {
      cache(item);
      invalidate();
    },
  });
}

export function useItemLifecycleMutation(
  organizationId: string,
): UseMutationResult<
  InventoryItem,
  Error,
  { itemId: string; action: 'enable' | 'disable' }
> {
  const invalidate = useItemInvalidation(organizationId);
  const cache = useItemCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'items', 'lifecycle'],
    mutationFn: ({
      itemId,
      action,
    }: {
      itemId: string;
      action: 'enable' | 'disable';
    }) => setItemActive(organizationId, itemId, action),
    onSuccess: (item) => {
      cache(item);
      invalidate();
    },
  });
}
