import { describe, expect, it } from 'vitest';
import { ApiError, type ApiFailureCode } from '@/api/errors';
import { t } from '@/lib/i18n';
import { documentTypeErrorMessage } from './document-type-error-messages';
import {
  documentTypePhaseLabel,
  documentTypePhasesLabel,
  documentTypeStateLabel,
  documentTypeStatesLabel,
} from './document-type-labels';

/** Pure registry-metadata mapping: no invented enum member, no raw error text. */
describe('document-type labels', () => {
  it('maps the backend states and phases to dictionary copy', () => {
    expect(documentTypeStateLabel('temporary')).toBe(
      t.documentTypes.stateNames.temporary,
    );
    expect(documentTypeStateLabel('final')).toBe(
      t.documentTypes.stateNames.final,
    );
    expect(documentTypePhaseLabel('draft')).toBe(
      t.documentTypes.phaseNames.draft,
    );
    expect(documentTypeStatesLabel(['temporary', 'final'])).toBe(
      `${t.documentTypes.stateNames.temporary}${t.documentTypes.listSeparator}${t.documentTypes.stateNames.final}`,
    );
    expect(documentTypePhasesLabel(['draft', 'final'])).toBe(
      `${t.documentTypes.phaseNames.draft}${t.documentTypes.listSeparator}${t.documentTypes.phaseNames.final}`,
    );
  });

  it('keeps empty lists explicit and unknown server values visible', () => {
    expect(documentTypeStatesLabel([])).toBe(t.app.none);
    expect(documentTypePhasesLabel([])).toBe(t.app.none);
    expect(documentTypeStateLabel('archived')).toBe('archived');
    expect(documentTypePhaseLabel('archived')).toBe('archived');
  });
});

describe('document-type error mapping', () => {
  const error = (code: ApiFailureCode) =>
    new ApiError({ code, message: 'raw backend text' });

  it('uses the stable code plus the failed operation', () => {
    expect(documentTypeErrorMessage('load', error('EntityNotFound'))).toBe(
      t.documentTypes.errors.notFound,
    );
    expect(
      documentTypeErrorMessage('save', error('BusinessRuleViolation')),
    ).toBe(t.documentTypes.errors.draftNotSupported);
    expect(
      documentTypeErrorMessage('load', error('BusinessRuleViolation')),
    ).toBe(t.documentTypes.loadFailed);
    expect(documentTypeErrorMessage('save', error('ValidationFailed'))).toBe(
      t.documentTypes.errors.validation,
    );
    expect(documentTypeErrorMessage('save', error('PermissionDenied'))).toBe(
      t.errors.forbidden,
    );
    expect(documentTypeErrorMessage('load', error('InternalError'))).toBe(
      t.documentTypes.loadFailed,
    );
    expect(documentTypeErrorMessage('save', error('InternalError'))).toBe(
      t.documentTypes.saveFailed,
    );
  });

  it('never surfaces the raw backend message', () => {
    const mapped = documentTypeErrorMessage(
      'save',
      new ApiError({
        code: 'BusinessRuleViolation',
        message: 'Document type "x" does not support the draft phase.',
      }),
    );
    expect(mapped).not.toContain('does not support');
    expect(mapped).toBe(t.documentTypes.errors.draftNotSupported);
  });
});
