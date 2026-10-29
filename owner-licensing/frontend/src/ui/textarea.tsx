import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-control border border-control-line bg-surface px-3 py-2 text-sm text-ink transition-colors placeholder:text-subtle/80',
        'hover:border-subtle/70',
        'focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent',
        'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-ink',
        'aria-[invalid=true]:border-danger-action aria-[invalid=true]:focus-visible:outline-danger-action',
        className,
      )}
      {...props}
    />
  );
}
