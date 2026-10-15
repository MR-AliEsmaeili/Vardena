import { describe, expect, it } from 'vitest';
import {
  generateAuthorityKeyPair,
  issueLicenseCode,
} from '../../../tools/development-license-authority.js';
import {
  LicenseCodeError,
  licenseCodeHash,
  parseLicenseCode,
  parsePublicKey,
  toInstallationLicense,
  type LicensePayload,
} from './license-code.js';
import { evaluateLicense } from './license.js';

/**
 * Authenticity of the license code (L-02, security review §9).
 *
 * The issuing side used here is the real development authority
 * (`npm run license:issue`), so a format change that breaks issuing or
 * verification cannot pass unnoticed in only one of the two.
 */
describe('license code', () => {
  const authority = generateAuthorityKeyPair();
  const other = generateAuthorityKeyPair();
  const publicKeys = [parsePublicKey(authority.publicKey)];
  const INSTALLATION = '01K7INSTALLATIONAAAAAAAAAA';
  const CUSTOMER = '01K7CUSTOMERAAAAAAAAAAAAAA';
  const CUSTOMER_CODE = 'CUST-ACME-01';

  const issue = (
    overrides: Partial<Parameters<typeof issueLicenseCode>[0]> = {},
    key = authority.privateKey,
  ): { code: string; payload: LicensePayload } =>
    issueLicenseCode(
      {
        installationId: INSTALLATION,
        customerId: CUSTOMER,
        customerCode: CUSTOMER_CODE,
        ...overrides,
      },
      key,
    );

  it('round-trips an issued license and preserves every field', () => {
    const { code, payload } = issue({
      installationId: INSTALLATION,
      customerName: 'Acme',
      organizationLimit: 3,
      userLimit: 25,
      validUntil: new Date('2030-01-01T00:00:00.000Z'),
      moduleEntitlements: ['organization', 'users'],
      featureEntitlements: ['advanced-reports'],
    });

    const parsed = parseLicenseCode(code, publicKeys);

    expect(parsed).toEqual(payload);
    expect(parsed.deviceLimit).toBeNull();
    expect(parsed.deviceLimitSpecified).toBe(false);
    expect(parsed.customerCode).toBe(CUSTOMER_CODE);
    expect(toInstallationLicense(parsed, 'persistent')).toMatchObject({
      customerId: CUSTOMER,
      customerCode: CUSTOMER_CODE,
      installationId: INSTALLATION,
      organizationLimit: 3,
      userLimit: 25,
      entitlements: [
        { kind: 'MODULE', code: 'organization' },
        { kind: 'MODULE', code: 'users' },
        { kind: 'FEATURE', code: 'advanced-reports' },
      ],
    });
    expect(
      evaluateLicense(toInstallationLicense(parsed, 'p'), new Date()),
    ).toMatchObject({
      licensed: true,
      active: true,
      customerId: CUSTOMER,
      customerCode: CUSTOMER_CODE,
    });
  });

  it('is stable: the same code always hashes to the same value', () => {
    const { code } = issue();
    expect(licenseCodeHash(code)).toBe(licenseCodeHash(` ${code} `));
    expect(licenseCodeHash(code)).not.toBe(licenseCodeHash(issue().code));
  });

  it('rejects a malformed code', () => {
    for (const code of ['', 'not-a-license', 'VLIC1.only-two', 'A.B.C']) {
      expect(() => parseLicenseCode(code, publicKeys)).toThrow(
        LicenseCodeError,
      );
    }
  });

  it('rejects an unsupported code version', () => {
    const { code } = issue();
    const [, body, signature] = code.split('.');
    expect(() =>
      parseLicenseCode(`VLIC9.${body}.${signature}`, publicKeys),
    ).toThrow(/Unsupported license code version/);
  });

  it('rejects a tampered payload', () => {
    const { code, payload } = issue({
      installationId: INSTALLATION,
      organizationLimit: 1,
    });
    const [prefix, , signature] = code.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        v: 1,
        licenseId: payload.licenseId,
        customerId: payload.customerId,
        customerName: payload.customerName,
        installationId: payload.installationId,
        status: 'ACTIVE',
        validFrom: payload.validFrom.toISOString(),
        validUntil: null,
        organizationLimit: 999_999,
        userLimit: null,
        modules: [...payload.moduleEntitlements].sort(),
        features: [],
      }),
      'utf8',
    ).toString('base64url');

    expect(() =>
      parseLicenseCode(`${prefix}.${forged}.${signature}`, publicKeys),
    ).toThrow(/signature is not valid/);
  });

  it('rejects a license signed by a different authority', () => {
    const { code } = issue({ installationId: INSTALLATION }, other.privateKey);
    expect(() => parseLicenseCode(code, publicKeys)).toThrow(
      /signature is not valid/,
    );
  });

  it('rejects every code when no authority key is configured', () => {
    const { code } = issue();
    expect(() => parseLicenseCode(code, [])).toThrow(
      /No licensing authority public key is configured/,
    );
  });

  it('rejects an invalid validity interval at issuing time', () => {
    expect(() =>
      issue({
        installationId: INSTALLATION,
        validFrom: new Date('2027-01-01T00:00:00.000Z'),
        validUntil: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ).toThrow(/validUntil must be later than validFrom/);
  });

  it('rejects non-positive limits', () => {
    expect(() =>
      issue({ installationId: INSTALLATION, organizationLimit: 0 }),
    ).toThrow(/organizationLimit must be a positive integer/);
    expect(() =>
      issue({ installationId: INSTALLATION, userLimit: -5 }),
    ).toThrow(/userLimit must be a positive integer/);
  });

  it('rejects unknown or repeated entitlements', () => {
    expect(() =>
      issue({
        installationId: INSTALLATION,
        moduleEntitlements: ['organization', 'telepathy'],
      }),
    ).toThrow(/unknown module entitlement "telepathy"/);
    expect(() =>
      issue({
        installationId: INSTALLATION,
        moduleEntitlements: ['users', 'users'],
      }),
    ).toThrow(/repeats a module entitlement/);
    expect(() =>
      issue({
        installationId: INSTALLATION,
        featureEntitlements: ['Not A Code'],
      }),
    ).toThrow(/malformed feature entitlement/);
  });

  it('carries the lifecycle status it was issued with', () => {
    const suspended = parseLicenseCode(
      issue({ installationId: INSTALLATION, status: 'SUSPENDED' }).code,
      publicKeys,
    );
    expect(
      evaluateLicense(toInstallationLicense(suspended, 'p'), new Date()),
    ).toMatchObject({ active: false, inactiveReason: 'status' });

    const expired = parseLicenseCode(
      issue({
        installationId: INSTALLATION,
        validFrom: new Date('2020-01-01T00:00:00.000Z'),
        validUntil: new Date('2021-01-01T00:00:00.000Z'),
      }).code,
      publicKeys,
    );
    expect(
      evaluateLicense(toInstallationLicense(expired, 'p'), new Date()),
    ).toMatchObject({ active: false, inactiveReason: 'expired' });
  });
});
