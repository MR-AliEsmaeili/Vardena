/**
 * WorkspaceWindowHost (§6.4·§6.5) + WorkspaceErrorBoundary (§6.7).
 *
 * The host renders every open window: the active one visible, the rest
 * mounted-but-hidden (`hidden` + `inert` + `aria-hidden`, D-11/W-10) so their
 * state survives switches (keep-alive, W-01). Restored descriptors that were
 * never rendered stay inert placeholders (W-16) until activated. The real
 * route tree is exercised through a deep-linked 404 — the lightest leaf.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/lib/i18n';
import {
  useWorkspace,
  useWorkspaceActions,
  useWorkspaceWindow,
  WorkspaceProvider,
  type WorkspaceApi,
  type WindowRuntime,
} from './workspace-context';
import { WorkspaceErrorBoundary } from './workspace-error-boundary';
import { WorkspaceWindowHost } from './workspace-host';
import { resolveWindowMeta } from './workspace-meta';
import { WORKSPACE_STORAGE_KEY } from './workspace-persistence';
import type { WindowId, WorkspaceWindow } from './workspace-reducer';

const knownRoute = (path: string) => path.startsWith('/app');

let captured: WorkspaceApi | null = null;
const runtimes = new Map<string, WindowRuntime>();

function Capture() {
  const api = useWorkspace();
  // Effect-phase capture keeps the render pure (react/globals).
  useEffect(() => {
    captured = api;
  });
  return null;
}

/** Stands in for the real route tree; reports mount like WindowMountReporter. */
function FakePage({ workspaceWindow }: { workspaceWindow: WorkspaceWindow }) {
  const actions = useWorkspaceActions();
  const runtime = useWorkspaceWindow();
  const [count, setCount] = useState(0);
  useEffect(() => {
    actions?.markMounted(workspaceWindow.id);
  }, [actions, workspaceWindow.id]);
  if (runtime !== null) runtimes.set(workspaceWindow.id, runtime);
  return (
    <div data-testid={`fake-page-${workspaceWindow.id}`}>
      <span data-testid={`fake-path-${workspaceWindow.id}`}>
        {runtime?.path ?? 'none'}
      </span>
      <span data-testid={`fake-mount-${workspaceWindow.id}`}>
        {workspaceWindow.mountPath ?? 'unset'}
      </span>
      <button
        type="button"
        data-testid={`fake-inc-${workspaceWindow.id}`}
        onClick={() => setCount((value) => value + 1)}
      >
        inc
      </button>
      <span data-testid={`fake-count-${workspaceWindow.id}`}>{count}</span>
    </div>
  );
}

const renderWindow = (workspaceWindow: WorkspaceWindow) => (
  <FakePage workspaceWindow={workspaceWindow} />
);

function renderHost(options?: {
  injected?: boolean;
  initialEntries?: string[];
}) {
  captured = null;
  runtimes.clear();
  return render(
    <MemoryRouter initialEntries={options?.initialEntries ?? ['/app']}>
      <WorkspaceProvider ready isKnownRoute={knownRoute}>
        <Capture />
        {options?.injected === false ? (
          <WorkspaceWindowHost />
        ) : (
          <WorkspaceWindowHost renderWindow={renderWindow} />
        )}
      </WorkspaceProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  captured = null;
  runtimes.clear();
  sessionStorage.removeItem(WORKSPACE_STORAGE_KEY);
});

describe('window sections (D-11, W-10)', () => {
  it('renders the single window visible with tabpanel semantics', () => {
    renderHost();
    const sections = screen.getAllByTestId('workspace-window');
    expect(sections).toHaveLength(1);
    const section = sections[0]!;
    const id = captured!.state.activeId!;
    expect(section).toHaveAttribute('id', `workspace-panel-${id}`);
    expect(section).toHaveAttribute('role', 'tabpanel');
    expect(section).toHaveAttribute('data-active', 'true');
    expect(section).not.toHaveAttribute('hidden');
    expect(section).not.toHaveAttribute('inert');
    expect(section).toHaveAttribute(
      'aria-label',
      resolveWindowMeta('/app').title,
    );
  });

  it('keeps inactive windows mounted but hidden + inert + aria-hidden', () => {
    renderHost();
    let second = '';
    act(() => {
      second = captured!.open('/app/accounting/documents').id!;
    });
    const sections = screen.getAllByTestId('workspace-window');
    expect(sections).toHaveLength(2);
    const inactive = sections.find(
      (element) => element.getAttribute('data-window-path') === '/app',
    )!;
    const active = sections.find(
      (element) =>
        element.getAttribute('data-window-path') ===
        '/app/accounting/documents',
    )!;
    expect(inactive).toHaveAttribute('hidden');
    expect(inactive).toHaveAttribute('inert');
    expect(inactive).toHaveAttribute('aria-hidden', 'true');
    expect(inactive).toHaveAttribute('data-active', 'false');
    expect(active).not.toHaveAttribute('hidden');
    expect(active).not.toHaveAttribute('inert');
    // Both stay mounted: the hidden page is still in the DOM.
    expect(screen.getByTestId(`fake-page-${second}`)).toBeInTheDocument();
  });

  it('keep-alive: component state survives hide/show cycles (W-01)', () => {
    renderHost();
    const first = captured!.state.activeId!;
    let second = '';
    act(() => {
      second = captured!.open('/app/inventory/items').id!;
    });
    // Increment while active.
    fireEvent.click(screen.getByTestId(`fake-inc-${first}`));
    fireEvent.click(screen.getByTestId(`fake-inc-${first}`));
    expect(screen.getByTestId(`fake-count-${first}`)).toHaveTextContent('2');
    // Hidden windows still dispatch events in jsdom; real users cannot reach
    // them (inert). The point is that the state survives the switch.
    act(() => captured!.activate(second));
    act(() => captured!.activate(first));
    expect(screen.getByTestId(`fake-count-${first}`)).toHaveTextContent('2');
    fireEvent.click(screen.getByTestId(`fake-inc-${first}`));
    expect(screen.getByTestId(`fake-count-${first}`)).toHaveTextContent('3');
  });

  it('exposes the WindowRuntime and reacts to dirty/title changes', () => {
    renderHost();
    const id = captured!.state.activeId!;
    expect(runtimes.get(id)).toMatchObject({
      id,
      basePath: '/app',
      path: '/app',
      dirty: false,
    });
    act(() => captured!.setDirty(id, true));
    expect(runtimes.get(id)?.dirty).toBe(true);
    act(() => captured!.setTitle(id, 'عنوان سفارشی'));
    expect(document.getElementById(`workspace-panel-${id}`)).toHaveAttribute(
      'aria-label',
      'عنوان سفارشی',
    );
  });

  it('setPath updates the window record without remounting', () => {
    renderHost();
    const id = captured!.state.activeId!;
    fireEvent.click(screen.getByTestId(`fake-inc-${id}`));
    act(() => captured!.setPath(id, '/app/accounting/documents'));
    expect(runtimes.get(id)?.path).toBe('/app/accounting/documents');
    expect(screen.getByTestId(`fake-count-${id}`)).toHaveTextContent('1');
  });
});

describe('restored descriptors (W-16)', () => {
  function seedSnapshot() {
    sessionStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        windows: [
          { id: 'restored-aaaaaaaa', basePath: '/app', path: '/app' },
          {
            id: 'restored-bbbbbbbb',
            basePath: '/app/accounting/documents',
            path: '/app/accounting/documents?page=3',
          },
        ],
        activeId: 'restored-aaaaaaaa',
      }),
    );
  }

  it('renders never-activated windows as inert placeholders', () => {
    seedSnapshot();
    renderHost();
    // The ACTIVE restored window mounts immediately.
    expect(
      screen.getByTestId('fake-page-restored-aaaaaaaa'),
    ).toBeInTheDocument();
    // The inactive one is a placeholder — renderWindow never ran for it.
    const slot = screen.getByTestId('workspace-window-slot');
    expect(slot).toHaveAttribute('id', 'workspace-panel-restored-bbbbbbbb');
    expect(slot).toHaveAttribute('hidden');
    expect(slot).toHaveAttribute('inert');
    expect(slot).toHaveAttribute('aria-hidden', 'true');
    expect(
      screen.queryByTestId('fake-page-restored-bbbbbbbb'),
    ).not.toBeInTheDocument();
  });

  it('mounts on first activation and freezes the mount path', () => {
    seedSnapshot();
    renderHost();
    act(() => {
      captured!.activate('restored-bbbbbbbb' as WindowId);
    });
    expect(
      screen.getByTestId('fake-page-restored-bbbbbbbb'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('workspace-window-slot'),
    ).not.toBeInTheDocument();
    // Full restored path (query included) is what the window shows.
    expect(screen.getByTestId('fake-path-restored-bbbbbbbb')).toHaveTextContent(
      '/app/accounting/documents?page=3',
    );
    expect(
      screen.getByTestId('fake-mount-restored-bbbbbbbb'),
    ).toHaveTextContent('/app/accounting/documents?page=3');
    // Navigating inside the window never rewrites the frozen mount path.
    act(() => {
      captured!.setPath(
        'restored-bbbbbbbb' as WindowId,
        '/app/accounting/documents',
      );
    });
    const record = captured!.state.windows.find(
      (w) => w.id === 'restored-bbbbbbbb',
    )!;
    expect(record.path).toBe('/app/accounting/documents');
    expect(record.mountPath).toBe('/app/accounting/documents?page=3');
  });
});

describe('real route tree integration (no injection)', () => {
  it('a deep-linked garbage path renders the in-window 404 and keeps its path', () => {
    // The provider derives the initial window from the ROUTER location.
    renderHost({
      injected: false,
      initialEntries: ['/app/definitely-garbage'],
    });
    // The splat leaf resolves inside the window's own MemoryRouter.
    expect(screen.getByText(t.app.notFoundTitle)).toBeInTheDocument();
    const id = captured!.state.activeId!;
    expect(captured!.state.windows[0]?.path).toBe('/app/definitely-garbage');
    // NotFoundPage sets the window title override through the workspace hook.
    expect(captured!.state.windows[0]?.titleOverride).toBe(t.app.notFoundTitle);
    expect(document.getElementById(`workspace-panel-${id}`)).toHaveAttribute(
      'aria-label',
      t.app.notFoundTitle,
    );
  });
});

describe('WorkspaceErrorBoundary (§6.7, FDR-01 §3.3)', () => {
  let shouldThrow = true;

  function Bomb() {
    if (shouldThrow) throw new Error('boom');
    return <div data-testid="bomb-ok">ok</div>;
  }

  beforeEach(() => {
    shouldThrow = true;
    // React logs caught errors in development; keep the output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    shouldThrow = true;
  });

  it('contains a render crash in a local alert panel', () => {
    const onRequestClose = vi.fn();
    render(
      <WorkspaceErrorBoundary
        windowId={'w-boundary' as WindowId}
        onRequestClose={onRequestClose}
      >
        <Bomb />
      </WorkspaceErrorBoundary>,
    );
    const panel = screen.getByTestId('workspace-window-error');
    expect(panel).toHaveAttribute('role', 'alert');
    expect(screen.getByText(t.workspace.panelErrorTitle)).toBeInTheDocument();
  });

  it('retry remounts the subtree with a fresh attempt', () => {
    render(
      <WorkspaceErrorBoundary
        windowId={'w-boundary' as WindowId}
        onRequestClose={vi.fn()}
      >
        <Bomb />
      </WorkspaceErrorBoundary>,
    );
    shouldThrow = false;
    fireEvent.click(screen.getByTestId('workspace-window-error-retry'));
    expect(screen.getByTestId('bomb-ok')).toBeInTheDocument();
    expect(
      screen.queryByTestId('workspace-window-error'),
    ).not.toBeInTheDocument();
  });

  it('close routes through requestClose (dirty confirmation applies)', () => {
    const onRequestClose = vi.fn();
    render(
      <WorkspaceErrorBoundary
        windowId={'w-boundary' as WindowId}
        onRequestClose={onRequestClose}
      >
        <Bomb />
      </WorkspaceErrorBoundary>,
    );
    fireEvent.click(screen.getByTestId('workspace-window-error-close'));
    expect(onRequestClose).toHaveBeenCalledWith('w-boundary');
  });
});
