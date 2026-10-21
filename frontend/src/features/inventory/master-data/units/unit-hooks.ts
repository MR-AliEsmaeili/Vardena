import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  CreateInventoryUnitInput,
  InventoryUnit,
  InventoryUnitListQuery,
  UpdateInventoryUnitInput,
} from '@/api/contracts';
import {
  createUnit,
  getUnitAdmin,
  listUnitsAdmin,
  setUnitActive,
  updateUnit,
} from '@/api/inventory-master.api';
import { isOtherOrganizationScope, queryKeys } from '@/api/query-keys';
import type { AdminListState } from '@/lib/use-admin-list-state';

/**
 * Unit queries and mutations (`UnitsController`).
 *
 * Contract rules implemented here:
 * - paging, sorting and filtering are SERVER side; the module only forwards
 *   the declared query parameters (`code`/`name`/`createdAt`/`updatedAt` sort
 *   whitelist, `isActive`, `search`);
 * - every key and every request carries the organization id, so an
 *   organization switch can never serve another organization's units;
 * - mutations are never optimistic and are never auto-retried; the server's
 *   own response is written into the detail cache and the units prefix is
 *   invalidated (admin lists, detail and every picker live under it).
 */

export const UNIT_SORT_FIELDS: readonly string[] = [
  'code',
  'name',
  'createdAt',
  'updatedAt',
];
export const UNIT_DEFAULT_SORT = 'code:asc';

export function buildUnitListQuery(
  organizationId: string,
  state: AdminListState,
): InventoryUnitListQuery {
  return {
    organizationId,
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    ...(state.search.trim() !== '' ? { search: state.search.trim() } : {}),
    ...(state.isActive !== undefined ? { isActive: state.isActive } : {}),
  };
}

export function useUnitList(
  organizationId: string | null,
  state: AdminListState,
) {
  const enabled = organizationId !== null;
  const query = enabled
    ? buildUnitListQuery(organizationId as string, state)
    : null;

  return useQuery({
    queryKey: queryKeys.inventory.unitList(
      organizationId ?? 'none',
      (query ?? {}) as Record<string, unknown>,
    ),
    queryFn: ({ signal }) =>
      listUnitsAdmin(query as InventoryUnitListQuery, signal),
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

export function useUnitDetail(
  organizationId: string | null,
  unitId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.inventory.unitDetail(
      organizationId ?? 'none',
      unitId ?? 'none',
    ),
    queryFn: ({ signal }) =>
      getUnitAdmin(organizationId as string, unitId as string, signal),
    enabled: organizationId !== null && unitId !== undefined,
  });
}

/** Refresh every unit list, detail and picker of this organization. */
function useUnitInvalidation(organizationId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient
      .invalidateQueries({
        queryKey: queryKeys.inventory.unitPrefix(organizationId),
      })
      .then(
        () => undefined,
        () => undefined,
      );
  };
}

function useUnitCacheUpdate(organizationId: string) {
  const queryClient = useQueryClient();
  return (unit: InventoryUnit) => {
    queryClient.setQueryData(
      queryKeys.inventory.unitDetail(organizationId, unit.id),
      unit,
    );
  };
}

export function useCreateUnitMutation(
  organizationId: string,
): UseMutationResult<
  InventoryUnit,
  Error,
  Omit<CreateInventoryUnitInput, 'organizationId'>
> {
  const invalidate = useUnitInvalidation(organizationId);
  const cache = useUnitCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'units', 'create'],
    mutationFn: (values: Omit<CreateInventoryUnitInput, 'organizationId'>) =>
      createUnit({ ...values, organizationId }),
    onSuccess: (unit) => {
      cache(unit);
      invalidate();
    },
  });
}

export interface UpdateUnitVariables {
  unitId: string;
  values: UpdateInventoryUnitInput;
}

export function useUpdateUnitMutation(
  organizationId: string,
): UseMutationResult<InventoryUnit, Error, UpdateUnitVariables> {
  const invalidate = useUnitInvalidation(organizationId);
  const cache = useUnitCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'units', 'update'],
    mutationFn: ({ unitId, values }: UpdateUnitVariables) =>
      updateUnit(organizationId, unitId, values),
    onSuccess: (unit) => {
      cache(unit);
      invalidate();
    },
  });
}

/**
 * Enable / disable. There is no delete endpoint for units — the lifecycle is
 * the `is_active` flag (master-data-strategy.md §7.4).
 */
export function useUnitLifecycleMutation(
  organizationId: string,
): UseMutationResult<
  InventoryUnit,
  Error,
  { unitId: string; action: 'enable' | 'disable' }
> {
  const invalidate = useUnitInvalidation(organizationId);
  const cache = useUnitCacheUpdate(organizationId);
  return useMutation({
    mutationKey: ['inventory', organizationId, 'units', 'lifecycle'],
    mutationFn: ({
      unitId,
      action,
    }: {
      unitId: string;
      action: 'enable' | 'disable';
    }) => setUnitActive(organizationId, unitId, action),
    onSuccess: (unit) => {
      cache(unit);
      invalidate();
    },
  });
}
