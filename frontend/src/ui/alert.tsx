import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const alertVariants = cva('rounded-md border p-4 text-sm', {
  variants: {
    variant: {
      info: 'border-indigo-200 bg-indigo-50 text-indigo-900',
      success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
      warning: 'border-amber-200 bg-amber-50 text-amber-900',
      danger: 'border-rose-200 bg-rose-50 text-rose-900',
      neutral: 'border-slate-200 bg-slate-50 text-slate-800',
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
