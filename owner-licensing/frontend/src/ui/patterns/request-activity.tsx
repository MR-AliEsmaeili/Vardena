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

export const GLOBAL_INDICATOR_DELAY_MS = 500;
export const AMBIENT_INDICATOR_DELAY_MS = 300;
export const LOCAL_FETCHING_DELAY_MS = 300;

export function useRequestActivity(): RequestActivitySnapshot {
  return useSyncExternalStore(
    subscribeToRequestActivity,
    getRequestActivitySnapshot,
    getRequestActivitySnapshot,
  );
}

export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      const hide = setTimeout(() => setVisible(false), 0);
      return () => clearTimeout(hide);
    }
    const show = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(show);
  }, [active, delayMs]);

  return active && visible;
}

const MESSAGE_TEXT: Record<RequestActivityMessage, string> = {
  receiving: t.loading.receiving,
  saving: t.loading.saving,
  updating: t.loading.updating,
  deleting: t.loading.deleting,
  processing: t.loading.processing,
};

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

  return (
    <output
      dir="rtl"
      aria-live="polite"
      aria-atomic="true"
      aria-busy={visible ? true : undefined}
      data-testid="global-request-indicator"
      data-visible={visible ? 'true' : 'false'}
      className={cn(
        'pointer-events-none fixed top-16 end-4 z-40 max-w-[calc(100vw-2rem)] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-md',
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

export function BackgroundActivityIndicator() {
  const activity = useRequestActivity();
  const visible = useDelayedFlag(
    activity.background > 0,
    AMBIENT_INDICATOR_DELAY_MS,
  );

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

  return (
    <output
      aria-live="polite"
      aria-atomic="true"
      data-testid="local-fetching-indicator"
      data-visible={visible ? 'true' : 'false'}
      className={cn(
        'inline-flex h-5 min-w-24 items-center gap-1.5 text-xs text-slate-600',
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
