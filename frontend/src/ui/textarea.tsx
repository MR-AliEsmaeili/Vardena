import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Multi-line text input primitive.
 *
 * Shares the exact border, surface, focus ring, disabled and invalid-state
 * contract of `Input` and `Select` (`standards.md` §6/§9/§13) so multi-line
 * fields in dialogs, operational notes and artifact import panels never drift
 * onto raw palette borders or missing dark-mode surfaces.
 */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink transition-colors placeholder:text-ink-subtle/70',
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
