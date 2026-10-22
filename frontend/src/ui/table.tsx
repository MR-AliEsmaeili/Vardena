import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Table primitives.
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
      className={cn('w-full border-collapse text-sm', className)}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead
      className={cn('border-b border-line bg-sunken text-ink-muted', className)}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody className={cn('divide-y divide-line/80', className)} {...props} />
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
        'transition-colors hover:bg-sunken/80 focus-within:bg-sunken/80',
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
        'whitespace-nowrap px-3 py-2 text-start text-[0.6875rem] font-semibold tracking-wide',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      className={cn('px-3 py-2 align-middle text-ink', className)}
      {...props}
    />
  );
}
