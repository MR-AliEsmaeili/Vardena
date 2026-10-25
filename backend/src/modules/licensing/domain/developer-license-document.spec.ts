import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEVELOPER_LICENSE_PREFIX,
  canonicalizeDeveloperLicense,
  parseDeveloperLicenseDocument,
  serializeDeveloperLicenseFile,
  signDeveloperLicenseDocument,
  type DeveloperLicensePayload,
} from './developer-license-document.js';
import {
  decodeLicenseTransport,
  parseLicenseDocument,
  serializeLicenseFile,
  signLicenseDocument,
  type LicenseVersionPayload,
} from './license-document.js';

const INSTALLATION_ID = '01JDEVINSTALLATION000000000';

function fixture(): DeveloperLicensePayload {
  return {
    version: 1,
    kind: 'DEVELOPER_LICENSE_VERSION',
    licenseType: 'DEVELOPER',
    operationId: 'dev-op-2026-001',
    licenseId: 'dev-license-2026-001',
    developerId: 'developer-alice',
    developerName: 'Alice Example',
    installationId: INSTALLATION_ID,
    status: 'ACTIVE',
    validFrom: new Date('2026-10-01T00:00:00.000Z'),
    validUntil: new Date('2026-12-31T23:59:59.000Z'),
    organizationLimit: 2,
    userLimit: 10,
    deviceLimit: 0,
    moduleEntitlements: ['users', 'organization'],
    featureEntitlements: ['developer-tools'],
    supersedesOperationId: null,
    issuerKeyId: 'dev-authority-2026',
    issuedAt: new Date('2026-10-01T00:00:00.000Z'),
  };
}

describe('VDEV1 Developer License document', () => {
  it('signs deterministically, verifies offline, and round-trips its file envelope', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const payload = fixture();
    const first = signDeveloperLicenseDocument(payload, privateKey);
    const second = signDeveloperLicenseDocument(payload, privateKey);

    expect(first).toBe(second);
    expect(first.startsWith(`${DEVELOPER_LICENSE_PREFIX}.`)).toBe(true);
    const envelope = serializeDeveloperLicenseFile(first, payload.issuerKeyId);
    expect(decodeLicenseTransport(envelope)).toEqual({
      document: first,
      transport: 'file',
      keyId: payload.issuerKeyId,
      format: 'developer',
    });
    expect(() =>
      decodeLicenseTransport(serializeLicenseFile(first, payload.issuerKeyId)),
    ).toThrow(/different license formats/);
    expect(
      parseDeveloperLicenseDocument(
        decodeLicenseTransport(envelope).document,
        [{ id: payload.issuerKeyId, key: publicKey }],
        { keyId: payload.issuerKeyId },
      ).payload,
    ).toEqual({
      ...payload,
      moduleEntitlements: ['organization', 'users'],
    });
  });

  it('is cryptographically domain-separated from commercial VLIC2', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const developer = signDeveloperLicenseDocument(fixture(), privateKey);
    expect(() =>
      parseLicenseDocument(developer, [
        { id: fixture().issuerKeyId, key: publicKey },
      ]),
    ).toThrow(/VDEV1|Unsupported license document version/);

    const commercial: LicenseVersionPayload = {
      version: 2,
      kind: 'SERVER_LICENSE_VERSION',
      operationId: 'commercial-op-001',
      licenseId: 'commercial-license-001',
      customerId: 'customer-001',
      customerCode: 'CUST-001',
      customerName: 'Commercial Customer',
      installationId: INSTALLATION_ID,
      status: 'ACTIVE',
      validFrom: new Date('2026-10-01T00:00:00.000Z'),
      validUntil: new Date('2026-12-31T23:59:59.000Z'),
      organizationLimit: 2,
      userLimit: 10,
      deviceLimit: 0,
      deviceLimitSpecified: true,
      moduleEntitlements: ['users'],
      featureEntitlements: [],
      supersedesOperationId: null,
      renewsOperationId: null,
      issuedAt: new Date('2026-10-01T00:00:00.000Z'),
    };
    const commercialDocument = signLicenseDocument(commercial, privateKey);
    expect(() =>
      parseDeveloperLicenseDocument(commercialDocument, [
        { id: fixture().issuerKeyId, key: publicKey },
      ]),
    ).toThrow(/VLIC2|Unsupported license document version/);
  });

  it('requires the signed issuer identity to equal the selected trusted key id', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const document = signDeveloperLicenseDocument(fixture(), privateKey);
    expect(() =>
      parseDeveloperLicenseDocument(document, [
        { id: 'another-developer-key', key: publicKey },
      ]),
    ).toThrow(/issuer key id/);
  });

  it('rejects invalid validity, limits, duplicate/unknown entitlements and self-supersession before signing', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const cases: DeveloperLicensePayload[] = [
      { ...fixture(), validUntil: fixture().validFrom },
      { ...fixture(), organizationLimit: 0 },
      { ...fixture(), userLimit: -1 },
      { ...fixture(), userLimit: 2_147_483_648 },
      { ...fixture(), validFrom: new Date('invalid') },
      { ...fixture(), deviceLimit: 1 },
      { ...fixture(), moduleEntitlements: ['users', 'users'] },
      { ...fixture(), moduleEntitlements: ['not-a-module'] },
      { ...fixture(), featureEntitlements: ['Bad Feature'] },
      {
        ...fixture(),
        supersedesOperationId: fixture().operationId,
      },
    ];
    for (const payload of cases) {
      expect(() => signDeveloperLicenseDocument(payload, privateKey)).toThrow();
    }
  });

  it('allows a future validity start so a replacement can be imported before hand-over', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    expect(() =>
      signDeveloperLicenseDocument(
        {
          ...fixture(),
          issuedAt: new Date('2026-10-01T00:00:00.000Z'),
          validFrom: new Date('2026-10-02T00:00:00.000Z'),
        },
        privateKey,
      ),
    ).not.toThrow();
  });

  it('canonicalizes entitlement ordering without mutating the caller payload', () => {
    const payload = fixture();
    const modules = [...payload.moduleEntitlements];
    const canonical = canonicalizeDeveloperLicense(payload);
    expect(JSON.parse(canonical).modules).toEqual(['organization', 'users']);
    expect(payload.moduleEntitlements).toEqual(modules);
  });
});
