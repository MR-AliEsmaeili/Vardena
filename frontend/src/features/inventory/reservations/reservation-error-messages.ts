import { normalizeApiError } from '@/api/errors';
import { formatQuantity } from '@/lib/format';
import { t } from '@/lib/i18n';

export type ReservationOperation = 'create' | 'release';

export interface ReservationErrorMessage {
  message: string;
  correlationId?: string | undefined;
}

const REFERENCE_PAIR_MESSAGE =
  'referenceType and referenceId must be set together.';
const RELEASED_MESSAGE =
  'The reservation is already released. A release is terminal and cannot be applied twice.';
const MATERIAL_REQUEST_MESSAGE =
  'This reservation belongs to a Material Request line and can only';
const OPERATION_KEY_MESSAGE =
  'This operationKey was already used with a different request.';
const BALANCE_DRIFT_MESSAGE =
  'The stored reserved quantity contradicts this release. Run reconciliation to diagnose it before retrying.';
const MISSING_CONVERSION_PREFIX =
  'No unit conversion from the entered unit to the base unit covers ';
const INSUFFICIENT_STOCK_PATTERN =
  /^Insufficient available stock in warehouse "([^"]+)": available ([+-]?\d+(?:\.\d+)?), requested ([+-]?\d+(?:\.\d+)?)\.$/;

function mapBusinessRule(
  operation: ReservationOperation,
  message: string,
): string {
  // Reservation business rules currently have stable API codes but no
  // structured subcodes. Match only the known backend phrases, then render
  // localized copy; never display the raw server message.
  if (message === RELEASED_MESSAGE) return t.reservations.releasedAlready;
  if (message.startsWith(MATERIAL_REQUEST_MESSAGE)) {
    return t.reservations.materialRequestOwnedBody;
  }
  if (operation === 'create') {
    if (message.startsWith(MISSING_CONVERSION_PREFIX)) {
      return t.reservations.conversionUnavailable;
    }
    const insufficient = INSUFFICIENT_STOCK_PATTERN.exec(message);
    if (insufficient !== null) {
      const [, warehouse, available, requested] = insufficient;
      return t.reservations.errors.insufficientStock
        .replace('{warehouse}', warehouse ?? '')
        .replace('{available}', formatQuantity(available))
        .replace('{requested}', formatQuantity(requested));
    }
    return t.reservations.errors.createRejected;
  }
  return t.reservations.errors.releaseRejected;
}

/** Localized reservation failure copy; raw backend English is never rendered. */
export function reservationErrorMessage(
  operation: ReservationOperation,
  error: unknown,
): ReservationErrorMessage {
  const apiError = normalizeApiError(error);
  let message: string;

  switch (apiError.code) {
    case 'PermissionDenied':
      message = t.errors.forbidden;
      break;
    case 'EntityNotFound':
      message = t.errors.notFound;
      break;
    case 'Conflict':
      if (apiError.message.startsWith(OPERATION_KEY_MESSAGE)) {
        message = t.reservations.errors.operationKeyReused;
      } else if (apiError.message === BALANCE_DRIFT_MESSAGE) {
        message = t.reservations.errors.balanceDrift;
      } else {
        message =
          operation === 'create'
            ? t.reservations.errors.createRejected
            : t.reservations.errors.releaseRejected;
      }
      break;
    case 'BusinessRuleViolation':
      message = mapBusinessRule(operation, apiError.message);
      break;
    case 'BadRequest':
    case 'ValidationFailed':
      message =
        apiError.message === REFERENCE_PAIR_MESSAGE
          ? t.reservations.referencePairHint
          : t.errors.validation;
      break;
    case 'NetworkError':
      message = t.errors.network;
      break;
    case 'ServiceUnavailable':
    case 'InternalError':
      message = t.errors.server;
      break;
    case 'Unauthorized':
    case 'RequestAborted':
    case 'RateLimitExceeded':
    default:
      message =
        operation === 'create'
          ? t.reservations.errors.createRejected
          : t.reservations.errors.releaseRejected;
      break;
  }

  return {
    message,
    ...(apiError.correlationId !== undefined
      ? { correlationId: apiError.correlationId }
      : {}),
  };
}
