import { normalizeApiError } from '@/api/errors';
import { t } from '@/lib/i18n';

/**
 * Error presentation for business-document operations.
 *
 * Same decision order as the rest of the Inventory UI (FE-UX-02 §2.1):
 * classify by the STABLE code, then by the backend's `details.code` business
 * subcode, then fall back to operation-specific copy. The backend `message`
 * is contract English and is never rendered.
 */

export type DocumentOperation =
  | 'load'
  | 'loadDetail'
  | 'create'
  | 'update'
  | 'delete'
  | 'finalize'
  | 'accountingPost'
  | 'seal'
  | 'cancel';

const OPERATION_FAILURE: Record<DocumentOperation, string> = {
  load: t.inventoryDocuments.loadFailed,
  loadDetail: t.inventoryDocuments.detailLoadFailed,
  create: t.inventory.errors.postFailed,
  update: t.inventory.errors.postFailed,
  delete: t.inventory.errors.postFailed,
  finalize: t.inventory.errors.postFailed,
  accountingPost: t.inventory.errors.postFailed,
  seal: t.inventory.errors.postFailed,
  cancel: t.inventory.errors.postFailed,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The `details.code` of a business-rule refusal, when the backend sent one. */
export function documentRefusalCode(error: unknown): string | null {
  const apiError = normalizeApiError(error);
  if (apiError.code !== 'BusinessRuleViolation') return null;
  if (!isRecord(apiError.details)) return null;
  const code = apiError.details['code'];
  return typeof code === 'string' ? code : null;
}

/**
 * `true` when the refusal is the edit pipeline asking for the two explicit
 * decisions (OD-54-05 acknowledgement, OD-VAL-11 repricing choice). The form
 * turns this into a dialog rather than an error banner: nothing was applied.
 */
export function isSideEffectRefusal(error: unknown): boolean {
  const code = documentRefusalCode(error);
  return (
    code === 'inventory.document.side_effect_acknowledgement_required' ||
    code === 'inventory.document.repricing_choice_required'
  );
}

/** The backdating refusal raised by finalize (OD-VAL-10). */
export function isDocumentBackdateRefusal(error: unknown): boolean {
  const code = documentRefusalCode(error);
  return (
    code === 'inventory.backdated_document' ||
    code === 'inventory.repricing_choice_required'
  );
}

const SUBCODE_MESSAGES: Record<string, string> = {
  'inventory.document.illegal_transition':
    t.inventoryDocuments.errors.illegalTransition,
  'inventory.document.accounting_posted_is_immutable':
    t.inventoryDocuments.errors.accountingPostedImmutable,
  'inventory.document.accounting_posted_requires_correction':
    t.inventoryDocuments.errors.accountingPostedImmutable,
  'inventory.document.cancelled_is_immutable':
    t.inventoryDocuments.errors.cancelledImmutable,
  'inventory.document.already_cancelled':
    t.inventoryDocuments.errors.alreadyCancelled,
  'inventory.document.delete_forbidden':
    t.inventoryDocuments.errors.deleteForbidden,
  'inventory.document.transfer_same_warehouse':
    t.inventoryDocuments.sameWarehouse,
  'inventory.document.manual_cost_forbidden': t.inventoryDocuments.issueNoCost,
  'inventory.document.cost_apportionment_unsupported':
    t.inventoryDocuments.costMultiLineDisabled,
  'inventory.document.receipt_cost_invalid': t.inventoryDocuments.costInvalid,
  'inventory.document.lines_required': t.inventoryDocuments.linesRequired,
  'inventory.document.line_quantity_invalid':
    t.inventoryDocuments.quantityPositive,
  'inventory.document.warehouse_required':
    t.inventoryDocuments.warehouseRequired,
  'inventory.document.transfer_warehouses_required':
    t.inventoryDocuments.sourceWarehouseRequired,
  'inventory.insufficient_stock': t.inventory.errors.insufficientStock,
  // A TRANSFER document's backdating refusal shares the code every document
  // uses (C-59C); the confirmation dialog normally handles it before this
  // map, and the copy below is the safe fallback for a transfer.
  'inventory.backdated_document':
    t.inventory.errors.backdatedTransferUnresolved,
};

export interface DocumentErrorMessage {
  message: string;
  correlationId?: string | undefined;
}

/** Map a document operation failure to its Persian UX message. */
export function documentErrorMessage(
  operation: DocumentOperation,
  error: unknown,
): DocumentErrorMessage {
  const apiError = normalizeApiError(error);
  const correlation =
    apiError.correlationId !== undefined
      ? { correlationId: apiError.correlationId }
      : {};

  switch (apiError.code) {
    case 'PermissionDenied':
      return { message: t.errors.forbidden };
    case 'EntityNotFound':
      // Org isolation answers 404 for another organization's document; the
      // UI says "not found" and discloses nothing further.
      return { message: t.inventoryDocuments.notFoundBody };
    case 'Conflict':
      return {
        message: t.inventory.errors.operationKeyConflict,
        ...correlation,
      };
    case 'BusinessRuleViolation': {
      const subcode = documentRefusalCode(error);
      const mapped = subcode === null ? undefined : SUBCODE_MESSAGES[subcode];
      return {
        message: mapped ?? t.inventory.errors.generic,
        ...correlation,
      };
    }
    default:
      return { message: OPERATION_FAILURE[operation], ...correlation };
  }
}
