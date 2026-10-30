import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SortingState } from '@tanstack/react-table';
import {
  MATERIAL_REQUEST_STATUSES,
  type MaterialRequestStatus,
} from '@/api/contracts';
import { sortingFromParam } from '@/lib/sort-param';

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 50;

/** Only fields allow-listed by `MaterialRequestsService` SORTABLE_FIELDS. */
export const MATERIAL_REQUEST_SORT_FIELDS = [
  'createdAt',
  'number',
  'status',
] as const;
export const MATERIAL_REQUESTS_DEFAULT_SORT = 'createdAt:desc';

/** ULID shape the backend's `@IsUlid()` accepts (Crockford base32, no I/L/O/U). */
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export interface MaterialRequestsUrlState {
  page: number;
  pageSize: number;
  sort: string;
  status: MaterialRequestStatus | '';
  /** Raw requester id; a value that is not a ULID is dropped (see below). */
  requestedBy: string;
}

export function hasActiveMaterialRequestsFilters(
  state: MaterialRequestsUrlState,
): boolean {
  return state.status !== '' || state.requestedBy !== '';
}

function parseStatus(value: string | null): MaterialRequestStatus | '' {
  return (MATERIAL_REQUEST_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as MaterialRequestStatus)
    : '';
}

/**
 * A deep link is untrusted input (standards.md §15): a `requestedBy` that is
 * not a ULID would make the strict query DTO answer `400`, so it is normalized
 * away BEFORE it reaches the API instead of failing the whole list.
 */
export function parseRequestedBy(value: string | null): string {
  const trimmed = (value ?? '').trim().toUpperCase();
  return ULID_PATTERN.test(trimmed) ? trimmed : '';
}

/** Normalize deep links before they reach the strict API query DTO. */
export function parseMaterialRequestsUrlState(
  params: URLSearchParams,
): MaterialRequestsUrlState {
  const pageValue = Number(params.get('page'));
  const page = Number.isInteger(pageValue) && pageValue >= 1 ? pageValue : 1;
  const pageSizeValue = Number(params.get('pageSize'));
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(
    pageSizeValue,
  )
    ? pageSizeValue
    : DEFAULT_PAGE_SIZE;
  const sorting = sortingFromParam(
    params.get('sort'),
    MATERIAL_REQUEST_SORT_FIELDS,
  );
  const first = sorting[0];
  const sort =
    first === undefined
      ? MATERIAL_REQUESTS_DEFAULT_SORT
      : `${first.id}:${first.desc ? 'desc' : 'asc'}`;

  return {
    page,
    pageSize,
    sort,
    status: parseStatus(params.get('status')),
    requestedBy: parseRequestedBy(params.get('requestedBy')),
  };
}

export type MaterialRequestsUrlUpdate = Partial<
  Omit<MaterialRequestsUrlState, 'page' | 'pageSize' | 'sort'>
> & {
  page?: number | null;
  pageSize?: number;
  sort?: string;
};

/** URL-owned filters, sorting and pagination for the request table. */
export function useMaterialRequestsUrlState() {
  const [params, setParams] = useSearchParams();
  const state = parseMaterialRequestsUrlState(params);

  const update = useCallback(
    (changes: MaterialRequestsUrlUpdate) => {
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
            key === 'sort' && value === MATERIAL_REQUESTS_DEFAULT_SORT
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

export function materialRequestsSortingState(sort: string): SortingState {
  return sortingFromParam(sort, MATERIAL_REQUEST_SORT_FIELDS);
}
