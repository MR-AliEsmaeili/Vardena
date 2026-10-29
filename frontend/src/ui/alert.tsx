import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Inline, persistent message block.
 *
 * A semantic variant carries three things: a soft surface, a matching border
 * and a readable ink colour. Status is never communicated by colour alone
 * (standards.md §13) — callers pass a title/label in the body, which is why
 * the surface can stay quiet.
 */
const alertVariants = cva('rounded-control border p-3.5 text-sm leading-6', {
  variants: {
    variant: {
      info: 'border-info-line bg-info-soft text-info-ink',
      success: 'border-ok-line bg-ok-soft text-ok-ink',
      warning: 'border-warn-line bg-warn-soft text-warn-ink',
      danger: 'border-danger-line bg-danger-soft text-danger-ink',
      critical:
        'border-critical-line border-s-4 border-s-critical bg-critical-soft text-critical-ink',
      neutral: 'border-line bg-sunken text-ink-muted',
    },
  },
  defaultVariants: { variant: 'info' },
});

export function Alert({
  className,
  variant,
  role = 'status',
  ...props
}: ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      role={role}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm font-semibold', className)} {...props} />;
}

export function AlertBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mt-1 leading-6', className)} {...props} />;
}
