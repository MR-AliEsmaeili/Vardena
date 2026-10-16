import { describe, expect, it } from 'vitest';
import {
  evaluateLicense,
  graceEndsAtFor,
  isReadPermissionCode,
  LICENSE_GRACE_DURATION_MS,
  type InstallationLicense,
} from './license.js';

const EXPIRY = new Date('2026-10-08T08:30:00.000Z');
const GRACE_END = new Date('2026-10-22T08:30:00.000Z');

function license(
  overrides: Partial<InstallationLicense> = {},
): InstallationLicense {
  return {
    customerId: 'c1',
    customerCode: 'CUST-1',
    installationId: 'i1',
    licenseId: 'l1',
    status: 'ACTIVE',
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validUntil: EXPIRY,
    organizationLimit: null,
    userLimit: null,
    deviceLimit: null,
    deviceLimitSpecified: false,
    entitlements: [{ kind: 'MODULE', code: 'accounting' }],
    provider: 'test',
    ...overrides,
  };
}

describe('OQ-45 Grace evaluation (exact UTC)', () => {
  it('is ACTIVE before expiry and at expiry-1ms, GRACE exactly at expiry (end-exclusive)', () => {
    expect(
      evaluateLicense(license(), new Date(EXPIRY.getTime() - 1)).accessMode,
    ).toBe('ACTIVE');
    expect(evaluateLicense(license(), EXPIRY)).toMatchObject({
      active: false,
      inactiveReason: 'expired',
      accessMode: 'GRACE',
      graceEndsAt: GRACE_END,
    });
  });
  it('is GRACE at deadline-1ms and READ_ONLY exactly at and after deadline', () => {
    expect(
      evaluateLicense(license(), new Date(GRACE_END.getTime() - 1)).accessMode,
    ).toBe('GRACE');
    expect(evaluateLicense(license(), GRACE_END).accessMode).toBe('READ_ONLY');
    expect(
      evaluateLicense(license(), new Date(GRACE_END.getTime() + 1)).accessMode,
    ).toBe('READ_ONLY');
  });
  it('uses UTC ms arithmetic independent of DST/display zone (336h)', () => {
    expect(LICENSE_GRACE_DURATION_MS).toBe(336 * 60 * 60 * 1000);
    expect(graceEndsAtFor(EXPIRY)?.toISOString()).toBe(
      '2026-10-22T08:30:00.000Z',
    );
    expect(graceEndsAtFor(null)).toBeNull();
  });
  it('never assigns Grace to perpetual, future, unlicensed or status-inactive licenses', () => {
    expect(
      evaluateLicense(license({ validUntil: null }), GRACE_END).accessMode,
    ).toBe('ACTIVE');
    expect(
      evaluateLicense(
        license({ validFrom: new Date('2027-01-01T00:00:00.000Z') }),
        GRACE_END,
      ).accessMode,
    ).toBe('BLOCKED');
    expect(
      evaluateLicense(license({ status: 'SUSPENDED' }), EXPIRY).accessMode,
    ).toBe('BLOCKED');
    expect(
      evaluateLicense(license({ status: 'EXPIRED' }), EXPIRY).accessMode,
    ).toBe('BLOCKED');
  });
  it('classifies only View/Export as reads', () => {
    expect(isReadPermissionCode('Accounting.Document.View')).toBe(true);
    expect(isReadPermissionCode('Sales.Invoice.Export')).toBe(true);
    expect(isReadPermissionCode('Accounting.Document.Create')).toBe(false);
    expect(isReadPermissionCode('Inventory.Movement.Reverse')).toBe(false);
  });
});
