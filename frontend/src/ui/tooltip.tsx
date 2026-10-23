import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TooltipProps {
  /** Text shown inside the tooltip bubble. */
  content: string;
  /** Placement in logical RTL coordinates (`end` = inline-end, i.e., left of sidebar in RTL). */
  side?: 'top' | 'bottom' | 'end';
  /** When false, renders children without showing a tooltip bubble. */
  enabled?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Accessible, RTL-aware Tooltip primitive (standards.md §13, Design System §5).
 *
 * Appears on pointer hover or keyboard focus within the wrapper, dismisses on
 * Escape, and uses logical inline-end / block placement so RTL layout needs no
 * direction branching.
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

  if (!enabled || content.trim() === '') {
    return <>{children}</>;
  }

  return (
    <span
      role="presentation"
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setOpen(false);
        }
      }}
    >
      {children}
      {open && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            'pointer-events-none absolute z-50 rounded-control border border-line bg-ink px-2.5 py-1 text-xs font-medium whitespace-nowrap text-surface shadow-raised',
            side === 'top' && 'bottom-full start-1/2 mb-1.5 -translate-x-1/2',
            side === 'bottom' && 'top-full start-1/2 mt-1.5 -translate-x-1/2',
            side === 'end' && 'start-full top-1/2 ms-2 -translate-y-1/2',
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
