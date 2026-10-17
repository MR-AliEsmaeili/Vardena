import { describe, it, expect } from 'vitest';
import { customerSchema } from './customer-schema';
import { safeReturnPath } from '@/features/auth/login-page';
describe('Owner customer form contract', () => {
  const valid = {
    customerCode: 'a.b_C:9-',
    displayName: 'نام',
    status: 'ACTIVE',
    contractReference: '',
    contractStartDate: '',
    contractEndDate: '',
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
  // PDR-18 §1: contract dates are commercial and independent of the technical
  // technical validity value, so they may precede the recording and may be absent.
  it('accepts contract dates that precede issuance and rejects an inverted pair', () => {
    expect(
      customerSchema.safeParse({
        ...valid,
        contractStartDate: '2026-09-02',
        contractEndDate: '2027-09-02',
      }).success,
    ).toBe(true);
    expect(
      customerSchema.safeParse({
        ...valid,
        contractStartDate: '2026-09-02',
        contractEndDate: '2026-09-02',
      }).success,
    ).toBe(true);
    for (const contractStartDate of ['2026-13-01', '2026-02-30', 'not-a-day'])
      expect(
        customerSchema.safeParse({ ...valid, contractStartDate }).success,
      ).toBe(false);
    expect(
      customerSchema.safeParse({
        ...valid,
        contractStartDate: '2027-01-01',
        contractEndDate: '2026-01-01',
      }).success,
    ).toBe(false);
  });
  it('rejects cross-origin redirect destinations', () => {
    expect(safeReturnPath('//evil.test')).toBe('/app');
    expect(safeReturnPath('https://evil.test')).toBe('/app');
    expect(safeReturnPath('/app/customers')).toBe('/app/customers');
  });
});
