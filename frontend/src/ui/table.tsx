import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Table primitives.
 *
 * Density is a product decision, not a page decision: every grid in Vardena is
 * the same compact ~29px row (4px cell padding, 20px line box) so 30–40 records
 * fit on one screen (standards.md §8 / principle 1). A cell carries ONE unit of
 * content — a column that owns long text truncates it in its own cell renderer
 * (`truncate` + `title`) instead of splitting the cell into two visual blocks.
 *
 * Responsive behaviour: the wrapper owns horizontal scrolling (standards.md
 * §8 forbids squeezing every column into a phone width). Header cells use a
 * quieter surface and a stronger separator than body rows, so a dense grid
 * stays scannable at 30–40 rows per page.
 */
export function TableWrapper({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'w-full overflow-x-auto rounded-card border border-line bg-surface',
        className,
      )}
      {...props}
    />
  );
}

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <table
      className={cn('w-full border-collapse text-[0.8125rem]', className)}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead className={cn('bg-sunken text-ink-muted', className)} {...props} />
  );
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody className={cn('divide-y divide-line/70', className)} {...props} />
  );
}

export function TableFooter({ className, ...props }: ComponentProps<'tfoot'>) {
  return (
    <tfoot
      className={cn(
        'border-t border-line bg-sunken font-semibold text-ink',
        className,
      )}
      {...props}
    />
  );
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'group/row transition-colors duration-150 hover:bg-brand-soft/35 focus-within:bg-brand-soft/35',
        className,
      )}
      {...props}
    />
  );
}

export function TableHeaderCell({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      scope="col"
      className={cn(
        'sticky top-0 z-10 whitespace-nowrap border-b border-line bg-sunken px-2.5 py-1.5 text-start text-[0.6875rem] font-semibold tracking-wide',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      className={cn('px-2.5 py-1 leading-5 align-middle text-ink', className)}
      {...props}
    />
  );
}
