import { normalizeApiError } from '@/api/errors';
import { t } from '@/lib/i18n';

/**
 * Localized Material Request failure copy (INV-06).
 *
 * Same decision order as the rest of the Inventory domain: classify by the
 * STABLE error code first, and only then recognize the small set of verified
 * backend business phrases this aggregate emits (its transitions have no
 * structured subcodes yet). The raw English server message is never rendered.
 */

export type MaterialRequestOperation =
  'load' | 'create' | 'update' | 'submit' | 'delete';

export interface MaterialRequestErrorMessage {
  message: string;
  correlationId?: string | undefined;
}

const NOT_EDITABLE_MESSAGE =
  'The request can only be edited, submitted or deleted while it is a draft or has been returned for correction.';
const AT_LEAST_ONE_LINE_MESSAGE =
  'A Material Request must have at least one line.';
const MISSING_CONVERSION_PREFIX =
  'No unit conversion from the entered unit to the base unit covers ';
const STATUS_PREFIX = 'Material Request is "';
const NOT_STOCKABLE_PREFIX = 'Item "';
const QUANTITY_MALFORMED =
  'Quantity must be a positive decimal with at most 14 integer digits and 4 decimal places.';
const QUANTITY_NOT_POSITIVE = 'Quantity must be greater than zero.';
const QUANTITY_PRECISION_PREFIX =
  'The converted base quantity needs more than 4 decimal places.';

function isStatusConflict(message: string): boolean {
  return message.startsWith(STATUS_PREFIX);
}

function isItemRefusal(message: string): boolean {
  return (
    message.startsWith(NOT_STOCKABLE_PREFIX) &&
    (message.includes('is not stockable') ||
      message.includes('requires lot tracking') ||
      message.includes('requires serial tracking'))
  );
}

function mapBusinessRule(
  operation: MaterialRequestOperation,
  message: string,
): string {
  if (message === NOT_EDITABLE_MESSAGE)
    return t.materialRequests.errors.notEditable;
  if (isStatusConflict(message)) {
    return operation === 'update' || operation === 'submit'
      ? t.materialRequests.errors.notEditable
      : t.materialRequests.errors.deleteRejected;
  }
  if (message.startsWith(MISSING_CONVERSION_PREFIX)) {
    return t.materialRequests.errors.conversionUnavailable;
  }
  if (isItemRefusal(message)) return t.materialRequests.errors.itemNotPostable;
  if (message === QUANTITY_MALFORMED || message === QUANTITY_NOT_POSITIVE) {
    return t.materialRequests.errors.quantityInvalid;
  }
  if (message.startsWith(QUANTITY_PRECISION_PREFIX)) {
    return t.materialRequests.errors.quantityInvalid;
  }
  return fallbackFor(operation);
}

function fallbackFor(operation: MaterialRequestOperation): string {
  switch (operation) {
    case 'load':
      return t.materialRequests.loadFailed;
    case 'create':
      return t.materialRequests.errors.createRejected;
    case 'update':
      return t.materialRequests.errors.updateRejected;
    case 'submit':
      return t.materialRequests.errors.submitRejected;
    case 'delete':
      return t.materialRequests.errors.deleteRejected;
  }
}

/** Localized Material Request failure copy; raw backend English is never shown. */
export function materialRequestErrorMessage(
  operation: MaterialRequestOperation,
  error: unknown,
): MaterialRequestErrorMessage {
  const apiError = normalizeApiError(error);
  let message: string;

  switch (apiError.code) {
    case 'PermissionDenied':
      message = t.errors.forbidden;
      break;
    case 'EntityNotFound':
      message =
        operation === 'load'
          ? t.materialRequests.detailNotFound
          : t.materialRequests.errors.referenceNotFound;
      break;
    case 'Conflict':
      message = t.materialRequests.errors.statusChanged;
      break;
    case 'BusinessRuleViolation':
      message = mapBusinessRule(operation, apiError.message);
      break;
    case 'BadRequest':
    case 'ValidationFailed':
      message =
        apiError.message === AT_LEAST_ONE_LINE_MESSAGE
          ? t.materialRequests.errors.atLeastOneLine
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
      message = fallbackFor(operation);
      break;
  }

  return {
    message,
    ...(apiError.correlationId !== undefined
      ? { correlationId: apiError.correlationId }
      : {}),
  };
}
