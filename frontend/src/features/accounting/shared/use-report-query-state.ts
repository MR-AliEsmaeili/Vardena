import { useCallback, useState } from 'react';
import type { SortingState } from '@tanstack/react-table';

export { sortingToParam } from '@/lib/sort-param';

/**
 * Paging + sorting + "applied filters" state shared by the report screens.
 *
 * Filters are applied explicitly (on submit) and any change of filters, sort
 * or page size returns to page 1 — otherwise the UI would ask the server for
 * a page that belongs to a different result set.
 */
/** Stable module-level defaults (never re-created per render). */
const NO_SORTING: SortingState = [];
const DEFAULT_PAGE_SIZE = 50;

export interface ReportQueryState<TFilters> {
  applied: TFilters | null;
  page: number;
  pageSize: number;
  sorting: SortingState;
  apply: (filters: TFilters) => void;
  clear: () => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setSorting: (sorting: SortingState) => void;
}

export function useReportQueryState<TFilters>(options?: {
  defaultSorting?: SortingState;
  defaultPageSize?: number;
}): ReportQueryState<TFilters> {
  // Callers pass MODULE-LEVEL constants, so these references are stable.
  const defaultSorting = options?.defaultSorting ?? NO_SORTING;
  const defaultPageSize = options?.defaultPageSize ?? DEFAULT_PAGE_SIZE;

  const [applied, setApplied] = useState<TFilters | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(defaultPageSize);
  const [sorting, setSortingState] = useState<SortingState>(defaultSorting);

  const apply = useCallback((filters: TFilters) => {
    setApplied(filters);
    setPage(1);
  }, []);

  const clear = useCallback(() => {
    setApplied(null);
    setPage(1);
    setSortingState(defaultSorting);
  }, [defaultSorting]);

  const setPageSize = useCallback((next: number) => {
    setPageSizeState(next);
    setPage(1);
  }, []);

  const setSorting = useCallback((next: SortingState) => {
    setSortingState(next);
    setPage(1);
  }, []);

  return {
    applied,
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
