import { normalizeApiError } from '@/api/errors';
import { t } from '@/lib/i18n';

/**
 * Domain copy for document-type reads and configuration (DOC-01).
 *
 * The backend raises the kernel envelope codes, not a document-type-specific
 * family: `EntityNotFound` (404) for an unregistered code,
 * `BusinessRuleViolation` (422) when `draftRequired: true` is requested for a
 * non-`draftCapable` type, `ValidationFailed`/`BadRequest` (400) for a malformed
 * body and `PermissionDenied` (403) for a missing exact code. Messages are
 * mapped by the STABLE code plus the failed operation — never by the raw
 * backend `message` text, which includes the type code and may change.
 */

export type DocumentTypeOperation = 'load' | 'save';

export function documentTypeErrorMessage(
  operation: DocumentTypeOperation,
  error: unknown,
): string {
  const apiError = normalizeApiError(error);

  if (apiError.code === 'PermissionDenied') return t.errors.forbidden;
  if (apiError.code === 'EntityNotFound') {
    return t.documentTypes.errors.notFound;
  }
  if (apiError.code === 'ValidationFailed' || apiError.code === 'BadRequest') {
    return t.documentTypes.errors.validation;
  }
  if (apiError.code === 'BusinessRuleViolation' && operation === 'save') {
    return t.documentTypes.errors.draftNotSupported;
  }
  return operation === 'save'
    ? t.documentTypes.saveFailed
    : t.documentTypes.loadFailed;
}
