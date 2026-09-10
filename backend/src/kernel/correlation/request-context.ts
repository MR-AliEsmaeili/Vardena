import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Authenticated principal attached to every authenticated request.
 *
 * Set by the Identity module's authentication guard after session validation
 * and available to downstream application services, logs, and (later) audit
 * records. It is carried via AsyncLocalStorage — NEVER via global mutable
 * state.
 *
 * Authentication answers "Who is this user?" (Identity).
 * Authorization/RBAC answers "What may they do?" (a later module).
 */
export interface AuthenticatedPrincipal {
  /** Authenticated user id (ULID from `users.users`). */
  userId: string;
  /** Authenticated session id (ULID from `identity.sessions`). */
  sessionId: string;
}

/**
 * Ambient request context, carried by AsyncLocalStorage.
 *
 * The correlation id is set once per request by `correlationMiddleware` and
 * is then available to logs, errors, and (in later sessions) audit records
 * and outbox rows — without threading it through every function signature.
 *
 * Worker jobs have no HTTP request: dispatch code must create an explicit
 * context per job (see `JobsRegistry` docs) so job logs stay traceable.
 */
export interface RequestContext {
  correlationId: string;
  /** Authenticated principal; unset for anonymous requests. */
  principal?: AuthenticatedPrincipal | undefined;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => T,
): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

export function getPrincipal(): AuthenticatedPrincipal | undefined {
  return storage.getStore()?.principal;
}

/**
 * Attach an authenticated principal to the current request context. Used by
 * the Identity module's auth guard after session validation. It is an error
 * to call this without an active request context.
 */
export function setPrincipal(principal: AuthenticatedPrincipal): void {
  const ctx = storage.getStore();
  if (ctx === undefined) {
    throw new Error('setPrincipal called outside a request context.');
  }
  ctx.principal = principal;
}
