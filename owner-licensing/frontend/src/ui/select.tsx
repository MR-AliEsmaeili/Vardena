import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Native selection/keyboard behavior, same control contract as Input. */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn('owner-control', className)} {...props} />;
}
