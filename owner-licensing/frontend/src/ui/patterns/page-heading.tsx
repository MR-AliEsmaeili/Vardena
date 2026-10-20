import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** One typographic hierarchy across list, detail and form routes. */
export function PageHeading({
  className,
  children,
  ...props
}: ComponentProps<'h1'>) {
  return (
    <h1
      className={cn(
        'min-w-0 text-xl font-bold leading-9 text-ink sm:text-2xl',
        className,
      )}
      {...props}
    >
      {children}
    </h1>
  );
}
