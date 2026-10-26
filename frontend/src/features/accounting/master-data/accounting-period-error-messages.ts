import { normalizeApiError } from '@/api/errors';
import { t } from '@/lib/i18n';

/** The backend uses kernel error codes, not an `accounting.period.*` family. */
export function accountingPeriodErrorMessage(error: unknown): string {
  switch (normalizeApiError(error).code) {
    case 'PermissionDenied':
      return t.errors.forbidden;
    case 'EntityNotFound':
      return t.errors.notFound;
    case 'Conflict':
      return t.accountingPeriod.conflict;
    case 'BusinessRuleViolation':
      return t.accountingPeriod.businessRule;
    case 'ValidationFailed':
    case 'BadRequest':
      return t.errors.validation;
    default:
      return t.accountingPeriod.transitionFailed;
  }
}
