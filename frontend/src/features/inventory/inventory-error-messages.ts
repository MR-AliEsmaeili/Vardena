import type { UseFormReturn } from 'react-hook-form';
import { normalizeApiError, type ApiError } from '@/api/errors';
import { formatQuantity } from '@/lib/format';
import { t } from '@/lib/i18n';

/**
 * Operation-scoped error presentation for inventory operations
 * (FE-UX-02 §2.1, same decision order as the documents feature):
 *
 * 1. classify by the STABLE ERROR CODE — never by searching `message`;
 * 2. use the allow-listed structured `details` the backend emits
 *    (`details.code` business subcodes: `inventory.backdated_document`,
 *    `inventory.repricing_choice_required`,
 *    `inventory.insufficient_stock`,
 *    `inventory.recalculation_too_large`,
 *    `inventory.valuation_method_not_implemented`,
 *    `inventory.cost_assignment_requires_inbound`);
 * 3. fall back to the safe, operation-specific dictionary copy.
 *
 * The backend `message` is contract-level English text and is NEVER rendered.
 */

export type InventoryOperation =
  | 'postMovement'
  | 'postTransfer'
  | 'recalculate'
  | 'loadMovements'
  | 'loadKardex'
  | 'loadValuationStates';

const OPERATION_FAILURE: Record<InventoryOperation, string> = {
  postMovement: t.inventory.errors.postFailed,
  postTransfer: t.inventory.errors.postFailed,
  recalculate: t.inventory.errors.recalculateFailed,
  loadMovements: t.inventory.movementsLoadFailed,
  loadKardex: t.inventory.kardexLoadFailed,
  loadValuationStates: t.inventory.valuationLoadFailed,
};

export interface InventoryErrorMessage {
  message: string;
  /** Support correlation id — never the reason for the failure. */
  correlationId?: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The structured `details` of a backdating refusal
 * (`inventory.backdated_document` / `inventory.repricing_choice_required`):
 * counts and dates the two-step dialog explains to the operator.
 */
export interface BackdateRefusalDetails {
  code: string;
  movementDate: string;
  latestMovementDate: string | null;
  affectedMovements: number;
  affectedValuedMovements: number;
  alreadyStale: boolean;
  repricingChoices: string[];
}

export function isBackdateRefusal(
  details: unknown,
): details is BackdateRefusalDetails {
  if (!isRecord(details)) return false;
  return (
    typeof details['code'] === 'string' &&
    (details['code'] === 'inventory.backdated_document' ||
      details['code'] === 'inventory.repricing_choice_required') &&
    typeof details['affectedMovements'] === 'number' &&
    typeof details['affectedValuedMovements'] === 'number'
  );
}

export function isBackdateRefusalError(error: unknown): boolean {
  const apiError: ApiError = normalizeApiError(error);
  return (
    apiError.code === 'BusinessRuleViolation' &&
    isBackdateRefusal(apiError.details)
  );
}

function businessRuleMessage(
  operation: InventoryOperation,
  details: unknown,
): string {
  if (!isRecord(details)) return t.inventory.errors.generic;

  const subcode = details['code'];
  if (subcode === 'inventory.insufficient_stock') {
    // The measured quantities (base-unit decimal strings) enrich the
    // canonical copy: چه شد + چه کنید، with real numbers.
    const onHand = details['onHand'];
    const requested = details['requested'];
    const numbers =
      typeof onHand === 'string' && typeof requested === 'string'
        ? ` ${t.inventory.errors.insufficientStockNumbers
            .replace('{onHand}', formatQuantity(onHand))
            .replace('{requested}', formatQuantity(requested))}`
        : '';
    return `${t.inventory.errors.insufficientStock}${numbers}`;
  }
  if (subcode === 'inventory.recalculation_too_large') {
    return t.inventory.errors.recalculationTooLarge;
  }
  if (subcode === 'inventory.valuation_method_not_implemented') {
    return t.inventory.errors.valuationMethodNotImplemented;
  }
  if (subcode === 'inventory.cost_assignment_requires_inbound') {
    return t.inventory.errors.costAssignmentRequiresInbound;
  }
  if (subcode === 'inventory.backdated_document') {
    // On the movement surface this is normally intercepted by the two-step
    // dialog before rendering. The TRANSFER surface has no confirmation dialog
    // yet (recorded follow-up), so it gets the explanation that a backdated
    // transfer is valuable but must be confirmed — never a bypass.
    return operation === 'postTransfer'
      ? t.inventory.errors.backdatedTransferUnresolved
      : t.inventory.errors.generic;
  }
  if (subcode === 'inventory.repricing_choice_required') {
    return t.inventory.errors.generic;
  }
  if (operation === 'recalculate') {
    return t.inventory.errors.recalculateFailed;
  }
  return t.inventory.errors.generic;
}

/**
 * Map an inventory operation failure to its Persian UX message.
 * Session expiry (401) is owned by the global session-expiry flow; callers
 * check `isUnauthorized` separately and must not render a dialog error for it.
 */
export function inventoryErrorMessage(
  operation: InventoryOperation,
  error: unknown,
): InventoryErrorMessage {
  const apiError: ApiError = normalizeApiError(error);

  switch (apiError.code) {
    case 'PermissionDenied':
      return {
        message:
          operation === 'recalculate'
            ? t.inventory.errors.recalculatePermission
            : t.errors.forbidden,
      };
    case 'EntityNotFound':
      return { message: t.errors.notFound };
    case 'Conflict':
      // 409: the operationKey was already used with a different intent —
      // nothing was applied; the recovery is to re-check the posted state.
      return {
        message: t.inventory.errors.operationKeyConflict,
        ...(apiError.correlationId !== undefined
          ? { correlationId: apiError.correlationId }
          : {}),
      };
    case 'BusinessRuleViolation':
      return {
        message: businessRuleMessage(operation, apiError.details),
        ...(apiError.correlationId !== undefined
          ? { correlationId: apiError.correlationId }
          : {}),
      };
    default:
      return {
        message: OPERATION_FAILURE[operation],
        ...(apiError.correlationId !== undefined
          ? { correlationId: apiError.correlationId }
          : {}),
      };
  }
}

// ---------------------------------------------------------------------------
// Server validation → form fields (cost rules, FE-UX-02 §4.3)
// ---------------------------------------------------------------------------

/** The backend's stable `ValidationIssue { field, message, code }` shape. */
interface ServerValidationIssue {
  field: string;
  message: string;
  code: string;
}

function isValidationIssue(value: unknown): value is ServerValidationIssue {
  return (
    isRecord(value) &&
    typeof value['field'] === 'string' &&
    typeof value['message'] === 'string' &&
    typeof value['code'] === 'string'
  );
}

/** Persian copy for the stable cost validation issue codes (`money.ts`). */
const COST_ISSUE_MESSAGES: Record<string, string> = {
  costInputAmbiguous: t.inventory.errors.costInputAmbiguous,
  costNotAcceptedForMovementType:
    t.inventory.errors.costNotAcceptedForMovementType,
  costPrecisionExceeded: t.inventory.errors.costPrecisionExceeded,
  malformed: t.inventory.totalCostInvalid,
  not_positive: t.inventory.totalCostInvalid,
  exceeds_precision: t.inventory.totalCostInvalid,
};

export interface InventoryValidationResult {
  mappedToFields: boolean;
  summary: string;
}

/**
 * Apply a server `ValidationFailed` to the movement form: cost issues land on
 * the (optional) cost field inline; anything else stays in the form summary.
 * The transfer form has no cost field, so it renders the summary only.
 */
export function applyServerValidationToForm<TFieldValues extends object>(
  error: unknown,
  form: UseFormReturn<TFieldValues>,
  costField: (keyof TFieldValues & string) | null,
): InventoryValidationResult | null {
  const apiError = normalizeApiError(error);
  if (apiError.code !== 'ValidationFailed' && apiError.code !== 'BadRequest') {
    return null;
  }
  const issues = Array.isArray(apiError.details)
    ? apiError.details.filter(isValidationIssue)
    : [];
  if (issues.length === 0) {
    return {
      mappedToFields: false,
      summary: t.inventory.errors.generic,
    };
  }

  let mappedToFields = false;
  type FormPath = Parameters<typeof form.setError>[0];
  for (const issue of issues) {
    if (
      costField !== null &&
      (issue.field === 'totalCost' || issue.field === 'unitCost')
    ) {
      const copy =
        COST_ISSUE_MESSAGES[issue.code] ?? t.inventory.totalCostInvalid;
      form.setError(costField as FormPath, { type: 'server', message: copy });
      mappedToFields = true;
    }
  }
  return {
    mappedToFields,
    summary: t.inventory.errors.generic,
  };
}
