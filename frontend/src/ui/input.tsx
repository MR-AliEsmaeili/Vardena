import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Text input primitive.
 *
 * Height, radius, border, focus ring and invalid state are defined once here
 * so every form control in the product has the same hit area and the same
 * keyboard feedback (standards.md §6/§13). The focus ring uses the brand
 * token, not a literal palette value.
 */
export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink transition-colors placeholder:text-ink-subtle/70',
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
