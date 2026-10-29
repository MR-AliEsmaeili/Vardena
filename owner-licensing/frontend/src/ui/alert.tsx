import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const alertVariants = cva('rounded-control border p-3.5 text-sm leading-6', {
  variants: {
    variant: {
      info: 'border-accent-line bg-accent-soft text-accent-ink',
      success: 'border-success-line bg-success-soft text-success',
      warning: 'border-warning-line bg-warning-soft text-warning',
      danger: 'border-danger-line bg-danger-soft text-danger',
      critical:
        'border-critical-line border-s-4 border-s-critical bg-critical-soft text-critical-ink',
      neutral: 'border-line bg-muted text-ink',
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
  return <p className={cn('font-semibold', className)} {...props} />;
}

export function AlertBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mt-1 leading-6', className)} {...props} />;
}
