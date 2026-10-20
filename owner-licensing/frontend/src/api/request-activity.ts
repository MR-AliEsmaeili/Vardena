/**
 * Process-wide registry of IN-FLIGHT HTTP requests.
 *
 * Ported from the main Vardena frontend (docs/frontend/loading-system.md,
 * ADR-0051). The Owner SPA has exactly one transport (api/client.ts).
 * This registry is the single place that knows how many real requests are
 * currently open.
 *
 * Design rules:
 * - No React dependency. Axios interceptors own the lifecycle; React
 *   subscribes through subscribeToRequestActivity + getRequestActivitySnapshot.
 * - Every beginRequest returns a unique token. endRequest(token) is
 *   idempotent and removes exactly that token.
 * - Snapshot identity changes only when the registry changes.
 */

export type RequestActivityScope = 'global' | 'background';

export type RequestActivityMessage =
  'receiving' | 'saving' | 'updating' | 'deleting' | 'processing';

export interface RequestActivitySnapshot {
  readonly total: number;
  readonly global: number;
  readonly background: number;
  readonly globalMessage: RequestActivityMessage | null;
}

interface RequestActivityEntry {
  readonly scope: RequestActivityScope;
  readonly message: RequestActivityMessage;
}

const EMPTY_SNAPSHOT: RequestActivitySnapshot = Object.freeze({
  total: 0,
  global: 0,
  background: 0,
  globalMessage: null,
});

type Listener = () => void;

const entries = new Map<number, RequestActivityEntry>();
const listeners = new Set<Listener>();
let nextToken = 1;
let snapshot: RequestActivitySnapshot = EMPTY_SNAPSHOT;

function computeSnapshot(): RequestActivitySnapshot {
  if (entries.size === 0) return EMPTY_SNAPSHOT;

  let global = 0;
  let background = 0;
  const globalMessages = new Set<RequestActivityMessage>();

  for (const entry of entries.values()) {
    if (entry.scope === 'background') {
      background += 1;
      continue;
    }
    global += 1;
    globalMessages.add(entry.message);
  }

  return Object.freeze({
    total: global + background,
    global,
    background,
    globalMessage:
      globalMessages.size === 1
        ? (globalMessages.values().next().value ?? null)
        : null,
  });
}

function emit(): void {
  snapshot = computeSnapshot();
  for (const listener of [...listeners]) listener();
}

export function beginRequest(params: {
  scope: RequestActivityScope;
  message: RequestActivityMessage;
}): number {
  const token = nextToken;
  nextToken += 1;
  entries.set(token, { scope: params.scope, message: params.message });
  emit();
  return token;
}

export function endRequest(token: number | undefined): void {
  if (token === undefined) return;
  if (!entries.delete(token)) return;
  emit();
}

export function getRequestActivitySnapshot(): RequestActivitySnapshot {
  return snapshot;
}

export function subscribeToRequestActivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only reset. Production code must never call this. */
export function resetRequestActivityForTests(): void {
  entries.clear();
  nextToken = 1;
  snapshot = EMPTY_SNAPSHOT;
  for (const listener of [...listeners]) listener();
}
