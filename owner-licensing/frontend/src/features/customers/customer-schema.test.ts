import { describe, it, expect } from 'vitest';
import { customerSchema } from './customer-schema';
import { safeReturnPath } from '@/features/auth/login-page';
describe('Owner customer form contract', () => {
  const valid = {
    customerCode: 'a.b_C:9-',
    displayName: 'نام',
    status: 'ACTIVE',
    contractReference: '',
    reason: '',
  };
  it('preserves code case and validates the approved PDR-14 grammar', () => {
    expect(customerSchema.parse(valid).customerCode).toBe(valid.customerCode);
    for (const customerCode of ['bad code', 'a', ' ab', 'نام'])
      expect(customerSchema.safeParse({ ...valid, customerCode }).success).toBe(
        false,
      );
  });
  it('rejects blank and overlong display names', () => {
    for (const displayName of ['  ', 'a'.repeat(201)])
      expect(customerSchema.safeParse({ ...valid, displayName }).success).toBe(
        false,
      );
  });
  it('rejects cross-origin redirect destinations', () => {
    expect(safeReturnPath('//evil.test')).toBe('/app');
    expect(safeReturnPath('https://evil.test')).toBe('/app');
    expect(safeReturnPath('/app/customers')).toBe('/app/customers');
  });
});
