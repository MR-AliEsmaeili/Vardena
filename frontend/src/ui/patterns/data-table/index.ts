/**
 * Barrel of the grid standard (`docs/frontend/data-table.md`).
 *
 * The component itself stays in `../data-table.tsx` (existing import path, no
 * breakage); this module exposes the filtering contract a feature needs:
 * filter kinds/values, the standard `filterFn`s and the toolbar helpers used
 * by the component and its tests.
 */
export {
  FILTER_FN_BY_KIND,
  dateRangeFilter,
  equalsStringFilter,
  globalTextFilter,
  includesStringFilter,
  isBlankFilterValue,
  multiSelectFilter,
  numberRangeFilter,
} from './filter-fns';
export { countActiveColumnFilters, FilterControl } from './filter-controls';
export {
  DataTableToolbar,
  filterableColumns,
  type DataTableToolbarProps,
} from './data-table-toolbar';
export { DataTableTruncationNotice } from './truncation-notice';
export {
  DATA_TABLE_FILTER_KINDS,
  hasFilterOptions,
  type DataTableClientState,
  type DataTableFilterKind,
  type DataTableFilterMeta,
  type DataTableFilterOption,
  type DataTableFilteringOptions,
  type DateRangeFilterValue,
  type NumberRangeFilterValue,
} from './types';
