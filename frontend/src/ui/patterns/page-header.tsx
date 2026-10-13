import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: string;
  /** Plain copy, or a small inline presentation (e.g. a state badge). */
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** One page title/description/actions block, reused by every feature page. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold text-slate-900">
          {title}
        </h1>
        {description !== undefined && description !== null && (
          <div className="mt-1 text-sm text-slate-600">{description}</div>
        )}
      </div>
      {actions !== undefined && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
