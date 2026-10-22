import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Alert, AlertBody, AlertTitle } from '@/ui/alert';
import { Button } from '@/ui/button';

/**
 * The confirmation dialog for sensitive/irreversible operations
 * (FE-UX-02 §5, standards.md §11): finalize, reverse, discard a pre-final
 * voucher — and leaving a dirty form.
 *
 * Contract of the primitive (every dialog has: title, explanation,
 * consequence, primary action, cancel, loading, failure, success feedback —
 * the last two are driven by the caller):
 * - initial focus lands on CANCEL for high-risk actions, never on submit;
 * - the primary action is disabled and relabelled while the request is in
 *   flight (no double submit);
 * - Escape and the close affordance are disabled while the mutation runs;
 * - on failure the dialog STAYS OPEN and renders the error inside it;
 * - Tab/Shift+Tab stay trapped inside the dialog, and focus returns to the
 *   trigger when it closes.
 */

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What the operation does — the consequence, not «آیا مطمئنید؟». */
  description: ReactNode;
  /** The action itself, e.g. «نهایی‌سازی» — never «بله». */
  confirmLabel: string;
  /** The safe exit. Always offered, always reachable. */
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** True while the operation is in flight. */
  loading?: boolean;
  /** Loading label for the primary action, e.g. «در حال نهایی‌سازی…». */
  loadingLabel?: string;
  /**
   * Force the primary action disabled even while idle — for dialogs whose
   * confirm is only meaningful after an explicit in-dialog choice (e.g. the
   * backdating repricing step: no answer may ever be defaulted).
   */
  confirmDisabled?: boolean;
  /** Operation failure rendered INSIDE the dialog (it stays open). */
  error?: ReactNode;
  /** Renders the primary action in the danger palette. */
  danger?: boolean;
  /** Extra form content (e.g. the mandatory reversal reason). */
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = t.app.cancel,
  onConfirm,
  onCancel,
  loading = false,
  loadingLabel,
  confirmDisabled = false,
  error,
  danger = false,
  children,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  // Remember the trigger, move focus into the dialog, and restore focus on
  // close (FE-UX-02 §13.2/§13.5).
  useEffect(() => {
    if (!open) return;
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => {
      restoreFocusTo.current?.focus?.();
    };
  }, [open]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape' && !loading) {
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const container = dialogRef.current;
      if (container === null) return;
      const focusable = container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [loading, onCancel],
  );

  if (!open) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4"
      onMouseDown={(event) => {
        // Backdrop dismissal is a cancel, but never while a request runs.
        if (event.target === event.currentTarget && !loading) onCancel();
      }}
    >
      <dialog
        open
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="m-0 w-full max-w-md rounded-card border-0 bg-surface p-5 shadow-raised"
      >
        {/* The focus trap keyboard handler lives on this presentation
            wrapper (display:contents — no layout of its own). */}
        <div
          ref={dialogRef}
          role="presentation"
          className="contents"
          onKeyDown={onKeyDown}
        >
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {title}
          </h2>
          <div
            id={descriptionId}
            className="mt-2 space-y-2 text-sm leading-6 text-ink-muted"
          >
            {description}
          </div>
          {children !== undefined && <div className="mt-3">{children}</div>}
          {error !== undefined && error !== null && (
            <div className="mt-3">
              <Alert variant="danger" role="alert">
                <AlertTitle>{t.errors.title}</AlertTitle>
                <AlertBody>{error}</AlertBody>
              </Alert>
            </div>
          )}
          <div className="mt-5 flex items-center justify-end gap-2">
            <Button
              ref={cancelRef}
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={loading}
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              variant={danger ? 'danger' : 'default'}
              className={cn(danger && 'focus-visible:outline-danger')}
              onClick={onConfirm}
              disabled={loading || confirmDisabled}
              loading={loading}
            >
              {loading ? (loadingLabel ?? confirmLabel) : confirmLabel}
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
