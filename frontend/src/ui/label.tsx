import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Label primitive. Every caller passes `htmlFor` (the `FormField` pattern
 * wires it to the control id), which a generic primitive cannot prove to the
 * linter on its own.
 */
// oxlint-disable-next-line label-has-associated-control
export function Label({
  className,
  children,
  ...props
}: ComponentProps<'label'>) {
  return (
    <label
      className={cn(
        'text-xs font-medium text-ink-muted select-none',
        className,
      )}
      {...props}
    >
      {children}
    </label>
  );
}
