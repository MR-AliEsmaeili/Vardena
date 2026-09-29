import { useCallback, useMemo, useState } from 'react';
import { useInRouterContext } from 'react-router-dom';
import type { SortingState } from '@tanstack/react-table';
import { useSearchParams } from 'react-router-dom';
import { sortingFromParam, sortingToParam } from '@/lib/sort-param';

export { sortingToParam };
const NO_SORTING: SortingState = [];
const DEFAULT_PAGE_SIZE = 50;

export interface ReportQueryState<TFilters> {
  applied: TFilters | null;
  /** Filters reconstructed from the current URL, for controlled form hydration. */
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

/**
 * URL is the navigation-owned source of truth for report execution state.
 * Report-specific parsers deliberately live with the screen because the API
 * contracts have different filter surfaces.
 */
export function useReportQueryState<TFilters>(
  options: {
    defaultSorting?: SortingState;
    defaultPageSize?: number;
    parseFilters?: (params: URLSearchParams) => TFilters | null;
    serializeFilters?: (filters: TFilters, params: URLSearchParams) => void;
    clearKeys?: readonly string[];
  } = {},
): ReportQueryState<TFilters> {
  const defaultSorting = options.defaultSorting ?? NO_SORTING;
  const parseFilters =
    options.parseFilters ??
    ((params: URLSearchParams) => {
      const keys = [
        'financialAreaId',
        'fiscalYearId',
        'accountingPeriodId',
        'accountId',
        'accountHierarchyId',
        'accountCode',
        'accountName',
        'dateFrom',
        'dateTo',
      ];
      const value = Object.fromEntries(
        keys
          .filter((key) => params.has(key))
          .map((key) => [key, params.get(key) ?? '']),
      );
      return Object.keys(value).length ? (value as TFilters) : null;
    });
  const serializeFilters =
    options.serializeFilters ??
    ((filters: TFilters, params: URLSearchParams) => {
      Object.entries(filters as Record<string, unknown>).forEach(
        ([key, value]) => {
          if (typeof value === 'string' && value) params.set(key, value);
        },
      );
    });
  const clearKeys = options.clearKeys ?? [
    'financialAreaId',
    'fiscalYearId',
    'accountingPeriodId',
    'accountId',
    'accountHierarchyId',
    'accountCode',
    'accountName',
    'dateFrom',
    'dateTo',
  ];
  const defaultPageSize = options.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const inRouter = useInRouterContext();
  const [localApplied, setLocalApplied] = useState<TFilters | null>(null);
  const [localPage, setLocalPage] = useState(1);
  const [localPageSize, setLocalPageSize] = useState(defaultPageSize);
  const [localSorting, setLocalSorting] =
    useState<SortingState>(defaultSorting);
  if (!inRouter) {
    return {
      applied: localApplied,
      urlFilters: localApplied,
      page: localPage,
      pageSize: localPageSize,
      sorting: localSorting,
      apply: (filters) => {
        setLocalApplied(filters);
        setLocalPage(1);
      },
      clear: () => {
        setLocalApplied(null);
        setLocalPage(1);
        setLocalSorting(defaultSorting);
      },
      setPage: (next) => setLocalPage(next),
      setPageSize: (next) => {
        setLocalPageSize(next);
        setLocalPage(1);
      },
      setSorting: (next) => {
        setLocalSorting(next);
        setLocalPage(1);
      },
    };
  }
  const [searchParams, setSearchParams] = useSearchParams();
  const urlFilters = useMemo(
    () => parseFilters(searchParams),
    [parseFilters, searchParams],
  );
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const pageSize = Math.max(
    1,
    Number(searchParams.get('pageSize') ?? String(defaultPageSize)) ||
      defaultPageSize,
  );
  const sorting = sortingFromParam(
    searchParams.get('sort'),
    defaultSorting.map((item) => item.id),
  );
  const applied = urlFilters;

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
        clearKeys.forEach((key) => params.delete(key));
        serializeFilters(filters, params);
        params.delete('page');
      }),
    [clearKeys, serializeFilters, update],
  );
  const clear = useCallback(
    () =>
      update((params) => {
        clearKeys.forEach((key) => params.delete(key));
        params.delete('page');
        params.delete('pageSize');
        params.delete('sort');
      }),
    [clearKeys, update],
  );
  const setPage = useCallback(
    (next: number) =>
      update((params) => {
        params.set('page', String(Math.max(1, next)));
      }),
    [update],
  );
  const setPageSize = useCallback(
    (next: number) =>
      update((params) => {
        params.set('pageSize', String(Math.max(1, next)));
        params.delete('page');
      }),
    [update],
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
    applied,
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
