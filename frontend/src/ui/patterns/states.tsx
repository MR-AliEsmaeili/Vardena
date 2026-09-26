import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/ui/skeleton';

/** Inline loading placeholder used while a query is in flight. */
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
    <output className={cn('block space-y-2', className)} aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-9 w-full" />
      ))}
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
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center',
        className,
      )}
    >
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <p className="max-w-md text-sm text-slate-600">{description}</p>
      {action}
    </div>
  );
}

/** Full-page loading state (session bootstrap, route transitions). */
export function FullPageLoading({ label = t.app.loading }: { label?: string }) {
  return (
    <output
      className="flex min-h-screen items-center justify-center bg-slate-50"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
        <p className="text-sm text-slate-600">{label}</p>
      </div>
    </output>
  );
}
