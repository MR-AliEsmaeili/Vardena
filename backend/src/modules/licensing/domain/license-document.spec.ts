import { sign as cryptoSign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  generateAuthorityKeyPair,
  issueLicenseFile,
} from '../../../tools/development-license-authority.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { parsePrivateKey, parsePublicKey } from './license-code.js';
import {
  LICENSE_FILE_FORMAT,
  LICENSE_FILE_VERSION,
  decodeLicenseTransport,
  hashKeyMaterial,
  licenseDocumentHash,
  parseLicenseDocument,
  splitTrustedKeyEntry,
  toTrustedKeys,
  LicenseDocumentError,
  type TrustedLicenseKey,
} from './license-document.js';

/**
 * The signed document format (ADR-0046 Decision 1, design §2).
 *
 * These tests pin the properties the import path depends on: one artifact for
 * both transports, canonical bytes, a signature that covers every licensing
 * fact, addressable trust entries, and rotation whose effect is limited to
 * *future* imports (verification happens at import only).
 */

const AUTHORITY = generateAuthorityKeyPair();
const OTHER = generateAuthorityKeyPair();
const INSTALLATION = '01K7INSTALLATION0000000000';
const CUSTOMER = '01K7CUSTOMER00000000000000';
const CUSTOMER_CODE = 'CUST-ACME-01';

function issue(
  overrides: Partial<Parameters<typeof issueLicenseFile>[0]> = {},
  key = AUTHORITY.privateKey,
): ReturnType<typeof issueLicenseFile> {
  return issueLicenseFile(
    {
      installationId: INSTALLATION,
      customerId: CUSTOMER,
      customerCode: CUSTOMER_CODE,
      ...overrides,
    },
    key,
  );
}

function trusted(...materials: string[]): TrustedLicenseKey[] {
  return toTrustedKeys(
    materials.map((material) => ({ key: parsePublicKey(material) })),
  );
}

function authorityKey(): KeyObject {
  return parsePrivateKey(AUTHORITY.privateKey);
}

/** Sign an arbitrary wire object — used for documents the issuer refuses. */
function signWire(wire: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(wire), 'utf8');
  return [
    'VLIC2',
    body.toString('base64url'),
    cryptoSign(null, body, authorityKey()).toString('base64url'),
  ].join('.');
}

function wire(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    v: 2,
    kind: 'SERVER_LICENSE_VERSION',
    operationId: generateId(),
    licenseId: generateId(),
    customerId: generateId(),
    customerCode: CUSTOMER_CODE,
    customerName: 'Acme Holding',
    installationId: INSTALLATION,
    status: 'ACTIVE',
    validFrom: '2027-01-01T00:00:00.000Z',
    validUntil: '2028-01-01T00:00:00.000Z',
    organizationLimit: 3,
    userLimit: 25,
    modules: ['accounting', 'inventory'],
    features: [],
    supersedesOperationId: null,
    issuedAt: '2026-10-11T00:00:00.000Z',
    ...overrides,
  };
}

function reasonOf(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof LicenseDocumentError
      ? error.reason
      : `other:${String(error)}`;
  }
}

describe('signed license document', () => {
  it('round-trips a document through the trust list', () => {
    const { document, payload } = issue(
      {
        installationId: INSTALLATION,
        customerName: 'Acme Holding',
        organizationLimit: 3,
        userLimit: 25,
      },
      AUTHORITY.privateKey,
    );

    const verified = parseLicenseDocument(
      document,
      trusted(AUTHORITY.publicKey),
    );

    expect(verified.payload).toMatchObject({
      version: 2,
      kind: 'SERVER_LICENSE_VERSION',
      operationId: payload.operationId,
      customerId: CUSTOMER,
      customerCode: CUSTOMER_CODE,
      installationId: INSTALLATION,
      organizationLimit: 3,
      userLimit: 25,
      moduleEntitlements: expect.arrayContaining(['accounting', 'inventory']),
    });
    expect(verified.keyId).toBe(
      hashKeyMaterial(parsePublicKey(AUTHORITY.publicKey)),
    );
  });

  it('preserves pre-device VLIC2 canonical bytes as UNSPECIFIED, not unlimited', () => {
    // This is the historical VLIC2 wire shape: omitting deviceLimit must not
    // rewrite the signed payload or infer an unlimited entitlement.
    const historical = wire();
    const document = signWire(historical);
    const payloadText = Buffer.from(
      document.split('.')[1]!,
      'base64url',
    ).toString('utf8');
    const verified = parseLicenseDocument(
      document,
      trusted(AUTHORITY.publicKey),
    );

    expect(JSON.parse(payloadText)).not.toHaveProperty('deviceLimit');
    expect(verified.payload.deviceLimit).toBeNull();
    expect(verified.payload.deviceLimitSpecified).toBe(false);
  });

  it('signs only explicit finite, zero or unlimited device quotas', () => {
    const unspecified = issue({ installationId: INSTALLATION });
    const finite = issue({ installationId: INSTALLATION, deviceLimit: 12 });
    const zero = issue({ installationId: INSTALLATION, deviceLimit: 0 });
    const unlimited = issue({
      installationId: INSTALLATION,
      deviceLimit: null,
    });

    expect(unspecified.payload).toMatchObject({
      deviceLimit: null,
      deviceLimitSpecified: false,
    });
    expect(finite.payload).toMatchObject({
      deviceLimit: 12,
      deviceLimitSpecified: true,
    });
    expect(zero.payload).toMatchObject({
      deviceLimit: 0,
      deviceLimitSpecified: true,
    });
    expect(unlimited.payload).toMatchObject({
      deviceLimit: null,
      deviceLimitSpecified: true,
    });
    expect(
      JSON.parse(
        Buffer.from(unspecified.document.split('.')[1]!, 'base64url').toString(
          'utf8',
        ),
      ),
    ).not.toHaveProperty('deviceLimit');
    expect(
      JSON.parse(
        Buffer.from(unlimited.document.split('.')[1]!, 'base64url').toString(
          'utf8',
        ),
      ),
    ).toHaveProperty('deviceLimit', null);
  });

  it('produces the same payload from the file envelope and the bare artifact', () => {
    const { file, document } = issue(
      { installationId: INSTALLATION },
      AUTHORITY.privateKey,
    );

    const fromText = decodeLicenseTransport(document);
    const fromFile = decodeLicenseTransport(file);

    expect(fromText).toMatchObject({ transport: 'text', keyId: null });
    expect(fromFile.transport).toBe('file');
    expect(fromFile.document).toBe(document);
    expect(
      parseLicenseDocument(fromFile.document, trusted(AUTHORITY.publicKey))
        .payload,
    ).toEqual(
      parseLicenseDocument(document, trusted(AUTHORITY.publicKey)).payload,
    );
  });

  it('rejects a tampered payload with a signature failure', () => {
    const { document } = issue(
      { installationId: INSTALLATION },
      AUTHORITY.privateKey,
    );
    const [prefix, body, signature] = document.split('.');
    const decoded = JSON.parse(
      Buffer.from(body!, 'base64url').toString('utf8'),
    );
    decoded['userLimit'] = 100_000;

    const forged = [
      prefix,
      Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url'),
      signature,
    ].join('.');

    expect(
      reasonOf(() =>
        parseLicenseDocument(forged, trusted(AUTHORITY.publicKey)),
      ),
    ).toBe('signature');
  });

  it('rejects a tampered customerCode with a signature failure', () => {
    const { document } = issue(
      { installationId: INSTALLATION },
      AUTHORITY.privateKey,
    );
    const [prefix, body, signature] = document.split('.');
    const decoded = JSON.parse(
      Buffer.from(body!, 'base64url').toString('utf8'),
    );
    decoded['customerCode'] = 'CUST-TAMPERED-99';

    const forged = [
      prefix,
      Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url'),
      signature,
    ].join('.');

    expect(
      reasonOf(() =>
        parseLicenseDocument(forged, trusted(AUTHORITY.publicKey)),
      ),
    ).toBe('signature');
  });

  it('rejects a non-canonical body even when it is correctly signed', () => {
    const body = Buffer.from(` ${JSON.stringify(wire())} `, 'utf8');
    const document = [
      'VLIC2',
      body.toString('base64url'),
      cryptoSign(null, body, authorityKey()).toString('base64url'),
    ].join('.');

    expect(
      reasonOf(() =>
        parseLicenseDocument(document, trusted(AUTHORITY.publicKey)),
      ),
    ).toBe('payload');
  });

  it('rejects an unknown top-level payload field', () => {
    expect(
      reasonOf(() =>
        parseLicenseDocument(
          signWire(wire({ discount: 90 })),
          trusted(AUTHORITY.publicKey),
        ),
      ),
    ).toBe('payload');
  });

  it('rejects a document signed by an untrusted authority', () => {
    const { document } = issue(
      { installationId: INSTALLATION },
      OTHER.privateKey,
    );

    expect(
      reasonOf(() =>
        parseLicenseDocument(document, trusted(AUTHORITY.publicKey)),
      ),
    ).toBe('signature');
  });

  it('rejects an empty trust list', () => {
    const { document } = issue(
      { installationId: INSTALLATION },
      AUTHORITY.privateKey,
    );
    expect(() => parseLicenseDocument(document, [])).toThrow(
      /No licensing authority public key/,
    );
  });

  it('honours an addressable key id and rejects an unknown one', () => {
    const { document } = issue(
      { installationId: INSTALLATION },
      AUTHORITY.privateKey,
    );
    const trust: TrustedLicenseKey[] = [
      { id: 'authority-2026', key: parsePublicKey(AUTHORITY.publicKey) },
      { id: 'authority-2027', key: parsePublicKey(OTHER.publicKey) },
    ];

    expect(parseLicenseDocument(document, trust).keyId).toBe('authority-2026');
    expect(
      reasonOf(() =>
        parseLicenseDocument(document, trust, { keyId: 'authority-2099' }),
      ),
    ).toBe('unknown-key');
  });

  it('keeps a rotated-away key usable only while it is trusted', () => {
    const { document } = issue(
      { installationId: INSTALLATION },
      AUTHORITY.privateKey,
    );

    // Rotation: both keys trusted → the old signature still verifies.
    expect(() =>
      parseLicenseDocument(
        document,
        trusted(AUTHORITY.publicKey, OTHER.publicKey),
      ),
    ).not.toThrow();

    // Retiring the old key restricts FUTURE imports signed with it.
    expect(
      reasonOf(() => parseLicenseDocument(document, trusted(OTHER.publicKey))),
    ).toBe('signature');
  });

  it('parses `keyId:<material>` trust entries without confusing base64 or PEM', () => {
    expect(splitTrustedKeyEntry('authority-2026:abc')).toEqual({
      id: 'authority-2026',
      material: 'abc',
    });
    expect(splitTrustedKeyEntry('abc')).toEqual({ id: null, material: 'abc' });
    // Only the FIRST colon separates the id: a material that itself contains a
    // colon stays intact. Neither PEM text nor base64 DER contains one, so a
    // bare key is never mis-split into an id.
    expect(splitTrustedKeyEntry('a:b:c')).toEqual({ id: 'a', material: 'b:c' });
    expect(splitTrustedKeyEntry(':abc')).toEqual({
      id: null,
      material: ':abc',
    });
  });

  it('rejects malformed envelopes with the transport reason', () => {
    const cases: Array<[string, string]> = [
      ['not json', 'malformed'],
      ['[]', 'malformed'],
      ['{}', 'malformed'],
      [
        `{"format":"other","fileVersion":1,"document":"VLIC2.a.b"}`,
        'malformed',
      ],
      [
        `{"format":"${LICENSE_FILE_FORMAT}","fileVersion":${LICENSE_FILE_VERSION + 1},"document":"VLIC2.a.b"}`,
        'unsupported-version',
      ],
      [
        `{"format":"${LICENSE_FILE_FORMAT}","fileVersion":1,"document":"VLIC2.a.b","keyId":7}`,
        'malformed',
      ],
      [
        `{"format":"${LICENSE_FILE_FORMAT}","fileVersion":1,"document":"VLIC2.a.b","extra":true}`,
        'malformed',
      ],
    ];

    for (const [input, expected] of cases) {
      expect(
        reasonOf(() => {
          const decoded = decodeLicenseTransport(input);
          parseLicenseDocument(decoded.document, trusted(AUTHORITY.publicKey), {
            keyId: decoded.keyId,
          });
        }),
      ).toBe(expected);
    }
  });

  it('rejects artifacts with an unsupported prefix or empty parts', () => {
    expect(
      reasonOf(() =>
        parseLicenseDocument('VLIC9.a.b', trusted(AUTHORITY.publicKey)),
      ),
    ).toBe('unsupported-version');
    expect(
      reasonOf(() =>
        parseLicenseDocument('VLIC2..', trusted(AUTHORITY.publicKey)),
      ),
    ).toBe('malformed');
    expect(
      reasonOf(() =>
        parseLicenseDocument('VLIC2.only', trusted(AUTHORITY.publicKey)),
      ),
    ).toBe('malformed');
  });

  it('validates payload semantics before anything is trusted', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ validUntil: '2027-01-01T00:00:00.000Z' }, 'validity'],
      [{ organizationLimit: 0 }, 'limits'],
      [{ userLimit: -5 }, 'limits'],
      [{ deviceLimit: -1 }, 'limits'],
      [{ deviceLimit: 1.5 }, 'limits'],
      [{ modules: ['accounting', 'accounting'] }, 'entitlements'],
      [{ modules: ['telepathy'] }, 'entitlements'],
      [{ features: ['Bad Code'] }, 'entitlements'],
      [{ kind: 'CLIENT_LICENSE' }, 'payload'],
      [{ v: 1 }, 'unsupported-version'],
      [{ installationId: 'not a valid id!' }, 'payload'],
      [{ customerCode: '' }, 'payload'],
      [{ customerCode: '   ' }, 'payload'],
      [{ customerCode: 'invalid spaces!' }, 'payload'],
      [
        {
          customerId: '01K7CUSTOMER00000000000000',
          customerCode: '01K7CUSTOMER00000000000000',
        },
        'payload',
      ],
    ];

    for (const [overrides, expected] of cases) {
      expect(
        reasonOf(() =>
          parseLicenseDocument(
            signWire(wire(overrides)),
            trusted(AUTHORITY.publicKey),
          ),
        ),
      ).toBe(expected);
    }

    const withoutCustomerCode = wire();
    delete withoutCustomerCode['customerCode'];
    expect(
      reasonOf(() =>
        parseLicenseDocument(
          signWire(withoutCustomerCode),
          trusted(AUTHORITY.publicKey),
        ),
      ),
    ).toBe('payload');

    // A document cannot retire itself.
    const operationId = generateId();
    expect(
      reasonOf(() =>
        parseLicenseDocument(
          signWire(wire({ operationId, supersedesOperationId: operationId })),
          trusted(AUTHORITY.publicKey),
        ),
      ),
    ).toBe('payload');
  });

  it('hashes the artifact deterministically and irreversibly', () => {
    const { document } = issue(
      { installationId: INSTALLATION },
      AUTHORITY.privateKey,
    );
    const hash = licenseDocumentHash(document);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(licenseDocumentHash(` ${document} `)).toBe(hash);
    expect(hash).not.toContain('VLIC2');
  });
});
