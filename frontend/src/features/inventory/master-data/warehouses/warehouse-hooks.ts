import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  CreateInventoryWarehouseInput,
  InventoryWarehouse,
  InventoryWarehouseListQuery,
  UpdateInventoryWarehouseInput,
} from '@/api/contracts';
import {
  createWarehouse,
  getWarehouseAdmin,
  listWarehousesAdmin,
  setWarehouseActive,
  updateWarehouse,
} from '@/api/inventory-master.api';
import { isOtherOrganizationScope, queryKeys } from '@/api/query-keys';
import type { AdminListState } from '@/lib/use-admin-list-state';

/**
 * Warehouse queries and mutations (`WarehousesController`).
 *
 * A warehouse belongs to one branch of the same organization; the service
 * refuses an inactive/out-of-scope branch with a 422/404. Lifecycle is
 * enable/disable — no delete — and every mutation invalidates the whole
 * warehouse prefix so the operation pickers refresh with it.
 */

export const WAREHOUSE_SORT_FIELDS: readonly string[] = [
  'code',
  'name',
  'createdAt',
  'updatedAt',
];
export const WAREHOUSE_DEFAULT_SORT = 'code:asc';

export function buildWarehouseListQuery(
  organizationId: string,
  state: AdminListState,
  branchId: string,
): InventoryWarehouseListQuery {
  return {
    organizationId,
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    ...(state.search.trim() !== '' ? { search: state.search.trim() } : {}),
    ...(state.isActive !== undefined ? { isActive: state.isActive } : {}),
    ...(branchId.trim() !== '' ? { branchId: branchId.trim() } : {}),
  };
}

export function useWarehouseList(
  organizationId: string | null,
  state: AdminListState,
  branchId: string,
) {
  const enabled = organizationId !== null;
  const query = enabled
    ? buildWarehouseListQuery(organizationId as string, state, branchId)
    : null;

  return useQuery({
    queryKey: queryKeys.inventory.warehouseList(
      organizationId ?? 'none',
      (query ?? {}) as Record<string, unknown>,
    ),
    queryFn: ({ signal }) =>
      listWarehousesAdmin(query as InventoryWarehouseListQuery, signal),
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

export function useWarehouseDetail(
  organizationId: string | null,
  warehouseId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.inventory.warehouseDetail(
      organizationId ?? 'none',
      warehouseId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getWarehouseAdmin(
        organizationId as string,
        warehouseId as string,
        signal,
      ),
    enabled: organizationId !== null && warehouseId !== undefined,
  });
}

function useWarehouseInvalidation(organizationId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient
      .invalidateQueries({
        queryKey: queryKeys.inventory.warehousePrefix(organizationId),
      })
      .then(
        () => undefined,
        () => undefined,
      );
  };
}

function useWarehouseCacheUpdate(organizationId: string) {
  const queryClient = useQueryClient();
  return (warehouse: InventoryWarehouse) => {
    queryClient.setQueryData(
      queryKeys.inventory.warehouseDetail(organizationId, warehouse.id),
      warehouse,
    );
  };
}

export function useCreateWarehouseMutation(
  organizationId: string,
): UseMutationResult<
  InventoryWarehouse,
  Error,
  Omit<CreateInventoryWarehouseInput, 'organizationId'>
> {
  const invalidate = useWarehouseInvalidation(organizationId);
  const cache = useWarehouseCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'warehouses', 'create'],
    mutationFn: (
      values: Omit<CreateInventoryWarehouseInput, 'organizationId'>,
    ) => createWarehouse({ ...values, organizationId }),
    onSuccess: (warehouse) => {
      cache(warehouse);
      invalidate();
    },
  });
}

export interface UpdateWarehouseVariables {
  warehouseId: string;
  values: UpdateInventoryWarehouseInput;
}

export function useUpdateWarehouseMutation(
  organizationId: string,
): UseMutationResult<InventoryWarehouse, Error, UpdateWarehouseVariables> {
  const invalidate = useWarehouseInvalidation(organizationId);
  const cache = useWarehouseCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'warehouses', 'update'],
    mutationFn: ({ warehouseId, values }: UpdateWarehouseVariables) =>
      updateWarehouse(organizationId, warehouseId, values),
    onSuccess: (warehouse) => {
      cache(warehouse);
      invalidate();
    },
  });
}

export function useWarehouseLifecycleMutation(
  organizationId: string,
): UseMutationResult<
  InventoryWarehouse,
  Error,
  { warehouseId: string; action: 'enable' | 'disable' }
> {
  const invalidate = useWarehouseInvalidation(organizationId);
  const cache = useWarehouseCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'warehouses', 'lifecycle'],
    mutationFn: ({
      warehouseId,
      action,
    }: {
      warehouseId: string;
      action: 'enable' | 'disable';
    }) => setWarehouseActive(organizationId, warehouseId, action),
    onSuccess: (warehouse) => {
      cache(warehouse);
      invalidate();
    },
  });
}
