import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import { fiscalYearErrorMessage } from './fiscal-year-error-messages';

describe('fiscalYearErrorMessage', () => {
  it('maps invalid-transition domain errors without exposing server text', () => {
    const error = new ApiError({
      code: 'BusinessRuleViolation',
      status: 422,
      message: 'internal backend detail',
    });
    expect(fiscalYearErrorMessage('close', error)).toBe(
      t.fiscalYear.errorCodes.invalidTransition,
    );
    expect(fiscalYearErrorMessage('close', error)).not.toContain(
      'internal backend detail',
    );
  });

  it('maps an open-period seal rejection to its actionable message', () => {
    const error = new ApiError({
      code: 'BusinessRuleViolation',
      status: 422,
      message: 'internal backend detail',
      details: { openAccountingPeriodId: 'period-id' },
    });
    expect(fiscalYearErrorMessage('seal', error)).toBe(
      t.fiscalYear.errorCodes.openPeriods,
    );
  });

  it('supports the documented accounting fiscal-year error-code family', () => {
    expect(
      fiscalYearErrorMessage('close', {
        code: 'accounting.fiscal_year.invalid_transition',
      }),
    ).toBe(t.fiscalYear.errorCodes.invalidTransition);
  });
});
