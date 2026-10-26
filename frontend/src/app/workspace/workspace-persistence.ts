/**
 * Workspace persistence — the ONLY two browser-storage records the dock owns
 * (spec §6.10, FDR-01 §3, standards.md §15 whitelist).
 *
 *  A) `vardena:workspace:v1` (sessionStorage): the open-window list after a
 *     refresh — navigation identity ONLY (`id`, `basePath`, `path`,
 *     `activeId`). Never form values, drafts, business data or tokens (W-08).
 *     sessionStorage dies with the tab, so a shared workstation never hands
 *     the next operator the previous operator's window list.
 *  B) `vardena:module-tones:v1` lives in `lib/module-tones-storage.ts`
 *     (module-tone assignment; appearance-class preference).
 *
 * Every read is fail-closed: anything unexpected yields "fresh workspace"
 * rather than a half-restored shell. Writes are debounced through
 * `requestIdleCallback` (fallback `setTimeout(…, 0)`) and swallow quota /
 * private-mode errors (the `appearance.ts` pattern).
 */

import type { WorkspaceState } from './workspace-reducer';

export const WORKSPACE_STORAGE_KEY = 'vardena:workspace:v1';

/** Window ids are only accepted in this conservative shape. */
const WINDOW_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** Navigation identity of one restored window — nothing else is stored. */
export interface StoredWorkspaceWindow {
  id: string;
  basePath: string;
  path: string;
}

export interface StoredWorkspace {
  version: 1;
  windows: StoredWorkspaceWindow[];
  activeId: string;
}

/** The hard cap mirrored from the reducer (kept literal for the validator). */
const MAX_STORED_WINDOWS = 12;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function sessionStore(): StorageLike | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse + validate the stored record (spec §6.10·الف — every rule below has a
 * unit test). Returns `null` when the result is unusable, which means
 * "fresh workspace" to the caller.
 *
 * - absent / invalid JSON                 → null (fresh)
 * - `version !== 1`                       → null (ignore unknown versions)
 * - `windows` not an array / empty / >12  → null (fresh)
 * - member `id` failing the id pattern    → drop that member
 * - duplicate `id`                        → drop the later duplicate
 * - `basePath`/`path` not a string or not starting with `/app` → drop member
 * - `activeId` not among the survivors    → first surviving window
 */
export function parseStoredWorkspace(
  raw: string | null,
): StoredWorkspace | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.version !== 1) return null;
  if (!Array.isArray(parsed.windows)) return null;
  if (
    parsed.windows.length === 0 ||
    parsed.windows.length > MAX_STORED_WINDOWS
  ) {
    return null;
  }

  const windows: StoredWorkspaceWindow[] = [];
  const seen = new Set<string>();
  for (const member of parsed.windows) {
    if (!isRecord(member)) continue;
    const { id, basePath, path } = member;
    if (typeof id !== 'string' || !WINDOW_ID_PATTERN.test(id)) continue;
    if (seen.has(id)) continue;
    if (typeof basePath !== 'string' || !basePath.startsWith('/app')) continue;
    if (typeof path !== 'string' || !path.startsWith('/app')) continue;
    seen.add(id);
    windows.push({ id, basePath, path });
  }
  const first = windows[0];
  if (first === undefined) return null;

  const activeId =
    typeof parsed.activeId === 'string' &&
    windows.some((window) => window.id === parsed.activeId)
      ? parsed.activeId
      : first.id;

  return { version: 1, windows, activeId };
}

/** Serialize the navigation identity of a state (runtime fields excluded). */
export function serializeWorkspace(state: WorkspaceState): string | null {
  const first = state.windows[0];
  if (first === undefined || state.activeId === null) return null;
  const activeId = state.windows.some((window) => window.id === state.activeId)
    ? state.activeId
    : first.id;
  const record: StoredWorkspace = {
    version: 1,
    windows: state.windows.map((window) => ({
      id: window.id,
      basePath: window.basePath,
      path: window.path,
    })),
    activeId,
  };
  return JSON.stringify(record);
}

/** Read + validate the stored window list (null → fresh workspace). */
export function readStoredWorkspace(
  storage: StorageLike | null = sessionStore(),
): StoredWorkspace | null {
  if (storage === null) return null;
  try {
    return parseStoredWorkspace(storage.getItem(WORKSPACE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Logout / session expiry / "close all" hygiene (FDR-01 §3.1). */
export function clearStoredWorkspace(
  storage: StorageLike | null = sessionStore(),
): void {
  if (storage === null) return;
  try {
    storage.removeItem(WORKSPACE_STORAGE_KEY);
  } catch {
    // Storage-less environments simply have nothing to clear.
  }
}

type IdleHandle =
  { kind: 'idle'; id: number } | { kind: 'timeout'; id: number };

interface IdleWindow {
  requestIdleCallback?: (callback: () => void) => number;
  cancelIdleCallback?: (id: number) => void;
}

/**
 * Debounced, error-swallowing writer. `schedule` is idempotent: repeated
 * calls before the idle callback coalesce into ONE write carrying the latest
 * snapshot. Quota or private-mode failures never break the page.
 */
export class WorkspacePersistenceWriter {
  private pendingValue: string | null = null;
  private hasPending = false;
  private handle: IdleHandle | null = null;

  constructor(
    private readonly storage: StorageLike | null = sessionStore(),
    private readonly idle: (callback: () => void) => IdleHandle = defaultIdle,
  ) {}

  schedule(serialized: string | null): void {
    // `null` is a real instruction (clear the key), not "nothing to do":
    // `hasPending` distinguishes an explicit null from an empty queue.
    this.pendingValue = serialized;
    this.hasPending = true;
    if (this.handle !== null) return; // already queued — coalesce
    this.handle = this.idle(() => {
      this.handle = null;
      this.flush();
    });
  }

  /** Write (or clear) the pending snapshot now; cancels the queued callback. */
  flush(): void {
    if (this.handle !== null) {
      const handle = this.handle;
      this.handle = null;
      cancelIdle(handle);
    }
    if (!this.hasPending) return;
    const serialized = this.pendingValue;
    this.pendingValue = null;
    this.hasPending = false;
    if (this.storage === null) return;
    try {
      if (serialized === null) {
        this.storage.removeItem(WORKSPACE_STORAGE_KEY);
      } else {
        this.storage.setItem(WORKSPACE_STORAGE_KEY, serialized);
      }
    } catch {
      // Quota exceeded / private mode — persistence is best-effort (the
      // `appearance.ts` pattern); the page must never break.
    }
  }

  cancel(): void {
    this.pendingValue = null;
    this.hasPending = false;
    if (this.handle === null) return;
    const handle = this.handle;
    this.handle = null;
    cancelIdle(handle);
  }
}

function defaultIdle(callback: () => void): IdleHandle {
  const scope = globalThis as IdleWindow & {
    setTimeout: (callback: () => void, ms: number) => number;
    clearTimeout: (id: number) => void;
  };
  if (typeof scope.requestIdleCallback === 'function') {
    return { kind: 'idle', id: scope.requestIdleCallback(callback) };
  }
  return { kind: 'timeout', id: scope.setTimeout(callback, 0) };
}

function cancelIdle(handle: IdleHandle): void {
  const scope = globalThis as IdleWindow & {
    clearTimeout: (id: number) => void;
  };
  if (handle.kind === 'idle') {
    scope.cancelIdleCallback?.(handle.id);
    return;
  }
  scope.clearTimeout(handle.id);
}
