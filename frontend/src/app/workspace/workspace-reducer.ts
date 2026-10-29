/**
 * Workspace window state — the bounded client-owned reducer of the
 * multi-window dock (ADR-0054, workspace-windows spec §6.4).
 *
 * Contract highlights (every one is unit-tested in `workspace-reducer.test.ts`):
 *  1. `windows.length <= MAX_WINDOWS` always; the cap returns a `capped`
 *     result and never throws.
 *  2. Reuse is by `basePath` only, and a `/new` destination NEVER reuses — it
 *     always creates a fresh draft window (W-03).
 *  3. `dirty` and `mounted` are runtime-only; persistence stores navigation
 *     identity (`id`, `basePath`, `path`) and nothing else.
 *  4. Titles, tones and icons are derived (`workspace-meta.ts`), never stored
 *     — except the explicit `titleOverride` a page sets for its own window.
 *  5. No API data, form values, tokens, organization ids or dates live here.
 *  6. After `restore`: every window is `mounted=false`, `dirty=false`, and
 *     `activeId` is the snapshot's (falling back to the first window).
 *  7. After `reset`: exactly one fresh workspace window, `pendingCloseId=null`.
 *  8. After `close`: if the list became empty, a fresh workspace window is
 *     created and activated.
 *
 * The reducer is pure and deterministic: fresh-window ids for the
 * empty-list/reset fallbacks are supplied by the dispatcher (`fallbackId`)
 * because React may invoke a reducer more than once per action.
 */

import type { StoredWorkspace } from './workspace-persistence';

export type WindowId = string;

export type OpenIntent = 'auto' | 'new';

export interface WorkspaceWindow {
  id: WindowId;
  /** `location.pathname` without query/hash — the basis of reuse. */
  basePath: string;
  /** The real `pathname + search + hash`. */
  path: string;
  /** Runtime only: at least one form in the window reports `isDirty`. */
  dirty: boolean;
  /** Runtime only: the host has rendered this window at least once. */
  mounted: boolean;
  /**
   * Runtime only: the path the window's `MemoryRouter` was created with.
   * Set by `markMounted`; keeps keep-alive semantics explicit (later
   * in-window navigation lives inside the MemoryRouter, `path` mirrors it).
   */
  mountPath: string | null;
  /** Explicit title set by the page itself (e.g. 404, profile). */
  titleOverride: string | null;
  /**
   * Runtime only: the `basePath` of the window this one was opened FROM while
   * that window was active (the list a record was opened from). Back in the
   * shared form header uses it to return to that exact parent — filters
   * intact — and only while it is still open. Navigation metadata only; it is
   * never persisted (workspace-persistence stores id/basePath/path/activeId).
   */
  openedFrom: string | null;
}

export interface WorkspaceState {
  /** Array order = dock order. */
  windows: WorkspaceWindow[];
  activeId: WindowId | null;
  /** The window whose dirty-close confirmation dialog is open (mutex). */
  pendingCloseId: WindowId | null;
}

/** Hard cap of concurrently open windows (D-2, confirmed 2026-10-26). */
export const MAX_WINDOWS = 12;

/** The workspace (میزکار) window path — the reset/fresh fallback. */
export const WORKSPACE_HOME_PATH = '/app';

export interface OpenResult {
  kind: 'reused' | 'created' | 'capped';
  /** The window the caller should look at (reused/created); null when capped. */
  id: WindowId | null;
}

export type WorkspaceAction =
  | { type: 'restore'; snapshot: StoredWorkspace }
  | { type: 'open'; target: string; intent: OpenIntent; id: WindowId }
  | { type: 'activate'; id: WindowId }
  | { type: 'markMounted'; id: WindowId }
  | { type: 'setPath'; id: WindowId; path: string }
  | { type: 'setDirty'; id: WindowId; dirty: boolean }
  | { type: 'setTitle'; id: WindowId; title: string | null }
  | { type: 'requestClose'; id: WindowId; fallbackId: WindowId }
  | { type: 'cancelPendingClose' }
  | { type: 'close'; id: WindowId; fallbackId: WindowId }
  | { type: 'closeAllClean'; fallbackId: WindowId }
  | { type: 'reset'; fallbackId: WindowId };

/** Split an in-app target into `basePath` (pathname) and the full `path`. */
export function splitTargetPath(target: string): {
  basePath: string;
  path: string;
} {
  const hashIndex = target.indexOf('#');
  const withoutHash = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf('?');
  const basePath =
    queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
  return { basePath: basePath === '' ? '/' : basePath, path: target };
}

export function createWorkspaceWindow(
  id: WindowId,
  target: string,
  openedFrom: string | null = null,
): WorkspaceWindow {
  const { basePath, path } = splitTargetPath(target);
  return {
    id,
    basePath,
    path,
    dirty: false,
    mounted: false,
    mountPath: null,
    titleOverride: null,
    openedFrom: openedFrom === basePath ? null : openedFrom,
  };
}

/** A single-window state at `path` — the fresh/reset shape. */
export function freshWorkspaceState(
  id: WindowId,
  path: string = WORKSPACE_HOME_PATH,
): WorkspaceState {
  return {
    windows: [createWorkspaceWindow(id, path)],
    activeId: id,
    pendingCloseId: null,
  };
}

/** True when a draft (`/new`) destination — never reused (W-03). */
export function isDraftPath(basePath: string): boolean {
  return basePath.endsWith('/new');
}

function findWindow(
  state: WorkspaceState,
  id: WindowId,
): WorkspaceWindow | undefined {
  return state.windows.find((window) => window.id === id);
}

/**
 * The §4.5 `open` contract as a pure function, shared by the reducer and by
 * `WorkspaceProvider.open()` (which needs the `OpenResult` synchronously).
 */
export function computeOpen(
  state: WorkspaceState,
  target: string,
  intent: OpenIntent,
  id: WindowId,
): { state: WorkspaceState; result: OpenResult } {
  const { basePath } = splitTargetPath(target);

  // Steps 2–3: an explicit `new` intent or any `/new` destination skips reuse.
  if (intent !== 'new' && !isDraftPath(basePath)) {
    // Step 4: reuse an open window by basePath — activating it does NOT touch
    // its `path`, so the window's current filters survive.
    const existing = state.windows.find(
      (window) => window.basePath === basePath,
    );
    if (existing !== undefined) {
      return {
        state: {
          ...state,
          activeId: existing.id,
          pendingCloseId: null,
        },
        result: { kind: 'reused', id: existing.id },
      };
    }
  }

  // Step 5: the cap — no window is ever auto-closed (W-12); the UI shows the
  // cap dialog instead.
  if (state.windows.length >= MAX_WINDOWS) {
    return { state, result: { kind: 'capped', id: null } };
  }

  // Step 6: create at the end of the array and activate. The window that was
  // active becomes this window's parent screen (a record opened from a list),
  // unless the target IS that window's own path (a duplicate/refresh).
  const active = state.windows.find((window) => window.id === state.activeId);
  const created = createWorkspaceWindow(
    id,
    target,
    active !== undefined && active.basePath !== basePath
      ? active.basePath
      : null,
  );
  return {
    state: {
      ...state,
      windows: [...state.windows, created],
      activeId: created.id,
      pendingCloseId: null,
    },
    result: { kind: 'created', id: created.id },
  };
}

/**
 * `close(id)` semantics: remove the window; when it was active, the NEXT
 * neighbour in array order becomes active (the previous one when it was the
 * last); when the list becomes empty, a fresh workspace window opens.
 */
function closeWindow(
  state: WorkspaceState,
  id: WindowId,
  fallbackId: WindowId,
): WorkspaceState {
  const index = state.windows.findIndex((window) => window.id === id);
  if (index === -1) return state;
  const remaining = state.windows.filter((window) => window.id !== id);
  if (remaining.length === 0) {
    return freshWorkspaceState(fallbackId, WORKSPACE_HOME_PATH);
  }
  let activeId = state.activeId;
  if (state.activeId === id) {
    const neighbour = remaining[Math.min(index, remaining.length - 1)];
    // `remaining` is non-empty here, so the neighbour always exists; the
    // guard only satisfies exhaustive index checking.
    if (neighbour !== undefined) activeId = neighbour.id;
  }
  return {
    windows: remaining,
    activeId,
    pendingCloseId: state.pendingCloseId === id ? null : state.pendingCloseId,
  };
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case 'restore': {
      const windows = action.snapshot.windows
        .slice(0, MAX_WINDOWS)
        .map((descriptor) => ({
          ...createWorkspaceWindow(descriptor.id, descriptor.path),
          basePath: descriptor.basePath,
        }));
      if (windows.length === 0) return state;
      const activeId = windows.some((w) => w.id === action.snapshot.activeId)
        ? action.snapshot.activeId
        : (windows[0]?.id ?? null);
      return { windows, activeId, pendingCloseId: null };
    }

    case 'open': {
      return computeOpen(state, action.target, action.intent, action.id).state;
    }

    case 'activate': {
      if (findWindow(state, action.id) === undefined) return state;
      if (state.activeId === action.id && state.pendingCloseId === null) {
        return state;
      }
      // Activating another tab cancels a pending dirty-close dialog (§4.5).
      return { ...state, activeId: action.id, pendingCloseId: null };
    }

    case 'markMounted': {
      let changed = false;
      const windows = state.windows.map((window) => {
        if (window.id !== action.id || window.mounted) return window;
        changed = true;
        return { ...window, mounted: true, mountPath: window.path };
      });
      return changed ? { ...state, windows } : state;
    }

    case 'setPath': {
      const window = findWindow(state, action.id);
      if (window === undefined || window.path === action.path) return state;
      const { basePath } = splitTargetPath(action.path);
      const windows = state.windows.map((item) =>
        item.id === action.id
          ? {
              ...item,
              path: action.path,
              basePath,
              // Navigating the window somewhere else invalidates a title the
              // previous page set for itself (e.g. the 404 override).
              titleOverride:
                item.basePath === basePath ? item.titleOverride : null,
            }
          : item,
      );
      return { ...state, windows };
    }

    case 'setDirty': {
      const window = findWindow(state, action.id);
      if (window === undefined || window.dirty === action.dirty) return state;
      const windows = state.windows.map((item) =>
        item.id === action.id ? { ...item, dirty: action.dirty } : item,
      );
      return { ...state, windows };
    }

    case 'setTitle': {
      const window = findWindow(state, action.id);
      if (window === undefined || window.titleOverride === action.title) {
        return state;
      }
      const windows = state.windows.map((item) =>
        item.id === action.id ? { ...item, titleOverride: action.title } : item,
      );
      return { ...state, windows };
    }

    case 'requestClose': {
      const window = findWindow(state, action.id);
      if (window === undefined) return state;
      // A dirty window is only closed through explicit confirmation (W-05);
      // one dialog at a time (mutex on `pendingCloseId`).
      if (window.dirty) {
        if (state.pendingCloseId === action.id) return state;
        return { ...state, pendingCloseId: action.id };
      }
      return closeWindow(state, action.id, action.fallbackId);
    }

    case 'cancelPendingClose': {
      if (state.pendingCloseId === null) return state;
      return { ...state, pendingCloseId: null };
    }

    case 'close': {
      return closeWindow(state, action.id, action.fallbackId);
    }

    case 'closeAllClean': {
      // Close every clean window (through the tested close semantics, in
      // dock order); dirty windows always survive — never auto-closed.
      let next = state;
      for (const window of state.windows) {
        if (!window.dirty) {
          next = closeWindow(next, window.id, action.fallbackId);
        }
      }
      return { ...next, pendingCloseId: null };
    }

    case 'reset': {
      return freshWorkspaceState(action.fallbackId, WORKSPACE_HOME_PATH);
    }

    default:
      return state;
  }
}

export interface CreateInitialWorkspaceStateOptions {
  /** The validated sessionStorage snapshot, or null when absent/invalid. */
  snapshot: StoredWorkspace | null;
  /** The browser URL at load time (refresh / deep link), e.g. `/app/x?a=1`. */
  browserPath: string;
  /** Id for the fresh window when no snapshot is usable. */
  freshId: WindowId;
  /**
   * A RESTORED path is only kept when it resolves to a real `/app` route
   * (FDR-01 §3.1: garbage never becomes a window). Strict: a path that only
   * resolves through the `*` 404 leaf counts as unknown. Injected so this
   * module stays free of the route tree (and of import cycles through
   * features).
   */
  isRestorableRoute: (basePath: string) => boolean;
  /**
   * A live browser deep link is accepted more leniently: an unknown `/app`
   * path still opens (showing the in-window 404, exactly as the pre-window
   * router did) — the strict rule above only guards the RESTORE path.
   */
  isKnownRoute: (basePath: string) => boolean;
  /** Id for an extra window created for a deep link outside the snapshot. */
  deepLinkId: WindowId;
}

/**
 * Initial state on shell mount: the restored window list reconciled with the
 * browser URL. Rules (all covered by tests):
 * - no/invalid snapshot → one window at the browser path (or the workspace);
 * - restored windows whose `basePath` is not a known route are dropped;
 * - the restored active window keeps its slot; when the browser URL points at
 *   a different restored window, THAT window becomes active (deep link) and
 *   the rest of the list is preserved;
 * - when the browser URL matches no restored window and is a known route, it
 *   is appended as a new active window (within the cap);
 * - restored windows are descriptors: `mounted=false`, `dirty=false` — they
 *   mount lazily on first activation (W-16).
 */
export function createInitialWorkspaceState(
  options: CreateInitialWorkspaceStateOptions,
): WorkspaceState {
  const {
    snapshot,
    browserPath,
    freshId,
    isKnownRoute,
    isRestorableRoute,
    deepLinkId,
  } = options;
  const browser = splitTargetPath(browserPath);
  const browserIsApp = browser.basePath.startsWith('/app');
  const fallbackPath = browserIsApp ? browserPath : WORKSPACE_HOME_PATH;

  if (snapshot === null) {
    return freshWorkspaceState(freshId, fallbackPath);
  }

  const windows = snapshot.windows
    .filter((descriptor) => isRestorableRoute(descriptor.basePath))
    .slice(0, MAX_WINDOWS)
    .map((descriptor) => ({
      ...createWorkspaceWindow(descriptor.id, descriptor.path),
      basePath: descriptor.basePath,
    }));

  if (windows.length === 0) {
    return freshWorkspaceState(freshId, fallbackPath);
  }

  let activeId = windows.some((window) => window.id === snapshot.activeId)
    ? snapshot.activeId
    : (windows[0]?.id as WindowId);

  // Reconcile with the browser URL: the mirror is the freshest truth about
  // what the operator was looking at when the page (re)loaded.
  if (browserIsApp) {
    const active = windows.find((window) => window.id === activeId);
    if (active !== undefined && active.basePath === browser.basePath) {
      active.path = browserPath;
    } else {
      const match = windows.find(
        (window) => window.basePath === browser.basePath,
      );
      if (match !== undefined) {
        match.path = browserPath;
        activeId = match.id;
      } else if (
        isKnownRoute(browser.basePath) &&
        windows.length < MAX_WINDOWS
      ) {
        const extra = createWorkspaceWindow(deepLinkId, browserPath);
        windows.push(extra);
        activeId = extra.id;
      }
    }
  }

  return { windows, activeId, pendingCloseId: null };
}

/**
 * Window ids are opaque, unique per open, and never shown to the user
 * (§6.2). Generated OUTSIDE the reducer (ids arrive inside actions) so the
 * reducer stays pure. `crypto.randomUUID` with a counter/time fallback —
 * the id shape satisfies the persistence validator (8–64 of `[A-Za-z0-9-]`).
 */
let fallbackCounter = 0;
export function generateWindowId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  fallbackCounter += 1;
  return `win-${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
}
