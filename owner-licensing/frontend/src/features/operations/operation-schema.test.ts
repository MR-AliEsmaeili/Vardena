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
      signingKeyId: '',
      installationReference: 'inst.a:1/b',
      reason: 'مشاهده شد',
      evidenceReference: 'CASE-1',
      observedValidityEnd: '',
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
  // PDR-18 §1.2 + PDR-17: the day an observation was recorded is derived by
  // the server from the immutable record instant. The form contract has no
  // field for it at all, so no client value can ever select, backdate or
  // future-date it — and nothing in the form claims to know the signed
  // license's actual issuance date.
  it('collects only the operator-recorded validity end, never a recording day', () => {
    const valid = {
      customerId,
      signingKeyId: '',
      installationReference: 'inst.a:1/b',
      reason: 'مشاهده شد',
      evidenceReference: '',
      observedValidityEnd: '2027-10-15',
      acknowledged: true,
    };
    expect(licenseObservationSchema.parse(valid)).not.toHaveProperty(
      'recordedOn',
    );
    expect(licenseObservationSchema.parse(valid).observedValidityEnd).toBe(
      '2027-10-15',
    );
    // An extra client-supplied recording day is stripped, never forwarded.
    expect(
      licenseObservationSchema.safeParse({
        ...valid,
        recordedOn: '2020-01-01',
      }).success,
    ).toBe(true);
    expect(
      licenseObservationSchema.parse({ ...valid, recordedOn: '2020-01-01' }),
    ).not.toHaveProperty('recordedOn');
    // An empty value records "no end was recorded", not a defaulted day.
    expect(
      licenseObservationSchema.parse({ ...valid, observedValidityEnd: '' })
        .observedValidityEnd,
    ).toBe('');
    for (const observedValidityEnd of ['2027-13-01', 'today', '۱۴۰۵/۰۷/۲۳'])
      expect(
        licenseObservationSchema.safeParse({ ...valid, observedValidityEnd })
          .success,
      ).toBe(false);
  });
  it('rejects identical old and new installation references', () => {
    const value = {
      customerId,
      signingKeyId: '',
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
