import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const alertVariants = cva('rounded-md border p-4 text-sm', {
  variants: {
    variant: {
      info: 'border-accent-line bg-accent-soft text-accent-strong',
      success: 'border-success-line bg-success-soft text-success',
      warning: 'border-warning-line bg-warning-soft text-warning',
      danger: 'border-danger-line bg-danger-soft text-danger',
      neutral: 'border-line bg-canvas text-ink',
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
