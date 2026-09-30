import { useCallback, useMemo } from 'react';
import type { SortingState } from '@tanstack/react-table';
import { useSearchParams } from 'react-router-dom';
import { sortingFromParam, sortingToParam } from '@/lib/sort-param';

export { sortingToParam };
const NO_SORTING: SortingState = [];
const DEFAULT_PAGE_SIZE = 50;

export interface ReportQueryState<TFilters> {
  applied: TFilters | null;
  urlFilters: TFilters | null;
  page: number;
  pageSize: number;
  sorting: SortingState;
  apply: (filters: TFilters) => void;
  clear: () => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setSorting: (sorting: SortingState) => void;
}

export interface ReportUrlCodec<TFilters> {
  parse: (params: URLSearchParams) => TFilters | null;
  serialize: (filters: TFilters, params: URLSearchParams) => void;
  keys: readonly string[];
  isExecutable: (filters: TFilters) => boolean;
}

export function createReportUrlCodec<T extends Record<string, string>>(
  keys: readonly (keyof T & string)[],
  defaults: T,
  requiredKeys: readonly (keyof T & string)[] = [],
): ReportUrlCodec<T> {
  return {
    keys,
    isExecutable: (filters) =>
      requiredKeys.every((key) => Boolean(filters[key])) &&
      keys.every((key) => {
        const value = filters[key];
        if (!value || !key.toLowerCase().includes('date')) return true;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const date = new Date(`${value}T00:00:00Z`);
        return (
          !Number.isNaN(date.getTime()) &&
          date.toISOString().slice(0, 10) === value
        );
      }),
    parse: (params) => {
      const hasFilter = keys.some((key) => params.has(key));
      if (!hasFilter) return null;
      return Object.fromEntries(
        keys.map((key) => [key, params.get(key) ?? defaults[key]]),
      ) as T;
    },
    serialize: (filters, params) => {
      keys.forEach((key) => {
        const value = filters[key];
        if (value) params.set(key, value);
      });
    },
  };
}

export function useReportQueryState<TFilters>(options: {
  defaultSorting?: SortingState;
  allowedSortFields?: readonly string[];
  defaultPageSize?: number;
  codec: ReportUrlCodec<TFilters>;
}): ReportQueryState<TFilters> {
  const defaultSorting = options.defaultSorting ?? NO_SORTING;
  const defaultPageSize = options.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const [searchParams, setSearchParams] = useSearchParams();
  const urlFilters = useMemo(
    () => options.codec.parse(searchParams),
    [options.codec, searchParams],
  );
  const pageValue = searchParams.get('page');
  const pageSizeValue = searchParams.get('pageSize');
  const page =
    pageValue !== null && /^\d+$/.test(pageValue) && Number(pageValue) > 0
      ? Number(pageValue)
      : 1;
  const pageSize =
    pageSizeValue !== null &&
    /^\d+$/.test(pageSizeValue) &&
    Number(pageSizeValue) > 0
      ? Number(pageSizeValue)
      : defaultPageSize;
  const parsedSorting = sortingFromParam(
    searchParams.get('sort'),
    options.allowedSortFields ?? defaultSorting.map((item) => item.id),
  );
  const sorting = parsedSorting.length > 0 ? parsedSorting : defaultSorting;

  const update = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams);
      mutate(next);
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );
  const apply = useCallback(
    (filters: TFilters) =>
      update((params) => {
        options.codec.keys.forEach((key) => params.delete(key));
        options.codec.serialize(filters, params);
        params.delete('page');
      }),
    [options.codec, update],
  );
  const clear = useCallback(
    () =>
      update((params) => {
        options.codec.keys.forEach((key) => params.delete(key));
        params.delete('page');
        params.delete('pageSize');
        params.delete('sort');
      }),
    [options.codec, update],
  );
  const setPage = useCallback(
    (next: number) =>
      update((params) => {
        params.set('page', String(Math.max(1, Math.trunc(next) || 1)));
      }),
    [update],
  );
  const setPageSize = useCallback(
    (next: number) =>
      update((params) => {
        params.set(
          'pageSize',
          String(Math.max(1, Math.trunc(next) || defaultPageSize)),
        );
        params.delete('page');
      }),
    [defaultPageSize, update],
  );
  const setSorting = useCallback(
    (next: SortingState) =>
      update((params) => {
        const value = sortingToParam(next);
        if (value) params.set('sort', value);
        else params.delete('sort');
        params.delete('page');
      }),
    [update],
  );

  return {
    applied:
      urlFilters && options.codec.isExecutable(urlFilters) ? urlFilters : null,
    urlFilters,
    page,
    pageSize,
    sorting,
    apply,
    clear,
    setPage,
    setPageSize,
    setSorting,
  };
}
