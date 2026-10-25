import type { UseFormReturn } from 'react-hook-form';
import { normalizeApiError, type ApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import type { FinancialAreaFormValues } from './financial-area-schema';

/**
 * Operation-scoped error presentation for financial-area administration
 * (ACC-01), following the same decision order as
 * `organization/admin/admin-error-messages.ts` and
 * `documents/document-error-messages.ts`:
 *
 * 1. classify by the STABLE ERROR CODE of the normalized envelope — never by
 *    searching the backend `message` (which is never user copy);
 * 2. use the one documented structured detail the service emits
 *    (`details.openFiscalYearId` on the disable business rule) to pick the
 *    precise copy;
 * 3. fall back to the safe operation-scoped failure copy.
 *
 * Contract note: the backend raises these failures through
 * `AppException.conflict(...)` (duplicate code, 409) and
 * `AppException.businessRule(...)` (open fiscal year on disable, 422) with
 * the generic kernel codes `Conflict` / `BusinessRuleViolation`. There is
 * no `accounting.financial_area.*` code family in the backend contract, so
 * nothing here branches on such a code — inventing one would map nothing.
 */

export type FinancialAreaOperation =
  'load' | 'create' | 'update' | 'enable' | 'disable' | 'setDefault';

export interface FinancialAreaErrorMessage {
  message: string;
  /** Support correlation id — never the reason for the failure. */
  correlationId?: string | undefined;
}

const OPERATION_FAILURE: Record<FinancialAreaOperation, string> = {
  load: t.financialArea.loadFailed,
  create: t.financialArea.saveFailed,
  update: t.financialArea.saveFailed,
  enable: t.financialArea.errorCodes.enableFailed,
  disable: t.financialArea.errorCodes.disableFailed,
  setDefault: t.financialArea.errorCodes.setDefaultFailed,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function financialAreaErrorMessage(
  operation: FinancialAreaOperation,
  error: unknown,
): FinancialAreaErrorMessage {
  const apiError: ApiError = normalizeApiError(error);
  const correlation =
    apiError.correlationId !== undefined
      ? { correlationId: apiError.correlationId }
      : {};

  switch (apiError.code) {
    case 'PermissionDenied':
      return { message: t.errors.forbidden };
    case 'EntityNotFound':
      // Also the answer for an area of another organization: the backend
      // reports out-of-scope as 404, never 403.
      return { message: t.errors.notFound };
    case 'Conflict':
      // The only 409 the service raises on create/update is the duplicate
      // business code; lifecycle/set-default conflicts keep the generic
      // conflict copy rather than guessing a sub-case.
      return {
        message:
          operation === 'create' || operation === 'update'
            ? t.financialArea.errorCodes.duplicateCode
            : t.errors.conflict,
        ...correlation,
      };
    case 'BusinessRuleViolation': {
      const details = apiError.details;
      const hasOpenFiscalYear =
        isRecord(details) && typeof details['openFiscalYearId'] === 'string';
      return {
        message: hasOpenFiscalYear
          ? t.financialArea.errorCodes.hasOpenFiscalYear
          : t.financialArea.errorCodes.businessRule,
        ...correlation,
      };
    }
    case 'ValidationFailed':
    case 'BadRequest':
      return {
        message: t.financialArea.errorCodes.validationSummary,
        ...correlation,
      };
    default:
      return { message: OPERATION_FAILURE[operation], ...correlation };
  }
}

// ---------------------------------------------------------------------------
// Server validation → form fields
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
        ? t.financialArea.codeTooLong
        : t.financialArea.codeRequired;
    case 'title':
      return tooLong
        ? t.financialArea.titleTooLong
        : t.financialArea.titleRequired;
    default:
      // `organizationId` and anything unknown are not guessed onto a control:
      // they surface in the form summary instead.
      return undefined;
  }
}

export interface FinancialAreaServerValidationResult {
  /** True when at least one issue landed on a form control. */
  mappedToFields: boolean;
  /** Persian summary for the form banner (always present). */
  summary: string;
}

/**
 * Apply a server `ValidationFailed` / `BadRequest` to the form: the two
 * allow-listed fields get an inline error, everything else only feeds the
 * summary. Returns `null` when the failure is not a validation failure, so
 * the caller can fall back to `financialAreaErrorMessage`.
 */
export function applyFinancialAreaServerValidation(
  error: unknown,
  form: UseFormReturn<FinancialAreaFormValues>,
): FinancialAreaServerValidationResult | null {
  const apiError = normalizeApiError(error);
  if (apiError.code !== 'ValidationFailed' && apiError.code !== 'BadRequest') {
    return null;
  }

  const issues = Array.isArray(apiError.details)
    ? apiError.details.filter(isValidationIssue)
    : [];

  let mappedToFields = false;
  for (const issue of issues) {
    if (issue.field !== 'code' && issue.field !== 'title') continue;
    const message = fieldMessage(issue.field, issue.code);
    if (message === undefined) continue;
    form.setError(issue.field, { type: 'server', message });
    mappedToFields = true;
  }

  return {
    mappedToFields,
    summary: t.financialArea.errorCodes.validationSummary,
  };
}
