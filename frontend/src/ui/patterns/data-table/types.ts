import type {
  ColumnFiltersState,
  RowData,
  SortingState,
} from '@tanstack/react-table';
import type { ReactNode } from 'react';

/**
 * Public types of the light client-side filtering layer
 * (`docs/frontend/data-table.md` §۴).
 *
 * They live beside the component, and the column metadata is declared through
 * TanStack's own `ColumnMeta` augmentation, so a feature declares its filter
 * next to its column definition and the shared table renders the control —
 * no per-page filter markup and no second source of truth.
 */

/** Filter control kind derived from the data type of the column. */
export const DATA_TABLE_FILTER_KINDS = [
  'text',
  'select',
  'multi-select',
  'date-range',
  'number-range',
] as const;

export type DataTableFilterKind = (typeof DATA_TABLE_FILTER_KINDS)[number];

/** One option of a `select` / `multi-select` filter. */
export interface DataTableFilterOption {
  /** The value compared with the row's own value (`String(value)`). */
  value: string;
  label: string;
}

interface DataTableFilterBase<TData extends RowData> {
  label: string;
  placeholder?: string;
  /**
   * Human text used by the global search for this column. Needed when the
   * stored value (a boolean, an enum code) is not what the user reads
   * (`isActive: true` → «فعال»).
   */
  searchValue?: (row: TData) => string;
  /** Keep this column out of the global search (e.g. an amount duplicate). */
  excludeFromGlobalSearch?: boolean;
}

export type DataTableFilterMeta<TData extends RowData = RowData> =
  | (DataTableFilterBase<TData> & { kind: 'text' })
  | (DataTableFilterBase<TData> & {
      kind: 'select' | 'multi-select';
      options: readonly DataTableFilterOption[];
    })
  | (DataTableFilterBase<TData> & {
      kind: 'date-range' | 'number-range';
    });

/** Declared filter values, one shape per kind. */
export interface DateRangeFilterValue {
  from?: string;
  to?: string;
}

export interface NumberRangeFilterValue {
  min?: string;
  max?: string;
}

/** The state the client-mode table owns (exposed through `onStateChange`). */
export interface DataTableClientState {
  globalFilter: string;
  columnFilters: ColumnFiltersState;
  sorting: SortingState;
  page: number;
  pageSize: number;
}

/** Options that switch `DataTable` into bounded client-side filtering. */
export interface DataTableFilteringOptions {
  /** Render the global search box (default `true`). */
  globalSearch?: boolean;
  /** Render one control per column declaring `meta.filter` (default `true`). */
  columnFilters?: boolean;
  /** Debounce of the search box and text filters (default 300ms). */
  debounceMs?: number;
  /** Initial page size (default 25). */
  initialPageSize?: number;
  /** Page-size choices offered by the pagination control. */
  pageSizeOptions?: readonly number[];
  /** Extra toolbar content (export, create, …). */
  toolbarActions?: ReactNode;
  /** Called whenever search/filter/sort/page state changes. */
  onStateChange?: (state: DataTableClientState) => void;
  /** Starting filter state (e.g. restored from the URL). */
  initialGlobalFilter?: string;
  initialColumnFilters?: ColumnFiltersState;
}

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Cell/header alignment consumed by the shared table. */
    align?: 'start' | 'end';
    /** Filter contract of this column (see `DataTableFilterMeta`). */
    filter?: DataTableFilterMeta<TData>;
    /** Exclude a column from the global search without declaring a filter. */
    excludeFromGlobalSearch?: boolean;
  }
}

/** Narrowing helper shared by the toolbar and the tests. */
export function hasFilterOptions<TData extends RowData>(
  filter: DataTableFilterMeta<TData>,
): filter is DataTableFilterMeta<TData> & {
  kind: 'select' | 'multi-select';
  options: readonly DataTableFilterOption[];
} {
  return filter.kind === 'select' || filter.kind === 'multi-select';
}
