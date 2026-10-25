import type { Column } from '@tanstack/react-table';
import { Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import { useDebounce } from '@/lib/use-debounced-value';
import { cn } from '@/lib/utils';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { DateInput } from '@/ui/patterns/date-input';
import { isBlankFilterValue } from './filter-fns';
import type {
  DataTableFilterKind,
  DataTableFilterMeta,
  DataTableFilterOption,
  DateRangeFilterValue,
  NumberRangeFilterValue,
} from './types';
import { hasFilterOptions } from './types';

/**
 * One control per filter kind (`docs/frontend/data-table.md` §۵).
 *
 * The table owns the filter state; these controls only read
 * `column.getFilterValue()` and write through `column.setFilterValue()`, so a
 * page never keeps a second copy of a filter value.
 */

const CONTROL_CLASS = 'h-8 text-xs';

interface FilterControlProps<TData> {
  column: Column<TData, unknown>;
  filter: DataTableFilterMeta<TData>;
  debounceMs: number;
  /** Bumped by the toolbar reset so draft-only controls clear too. */
  resetToken: number;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringOptions<TData>(
  filter: DataTableFilterMeta<TData>,
): readonly DataTableFilterOption[] {
  return hasFilterOptions(filter) ? filter.options : [];
}

export function FilterControl<TData>({
  column,
  filter,
  debounceMs,
  resetToken,
}: FilterControlProps<TData>) {
  const kind: DataTableFilterKind = filter.kind;
  switch (kind) {
    case 'text':
      return (
        <TextFilterControl
          column={column}
          label={filter.label}
          {...(filter.placeholder === undefined
            ? {}
            : { placeholder: filter.placeholder })}
          debounceMs={debounceMs}
          resetToken={resetToken}
        />
      );
    case 'select':
      return (
        <SelectFilterControl
          column={column}
          label={filter.label}
          options={stringOptions(filter)}
        />
      );
    case 'multi-select':
      return (
        <MultiSelectFilterControl
          column={column}
          label={filter.label}
          options={stringOptions(filter)}
        />
      );
    case 'date-range':
      return <DateRangeFilterControl column={column} label={filter.label} />;
    case 'number-range':
      return <NumberRangeFilterControl column={column} label={filter.label} />;
  }
}

function TextFilterControl<TData>({
  column,
  label,
  placeholder = t.table.filters.textPlaceholder,
  debounceMs,
  resetToken,
}: {
  column: Column<TData, unknown>;
  label: string;
  placeholder?: string;
  debounceMs: number;
  resetToken: number;
}) {
  const [draft, setDraft] = useState(() => asText(column.getFilterValue()));
  const debounced = useDebounce(draft, debounceMs);
  const initialResetToken = useRef(resetToken);

  useEffect(() => {
    const next = debounced.trim();
    column.setFilterValue(next === '' ? undefined : next);
  }, [column, debounced]);

  useEffect(() => {
    if (initialResetToken.current === resetToken) return;
    initialResetToken.current = resetToken;
    setDraft('');
  }, [resetToken]);

  return (
    <label className="relative flex min-w-44 flex-col gap-1">
      <span className="sr-only">{label}</span>
      <Search
        className="pointer-events-none absolute bottom-2 start-2 h-3.5 w-3.5 text-ink-subtle"
        aria-hidden
      />
      <Input
        type="search"
        className={cn(CONTROL_CLASS, 'ps-7')}
        placeholder={placeholder}
        value={draft}
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
      />
    </label>
  );
}

function SelectFilterControl<TData>({
  column,
  label,
  options,
}: {
  column: Column<TData, unknown>;
  label: string;
  options: readonly DataTableFilterOption[];
}) {
  return (
    <label className="flex min-w-40 flex-col gap-1">
      <span className="sr-only">{label}</span>
      <Select
        className={CONTROL_CLASS}
        aria-label={label}
        value={asText(column.getFilterValue())}
        onChange={(event) =>
          column.setFilterValue(
            event.target.value === '' ? undefined : event.target.value,
          )
        }
      >
        <option value="">{`${t.table.filters.allOption} — ${label}`}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

function MultiSelectFilterControl<TData>({
  column,
  label,
  options,
}: {
  column: Column<TData, unknown>;
  label: string;
  options: readonly DataTableFilterOption[];
}) {
  const selected = Array.isArray(column.getFilterValue())
    ? (column.getFilterValue() as string[])
    : [];
  const summary =
    selected.length === 0
      ? `${t.table.filters.allOption} — ${label}`
      : t.table.filters.multiSelect.replace('{count}', String(selected.length));

  const toggle = (value: string) => {
    const next = selected.includes(value)
      ? selected.filter((entry) => entry !== value)
      : [...selected, value];
    column.setFilterValue(next.length === 0 ? undefined : next);
  };

  return (
    <details
      className="group relative min-w-40"
      data-testid="multi-select-filter"
    >
      <summary
        className={cn(
          'flex h-8 cursor-pointer list-none items-center justify-between gap-2 rounded-control border border-line-strong bg-surface px-3 text-xs text-ink',
          'hover:border-ink-subtle/60 focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand',
        )}
        aria-label={label}
      >
        <span className="truncate">{summary}</span>
        <span aria-hidden className="text-ink-subtle">
          ▾
        </span>
      </summary>
      <ul className="absolute start-0 top-full z-30 mt-1 max-h-56 w-56 overflow-y-auto rounded-control border border-line bg-surface p-1 shadow-raised">
        {options.map((option) => {
          const id = `${label}-${option.value}`;
          return (
            <li key={option.value}>
              <label
                htmlFor={id}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-xs text-ink hover:bg-sunken"
              >
                <input
                  id={id}
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-line-strong accent-brand"
                  checked={selected.includes(option.value)}
                  onChange={() => toggle(option.value)}
                />
                <span className="truncate">{option.label}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function readDateRange(value: unknown): DateRangeFilterValue {
  if (typeof value !== 'object' || value === null) return {};
  const candidate = value as DateRangeFilterValue;
  return {
    ...(typeof candidate.from === 'string' ? { from: candidate.from } : {}),
    ...(typeof candidate.to === 'string' ? { to: candidate.to } : {}),
  };
}

function DateRangeFilterControl<TData>({
  column,
  label,
}: {
  column: Column<TData, unknown>;
  label: string;
}) {
  const baseId = useId();
  const value = readDateRange(column.getFilterValue());

  const update = (patch: DateRangeFilterValue) => {
    // An explicit empty string CLEARS that bound; `??` would resurrect the
    // previous value and make the control impossible to reset.
    const from = (
      patch.from !== undefined ? patch.from : (value.from ?? '')
    ).trim();
    const to = (patch.to !== undefined ? patch.to : (value.to ?? '')).trim();
    column.setFilterValue(
      from === '' && to === ''
        ? undefined
        : {
            ...(from === '' ? {} : { from }),
            ...(to === '' ? {} : { to }),
          },
    );
  };

  return (
    <fieldset className="flex min-w-56 flex-col gap-1 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      <div className="grid grid-cols-2 gap-1">
        <label className="min-w-0">
          <span className="sr-only">{`${label} — ${t.table.filters.from}`}</span>
          <DateInput
            id={`${baseId}-from`}
            className={CONTROL_CLASS}
            value={value.from ?? ''}
            onValueChange={(day) => update({ from: day })}
            data-testid="date-range-from"
          />
        </label>
        <label className="min-w-0">
          <span className="sr-only">{`${label} — ${t.table.filters.to}`}</span>
          <DateInput
            id={`${baseId}-to`}
            className={CONTROL_CLASS}
            value={value.to ?? ''}
            onValueChange={(day) => update({ to: day })}
            data-testid="date-range-to"
          />
        </label>
      </div>
      <span className="text-[0.6875rem] text-ink-subtle">
        {label}: {t.table.filters.from} — {t.table.filters.to}
      </span>
    </fieldset>
  );
}

function readNumberRange(value: unknown): NumberRangeFilterValue {
  if (typeof value !== 'object' || value === null) return {};
  const candidate = value as NumberRangeFilterValue;
  return {
    ...(typeof candidate.min === 'string' ? { min: candidate.min } : {}),
    ...(typeof candidate.max === 'string' ? { max: candidate.max } : {}),
  };
}

function NumberRangeFilterControl<TData>({
  column,
  label,
}: {
  column: Column<TData, unknown>;
  label: string;
}) {
  const value = readNumberRange(column.getFilterValue());

  const update = (patch: NumberRangeFilterValue) => {
    const min = (
      patch.min !== undefined ? patch.min : (value.min ?? '')
    ).trim();
    const max = (
      patch.max !== undefined ? patch.max : (value.max ?? '')
    ).trim();
    column.setFilterValue(
      min === '' && max === ''
        ? undefined
        : { ...(min === '' ? {} : { min }), ...(max === '' ? {} : { max }) },
    );
  };

  return (
    <fieldset className="grid min-w-48 grid-cols-2 gap-1 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      <Input
        dir="ltr"
        inputMode="decimal"
        className={cn(CONTROL_CLASS, 'num')}
        placeholder={t.table.filters.min}
        aria-label={`${label} — ${t.table.filters.min}`}
        value={value.min ?? ''}
        onChange={(event) => update({ min: event.target.value })}
      />
      <Input
        dir="ltr"
        inputMode="decimal"
        className={cn(CONTROL_CLASS, 'num')}
        placeholder={t.table.filters.max}
        aria-label={`${label} — ${t.table.filters.max}`}
        value={value.max ?? ''}
        onChange={(event) => update({ max: event.target.value })}
      />
    </fieldset>
  );
}

/** Number of columns whose filter is narrowing the result. */
export function countActiveColumnFilters<TData>(
  columns: readonly Column<TData, unknown>[],
): number {
  return columns.filter(
    (column) => !isBlankFilterValue(column.getFilterValue()),
  ).length;
}
