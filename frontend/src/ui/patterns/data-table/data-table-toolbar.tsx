import type { Column, Table } from '@tanstack/react-table';
import { Search, X } from 'lucide-react';
import { formatCount } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { countActiveColumnFilters, FilterControl } from './filter-controls';
import type { DataTableFilteringOptions } from './types';

export interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  options: DataTableFilteringOptions;
  /** Row count after search + column filters (client mode). */
  filteredCount: number;
  /** Row count before any client filter (the loaded dataset). */
  totalCount: number;
  /** Controlled search text (the table applies it after the debounce). */
  globalFilter: string;
  onGlobalFilterChange: (value: string) => void;
  resetToken: number;
  onReset: () => void;
}

/**
 * The one grid toolbar for light client-side filtering
 * (`docs/frontend/data-table.md`): a debounced global search box, one control
 * per declared `meta.filter`, a reset action, and an `aria-live` result count.
 *
 * The toolbar never owns a filter value of its own. The only local state is
 * the un-debounced search draft, which is the point of the debounce.
 */
export function filterableColumns<TData>(
  table: Table<TData>,
): Column<TData, unknown>[] {
  return table
    .getAllLeafColumns()
    .filter((column) => column.columnDef.meta?.filter !== undefined);
}

export function DataTableToolbar<TData>({
  table,
  options,
  filteredCount,
  totalCount,
  globalFilter,
  onGlobalFilterChange,
  resetToken,
  onReset,
}: DataTableToolbarProps<TData>) {
  const showSearch = options.globalSearch !== false;
  const showColumnFilters = options.columnFilters !== false;
  const columns = showColumnFilters ? filterableColumns(table) : [];
  const activeColumnFilters = countActiveColumnFilters(columns);
  const hasActiveFilters =
    globalFilter.trim() !== '' || activeColumnFilters > 0;

  return (
    <div className="space-y-1.5" data-testid="data-table-toolbar">
      <search
        className="flex flex-wrap items-end gap-2 rounded-card border border-line bg-surface p-2 shadow-card"
        aria-label={t.table.filters.searchLabel}
      >
        {showSearch && (
          <div className="relative flex min-w-52 flex-1 flex-col gap-1">
            <Search
              className="pointer-events-none absolute bottom-2 start-2 h-3.5 w-3.5 text-ink-subtle"
              aria-hidden
            />
            <Input
              type="search"
              className="h-8 ps-7 text-xs"
              placeholder={t.table.filters.searchPlaceholder}
              aria-label={t.table.filters.searchLabel}
              value={globalFilter}
              onChange={(event) => onGlobalFilterChange(event.target.value)}
            />
          </div>
        )}

        {columns.map((column) => {
          const filter = column.columnDef.meta?.filter;
          if (filter === undefined) return null;
          return (
            <FilterControl
              key={column.id}
              column={column}
              filter={filter}
              debounceMs={options.debounceMs ?? 300}
              resetToken={resetToken}
            />
          );
        })}

        {hasActiveFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={onReset}
            data-testid="data-table-reset-filters"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            {t.table.filters.reset}
          </Button>
        )}

        {options.toolbarActions !== undefined && (
          <div className="ms-auto flex flex-wrap items-center gap-2">
            {options.toolbarActions}
          </div>
        )}
      </search>

      <p
        className="px-0.5 text-[0.6875rem] text-ink-subtle"
        aria-live="polite"
        data-testid="data-table-filter-summary"
      >
        {t.table.filters.resultSummary
          .replace('{filtered}', formatCount(filteredCount))
          .replace('{total}', formatCount(totalCount))}
        {hasActiveFilters && activeColumnFilters > 0
          ? ` · ${t.table.filters.activeCount.replace(
              '{count}',
              formatCount(activeColumnFilters),
            )}`
          : ''}
      </p>
    </div>
  );
}
