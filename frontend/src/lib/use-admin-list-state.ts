import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SortingState } from '@tanstack/react-table';
import { sortingFromParam } from '@/lib/sort-param';

/**
 * URL-owned list state for master-data and administration lists
 * (standards.md §5/§8: filters, page and sort live in the router search
 * params, and sorting/paging are server-side).
 *
 * Shared by the organization-administration and inventory master-data
 * features (standards.md §2: shared by two features ⇒ `src/lib`).
 *
 * The invariant this hook protects is **URL ↔ visible controls ↔ server
 * query**: every value below maps onto a query parameter the matching
 * controller declares, and untrusted URL input is normalized away instead of
 * being forwarded to the API (which answers 400 for an unknown sort field and
 * for any parameter outside the DTO whitelist).
 *
 * It is deliberately NOT a generic CRUD engine: it owns paging, search,
 * `isActive` and sort — the four parameters every master-data list endpoint
 * shares — while each resource keeps its own extra filters (`parentId`,
 * `itemKind`, `warehouseId`, …) and builds its own query object.
 */

export const ADMIN_PAGE_SIZE_OPTIONS: readonly number[] = [25, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 50;

/** `''` = every status; the backend filter is the boolean `isActive`. */
export type StatusFilter = '' | 'active' | 'inactive';

export interface AdminListState {
  page: number;
  pageSize: number;
  search: string;
  status: StatusFilter;
  /** Normalized `field:asc|desc` exactly as the backend `sort` expects. */
  sort: string;
  sorting: SortingState;
  /** `undefined` when the status filter is off — the parameter is not sent. */
  isActive: boolean | undefined;
}

export type AdminListUpdate = Record<
  string,
  string | number | boolean | null | undefined
>;

export interface AdminListStateHandle {
  state: AdminListState;
  /** Resource-specific filter values, read from the URL by key. */
  extra: Readonly<Record<string, string>>;
  update: (changes: AdminListUpdate) => void;
  /** Drop every filter; the page size survives as the only sticky preference. */
  clear: () => void;
  setSorting: (sorting: SortingState) => void;
}

function parseStatus(value: string | null): StatusFilter {
  return value === 'active' || value === 'inactive' ? value : '';
}

export function useAdminListState(options: {
  sortFields: readonly string[];
  defaultSort: string;
  extraKeys?: readonly string[];
}): AdminListStateHandle {
  const { sortFields, defaultSort, extraKeys } = options;
  const [params, setParams] = useSearchParams();

  const pageValue = Number(params.get('page'));
  const page =
    Number.isInteger(pageValue) && pageValue >= 1 ? Math.trunc(pageValue) : 1;
  const pageSizeValue = Number(params.get('pageSize'));
  const pageSize = ADMIN_PAGE_SIZE_OPTIONS.includes(pageSizeValue)
    ? pageSizeValue
    : DEFAULT_PAGE_SIZE;

  const parsedSorting = sortingFromParam(params.get('sort'), sortFields);
  const firstSort = parsedSorting[0];
  const sort =
    firstSort === undefined
      ? defaultSort
      : `${firstSort.id}:${firstSort.desc ? 'desc' : 'asc'}`;
  const sorting = sortingFromParam(sort, sortFields);

  const status = parseStatus(params.get('status'));
  const search = params.get('search') ?? '';

  const extraKey = extraKeys === undefined ? '' : extraKeys.join(',');
  const rawSearch = params.toString();
  const extra = useMemo(() => {
    const result: Record<string, string> = {};
    const current = new URLSearchParams(rawSearch);
    for (const key of extraKey === '' ? [] : extraKey.split(',')) {
      result[key] = current.get(key) ?? '';
    }
    return result;
  }, [extraKey, rawSearch]);

  const update = useCallback(
    (changes: AdminListUpdate) => {
      setParams((current) => {
        const next = new URLSearchParams(current);
        const resetPage = !('page' in changes);
        for (const [key, value] of Object.entries(changes)) {
          const normalized =
            key === 'sort' && value === defaultSort ? null : value;
          if (
            normalized === null ||
            normalized === undefined ||
            normalized === ''
          ) {
            next.delete(key);
          } else {
            next.set(key, String(normalized));
          }
        }
        // Any filter change returns to the first page: page 7 of the previous
        // result set is meaningless for the new one.
        if (resetPage) next.delete('page');
        else if (next.get('page') === '1') next.delete('page');
        return next;
      });
    },
    [defaultSort, setParams],
  );

  const clear = useCallback(() => {
    setParams((current) => {
      const next = new URLSearchParams();
      const keptPageSize = current.get('pageSize');
      if (keptPageSize !== null) next.set('pageSize', keptPageSize);
      return next;
    });
  }, [setParams]);

  const setSorting = useCallback(
    (nextSorting: SortingState) => {
      const first = nextSorting[0];
      update({
        sort:
          first === undefined
            ? null
            : `${first.id}:${first.desc ? 'desc' : 'asc'}`,
      });
    },
    [update],
  );

  return {
    state: {
      page,
      pageSize,
      search,
      status,
      sort,
      sorting,
      isActive: status === '' ? undefined : status === 'active',
    },
    extra,
    update,
    clear,
    setSorting,
  };
}
