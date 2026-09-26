import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Native select, styled to match the shadcn/ui primitives.
 *
 * A native control is deliberate: it is keyboard/screen-reader correct in an
 * RTL document, works on touch devices without extra layout code, and keeps
 * the dependency surface at the fixed stack (ADR-0002 / AR-30).
 */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900',
        'focus-visible:border-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-indigo-500',
        'disabled:cursor-not-allowed disabled:bg-slate-100 aria-[invalid=true]:border-rose-400',
        className,
      )}
      {...props}
    />
  );
}
