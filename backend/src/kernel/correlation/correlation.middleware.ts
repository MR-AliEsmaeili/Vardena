import type { NextFunction, Request, Response } from 'express';
import { generateId, isUlid } from '../ids/ulid.js';
import { runWithRequestContext } from './request-context.js';

/**
 * Correlation id handling (security.md section 5, ADR-0015).
 *
 * Decision: a client-supplied `x-correlation-id` is ACCEPTED when it is a
 * well-formed ULID or UUID, otherwise it is REPLACED with a server-generated
 * ULID. Rationale:
 * - Accepting valid ids preserves end-to-end traces started by upstream
 *   callers (SPA, future machine clients, support tooling).
 * - Strict format validation prevents log/audit injection via arbitrary
 *   header values (no newlines, no unbounded length, fixed alphabet).
 * - ULIDs are the canonical internal form (ADR-0008); UUIDs are accepted
 *   for interop because external clients commonly emit them.
 *
 * The resolved id is echoed on every response (`x-correlation-id`) and is
 * available via `getCorrelationId()` to logs, error responses, and — in
 * later sessions — audit records and outbox rows.
 */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_HEADER_LENGTH = 128;

/** Resolve the effective correlation id for one request (pure, testable). */
export function resolveCorrelationId(candidate: unknown): string {
  if (typeof candidate === 'string') {
    const value = candidate.trim();
    if (value.length > 0 && value.length <= MAX_HEADER_LENGTH) {
      // UUID first: the regex test does not narrow the type, the guard does.
      if (UUID_PATTERN.test(value)) return value.toLowerCase();
      if (isUlid(value)) return value.toUpperCase();
    }
  }
  return generateId();
}

export function correlationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const raw = req.headers[CORRELATION_ID_HEADER];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  const correlationId = resolveCorrelationId(candidate);
  res.setHeader(CORRELATION_ID_HEADER, correlationId);
  runWithRequestContext({ correlationId }, () => next());
}
