import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SortingState } from '@tanstack/react-table';
import type { InventoryReservationStatus } from '@/api/contracts';
import { sortingFromParam } from '@/lib/sort-param';

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 50;

/** Only fields allow-listed by InventoryReservationsService.resolveSort. */
export const RESERVATION_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'status',
] as const;
export const RESERVATIONS_DEFAULT_SORT = 'createdAt:desc';

export interface ReservationsUrlState {
  page: number;
  pageSize: number;
  sort: string;
  warehouseId: string;
  itemId: string;
  status: InventoryReservationStatus | '';
}

export function hasActiveReservationsFilters(
  state: ReservationsUrlState,
): boolean {
  return state.warehouseId !== '' || state.itemId !== '' || state.status !== '';
}

function parseStatus(value: string | null): InventoryReservationStatus | '' {
  return value === 'active' || value === 'released' ? value : '';
}

/** Normalize deep links before they reach the strict API query DTO. */
export function parseReservationsUrlState(
  params: URLSearchParams,
): ReservationsUrlState {
  const pageValue = Number(params.get('page'));
  const page = Number.isInteger(pageValue) && pageValue >= 1 ? pageValue : 1;
  const pageSizeValue = Number(params.get('pageSize'));
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(
    pageSizeValue,
  )
    ? pageSizeValue
    : DEFAULT_PAGE_SIZE;
  const sorting = sortingFromParam(params.get('sort'), RESERVATION_SORT_FIELDS);
  const first = sorting[0];
  const sort =
    first === undefined
      ? RESERVATIONS_DEFAULT_SORT
      : `${first.id}:${first.desc ? 'desc' : 'asc'}`;

  return {
    page,
    pageSize,
    sort,
    warehouseId: params.get('warehouseId') ?? '',
    itemId: params.get('itemId') ?? '',
    status: parseStatus(params.get('status')),
  };
}

export type ReservationsUrlUpdate = Partial<
  Omit<ReservationsUrlState, 'page' | 'pageSize' | 'sort'>
> & {
  page?: number | null;
  pageSize?: number;
  sort?: string;
};

/** URL-owned filters, sorting and pagination for the reservation table. */
export function useReservationsUrlState() {
  const [params, setParams] = useSearchParams();
  const state = parseReservationsUrlState(params);

  const update = useCallback(
    (changes: ReservationsUrlUpdate) => {
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
            key === 'sort' && value === RESERVATIONS_DEFAULT_SORT
              ? null
              : value,
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

  return { state, update, clearFilters };
}

export function reservationsSortingState(sort: string): SortingState {
  return sortingFromParam(sort, RESERVATION_SORT_FIELDS);
}
