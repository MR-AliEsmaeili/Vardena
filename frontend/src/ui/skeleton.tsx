import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Loading placeholder that keeps the real content's shape (standards.md §10).
 * The global reduced-motion rule in `styles/index.css` stops the pulse for
 * users who ask the operating system for less motion.
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-control bg-line/80', className)}
      {...props}
    />
  );
}
