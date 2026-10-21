import { AxiosError } from 'axios';
import { t } from '@/lib/i18n';

/**
 * API error normalization.
 *
 * The backend renders EVERY error through one filter
 * (`backend/src/kernel/errors/global-exception.filter.ts`) as
 * `{ code, message, details?, correlationId }` with a fixed code → status
 * mapping (`kernel/errors/error-codes.ts`). The frontend branches on `code`,
 * never on `message` (the message is human text and may change).
 */

/**
 * Codes with a fixed Persian sentence. The Owner API *also* returns
 * domain-specific codes (`fail(status, code, …)` in `owner-licensing/backend`:
 * `DuplicateInstallationIdentity`, `ActiveProfileExists`, `LimitProfileExceeded`,
 * `ArtifactBindingMismatch`, …). Dropping those — which the previous
 * closed-list `isApiErrorBody` did — turned a precise 409 into a generic
 * “invalid request”, so the code and message are now preserved and only the
 * message lookup is a closed list.
 */
export const API_ERROR_CODES = [
  'ValidationFailed',
  'BadRequest',
  'Unauthorized',
  'PermissionDenied',
  'EntityNotFound',
  'Conflict',
  'InvalidTransition',
  'DuplicateOperation',
  'BusinessRuleViolation',
  'RateLimitExceeded',
  'ServiceUnavailable',
  'InternalError',
  'DuplicateInstallationIdentity',
  'InstallationIdentityRetired',
  'ActiveProfileExists',
  'LimitProfileExceeded',
  'SigningKeyUnavailable',
  'CustomerInactive',
  'ArtifactBindingMismatch',
  'GrantNotActive',
  'AlreadyRevoked',
  'NoArtifact',
  'ArtifactStorageUnavailable',
  'TrustListUnavailable',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Client-side pseudo-codes for failures that never reached the API. */
export type ApiFailureCode = ApiErrorCode | 'NetworkError' | 'RequestAborted';

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
  correlationId: string;
}

export class ApiError extends Error {
  readonly code: ApiFailureCode;
  readonly status: number | undefined;
  readonly correlationId: string | undefined;
  readonly details: unknown;

  constructor(params: {
    code: ApiFailureCode;
    message: string;
    status?: number | undefined;
    correlationId?: string | undefined;
    details?: unknown;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.code = params.code;
    this.status = params.status;
    this.correlationId = params.correlationId;
    this.details = params.details;
  }

  get isUnauthorized(): boolean {
    return this.code === 'Unauthorized' || this.status === 401;
  }

  get isForbidden(): boolean {
    return this.code === 'PermissionDenied' || this.status === 403;
  }

  get isNotFound(): boolean {
    return this.code === 'EntityNotFound' || this.status === 404;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body['code'] === 'string' &&
    typeof body['message'] === 'string' &&
    // A code this build does not know is not rendered: its message could be an
    // upstream implementation detail. The list above is the Owner API's own
    // closed vocabulary, so recognizing a code is what makes it displayable.
    (API_ERROR_CODES as readonly string[]).includes(body['code'])
  );
}

/** Human message per stable error code (never derived from the raw message). */
function messageForCode(code: ApiFailureCode, fallback?: string): string {
  switch (code) {
    case 'Unauthorized':
      return t.errors.unauthorized;
    case 'PermissionDenied':
      return t.errors.forbidden;
    case 'EntityNotFound':
      return t.errors.notFound;
    case 'ValidationFailed':
    case 'BadRequest':
      return fallback ?? t.errors.validation;
    case 'BusinessRuleViolation':
      return fallback ?? t.errors.businessRule;
    case 'Conflict':
      return fallback ?? t.errors.conflict;
    case 'InvalidTransition':
      return t.errors.invalidTransition;
    case 'DuplicateOperation':
      return t.errors.duplicateOperation;
    case 'DuplicateInstallationIdentity':
      return t.errors.duplicateInstallationIdentity;
    case 'InstallationIdentityRetired':
      return t.errors.installationIdentityRetired;
    case 'ActiveProfileExists':
      return t.errors.activeProfileExists;
    case 'LimitProfileExceeded':
      return t.errors.limitProfileExceeded;
    case 'SigningKeyUnavailable':
      return t.errors.signingKeyUnavailable;
    case 'CustomerInactive':
      return t.errors.customerInactive;
    case 'ArtifactBindingMismatch':
      return t.errors.artifactBindingMismatch;
    case 'GrantNotActive':
      return t.errors.grantNotActive;
    case 'AlreadyRevoked':
      return t.errors.alreadyRevoked;
    case 'NoArtifact':
      return t.errors.noArtifact;
    case 'ArtifactStorageUnavailable':
      return t.errors.artifactStorageUnavailable;
    case 'TrustListUnavailable':
      return t.errors.trustListUnavailable;
    case 'RateLimitExceeded':
      return t.errors.rateLimited;
    case 'ServiceUnavailable':
    case 'InternalError':
      return t.errors.server;
    case 'NetworkError':
      return t.errors.network;
    case 'RequestAborted':
      return t.errors.unknown;
    default:
      return fallback ?? t.errors.unknown;
  }
}

/** Convert any thrown value into the single error type the UI renders. */
export function normalizeApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (error instanceof AxiosError) {
    if (error.code === AxiosError.ERR_CANCELED) {
      return new ApiError({
        code: 'RequestAborted',
        message: messageForCode('RequestAborted'),
      });
    }

    const response = error.response;
    if (response === undefined) {
      return new ApiError({
        code: 'NetworkError',
        message: messageForCode('NetworkError'),
      });
    }

    const body: unknown = response.data;
    if (isApiErrorBody(body)) {
      return new ApiError({
        code: body.code,
        message: messageForCode(body.code, body.message),
        status: response.status,
        correlationId: body.correlationId,
        details: body.details,
      });
    }

    // A non-envelope response (proxy error page, gateway timeout, …).
    const statusCode: ApiFailureCode =
      response.status === 401
        ? 'Unauthorized'
        : response.status === 403
          ? 'PermissionDenied'
          : response.status === 404
            ? 'EntityNotFound'
            : response.status >= 500
              ? 'InternalError'
              : 'BadRequest';
    return new ApiError({
      code: statusCode,
      message: messageForCode(statusCode),
      status: response.status,
    });
  }

  if (error instanceof Error) {
    return new ApiError({ code: 'InternalError', message: t.errors.unknown });
  }

  return new ApiError({ code: 'InternalError', message: t.errors.unknown });
}

/** True for failures that must not be retried by the query layer. */
export function isTerminalApiError(error: unknown): boolean {
  const apiError = normalizeApiError(error);
  return (
    apiError.isUnauthorized ||
    apiError.isForbidden ||
    apiError.isNotFound ||
    apiError.code === 'ValidationFailed' ||
    apiError.code === 'BadRequest' ||
    apiError.code === 'BusinessRuleViolation' ||
    apiError.code === 'Conflict' ||
    apiError.code === 'InvalidTransition' ||
    apiError.code === 'DuplicateOperation'
  );
}
