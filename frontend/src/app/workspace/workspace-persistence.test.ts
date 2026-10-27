/**
 * workspace-persistence — every §6.10·الف validator row gets its own test
 * (spec §10.2), plus the debounced writer's coalescing/flush/cancel and
 * quota-swallowing behaviour.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  clearStoredWorkspace,
  parseStoredWorkspace,
  readStoredWorkspace,
  serializeWorkspace,
  WORKSPACE_STORAGE_KEY,
  WorkspacePersistenceWriter,
  type StoredWorkspace,
} from './workspace-persistence';
import { freshWorkspaceState, workspaceReducer } from './workspace-reducer';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    get size() {
      return map.size;
    },
  };
}

const VALID: StoredWorkspace = {
  version: 1,
  windows: [
    { id: 'win-home-1', basePath: '/app', path: '/app' },
    { id: 'win-docs-2', basePath: '/app/x', path: '/app/x?q=1' },
  ],
  activeId: 'win-docs-2',
};

describe('the storage key contract (standards §15 whitelist)', () => {
  it('is exactly the one versioned sessionStorage key', () => {
    expect(WORKSPACE_STORAGE_KEY).toBe('vardena:workspace:v1');
  });
});

describe('parseStoredWorkspace — fail-closed validator (§6.10·الف)', () => {
  it('accepts a fully valid record', () => {
    expect(parseStoredWorkspace(JSON.stringify(VALID))).toEqual(VALID);
  });

  it('rejects null / empty / corrupt JSON → null (fresh workspace)', () => {
    expect(parseStoredWorkspace(null)).toBeNull();
    expect(parseStoredWorkspace('')).toBeNull();
    expect(parseStoredWorkspace('{oops')).toBeNull();
    expect(parseStoredWorkspace('"just a string"')).toBeNull();
  });

  it('rejects an unknown version', () => {
    expect(
      parseStoredWorkspace(JSON.stringify({ ...VALID, version: 2 })),
    ).toBeNull();
    expect(
      parseStoredWorkspace(JSON.stringify({ ...VALID, version: '1' })),
    ).toBeNull();
  });

  it('rejects windows that are not an array, empty, or longer than 12', () => {
    expect(
      parseStoredWorkspace(JSON.stringify({ ...VALID, windows: {} })),
    ).toBeNull();
    expect(
      parseStoredWorkspace(JSON.stringify({ ...VALID, windows: [] })),
    ).toBeNull();
    const tooLong = {
      ...VALID,
      windows: Array.from({ length: 13 }, (_, index) => ({
        id: `win-${index}x`,
        basePath: '/app',
        path: '/app',
      })),
    };
    expect(parseStoredWorkspace(JSON.stringify(tooLong))).toBeNull();
  });

  it('drops a member whose id fails the ^[A-Za-z0-9-]{8,64}$ pattern', () => {
    const withBadId = {
      ...VALID,
      windows: [
        VALID.windows[0],
        { id: 'bad id!', basePath: '/app/y', path: '/app/y' },
      ],
    };
    const parsed = parseStoredWorkspace(JSON.stringify(withBadId));
    expect(parsed?.windows.map((w) => w.id)).toEqual(['win-home-1']);
  });

  it('drops a duplicate id (the later member)', () => {
    const dup = {
      ...VALID,
      windows: [
        VALID.windows[0],
        { id: 'win-home-1', basePath: '/app/z', path: '/app/z' },
      ],
    };
    const parsed = parseStoredWorkspace(JSON.stringify(dup));
    expect(parsed?.windows).toHaveLength(1);
    expect(parsed?.windows[0]?.basePath).toBe('/app');
  });

  it('drops members whose basePath/path are not strings or lack the /app prefix', () => {
    const bad = {
      ...VALID,
      windows: [
        VALID.windows[0],
        { id: 'win-out-1', basePath: '/login', path: '/login' },
        { id: 'win-num-1', basePath: 42, path: '/app/n' },
      ],
    };
    const parsed = parseStoredWorkspace(JSON.stringify(bad));
    expect(parsed?.windows.map((w) => w.id)).toEqual(['win-home-1']);
  });

  it('keeps the home window itself (prefix rule is startsWith "/app")', () => {
    const parsed = parseStoredWorkspace(
      JSON.stringify({
        version: 1,
        windows: [{ id: 'win-home-1', basePath: '/app', path: '/app' }],
        activeId: 'win-home-1',
      }),
    );
    expect(parsed?.windows).toHaveLength(1);
  });

  it('rejects a member whose path does not start with its own basePath shape but keeps valid siblings', () => {
    const mixed = {
      ...VALID,
      windows: [
        { id: 'win-a-1', basePath: '/app/a', path: '/other/a' },
        VALID.windows[1],
      ],
    };
    const parsed = parseStoredWorkspace(JSON.stringify(mixed));
    expect(parsed?.windows.map((w) => w.id)).toEqual(['win-docs-2']);
  });

  it('falls back to the first survivor when activeId is not among them', () => {
    const parsed = parseStoredWorkspace(
      JSON.stringify({ ...VALID, activeId: 'win-ghost-1' }),
    );
    expect(parsed?.activeId).toBe('win-home-1');
  });

  it('returns null when the final survivor list is empty', () => {
    const allBad = {
      version: 1,
      windows: [{ id: 'x', basePath: '/nope', path: '/nope' }],
      activeId: 'x',
    };
    expect(parseStoredWorkspace(JSON.stringify(allBad))).toBeNull();
  });
});

describe('serializeWorkspace', () => {
  it('round-trips the navigation identity only (no runtime fields)', () => {
    let state = freshWorkspaceState('win-home-1', '/app');
    state = workspaceReducer(state, {
      type: 'open',
      target: '/app/x?q=1',
      intent: 'auto',
      id: 'win-docs-2',
    });
    state = workspaceReducer(state, {
      type: 'setDirty',
      id: 'win-docs-2',
      dirty: true,
    });
    state = workspaceReducer(state, { type: 'markMounted', id: 'win-docs-2' });
    state = workspaceReducer(state, {
      type: 'setTitle',
      id: 'win-docs-2',
      title: 'عنوان',
    });
    const raw = serializeWorkspace(state);
    expect(raw).not.toBeNull();
    const parsed = parseStoredWorkspace(raw);
    expect(parsed).toEqual({
      version: 1,
      windows: [
        { id: 'win-home-1', basePath: '/app', path: '/app' },
        { id: 'win-docs-2', basePath: '/app/x', path: '/app/x?q=1' },
      ],
      activeId: 'win-docs-2',
    });
    // W-08: no dirty/mounted/title/form data ever reaches storage.
    expect(raw).not.toContain('dirty');
    expect(raw).not.toContain('mounted');
    expect(raw).not.toContain('عنوان');
  });

  it('serializes null for an empty state (nothing to restore)', () => {
    expect(
      serializeWorkspace({ windows: [], activeId: null, pendingCloseId: null }),
    ).toBeNull();
  });
});

describe('readStoredWorkspace / clearStoredWorkspace', () => {
  it('reads and validates through the injected storage', () => {
    const storage = fakeStorage({
      [WORKSPACE_STORAGE_KEY]: JSON.stringify(VALID),
    });
    expect(readStoredWorkspace(storage)).toEqual(VALID);
  });

  it('returns null when absent or corrupt', () => {
    expect(readStoredWorkspace(fakeStorage())).toBeNull();
    expect(
      readStoredWorkspace(fakeStorage({ [WORKSPACE_STORAGE_KEY]: 'not-json' })),
    ).toBeNull();
  });

  it('survives a throwing storage (private mode)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(readStoredWorkspace(throwing)).toBeNull();
    expect(() => clearStoredWorkspace(throwing)).not.toThrow();
  });

  it('clear removes exactly the one key', () => {
    const storage = fakeStorage({
      [WORKSPACE_STORAGE_KEY]: JSON.stringify(VALID),
      other: 'keep-me',
    });
    clearStoredWorkspace(storage);
    expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
    expect(storage.getItem('other')).toBe('keep-me');
  });
});

describe('WorkspacePersistenceWriter', () => {
  function manualIdle() {
    const queue: Array<() => void> = [];
    const idle = (callback: () => void) => {
      queue.push(callback);
      return { kind: 'idle' as const, id: queue.length };
    };
    const run = () => {
      const next = queue.shift();
      next?.();
    };
    return { idle, run, pending: () => queue.length };
  }

  it('coalesces repeated schedules into ONE write carrying the latest value', () => {
    const storage = fakeStorage();
    const { idle, run, pending } = manualIdle();
    const writer = new WorkspacePersistenceWriter(storage, idle);
    writer.schedule('{"a":1}');
    writer.schedule('{"a":2}');
    writer.schedule('{"a":3}');
    expect(pending()).toBe(1);
    run();
    expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBe('{"a":3}');
  });

  it('flush writes immediately; a leftover idle callback is then a no-op', () => {
    const storage = fakeStorage();
    const { idle, run } = manualIdle();
    const writer = new WorkspacePersistenceWriter(storage, idle);
    writer.schedule('{"a":1}');
    writer.flush();
    expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBe('{"a":1}');
    // The queued callback (if the environment could not cancel it) must not
    // write a second time or resurrect stale data.
    run();
    expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBe('{"a":1}');
  });

  it('cancel drops the pending write entirely', () => {
    const storage = fakeStorage({ [WORKSPACE_STORAGE_KEY]: '{"a":0}' });
    const { idle, run } = manualIdle();
    const writer = new WorkspacePersistenceWriter(storage, idle);
    writer.schedule('{"a":2}');
    writer.cancel();
    run();
    // The stored value is untouched by the cancelled schedule.
    expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBe('{"a":0}');
  });

  it('scheduling null clears the key (empty state)', () => {
    const storage = fakeStorage({ [WORKSPACE_STORAGE_KEY]: '{"a":1}' });
    const { idle, run } = manualIdle();
    const writer = new WorkspacePersistenceWriter(storage, idle);
    writer.schedule(null);
    run();
    expect(storage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
  });

  it('swallows quota errors — the page never breaks', () => {
    const quota = {
      getItem: () => null,
      setItem: vi.fn(() => {
        throw new Error('QuotaExceededError');
      }),
      removeItem: vi.fn(() => {
        throw new Error('denied');
      }),
    };
    const { idle, run } = manualIdle();
    const writer = new WorkspacePersistenceWriter(quota, idle);
    writer.schedule('{"a":1}');
    expect(() => run()).not.toThrow();
    expect(quota.setItem).toHaveBeenCalled();
    writer.schedule(null);
    expect(() => run()).not.toThrow();
  });
});
