import { AlertCircle, Inbox, Lock } from 'lucide-react';
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
      <span className="flex items-center gap-2 text-xs text-ink-muted">
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

/**
 * Neutral "nothing to show" block (never an error).
 *
 * Two distinct empties exist in the product (standards.md §8): "no row matches
 * the current filters" and "this list has no records yet, create the first
 * one". The wording is owned by the caller; `action` is the recovery path, so
 * an empty screen is never a dead end.
 */
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
        'flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line-strong bg-surface px-6 py-12 text-center',
        className,
      )}
      data-testid="empty-state"
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-sunken text-ink-subtle"
      >
        <Inbox className="h-5 w-5" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mx-auto max-w-md text-xs leading-6 text-ink-muted">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

/**
 * "Unavailable" notice — a section the user cannot open yet (missing
 * permission) or that has no scope to act on (e.g. no financial area). One
 * shared pattern replaces the hand-copied dashed boxes (standards.md §2
 * «الگوی واحد»). Unlike `EmptyState` there is no CTA: the recovery path is
 * gaining access or scope, not creating a record.
 */
export function UnavailableState({
  description,
  className,
}: {
  description: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2.5 rounded-card border border-dashed border-line-strong bg-surface px-6 py-7 text-center text-xs leading-6 text-ink-muted',
        className,
      )}
      data-testid="unavailable-state"
    >
      <span
        aria-hidden="true"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-sunken text-ink-subtle"
      >
        <Lock className="h-4 w-4" />
      </span>
      <p className="max-w-md">{description}</p>
    </div>
  );
}

/** Terminal error block with a mandatory recovery affordance. */
export function ErrorState({
  title = t.errors.title,
  description,
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
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-card border border-danger-line bg-danger-soft px-6 py-10 text-center',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-danger-ink"
      >
        <AlertCircle className="h-5 w-5" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-danger-ink">{title}</p>
        {description !== undefined && (
          <p className="mx-auto max-w-md text-xs leading-6 text-danger-ink/90">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

/**
 * Full-page loading state (session bootstrap only — standards.md §12 forbids
 * a full-page spinner for ordinary queries; those use `LoadingState` inside
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
        <p className="text-sm text-ink-muted">{label}</p>
      </div>
    </output>
  );
}
