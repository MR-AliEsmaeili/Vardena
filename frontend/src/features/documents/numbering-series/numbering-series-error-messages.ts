import { normalizeApiError } from '@/api/errors';
import { t } from '@/lib/i18n';

/**
 * Domain copy for numbering-series administration (DOC-02).
 *
 * The backend raises only kernel codes:
 * - `ValidationFailed`/`BadRequest` (400) for malformed or blank `name`,
 *   out-of-range `width`, unknown `strategy`/`reusePolicy` or `scopeKey` too
 *   long;
 * - `Conflict` (409) for the unique `(organizationId, documentType, scopeKey)`
 *   triple — `isActive` does NOT participate;
 * - `EntityNotFound` (404) for an unknown `documentType` code or a foreign
 *   `seriesId`;
 * - `PermissionDenied` (403) for a missing exact permission.
 *
 * There is no domain-specific `document.numbering.*` code family — only the
 * kernel codes above — so this mapper branches on the normalized `code` and
 * the caller-supplied `operation`, never on the raw `message` text.
 */
export type NumberingSeriesOperation = 'load' | 'save';

export function numberingSeriesErrorMessage(
  operation: NumberingSeriesOperation,
  error: unknown,
): string {
  const apiError = normalizeApiError(error);

  if (apiError.code === 'PermissionDenied') return t.errors.forbidden;
  if (apiError.code === 'EntityNotFound') {
    // Create with an unregistered documentType also answers 404; the detail
    // copy is the same — the domain note explains the registry source.
    return operation === 'save'
      ? t.numberingSeries.errorCodes.unknownDocumentType
      : t.numberingSeries.errorCodes.notFound;
  }
  if (apiError.code === 'Conflict') {
    return t.numberingSeries.errorCodes.duplicateSeries;
  }
  if (apiError.code === 'ValidationFailed' || apiError.code === 'BadRequest') {
    return t.numberingSeries.errorCodes.validationFailed;
  }
  return operation === 'save'
    ? t.numberingSeries.saveFailed
    : t.numberingSeries.loadFailed;
}

export function numberingAllocationErrorMessage(error: unknown): string {
  const apiError = normalizeApiError(error);
  if (apiError.code === 'PermissionDenied') return t.errors.forbidden;
  if (apiError.code === 'EntityNotFound')
    return t.numberingSeries.errorCodes.notFound;
  return t.numberingSeries.allocationsLoadFailed;
}
