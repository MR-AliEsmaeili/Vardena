import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Native select, styled to match the shared primitives.
 *
 * A native control is deliberate: it is keyboard/screen-reader correct in an
 * RTL document, works on touch devices without extra layout code, and keeps
 * the dependency surface at the fixed stack (ADR-0002 / AR-30). Its metrics
 * match `Input` so a filter row never has mixed control heights.
 */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-9 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink transition-colors',
        'hover:border-ink-subtle/60',
        'focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand',
        'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-muted',
        'aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:outline-danger',
        className,
      )}
      {...props}
    />
  );
}
