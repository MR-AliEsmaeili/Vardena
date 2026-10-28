import { describe, expect, it } from 'vitest';
import { ApiError, type ApiErrorCode } from '@/api/errors';
import { t } from '@/lib/i18n';
import {
  numberingAllocationErrorMessage,
  numberingSeriesErrorMessage,
} from './numbering-series-error-messages';

function apiError(code: ApiErrorCode): ApiError {
  return new ApiError({ code, message: 'server text is never user copy' });
}

describe('numberingSeriesErrorMessage (DOC-02)', () => {
  it('maps PermissionDenied and EntityNotFound correctly', () => {
    expect(numberingSeriesErrorMessage('load', apiError('PermissionDenied'))).toBe(
      t.errors.forbidden,
    );
    expect(numberingSeriesErrorMessage('load', apiError('EntityNotFound'))).toBe(
      t.numberingSeries.errorCodes.notFound,
    );
    expect(numberingSeriesErrorMessage('save', apiError('EntityNotFound'))).toBe(
      t.numberingSeries.errorCodes.unknownDocumentType,
    );
  });

  it('maps Conflict to duplicateSeries regardless of operation', () => {
    expect(numberingSeriesErrorMessage('load', apiError('Conflict'))).toBe(
      t.numberingSeries.errorCodes.duplicateSeries,
    );
    expect(numberingSeriesErrorMessage('save', apiError('Conflict'))).toBe(
      t.numberingSeries.errorCodes.duplicateSeries,
    );
  });

  it('maps validation codes to validationFailed', () => {
    expect(
      numberingSeriesErrorMessage('save', apiError('ValidationFailed')),
    ).toBe(t.numberingSeries.errorCodes.validationFailed);
    expect(numberingSeriesErrorMessage('save', apiError('BadRequest'))).toBe(
      t.numberingSeries.errorCodes.validationFailed,
    );
  });

  it('falls back to operation-specific copy and never to server message', () => {
    const generic = new Error('some unexpected failure without code');
    expect(numberingSeriesErrorMessage('load', generic)).toBe(
      t.numberingSeries.loadFailed,
    );
    expect(numberingSeriesErrorMessage('save', generic)).toBe(
      t.numberingSeries.saveFailed,
    );
  });
});

describe('numberingAllocationErrorMessage', () => {
  it('maps codes for the read-only ledger', () => {
    expect(numberingAllocationErrorMessage(apiError('PermissionDenied'))).toBe(
      t.errors.forbidden,
    );
    expect(numberingAllocationErrorMessage(apiError('EntityNotFound'))).toBe(
      t.numberingSeries.errorCodes.notFound,
    );
    expect(
      numberingAllocationErrorMessage(new Error('generic')),
    ).toBe(t.numberingSeries.allocationsLoadFailed);
  });
});
