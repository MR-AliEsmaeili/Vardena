import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Table primitives. Responsive behavior: the wrapper scrolls horizontally. */
export function TableWrapper({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'w-full overflow-x-auto rounded-lg border border-slate-200 bg-white',
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
    <thead className={cn('bg-slate-50 text-slate-600', className)} {...props} />
  );
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody className={cn('divide-y divide-slate-100', className)} {...props} />
  );
}

export function TableFooter({ className, ...props }: ComponentProps<'tfoot'>) {
  return (
    <tfoot
      className={cn(
        'border-t border-slate-200 bg-slate-50 font-semibold text-slate-800',
        className,
      )}
      {...props}
    />
  );
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return <tr className={cn('hover:bg-slate-50/70', className)} {...props} />;
}

export function TableHeaderCell({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap px-3 py-2 text-start text-xs font-semibold',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      className={cn('px-3 py-2 align-middle text-slate-800', className)}
      {...props}
    />
  );
}
