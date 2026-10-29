import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  type LucideIcon,
} from 'lucide-react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Toast channel (FE-UX-02 §3, standards.md §12).
 *
 * The one transient channel for COMPLETED, non-blocking events — primarily a
 * mutation success after the backend answered, and a short announcement when
 * a serious conflict also has a persistent inline recovery alert (two roles,
 * two texts — never the same copy in both channels). It is deliberately NOT
 * the channel for form validation, query failures, empty states or session
 * expiry: those have their own persistent surfaces.
 *
 * Behavior implemented here because the standard demands it:
 * - at most 3 visible toasts;
 * - auto-dismiss (4s success, 5s info, 6s warning, 8s error) with the
 *   countdown paused while hovered or focused, resuming the REMAINING time;
 * - manual dismiss with a labelled button; dismissing never "undoes" anything;
 * - identical (kind + message) toasts are deduplicated while visible;
 * - `role=status` for success/info and `role=alert` for warning/error;
 * - RTL layout with logical properties only.
 */

export type ToastKind = 'success' | 'info' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ShowToastParams {
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

interface ToastEntry {
  id: number;
  kind: ToastKind;
  message: string;
  action: ToastAction | undefined;
}

interface ToastContextValue {
  showToast: (params: ShowToastParams) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Maximum simultaneously visible toasts (FE-UX-02 §3.3). */
const MAX_VISIBLE_TOASTS = 3;

const DISMISS_AFTER_MS: Record<ToastKind, number> = {
  success: 4000,
  info: 5000,
  warning: 6000,
  error: 8000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    ({ kind, message, action }: ShowToastParams) => {
      setToasts((current) => {
        // Deduplicate an identical toast that is still visible instead of
        // stacking the same announcement (retry storms included).
        if (
          current.some(
            (toast) => toast.kind === kind && toast.message === message,
          )
        ) {
          return current;
        }
        const id = nextId.current;
        nextId.current += 1;
        // Newest last — the logical end of the reading order in RTL.
        const visible = [...current, { id, kind, message, action }];
        return visible.slice(Math.max(0, visible.length - MAX_VISIBLE_TOASTS));
      });
    },
    [],
  );

  const value = useMemo<ToastContextValue>(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 end-4 z-[70] flex w-[min(24rem,calc(100vw_-_2rem))] flex-col gap-2"
        aria-label={t.toasts.regionLabel}
      >
        {toasts.map((toast) => (
          <ToastCard
            key={toast.id}
            toast={toast}
            onDismiss={() => dismiss(toast.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** The toast a page/action renders. Must be used inside `ToastProvider`. */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null) {
    throw new Error('useToast must be used inside <ToastProvider>.');
  }
  return context;
}

const KIND_STYLES: Record<ToastKind, string> = {
  success: 'border-ok-line bg-ok-soft text-ok-ink',
  info: 'border-info-line bg-info-soft text-info-ink',
  warning: 'border-warn-line bg-warn-soft text-warn-ink',
  error: 'border-danger-line bg-danger-soft text-danger-ink',
};

const KIND_ICONS: Record<ToastKind, LucideIcon> = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  error: AlertCircle,
};

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastEntry;
  onDismiss: () => void;
}) {
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remaining = useRef(DISMISS_AFTER_MS[toast.kind]);
  // Written when a run starts (never read before that); `Date.now()` is not
  // called during render.
  const startedAt = useRef(0);

  const clearTimer = useCallback(() => {
    if (timeout.current !== null) {
      clearTimeout(timeout.current);
      timeout.current = null;
      // Freeze the remaining countdown at what is left of the current run.
      if (startedAt.current !== 0) {
        remaining.current = Math.max(
          0,
          remaining.current - (Date.now() - startedAt.current),
        );
      }
    }
  }, []);

  const resumeTimer = useCallback(() => {
    if (timeout.current !== null) return;
    startedAt.current = Date.now();
    timeout.current = setTimeout(onDismiss, remaining.current);
  }, [onDismiss]);

  useEffect(() => {
    resumeTimer();
    return clearTimer;
  }, [clearTimer, resumeTimer]);

  // The live region itself carries no handlers; the presentation wrapper
  // below owns the hover/focus pause and the Escape key.
  const role =
    toast.kind === 'error' || toast.kind === 'warning' ? 'alert' : 'status';

  // Keyboard: Escape dismisses the toast that currently holds focus only
  // (FE-UX-02 §3.5) — it never clears the whole stack.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onDismiss();
    }
  };

  const StatusIcon = KIND_ICONS[toast.kind];

  return (
    <div
      role={role}
      className={cn(
        'animate-rise-in pointer-events-auto flex items-start gap-2.5 rounded-control border p-3 text-sm shadow-raised',
        KIND_STYLES[toast.kind],
      )}
    >
      <div
        role="presentation"
        tabIndex={-1}
        className="contents"
        onMouseEnter={clearTimer}
        onMouseLeave={resumeTimer}
        onFocus={clearTimer}
        onBlur={resumeTimer}
        onKeyDown={onKeyDown}
      >
        <StatusIcon className="mt-1 h-4 w-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 leading-6">{toast.message}</p>
        {toast.action !== undefined && (
          <button
            type="button"
            className="action-press shrink-0 rounded-control px-2 py-0.5 text-xs font-semibold underline underline-offset-2"
            onClick={() => {
              toast.action?.onAction();
              onDismiss();
            }}
          >
            {toast.action.label}
          </button>
        )}
        <button
          type="button"
          className="action-press inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-control hover:bg-surface/60"
          aria-label={t.toasts.dismiss}
          onClick={onDismiss}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
