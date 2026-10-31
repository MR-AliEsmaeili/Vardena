import { normalizeApiError } from '@/api/errors';
import { t } from '@/lib/i18n';

/**
 * Localized Material Request failure copy (INV-06 authoring + INV-07 approval
 * cycle).
 *
 * Same decision order as the rest of the Inventory domain: classify by the
 * STABLE error code first, and only then recognize the small set of verified
 * backend business phrases this aggregate emits (its transitions have no
 * structured subcodes yet). The raw English server message is never rendered
 * as the whole sentence — EXCEPT the one case where the message carries the
 * server's own `available`/`requested` numbers: those digits are never
 * reconstructed or rounded on the client (standards §7), so they are shown
 * verbatim inside a localized sentence.
 */

export type MaterialRequestOperation =
  | 'load'
  | 'create'
  | 'update'
  | 'submit'
  | 'delete'
  | 'approve'
  | 'reject'
  | 'returnForCorrection'
  | 'reverseApproval'
  | 'cancel';

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

// ---- INV-07 approval-cycle phrases (verified against the backend) ----------

const NOT_SUBMITTED_MESSAGE =
  'The request must be submitted (awaiting approval) for this action.';
const NOT_APPROVED_MESSAGE = 'The request is not approved.';
const LINES_INVOKED_PREFIX = 'This action cannot be completed:';
const INSUFFICIENT_STOCK_PREFIX = 'Insufficient available stock';
const BALANCE_DRIFT_PREFIX =
  'The stored stock balance contradicts this operation.';
const REJECTION_REASON_REQUIRED = 'A rejection reason is required.';
const RETURN_REASON_REQUIRED = 'A return reason is required.';
const REASON_TOO_LONG_PREFIX = 'Reason must be at most';
const DESCRIPTION_TOO_LONG_PREFIX = 'Description must be at most';

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

function mapAuthoringRule(
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

/**
 * Approval-cycle `422` bodies. The request-level refusal ("not submitted",
 * "not approved", "a line was invoked") is a business rule on the transition,
 * and every one of them is reachable in the UI only through a race: the
 * availability matrix already hides the command. The user still needs to know
 * the state moved under them, so the copy names the rule.
 */
function mapDecisionRule(message: string): string | null {
  if (message === NOT_SUBMITTED_MESSAGE) {
    return t.materialRequests.actions.disabledNotSubmitted;
  }
  if (message === NOT_APPROVED_MESSAGE) {
    return t.materialRequests.actions.disabledNotApproved;
  }
  if (message.startsWith(LINES_INVOKED_PREFIX)) {
    return t.materialRequests.actions.disabledLinesInvoked;
  }
  if (message.startsWith(INSUFFICIENT_STOCK_PREFIX)) {
    // Numbers come from the server, verbatim; only the lead-in is localized.
    return t.materialRequests.errors.insufficientStock.replace(
      '{details}',
      message,
    );
  }
  if (message.startsWith(BALANCE_DRIFT_PREFIX)) {
    return t.materialRequests.errors.balanceDrift;
  }
  if (
    message === REJECTION_REASON_REQUIRED ||
    message === RETURN_REASON_REQUIRED
  ) {
    return t.materialRequests.actions.reasonRequired;
  }
  if (
    message.startsWith(REASON_TOO_LONG_PREFIX) ||
    message.startsWith(DESCRIPTION_TOO_LONG_PREFIX)
  ) {
    return t.materialRequests.actions.reasonTooLong;
  }
  return null;
}

function isDecisionOperation(operation: MaterialRequestOperation): boolean {
  return (
    operation === 'approve' ||
    operation === 'reject' ||
    operation === 'returnForCorrection' ||
    operation === 'reverseApproval' ||
    operation === 'cancel'
  );
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
    case 'approve':
    case 'reject':
    case 'returnForCorrection':
    case 'reverseApproval':
    case 'cancel':
      return t.materialRequests.errors.decisionRejected;
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
      // The original-approver rule is a domain 403, not a missing RBAC code;
      // it needs its own explanation rather than the generic "no access".
      message =
        operation === 'reverseApproval'
          ? t.materialRequests.errors.notOriginalApprover
          : t.errors.forbidden;
      break;
    case 'EntityNotFound':
      message =
        operation === 'load'
          ? t.materialRequests.detailNotFound
          : t.materialRequests.errors.referenceNotFound;
      break;
    case 'Conflict':
      // A projection-drift `409` is the only conflict a decision command can
      // raise; authoring keeps the generic "state changed" copy.
      message = isDecisionOperation(operation)
        ? t.materialRequests.errors.balanceDrift
        : t.materialRequests.errors.statusChanged;
      break;
    case 'BusinessRuleViolation':
      message = isDecisionOperation(operation)
        ? (mapDecisionRule(apiError.message) ?? fallbackFor(operation))
        : mapAuthoringRule(operation, apiError.message);
      break;
    case 'BadRequest':
    case 'ValidationFailed': {
      const decisionMessage = isDecisionOperation(operation)
        ? mapDecisionRule(apiError.message)
        : null;
      if (decisionMessage !== null) {
        message = decisionMessage;
        break;
      }
      message =
        apiError.message === AT_LEAST_ONE_LINE_MESSAGE
          ? t.materialRequests.errors.atLeastOneLine
          : t.errors.validation;
      break;
    }
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
