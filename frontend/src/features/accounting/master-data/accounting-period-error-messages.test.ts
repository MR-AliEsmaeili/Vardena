import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import { accountingPeriodErrorMessage } from './accounting-period-error-messages';

function failure(
  code: 'Conflict' | 'BusinessRuleViolation' | 'PermissionDenied',
) {
  return new ApiError({ code, message: 'Internal server detail' });
}

describe('accounting period errors', () => {
  it('maps only actual kernel codes, never the raw server message', () => {
    expect(accountingPeriodErrorMessage(failure('Conflict'))).toBe(
      t.accountingPeriod.conflict,
    );
    expect(accountingPeriodErrorMessage(failure('BusinessRuleViolation'))).toBe(
      t.accountingPeriod.businessRule,
    );
    expect(accountingPeriodErrorMessage(failure('PermissionDenied'))).toBe(
      t.errors.forbidden,
    );
  });
});
