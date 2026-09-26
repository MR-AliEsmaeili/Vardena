import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
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
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
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
 */
export function DataTable<TRow>({
  columns,
  data,
  getRowId,
  isLoading = false,
  isFetching = false,
  error,
  onRetry,
  emptyTitle = t.table.emptyTitle,
  emptyDescription = t.table.emptyBody,
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
        {...(onRetry ? { onRetry } : {})}
      />
    );
  }

  if (isLoading) {
    return <LoadingState label={t.table.loading} rows={6} />;
  }

  return (
    <div className="space-y-0">
      <TableWrapper
        className={cn(isFetching && 'opacity-70 transition-opacity')}
      >
        <Table>
          {caption !== undefined && (
            <caption className="sr-only">{caption}</caption>
          )}
          <TableHead>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
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
                            : undefined
                      }
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 font-semibold hover:text-slate-900"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          <span aria-hidden="true" className="text-[10px]">
                            {sortDirection === 'asc'
                              ? '▲'
                              : sortDirection === 'desc'
                                ? '▼'
                                : '↕'}
                          </span>
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
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="px-3 py-10 text-center"
                >
                  <p className="text-sm font-semibold text-slate-800">
                    {emptyTitle}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {emptyDescription}
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
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
        {pagination !== undefined && (
          <Pagination {...pagination} disabled={isFetching} />
        )}
      </TableWrapper>
    </div>
  );
}
