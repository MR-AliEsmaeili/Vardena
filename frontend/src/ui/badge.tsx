import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Status badge.
 *
 * A badge always repeats the status in words (`فعال`, `غیرفعال`, `باطل`), so
 * the colour is a redundant cue rather than the only one (WCAG 1.4.1).
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        neutral: 'border-line bg-sunken text-ink-muted',
        info: 'border-info-line bg-info-soft text-info-ink',
        success: 'border-ok-line bg-ok-soft text-ok-ink',
        warning: 'border-warn-line bg-warn-soft text-warn-ink',
        danger: 'border-danger-line bg-danger-soft text-danger-ink',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { badgeVariants };
