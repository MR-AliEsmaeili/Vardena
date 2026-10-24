import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type OnChangeFn,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatCount } from '@/lib/format';
import { t } from '@/lib/i18n';
import { useDebounce } from '@/lib/use-debounced-value';
import { useVirtualWindow } from '@/lib/use-virtual-window';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrapper,
} from '@/ui/table';
import { ApiErrorAlert } from './api-error-alert';
import { LocalFetchingIndicator } from './request-activity';
import { LoadingState } from './states';
import { Pagination, type PaginationProps } from './pagination';
import { DataTableToolbar } from './data-table/data-table-toolbar';
import { FILTER_FN_BY_KIND, globalTextFilter } from './data-table/filter-fns';
import type {
  DataTableClientState,
  DataTableFilteringOptions,
} from './data-table/types';

/** Page sizes offered when the grid owns its own pagination. */
const DEFAULT_CLIENT_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const DEFAULT_CLIENT_PAGE_SIZE = 25;

export interface DataTableProps<TRow> {
  columns: ColumnDef<TRow, unknown>[];
  data: TRow[];
  /** Stable row identity (ids come from the API, never array indexes). */
  getRowId: (row: TRow, index: number) => string;
  isLoading?: boolean;
  isFetching?: boolean;
  error?: unknown;
  errorDescription?: string;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  /**
   * Recovery path for the empty grid (usually "create the first record").
   * Rendered only when the grid has no rows, never on top of data.
   */
  emptyAction?: ReactNode;
  /** Server-side sorting state; omit for an unsorted table. */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  pagination?: Omit<PaginationProps, 'disabled'>;
  caption?: string;
  /** Optional row selection controlled by the caller. */
  selectable?: boolean;
  selectedRowIds?: ReadonlySet<string>;
  onSelectedRowIdsChange?: (next: Set<string>) => void;
  /** Optional row activation (double-click to open record). */
  onRowActivate?: (row: TRow) => void;
  /** Enable automatic windowing when row count reaches threshold (80+). */
  virtualize?: boolean;
  /**
   * Bounded client-side filtering (`docs/frontend/data-table.md`).
   * Supplying it switches the grid to client pagination/sorting and renders
   * the shared toolbar (global search + one control per `meta.filter`).
   * Omit it for the unchanged server-owned mode.
   */
  filtering?: DataTableFilteringOptions;
}

/**
 * The application's unified data grid (TanStack Table, AR-F / ADR-0002).
 *
 * Two modes, one component:
 * - **server** (default): sorting/pagination are MANUAL and caller-owned;
 * - **client** (`filtering` provided): a bounded dataset is searched,
 *   filtered, sorted and paged in the browser, with the shared toolbar.
 *
 * Row selection, double-click activation and windowed virtualization are
 * available in both modes.
 */
export function DataTable<TRow>({
  columns,
  data,
  getRowId,
  isLoading = false,
  isFetching = false,
  error,
  errorDescription,
  onRetry,
  emptyTitle = t.table.emptyTitle,
  emptyDescription = t.table.emptyBody,
  emptyAction,
  sorting,
  onSortingChange,
  pagination,
  caption,
  selectable = false,
  selectedRowIds,
  onSelectedRowIdsChange,
  onRowActivate,
  virtualize = false,
  filtering,
}: DataTableProps<TRow>) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isClientFiltered = filtering !== undefined;
  const debounceMs = filtering?.debounceMs ?? 300;
  const initialPageSize =
    filtering?.initialPageSize ?? DEFAULT_CLIENT_PAGE_SIZE;
  const onStateChange = filtering?.onStateChange;

  const [searchInput, setSearchInput] = useState(
    () => filtering?.initialGlobalFilter ?? '',
  );
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
    () => filtering?.initialColumnFilters ?? [],
  );
  const [clientSorting, setClientSorting] = useState<SortingState>([]);
  const [paginationState, setPaginationState] = useState<PaginationState>(
    () => ({ pageIndex: 0, pageSize: initialPageSize }),
  );
  const [resetToken, setResetToken] = useState(0);

  // An empty box means "no search" immediately; only a non-empty term waits
  // for the debounce. This keeps a reset instant instead of leaving a stale
  // term applied for another 300ms.
  const debouncedSearch = useDebounce(searchInput, debounceMs);
  const appliedGlobalFilter = searchInput === '' ? '' : debouncedSearch;

  useEffect(() => {
    if (!isClientFiltered) return;
    setPaginationState((previous) =>
      previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 },
    );
  }, [appliedGlobalFilter, isClientFiltered]);

  /**
   * Attach the standard `filterFn` for every declared filter kind (TanStack's
   * column definition is the third-party boundary here, hence the cast).
   */
  const effectiveColumns = useMemo<ColumnDef<TRow, unknown>[]>(() => {
    if (!isClientFiltered) return columns;
    return columns.map((column) => {
      const filter = column.meta?.filter;
      if (filter === undefined) return column;
      return {
        ...column,
        filterFn: column.filterFn ?? FILTER_FN_BY_KIND[filter.kind],
        enableColumnFilter: true,
      } as ColumnDef<TRow, unknown>;
    });
  }, [columns, isClientFiltered]);

  const handleColumnFiltersChange: OnChangeFn<ColumnFiltersState> = (
    updater,
  ) => {
    setColumnFilters((previous) =>
      typeof updater === 'function' ? updater(previous) : updater,
    );
    setPaginationState((previous) =>
      previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 },
    );
  };

  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    if (isClientFiltered) {
      setClientSorting((previous) =>
        typeof updater === 'function' ? updater(previous) : updater,
      );
      return;
    }
    if (onSortingChange === undefined) return;
    const next =
      typeof updater === 'function' ? updater(sorting ?? []) : updater;
    onSortingChange(next);
  };

  const handlePaginationChange: OnChangeFn<PaginationState> = (updater) => {
    setPaginationState((previous) =>
      typeof updater === 'function' ? updater(previous) : updater,
    );
  };

  const table = useReactTable({
    data,
    columns: effectiveColumns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    ...(isClientFiltered
      ? {
          getFilteredRowModel: getFilteredRowModel(),
          getSortedRowModel: getSortedRowModel(),
          getPaginationRowModel: getPaginationRowModel(),
          globalFilterFn: globalTextFilter,
        }
      : {}),
    manualPagination: !isClientFiltered,
    manualSorting: !isClientFiltered,
    manualFiltering: !isClientFiltered,
    enableSorting: isClientFiltered || onSortingChange !== undefined,
    state: isClientFiltered
      ? {
          sorting: clientSorting,
          columnFilters,
          globalFilter: appliedGlobalFilter,
          pagination: paginationState,
        }
      : sorting !== undefined
        ? { sorting }
        : {},
    onSortingChange: handleSortingChange,
    onColumnFiltersChange: handleColumnFiltersChange,
    onPaginationChange: handlePaginationChange,
  });

  useEffect(() => {
    if (!isClientFiltered || onStateChange === undefined) return;
    const state: DataTableClientState = {
      globalFilter: appliedGlobalFilter,
      columnFilters,
      sorting: clientSorting,
      page: paginationState.pageIndex + 1,
      pageSize: paginationState.pageSize,
    };
    onStateChange(state);
  }, [
    appliedGlobalFilter,
    clientSorting,
    columnFilters,
    isClientFiltered,
    onStateChange,
    paginationState.pageIndex,
    paginationState.pageSize,
  ]);

  const rows = table.getRowModel().rows;
  const filteredRowCount = isClientFiltered
    ? table.getFilteredRowModel().rows.length
    : data.length;

  const virtual = useVirtualWindow({
    totalCount: virtualize ? rows.length : 0,
    rowHeight: 29,
    viewportHeight: 520,
    threshold: 80,
  });

  if (error !== undefined && error !== null) {
    return (
      <ApiErrorAlert
        error={error}
        title={t.table.errorTitle}
        {...(errorDescription ? { description: errorDescription } : {})}
        {...(onRetry ? { onRetry } : {})}
      />
    );
  }

  if (isLoading) {
    return <LoadingState label={t.table.loading} rows={6} />;
  }

  const effectiveSelected = selectedRowIds ?? new Set<string>();
  const allPageSelected =
    selectable &&
    rows.length > 0 &&
    rows.every((row) => effectiveSelected.has(row.id));

  const toggleAllRows = () => {
    if (!onSelectedRowIdsChange) return;
    const next = new Set(effectiveSelected);
    if (allPageSelected) {
      for (const row of rows) next.delete(row.id);
    } else {
      for (const row of rows) next.add(row.id);
    }
    onSelectedRowIdsChange(next);
  };

  const toggleOneRow = (id: string) => {
    if (!onSelectedRowIdsChange) return;
    const next = new Set(effectiveSelected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedRowIdsChange(next);
  };

  const resetFilters = () => {
    setSearchInput('');
    setColumnFilters([]);
    setPaginationState((previous) =>
      previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 },
    );
    setResetToken((token) => token + 1);
  };

  const totalColSpan = columns.length + (selectable ? 1 : 0);
  const renderedRows = virtual.isVirtualized
    ? rows.slice(virtual.startIndex, virtual.endIndex)
    : rows;

  /** Loaded data exists, but the search/filters exclude every row. */
  const isNoMatch =
    isClientFiltered && data.length > 0 && filteredRowCount === 0;
  const resolvedEmptyTitle = isNoMatch
    ? t.table.filters.noMatchTitle
    : emptyTitle;
  const resolvedEmptyDescription = isNoMatch
    ? t.table.filters.noMatchBody
    : emptyDescription;
  const resolvedEmptyAction = isNoMatch ? (
    <button
      type="button"
      className="text-xs font-medium text-brand-ink underline hover:no-underline"
      onClick={resetFilters}
      data-testid="data-table-clear-filters"
    >
      {t.table.filters.clearFilters}
    </button>
  ) : (
    emptyAction
  );

  const clientPagination: Omit<PaginationProps, 'disabled'> | undefined =
    isClientFiltered
      ? {
          page: paginationState.pageIndex + 1,
          pageSize: paginationState.pageSize,
          total: filteredRowCount,
          pageSizeOptions: [
            ...(filtering?.pageSizeOptions ?? DEFAULT_CLIENT_PAGE_SIZE_OPTIONS),
          ],
          onPageChange: (page) => table.setPageIndex(Math.max(0, page - 1)),
          onPageSizeChange: (pageSize) => table.setPageSize(pageSize),
        }
      : undefined;
  const effectivePagination = clientPagination ?? pagination;

  return (
    <div className="space-y-2" aria-busy={isFetching ? true : undefined}>
      {isClientFiltered && (
        <DataTableToolbar
          table={table}
          options={filtering}
          filteredCount={filteredRowCount}
          totalCount={data.length}
          globalFilter={searchInput}
          onGlobalFilterChange={setSearchInput}
          resetToken={resetToken}
          onReset={resetFilters}
        />
      )}

      {selectable && effectiveSelected.size > 0 && (
        <div
          className="flex items-center justify-between rounded-control border border-brand/30 bg-brand-soft px-3 py-1.5 text-xs text-brand-ink"
          data-testid="data-table-selection-bar"
        >
          <span className="font-medium">
            {t.table.selectedCount.replace(
              '{count}',
              formatCount(effectiveSelected.size),
            )}
          </span>
          {onSelectedRowIdsChange && (
            <button
              type="button"
              className="rounded-control px-2 py-0.5 font-medium underline hover:no-underline"
              onClick={() => onSelectedRowIdsChange(new Set())}
              data-testid="data-table-clear-selection"
            >
              {t.table.clearSelection}
            </button>
          )}
        </div>
      )}

      <TableWrapper
        className={cn(
          'scroll-thin',
          isFetching && 'opacity-70 transition-opacity',
        )}
      >
        <div
          ref={scrollContainerRef}
          onScroll={virtual.isVirtualized ? virtual.onScroll : undefined}
          className={cn(
            virtual.isVirtualized &&
              'scroll-thin max-h-[32.5rem] overflow-y-auto',
          )}
        >
          <Table>
            {caption !== undefined && (
              <caption className="sr-only">{caption}</caption>
            )}
            <TableHead>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent">
                  {selectable && (
                    <TableHeaderCell className="w-10 text-center">
                      <input
                        type="checkbox"
                        aria-label={t.table.selectAll}
                        checked={allPageSelected}
                        disabled={rows.length === 0}
                        onChange={toggleAllRows}
                        className="h-4 w-4 rounded border-line-strong accent-brand"
                        data-testid="data-table-select-all"
                      />
                    </TableHeaderCell>
                  )}
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sortDirection = header.column.getIsSorted();
                    const meta = header.column.columnDef.meta;
                    return (
                      <TableHeaderCell
                        key={header.id}
                        className={cn(meta?.align === 'end' && 'text-end')}
                        aria-sort={
                          sortDirection === 'asc'
                            ? 'ascending'
                            : sortDirection === 'desc'
                              ? 'descending'
                              : canSort
                                ? 'none'
                                : undefined
                        }
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            className={cn(
                              'inline-flex items-center gap-1 rounded-sm font-semibold transition-colors hover:text-ink',
                              meta?.align === 'end' && 'flex-row-reverse',
                            )}
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                            {renderSortIcon(sortDirection)}
                          </button>
                        ) : (
                          flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )
                        )}
                      </TableHeaderCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={totalColSpan}
                    className="px-4 py-12 text-center"
                  >
                    <div
                      className="mx-auto flex max-w-sm flex-col items-center gap-2"
                      data-testid="data-table-empty"
                    >
                      <p className="text-sm font-semibold text-ink">
                        {resolvedEmptyTitle}
                      </p>
                      <p className="text-xs leading-6 text-ink-muted">
                        {resolvedEmptyDescription}
                      </p>
                      {resolvedEmptyAction}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {virtual.isVirtualized && virtual.topSpacerHeight > 0 && (
                    <tr aria-hidden style={{ height: virtual.topSpacerHeight }}>
                      <TableCell
                        colSpan={totalColSpan}
                        className="border-0 p-0"
                      />
                    </tr>
                  )}
                  {renderedRows.map((row) => {
                    const isRowSelected =
                      selectable && effectiveSelected.has(row.id);
                    return (
                      <TableRow
                        key={row.id}
                        data-selected={isRowSelected ? 'true' : undefined}
                        className={cn(
                          isRowSelected && 'bg-brand-soft/45',
                          onRowActivate !== undefined && 'cursor-pointer',
                        )}
                        onDoubleClick={
                          onRowActivate !== undefined
                            ? () => onRowActivate(row.original)
                            : undefined
                        }
                      >
                        {selectable && (
                          <TableCell className="w-10 text-center">
                            <input
                              type="checkbox"
                              aria-label={t.table.selectRow}
                              checked={isRowSelected}
                              onChange={() => toggleOneRow(row.id)}
                              className="h-4 w-4 rounded border-line-strong accent-brand"
                              data-testid={`data-table-select-${row.id}`}
                            />
                          </TableCell>
                        )}
                        {row.getVisibleCells().map((cell) => {
                          const meta = cell.column.columnDef.meta;
                          return (
                            <TableCell
                              key={cell.id}
                              className={cn(
                                meta?.align === 'end' && 'text-end',
                              )}
                            >
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext(),
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                  {virtual.isVirtualized && virtual.bottomSpacerHeight > 0 && (
                    <tr
                      aria-hidden
                      style={{ height: virtual.bottomSpacerHeight }}
                    >
                      <TableCell
                        colSpan={totalColSpan}
                        className="border-0 p-0"
                      />
                    </tr>
                  )}
                </>
              )}
            </TableBody>
          </Table>
        </div>

        {effectivePagination !== undefined ? (
          <Pagination
            {...effectivePagination}
            disabled={isFetching}
            fetching={isFetching}
          />
        ) : (
          <div className="border-t border-line/80 px-3 py-2">
            <LocalFetchingIndicator active={isFetching} />
          </div>
        )}
      </TableWrapper>
    </div>
  );
}

function renderSortIcon(direction: false | 'asc' | 'desc') {
  if (direction === 'asc') {
    return (
      <ArrowUp
        aria-hidden="true"
        className="h-3.5 w-3.5 text-brand-ink"
        data-testid="sort-icon-asc"
      />
    );
  }
  if (direction === 'desc') {
    return (
      <ArrowDown
        aria-hidden="true"
        className="h-3.5 w-3.5 text-brand-ink"
        data-testid="sort-icon-desc"
      />
    );
  }
  return (
    <ChevronsUpDown
      aria-hidden="true"
      className="h-3.5 w-3.5 text-ink-subtle/70"
      data-testid="sort-icon-none"
    />
  );
}
