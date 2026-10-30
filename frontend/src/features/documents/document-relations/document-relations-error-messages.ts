import { normalizeApiError } from '@/api/errors';
import { t } from '@/lib/i18n';

/**
 * Domain copy for document relations (DOC-03).
 *
 * Backend raises only kernel codes plus stable business messages:
 * - `ValidationFailed`/`BadRequest` (400) — invalid ULID, module/type too long,
 *   blank quantity, invalid relationKind;
 * - `UnprocessableEntity` (422) — `self_link_not_allowed`,
 *   `quantity_required_for_fulfill`, `quantity_forbidden`,
 *   `invalid_quantity`;
 * - `EntityNotFound` (404) — unknown relation id;
 * - `PermissionDenied` (403).
 *
 * Copy branches on normalized `code` and the caller operation, never on raw
 * message, except for the 422 business rule where the backend message is
 * stable and documented in the task spec.
 */
export type DocumentRelationOperation = 'load' | 'create' | 'delete';

function business422Message(error: unknown): string | null {
  const apiError = normalizeApiError(error);
  if (apiError.code !== 'BusinessRuleViolation' && apiError.status !== 422) return null;
  const details = apiError.details as { message?: string } | undefined;
  const msg = details?.message ?? apiError.message ?? '';
  // Backend messages are human sentences; match stable fragments
  if (msg.includes('A document cannot be linked to itself') || msg.includes('self_link_not_allowed'))
    return t.documentRelations.errors.selfLinkNotAllowed;
  if (msg.includes('requires a positive base-unit quantity') || msg.includes('quantity_required_for_fulfill'))
    return t.documentRelations.errors.quantityRequiredForFulfill;
  if (msg.includes('Only the \"fulfill\"') || msg.includes('quantity_forbidden'))
    return t.documentRelations.errors.quantityForbidden;
  if (msg.includes('must be a positive decimal') || msg.includes('invalid_quantity'))
    return t.documentRelations.errors.invalidQuantity;
  return t.errors.businessRule;
}

export function documentRelationErrorMessage(
  operation: DocumentRelationOperation,
  error: unknown,
): string {
  const apiError = normalizeApiError(error);

  if (apiError.code === 'PermissionDenied') return t.errors.forbidden;
  if (apiError.code === 'EntityNotFound') return t.documentRelations.errors.notFound;

  const business = business422Message(error);
  if (business) return business;

  if (apiError.code === 'ValidationFailed' || apiError.code === 'BadRequest') {
    return t.documentRelations.errors.validationFailed;
  }

  if (operation === 'create') return t.documentRelations.createFailed;
  if (operation === 'delete') return t.documentRelations.deleteFailed;
  return t.documentRelations.loadFailed;
}

export function documentRelationListErrorMessage(error: unknown): string {
  const apiError = normalizeApiError(error);
  if (apiError.code === 'PermissionDenied') return t.errors.forbidden;
  return t.documentRelations.loadFailed;
}
