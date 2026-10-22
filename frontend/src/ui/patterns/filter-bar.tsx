import type { FormEventHandler, ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';

/**
 * The one list-filter toolbar (standards.md §2/§8: every repeated thing is a
 * pattern).
 *
 * Every list surface in the product — organization master data, users, roles,
 * accounting and inventory lists — used to build its own bordered tool bar
 * with slightly different padding, label colour and action order. This
 * primitive owns that chrome: a single card surface, a responsive field grid
 * and one action row (apply / reset), so the density, the control heights and
 * the RTL alignment are identical everywhere.
 *
 * `onSubmit` is optional on purpose: a bar whose controls apply instantly
 * (a status select bound straight to the URL) renders without the apply
 * button, while a bar with free-text or date filters submits explicitly.
 * Filtering itself is never implemented here — the caller decides whether the
 * values come from a form library, from the URL, or both.
 */
export interface FilterBarProps {
  children: ReactNode;
  /** Submit handler; its presence renders the apply button and a <form>. */
  onSubmit?: FormEventHandler<HTMLFormElement>;
  /** Reset handler; its presence renders the reset button. */
  onClear?: () => void;
  applyLabel?: string;
  clearLabel?: string;
  /** An apply/reset is in flight: both actions are disabled. */
  isFetching?: boolean;
  /** Apply is blocked before submission is valid (e.g. a required scope). */
  applyDisabled?: boolean;
  /** Extra actions rendered after apply/reset (e.g. an export link). */
  actions?: ReactNode;
  /** Field columns at the widest breakpoint (default 5). */
  columns?: 2 | 3 | 4 | 5;
  /** Accessible name of the filter region. */
  'aria-label'?: string;
  'data-testid'?: string;
  className?: string;
}

const COLUMN_CLASSES = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 xl:grid-cols-4',
  5: 'sm:grid-cols-2 xl:grid-cols-5',
} as const;

export function FilterBar({
  children,
  onSubmit,
  onClear,
  applyLabel = t.app.apply,
  clearLabel = t.filters.reset,
  isFetching = false,
  applyDisabled = false,
  actions,
  columns = 5,
  'aria-label': ariaLabel = t.filters.title,
  'data-testid': testId,
  className,
}: FilterBarProps) {
  const fields = (
    <div className={cn('grid gap-3', COLUMN_CLASSES[columns])}>{children}</div>
  );
  const actionRow =
    onSubmit !== undefined || onClear !== undefined || actions !== undefined ? (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {onSubmit !== undefined && (
          <Button
            type="submit"
            size="sm"
            disabled={isFetching || applyDisabled}
          >
            {applyLabel}
          </Button>
        )}
        {onClear !== undefined && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClear}
            disabled={isFetching}
          >
            {clearLabel}
          </Button>
        )}
        {actions}
      </div>
    ) : null;

  const shellClassName = cn(
    'rounded-card border border-line bg-surface p-3 shadow-card',
    className,
  );

  if (onSubmit === undefined) {
    return (
      <section
        className={shellClassName}
        aria-label={ariaLabel}
        data-testid={testId}
      >
        {fields}
        {actionRow}
      </section>
    );
  }

  return (
    <form
      className={shellClassName}
      onSubmit={onSubmit}
      noValidate
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {fields}
      {actionRow}
    </form>
  );
}

/**
 * One labelled cell inside a `FilterBar`.
 *
 * Uses an implicit `<label>` association, which is correct for a single
 * control and needs no generated id. When a field needs an explicit id (for a
 * `FormField`-validated control), use `FormField` instead and leave the cell
 * unlabelled by this helper.
 */
export function FilterField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block min-w-0 space-y-1', className)}>
      <span className="block text-xs font-medium text-ink-muted">{label}</span>
      {children}
    </label>
  );
}
