import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  CreateInventoryUnitConversionInput,
  InventoryUnitConversion,
  InventoryUnitConversionListQuery,
} from '@/api/contracts';
import {
  createUnitConversion,
  listUnitConversions,
} from '@/api/inventory-master.api';
import { isOtherOrganizationScope, queryKeys } from '@/api/query-keys';
import type { AdminListState } from '@/lib/use-admin-list-state';

/**
 * Unit conversion reads and the ONE mutation the resource has.
 *
 * A conversion is an effective-dated VERSION (ADR-0020 §4): correcting a
 * factor means creating a new version that supersedes the old one — never
 * editing in place. That is why there is no update or lifecycle mutation
 * here, and why the list is read with an explicit scope
 * (`global` pairs vs one item's pairs).
 *
 * Sort whitelist: validFrom | validTo | createdAt.
 */

export const UNIT_CONVERSION_SORT_FIELDS: readonly string[] = [
  'validFrom',
  'validTo',
  'createdAt',
];
export const UNIT_CONVERSION_DEFAULT_SORT = 'validFrom:desc';

export interface ConversionScopeState {
  scope: 'global' | 'item';
  itemId: string;
}

export function buildConversionListQuery(
  organizationId: string,
  state: AdminListState,
  scope: ConversionScopeState,
): InventoryUnitConversionListQuery {
  return {
    organizationId,
    scope: scope.scope,
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    // The backend requires `itemId` when scope = item.
    ...(scope.scope === 'item' && scope.itemId !== ''
      ? { itemId: scope.itemId }
      : {}),
  };
}

export function useUnitConversionList(
  organizationId: string | null,
  state: AdminListState,
  scope: ConversionScopeState,
) {
  const enabled = organizationId !== null;
  const query = enabled
    ? buildConversionListQuery(organizationId as string, state, scope)
    : null;

  return useQuery({
    queryKey: queryKeys.inventory.unitConversionList(
      organizationId ?? 'none',
      (query ?? {}) as Record<string, unknown>,
    ),
    queryFn: ({ signal }) =>
      listUnitConversions(query as InventoryUnitConversionListQuery, signal),
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

/** A new version closes the previous open-ended one — invalidate everything. */
export function useCreateUnitConversionMutation(
  organizationId: string,
): UseMutationResult<
  InventoryUnitConversion,
  Error,
  Omit<CreateInventoryUnitConversionInput, 'organizationId'>
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['inventory', organizationId, 'unit-conversions', 'create'],
    mutationFn: (
      values: Omit<CreateInventoryUnitConversionInput, 'organizationId'>,
    ) => createUnitConversion({ ...values, organizationId }),
    onSuccess: () => {
      void queryClient
        .invalidateQueries({
          queryKey: queryKeys.inventory.unitConversionPrefix(organizationId),
        })
        .then(
          () => undefined,
          () => undefined,
        );
    },
  });
}
