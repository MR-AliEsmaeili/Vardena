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
