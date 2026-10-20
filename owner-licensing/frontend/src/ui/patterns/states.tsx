import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/ui/skeleton';
import { ThinkingOrbIndicator } from '@/ui/thinking-orb';

/**
 * Inline loading placeholder used while a query is in flight.
 *
 * The Thinking Orb is the primary animation; the skeleton rows keep the
 * content's real shape (standards.md §10) and are removed from the
 * accessibility tree so the visible Persian label is announced once.
 */
export function LoadingState({
  label = t.app.loading,
  rows = 3,
  className,
}: {
  label?: string;
  rows?: number;
  className?: string;
}) {
  return (
    <output
      className={cn('block space-y-2', className)}
      aria-live="polite"
      aria-busy="true"
      data-testid="loading-state"
    >
      <span className="flex items-center gap-2 text-sm text-secondary">
        <ThinkingOrbIndicator size={20} decorative />
        <span>{label}</span>
      </span>
      <div aria-hidden="true" className="space-y-2">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </div>
    </output>
  );
}

/** Neutral "nothing to show" block (never an error). */
export function EmptyState({
  title = t.table.emptyTitle,
  description = t.table.emptyBody,
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-control-line bg-surface px-6 py-10 text-center',
        className,
      )}
    >
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="max-w-md text-sm text-secondary">{description}</p>
      {action}
    </div>
  );
}

/**
 * Full-page loading state (session bootstrap only — standards.md §12 forbids
 * a full-page spinner for ordinary queries; those use LoadingState inside
 * their own section).
 */
export function FullPageLoading({ label = t.app.loading }: { label?: string }) {
  return (
    <output
      className="flex min-h-screen items-center justify-center bg-canvas"
      aria-live="polite"
      aria-busy="true"
      data-testid="full-page-loading"
    >
      <div className="flex flex-col items-center gap-3">
        <ThinkingOrbIndicator size={64} decorative />
        <p className="text-sm text-secondary">{label}</p>
      </div>
    </output>
  );
}
