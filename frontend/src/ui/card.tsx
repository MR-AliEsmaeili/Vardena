import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Card / section surface.
 *
 * One elevation and one radius for every panel in the product. Headers carry a
 * title and an optional description; the footer is reserved for the section's
 * actions, so a page never invents its own panel chrome.
 */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-card border border-line bg-surface shadow-card',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 border-b border-line/80 p-4',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  children,
  ...props
}: ComponentProps<'h3'>) {
  return (
    <h3 className={cn('text-sm font-semibold text-ink', className)} {...props}>
      {children}
    </h3>
  );
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-xs text-ink-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 border-t border-line/80 p-4',
        className,
      )}
      {...props}
    />
  );
}
