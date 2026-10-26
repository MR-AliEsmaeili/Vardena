import { describe, expect, it } from 'vitest';
import { ApiError, type ApiErrorCode } from '@/api/errors';
import { t } from '@/lib/i18n';
import { configurationErrorMessage } from './configuration-error-messages';

function apiError(code: ApiErrorCode): ApiError {
  return new ApiError({ code, message: 'server text is never user copy' });
}

describe('configurationErrorMessage', () => {
  it('maps the kernel codes that carry their own meaning', () => {
    expect(configurationErrorMessage('load', apiError('EntityNotFound'))).toBe(
      t.errors.notFound,
    );
    expect(
      configurationErrorMessage('save', apiError('PermissionDenied')),
    ).toBe(t.errors.forbidden);
    expect(configurationErrorMessage('save', apiError('Conflict'))).toBe(
      t.accountingConfig.errorCodes.versionConflict,
    );
    expect(
      configurationErrorMessage('save', apiError('ValidationFailed')),
    ).toBe(t.accountingConfig.errorCodes.validation);
  });

  it('disambiguates BusinessRuleViolation by the failed operation', () => {
    // The backend uses ONE code for "only a DRAFT can change/publish" and for
    // "this version was used operationally"; the operation names which rule.
    expect(
      configurationErrorMessage('publish', apiError('BusinessRuleViolation')),
    ).toBe(t.accountingConfig.errorCodes.notDraft);
    expect(
      configurationErrorMessage('save', apiError('BusinessRuleViolation')),
    ).toBe(t.accountingConfig.errorCodes.notDraft);
    expect(
      configurationErrorMessage('delete', apiError('BusinessRuleViolation')),
    ).toBe(t.accountingConfig.errorCodes.deleteRefused);
  });

  it('falls back to the operation-specific message and never to server text', () => {
    const error = new Error('AccountingConfiguration PK violation');
    expect(configurationErrorMessage('load', error)).toBe(
      t.accountingConfig.loadFailed,
    );
    expect(configurationErrorMessage('save', error)).toBe(
      t.accountingConfig.saveFailed,
    );
    expect(configurationErrorMessage('publish', error)).toBe(
      t.accountingConfig.publishFailed,
    );
    expect(configurationErrorMessage('delete', error)).toBe(
      t.accountingConfig.deleteFailed,
    );
  });
});
