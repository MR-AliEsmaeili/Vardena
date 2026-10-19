/**
 * Process-wide registry of IN-FLIGHT HTTP requests.
 *
 * The application has exactly one transport (`api/client.ts`: one Axios
 * instance and the four `apiGet`/`apiPost`/`apiPatch`/`apiDelete` helpers).
 * This registry is the single place that knows how many real requests are
 * currently open, so the loading UI never has to guess from the last
 * response, a shared boolean or a component-local `isPending` flag.
 *
 * Design rules:
 * - There is deliberately NO React dependency here. The Axios interceptors
 *   own the lifecycle; React subscribes through
 *   `subscribeToRequestActivity` + `getRequestActivitySnapshot`
 *   (`useSyncExternalStore`).
 * - Every call to `beginRequest` returns a unique token. `endRequest(token)`
 *   removes exactly that token and is idempotent, so success, HTTP error,
 *   network failure, cancellation and a repeated finalization can never
 *   decrement another request's entry or drive a count negative.
 * - The snapshot changes identity only when the registry actually changes,
 *   which is required by `useSyncExternalStore`.
 * - A request that never settles is genuinely still in flight; the registry
 *   does not invent a timeout that would hide an open operation. Axios
 *   guarantees that every settled request (including cancellation) reaches
 *   the response interceptor, which is the one finalization path.
 */

/** How a request contributes to the application's loading feedback. */
export type RequestActivityScope =
  /** User-blocking request: may surface the global indicator. */
  | 'global'
  /** Refetch/background read: ambient indicator only, never the global panel. */
  | 'background';

/**
 * Semantic message keys. Text lives in `lib/i18n.ts`; the transport layer
 * never carries Persian copy and never inspects an endpoint to write UI text.
 */
export type RequestActivityMessage =
  'receiving' | 'saving' | 'updating' | 'deleting' | 'processing';

/**
 * Immutable view consumed by React. `globalMessage` is non-null only when
 * every active global request agrees on the same message, so a mixed set
 * falls back to the neutral «در حال انجام عملیات…» instead of naming the
 * wrong operation.
 */
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

/**
 * Register one real HTTP attempt. Returns the token that must be passed to
 * `endRequest` when that attempt settles.
 */
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

/**
 * Finalize exactly one request. Safe to call twice and safe for an unknown or
 * `undefined` token (a request that was deliberately untracked).
 */
export function endRequest(token: number | undefined): void {
  if (token === undefined) return;
  if (!entries.delete(token)) return;
  emit();
}

/** Current immutable snapshot (also used as the server snapshot). */
export function getRequestActivitySnapshot(): RequestActivitySnapshot {
  return snapshot;
}

/** Subscribe a consumer (React's `useSyncExternalStore`). */
export function subscribeToRequestActivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Test-only reset. Production code must never call this: dropping live
 * entries would hide a request that is still running.
 */
export function resetRequestActivityForTests(): void {
  entries.clear();
  nextToken = 1;
  snapshot = EMPTY_SNAPSHOT;
  for (const listener of [...listeners]) listener();
}
