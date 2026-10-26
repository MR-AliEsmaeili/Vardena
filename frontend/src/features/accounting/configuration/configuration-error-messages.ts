import { normalizeApiError } from '@/api/errors';
import { t } from '@/lib/i18n';

/**
 * Domain copy for the accounting-configuration surfaces (ACC-06).
 *
 * The backend raises NO `accounting.configuration.*` code family: it answers
 * `BusinessRuleViolation` (422) for "only a DRAFT can be changed / published /
 * deleted" and "already used operationally", `Conflict` (409) for a
 * concurrently created version ordinal, and the kernel's generic codes
 * otherwise. Messages are therefore mapped by the STABLE code (never by the
 * raw message text) plus the operation that failed.
 */
export type ConfigurationOperation = 'load' | 'save' | 'publish' | 'delete';

function rawErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

export function configurationErrorMessage(
  operation: ConfigurationOperation,
  error: unknown,
): string {
  const apiError = normalizeApiError(error);
  const code = rawErrorCode(error) ?? apiError.code;

  if (apiError.code === 'PermissionDenied') return t.errors.forbidden;
  if (apiError.code === 'EntityNotFound') return t.errors.notFound;
  if (apiError.code === 'Conflict') {
    return t.accountingConfig.errorCodes.versionConflict;
  }
  if (apiError.code === 'ValidationFailed' || apiError.code === 'BadRequest') {
    return t.accountingConfig.errorCodes.validation;
  }
  if (
    apiError.code === 'BusinessRuleViolation' ||
    code === 'BusinessRuleViolation'
  ) {
    if (operation === 'publish') return t.accountingConfig.errorCodes.notDraft;
    if (operation === 'delete')
      return t.accountingConfig.errorCodes.deleteRefused;
    if (operation === 'save') return t.accountingConfig.errorCodes.notDraft;
  }
  if (operation === 'save') return t.accountingConfig.saveFailed;
  if (operation === 'publish') return t.accountingConfig.publishFailed;
  if (operation === 'delete') return t.accountingConfig.deleteFailed;
  return t.accountingConfig.loadFailed;
}
