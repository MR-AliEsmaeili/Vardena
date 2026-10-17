import { describe, expect, it } from 'vitest';
import {
  licenseObservationSchema,
  replacementSchema,
} from './operation-schema';

const customerId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
describe('manual operation form contract', () => {
  it('requires an existing customer id, a bounded installation reference and explicit confirmation', () => {
    const valid = {
      customerId,
      installationReference: 'inst.a:1/b',
      reason: 'مشاهده شد',
      evidenceReference: 'CASE-1',
      activationValidUntil: '',
      acknowledged: true,
    };
    expect(licenseObservationSchema.parse(valid).customerId).toBe(customerId);
    expect(
      licenseObservationSchema.safeParse({ ...valid, acknowledged: false })
        .success,
    ).toBe(false);
    expect(
      licenseObservationSchema.safeParse({ ...valid, customerId: 'Acme' })
        .success,
    ).toBe(false);
    expect(
      licenseObservationSchema.safeParse({
        ...valid,
        installationReference: 'bad ref',
      }).success,
    ).toBe(false);
    expect(
      licenseObservationSchema.safeParse({ ...valid, reason: '  ' }).success,
    ).toBe(false);
    expect(
      licenseObservationSchema.safeParse({
        ...valid,
        evidenceReference: ['-----BEGIN', 'PRIVATE KEY-----'].join(' '),
      }).success,
    ).toBe(false);
  });
  // PDR-18 §1.2: the activation-validity start is the authoritative issuance
  // day asserted by the server. The form contract has no field for it at all,
  // so no client value can ever select, backdate or future-date that start.
  it('collects only the issuer-supplied activation-validity end, never a start', () => {
    const valid = {
      customerId,
      installationReference: 'inst.a:1/b',
      reason: 'مشاهده شد',
      evidenceReference: '',
      activationValidUntil: '2027-10-15',
      acknowledged: true,
    };
    expect(licenseObservationSchema.parse(valid)).not.toHaveProperty(
      'activationValidFrom',
    );
    expect(licenseObservationSchema.parse(valid).activationValidUntil).toBe(
      '2027-10-15',
    );
    expect(
      licenseObservationSchema.safeParse({
        ...valid,
        activationValidFrom: '2020-01-01',
      }).success,
    ).toBe(true);
    expect(
      licenseObservationSchema.parse({
        ...valid,
        activationValidFrom: '2020-01-01',
      }),
    ).not.toHaveProperty('activationValidFrom');
    for (const activationValidUntil of ['2027-13-01', 'today', '۱۴۰۵/۰۷/۲۳'])
      expect(
        licenseObservationSchema.safeParse({ ...valid, activationValidUntil })
          .success,
      ).toBe(false);
  });
  it('rejects identical old and new installation references', () => {
    const value = {
      customerId,
      oldInstallationReference: 'OLD-1',
      replacementInstallationReference: 'OLD-1',
      reason: 'دلیل',
      evidenceReference: '',
      emergencyOldServerLost: false,
      acknowledged: true,
    };
    expect(replacementSchema.safeParse(value).success).toBe(false);
    expect(
      replacementSchema.safeParse({
        ...value,
        replacementInstallationReference: 'NEW-1',
        emergencyOldServerLost: true,
      }).success,
    ).toBe(true);
  });
});
