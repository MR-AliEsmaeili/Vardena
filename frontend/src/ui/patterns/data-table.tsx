import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { formatCount } from '@/lib/format';
import { t } from '@/lib/i18n';
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
}

/**
 * The application's unified data grid (TanStack Table, AR-F / ADR-0002).
 *
 * Sorting and pagination are MANUAL (server-owned). Supports optional row
 * selection with count indicator, double-click row activation, and windowed
 * virtualization for large row sets.
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
}: DataTableProps<TRow>) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const table = useReactTable({
    data,
    columns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    enableSorting: onSortingChange !== undefined,
    state: sorting !== undefined ? { sorting } : {},
    onSortingChange: (updater) => {
      if (onSortingChange === undefined) return;
      const next =
        typeof updater === 'function' ? updater(sorting ?? []) : updater;
      onSortingChange(next);
    },
  });

  const rows = table.getRowModel().rows;
  const virtual = useVirtualWindow({
    totalCount: virtualize ? rows.length : 0,
    rowHeight: 42,
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

  const totalColSpan = columns.length + (selectable ? 1 : 0);
  const renderedRows = virtual.isVirtualized
    ? rows.slice(virtual.startIndex, virtual.endIndex)
    : rows;

  return (
    <div className="space-y-2" aria-busy={isFetching ? true : undefined}>
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
                    const meta = header.column.columnDef.meta as
                      { align?: 'start' | 'end' } | undefined;
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
                        {emptyTitle}
                      </p>
                      <p className="text-xs leading-6 text-ink-muted">
                        {emptyDescription}
                      </p>
                      {emptyAction}
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
                          const meta = cell.column.columnDef.meta as
                            { align?: 'start' | 'end' } | undefined;
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

        {pagination !== undefined ? (
          <Pagination
            {...pagination}
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
