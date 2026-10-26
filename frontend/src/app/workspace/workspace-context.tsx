/**
 * WorkspaceProvider + the public workspace hooks (ADR-0054, spec §6.5).
 *
 * One bounded `useReducer` + Context at the `AppShell` level owns
 * `{windows, activeId, pendingCloseId}` — no global store, no new runtime
 * dependency; TanStack Query remains the only server-state cache (D-12).
 *
 * Two contexts, deliberately split:
 *  - `WorkspaceStateContext` changes with the state (the dock, host and
 *    shell chrome consume it);
 *  - `WorkspaceActionsContext` is referentially STABLE — forms inside
 *    windows call `useWorkspaceWindowDirty` / `useWorkspaceWindowTitle`
 *    through it and never re-render because the dock changed.
 *
 * `useWorkspaceWindowDirty` / `useWorkspaceWindowTitle` are no-ops outside
 * the provider so isolated page tests keep working (spec §8).
 *
 * The provider also owns:
 *  - refresh restore + deep-link reconciliation (§6.10·الف, FDR-01 §3.1) —
 *    the route-knowledge for "known route" validation is INJECTED
 *    (`isKnownRoute`) so this module never imports the route tree (which
 *    would cycle back through feature pages);
 *  - the debounced sessionStorage writer;
 *  - the browser-URL mirror of the active window (`replace` only, W-07, with
 *    a `lastSyncedRef` loop-breaker);
 *  - per-window scroll memory (§6.5);
 *  - the limited `Alt+*` shortcuts (§4.8).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  attachWorkspaceShortcuts,
  type WorkspaceShortcutContext,
} from './workspace-shortcuts';
import {
  computeOpen,
  createInitialWorkspaceState,
  freshWorkspaceState,
  generateWindowId,
  workspaceReducer,
  type OpenIntent,
  type OpenResult,
  type WindowId,
  type WorkspaceAction,
  type WorkspaceState,
  type WorkspaceWindow,
} from './workspace-reducer';
import {
  clearStoredWorkspace,
  readStoredWorkspace,
  serializeWorkspace,
  WorkspacePersistenceWriter,
} from './workspace-persistence';
import { WindowScrollMemory } from './workspace-scroll';

/** Runtime facts of the window a component is rendered inside (§6.5). */
export interface WindowRuntime {
  id: WindowId;
  basePath: string;
  path: string;
  dirty: boolean;
}

export interface WorkspaceActions {
  /** §4.5 `open` — reuse by basePath, `/new` always creates, cap = 12. */
  open: (target: string, options?: { intent?: OpenIntent }) => OpenResult;
  activate: (id: WindowId) => void;
  requestClose: (id: WindowId) => void;
  close: (id: WindowId) => void;
  closeAllClean: () => void;
  cancelPendingClose: () => void;
  /** Organization / financial-context reset (W-06, §6.8). */
  reset: () => void;
  /** Internal host hooks — stable, never re-created. */
  markMounted: (id: WindowId) => void;
  setPath: (id: WindowId, path: string) => void;
  setDirty: (id: WindowId, dirty: boolean) => void;
  setTitle: (id: WindowId, title: string | null) => void;
  /** Cap dialog (§4.5 step 5) — shown when `open` returned `capped`. */
  dismissCapDialog: () => void;
}

export interface WorkspaceApi extends WorkspaceActions {
  state: WorkspaceState;
  /** True once the shell gates are through (persistence/URL-sync active). */
  ready: boolean;
  capDialogOpen: boolean;
  activeWindow: WorkspaceWindow | null;
  hasDirtyWindows: boolean;
}

interface WorkspaceStateContextValue {
  state: WorkspaceState;
  ready: boolean;
  capDialogOpen: boolean;
}

const WorkspaceStateContext = createContext<WorkspaceStateContextValue | null>(
  null,
);
const WorkspaceActionsContext = createContext<WorkspaceActions | null>(null);
const WorkspaceWindowContext = createContext<WindowRuntime | null>(null);

export { WorkspaceWindowContext };

export interface WorkspaceProviderProps {
  children: ReactNode;
  /** The shell gates are through — gates persistence writes and URL sync. */
  ready: boolean;
  /**
   * Live deep links must resolve to a known `/app` route. Injected by
   * `AppShell` (`matchWorkspaceRoute`) to keep this module free of the route
   * tree; tests inject a fake. Defaults to "every /app path".
   */
  isKnownRoute?: (basePath: string) => boolean;
  /**
   * The STRICT restore predicate (FDR-01 §3.1 — a path that only matches the
   * `*` 404 leaf is dropped on refresh). Defaults to `isKnownRoute`.
   */
  isRestorableRoute?: (basePath: string) => boolean;
}

export function WorkspaceProvider({
  children,
  ready,
  isKnownRoute,
  isRestorableRoute,
}: WorkspaceProviderProps) {
  const knownRoute =
    isKnownRoute ?? ((path: string) => path.startsWith('/app'));
  const restorableRoute = isRestorableRoute ?? knownRoute;

  // The ROUTER's location is the app's URL truth — in the browser it mirrors
  // window.location, under tests it is the test router's entry. The initial
  // window / deep link derive from it; `window.location` is never read (the
  // W-07 mirror writes back through the same router with `replace`).
  const initialLocation = useLocation();

  const [state, rawDispatch] = useReducer(workspaceReducer, undefined, () =>
    createInitialWorkspaceState({
      snapshot: readStoredWorkspace(),
      browserPath: `${initialLocation.pathname}${initialLocation.search}${initialLocation.hash}`,
      freshId: generateWindowId(),
      deepLinkId: generateWindowId(),
      isKnownRoute: knownRoute,
      isRestorableRoute: restorableRoute,
    }),
  );

  /*
   * Tracked mirror of the latest state: `open()` must return its result
   * synchronously (§4.5 OpenResult) and shortcuts must read the current
   * window list without re-subscribing. Every mutation goes through
   * `dispatch`, which runs the SAME pure reducer on the mirror first, so the
   * ref and React's state can never diverge.
   */
  const tracked = useRef<WorkspaceState>(state);

  const dispatch = useCallback((action: WorkspaceAction) => {
    tracked.current = workspaceReducer(tracked.current, action);
    rawDispatch(action);
  }, []);

  // useState initializers create the runtime helpers exactly once without
  // touching refs during render (react-hooks compiler rule).
  const [scroll] = useState(() => new WindowScrollMemory());

  const [capDialogOpen, setCapDialogOpen] = useState(false);

  const [writer] = useState(() => new WorkspacePersistenceWriter());

  const open = useCallback<WorkspaceActions['open']>(
    (target, options) => {
      const intent = options?.intent ?? 'auto';
      const id = generateWindowId();
      // Peek at the outcome on the tracked mirror so the result is
      // SYNCHRONOUS (§4.5 OpenResult); `dispatch` below applies the very
      // same pure transition — never pre-apply here or the action would run
      // twice.
      const { result } = computeOpen(tracked.current, target, intent, id);
      if (result.kind === 'capped') {
        setCapDialogOpen(true);
        return result;
      }
      dispatch({ type: 'open', target, intent, id });
      return result;
    },
    [dispatch],
  );

  const activate = useCallback(
    (id: WindowId) => {
      const current = tracked.current;
      if (current.activeId === id) return;
      // Save the outgoing window's scroll BEFORE the switch (§6.5).
      if (current.activeId !== null) scroll.save(current.activeId);
      dispatch({ type: 'activate', id });
    },
    [dispatch, scroll],
  );

  const close = useCallback(
    (id: WindowId) => {
      scroll.forget(id);
      dispatch({ type: 'close', id, fallbackId: generateWindowId() });
    },
    [dispatch, scroll],
  );

  const requestClose = useCallback(
    (id: WindowId) => {
      dispatch({ type: 'requestClose', id, fallbackId: generateWindowId() });
    },
    [dispatch],
  );

  const closeAllClean = useCallback(() => {
    for (const window of tracked.current.windows) {
      if (!window.dirty) scroll.forget(window.id);
    }
    dispatch({ type: 'closeAllClean', fallbackId: generateWindowId() });
  }, [dispatch, scroll]);

  const reset = useCallback(() => {
    scroll.clear();
    dispatch({ type: 'reset', fallbackId: generateWindowId() });
  }, [dispatch, scroll]);

  const markMounted = useCallback(
    (id: WindowId) => dispatch({ type: 'markMounted', id }),
    [dispatch],
  );
  const setPath = useCallback(
    (id: WindowId, path: string) => dispatch({ type: 'setPath', id, path }),
    [dispatch],
  );
  const setDirty = useCallback(
    (id: WindowId, dirty: boolean) => dispatch({ type: 'setDirty', id, dirty }),
    [dispatch],
  );
  const setTitle = useCallback(
    (id: WindowId, title: string | null) =>
      dispatch({ type: 'setTitle', id, title }),
    [dispatch],
  );
  const cancelPendingClose = useCallback(
    () => dispatch({ type: 'cancelPendingClose' }),
    [dispatch],
  );
  const dismissCapDialog = useCallback(() => setCapDialogOpen(false), []);

  const actions = useMemo<WorkspaceActions>(
    () => ({
      open,
      activate,
      requestClose,
      close,
      closeAllClean,
      cancelPendingClose,
      reset,
      markMounted,
      setPath,
      setDirty,
      setTitle,
      dismissCapDialog,
    }),
    [
      open,
      activate,
      requestClose,
      close,
      closeAllClean,
      cancelPendingClose,
      reset,
      markMounted,
      setPath,
      setDirty,
      setTitle,
      dismissCapDialog,
    ],
  );

  const activeWindow =
    state.windows.find((window) => window.id === state.activeId) ?? null;

  /* ---- Persistence: the one versioned sessionStorage key (§6.10·الف) ---- */
  useEffect(() => {
    if (!ready) return;
    writer.schedule(serializeWorkspace(state));
  }, [ready, state, writer]);
  useEffect(() => () => writer.cancel(), [writer]);

  /* ---- Browser URL mirrors the active window (`replace` only, W-07) ---- */
  const outerLocation = useLocation();
  const outerNavigate = useNavigate();
  const lastSyncedRef = useRef<string | null>(null);
  const activePath = ready ? (activeWindow?.path ?? null) : null;
  useEffect(() => {
    if (activePath === null) return;
    const current = `${outerLocation.pathname}${outerLocation.search}${outerLocation.hash}`;
    if (current === activePath) {
      lastSyncedRef.current = activePath;
      return;
    }
    // Loop-breaker: a URL this sync already produced is never re-synced.
    if (lastSyncedRef.current === activePath) return;
    lastSyncedRef.current = activePath;
    outerNavigate(activePath, { replace: true });
  }, [activePath, outerLocation, outerNavigate]);

  /* ---- Per-window scroll restore after activation (§6.5) ---- */
  const activeId = state.activeId;
  useEffect(() => {
    if (activeId === null) return;
    const frame = requestAnimationFrame(() => scroll.restore(activeId));
    return () => cancelAnimationFrame(frame);
  }, [activeId, scroll]);

  /* ---- Limited dock shortcuts (§4.8) ---- */
  useEffect(() => {
    if (!ready) return;
    return attachWorkspaceShortcuts({
      getWindowContext: (): WorkspaceShortcutContext => {
        const current = tracked.current;
        return {
          windowCount: current.windows.length,
          hasActiveWindow: current.activeId !== null,
          eventTarget:
            typeof document === 'undefined' ? null : document.activeElement,
        };
      },
      closeActive: () => {
        const current = tracked.current;
        if (current.activeId !== null) requestClose(current.activeId);
      },
      activateOffset: (offset) => {
        const current = tracked.current;
        const index = current.windows.findIndex(
          (window) => window.id === current.activeId,
        );
        if (index === -1 || current.windows.length <= 1) return;
        const next =
          (index + offset + current.windows.length) % current.windows.length;
        const target = current.windows[next];
        if (target !== undefined) activate(target.id);
      },
      activateIndex: (index) => {
        const target = tracked.current.windows[index];
        if (target !== undefined) activate(target.id);
      },
    });
  }, [ready, activate, requestClose]);

  const stateValue = useMemo(
    () => ({ state, ready, capDialogOpen }),
    [state, ready, capDialogOpen],
  );

  return (
    <WorkspaceStateContext.Provider value={stateValue}>
      <WorkspaceActionsContext.Provider value={actions}>
        {children}
      </WorkspaceActionsContext.Provider>
    </WorkspaceStateContext.Provider>
  );
}

/** The full workspace API; `null` outside the provider. */
export function useWorkspace(): WorkspaceApi | null {
  const stateContext = useContext(WorkspaceStateContext);
  const actions = useContext(WorkspaceActionsContext);
  if (stateContext === null || actions === null) return null;
  const activeWindow =
    stateContext.state.windows.find(
      (window) => window.id === stateContext.state.activeId,
    ) ?? null;
  return {
    ...actions,
    state: stateContext.state,
    ready: stateContext.ready,
    capDialogOpen: stateContext.capDialogOpen,
    activeWindow,
    hasDirtyWindows: stateContext.state.windows.some((w) => w.dirty),
  };
}

/** Stable action channel — consumed by form hooks (no state re-renders). */
export function useWorkspaceActions(): WorkspaceActions | null {
  return useContext(WorkspaceActionsContext);
}

/** The runtime facts of the window the caller is rendered inside. */
export function useWorkspaceWindow(): WindowRuntime | null {
  return useContext(WorkspaceWindowContext);
}

/**
 * A form announces `formState.isDirty` for its window (§4.7). Outside the
 * provider or outside a window it is a NO-OP, so isolated page tests are
 * unaffected. Unmounting the form clears the flag.
 */
export function useWorkspaceWindowDirty(isDirty: boolean): void {
  const runtime = useWorkspaceWindow();
  const actions = useWorkspaceActions();
  const id = runtime?.id ?? null;
  useEffect(() => {
    if (id === null || actions === null) return;
    actions.setDirty(id, isDirty);
  }, [id, isDirty, actions]);
  useEffect(() => {
    if (id === null || actions === null) return;
    return () => actions.setDirty(id, false);
  }, [id, actions]);
}

/**
 * A page sets its own window's tab title (e.g. the 404 and profile pages,
 * whose derived fallback would otherwise show a raw segment). Only the
 * DISPLAYED title changes — module, tone and icon stay derived (§6.6).
 * No-op outside the provider/window.
 */
export function useWorkspaceWindowTitle(title: string): void {
  const runtime = useWorkspaceWindow();
  const actions = useWorkspaceActions();
  const id = runtime?.id ?? null;
  useEffect(() => {
    if (id === null || actions === null) return;
    actions.setTitle(id, title);
  }, [id, title, actions]);
}

/** Logout / session expiry clear the restore key (§6.10, FDR-01 §3.1). */
export function clearWorkspaceOnSessionEnd(): void {
  clearStoredWorkspace();
}

export { freshWorkspaceState };
