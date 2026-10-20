import { describe, expect, it } from 'vitest';
import {
  evaluateLicense,
  graceEndsAtFor,
  isReadPermissionCode,
  LICENSE_GRACE_DURATION_MS,
  unlicensedEvaluation,
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
    revokedAt: null,
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

  it('adds exactly 336h to a locally constructed expiry, across a DST transition', () => {
    // A locally constructed Date (no zone in the literal) proves the span is
    // epoch arithmetic: calendar arithmetic in a zone that changes offset, or
    // any rounding to a local midnight, would not end 336h later.
    const localExpiry = new Date(2026, 9, 8, 8, 30, 0, 0);
    const localEnd = graceEndsAtFor(localExpiry);
    expect(localEnd).not.toBeNull();
    expect(localEnd!.getTime() - localExpiry.getTime()).toBe(
      LICENSE_GRACE_DURATION_MS,
    );

    // Europe/Berlin leaves DST at 2026-10-25T01:00Z, inside this window.
    const straddling = new Date('2026-10-18T12:00:00.000Z');
    expect(graceEndsAtFor(straddling)?.toISOString()).toBe(
      '2026-11-01T12:00:00.000Z',
    );
    expect(
      evaluateLicense(
        license({ validUntil: straddling }),
        new Date('2026-10-31T12:00:00.000Z'),
      ).accessMode,
    ).toBe('GRACE');
    expect(
      evaluateLicense(
        license({ validUntil: straddling }),
        new Date('2026-11-01T12:00:00.000Z'),
      ).accessMode,
    ).toBe('READ_ONLY');
  });

  it('evaluates one instant identically however the same instant is expressed', () => {
    const utc = new Date('2026-10-08T08:30:00.000Z');
    const withOffset = new Date('2026-10-08T12:00:00.000+03:30');
    expect(withOffset.getTime()).toBe(utc.getTime());
    expect(graceEndsAtFor(withOffset)?.toISOString()).toBe(
      graceEndsAtFor(utc)?.toISOString(),
    );
    expect(evaluateLicense(license({ validUntil: withOffset }), utc)).toEqual(
      evaluateLicense(license({ validUntil: utc }), utc),
    );
  });

  it('never grants Grace or a deadline to an unlicensed evaluation', () => {
    const unlicensed = unlicensedEvaluation({
      installationId: 'i1',
      provider: 'test',
    });
    expect(unlicensed.accessMode).toBe('BLOCKED');
    expect(unlicensed.graceEndsAt).toBeNull();
    expect(unlicensed.active).toBe(false);
  });
});
