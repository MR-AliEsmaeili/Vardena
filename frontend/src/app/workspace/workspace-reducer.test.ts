/**
 * workspace-reducer — the §4.5 contract, one test per algorithm row
 * (spec §10.1: «برای هر سطر الگوریتم یک تست»). Pure function tests: no DOM,
 * no router, no providers.
 */

import { describe, expect, it } from 'vitest';
import {
  computeOpen,
  createInitialWorkspaceState,
  createWorkspaceWindow,
  freshWorkspaceState,
  isDraftPath,
  MAX_WINDOWS,
  splitTargetPath,
  workspaceReducer,
  WORKSPACE_HOME_PATH,
  type WorkspaceState,
  type WorkspaceWindow,
} from './workspace-reducer';
import type { StoredWorkspace } from './workspace-persistence';

function open(
  state: WorkspaceState,
  target: string,
  intent: 'auto' | 'new' = 'auto',
  id = `id-${Math.random().toString(36).slice(2, 10)}`,
) {
  return computeOpen(state, target, intent, id);
}

function withWindow(
  state: WorkspaceState,
  id: string,
  patch: Partial<WorkspaceWindow>,
): WorkspaceState {
  return {
    ...state,
    windows: state.windows.map((w) => (w.id === id ? { ...w, ...patch } : w)),
  };
}

describe('splitTargetPath / isDraftPath', () => {
  it('splits query and hash off the basePath but keeps them in path', () => {
    expect(splitTargetPath('/app/x/new?a=1#h')).toEqual({
      basePath: '/app/x/new',
      path: '/app/x/new?a=1#h',
    });
    expect(splitTargetPath('/app/x')).toEqual({
      basePath: '/app/x',
      path: '/app/x',
    });
  });

  it('flags only trailing /new as draft', () => {
    expect(isDraftPath('/app/inventory/movements/new')).toBe(true);
    expect(isDraftPath('/app/inventory/movements')).toBe(false);
    expect(isDraftPath('/app/newness')).toBe(false);
  });
});

describe('computeOpen — §4.5 steps 1–6', () => {
  it('creates and activates a window for a fresh target (step 6)', () => {
    const state = freshWorkspaceState('home', '/app');
    const { state: next, result } = open(
      state,
      '/app/accounting/documents',
      'auto',
      'w2',
    );
    expect(result).toEqual({ kind: 'created', id: 'w2' });
    expect(next.windows).toHaveLength(2);
    expect(next.activeId).toBe('w2');
    const created = next.windows[1];
    expect(created?.basePath).toBe('/app/accounting/documents');
    expect(created?.path).toBe('/app/accounting/documents');
    expect(created?.dirty).toBe(false);
    expect(created?.mounted).toBe(false);
  });

  it('reuses by basePath without touching the window path (step 4 — filters survive)', () => {
    let state = freshWorkspaceState('home', '/app');
    state = open(state, '/app/accounting/documents', 'auto', 'w2').state;
    // The window navigated internally and collected a query.
    state = workspaceReducer(state, {
      type: 'setPath',
      id: 'w2',
      path: '/app/accounting/documents?status=final',
    });
    const { state: next, result } = open(
      state,
      '/app/accounting/documents',
      'auto',
      'w3',
    );
    expect(result).toEqual({ kind: 'reused', id: 'w2' });
    expect(next.windows).toHaveLength(2);
    expect(next.activeId).toBe('w2');
    // Step 4: «path آن پنجره عوض نمی‌شود»
    expect(next.windows[1]?.path).toBe(
      '/app/accounting/documents?status=final',
    );
  });

  it('reuses across differing queries (basePath identity, step 1+4)', () => {
    let state = freshWorkspaceState('home', '/app');
    state = open(state, '/app/x?filter=a', 'auto', 'w2').state;
    const { result } = open(state, '/app/x?filter=b', 'auto', 'w3');
    expect(result).toEqual({ kind: 'reused', id: 'w2' });
  });

  it('never reuses a /new destination — a second draft gets its own window (step 3, W-03)', () => {
    let state = freshWorkspaceState('home', '/app');
    state = open(state, '/app/inventory/movements/new', 'auto', 'd1').state;
    const { state: next, result } = open(
      state,
      '/app/inventory/movements/new',
      'auto',
      'd2',
    );
    expect(result).toEqual({ kind: 'created', id: 'd2' });
    expect(next.windows).toHaveLength(3);
    expect(
      next.windows.filter((w) => w.basePath.endsWith('/new')),
    ).toHaveLength(2);
  });

  it('intent=new always creates even on an existing basePath (step 2, D-9 duplicate)', () => {
    let state = freshWorkspaceState('home', '/app');
    state = open(state, '/app/accounting/documents', 'auto', 'w2').state;
    const { state: next, result } = open(
      state,
      '/app/accounting/documents',
      'new',
      'w3',
    );
    expect(result).toEqual({ kind: 'created', id: 'w3' });
    expect(next.windows).toHaveLength(3);
    expect(next.activeId).toBe('w3');
  });

  it('caps at 12: no window closes automatically, state is untouched (step 5, D-2)', () => {
    let state = freshWorkspaceState('home', '/app');
    for (let index = 1; index < MAX_WINDOWS; index += 1) {
      state = open(state, `/app/p${index}`, 'auto', `w${index}`).state;
    }
    expect(state.windows).toHaveLength(MAX_WINDOWS);
    const before = state;
    const { state: next, result } = open(
      state,
      '/app/overflow',
      'auto',
      'over',
    );
    expect(result).toEqual({ kind: 'capped', id: null });
    expect(next).toBe(before); // referentially unchanged — nothing closed
  });

  it('reuse still works at the cap (activate is not a create)', () => {
    let state = freshWorkspaceState('home', '/app');
    for (let index = 1; index < MAX_WINDOWS; index += 1) {
      state = open(state, `/app/p${index}`, 'auto', `w${index}`).state;
    }
    const { result } = open(state, '/app/p3', 'auto', 'nope');
    expect(result).toEqual({ kind: 'reused', id: 'w3' });
  });

  it('reuse cancels a pending close dialog on that window', () => {
    let state = freshWorkspaceState('home', '/app');
    state = open(state, '/app/x', 'auto', 'w2').state;
    state = withWindow(state, 'w2', { dirty: true });
    state = workspaceReducer(state, {
      type: 'requestClose',
      id: 'w2',
      fallbackId: 'fb',
    });
    expect(state.pendingCloseId).toBe('w2');
    const next = open(state, '/app/x', 'auto', 'w3').state;
    expect(next.pendingCloseId).toBeNull();
  });
});

describe('activate', () => {
  it('changes only activeId — window order never changes (§4.5)', () => {
    let state = freshWorkspaceState('a', '/app');
    state = open(state, '/app/x', 'auto', 'b').state;
    state = open(state, '/app/y', 'auto', 'c').state;
    const next = workspaceReducer(state, { type: 'activate', id: 'a' });
    expect(next.activeId).toBe('a');
    expect(next.windows.map((w) => w.id)).toEqual(['a', 'b', 'c']);
  });

  it('cancels a pending close on another window (§4.5 — only one dialog)', () => {
    let state = freshWorkspaceState('a', '/app');
    state = open(state, '/app/x', 'auto', 'b').state;
    state = withWindow(state, 'a', { dirty: true });
    state = workspaceReducer(state, {
      type: 'requestClose',
      id: 'a',
      fallbackId: 'fb',
    });
    const next = workspaceReducer(state, { type: 'activate', id: 'b' });
    expect(next.activeId).toBe('b');
    expect(next.pendingCloseId).toBeNull();
  });

  it('ignores unknown ids', () => {
    const state = freshWorkspaceState('a', '/app');
    expect(workspaceReducer(state, { type: 'activate', id: 'ghost' })).toBe(
      state,
    );
  });
});

describe('requestClose / close — dirty rules (§4.5, §4.7)', () => {
  function dirtyTwo() {
    let state = freshWorkspaceState('a', '/app');
    state = open(state, '/app/x', 'auto', 'b').state;
    return withWindow(state, 'b', { dirty: true });
  }

  it('requestClose on a dirty window only sets pendingCloseId — the window stays', () => {
    const state = dirtyTwo();
    const next = workspaceReducer(state, {
      type: 'requestClose',
      id: 'b',
      fallbackId: 'fb',
    });
    expect(next.pendingCloseId).toBe('b');
    expect(next.windows.map((w) => w.id)).toEqual(['a', 'b']);
  });

  it('requestClose on a clean window closes it immediately', () => {
    const state = dirtyTwo();
    const next = workspaceReducer(state, {
      type: 'requestClose',
      id: 'a',
      fallbackId: 'fb',
    });
    expect(next.pendingCloseId).toBeNull();
    expect(next.windows.map((w) => w.id)).toEqual(['b']);
  });

  it('cancelPendingClose clears the dialog without touching windows', () => {
    let state = dirtyTwo();
    state = workspaceReducer(state, {
      type: 'requestClose',
      id: 'b',
      fallbackId: 'fb',
    });
    const next = workspaceReducer(state, { type: 'cancelPendingClose' });
    expect(next.pendingCloseId).toBeNull();
    expect(next.windows).toHaveLength(2);
    expect(next.windows[1]?.dirty).toBe(true);
  });

  it('close activates the next neighbour; the last row activates the previous', () => {
    let state = freshWorkspaceState('a', '/app');
    state = open(state, '/app/x', 'auto', 'b').state;
    state = open(state, '/app/y', 'auto', 'c').state;
    // Closing the active middle window activates the NEXT one.
    let next = workspaceReducer(state, {
      type: 'close',
      id: 'b',
      fallbackId: 'fb',
    });
    expect(next.activeId).toBe('c');
    // Closing the active LAST window activates the previous one.
    next = workspaceReducer(next, {
      type: 'close',
      id: 'c',
      fallbackId: 'fb2',
    });
    expect(next.activeId).toBe('a');
  });

  it('closing the only window creates a fresh workspace window (never an empty shell)', () => {
    const state = freshWorkspaceState('a', '/app/x');
    const next = workspaceReducer(state, {
      type: 'close',
      id: 'a',
      fallbackId: 'fresh-1',
    });
    expect(next.windows).toHaveLength(1);
    expect(next.windows[0]?.id).toBe('fresh-1');
    expect(next.windows[0]?.path).toBe(WORKSPACE_HOME_PATH);
    expect(next.activeId).toBe('fresh-1');
  });

  it('close removes a pendingCloseId that pointed at the closed window', () => {
    let state = dirtyTwo();
    state = workspaceReducer(state, {
      type: 'requestClose',
      id: 'b',
      fallbackId: 'fb',
    });
    const next = workspaceReducer(state, {
      type: 'close',
      id: 'b',
      fallbackId: 'fb',
    });
    expect(next.pendingCloseId).toBeNull();
    expect(next.windows.map((w) => w.id)).toEqual(['a']);
  });
});

describe('closeAllClean (§4.5)', () => {
  it('closes every clean window, keeps every dirty one, activates a survivor', () => {
    let state = freshWorkspaceState('a', '/app');
    state = open(state, '/app/x', 'auto', 'b').state;
    state = open(state, '/app/y', 'auto', 'c').state;
    state = withWindow(state, 'b', { dirty: true });
    const next = workspaceReducer(state, {
      type: 'closeAllClean',
      fallbackId: 'fb',
    });
    expect(next.windows.map((w) => w.id)).toEqual(['b']);
    expect(next.activeId).toBe('b');
  });

  it('opens a fresh workspace window when nothing clean survives an all-dirty list? NO — dirty windows always survive', () => {
    let state = freshWorkspaceState('a', '/app');
    state = withWindow(state, 'a', { dirty: true });
    const next = workspaceReducer(state, {
      type: 'closeAllClean',
      fallbackId: 'fb',
    });
    expect(next.windows.map((w) => w.id)).toEqual(['a']);
  });

  it('opens the workspace when every window was clean', () => {
    let state = freshWorkspaceState('a', '/app/x');
    state = open(state, '/app/y', 'auto', 'b').state;
    const next = workspaceReducer(state, {
      type: 'closeAllClean',
      fallbackId: 'fresh-9',
    });
    expect(next.windows).toHaveLength(1);
    expect(next.windows[0]?.id).toBe('fresh-9');
    expect(next.windows[0]?.path).toBe(WORKSPACE_HOME_PATH);
  });
});

describe('setPath / setDirty / setTitle / markMounted', () => {
  it('setPath updates path AND basePath, and drops a stale title override', () => {
    let state = freshWorkspaceState('a', '/app/x');
    state = workspaceReducer(state, {
      type: 'setTitle',
      id: 'a',
      title: 'سفارشی',
    });
    expect(state.windows[0]?.titleOverride).toBe('سفارشی');
    const next = workspaceReducer(state, {
      type: 'setPath',
      id: 'a',
      path: '/app/y?z=1',
    });
    expect(next.windows[0]?.path).toBe('/app/y?z=1');
    expect(next.windows[0]?.basePath).toBe('/app/y');
    expect(next.windows[0]?.titleOverride).toBeNull();
  });

  it('setPath keeps the title override when only the query changes', () => {
    let state = freshWorkspaceState('a', '/app/x');
    state = workspaceReducer(state, {
      type: 'setTitle',
      id: 'a',
      title: 'سفارشی',
    });
    const next = workspaceReducer(state, {
      type: 'setPath',
      id: 'a',
      path: '/app/x?tab=2',
    });
    expect(next.windows[0]?.titleOverride).toBe('سفارشی');
  });

  it('setPath with an identical path is a no-op (same state reference)', () => {
    const state = freshWorkspaceState('a', '/app/x');
    expect(
      workspaceReducer(state, { type: 'setPath', id: 'a', path: '/app/x' }),
    ).toBe(state);
  });

  it('setDirty flips the flag and clears nothing else', () => {
    const state = freshWorkspaceState('a', '/app/x');
    const next = workspaceReducer(state, {
      type: 'setDirty',
      id: 'a',
      dirty: true,
    });
    expect(next.windows[0]?.dirty).toBe(true);
    expect(next.windows[0]?.path).toBe('/app/x');
  });

  it('markMounted freezes the mount path once and is idempotent', () => {
    let state = freshWorkspaceState('a', '/app/x');
    state = workspaceReducer(state, { type: 'markMounted', id: 'a' });
    expect(state.windows[0]?.mounted).toBe(true);
    expect(state.windows[0]?.mountPath).toBe('/app/x');
    state = workspaceReducer(state, {
      type: 'setPath',
      id: 'a',
      path: '/app/x/2',
    });
    const again = workspaceReducer(state, { type: 'markMounted', id: 'a' });
    expect(again).toBe(state);
    expect(again.windows[0]?.mountPath).toBe('/app/x');
  });
});

describe('restore action', () => {
  const snapshot: StoredWorkspace = {
    version: 1,
    windows: [
      { id: 'aaa-1', basePath: '/app', path: '/app' },
      { id: 'bbb-2', basePath: '/app/x', path: '/app/x?q=1' },
    ],
    activeId: 'bbb-2',
  };

  it('restores descriptors: unmounted, clean, active from the snapshot', () => {
    const next = workspaceReducer(freshWorkspaceState('seed'), {
      type: 'restore',
      snapshot,
    });
    expect(next.windows.map((w) => w.id)).toEqual(['aaa-1', 'bbb-2']);
    expect(next.activeId).toBe('bbb-2');
    expect(next.windows.every((w) => !w.mounted && !w.dirty)).toBe(true);
    expect(next.windows[1]?.path).toBe('/app/x?q=1');
  });

  it('slices a too-long snapshot to the cap', () => {
    const many: StoredWorkspace = {
      version: 1,
      windows: Array.from({ length: 15 }, (_, index) => ({
        id: `win-${index}`,
        basePath: `/app/p${index}`,
        path: `/app/p${index}`,
      })),
      activeId: 'win-0',
    };
    const next = workspaceReducer(freshWorkspaceState('seed'), {
      type: 'restore',
      snapshot: many,
    });
    expect(next.windows).toHaveLength(MAX_WINDOWS);
  });

  it('falls back to the first survivor when activeId is not among the windows', () => {
    const bad: StoredWorkspace = {
      version: 1,
      windows: [{ id: 'aaa-1', basePath: '/app', path: '/app' }],
      activeId: 'ghost',
    };
    const next = workspaceReducer(freshWorkspaceState('seed'), {
      type: 'restore',
      snapshot: bad,
    });
    expect(next.activeId).toBe('aaa-1');
  });
});

describe('reset (W-06)', () => {
  it('replaces everything with one fresh workspace window', () => {
    let state = freshWorkspaceState('a', '/app/x');
    state = open(state, '/app/y', 'auto', 'b').state;
    state = withWindow(state, 'b', { dirty: true });
    const next = workspaceReducer(state, {
      type: 'reset',
      fallbackId: 'fresh-0',
    });
    expect(next.windows).toHaveLength(1);
    expect(next.windows[0]?.id).toBe('fresh-0');
    expect(next.windows[0]?.path).toBe(WORKSPACE_HOME_PATH);
    expect(next.windows[0]?.dirty).toBe(false);
    expect(next.pendingCloseId).toBeNull();
  });
});

describe('createInitialWorkspaceState — refresh/deep-link reconciliation', () => {
  const known = (path: string) => path.startsWith('/app');
  const restorable = (path: string) =>
    path.startsWith('/app') && path !== '/app/garbage';
  const snapshot: StoredWorkspace = {
    version: 1,
    windows: [
      { id: 'w-home', basePath: '/app', path: '/app' },
      {
        id: 'w-docs',
        basePath: '/app/accounting/documents',
        path: '/app/accounting/documents?page=2',
      },
    ],
    activeId: 'w-home',
  };

  it('with no snapshot: one fresh window at the browser path', () => {
    const state = createInitialWorkspaceState({
      snapshot: null,
      browserPath: '/app/accounting/documents?x=1',
      freshId: 'f1',
      deepLinkId: 'd1',
      isKnownRoute: known,
      isRestorableRoute: restorable,
    });
    expect(state.windows).toHaveLength(1);
    expect(state.windows[0]?.path).toBe('/app/accounting/documents?x=1');
    expect(state.activeId).toBe('f1');
  });

  it('with no snapshot and a non-/app browser path: fresh workspace window', () => {
    const state = createInitialWorkspaceState({
      snapshot: null,
      browserPath: '/login',
      freshId: 'f1',
      deepLinkId: 'd1',
      isKnownRoute: known,
      isRestorableRoute: restorable,
    });
    expect(state.windows[0]?.path).toBe(WORKSPACE_HOME_PATH);
  });

  it('refresh: descriptors restored, active slot kept, nothing mounted', () => {
    const state = createInitialWorkspaceState({
      snapshot,
      browserPath: '/app',
      freshId: 'f1',
      deepLinkId: 'd1',
      isKnownRoute: known,
      isRestorableRoute: restorable,
    });
    expect(state.windows.map((w) => w.id)).toEqual(['w-home', 'w-docs']);
    expect(state.activeId).toBe('w-home');
    expect(state.windows.every((w) => !w.mounted)).toBe(true);
  });

  it('refresh keeps the active window full path (query survives the mirror)', () => {
    const state = createInitialWorkspaceState({
      snapshot: { ...snapshot, activeId: 'w-docs' },
      browserPath: '/app/accounting/documents?page=2',
      freshId: 'f1',
      deepLinkId: 'd1',
      isKnownRoute: known,
      isRestorableRoute: restorable,
    });
    expect(state.activeId).toBe('w-docs');
    expect(state.windows[1]?.path).toBe('/app/accounting/documents?page=2');
  });

  it('deep link onto a non-active restored window activates THAT window and keeps the list', () => {
    const state = createInitialWorkspaceState({
      snapshot,
      browserPath: '/app/accounting/documents?page=9',
      freshId: 'f1',
      deepLinkId: 'd1',
      isKnownRoute: known,
      isRestorableRoute: restorable,
    });
    expect(state.windows).toHaveLength(2);
    expect(state.activeId).toBe('w-docs');
    expect(state.windows[1]?.path).toBe('/app/accounting/documents?page=9');
  });

  it('deep link outside the snapshot appends a new active window (under the cap)', () => {
    const state = createInitialWorkspaceState({
      snapshot,
      browserPath: '/app/inventory/movements/new',
      freshId: 'f1',
      deepLinkId: 'deep-1',
      isKnownRoute: known,
      isRestorableRoute: restorable,
    });
    expect(state.windows).toHaveLength(3);
    expect(state.activeId).toBe('deep-1');
    expect(state.windows[2]?.path).toBe('/app/inventory/movements/new');
  });

  it('restored windows failing the STRICT route check are dropped (FDR-01 §3.1)', () => {
    const state = createInitialWorkspaceState({
      snapshot: {
        version: 1,
        windows: [
          { id: 'w-home', basePath: '/app', path: '/app' },
          { id: 'w-gone', basePath: '/app/garbage', path: '/app/garbage' },
        ],
        activeId: 'w-gone',
      },
      browserPath: '/app',
      freshId: 'f1',
      deepLinkId: 'd1',
      isKnownRoute: known,
      isRestorableRoute: restorable,
    });
    expect(state.windows.map((w) => w.id)).toEqual(['w-home']);
    // activeId fell back to the first survivor.
    expect(state.activeId).toBe('w-home');
  });

  it('when every restored window is dropped, the browser path wins as a fresh window', () => {
    const state = createInitialWorkspaceState({
      snapshot: {
        version: 1,
        windows: [
          { id: 'w-gone', basePath: '/app/garbage', path: '/app/garbage' },
        ],
        activeId: 'w-gone',
      },
      browserPath: '/app',
      freshId: 'f1',
      deepLinkId: 'd1',
      isKnownRoute: known,
      isRestorableRoute: restorable,
    });
    expect(state.windows).toHaveLength(1);
    expect(state.windows[0]?.id).toBe('f1');
    expect(state.windows[0]?.path).toBe('/app');
  });
});

describe('window factory invariants', () => {
  it('createWorkspaceWindow starts unmounted, clean, without overrides', () => {
    const w = createWorkspaceWindow('id-1', '/app/x?a=1#h');
    expect(w).toEqual({
      id: 'id-1',
      basePath: '/app/x',
      path: '/app/x?a=1#h',
      dirty: false,
      mounted: false,
      mountPath: null,
      titleOverride: null,
    });
  });
});
