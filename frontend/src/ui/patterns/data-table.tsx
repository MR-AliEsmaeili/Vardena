import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
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
}

/**
 * The application's one data grid (TanStack Table, AR-F / ADR-0002).
 *
 * Sorting and pagination are MANUAL: the backend owns both (allow-listed
 * `sort` fields and `page`/`pageSize`), so the table never re-sorts or
 * re-pages a cached window client-side. Column definitions live next to their
 * feature, never inside this component.
 *
 * The four states are structurally separate (standards.md §10): a failure
 * replaces the grid with a retryable alert, the first page renders
 * content-shaped skeletons, an empty result renders a labelled empty block
 * with its own CTA, and a refetch keeps the rows visible while announcing the
 * local refresh.
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
}: DataTableProps<TRow>) {
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

  const rows = table.getRowModel().rows;

  return (
    <div className="space-y-0" aria-busy={isFetching ? true : undefined}>
      <TableWrapper
        className={cn(
          'scroll-thin',
          isFetching && 'opacity-70 transition-opacity',
        )}
      >
        <Table>
          {caption !== undefined && (
            <caption className="sr-only">{caption}</caption>
          )}
          <TableHead>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
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
                  colSpan={columns.length}
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
              rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as
                      { align?: 'start' | 'end' } | undefined;
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(meta?.align === 'end' && 'text-end')}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {pagination !== undefined ? (
          <Pagination
            {...pagination}
            disabled={isFetching}
            fetching={isFetching}
          />
        ) : (
          // Tables without server pagination still get their OWN local
          // refresh status, so the section never depends on the global panel.
          <div className="border-t border-line/80 px-3 py-2">
            <LocalFetchingIndicator active={isFetching} />
          </div>
        )}
      </TableWrapper>
    </div>
  );
}

/**
 * Sort affordance. The `aria-sort` attribute on the header cell carries the
 * state for assistive technology, so the icon is decorative and announces a
 * stable glyph rather than a direction after every click. This is a plain
 * render helper (not a nested component) so the header never remounts a new
 * component type on every state change.
 */
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
