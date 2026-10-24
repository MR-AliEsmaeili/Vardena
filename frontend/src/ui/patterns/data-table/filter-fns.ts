import type { Row } from '@tanstack/react-table';
import { compareDecimalStrings, isValidDecimalString } from '@/lib/decimal';
import {
  equalsNormalized,
  includesNormalized,
  normalizeSearchText,
} from '@/lib/text-normalize';
import type {
  DataTableFilterKind,
  DateRangeFilterValue,
  NumberRangeFilterValue,
} from './types';

/**
 * The standard TanStack `filterFn`s of the Vardena grid
 * (`docs/frontend/data-table.md` §۴.۴).
 *
 * They are plain functions over a row — no React, no DOM — so the matching
 * contract is unit-tested directly. Every text comparison is normalized
 * (`lib/text-normalize`) so Persian/Arabic letter variants, ZWNJ and Persian
 * digits behave the way a Persian-speaking user expects.
 */

/** Raw cell value as a string; `null`/`undefined` become an empty string. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

/** True when the filter value is "off" (no narrowing requested). */
export function isBlankFilterValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * `text` → «شامل می‌شود» with Persian-aware normalization.
 *
 * `۱۴۰۵/۰۷` matches `1405/07`; `علي` matches `علی`.
 */
export function includesStringFilter<TData>(
  row: Row<TData>,
  columnId: string,
  filterValue: unknown,
): boolean {
  if (typeof filterValue !== 'string' || filterValue.trim() === '') return true;
  return includesNormalized(cellText(row.getValue(columnId)), filterValue);
}

/** `select` → normalized equality with the chosen single value. */
export function equalsStringFilter<TData>(
  row: Row<TData>,
  columnId: string,
  filterValue: unknown,
): boolean {
  if (typeof filterValue !== 'string' || filterValue.trim() === '') return true;
  return equalsNormalized(cellText(row.getValue(columnId)), filterValue);
}

/** `multi-select` → membership; an empty array means "no filter". */
export function multiSelectFilter<TData>(
  row: Row<TData>,
  columnId: string,
  filterValue: unknown,
): boolean {
  if (!Array.isArray(filterValue) || filterValue.length === 0) return true;
  const current = cellText(row.getValue(columnId));
  return filterValue.some(
    (candidate) =>
      typeof candidate === 'string' && equalsNormalized(current, candidate),
  );
}

function readDateRange(value: unknown): DateRangeFilterValue {
  if (typeof value !== 'object' || value === null) return {};
  const candidate = value as DateRangeFilterValue;
  return {
    ...(typeof candidate.from === 'string' && candidate.from !== ''
      ? { from: candidate.from }
      : {}),
    ...(typeof candidate.to === 'string' && candidate.to !== ''
      ? { to: candidate.to }
      : {}),
  };
}

/**
 * `date-range` → inclusive bounds over a canonical BusinessDate
 * (`YYYY-MM-DD`).
 *
 * The comparison is a plain string comparison on purpose: both sides are the
 * canonical ISO day, which orders lexicographically, and no JavaScript `Date`
 * is ever constructed (ADR-0042 / AR-32).
 */
export function dateRangeFilter<TData>(
  row: Row<TData>,
  columnId: string,
  filterValue: unknown,
): boolean {
  const { from, to } = readDateRange(filterValue);
  if (from === undefined && to === undefined) return true;
  const day = cellText(row.getValue(columnId));
  if (day === '') return false;
  if (from !== undefined && day < from) return false;
  if (to !== undefined && day > to) return false;
  return true;
}

function readNumberRange(value: unknown): NumberRangeFilterValue {
  if (typeof value !== 'object' || value === null) return {};
  const candidate = value as NumberRangeFilterValue;
  return {
    ...(typeof candidate.min === 'string' && candidate.min.trim() !== ''
      ? { min: candidate.min.trim() }
      : {}),
    ...(typeof candidate.max === 'string' && candidate.max.trim() !== ''
      ? { max: candidate.max.trim() }
      : {}),
  };
}

/**
 * `number-range` → inclusive min/max over an exact decimal string.
 *
 * Values are compared with `compareDecimalStrings` (scaled `BigInt`), so
 * `numeric(18,2)` amounts never pass through a JavaScript `number`.
 * A row whose value is not a decimal literal is excluded while a bound is
 * active — an unparseable value cannot be asserted to be inside the range.
 */
export function numberRangeFilter<TData>(
  row: Row<TData>,
  columnId: string,
  filterValue: unknown,
): boolean {
  const { min, max } = readNumberRange(filterValue);
  if (min === undefined && max === undefined) return true;
  const value = cellText(row.getValue(columnId));
  if (!isValidDecimalString(value)) return false;
  if (min !== undefined && isValidDecimalString(min)) {
    if (compareDecimalStrings(value, min) < 0) return false;
  }
  if (max !== undefined && isValidDecimalString(max)) {
    if (compareDecimalStrings(value, max) > 0) return false;
  }
  return true;
}

/** Everything the global search may look at for one cell. */
function searchableText<TData>(row: Row<TData>): string {
  const parts: string[] = [];
  for (const cell of row.getAllCells()) {
    const meta = cell.column.columnDef.meta;
    if (meta?.excludeFromGlobalSearch === true) continue;
    if (meta?.filter?.excludeFromGlobalSearch === true) continue;
    const searchValue = meta?.filter?.searchValue;
    if (searchValue !== undefined) {
      parts.push(searchValue(row.original));
      continue;
    }
    parts.push(cellText(cell.getValue()));
  }
  return parts.join(' ');
}

/**
 * Global search: normalized substring over every visible, searchable column.
 *
 * Column meta can supply the human text for non-text values
 * (`meta.filter.searchValue`) and can opt a column out entirely.
 */
export function globalTextFilter<TData>(
  row: Row<TData>,
  _columnId: string,
  filterValue: unknown,
): boolean {
  if (
    typeof filterValue !== 'string' ||
    normalizeSearchText(filterValue) === ''
  ) {
    return true;
  }
  return includesNormalized(searchableText(row), filterValue);
}

/** Default `filterFn` per declared filter kind. */
export const FILTER_FN_BY_KIND: {
  readonly [K in DataTableFilterKind]: <TData>(
    row: Row<TData>,
    columnId: string,
    filterValue: unknown,
  ) => boolean;
} = {
  text: includesStringFilter,
  select: equalsStringFilter,
  'multi-select': multiSelectFilter,
  'date-range': dateRangeFilter,
  'number-range': numberRangeFilter,
};
