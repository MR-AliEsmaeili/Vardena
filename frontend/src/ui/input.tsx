import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400',
        'focus-visible:border-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-indigo-500',
        'disabled:cursor-not-allowed disabled:bg-slate-100 aria-[invalid=true]:border-rose-400',
        className,
      )}
      {...props}
    />
  );
}
