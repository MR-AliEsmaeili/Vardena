import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from './button';

export interface DialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  /** Prevent dismissal while an operation is running. */
  disableClose?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Reusable accessible modal Dialog primitive (standards.md §13).
 *
 * Uses semantic `<dialog open>`, traps Tab/Shift+Tab, dismisses on Escape and
 * backdrop click (when `disableClose` is false), locks body scroll, and
 * restores focus to the originating element on close.
 */
export function Dialog({
  open,
  title,
  description,
  onClose,
  disableClose = false,
  className,
  children,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      restoreFocusTo.current?.focus?.();
    };
  }, [open]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape' && !disableClose) {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const container = containerRef.current;
      if (container === null) return;
      const focusable = container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    },
    [disableClose, onClose],
  );

  if (!open) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !disableClose) {
          onClose();
        }
      }}
    >
      <dialog
        open
        aria-labelledby={titleId}
        aria-describedby={description !== undefined ? descriptionId : undefined}
        className={cn(
          'm-0 w-full max-w-lg rounded-card border border-line bg-surface p-5 text-ink shadow-raised',
          className,
        )}
      >
        <div
          ref={containerRef}
          role="presentation"
          className="contents"
          onKeyDown={onKeyDown}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold text-ink">
                {title}
              </h2>
              {description !== undefined && (
                <div
                  id={descriptionId}
                  className="mt-1 text-xs leading-5 text-ink-muted"
                >
                  {description}
                </div>
              )}
            </div>
            <Button
              ref={closeButtonRef}
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t.app.close}
              disabled={disableClose}
              onClick={onClose}
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          <div className="mt-4">{children}</div>
        </div>
      </dialog>
    </div>
  );
}
