import { normalizeApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import type { FiscalYearTransitionAction } from '@/api/accounting.api';

export type FiscalYearOperation = 'load' | 'save' | FiscalYearTransitionAction;

function rawErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

/** Uses stable API codes/details only; backend messages are never user copy. */
export function fiscalYearErrorMessage(
  operation: FiscalYearOperation,
  error: unknown,
): string {
  const apiError = normalizeApiError(error);
  const code = rawErrorCode(error) ?? apiError.code;

  if (code === 'accounting.fiscal_year.invalid_transition') {
    return t.fiscalYear.errorCodes.invalidTransition;
  }
  if (
    code === 'accounting.fiscal_year.open_periods' ||
    (apiError.code === 'BusinessRuleViolation' &&
      operation === 'seal' &&
      typeof apiError.details === 'object' &&
      apiError.details !== null &&
      'openAccountingPeriodId' in apiError.details)
  ) {
    return t.fiscalYear.errorCodes.openPeriods;
  }
  if (apiError.code === 'PermissionDenied') return t.errors.forbidden;
  if (apiError.code === 'EntityNotFound') return t.errors.notFound;
  if (apiError.code === 'Conflict') {
    return operation === 'save'
      ? t.fiscalYear.errorCodes.duplicateCode
      : t.fiscalYear.errorCodes.conflict;
  }
  if (
    apiError.code === 'BusinessRuleViolation' &&
    (operation === 'close' ||
      operation === 'reopen' ||
      operation === 'seal' ||
      operation === 'unseal')
  ) {
    return t.fiscalYear.errorCodes.invalidTransition;
  }
  if (apiError.code === 'ValidationFailed' || apiError.code === 'BadRequest') {
    return t.fiscalYear.errorCodes.validation;
  }
  return operation === 'load'
    ? t.fiscalYear.loadFailed
    : operation === 'save'
      ? t.fiscalYear.saveFailed
      : t.fiscalYear.transitionFailed;
}
