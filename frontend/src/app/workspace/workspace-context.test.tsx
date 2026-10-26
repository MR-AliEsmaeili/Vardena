/**
 * WorkspaceProvider behaviour (§6.5, §6.10): synchronous open results, the
 * dirty-close pipeline, the cap dialog, the debounced persistence writer,
 * the replace-only URL mirror, shortcut attachment, the scope-reset watcher,
 * and the null-safe hooks outside the provider (§8 — isolated page tests
 * must never break).
 */

import { act, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODULE_TONES_STORAGE_KEY } from '@/lib/module-tones-storage';
import {
  clearWorkspaceOnSessionEnd,
  useWorkspace,
  useWorkspaceActions,
  useWorkspaceWindow,
  useWorkspaceWindowDirty,
  useWorkspaceWindowTitle,
  WorkspaceProvider,
  type WorkspaceApi,
} from './workspace-context';
import { WorkspaceScopeReset } from './workspace-scope-reset';
import { WORKSPACE_STORAGE_KEY } from './workspace-persistence';
import { MAX_WINDOWS, WORKSPACE_HOME_PATH } from './workspace-reducer';

/* Hoisted so the vi.mock factory (which runs during import) can see it. */
const orgScope = vi.hoisted(() => ({
  organization: { id: 'org-1' } as { id: string } | null,
  financialArea: { id: 'area-1' } as { id: string } | null,
  fiscalYear: { id: 'year-1' } as { id: string } | null,
}));

vi.mock('@/features/organization/use-organization', () => ({
  useOrganization: () => ({ ...orgScope }),
}));

const knownRoute = (path: string) =>
  path.startsWith('/app') && !path.includes('garbage');

let captured: WorkspaceApi | null = null;

function Capture() {
  const api = useWorkspace();
  // Effect-phase capture keeps the render pure (react/globals); act() flushes
  // effects, so `captured` is always current by the time assertions run.
  useEffect(() => {
    captured = api;
  });
  return null;
}

/* Module-level setters keep the mocked scope mutable without any component
   touching it during render (react/immutability). */
function setOrg(next: { id: string } | null) {
  orgScope.organization = next;
}

function OuterLocation() {
  const location = useLocation();
  return (
    <div data-testid="outer-location">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderProvider(options?: {
  ready?: boolean;
  initialEntries?: string[];
  withScopeReset?: boolean;
}) {
  captured = null;
  return render(
    <MemoryRouter initialEntries={options?.initialEntries ?? ['/app']}>
      <WorkspaceProvider
        ready={options?.ready ?? true}
        isKnownRoute={knownRoute}
      >
        {options?.withScopeReset === true ? <WorkspaceScopeReset /> : null}
        <Capture />
        <OuterLocation />
      </WorkspaceProvider>
    </MemoryRouter>,
  );
}

async function settle() {
  // Let the idle-fallback (setTimeout 0) persistence write land.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

afterEach(() => {
  captured = null;
  orgScope.organization = { id: 'org-1' };
  orgScope.financialArea = { id: 'area-1' };
  orgScope.fiscalYear = { id: 'year-1' };
  window.history.pushState({}, '', '/');
});

describe('initial state', () => {
  it('starts with one clean workspace window at /app', () => {
    renderProvider();
    expect(captured).not.toBeNull();
    expect(captured!.state.windows).toHaveLength(1);
    expect(captured!.state.windows[0]?.path).toBe(WORKSPACE_HOME_PATH);
    expect(captured!.activeWindow?.id).toBe(captured!.state.activeId);
    expect(captured!.hasDirtyWindows).toBe(false);
    expect(captured!.capDialogOpen).toBe(false);
  });
});

describe('open() — synchronous OpenResult (§4.5)', () => {
  it('returns created/reused results without waiting for a re-render', () => {
    renderProvider();
    act(() => {
      const first = captured!.open('/app/accounting/documents');
      expect(first.kind).toBe('created');
      // The tracked mirror makes the SECOND call see the first immediately.
      const second = captured!.open('/app/accounting/documents');
      expect(second).toEqual({ kind: 'reused', id: first.id });
      const third = captured!.open('/app/accounting/documents', {
        intent: 'new',
      });
      expect(third.kind).toBe('created');
      expect(third.id).not.toBe(first.id);
    });
    expect(captured!.state.windows).toHaveLength(3);
  });

  it('caps at 12 and opens the cap dialog instead of closing anything', () => {
    renderProvider();
    act(() => {
      for (let index = 0; index < MAX_WINDOWS - 1; index += 1) {
        captured!.open(`/app/p${index}`);
      }
    });
    expect(captured!.state.windows).toHaveLength(MAX_WINDOWS);
    let result;
    act(() => {
      result = captured!.open('/app/overflow');
    });
    expect(result).toEqual({ kind: 'capped', id: null });
    expect(captured!.capDialogOpen).toBe(true);
    expect(captured!.state.windows).toHaveLength(MAX_WINDOWS);
    act(() => captured!.dismissCapDialog());
    expect(captured!.capDialogOpen).toBe(false);
  });
});

describe('dirty close pipeline (§4.7)', () => {
  it('requestClose holds a dirty window; close releases it', () => {
    renderProvider();
    let id = '';
    act(() => {
      id = captured!.open('/app/x').id!;
      captured!.setDirty(id, true);
    });
    expect(captured!.hasDirtyWindows).toBe(true);
    act(() => captured!.requestClose(id));
    expect(captured!.state.pendingCloseId).toBe(id);
    expect(captured!.state.windows).toHaveLength(2);
    // Cancel keeps everything.
    act(() => captured!.cancelPendingClose());
    expect(captured!.state.pendingCloseId).toBeNull();
    // Confirm closes.
    act(() => {
      captured!.requestClose(id);
      captured!.close(id);
    });
    expect(captured!.state.windows).toHaveLength(1);
    expect(captured!.state.windows.some((w) => w.id === id)).toBe(false);
  });

  it('form hooks are no-ops outside the provider (isolated page tests)', () => {
    function OrphanForm() {
      useWorkspaceWindowDirty(true);
      useWorkspaceWindowTitle('عنوان');
      const runtime = useWorkspaceWindow();
      const actions = useWorkspaceActions();
      const api = useWorkspace();
      return (
        <div data-testid="orphan">
          {runtime === null && actions === null && api === null
            ? 'null-safe'
            : 'leaked'}
        </div>
      );
    }
    render(<OrphanForm />);
    expect(screen.getByTestId('orphan')).toHaveTextContent('null-safe');
  });
});

describe('closeAllClean / reset', () => {
  it('closeAllClean keeps dirty windows and never empties the dock', () => {
    renderProvider();
    let dirtyId = '';
    act(() => {
      dirtyId = captured!.open('/app/dirty-one').id!;
      captured!.open('/app/clean-one');
      captured!.setDirty(dirtyId, true);
    });
    act(() => captured!.closeAllClean());
    expect(captured!.state.windows.map((w) => w.id)).toEqual([dirtyId]);
  });

  it('closeAllClean over an all-clean list leaves the fresh workspace window', () => {
    renderProvider();
    act(() => {
      captured!.open('/app/x');
      captured!.closeAllClean();
    });
    expect(captured!.state.windows).toHaveLength(1);
    expect(captured!.state.windows[0]?.path).toBe(WORKSPACE_HOME_PATH);
  });

  it('reset replaces everything with one clean workspace window (W-06)', () => {
    renderProvider();
    act(() => {
      const id = captured!.open('/app/x').id!;
      captured!.setDirty(id, true);
    });
    act(() => captured!.reset());
    expect(captured!.state.windows).toHaveLength(1);
    expect(captured!.state.windows[0]?.path).toBe(WORKSPACE_HOME_PATH);
    expect(captured!.hasDirtyWindows).toBe(false);
  });
});

describe('persistence (§6.10·الف)', () => {
  it('writes the debounced snapshot once the shell is ready', async () => {
    renderProvider();
    act(() => {
      captured!.open('/app/accounting/documents?page=2');
    });
    await settle();
    const raw = sessionStorage.getItem(WORKSPACE_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as {
      version: number;
      windows: { basePath: string; path: string }[];
      activeId: string;
    };
    expect(parsed.version).toBe(1);
    expect(parsed.windows.map((w) => w.path)).toContain(
      '/app/accounting/documents?page=2',
    );
    expect(parsed.activeId).toBe(captured!.state.activeId);
  });

  it('flushes the queued snapshot on pagehide — a quick refresh keeps the list (D-6)', () => {
    renderProvider();
    act(() => {
      captured!.open('/app/quick-refresh');
    });
    // Still queued in the idle callback — nothing stored yet.
    expect(sessionStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
    // Unloading flushes synchronously.
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    const raw = sessionStorage.getItem(WORKSPACE_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as {
      windows: { basePath: string }[];
    };
    expect(parsed.windows.map((w) => w.basePath)).toContain(
      '/app/quick-refresh',
    );
    // The hidden-visibility path flushes too.
    act(() => {
      captured!.open('/app/hidden-flush');
    });
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const rawHidden = sessionStorage.getItem(WORKSPACE_STORAGE_KEY);
    expect(rawHidden).toContain('/app/hidden-flush');
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
  });

  it('writes nothing while the shell is not ready', async () => {
    renderProvider({ ready: false });
    await settle();
    expect(sessionStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
  });

  it('restores the snapshot on the next provider mount', async () => {
    const first = renderProvider();
    act(() => {
      captured!.open('/app/accounting/documents');
      captured!.open('/app/inventory/items');
    });
    expect(captured!.state.windows).toHaveLength(3);
    await settle();
    first.unmount();

    // Second mount reads what the first persisted.
    renderProvider();
    expect(captured!.state.windows).toHaveLength(3);
    expect(captured!.state.windows.map((w) => w.basePath)).toEqual([
      '/app',
      '/app/accounting/documents',
      '/app/inventory/items',
    ]);
    // Restored descriptors are unmounted until activated (W-16).
    expect(captured!.state.windows.every((w) => !w.mounted)).toBe(true);
  });

  it('clearWorkspaceOnSessionEnd removes exactly the workspace key', async () => {
    renderProvider();
    act(() => {
      captured!.open('/app/x');
    });
    await settle();
    sessionStorage.setItem(MODULE_TONES_STORAGE_KEY, 'keep');
    expect(sessionStorage.getItem(WORKSPACE_STORAGE_KEY)).not.toBeNull();
    clearWorkspaceOnSessionEnd();
    expect(sessionStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(MODULE_TONES_STORAGE_KEY)).toBe('keep');
  });
});

describe('browser URL mirror (§6.5, W-07)', () => {
  it('follows the active window with replace navigation', () => {
    renderProvider();
    expect(screen.getByTestId('outer-location')).toHaveTextContent('/app');
    act(() => {
      captured!.open('/app/accounting/documents?x=1');
    });
    expect(screen.getByTestId('outer-location')).toHaveTextContent(
      '/app/accounting/documents?x=1',
    );
    const homeId = captured!.state.windows[0]!.id;
    act(() => captured!.activate(homeId));
    expect(screen.getByTestId('outer-location')).toHaveTextContent('/app');
  });

  it('does not move the URL while the shell is not ready', () => {
    renderProvider({ ready: false });
    expect(screen.getByTestId('outer-location')).toHaveTextContent('/app');
  });
});

describe('scope reset watcher (W-06, §6.8)', () => {
  it('an organization switch triggers reset()', () => {
    function Harness() {
      const [, bump] = useState(0);
      return (
        <MemoryRouter initialEntries={['/app']}>
          <WorkspaceProvider ready isKnownRoute={knownRoute}>
            <WorkspaceScopeReset />
            <Capture />
            <button
              type="button"
              data-testid="switch-org"
              onClick={() => {
                setOrg({ id: 'org-2' });
                bump((version) => version + 1);
              }}
            >
              switch
            </button>
          </WorkspaceProvider>
        </MemoryRouter>
      );
    }
    render(<Harness />);
    act(() => {
      captured!.open('/app/x');
    });
    expect(captured!.state.windows).toHaveLength(2);
    act(() => {
      screen.getByTestId('switch-org').click();
    });
    expect(captured!.state.windows).toHaveLength(1);
    expect(captured!.state.windows[0]?.path).toBe(WORKSPACE_HOME_PATH);
  });

  it('bootstrap transitions from an empty scope do not reset', () => {
    function Harness() {
      const [, bump] = useState(0);
      return (
        <MemoryRouter initialEntries={['/app']}>
          <WorkspaceProvider ready isKnownRoute={knownRoute}>
            <WorkspaceScopeReset />
            <Capture />
            <button
              type="button"
              data-testid="resolve-org"
              onClick={() => {
                setOrg({ id: 'org-9' });
                bump((version) => version + 1);
              }}
            >
              resolve
            </button>
          </WorkspaceProvider>
        </MemoryRouter>
      );
    }
    setOrg(null); // the scope starts unresolved in this scenario
    render(<Harness />);
    act(() => {
      captured!.open('/app/x');
    });
    // The organization resolves for the first time (null → org-9): bootstrap,
    // NOT a switch — the windows must survive.
    act(() => {
      screen.getByTestId('resolve-org').click();
    });
    expect(captured!.state.windows).toHaveLength(2);
  });
});

describe('limited shortcuts (§4.8)', () => {
  function press(key: string, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', {
      key,
      altKey: true,
      cancelable: true,
      bubbles: true,
      ...init,
    });
    act(() => {
      window.dispatchEvent(event);
    });
    return event;
  }

  it('Alt+W closes the active window; Alt+1..9 jumps; out-of-range is a no-op', () => {
    renderProvider();
    let second = '';
    let first = '';
    act(() => {
      second = captured!.open('/app/x').id!;
      first = captured!.state.windows[0]!.id;
    });
    expect(captured!.state.activeId).toBe(second);

    press('1');
    expect(captured!.state.activeId).toBe(first);

    // Clean window: closed immediately (no dialog).
    press('w');
    expect(captured!.state.windows.map((w) => w.id)).toEqual([second]);

    press('9');
    expect(captured!.state.windows).toHaveLength(1);
  });

  it('Alt+Arrow switches with RTL order and wraps', () => {
    renderProvider();
    act(() => {
      captured!.open('/app/a');
      captured!.open('/app/b');
    });
    const ids = captured!.state.windows.map((w) => w.id);
    expect(captured!.state.activeId).toBe(ids[2]);
    press('ArrowRight'); // previous in RTL
    expect(captured!.state.activeId).toBe(ids[1]);
    press('ArrowRight');
    expect(captured!.state.activeId).toBe(ids[0]);
    press('ArrowRight'); // wraps to the last
    expect(captured!.state.activeId).toBe(ids[2]);
    press('ArrowLeft');
    expect(captured!.state.activeId).toBe(ids[0]);
  });

  it('does nothing while focus sits in a text field', () => {
    renderProvider();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    act(() => {
      captured!.open('/app/x');
    });
    const before = captured!.state.windows.length;
    press('w');
    expect(captured!.state.windows).toHaveLength(before);
    input.remove();
  });

  it('shortcuts stay detached while the shell is not ready', () => {
    renderProvider({ ready: false });
    const event = new KeyboardEvent('keydown', {
      key: 'w',
      altKey: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('setTitle (§6.6)', () => {
  it('stores an override for the displayed title only', () => {
    renderProvider();
    const id = captured!.state.activeId!;
    act(() => captured!.setTitle(id, 'صفحهٔ پیدا نشد'));
    expect(captured!.state.windows[0]?.titleOverride).toBe('صفحهٔ پیدا نشد');
    // Navigating the window to another basePath clears the override.
    act(() => captured!.setPath(id, '/app/accounting/documents'));
    expect(captured!.state.windows[0]?.titleOverride).toBeNull();
  });
});

describe('unmount hygiene', () => {
  it('a cancelled pending write never throws after unmount', async () => {
    const view = renderProvider();
    act(() => {
      captured!.open('/app/late-write');
    });
    view.unmount();
    await settle();
    // The unmount cleanup cancelled the queued idle write; whatever (if
    // anything) is stored must still be valid JSON.
    const raw = sessionStorage.getItem(WORKSPACE_STORAGE_KEY);
    expect(() => (raw === null ? null : JSON.parse(raw))).not.toThrow();
  });
});
