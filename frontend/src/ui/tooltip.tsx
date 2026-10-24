import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export interface TooltipProps {
  /** Text shown inside the tooltip bubble. */
  content: string;
  /** Placement in logical RTL coordinates (`end` = inline-end, i.e., left of the sidebar in RTL). */
  side?: 'top' | 'bottom' | 'end';
  /** When false, renders children without showing a tooltip bubble. */
  enabled?: boolean;
  className?: string;
  children: ReactNode;
}

interface BubblePosition {
  top: number;
  left: number;
  transform: string;
}

const GAP_PX = 8;

/**
 * Accessible, RTL-aware Tooltip primitive (standards.md §13, Design System §5).
 *
 * Appears on pointer hover or keyboard focus within the wrapper, dismisses on
 * Escape, and uses logical inline-end / block placement so RTL layout needs no
 * direction branching.
 *
 * The bubble is PORTALLED to `document.body` and positioned from the anchor's
 * measured rect: the icon-only sidebar rail scrolls inside its own box, so an
 * in-flow absolutely positioned bubble would be clipped by the scroll
 * container. Portalling keeps the tooltip visible without weakening the
 * sidebar's `overflow-y: auto`.
 */
export function Tooltip({
  content,
  side = 'top',
  enabled = true,
  className,
  children,
}: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<BubblePosition | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    if (anchor === null) return;
    const rect = anchor.getBoundingClientRect();
    if (side === 'end') {
      setPosition({
        top: rect.top + rect.height / 2,
        left: rect.left - GAP_PX,
        transform: 'translate(-100%, -50%)',
      });
      return;
    }
    if (side === 'bottom') {
      setPosition({
        top: rect.bottom + GAP_PX,
        left: rect.left + rect.width / 2,
        transform: 'translate(-50%, 0)',
      });
      return;
    }
    setPosition({
      top: rect.top - GAP_PX,
      left: rect.left + rect.width / 2,
      transform: 'translate(-50%, -100%)',
    });
  }, [side]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => measure();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [measure, open]);

  if (!enabled || content.trim() === '') {
    return <>{children}</>;
  }

  const show = () => {
    measure();
    setOpen(true);
  };

  return (
    <>
      <span
        ref={anchorRef}
        role="presentation"
        className={cn('relative inline-flex', className)}
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
      >
        {children}
      </span>
      {open && position !== null
        ? createPortal(
            <span
              id={id}
              role="tooltip"
              style={{
                top: position.top,
                left: position.left,
                transform: position.transform,
              }}
              className="animate-pop-in pointer-events-none fixed z-[60] rounded-control border border-line bg-ink px-2.5 py-1 text-xs font-medium whitespace-nowrap text-surface shadow-raised"
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
