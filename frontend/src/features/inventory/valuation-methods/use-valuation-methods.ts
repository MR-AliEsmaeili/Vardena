import { useMemo } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type {
  ConfigureValuationMethodInput,
  ItemValuationMethod,
  ResolvedValuationMethod,
  ValuationMethodListQuery,
} from '@/api/contracts';
import {
  configureInventoryValuationMethod,
  listInventoryValuationMethods,
  resolveInventoryValuationMethod,
} from '@/api/inventory.api';
import { isOtherOrganizationScope, queryKeys } from '@/api/query-keys';
import { isBusinessDay } from '@/lib/datetime';
import { ADMIN_PAGE_SIZE_OPTIONS } from '@/lib/use-admin-list-state';

/**
 * Valuation-method reads, URL filter state, and the effective-dated write
 * (INV-04, ADR-0039).
 *
 * Backend sort allow-list (`InventoryValuationService.listMethods`):
 * ONLY `validFrom` and `createdAt` (default `validFrom:desc`). `validTo` is
 * NOT in the server's `resolveSort` map and is therefore never sent.
 */

export const VALUATION_METHOD_SORT_OPTIONS = [
  'validFrom:desc',
  'validFrom:asc',
  'createdAt:desc',
  'createdAt:asc',
] as const;

export type ValuationMethodSort =
  (typeof VALUATION_METHOD_SORT_OPTIONS)[number];

export const DEFAULT_VALUATION_METHOD_SORT: ValuationMethodSort =
  'validFrom:desc';

const DEFAULT_PAGE_SIZE = 25;

export interface ValuationMethodsUrlPatch {
  itemId?: string | null;
  activeAt?: string | null;
  sort?: ValuationMethodSort | null;
  page?: number | null;
  pageSize?: number | null;
  resolveItemId?: string | null;
  resolveAsOf?: string | null;
}

export interface ValuationMethodsListState {
  itemId: string;
  activeAt: string;
  hasInvalidActiveAt: boolean;
  sort: ValuationMethodSort;
  page: number;
  pageSize: number;
  resolveItemId: string;
  resolveAsOf: string;
  update: (patch: ValuationMethodsUrlPatch) => void;
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

function parsePageSize(raw: string | null): number {
  const parsed = parsePositiveInt(raw, DEFAULT_PAGE_SIZE);
  return (ADMIN_PAGE_SIZE_OPTIONS as readonly number[]).includes(parsed)
    ? parsed
    : DEFAULT_PAGE_SIZE;
}

function parseSort(raw: string | null): ValuationMethodSort {
  return raw !== null &&
    (VALUATION_METHOD_SORT_OPTIONS as readonly string[]).includes(raw)
    ? (raw as ValuationMethodSort)
    : DEFAULT_VALUATION_METHOD_SORT;
}

export function useValuationMethodsListState(): ValuationMethodsListState {
  const [params, setParams] = useSearchParams();

  const itemId = (params.get('itemId') ?? '').trim();
  const activeAt = (params.get('activeAt') ?? '').trim();
  const hasInvalidActiveAt = activeAt !== '' && !isBusinessDay(activeAt);
  const sort = parseSort(params.get('sort'));
  const page = parsePositiveInt(params.get('page'), 1);
  const pageSize = parsePageSize(params.get('pageSize'));
  const resolveItemId = (params.get('resolveItemId') ?? '').trim();
  const resolveAsOf = (params.get('resolveAsOf') ?? '').trim();

  const update = (patch: ValuationMethodsUrlPatch) => {
    setParams((current) => {
      const next = new URLSearchParams(current);

      const setOrDelete = (key: string, value: string | null | undefined) => {
        if (value === undefined) return;
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      };

      setOrDelete('itemId', patch.itemId);
      setOrDelete('activeAt', patch.activeAt);
      if (patch.sort !== undefined) {
        if (
          patch.sort === null ||
          patch.sort === DEFAULT_VALUATION_METHOD_SORT
        ) {
          next.delete('sort');
        } else {
          next.set('sort', patch.sort);
        }
      }
      if (patch.page !== undefined) {
        if (patch.page === null || patch.page <= 1) next.delete('page');
        else next.set('page', String(patch.page));
      }
      if (patch.pageSize !== undefined) {
        if (patch.pageSize === null || patch.pageSize === DEFAULT_PAGE_SIZE) {
          next.delete('pageSize');
        } else {
          next.set('pageSize', String(patch.pageSize));
        }
      }
      setOrDelete('resolveItemId', patch.resolveItemId);
      setOrDelete('resolveAsOf', patch.resolveAsOf);

      return next;
    });
  };

  return {
    itemId,
    activeAt,
    hasInvalidActiveAt,
    sort,
    page,
    pageSize,
    resolveItemId,
    resolveAsOf,
    update,
  };
}

export interface ValuationMethodsFilterInput {
  itemId: string;
  activeAt: string;
  hasInvalidActiveAt?: boolean;
  sort: ValuationMethodSort;
  page: number;
  pageSize: number;
}

export function buildValuationMethodsListQuery(
  organizationId: string,
  state: ValuationMethodsFilterInput,
): ValuationMethodListQuery {
  return {
    organizationId,
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    ...(state.itemId !== '' ? { itemId: state.itemId } : {}),
    ...(state.activeAt !== '' ? { activeAt: state.activeAt } : {}),
  };
}

export function useValuationMethods(
  organizationId: string | null,
  state: ValuationMethodsFilterInput,
) {
  const { page, pageSize, sort, itemId, activeAt, hasInvalidActiveAt } = state;
  const invalidActiveAt =
    hasInvalidActiveAt ?? (activeAt !== '' && !isBusinessDay(activeAt));
  const enabled = organizationId !== null && !invalidActiveAt;

  const query = useMemo(
    () =>
      enabled
        ? buildValuationMethodsListQuery(organizationId as string, {
            page,
            pageSize,
            sort,
            itemId,
            activeAt,
          })
        : null,
    [enabled, organizationId, page, pageSize, sort, itemId, activeAt],
  );

  const filters = useMemo<Record<string, unknown>>(
    () => ({
      page,
      pageSize,
      sort,
      ...(itemId !== '' ? { itemId } : {}),
      ...(activeAt !== '' ? { activeAt } : {}),
    }),
    [page, pageSize, sort, itemId, activeAt],
  );

  return useQuery({
    queryKey: queryKeys.inventory.valuationMethods(
      organizationId ?? 'none',
      filters,
    ),
    queryFn: ({ signal }) =>
      listInventoryValuationMethods(query as ValuationMethodListQuery, signal),
    enabled,
    staleTime: 30_000,
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

export interface ResolveValuationMethodInput {
  itemId: string;
  asOf: string;
}

export function useResolveValuationMethod(
  organizationId: string | null,
  params: ResolveValuationMethodInput | null,
) {
  const itemId = params?.itemId.trim() ?? '';
  const asOf = params?.asOf.trim() ?? '';
  const enabled =
    organizationId !== null && itemId !== '' && isBusinessDay(asOf);

  return useQuery<ResolvedValuationMethod>({
    queryKey: queryKeys.inventory.valuationMethodResolve(
      organizationId ?? 'none',
      { itemId, asOf },
    ),
    queryFn: ({ signal }) =>
      resolveInventoryValuationMethod(
        {
          organizationId: organizationId as string,
          itemId,
          asOf,
        },
        signal,
      ),
    enabled,
    staleTime: 30_000,
  });
}

export type ConfigureValuationMethodVariables = Omit<
  ConfigureValuationMethodInput,
  'organizationId'
>;

export function useConfigureValuationMethodMutation(
  organizationId: string,
): UseMutationResult<
  ItemValuationMethod,
  Error,
  ConfigureValuationMethodVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['inventory', organizationId, 'valuation-methods', 'create'],
    mutationFn: (values: ConfigureValuationMethodVariables) =>
      configureInventoryValuationMethod({
        organizationId,
        ...values,
      }),
    onSuccess: () => {
      const prefixes = [
        queryKeys.inventory.valuationMethodsPrefix(organizationId),
        queryKeys.inventory.valuationStatesPrefix(organizationId),
      ];
      void Promise.all(
        prefixes.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }).then(
            () => undefined,
            () => undefined,
          ),
        ),
      );
    },
  });
}
