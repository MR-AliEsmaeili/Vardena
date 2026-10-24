import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  getRequestActivitySnapshot,
  subscribeToRequestActivity,
  type RequestActivityMessage,
  type RequestActivitySnapshot,
} from '@/api/request-activity';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ThinkingOrbIndicator } from '@/ui/thinking-orb';

/**
 * React binding for the request-activity registry, plus the THREE loading
 * surfaces the application exposes. All of them read the same registry and
 * none of them issues a request:
 *
 * 1. `GlobalRequestIndicator` — one fixed, NON-MODAL panel for user-blocking
 *    requests. It appears only after `GLOBAL_INDICATOR_DELAY_MS`, so a fast
 *    save never flashes the UI, and it never covers or locks the page
 *    (`pointer-events-none`, no backdrop, no focus trap). Concurrent
 *    requests share the one panel.
 * 2. `BackgroundActivityIndicator` — a small ambient orb in the shell top bar
 *    for refetches/background reads. It never covers content and is hidden
 *    from assistive tech: the section's own `LoadingState`/`aria-busy`
 *    announces that work.
 * 3. `LocalFetchingIndicator` — an inline refresh label for one table/footer.
 *    It only affects the component that renders it.
 *
 * Timing rules are documented in `docs/frontend/loading-system.md`: display
 * thresholds avoid blinking, and there is deliberately NO minimum visible
 * duration (that would artificially prolong a completed operation).
 */

/** User-blocking indicator appears after this much continuous activity. */
export const GLOBAL_INDICATOR_DELAY_MS = 500;
/** Ambient/background and local-refresh indicators use a lower threshold. */
export const AMBIENT_INDICATOR_DELAY_MS = 300;
export const LOCAL_FETCHING_DELAY_MS = 300;

/** Subscribe to the single registry (stable snapshot for React). */
export function useRequestActivity(): RequestActivitySnapshot {
  return useSyncExternalStore(
    subscribeToRequestActivity,
    getRequestActivitySnapshot,
    getRequestActivitySnapshot,
  );
}

/**
 * `true` only after `active` has stayed true for `delayMs`. Turning inactive
 * hides immediately (no artificial linger) and cancels a pending timer.
 */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      // Hide immediately through the returned value; the stored flag is reset
      // on the next task so no synchronous setState runs inside the effect.
      const hide = setTimeout(() => setVisible(false), 0);
      return () => clearTimeout(hide);
    }
    const show = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(show);
  }, [active, delayMs]);

  // `active` is part of the result, so a settled request disappears at once
  // even before the reset task runs.
  return active && visible;
}

const MESSAGE_TEXT: Record<RequestActivityMessage, string> = {
  receiving: t.loading.receiving,
  saving: t.loading.saving,
  updating: t.loading.updating,
  deleting: t.loading.deleting,
  processing: t.loading.processing,
};

/**
 * The single global loading panel. Mounted once (providers), so a request
 * storm can never produce several overlays or several announcements.
 */
export function GlobalRequestIndicator() {
  const activity = useRequestActivity();
  const visible = useDelayedFlag(
    activity.global > 0,
    GLOBAL_INDICATOR_DELAY_MS,
  );

  const message =
    activity.globalMessage === null
      ? t.loading.processing
      : MESSAGE_TEXT[activity.globalMessage];

  // The live region stays mounted (and empty) when idle: assistive tech only
  // announces changes inside a region that already exists in the DOM. The
  // element is fixed and `sr-only` while idle, so it never causes layout
  // shift and never intercepts pointer events.
  return (
    <output
      dir="rtl"
      aria-live="polite"
      aria-atomic="true"
      aria-busy={visible ? true : undefined}
      data-testid="global-request-indicator"
      data-visible={visible ? 'true' : 'false'}
      className={cn(
        // Toasts own the bottom-start corner; the loading status sits below
        // the 3.5rem top bar on the opposite logical side, clear of both.
        'pointer-events-none fixed top-16 end-4 z-40 max-w-[calc(100vw_-_2rem)] items-center gap-2 rounded-control border border-line bg-surface px-3 py-2 text-sm font-medium text-ink-muted shadow-raised',
        visible ? 'flex' : 'sr-only',
      )}
    >
      {visible ? (
        <>
          <ThinkingOrbIndicator size={20} decorative />
          <span>{message}</span>
        </>
      ) : null}
    </output>
  );
}

/**
 * Ambient background activity in the application shell.
 *
 * Decorative by design: the reader already gets the section-level loading
 * label, and a second live region announcing every refetch would be noise.
 */
export function BackgroundActivityIndicator() {
  const activity = useRequestActivity();
  const visible = useDelayedFlag(
    activity.background > 0,
    AMBIENT_INDICATOR_DELAY_MS,
  );

  // The 20×20 slot is always present, so appearing/disappearing never shifts
  // the top bar; only its content changes.
  return (
    <span
      className="inline-flex h-5 w-5 items-center justify-center"
      title={t.loading.background}
      aria-hidden="true"
      data-testid="background-activity-indicator"
      data-visible={visible ? 'true' : 'false'}
    >
      {visible ? <ThinkingOrbIndicator size={20} decorative /> : null}
    </span>
  );
}

/**
 * Inline refresh state for ONE section (e.g. a server-paged table). The
 * caller keeps rendering its data; this only adds a small status label.
 */
export function LocalFetchingIndicator({
  active,
  label = t.table.refreshing,
  className,
}: {
  active: boolean;
  label?: string;
  className?: string;
}) {
  const visible = useDelayedFlag(active, LOCAL_FETCHING_DELAY_MS);

  // Fixed height/width slot: the refresh label never reflows the table footer.
  return (
    <output
      aria-live="polite"
      aria-atomic="true"
      data-testid="local-fetching-indicator"
      data-visible={visible ? 'true' : 'false'}
      className={cn(
        'inline-flex h-5 min-w-24 items-center gap-1.5 text-xs text-ink-muted',
        className,
      )}
    >
      {visible ? (
        <>
          <ThinkingOrbIndicator size={20} decorative />
          <span>{label}</span>
        </>
      ) : null}
    </output>
  );
}
