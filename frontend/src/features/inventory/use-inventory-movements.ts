import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { SortingState } from '@tanstack/react-table';
import { listInventoryMovements } from '@/api/inventory.api';
import type { InventoryMovementListQuery, MovementType } from '@/api/contracts';
import { isOtherOrganizationScope, queryKeys } from '@/api/query-keys';
import { sortingFromParam } from '@/lib/sort-param';
import { businessDayToInstantIso } from '@/lib/datetime';
import { MOVEMENT_TYPE_LABELS } from './inventory-labels';

/**
 * URL-owned state of the movements workspace (standards.md §5): every
 * parameter maps 1:1 onto a query parameter `InventoryMovementsController`
 * actually declares, and unknown URL input is normalized away instead of
 * being forwarded to the API (which would answer 400).
 */

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 50;

/** The backend's own default order made explicit in the URL. */
export const MOVEMENTS_DEFAULT_SORT = 'movementDate:desc';

/** Sort fields the movements endpoint allow-lists (its service). */
export const MOVEMENT_SORT_FIELDS = ['movementDate', 'createdAt'] as const;

export interface MovementsUrlState {
  page: number;
  pageSize: number;
  sort: string;
  warehouseId: string;
  itemId: string;
  movementType: MovementType | '';
  dateFrom: string;
  dateTo: string;
}

/** Movement types the single-post channel can actually filter by. */
export const MOVEMENT_TYPE_FILTERS = Object.keys(
  MOVEMENT_TYPE_LABELS,
) as readonly MovementType[];

export function hasActiveMovementFilters(state: MovementsUrlState): boolean {
  return (
    state.warehouseId !== '' ||
    state.itemId !== '' ||
    state.movementType !== '' ||
    state.dateFrom !== '' ||
    state.dateTo !== ''
  );
}

function parseMovementType(value: string | null): MovementType | '' {
  if (value === null) return '';
  return (MOVEMENT_TYPE_FILTERS as readonly string[]).includes(value)
    ? (value as MovementType)
    : '';
}

/** Normalize the URL into the state the UI renders (untrusted input). */
export function parseMovementsUrlState(
  params: URLSearchParams,
): MovementsUrlState {
  const pageValue = Number(params.get('page'));
  const page =
    Number.isInteger(pageValue) && pageValue >= 1 ? Math.trunc(pageValue) : 1;
  const pageSizeValue = Number(params.get('pageSize'));
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(
    pageSizeValue,
  )
    ? pageSizeValue
    : DEFAULT_PAGE_SIZE;

  const sorting = sortingFromParam(params.get('sort'), MOVEMENT_SORT_FIELDS);
  const sort =
    sorting.length > 0
      ? `${sorting[0]?.id ?? 'movementDate'}:${sorting[0]?.desc ? 'desc' : 'asc'}`
      : MOVEMENTS_DEFAULT_SORT;

  const dateFrom = params.get('dateFrom') ?? '';
  const dateTo = params.get('dateTo') ?? '';
  return {
    page,
    pageSize,
    sort,
    warehouseId: params.get('warehouseId') ?? '',
    itemId: params.get('itemId') ?? '',
    movementType: parseMovementType(params.get('movementType')),
    dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) ? dateFrom : '',
    dateTo: /^\d{4}-\d{2}-\d{2}$/.test(dateTo) ? dateTo : '',
  };
}

export type MovementsUrlUpdate = Partial<
  Omit<MovementsUrlState, 'page' | 'pageSize' | 'sort'>
> & {
  page?: number | null;
  pageSize?: number;
  sort?: string;
};

export function useMovementsUrlState() {
  const [params, setParams] = useSearchParams();
  const urlState = parseMovementsUrlState(params);

  const update = useCallback(
    (changes: MovementsUrlUpdate) => {
      setParams((current) => {
        const next = new URLSearchParams(current);
        const apply = (
          key: string,
          value: string | number | null | undefined,
        ) => {
          if (value === null || value === undefined || value === '') {
            next.delete(key);
          } else {
            next.set(key, String(value));
          }
        };
        const resetPage = 'page' in changes;
        for (const [key, value] of Object.entries(changes)) {
          if (key === 'page') continue;
          apply(
            key,
            key === 'sort' && value === MOVEMENTS_DEFAULT_SORT ? null : value,
          );
        }
        if (resetPage) {
          const page = changes.page;
          if (page === null || page === undefined || page === 1) {
            next.delete('page');
          } else {
            next.set('page', String(page));
          }
        }
        return next;
      });
    },
    [setParams],
  );

  const clearFilters = useCallback(() => {
    setParams(() => new URLSearchParams());
  }, [setParams]);

  return { state: urlState, update, clearFilters };
}

/** The exact query for the endpoint (only declared parameters, no more). */
export function buildMovementsQuery(
  organizationId: string,
  state: MovementsUrlState,
): InventoryMovementListQuery {
  return {
    organizationId,
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
    ...(state.warehouseId !== '' ? { warehouseId: state.warehouseId } : {}),
    ...(state.itemId !== '' ? { itemId: state.itemId } : {}),
    ...(state.movementType !== '' ? { movementType: state.movementType } : {}),
    // C-63: a day filter is the day's UTC-midnight instant (the ledger's day
    // convention), produced by the date/time layer rather than by hand.
    ...(state.dateFrom !== ''
      ? { dateFrom: businessDayToInstantIso(state.dateFrom) }
      : {}),
    ...(state.dateTo !== ''
      ? { dateTo: businessDayToInstantIso(state.dateTo) }
      : {}),
  };
}

export function movementsSortingState(sort: string): SortingState {
  return sortingFromParam(sort, MOVEMENT_SORT_FIELDS);
}

/** The movements list of the active organization. */
export function useMovementsList(
  organizationId: string | null,
  state: MovementsUrlState,
) {
  const enabled = organizationId !== null;
  const query = enabled
    ? buildMovementsQuery(organizationId as string, state)
    : null;

  return useQuery({
    queryKey: queryKeys.inventory.movements(
      organizationId ?? 'none',
      (query ?? {}) as Record<string, unknown>,
    ),
    queryFn: ({ signal }) =>
      listInventoryMovements(query as InventoryMovementListQuery, signal),
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
