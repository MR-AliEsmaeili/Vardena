import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: string;
  /** Plain copy, or a small inline presentation (e.g. a state badge). */
  description?: ReactNode;
  /** Primary page actions (create, export, …). */
  actions?: ReactNode;
  /**
   * Secondary metadata rendered under the title (record code, state badge,
   * last update). Kept separate from `description` so a page never has to
   * hand-build its own header block.
   */
  meta?: ReactNode;
  className?: string;
}

/**
 * One page title/description/actions block, reused by every feature page.
 *
 * The header is the page's single `h1`; action buttons wrap instead of
 * overflowing on a narrow window, and the text column keeps `min-w-0` so long
 * Persian names truncate instead of pushing the actions off-screen.
 */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex flex-col gap-3 border-b border-line/70 pb-4 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-lg font-semibold text-ink">{title}</h1>
          {meta}
        </div>
        {description !== undefined && description !== null && (
          <div className="mt-1 text-[0.8125rem] leading-6 text-ink-muted">
            {description}
          </div>
        )}
      </div>
      {actions !== undefined && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}
