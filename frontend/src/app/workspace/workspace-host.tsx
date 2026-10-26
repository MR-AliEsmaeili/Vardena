/**
 * WorkspaceWindowHost — renders every open window (ADR-0054, spec §6.4·§6.5).
 *
 * One active window + dock; the rest stay MOUNTED but hidden
 * (`hidden` + `inert` + `aria-hidden`) so their component state, scroll and
 * query cache survive switches (keep-alive, W-01; D-11). A window that has
 * never been rendered — a descriptor restored from sessionStorage — mounts
 * lazily on first activation and until then is represented by an inert
 * placeholder so dock `aria-controls` references always resolve.
 *
 * Each mounted window gets its OWN `MemoryRouter` seeded once with its mount
 * path (D-12): in-window navigation never touches the browser URL — the
 * provider mirrors only the ACTIVE window into the address bar. The shared
 * `/app` tree (`WORKSPACE_ROUTES`) is converted once at module scope; twelve
 * windows never re-parse the JSX route tree.
 *
 * Window sections are `memo`ized on the window record's identity (the
 * reducer preserves untouched windows), so dock-level state changes never
 * re-render page subtrees.
 */

import {
  memo,
  useEffect,
  useMemo,
  type ContextType,
  type ReactElement,
} from 'react';
import {
  MemoryRouter,
  UNSAFE_DataRouterContext,
  UNSAFE_LocationContext,
  UNSAFE_RouteContext,
  useLocation,
  useRoutes,
} from 'react-router-dom';
import {
  WorkspaceWindowContext,
  useWorkspace,
  useWorkspaceActions,
  type WindowRuntime,
} from './workspace-context';
import { resolveWindowMeta } from './workspace-meta';
import { WorkspaceErrorBoundary } from './workspace-error-boundary';
import { WORKSPACE_ROUTES } from '../routes/workspace-route-tree';
import type { WindowId, WorkspaceWindow } from './workspace-reducer';

/** The shared tree under this window's memory history. */
function WindowRoutes(): ReactElement | null {
  return useRoutes(WORKSPACE_ROUTES);
}

/**
 * Detaches a subtree from the shell's router context so each window can own a
 * `MemoryRouter` (D-12) without tripping react-router's nested-`<Router>`
 * invariant. DOCUMENTED DEVIATION: v7's `useInRouterContext()` reads
 * `UNSAFE_LocationContext`, `useRoutes()` derives its base from the parent
 * `UNSAFE_RouteContext` matches and prefers `UNSAFE_DataRouterContext` state;
 * all three must be reset around the inner router or the window subtree
 * inherits the shell's routing state. The `UNSAFE_` exports are stable,
 * framework-shipped surface. Everything below the island sees ONLY the
 * window's router — in-window `<Link>`/`useNavigate` never touch the browser
 * URL (§6.5); the provider mirrors the active window instead.
 */
const DETACHED_LOCATION = null as unknown as ContextType<
  typeof UNSAFE_LocationContext
>;
const DETACHED_ROUTE_CONTEXT = {
  outlet: null,
  matches: [],
  isDataRoute: false,
} as unknown as ContextType<typeof UNSAFE_RouteContext>;

function WindowRouterIsland({
  initialEntries,
  children,
}: {
  initialEntries: string[];
  children: ReactElement;
}): ReactElement {
  return (
    <UNSAFE_DataRouterContext.Provider value={null}>
      <UNSAFE_RouteContext.Provider value={DETACHED_ROUTE_CONTEXT}>
        <UNSAFE_LocationContext.Provider value={DETACHED_LOCATION}>
          <MemoryRouter initialEntries={initialEntries}>
            {children}
          </MemoryRouter>
        </UNSAFE_LocationContext.Provider>
      </UNSAFE_RouteContext.Provider>
    </UNSAFE_DataRouterContext.Provider>
  );
}

/** Announces mount so the descriptor becomes keep-alive-eligible. */
function WindowMountReporter({
  windowId,
}: {
  windowId: WindowId;
}): ReactElement | null {
  const actions = useWorkspaceActions();
  useEffect(() => {
    actions?.markMounted(windowId);
  }, [actions, windowId]);
  return null;
}

/**
 * Mirrors this window's inner location into workspace state. The provider
 * (not this reporter) owns the browser-URL sync — a single writer for the
 * address bar, see the deviation note in `workspace-context.tsx`.
 */
function WindowLocationReporter({
  windowId,
}: {
  windowId: WindowId;
}): ReactElement | null {
  const actions = useWorkspaceActions();
  const location = useLocation();
  const fullPath = `${location.pathname}${location.search}${location.hash}`;
  useEffect(() => {
    actions?.setPath(windowId, fullPath);
  }, [actions, windowId, fullPath]);
  return null;
}

interface WindowSectionProps {
  window: WorkspaceWindow;
  isActive: boolean;
}

/** The three pieces every window router renders: reporters + shared tree. */
function WindowRouterContents({
  windowId,
}: {
  windowId: WindowId;
}): ReactElement {
  return (
    <>
      <WindowMountReporter windowId={windowId} />
      <WindowLocationReporter windowId={windowId} />
      <WindowRoutes />
    </>
  );
}

const WindowSection = memo(function WindowSection({
  window: workspaceWindow,
  isActive,
}: WindowSectionProps): ReactElement {
  const actions = useWorkspaceActions();
  const runtime = useMemo<WindowRuntime>(
    () => ({
      id: workspaceWindow.id,
      basePath: workspaceWindow.basePath,
      path: workspaceWindow.path,
      dirty: workspaceWindow.dirty,
    }),
    [
      workspaceWindow.id,
      workspaceWindow.basePath,
      workspaceWindow.path,
      workspaceWindow.dirty,
    ],
  );
  const { title } = resolveWindowMeta(workspaceWindow.path);
  const labelled = workspaceWindow.titleOverride ?? title;

  return (
    <section
      id={`workspace-panel-${workspaceWindow.id}`}
      role="tabpanel"
      aria-label={labelled}
      hidden={!isActive}
      inert={!isActive}
      aria-hidden={!isActive}
      data-testid="workspace-window"
      data-window-path={workspaceWindow.basePath}
      data-active={isActive}
      className={isActive ? 'min-w-0 animate-fade-in' : 'min-w-0'}
    >
      <WorkspaceWindowContext.Provider value={runtime}>
        <WorkspaceErrorBoundary
          windowId={workspaceWindow.id}
          onRequestClose={(id) => actions?.requestClose(id)}
        >
          <WindowRouterIsland
            initialEntries={[workspaceWindow.mountPath ?? workspaceWindow.path]}
          >
            <WindowRouterContents windowId={workspaceWindow.id} />
          </WindowRouterIsland>
        </WorkspaceErrorBoundary>
      </WorkspaceWindowContext.Provider>
    </section>
  );
});

/**
 * Placeholder for a restored-but-never-rendered window: keeps the panel id
 * (and thus every dock tab's `aria-controls`) resolvable while the window
 * stays out of the accessibility tree and out of the render tree.
 */
function WindowPlaceholder({
  window: workspaceWindow,
}: {
  window: WorkspaceWindow;
}): ReactElement {
  const { title } = resolveWindowMeta(workspaceWindow.path);
  return (
    <div
      id={`workspace-panel-${workspaceWindow.id}`}
      role="tabpanel"
      aria-label={workspaceWindow.titleOverride ?? title}
      hidden
      inert
      aria-hidden="true"
      data-window-slot=""
      data-testid="workspace-window-slot"
      data-window-path={workspaceWindow.basePath}
    />
  );
}

/**
 * Test-injection variant of `WindowSection`: renders caller-provided content
 * instead of the real route tree (keeps host tests free of feature mocks).
 * A component (not inline JSX) so the context value can be memoized.
 */
const InjectedWindowSection = memo(function InjectedWindowSection({
  window: workspaceWindow,
  isActive,
  renderWindow,
}: {
  window: WorkspaceWindow;
  isActive: boolean;
  renderWindow: (workspaceWindow: WorkspaceWindow) => ReactElement;
}): ReactElement {
  const runtime = useMemo<WindowRuntime>(
    () => ({
      id: workspaceWindow.id,
      basePath: workspaceWindow.basePath,
      path: workspaceWindow.path,
      dirty: workspaceWindow.dirty,
    }),
    [
      workspaceWindow.id,
      workspaceWindow.basePath,
      workspaceWindow.path,
      workspaceWindow.dirty,
    ],
  );
  return (
    <section
      id={`workspace-panel-${workspaceWindow.id}`}
      role="tabpanel"
      aria-label={
        workspaceWindow.titleOverride ??
        resolveWindowMeta(workspaceWindow.path).title
      }
      hidden={!isActive}
      inert={!isActive}
      aria-hidden={!isActive}
      data-testid="workspace-window"
      data-window-path={workspaceWindow.basePath}
      data-active={isActive}
      className={isActive ? 'min-w-0 animate-fade-in' : 'min-w-0'}
    >
      <WorkspaceWindowContext.Provider value={runtime}>
        {renderWindow(workspaceWindow)}
      </WorkspaceWindowContext.Provider>
    </section>
  );
});

/**
 * Injectable route tree (tests render fake pages instead of the real tree);
 * production always uses the shared `WORKSPACE_ROUTES` via `WindowRoutes`.
 */
export interface WorkspaceWindowHostProps {
  /** Renders one window's content; defaults to the shared route tree. */
  renderWindow?: (workspaceWindow: WorkspaceWindow) => ReactElement;
}

export function WorkspaceWindowHost({
  renderWindow,
}: WorkspaceWindowHostProps = {}): ReactElement | null {
  const workspace = useWorkspace();
  if (workspace === null) return null;

  return (
    <div data-testid="workspace-host" className="min-w-0">
      {workspace.state.windows.map((workspaceWindow) => {
        const isActive = workspaceWindow.id === workspace.state.activeId;
        if (!workspaceWindow.mounted && !isActive) {
          return (
            <WindowPlaceholder
              key={workspaceWindow.id}
              window={workspaceWindow}
            />
          );
        }
        if (renderWindow !== undefined) {
          return (
            <InjectedWindowSection
              key={workspaceWindow.id}
              window={workspaceWindow}
              isActive={isActive}
              renderWindow={renderWindow}
            />
          );
        }
        return (
          <WindowSection
            key={workspaceWindow.id}
            window={workspaceWindow}
            isActive={isActive}
          />
        );
      })}
    </div>
  );
}
