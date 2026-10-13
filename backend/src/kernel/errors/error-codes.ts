/**
 * Stable machine-readable API error codes (architecture.md section 9, ADR-0015).
 *
 * Every error response has the shape:
 *   { code, message, details?, correlationId }
 * where `code` is one of these values and the HTTP status is fixed per code.
 * Clients must branch on `code`, never on `message` (human-readable, may change).
 *
 * Success responses are NOT enveloped: endpoints return their DTOs directly
 * (lists as `{ items, total, page, pageSize }`).
 */

/** Error code -> HTTP status. The single source of truth for the mapping. */
export const ERROR_STATUS = {
  ValidationFailed: 400,
  BadRequest: 400,
  Unauthorized: 401,
  PermissionDenied: 403,
  EntityNotFound: 404,
  Conflict: 409,
  BusinessRuleViolation: 422,
  RateLimitExceeded: 429,
  ServiceUnavailable: 503,
  InternalError: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
  correlationId: string;
}

/**
 * Maps framework-thrown HTTP statuses back onto stable codes. Used only for
 * exceptions that are NOT `AppException` (router 404s, body-parser 400s, …).
 * Unmapped 4xx -> BadRequest, unmapped 5xx -> InternalError.
 */
export const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'BadRequest',
  401: 'Unauthorized',
  403: 'PermissionDenied',
  404: 'EntityNotFound',
  409: 'Conflict',
  422: 'BusinessRuleViolation',
  429: 'RateLimitExceeded',
  503: 'ServiceUnavailable',
};
