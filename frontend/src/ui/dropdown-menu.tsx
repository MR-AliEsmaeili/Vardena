import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

export interface DropdownMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  align?: 'start' | 'end';
  trigger: ReactNode;
  className?: string;
  menuClassName?: string;
  'data-testid'?: string;
  children: ReactNode;
}

/**
 * Accessible Dropdown Menu primitive (standards.md §13, Design System §5).
 *
 * Closes on outside pointer down or Escape, supports ArrowDown / ArrowUp /
 * Home / End keyboard cycling across `[role="menuitem"]` controls, and anchors
 * with logical RTL `start-0` / `end-0` alignment.
 */
export function DropdownMenu({
  open,
  onOpenChange,
  label,
  align = 'end',
  trigger,
  className,
  menuClassName,
  'data-testid': dataTestId,
  children,
}: DropdownMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (
        rootRef.current !== null &&
        !rootRef.current.contains(event.target as Node)
      ) {
        onOpenChange(false);
      }
    }
    function onGlobalKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        onOpenChange(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onGlobalKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onGlobalKeyDown);
    };
  }, [onOpenChange, open]);

  const onMenuKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const container = menuRef.current;
    if (container === null) return;
    const items = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled])',
      ),
    );
    if (items.length === 0) return;
    const activeIndex = items.indexOf(document.activeElement as HTMLElement);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = activeIndex < items.length - 1 ? activeIndex + 1 : 0;
      items[next]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = activeIndex > 0 ? activeIndex - 1 : items.length - 1;
      items[prev]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  }, []);

  return (
    <div ref={rootRef} className={cn('relative inline-flex', className)}>
      {trigger}
      {open && (
        <div
          ref={menuRef}
          role="menu"
          tabIndex={-1}
          aria-label={label}
          data-testid={dataTestId}
          onKeyDown={onMenuKeyDown}
          className={cn(
            'absolute top-full z-40 mt-1.5 min-w-52 rounded-card border border-line bg-surface p-1 text-ink shadow-raised',
            align === 'end' ? 'end-0' : 'start-0',
            menuClassName,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export interface DropdownMenuItemProps {
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  'data-testid'?: string;
  children: ReactNode;
}

export function DropdownMenuItem({
  icon,
  danger = false,
  disabled = false,
  onSelect,
  'data-testid': dataTestId,
  children,
}: DropdownMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      data-testid={dataTestId}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-control px-3 py-2 text-start text-sm transition-colors disabled:pointer-events-none disabled:opacity-50',
        danger
          ? 'text-danger-ink hover:bg-danger-soft'
          : 'text-ink-muted hover:bg-sunken hover:text-ink',
      )}
    >
      {icon !== undefined && <span className="shrink-0">{icon}</span>}
      <span className="truncate">{children}</span>
    </button>
  );
}
