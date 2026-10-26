/**
 * Dock keyboard shortcuts (spec §4.8) — a deliberately limited handler at
 * the `AppShell` level; no global shortcut registry is built in phase 1.
 *
 *  - `Alt+W`            close the active window (dirty rules apply). Ignored
 *                       while focus is in `input/textarea/[contenteditable]`.
 *  - `Alt+ArrowRight`   previous window (RTL: right = previous).
 *  - `Alt+ArrowLeft`    next window. No-op with a single window.
 *  - `Alt+1..9`         jump to window n; no-op when n > N.
 *  - `Escape`           never closes a window; it only cancels dialogs
 *                       (handled by the dialog primitives themselves).
 *
 * Every handled combination calls `preventDefault` — `Alt+Arrow` is the
 * browser's own back/forward gesture and must not fight the URL mirror
 * (browser back/forward integration is phase 3, D-4).
 */

export type WorkspaceShortcutAction =
  | { type: 'closeActive' }
  | { type: 'activateOffset'; offset: -1 | 1 }
  | { type: 'activateIndex'; index: number };

export interface WorkspaceShortcutContext {
  /** Number of open windows (N). */
  windowCount: number;
  /** Whether any window is active at all. */
  hasActiveWindow: boolean;
  /** The event target — text-editing surfaces skip `Alt+W`. */
  eventTarget: EventTarget | null;
}

export function isTextEditingTarget(target: EventTarget | null): boolean {
  if (target === null || typeof (target as HTMLElement).tagName !== 'string') {
    return false;
  }
  const element = target as HTMLElement;
  const tag = element.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return true;
  // Browsers resolve inherited editability through `isContentEditable`;
  // jsdom does not implement it, so the reflected attribute is checked too.
  if (element.isContentEditable === true) return true;
  return element.contentEditable === 'true';
}

/**
 * Pure decision function: what (if anything) a keydown means for the dock.
 * Unit-tested for every branch, including the no-ops.
 */
export function resolveWorkspaceShortcut(
  event: Pick<
    KeyboardEvent,
    'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'
  >,
  context: WorkspaceShortcutContext,
): WorkspaceShortcutAction | null {
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;

  const key = event.key;

  if (key === 'w' || key === 'W') {
    if (event.shiftKey) return null;
    if (isTextEditingTarget(context.eventTarget)) return null;
    if (!context.hasActiveWindow) return null;
    return { type: 'closeActive' };
  }

  if (key === 'ArrowRight') {
    // RTL: right is the PREVIOUS window.
    if (context.windowCount <= 1) return null;
    return { type: 'activateOffset', offset: -1 };
  }
  if (key === 'ArrowLeft') {
    if (context.windowCount <= 1) return null;
    return { type: 'activateOffset', offset: 1 };
  }

  if (/^[1-9]$/.test(key)) {
    const index = Number(key) - 1;
    if (index >= context.windowCount) return null;
    return { type: 'activateIndex', index };
  }

  return null;
}

export interface WorkspaceShortcutHandlers {
  closeActive: () => void;
  activateOffset: (offset: -1 | 1) => void;
  activateIndex: (index: number) => void;
  getWindowContext: () => WorkspaceShortcutContext;
}

/**
 * Attach the limited dock handler to `window`. Returns the detach function.
 * The decision stays in `resolveWorkspaceShortcut` so tests never need DOM
 * keyboard plumbing.
 */
export function attachWorkspaceShortcuts(
  handlers: WorkspaceShortcutHandlers,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onKeyDown = (event: KeyboardEvent) => {
    const action = resolveWorkspaceShortcut(event, handlers.getWindowContext());
    if (action === null) return;
    event.preventDefault();
    if (action.type === 'closeActive') handlers.closeActive();
    else if (action.type === 'activateOffset') {
      handlers.activateOffset(action.offset);
    } else handlers.activateIndex(action.index);
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
