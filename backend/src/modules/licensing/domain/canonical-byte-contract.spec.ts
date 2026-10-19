import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { canonicalizeLicenseVersion } from './license-document.js';
import type { LicenseVersionPayload } from './license-document.js';
import { canonicalizeEnrollmentChallenge } from './client-device.js';
import type { EnrollmentChallengePayload } from './client-device.js';
import { generateId } from '../../../kernel/ids/ulid.js';

function basePayload(
  overrides: Partial<LicenseVersionPayload> = {},
): LicenseVersionPayload {
  return {
    version: 2,
    kind: 'SERVER_LICENSE_VERSION',
    operationId: generateId(),
    licenseId: generateId(),
    customerId: generateId(),
    customerCode: 'CUST-ACME-01',
    customerName: 'Acme Holding',
    installationId: generateId(),
    status: 'ACTIVE',
    validFrom: new Date('2027-01-01T00:00:00.000Z'),
    validUntil: new Date('2028-01-01T00:00:00.000Z'),
    organizationLimit: 3,
    userLimit: 25,
    deviceLimit: 12,
    deviceLimitSpecified: true,
    moduleEntitlements: ['accounting', 'inventory'],
    featureEntitlements: [],
    supersedesOperationId: null,
    // Omitted from the canonical bytes when absent (OD-LIC-06 §3.1): every
    // committed vector below keeps its exact bytes, digest and signature.
    renewsOperationId: null,
    issuedAt: new Date('2026-10-11T00:00:00.000Z'),
    ...overrides,
  };
}

describe('canonical byte contract (D-2(b) ratification)', () => {
  it('emits non-ASCII (Persian) raw as UTF-8', () => {
    const p = basePayload({ customerName: 'شرکت تست' });
    const out = canonicalizeLicenseVersion(p);
    expect(out).toContain('شرکت تست');
    // ensure no \u escaping for those chars
    expect(out).not.toContain('\\u0634');
  });

  it('emits < > & / U+007F U+2028 U+2029 raw', () => {
    const name = 'a<b>c&d/e' + '\u007f' + '\u2028' + '\u2029';
    const p = basePayload({ customerName: name });
    const out = canonicalizeLicenseVersion(p);
    expect(out).toContain(name);
  });

  it('escapes C0 controls with lowercase hex', () => {
    const name = 'a\u0001b\u001fb';
    const p = basePayload({ customerName: name });
    const out = canonicalizeLicenseVersion(p);
    expect(out).toContain('a\\u0001b\\u001fb');
  });

  it('escapes \\b \\t \\n \\f \\r', () => {
    const name = 'a\b\t\n\f\rb';
    const p = basePayload({ customerName: name });
    const out = canonicalizeLicenseVersion(p);
    expect(out).toContain('a\\b\\t\\n\\f\\rb');
  });

  it('omits deviceLimit when unspecified', () => {
    const p = basePayload({ deviceLimit: null, deviceLimitSpecified: false });
    const out = canonicalizeLicenseVersion(p);
    expect(out).not.toContain('deviceLimit');
  });

  it('includes deviceLimit null when specified unlimited', () => {
    const p = basePayload({ deviceLimit: null, deviceLimitSpecified: true });
    const out = canonicalizeLicenseVersion(p);
    expect(out).toContain('"deviceLimit":null');
  });

  it('sorts modules and features', () => {
    const p = basePayload({
      moduleEntitlements: ['users', 'accounting'],
      featureEntitlements: ['z', 'a'],
    });
    const out = canonicalizeLicenseVersion(p);
    expect(out).toContain('"modules":["accounting","users"]');
    expect(out).toContain('"features":["a","z"]');
  });

  it('instants are ISO with 3 fraction digits', () => {
    const p = basePayload({});
    const out = canonicalizeLicenseVersion(p);
    expect(out).toContain('"validFrom":"2027-01-01T00:00:00.000Z"');
  });

  it('VDEA1 canonicalization runs and contains format', () => {
    const kp = generateKeyPairSync('ed25519');
    const der = kp.publicKey.export({ format: 'der', type: 'spki' });
    const fp = createHash('sha256').update(der).digest('hex');
    const payload: EnrollmentChallengePayload = {
      format: 'VDEA1',
      challengeId: generateId(),
      operationId: generateId(),
      deviceId: generateId(),
      installationId: generateId(),
      customerId: generateId(),
      customerCode: 'CUST-ACME-01',
      licenseId: generateId(),
      licenseVersionId: generateId(),
      purpose: 'DEVICE_ENROLLMENT',
      publicKey: der.toString('base64url'),
      publicKeyFingerprint: fp,
      nonce: 'n'.repeat(32),
      issuedAt: '2026-10-11T00:00:00.000Z',
      expiresAt: '2026-10-11T00:15:00.000Z',
    };
    const out = canonicalizeEnrollmentChallenge(payload);
    expect(out).toContain('VDEA1');
  });

  it('omits renewsOperationId entirely when the document is not a renewal', () => {
    const p = basePayload();
    const out = canonicalizeLicenseVersion(p);
    expect(out).not.toContain('renewsOperationId');
    // The absence is what keeps every pre-OQ-88 artifact, vector and signature
    // byte-identical: the field is not emitted as `null`.
    expect(out).toContain(',"supersedesOperationId":null,"issuedAt":');
  });

  it('places renewsOperationId between supersedesOperationId and issuedAt', () => {
    const target = generateId();
    const p = basePayload({ renewsOperationId: target });
    const out = canonicalizeLicenseVersion(p);
    expect(out).toContain(
      `"supersedesOperationId":null,"renewsOperationId":"${target}","issuedAt":`,
    );
    // The key order is fixed by construction, so the same logical version always
    // signs the same bytes.
    expect(out).toBe(canonicalizeLicenseVersion({ ...p }));
  });

  it('canonical output is valid JSON round-trip', () => {
    const p = basePayload({ customerName: 'شرکت تست <>&/' });
    const out = canonicalizeLicenseVersion(p);
    const parsed = JSON.parse(out);
    expect(parsed.customerName).toBe('شرکت تست <>&/');
  });
});
