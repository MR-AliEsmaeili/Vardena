import { describe, expect, it } from 'vitest';
import { canonicalizeLicenseVersion } from './license-document.js';
import type { LicenseVersionPayload } from './license-document.js';
import { canonicalizeLicenseCodePayload } from './license-code.js';
import type { LicensePayload } from './license-code.js';
import {
  canonicalizeEnrollmentChallenge,
  canonicalizeDeviceReplacementChallenge,
  canonicalizeDeviceReplacementResponse,
} from './client-device.js';

// Independently pinned expected canonical bytes. These literals are NOT derived
// from the production canonicalizer at test time; they are pinned values verified
// against the documented contract (version-model-and-file-exchange.md §2.1).
// A change to the canonicalizer that alters output will fail these tests.

const VLIC2_PERSIAN =
  '{"v":2,"kind":"SERVER_LICENSE_VERSION","operationId":"01TESTOPERATION00000000000","licenseId":"01TESTLICENSE0000000000000","customerId":"01TESTCUSTOMER000000000000","customerCode":"CUST-TEST-01","customerName":"شرکت تست","installationId":"01TESTINSTALLATION000000000","status":"ACTIVE","validFrom":"2027-01-01T00:00:00.000Z","validUntil":"2028-01-01T00:00:00.000Z","organizationLimit":3,"userLimit":25,"deviceLimit":12,"modules":["accounting","inventory"],"features":[],"supersedesOperationId":null,"issuedAt":"2026-10-11T00:00:00.000Z"}';

const VLIC2_CONTROL =
  '{"v":2,"kind":"SERVER_LICENSE_VERSION","operationId":"01TESTOPERATION00000000000","licenseId":"01TESTLICENSE0000000000000","customerId":"01TESTCUSTOMER000000000000","customerCode":"CUST-TEST-01","customerName":"a\\u0001b\\u001f\u007f<>&/\u2028\u2029","installationId":"01TESTINSTALLATION000000000","status":"ACTIVE","validFrom":"2027-01-01T00:00:00.000Z","validUntil":"2028-01-01T00:00:00.000Z","organizationLimit":3,"userLimit":25,"deviceLimit":12,"modules":["accounting","inventory"],"features":[],"supersedesOperationId":null,"issuedAt":"2026-10-11T00:00:00.000Z"}';

const VLIC2_UNSPEC =
  '{"v":2,"kind":"SERVER_LICENSE_VERSION","operationId":"01TESTOPERATION00000000000","licenseId":"01TESTLICENSE0000000000000","customerId":"01TESTCUSTOMER000000000000","customerCode":"CUST-TEST-01","customerName":"شرکت تست","installationId":"01TESTINSTALLATION000000000","status":"ACTIVE","validFrom":"2027-01-01T00:00:00.000Z","validUntil":"2028-01-01T00:00:00.000Z","organizationLimit":3,"userLimit":25,"modules":["accounting","inventory"],"features":[],"supersedesOperationId":null,"issuedAt":"2026-10-11T00:00:00.000Z"}';

const VLIC2_UNLIM =
  '{"v":2,"kind":"SERVER_LICENSE_VERSION","operationId":"01TESTOPERATION00000000000","licenseId":"01TESTLICENSE0000000000000","customerId":"01TESTCUSTOMER000000000000","customerCode":"CUST-TEST-01","customerName":"شرکت تست","installationId":"01TESTINSTALLATION000000000","status":"ACTIVE","validFrom":"2027-01-01T00:00:00.000Z","validUntil":"2028-01-01T00:00:00.000Z","organizationLimit":3,"userLimit":25,"deviceLimit":null,"modules":["accounting","inventory"],"features":[],"supersedesOperationId":null,"issuedAt":"2026-10-11T00:00:00.000Z"}';

const VLIC1_LEGACY =
  '{"v":1,"licenseId":"01TESTLICENSE0000000000000","customerId":"01TESTCUSTOMER000000000000","customerCode":"CUST-TEST-01","customerName":"Acme Holding","installationId":"01TESTINSTALLATION000000000","status":"ACTIVE","validFrom":"2027-01-01T00:00:00.000Z","validUntil":"2028-01-01T00:00:00.000Z","organizationLimit":3,"userLimit":25,"modules":["accounting","inventory"],"features":[]}';

const VDEA1 =
  '{"format":"VDEA1","challengeId":"01TESTCHALLENGE0000000000","operationId":"01TESTOPERATION00000000000","deviceId":"01TESTDEVICE00000000000000","installationId":"01TESTINSTALLATION000000000","customerId":"01TESTCUSTOMER000000000000","customerCode":"CUST-TEST-01","licenseId":"01TESTLICENSE0000000000000","licenseVersionId":"01TESTVERSION00000000000","purpose":"DEVICE_ENROLLMENT","publicKey":"MCowBQYDK2VwAyEA4tH-Opmzg7yuyKzcQdHMe1kk2VNXVVyMFKw2a5QtUlY","publicKeyFingerprint":"90d31a35753045d5a8cf431f9046924cebfffe339f27ea6f9d2bdaec0ed2a310","nonce":"nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn","issuedAt":"2026-10-11T00:00:00.000Z","expiresAt":"2026-10-11T00:15:00.000Z"}';

const VDRQ1 =
  '{"format":"VDRQ1","requestId":"01TESTREQUEST000000000000","challengeId":"01TESTCHALLENGE0000000000","operationId":"01TESTOPERATION00000000000","installationId":"01TESTINSTALLATION000000000","customerId":"01TESTCUSTOMER000000000000","customerCode":"CUST-TEST-01","licenseId":"01TESTLICENSE0000000000000","licenseVersionId":"01TESTVERSION00000000000","oldDeviceId":"01TESTDEVICE00000000000000","newDeviceId":"01TESTDEVICE200000000000","publicKey":"MCowBQYDK2VwAyEA4tH-Opmzg7yuyKzcQdHMe1kk2VNXVVyMFKw2a5QtUlY","publicKeyFingerprint":"90d31a35753045d5a8cf431f9046924cebfffe339f27ea6f9d2bdaec0ed2a310","nonce":"nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn","issuedAt":"2026-10-11T00:00:00.000Z","challengeExpiresAt":"2026-10-11T00:15:00.000Z","expiresAt":"2026-11-10T00:00:00.000Z"}';

const VDRP1 =
  '{"format":"VDRP1","responseOperationId":"01TESTRESPONSE0000000000","keyId":"sha256-e6fc4307e011fd04","requestId":"01TESTREQUEST000000000000","challengeId":"01TESTCHALLENGE0000000000","requestOperationId":"01TESTOPERATION00000000000","requestHash":"eeccbe4c57207ad6cb2c9a5967e1538b543a44f02e1d9bc6448bda687de6a3b0","installationId":"01TESTINSTALLATION000000000","customerId":"01TESTCUSTOMER000000000000","customerCode":"CUST-TEST-01","licenseId":"01TESTLICENSE0000000000000","licenseVersionId":"01TESTVERSION00000000000","oldDeviceId":"01TESTDEVICE00000000000000","newDeviceId":"01TESTDEVICE200000000000","publicKeyFingerprint":"90d31a35753045d5a8cf431f9046924cebfffe339f27ea6f9d2bdaec0ed2a310","decision":"APPROVE","issuedAt":"2026-10-11T00:00:00.000Z","expiresAt":"2026-10-12T00:00:00.000Z"}';

function adaptVlic2(): LicenseVersionPayload {
  return {
    version: 2,
    kind: 'SERVER_LICENSE_VERSION',
    operationId: '01TESTOPERATION00000000000',
    licenseId: '01TESTLICENSE0000000000000',
    customerId: '01TESTCUSTOMER000000000000',
    customerCode: 'CUST-TEST-01',
    customerName: 'شرکت تست',
    installationId: '01TESTINSTALLATION000000000',
    status: 'ACTIVE' as any,
    validFrom: new Date('2027-01-01T00:00:00.000Z'),
    validUntil: new Date('2028-01-01T00:00:00.000Z'),
    organizationLimit: 3,
    userLimit: 25,
    deviceLimit: 12,
    deviceLimitSpecified: true,
    moduleEntitlements: ['inventory', 'accounting'],
    featureEntitlements: [],
    supersedesOperationId: null,
    renewsOperationId: null,
    issuedAt: new Date('2026-10-11T00:00:00.000Z'),
  };
}

function adaptVlic2Control(): LicenseVersionPayload {
  return {
    ...adaptVlic2(),
    customerName: 'a\u0001b\u001f' + '\u007f' + '<>&/' + '\u2028\u2029',
  };
}

function adaptVlic2Unspec(): LicenseVersionPayload {
  return {
    ...adaptVlic2(),
    customerName: 'شرکت تست',
    deviceLimit: null,
    deviceLimitSpecified: false,
  };
}

function adaptVlic2Unlim(): LicenseVersionPayload {
  return {
    ...adaptVlic2(),
    customerName: 'شرکت تست',
    deviceLimit: null,
    deviceLimitSpecified: true,
  };
}

function adaptVlic1(): LicensePayload {
  return {
    version: 1,
    licenseId: '01TESTLICENSE0000000000000',
    customerId: '01TESTCUSTOMER000000000000',
    customerCode: 'CUST-TEST-01',
    customerName: 'Acme Holding',
    installationId: '01TESTINSTALLATION000000000',
    status: 'ACTIVE' as any,
    validFrom: new Date('2027-01-01T00:00:00.000Z'),
    validUntil: new Date('2028-01-01T00:00:00.000Z'),
    organizationLimit: 3,
    userLimit: 25,
    deviceLimit: null,
    deviceLimitSpecified: false,
    moduleEntitlements: ['inventory', 'accounting'],
    featureEntitlements: [],
  };
}

describe('canonical byte conformance (independently pinned bytes)', () => {
  it('VLIC2 persian: exact bytes', () => {
    const out = canonicalizeLicenseVersion(adaptVlic2());
    expect(out).toBe(VLIC2_PERSIAN);
  });
  it('VLIC2 control chars: exact bytes', () => {
    const out = canonicalizeLicenseVersion(adaptVlic2Control());
    expect(out).toBe(VLIC2_CONTROL);
  });
  it('VLIC2 unspecified deviceLimit: exact bytes', () => {
    const out = canonicalizeLicenseVersion(adaptVlic2Unspec());
    expect(out).toBe(VLIC2_UNSPEC);
  });
  it('VLIC2 unlimited deviceLimit: exact bytes', () => {
    const out = canonicalizeLicenseVersion(adaptVlic2Unlim());
    expect(out).toBe(VLIC2_UNLIM);
  });
  it('VLIC1 legacy: exact bytes', () => {
    const out = canonicalizeLicenseCodePayload(adaptVlic1());
    expect(out).toBe(VLIC1_LEGACY);
  });
  it('VDEA1: exact bytes', () => {
    const input = JSON.parse(VDEA1);
    const out = canonicalizeEnrollmentChallenge(input as any);
    expect(out).toBe(VDEA1);
  });
  it('VDRQ1: exact bytes', () => {
    const input = JSON.parse(VDRQ1);
    const out = canonicalizeDeviceReplacementChallenge(input as any);
    expect(out).toBe(VDRQ1);
  });
  it('VDRP1: exact bytes', () => {
    const input = JSON.parse(VDRP1);
    const out = canonicalizeDeviceReplacementResponse(input as any);
    expect(out).toBe(VDRP1);
  });
});
