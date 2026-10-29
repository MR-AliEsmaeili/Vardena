import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Read-only record metadata, rendered as ONE compact data grid instead of a
 * stack of cards (design-system.md §1, standards.md §8).
 *
 * Structure: a bordered surface whose cells are separated by hairline rules;
 * inside every cell the label sits in a fixed inline-start column and the
 * value next to it, so labels line up across the whole section like a table's
 * first column. Several fields share a row on desktop, long values wrap, and
 * narrow screens fall back to one field per row — no horizontal scrolling.
 *
 * Semantics stay a real `dl`: `Definition` renders `dt`/`dd`, so a screen
 * reader announces every label with its value.
 *
 * Genuinely tabular data (document lines, reports) belongs in
 * `ui/table.tsx`, not here; this component is for entity metadata.
 */

const COLUMN_CLASSES = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3',
} as const;

/** Enumerated (never dynamically built) span classes per column count. */
const SPAN_CLASSES = {
  1: 'sm:col-span-1',
  2: 'sm:col-span-2',
  3: 'sm:col-span-2 xl:col-span-3',
} as const;

export interface DefinitionListProps {
  /** Fields per row on wide screens; defaults to the ERP-dense 3. */
  columns?: keyof typeof COLUMN_CLASSES;
  children: ReactNode;
}

export function DefinitionList({ columns = 3, children }: DefinitionListProps) {
  return (
    <dl
      className={cn(
        'grid gap-px overflow-hidden rounded-control border border-line bg-line',
        COLUMN_CLASSES[columns],
      )}
    >
      {children}
    </dl>
  );
}

export interface DefinitionProps {
  label: string;
  /** Full width of the grid — for addresses, notes, long free text. */
  span?: boolean;
  children: ReactNode;
}

export function Definition({ label, span = false, children }: DefinitionProps) {
  return (
    <div
      className={cn(
        'grid min-w-0 grid-cols-[var(--spacing-detail-label-inline)_minmax(0,1fr)] items-baseline gap-x-2 bg-surface px-detail-cell-inline py-detail-cell-block',
        span && SPAN_CLASSES[3],
      )}
    >
      <dt className="text-[11px] leading-5 font-medium text-ink-subtle">
        {label}
      </dt>
      <dd className="min-w-0 text-[0.8125rem] leading-5 font-medium break-words text-ink">
        {children}
      </dd>
    </div>
  );
}
