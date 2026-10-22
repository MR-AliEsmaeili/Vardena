import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { normalizeApiError, type ApiError } from '@/api/errors';
import { t } from '@/lib/i18n';

/**
 * Operation-scoped error presentation for inventory master data
 * (FE-UX-02 §2, the inventory twin of the organization mapper).
 *
 * Decision order, implemented exactly:
 * 1. classify by the STABLE ERROR CODE of the normalized envelope — never by
 *    searching the backend `message` (which is never user copy);
 * 2. pick the Persian copy for that code in the context of THIS resource and
 *    THIS operation;
 * 3. fall back to the safe operation-scoped failure copy.
 *
 * The inventory master-data services raise business-rule and conflict
 * failures without a `details` payload, so — like the organization mapper —
 * the only honest mapping is resource + operation scoped copy. Nothing here
 * parses message text and no sub-case is invented.
 */

export type MasterDataResource =
  'item' | 'warehouse' | 'unit' | 'itemGroup' | 'unitConversion';

export type MasterDataOperation =
  'load' | 'create' | 'update' | 'enable' | 'disable';

export interface MasterDataErrorMessage {
  message: string;
  /** Support correlation id — never the reason for the failure. */
  correlationId?: string | undefined;
}

const OPERATION_FAILURE: Record<MasterDataOperation, string> = {
  load: t.inventoryMaster.errors.loadFailed,
  create: t.inventoryMaster.errors.createFailed,
  update: t.inventoryMaster.errors.updateFailed,
  enable: t.inventoryMaster.errors.enableFailed,
  disable: t.inventoryMaster.errors.disableFailed,
};

/**
 * The 422 the backend can raise for a WRITE on each resource, in the words
 * of the rule the service enforces (the inventory module's own validators):
 * - item: a valued item must be stockable; lot/serial/expiry require a
 *   stockable item; the base unit and group must belong to the organization;
 * - warehouse: the branch must be an enabled branch of the same organization;
 * - item group: the parent must exist in the organization and not create a
 *   cycle.
 */
const BUSINESS_RULE_COPY: Record<MasterDataResource, string> = {
  item: t.inventoryMaster.errors.businessRule,
  warehouse: t.inventoryMaster.errors.businessRule,
  unit: t.inventoryMaster.errors.businessRule,
  itemGroup: t.inventoryMaster.errors.businessRule,
  unitConversion: t.inventoryMaster.errors.businessRule,
};

export function masterDataErrorMessage(
  resource: MasterDataResource,
  operation: MasterDataOperation,
  error: unknown,
): MasterDataErrorMessage {
  const apiError: ApiError = normalizeApiError(error);
  const correlation =
    apiError.correlationId !== undefined
      ? { correlationId: apiError.correlationId }
      : {};

  switch (apiError.code) {
    case 'PermissionDenied':
      return { message: t.inventoryMaster.errors.forbidden };
    case 'EntityNotFound':
      // Also the answer for a record of another organization: the backend
      // reports out-of-scope as 404, never 403.
      return { message: t.inventoryMaster.errors.notFound };
    case 'Conflict':
      return {
        message:
          operation === 'create' || operation === 'update'
            ? t.inventoryMaster.duplicateCode
            : t.inventoryMaster.errors.conflict,
        ...correlation,
      };
    case 'BusinessRuleViolation':
      return {
        message:
          operation === 'enable' || operation === 'disable'
            ? t.inventoryMaster.errors.businessRule
            : BUSINESS_RULE_COPY[resource],
        ...correlation,
      };
    case 'ValidationFailed':
    case 'BadRequest':
      return {
        message: t.inventoryMaster.serverValidationSummary,
        ...correlation,
      };
    default:
      return { message: OPERATION_FAILURE[operation], ...correlation };
  }
}

// ---------------------------------------------------------------------------
// Server validation → form fields (FE-UX-02 §4.3)
// ---------------------------------------------------------------------------

/** The backend's stable `ValidationIssue { field, message, code }` shape. */
interface ServerValidationIssue {
  field: string;
  message: string;
  code: string;
}

function isValidationIssue(value: unknown): value is ServerValidationIssue {
  if (typeof value !== 'object' || value === null) return false;
  const issue = value as Record<string, unknown>;
  return (
    typeof issue['field'] === 'string' &&
    typeof issue['message'] === 'string' &&
    typeof issue['code'] === 'string'
  );
}

/**
 * Dictionary copy for one rejected DTO field. The backend `message` is never
 * rendered; only the field name and the class-validator constraint `code`
 * select the Persian text.
 */
function fieldMessage(field: string, code: string): string | undefined {
  const tooLong = code === 'maxLength';
  switch (field) {
    case 'code':
      return tooLong
        ? t.inventoryMaster.codeTooLong
        : t.inventoryMaster.codeRequired;
    case 'name':
      return tooLong
        ? t.inventoryMaster.nameTooLong
        : t.inventoryMaster.nameRequired;
    case 'symbol':
      return t.inventoryMaster.unitSymbolTooLong;
    case 'barcode':
      return t.inventoryMaster.barcodeTooLong;
    case 'description':
      return undefined;
    case 'itemKind':
      return t.inventoryMaster.itemKindRequired;
    case 'baseUnitId':
      return t.inventoryMaster.baseUnitRequired;
    case 'branchId':
      return t.inventoryMaster.branchRequired;
    case 'fromUnitId':
      return t.inventoryMaster.fromUnitRequired;
    case 'toUnitId':
      return t.inventoryMaster.toUnitRequired;
    case 'factor':
      return t.inventoryMaster.factorInvalid;
    case 'validFrom':
    case 'validTo':
      return t.filters.invalidDate;
    default:
      // `organizationId`, `itemId`, `parentId` and anything unknown are not
      // guessed onto a control: they surface in the form summary instead.
      return undefined;
  }
}

export interface ServerValidationResult {
  /** True when at least one issue landed on a form control. */
  mappedToFields: boolean;
  /** Persian summary for the form banner (always present). */
  summary: string;
}

/**
 * Apply a server `ValidationFailed` / `BadRequest` to a form: allow-listed
 * field names get an inline error, everything else only feeds the summary.
 * Returns `null` when the failure is not a validation failure, so the caller
 * can fall back to `masterDataErrorMessage`.
 */
export function applyServerValidation<TValues extends FieldValues>(
  error: unknown,
  form: UseFormReturn<TValues>,
  knownFields: readonly string[],
): ServerValidationResult | null {
  const apiError = normalizeApiError(error);
  if (apiError.code !== 'ValidationFailed' && apiError.code !== 'BadRequest') {
    return null;
  }

  const issues = Array.isArray(apiError.details)
    ? apiError.details.filter(isValidationIssue)
    : [];

  let mappedToFields = false;
  for (const issue of issues) {
    if (!knownFields.includes(issue.field)) continue;
    const message = fieldMessage(issue.field, issue.code);
    if (message === undefined) continue;
    // The allow-list above guarantees the name is a field of this form; RHF
    // cannot infer that from a `string`, hence the narrow assertion.
    form.setError(issue.field as Path<TValues>, { type: 'server', message });
    mappedToFields = true;
  }

  return { mappedToFields, summary: t.inventoryMaster.serverValidationSummary };
}
