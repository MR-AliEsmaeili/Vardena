/**
 * WorkspaceDock — the always-visible tab strip (ADR-0054, spec §4.1–§4.5).
 *
 * D-1: the dock is present even with a single window — the workspace always
 * reads as a multi-window surface. D-2: 12-window cap; a dirty window is
 * NEVER closed automatically. Density follows the exact §4.4 matrix from
 * `matchMedia` breakpoints (never per-tab measurement), and the dock uses
 * `overflow-x: clip` — it can never create horizontal page scroll.
 *
 * A11y (§7): WAI-ARIA Tabs with roving tabindex (ArrowRight/Left in RTL
 * order, Home/End), `aria-selected`/`aria-controls`, dirty state exposed via
 * tooltip + sr text (colour is never the only carrier), and an `aria-live`
 * announcement of the active window. Closing a tab never loses focus: it
 * moves to the neighbour tab or the `…` button (§5).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from 'react';
import { CheckCheck, ChevronUp, List, MoreHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { DropdownMenu, DropdownMenuItem } from '@/ui/dropdown-menu';
import { ConfirmDialog } from '@/ui/patterns/confirm-dialog';
import { NAV_TONE_TILE } from '@/ui/nav-glyph';
import { Tooltip } from '@/ui/tooltip';
import { useWorkspace, type WorkspaceApi } from './workspace-context';
import {
  formatWindowCount,
  resolveWindowMeta,
  type ModuleId,
} from './workspace-meta';
import type { WindowId, WorkspaceWindow } from './workspace-reducer';

export type DockDensity = 'full' | 'compact' | 'icon' | 'single';

/**
 * The exact §4.4 matrix. Pure — unit-tested with N=1,5,6,9,10,12 across the
 * breakpoints without any DOM.
 */
export function computeDockDensity(
  windowCount: number,
  isAtLeast1024: boolean,
  isAtLeast1280: boolean,
): DockDensity {
  if (!isAtLeast1024) return 'single';
  if (isAtLeast1280) {
    if (windowCount <= 5) return 'full';
    if (windowCount <= 9) return 'compact';
    return 'icon';
  }
  if (windowCount <= 4) return 'full';
  if (windowCount <= 8) return 'compact';
  return 'icon';
}

/**
 * `matchMedia` subscription (§4.4: breakpoints via `matchMedia`, changes via
 * `addEventListener('change')`). jsdom/test stubs report `false` → `single`.
 */
export function useMediaQuery(query: string): boolean {
  const getMatches = useCallback(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(query).matches,
    [query],
  );
  // The initial value is read during render; the effect only SUBSCRIBES
  // (a synchronous setState in an effect cascades renders — react-hooks
  // rule). Query strings are compile-time constants at every call site, so
  // the initializer never goes stale.
  const [matches, setMatches] = useState<boolean>(getMatches);
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/**
 * Enumerated per-module tab classes (never templated — Tailwind only emits
 * literal classes, and D-3 tone re-assignment works through the CSS-variable
 * indirection underneath these exact names).
 */
interface DockTabTone {
  activeTab: string;
  activeBar: string;
  idleBar: string;
}

const DOCK_TAB_TONE: Record<ModuleId, DockTabTone> = {
  workspace: {
    activeTab:
      'border-tone-workspace-line bg-tone-workspace-soft text-tone-workspace-ink',
    activeBar: 'bg-tone-workspace-strong',
    idleBar: 'bg-tone-workspace-strong/35',
  },
  accounting: {
    activeTab:
      'border-tone-accounting-line bg-tone-accounting-soft text-tone-accounting-ink',
    activeBar: 'bg-tone-accounting-strong',
    idleBar: 'bg-tone-accounting-strong/35',
  },
  inventory: {
    activeTab:
      'border-tone-inventory-line bg-tone-inventory-soft text-tone-inventory-ink',
    activeBar: 'bg-tone-inventory-strong',
    idleBar: 'bg-tone-inventory-strong/35',
  },
  organization: {
    activeTab:
      'border-tone-organization-line bg-tone-organization-soft text-tone-organization-ink',
    activeBar: 'bg-tone-organization-strong',
    idleBar: 'bg-tone-organization-strong/35',
  },
  licensing: {
    activeTab:
      'border-tone-licensing-line bg-tone-licensing-soft text-tone-licensing-ink',
    activeBar: 'bg-tone-licensing-strong',
    idleBar: 'bg-tone-licensing-strong/35',
  },
  admin: {
    activeTab: 'border-tone-admin-line bg-tone-admin-soft text-tone-admin-ink',
    activeBar: 'bg-tone-admin-strong',
    idleBar: 'bg-tone-admin-strong/35',
  },
};

function displayTitle(workspaceWindow: WorkspaceWindow): string {
  return (
    workspaceWindow.titleOverride ??
    resolveWindowMeta(workspaceWindow.path).title
  );
}

/** Tab-button width per density (§4.4 exact min/max values). */
const TAB_BUTTON_WIDTH: Record<Exclude<DockDensity, 'single'>, string> = {
  full: 'min-w-28 max-w-56 flex-1 basis-0',
  compact: 'min-w-[5.5rem] max-w-40 flex-1 basis-0',
  icon: 'absolute inset-0 justify-center px-0',
};

/** Wrapper width: the tab's max plus the reserved close space. */
const TAB_WRAPPER_WIDTH: Record<Exclude<DockDensity, 'single'>, string> = {
  full: 'min-w-0 max-w-[15rem] flex-1 basis-0',
  compact: 'min-w-0 max-w-[11rem] flex-1 basis-0',
  icon: 'w-10 shrink-0 grow-0 basis-10',
};

interface DockTabProps {
  window: WorkspaceWindow;
  isActive: boolean;
  density: Exclude<DockDensity, 'single'>;
  workspace: WorkspaceApi;
  registerTab: (id: WindowId, element: HTMLButtonElement | null) => void;
  onClosedWithFocus: (index: number) => void;
  index: number;
}

function DockTab({
  window: workspaceWindow,
  isActive,
  density,
  workspace,
  registerTab,
  onClosedWithFocus,
  index,
}: DockTabProps): ReactElement {
  const { icon: Icon, module } = resolveWindowMeta(workspaceWindow.path);
  const label = displayTitle(workspaceWindow);
  const tone = DOCK_TAB_TONE[module];

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.ctrlKey || event.metaKey) {
      // Duplicate window (D-9): a second window on the same base path.
      workspace.open(workspaceWindow.basePath, { intent: 'new' });
      return;
    }
    workspace.activate(workspaceWindow.id);
  };

  const handleMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.button === 1) {
      event.preventDefault();
      workspace.open(workspaceWindow.basePath, { intent: 'new' });
    }
  };

  const handleClose = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    // The close button is about to unmount: if focus is here (or on its tab)
    // the dock must hand it to a neighbour (§5).
    const active = document.activeElement;
    if (
      active !== null &&
      (active === event.currentTarget ||
        (event.currentTarget.parentElement?.contains(active) ?? false))
    ) {
      onClosedWithFocus(index);
    }
    workspace.requestClose(workspaceWindow.id);
  };

  const closeLabel = t.nav.closeWindow.replace('{window}', label);

  return (
    <div
      className={cn(
        'group/tab relative flex h-7 shrink-0 items-center animate-rise-in',
        TAB_WRAPPER_WIDTH[density],
      )}
    >
      <button
        type="button"
        role="tab"
        id={`workspace-tab-${workspaceWindow.id}`}
        aria-selected={isActive}
        aria-controls={`workspace-panel-${workspaceWindow.id}`}
        tabIndex={isActive ? 0 : -1}
        title={label}
        data-testid="workspace-tab"
        data-window-path={workspaceWindow.basePath}
        data-active={isActive}
        ref={(element) => registerTab(workspaceWindow.id, element)}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        className={cn(
          'action-press relative flex h-7 items-center gap-1.5 rounded-control border',
          density === 'icon'
            ? TAB_BUTTON_WIDTH.icon
            : cn(TAB_BUTTON_WIDTH[density], 'pe-1.5 ps-2.5'),
          isActive
            ? cn(tone.activeTab, 'shadow-card')
            : 'border-line bg-surface text-ink-muted hover:bg-sunken',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-y-0.5 start-0 w-[3px] rounded-full',
            isActive ? tone.activeBar : tone.idleBar,
          )}
        />
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {density !== 'icon' && (
          <span className="min-w-0 truncate text-xs">{label}</span>
        )}
        {/* Colour is never the only carrier (WCAG 1.4.1): the tooltip text
            plus the sr-only note announce the dirty state. */}
        {workspaceWindow.dirty && (
          <Tooltip content={t.workspace.dirtyTooltipTitle} side="bottom">
            <span
              data-testid="workspace-tab-dirty"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn-ink"
            />
          </Tooltip>
        )}
        {workspaceWindow.dirty && (
          <span className="sr-only">{t.workspace.dirtyTooltipTitle}</span>
        )}
      </button>
      <button
        type="button"
        aria-label={closeLabel}
        title={closeLabel}
        data-testid="workspace-tab-close"
        onClick={handleClose}
        className={cn(
          'action-press flex h-5 w-5 shrink-0 items-center justify-center rounded-control text-danger-ink',
          'transition-opacity duration-150 motion-reduce:transition-none',
          'hover:bg-danger-soft focus-visible:bg-danger-soft',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger',
          // Icon density keeps the whole footprint at 2.5rem: the close
          // control overlays the tab's end edge instead of adding width
          // (never removed, never shrinking the tab — §4.4).
          density === 'icon'
            ? 'absolute -end-1 top-1/2 z-10 h-4 w-4 -translate-y-1/2 rounded-full border border-line bg-surface shadow-card'
            : '-ms-0.5',
          isActive
            ? 'opacity-100'
            : 'opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100',
        )}
      >
        <X
          className={density === 'icon' ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5'}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

interface WindowListPanelProps {
  variant: 'popover' | 'sheet';
  windows: WorkspaceWindow[];
  activeId: WindowId | null;
  workspace: WorkspaceApi;
  onClose: () => void;
}

function WindowListPanel({
  variant,
  windows,
  activeId,
  workspace,
  onClose,
}: WindowListPanelProps): ReactElement {
  const panelRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event: globalThis.MouseEvent) => {
      const panel = panelRef.current;
      if (panel !== null && !panel.contains(event.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [onClose]);

  return (
    <dialog
      open
      ref={panelRef}
      aria-label={t.workspace.windowListLabel}
      data-testid="workspace-window-list"
      data-variant={variant}
      className={cn(
        'm-0 rounded-card border border-line bg-surface shadow-raised',
        // UA dialog styles position with inset:0 + margin:auto; every inset
        // is set explicitly so the panel anchors to the dock instead.
        variant === 'sheet'
          ? 'fixed inset-x-0 bottom-0 top-auto z-40 rounded-b-none p-2'
          : 'absolute bottom-auto end-0 start-auto top-full z-40 mt-1 w-72 p-1',
      )}
    >
      <ul className="max-h-80 space-y-0.5 overflow-y-auto">
        {windows.map((workspaceWindow) => {
          const { icon: Icon, module } = resolveWindowMeta(
            workspaceWindow.path,
          );
          const label = displayTitle(workspaceWindow);
          const isActive = workspaceWindow.id === activeId;
          return (
            <li key={workspaceWindow.id} className="flex items-center gap-1">
              <button
                type="button"
                data-testid="workspace-window-list-item"
                data-window-path={workspaceWindow.basePath}
                data-active={isActive}
                onClick={() => {
                  workspace.activate(workspaceWindow.id);
                  onClose();
                }}
                className={cn(
                  'action-press flex min-w-0 flex-1 items-center gap-2 rounded-control px-2 py-1.5 text-xs',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                  isActive
                    ? 'bg-sunken font-medium text-ink'
                    : 'text-ink-muted hover:bg-sunken',
                )}
              >
                <Icon
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    NAV_TONE_TILE[module].icon,
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 truncate">{label}</span>
                {workspaceWindow.dirty && (
                  <span
                    aria-label={t.workspace.dirtyTooltipTitle}
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn-ink"
                  />
                )}
              </button>
              <button
                type="button"
                aria-label={t.nav.closeWindow.replace('{window}', label)}
                data-testid="workspace-window-list-close"
                onClick={() => workspace.requestClose(workspaceWindow.id)}
                className="action-press flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-ink-subtle hover:bg-danger-soft hover:text-danger-ink focus-visible:bg-danger-soft focus-visible:text-danger-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </dialog>
  );
}

/** The static "current window" chip shown in `single` density. */
function ActiveWindowChip({
  workspaceWindow,
}: {
  workspaceWindow: WorkspaceWindow;
}): ReactElement {
  const { title, icon: Icon, module } = resolveWindowMeta(workspaceWindow.path);
  const label = workspaceWindow.titleOverride ?? title;
  const tone = DOCK_TAB_TONE[module];
  return (
    <div
      data-testid="workspace-active-chip"
      title={label}
      className={cn(
        'relative flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-control border pe-1.5 ps-2.5 text-xs shadow-card',
        tone.activeTab,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0.5 start-0 w-[3px] rounded-full',
          tone.activeBar,
        )}
      />
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{label}</span>
      {workspaceWindow.dirty && (
        <span
          aria-label={t.workspace.dirtyTooltipTitle}
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn-ink"
        />
      )}
    </div>
  );
}

/**
 * All dock hooks live here — `WorkspaceDock` gates on the provider first so
 * no hook ever runs conditionally.
 */
function WorkspaceDockView({
  workspace,
}: {
  workspace: WorkspaceApi;
}): ReactElement {
  const { state, activeWindow, capDialogOpen } = workspace;
  const windows = state.windows;

  const isAtLeast768 = useMediaQuery('(min-width: 768px)');
  const isAtLeast1024 = useMediaQuery('(min-width: 1024px)');
  const isAtLeast1280 = useMediaQuery('(min-width: 1280px)');
  const density = computeDockDensity(
    windows.length,
    isAtLeast1024,
    isAtLeast1280,
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  const tabRefs = useRef(new Map<WindowId, HTMLButtonElement>());
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const pendingFocusIndex = useRef<number | null>(null);

  const registerTab = useCallback(
    (id: WindowId, element: HTMLButtonElement | null) => {
      if (element === null) tabRefs.current.delete(id);
      else tabRefs.current.set(id, element);
    },
    [],
  );

  // After a focused tab closes, focus lands on the neighbour (§5).
  useEffect(() => {
    const index = pendingFocusIndex.current;
    if (index === null) return;
    pendingFocusIndex.current = null;
    const target = windows[Math.min(index, windows.length - 1)];
    const element =
      target !== undefined ? tabRefs.current.get(target.id) : undefined;
    (element ?? menuButtonRef.current)?.focus();
  }, [windows]);

  const focusTabAt = useCallback(
    (target: number | 'first' | 'last') => {
      let index: number;
      if (target === 'first') index = 0;
      else if (target === 'last') index = windows.length - 1;
      else {
        // Roving tabindex (WAI-ARIA Tabs): arrows move relative to the
        // FOCUSED tab, falling back to the active window's tab when focus
        // is elsewhere in the tablist.
        const focusedIndex = windows.findIndex(
          (w) => tabRefs.current.get(w.id) === document.activeElement,
        );
        const activeIndex = windows.findIndex((w) => w.id === state.activeId);
        const base =
          focusedIndex !== -1 ? focusedIndex : Math.max(activeIndex, 0);
        index = (base + target + windows.length) % windows.length;
      }
      const focusWindow = windows[index];
      if (focusWindow !== undefined)
        tabRefs.current.get(focusWindow.id)?.focus();
    },
    [windows, state.activeId],
  );

  const handleTabListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (windows.length <= 1) return;
    // RTL: ArrowRight = previous window, ArrowLeft = next (§4.8).
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusTabAt(-1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusTabAt(1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusTabAt('first');
    } else if (event.key === 'End') {
      event.preventDefault();
      focusTabAt('last');
    }
  };

  const dirtyWindow =
    state.pendingCloseId === null
      ? null
      : (windows.find((w) => w.id === state.pendingCloseId) ?? null);

  const announcement =
    activeWindow === null
      ? ''
      : t.workspace.activeWindowAnnouncement.replace(
          '{title}',
          displayTitle(activeWindow),
        );

  const dockMenu = (
    <DropdownMenu
      open={menuOpen}
      onOpenChange={setMenuOpen}
      label={t.workspace.manageWindows}
      align="end"
      trigger={
        <button
          type="button"
          ref={menuButtonRef}
          aria-label={t.workspace.manageWindows}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          data-testid="workspace-dock-menu"
          onClick={() => setMenuOpen((open) => !open)}
          className="action-press flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-ink-subtle hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      }
    >
      <DropdownMenuItem
        icon={<List className="h-4 w-4" aria-hidden="true" />}
        onSelect={() => {
          setMenuOpen(false);
          setListOpen(true);
        }}
        data-testid="workspace-dock-manage"
      >
        {t.workspace.manageWindows}
      </DropdownMenuItem>
      <DropdownMenuItem
        icon={<CheckCheck className="h-4 w-4" aria-hidden="true" />}
        onSelect={() => {
          setMenuOpen(false);
          workspace.closeAllClean();
        }}
        data-testid="workspace-dock-close-clean"
      >
        {t.workspace.closeAllClean}
      </DropdownMenuItem>
    </DropdownMenu>
  );

  return (
    <>
      <div
        data-testid="workspace-dock"
        data-density={density}
        className="sticky top-14 z-20 no-print -mx-3 border-b border-line/80 bg-canvas/95 px-3 backdrop-blur-xs sm:-mx-5 sm:px-5 lg:-mx-6 lg:px-6"
      >
        <div className="relative flex h-9 items-center gap-1">
          {density === 'single' ? (
            <>
              {activeWindow !== null && (
                <ActiveWindowChip workspaceWindow={activeWindow} />
              )}
              <button
                type="button"
                data-testid="workspace-window-list-toggle"
                aria-expanded={listOpen}
                onClick={() => setListOpen((open) => !open)}
                className="action-press flex h-7 shrink-0 items-center gap-1 rounded-control border border-line bg-surface px-2 text-xs text-ink-muted hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <span className="tabular-nums">
                  {formatWindowCount(windows.length)}
                </span>
                <ChevronUp
                  className={cn(
                    'h-3.5 w-3.5 transition-transform motion-reduce:transition-none',
                    listOpen && 'rotate-180',
                  )}
                  aria-hidden="true"
                />
              </button>
            </>
          ) : (
            <div
              role="tablist"
              aria-orientation="horizontal"
              aria-label={`${t.nav.activeWindows}، ${formatWindowCount(windows.length)}`}
              tabIndex={-1}
              onKeyDown={handleTabListKeyDown}
              className="flex min-w-0 flex-1 items-center gap-1 overflow-x-clip"
            >
              {windows.map((workspaceWindow, index) => (
                <DockTab
                  key={workspaceWindow.id}
                  window={workspaceWindow}
                  index={index}
                  isActive={workspaceWindow.id === state.activeId}
                  density={density}
                  workspace={workspace}
                  registerTab={registerTab}
                  onClosedWithFocus={(closedIndex) => {
                    pendingFocusIndex.current = closedIndex;
                  }}
                />
              ))}
            </div>
          )}
          {density !== 'single' && (
            <span
              aria-hidden="true"
              className="shrink-0 ps-2 text-[0.6875rem] tabular-nums text-ink-subtle"
            >
              {formatWindowCount(windows.length)}
            </span>
          )}
          {dockMenu}
          {listOpen && (
            <div className="absolute inset-x-0 top-full">
              <WindowListPanel
                variant={
                  density === 'single' && !isAtLeast768 ? 'sheet' : 'popover'
                }
                windows={windows}
                activeId={state.activeId}
                workspace={workspace}
                onClose={() => setListOpen(false)}
              />
            </div>
          )}
        </div>
      </div>

      <output aria-live="polite" className="sr-only">
        {announcement}
      </output>

      {/* Dirty-close confirmation (§4.7): the only way a dirty window closes.
          ConfirmDialog focuses the safe exit (cancel) first and its backdrop
          mousedown cancels — both required by §4.5. */}
      <ConfirmDialog
        open={dirtyWindow !== null}
        title={t.workspace.dirtyCloseTitle}
        description={
          dirtyWindow === null
            ? t.workspace.dirtyCloseMessage
            : `${displayTitle(dirtyWindow)} — ${t.workspace.dirtyCloseMessage}`
        }
        confirmLabel={t.workspace.closeWithoutSave}
        cancelLabel={t.workspace.backToWindow}
        danger
        onConfirm={() => {
          const id = state.pendingCloseId;
          workspace.cancelPendingClose();
          if (id !== null) workspace.close(id);
        }}
        onCancel={() => workspace.cancelPendingClose()}
      />

      {/* Cap dialog (§4.5 step 5): never auto-closes anything (D-2) — the
          user activates a window or closes the clean ones explicitly. */}
      <ConfirmDialog
        open={capDialogOpen}
        title={t.workspace.capDialogTitle}
        description={t.workspace.capDialogBody}
        confirmLabel={t.workspace.closeAllClean}
        onConfirm={() => {
          workspace.dismissCapDialog();
          workspace.closeAllClean();
        }}
        onCancel={() => workspace.dismissCapDialog()}
      >
        <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded-control border border-line bg-sunken p-1">
          {windows.map((workspaceWindow) => (
            <li key={workspaceWindow.id}>
              <button
                type="button"
                data-testid="workspace-cap-dialog-window"
                data-window-path={workspaceWindow.basePath}
                onClick={() => {
                  workspace.dismissCapDialog();
                  workspace.activate(workspaceWindow.id);
                }}
                className={cn(
                  'action-press flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-xs',
                  workspaceWindow.id === state.activeId
                    ? 'bg-surface font-medium text-ink shadow-card'
                    : 'text-ink-muted hover:bg-surface',
                )}
              >
                <span className="min-w-0 truncate">
                  {displayTitle(workspaceWindow)}
                </span>
                {workspaceWindow.dirty && (
                  <span
                    aria-label={t.workspace.dirtyTooltipTitle}
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn-ink"
                  />
                )}
              </button>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </>
  );
}

export function WorkspaceDock(): ReactElement | null {
  const workspace = useWorkspace();
  if (workspace === null) return null;
  return <WorkspaceDockView workspace={workspace} />;
}
