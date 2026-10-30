import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import { documentRelationErrorMessage } from './document-relations-error-messages';

describe('documentRelationErrorMessage', () => {
  it('maps PermissionDenied to forbidden', () => {
    const err = new ApiError({ code: 'PermissionDenied', message: 'denied' });
    expect(documentRelationErrorMessage('load', err)).toBe(t.errors.forbidden);
  });

  it('maps EntityNotFound to notFound', () => {
    const err = new ApiError({ code: 'EntityNotFound', message: 'not found' });
    expect(documentRelationErrorMessage('load', err)).toBe(t.documentRelations.errors.notFound);
  });

  it('maps 422 self_link_not_allowed to Persian copy', () => {
    const err = new ApiError({
      code: 'UnprocessableEntity',
      message: 'self_link_not_allowed',
      status: 422,
      details: { message: 'self_link_not_allowed' },
    });
    expect(documentRelationErrorMessage('create', err)).toBe(t.documentRelations.errors.selfLinkNotAllowed);
  });

  it('maps 422 quantity_required_for_fulfill', () => {
    const err = new ApiError({
      code: 'UnprocessableEntity',
      message: 'quantity_required_for_fulfill',
      status: 422,
      details: { message: 'quantity_required_for_fulfill' },
    });
    expect(documentRelationErrorMessage('create', err)).toBe(t.documentRelations.errors.quantityRequiredForFulfill);
  });

  it('maps 422 quantity_forbidden', () => {
    const err = new ApiError({
      code: 'UnprocessableEntity',
      message: 'quantity_forbidden',
      status: 422,
      details: { message: 'quantity_forbidden' },
    });
    expect(documentRelationErrorMessage('create', err)).toBe(t.documentRelations.errors.quantityForbidden);
  });

  it('maps ValidationFailed to validationFailed', () => {
    const err = new ApiError({ code: 'ValidationFailed', message: 'bad' });
    expect(documentRelationErrorMessage('create', err)).toBe(t.documentRelations.errors.validationFailed);
  });

  it('falls back to createFailed for unknown create error', () => {
    const err = new ApiError({ code: 'InternalError', message: 'boom' });
    expect(documentRelationErrorMessage('create', err)).toBe(t.documentRelations.createFailed);
  });

  it('falls back to deleteFailed for unknown delete error', () => {
    const err = new ApiError({ code: 'InternalError', message: 'boom' });
    expect(documentRelationErrorMessage('delete', err)).toBe(t.documentRelations.deleteFailed);
  });
});
