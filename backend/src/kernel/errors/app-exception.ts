import { HttpException } from '@nestjs/common';
import { ERROR_STATUS, type ErrorCode } from './error-codes.js';

/** One request-validation problem (stable shape for clients). */
export interface ValidationIssue {
  /** Dotted path of the offending field, e.g. `lines.0.quantity`. */
  field: string;
  /** Human-readable message for the field. */
  message: string;
  /** Machine-readable constraint name, e.g. `isString`, `min`. */
  code: string;
}

/**
 * The only exception type application code should throw for expected failures.
 * Each factory pins the code + HTTP status; `GlobalExceptionFilter` renders
 * the envelope and `AppException` instances bypass message sanitizing because
 * their messages are author-controlled (never include internals: no SQL,
 * stack traces, file paths, or credentials).
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly details: unknown;

  private constructor(code: ErrorCode, message: string, details: unknown) {
    super({ code, message, details }, ERROR_STATUS[code]);
    this.code = code;
    this.details = details;
  }

  /** 400 — request DTO validation failed (thrown by the global pipe). */
  static validation(issues: ValidationIssue[]): AppException {
    return new AppException(
      'ValidationFailed',
      'Request validation failed.',
      issues,
    );
  }

  /** 400 — malformed request that is not a DTO violation (reserved). */
  static badRequest(message = 'Bad request.'): AppException {
    return new AppException('BadRequest', message, undefined);
  }

  /** 401 — authentication required or failed (Identity module owns usage). */
  static unauthorized(message = 'Authentication is required.'): AppException {
    return new AppException('Unauthorized', message, undefined);
  }

  /** 403 — authenticated but lacking permission (RBAC module owns usage). */
  static forbidden(
    message = 'You do not have permission to perform this action.',
    details?: unknown,
  ): AppException {
    return new AppException('PermissionDenied', message, details);
  }

  /** 404 — the addressed entity does not exist (or is invisible to the caller). */
  static notFound(entity: string, id?: string): AppException {
    const details = id === undefined ? { entity } : { entity, id };
    return new AppException(
      'EntityNotFound',
      `${entity} was not found.`,
      details,
    );
  }

  /** 409 — conflicts with current state (duplicate key, version mismatch). */
  static conflict(
    message = 'The request conflicts with the current state.',
    details?: unknown,
  ): AppException {
    return new AppException('Conflict', message, details);
  }

  /** 422 — well-formed request rejected by a domain rule. */
  static businessRule(message: string, details?: unknown): AppException {
    return new AppException('BusinessRuleViolation', message, details);
  }

  /** 429 — per-IP rate limit exceeded. */
  static rateLimited(retryAfterSeconds: number): AppException {
    return new AppException(
      'RateLimitExceeded',
      'Rate limit exceeded. Please slow down and retry.',
      {
        retryAfterSeconds,
      },
    );
  }

  /** 503 — a required downstream capability (database) is unreachable. */
  static serviceUnavailable(
    message = 'A required service is temporarily unavailable. Please try again later.',
  ): AppException {
    return new AppException('ServiceUnavailable', message, undefined);
  }
}
