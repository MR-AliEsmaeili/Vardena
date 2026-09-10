import { AsyncLocalStorage } from 'node:async_hooks';

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
