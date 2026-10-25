import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import { documentErrorMessage } from './document-error-messages';

/**
 * Numbering prerequisite mapping: a balanced voucher in a fresh
 * organization is refused by the Document Foundation when no numbering
 * series is configured (§18). The backend now carries the stable
 * `details.problem` discriminator, and the operator must see THAT cause —
 * never the generic business copy that previously hid it.
 */
describe('documentErrorMessage — numbering series prerequisite', () => {
  it('maps numbering_series_missing to the precise Persian guidance on create', () => {
    const error = new ApiError({
      code: 'BusinessRuleViolation',
      status: 422,
      message: 'No numbering series is configured…',
      details: {
        problem: 'numbering_series_missing',
        documentType: 'accounting_voucher',
        scopeKey: '01area',
      },
    });
    expect(documentErrorMessage('create', error).message).toBe(
      t.documents.business.numberingSeriesMissing,
    );
  });

  it('maps numbering_series_disabled distinctly (also on issue)', () => {
    const error = new ApiError({
      code: 'BusinessRuleViolation',
      status: 422,
      message: 'The numbering series … is disabled.',
      details: { problem: 'numbering_series_disabled' },
    });
    expect(documentErrorMessage('issue', error).message).toBe(
      t.documents.business.numberingSeriesDisabled,
    );
  });

  it('keeps the generic fallback for an UNLISTED problem (no message-text guessing)', () => {
    const error = new ApiError({
      code: 'BusinessRuleViolation',
      status: 422,
      message: 'No numbering series is configured…',
      details: { problem: 'some_future_problem' },
    });
    expect(documentErrorMessage('create', error).message).toBe(
      t.documents.business.generic,
    );
  });
});
