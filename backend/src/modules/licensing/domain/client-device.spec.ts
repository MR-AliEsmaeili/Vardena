import {
  createHash,
  generateKeyPairSync,
  sign as cryptoSign,
} from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEVICE_REPLACEMENT_RESPONSE_FILE_FORMAT,
  DEVICE_REPLACEMENT_RESPONSE_FORMAT,
  DeviceProtocolError,
  canonicalizeDeviceReplacementResponse,
  canonicalizeEnrollmentChallenge,
  parseDevicePublicKey,
  serializeDeviceReplacementRequestArtifact,
  serializeDeviceReplacementRequestFile,
  validateDeviceReplacementCorrelation,
  verifyDeviceProof,
  verifyDeviceReplacementResponse,
  type DeviceReplacementCorrelation,
  type DeviceReplacementResponsePayload,
  type EnrollmentChallengePayload,
} from './client-device.js';
import { toTrustedKeys, type TrustedLicenseKey } from './license-document.js';

const issuedAt = '2026-10-01T10:00:00.000Z';
const now = new Date('2026-10-05T10:00:00.000Z');

function deviceKeyPair() {
  const pair = generateKeyPairSync('ed25519');
  return {
    publicKey: pair.publicKey
      .export({ format: 'der', type: 'spki' })
      .toString('base64url'),
    privateKey: pair.privateKey,
  };
}

function sign(
  text: string,
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
): string {
  return cryptoSign(null, Buffer.from(text, 'utf8'), privateKey).toString(
    'base64url',
  );
}

function makeEnrollmentChallenge(): {
  payload: EnrollmentChallengePayload;
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
} {
  const pair = deviceKeyPair();
  const key = parseDevicePublicKey(pair.publicKey);
  return {
    payload: {
      format: 'VDEA1',
      challengeId: 'challenge-001',
      operationId: 'operation-001',
      deviceId: 'device-001',
      installationId: 'installation-001',
      customerId: 'customer-001',
      customerCode: 'CUST-ACME-01',
      licenseId: 'license-001',
      licenseVersionId: 'version-001',
      purpose: 'DEVICE_ENROLLMENT',
      publicKey: key.encoded,
      publicKeyFingerprint: key.fingerprint,
      nonce: 'nonce-that-is-at-least-32-characters-long',
      issuedAt,
      expiresAt: '2026-10-01T10:15:00.000Z',
    },
    privateKey: pair.privateKey,
  };
}

function makeResponse(): DeviceReplacementResponsePayload {
  return {
    format: DEVICE_REPLACEMENT_RESPONSE_FORMAT,
    responseOperationId: 'response-operation-001',
    keyId: 'authority-2026',
    requestId: 'request-001',
    challengeId: 'challenge-001',
    requestOperationId: 'request-operation-001',
    requestHash: 'a'.repeat(64),
    installationId: 'installation-001',
    customerId: 'customer-001',
    customerCode: 'CUST-ACME-01',
    licenseId: 'license-001',
    licenseVersionId: 'version-001',
    oldDeviceId: 'device-old-001',
    newDeviceId: 'device-new-001',
    publicKeyFingerprint: 'b'.repeat(64),
    decision: 'APPROVE',
    issuedAt,
    expiresAt: '2026-10-20T10:00:00.000Z',
  };
}

function responseArtifact(
  payload: DeviceReplacementResponsePayload,
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
  text = canonicalizeDeviceReplacementResponse(payload),
): string {
  return [
    DEVICE_REPLACEMENT_RESPONSE_FORMAT,
    Buffer.from(text, 'utf8').toString('base64url'),
    sign(text, privateKey),
  ].join('.');
}

function correlation(
  overrides: Partial<DeviceReplacementCorrelation> = {},
): DeviceReplacementCorrelation {
  return {
    requestId: 'request-001',
    challengeId: 'challenge-001',
    requestOperationId: 'request-operation-001',
    requestHash: 'a'.repeat(64),
    installationId: 'installation-001',
    customerId: 'customer-001',
    customerCode: 'CUST-ACME-01',
    licenseId: 'license-001',
    licenseVersionId: 'version-001',
    oldDeviceId: 'device-old-001',
    newDeviceId: 'device-new-001',
    publicKeyFingerprint: 'b'.repeat(64),
    requestIssuedAt: new Date(issuedAt),
    requestExpiresAt: new Date('2026-11-01T00:00:00.000Z'),
    licenseValidFrom: new Date('2026-01-01T00:00:00.000Z'),
    licenseValidUntil: null,
    now,
    ...overrides,
  };
}

function expectProtocolError(run: () => unknown, reason: string): void {
  try {
    run();
    expect.fail('Expected a DeviceProtocolError.');
  } catch (error) {
    expect(error).toBeInstanceOf(DeviceProtocolError);
    expect(error).toMatchObject({ reason });
  }
}

describe('client-device cryptographic protocol', () => {
  it('accepts only canonical Ed25519 SPKI public keys and derives the stable fingerprint', () => {
    const pair = deviceKeyPair();
    const der = Buffer.from(pair.publicKey, 'base64url');
    const parsed = parseDevicePublicKey(pair.publicKey);

    expect(parsed.encoded).toBe(pair.publicKey);
    expect(parsed.fingerprint).toBe(
      createHash('sha256').update(der).digest('hex'),
    );
    expect(parsed.key.asymmetricKeyType).toBe('ed25519');
    expect(() => parseDevicePublicKey('not-a-public-key')).toThrow(
      DeviceProtocolError,
    );
    expect(() =>
      parseDevicePublicKey(
        generateKeyPairSync('ed25519')
          .privateKey.export({ format: 'der', type: 'pkcs8' })
          .toString('base64url'),
      ),
    ).toThrow(DeviceProtocolError);
  });

  it('pins enrollment challenge bytes and verifies proof over the exact canonical UTF-8 payload', () => {
    const { payload, privateKey } = makeEnrollmentChallenge();
    const canonical = canonicalizeEnrollmentChallenge(payload);
    const parsed = JSON.parse(canonical) as Record<string, unknown>;
    const signature = sign(canonical, privateKey);

    expect(Object.keys(parsed)).toEqual([
      'format',
      'challengeId',
      'operationId',
      'deviceId',
      'installationId',
      'customerId',
      'customerCode',
      'licenseId',
      'licenseVersionId',
      'purpose',
      'publicKey',
      'publicKeyFingerprint',
      'nonce',
      'issuedAt',
      'expiresAt',
    ]);
    expect(
      verifyDeviceProof({
        canonicalPayload: canonical,
        signature,
        publicKey: payload.publicKey,
      }),
    ).toBe(true);
    expect(
      verifyDeviceProof({
        canonicalPayload: `${canonical} `,
        signature,
        publicKey: payload.publicKey,
      }),
    ).toBe(false);
    expectProtocolError(
      () =>
        verifyDeviceProof({
          canonicalPayload: canonical,
          signature: 'not-padded-base64!',
          publicKey: payload.publicKey,
        }),
      'invalid-signature',
    );
    expectProtocolError(
      () =>
        canonicalizeEnrollmentChallenge({
          ...payload,
          publicKeyFingerprint: '0'.repeat(64),
        }),
      'malformed-challenge',
    );
  });

  it('serializes the offline request as the same signed text inside the primary file envelope', () => {
    const canonicalPayload = '{"format":"VDRQ1","requestId":"request-001"}';
    const signature = Buffer.alloc(64, 7).toString('base64url');
    const artifact = serializeDeviceReplacementRequestArtifact({
      canonicalPayload,
      signature,
    });
    const file = JSON.parse(
      serializeDeviceReplacementRequestFile(artifact),
    ) as {
      format: string;
      fileVersion: number;
      request: string;
    };

    expect(file).toEqual({
      format: 'vardena-device-replacement-request',
      fileVersion: 1,
      request: artifact,
    });
    expect(artifact.split('.')[0]).toBe('VDRQ1');
    expect(Buffer.from(artifact.split('.')[1]!, 'base64url').toString()).toBe(
      canonicalPayload,
    );
    expect(() =>
      serializeDeviceReplacementRequestArtifact({
        canonicalPayload,
        signature: Buffer.alloc(63, 7).toString('base64url'),
      }),
    ).toThrow(DeviceProtocolError);
  });

  it('verifies strict response signatures identically for text and the JSON file envelope', () => {
    const authority = generateKeyPairSync('ed25519');
    const payload = makeResponse();
    const artifact = responseArtifact(payload, authority.privateKey);
    const trustedKeys: TrustedLicenseKey[] = toTrustedKeys([
      { id: payload.keyId, key: authority.publicKey },
    ]);
    const asText = verifyDeviceReplacementResponse(artifact, trustedKeys);
    const asFile = verifyDeviceReplacementResponse(
      JSON.stringify({
        format: DEVICE_REPLACEMENT_RESPONSE_FILE_FORMAT,
        fileVersion: 1,
        response: artifact,
      }),
      trustedKeys,
    );

    expect(asText).toMatchObject({
      payload,
      artifact,
      transport: 'text',
      artifactHash: createHash('sha256').update(artifact).digest('hex'),
    });
    expect(asFile).toMatchObject({
      payload,
      artifact,
      transport: 'file',
    });
  });

  it('rejects response key, signature, canonical form, unknown envelope keys and oversize input', () => {
    const authority = generateKeyPairSync('ed25519');
    const payload = makeResponse();
    const artifact = responseArtifact(payload, authority.privateKey);
    const trustedKeys = toTrustedKeys([
      { id: payload.keyId, key: authority.publicKey },
    ]);

    expectProtocolError(
      () => verifyDeviceReplacementResponse(artifact, []),
      'unknown-signing-key',
    );
    const [prefix, body, signature] = artifact.split('.');
    const changedSignature = `${signature![0] === 'A' ? 'B' : 'A'}${signature!.slice(1)}`;
    expectProtocolError(
      () =>
        verifyDeviceReplacementResponse(
          `${prefix}.${body}.${changedSignature}`,
          trustedKeys,
        ),
      'response-signature',
    );

    const pretty = JSON.stringify(payload, null, 2);
    expectProtocolError(
      () =>
        verifyDeviceReplacementResponse(
          responseArtifact(payload, authority.privateKey, pretty),
          trustedKeys,
        ),
      'malformed-response',
    );
    expectProtocolError(
      () =>
        verifyDeviceReplacementResponse(
          JSON.stringify({
            format: DEVICE_REPLACEMENT_RESPONSE_FILE_FORMAT,
            fileVersion: 1,
            response: artifact,
            extra: true,
          }),
          trustedKeys,
        ),
      'malformed-response',
    );
    expectProtocolError(
      () => verifyDeviceReplacementResponse('x'.repeat(65_537), trustedKeys),
      'malformed-response',
    );
  });

  it('checks every signed-response correlation and validity boundary against the retained request and license', () => {
    const response = makeResponse();
    expect(() =>
      validateDeviceReplacementCorrelation({
        response,
        request: correlation(),
      }),
    ).not.toThrow();
    expectProtocolError(
      () =>
        validateDeviceReplacementCorrelation({
          response,
          request: correlation({ requestHash: 'c'.repeat(64) }),
        }),
      'malformed-response',
    );
    expectProtocolError(
      () =>
        validateDeviceReplacementCorrelation({
          response: { ...response, expiresAt: '2026-10-05T10:00:00.000Z' },
          request: correlation(),
        }),
      'malformed-response',
    );
    expectProtocolError(
      () =>
        validateDeviceReplacementCorrelation({
          response: { ...response, expiresAt: '2026-11-02T00:00:00.000Z' },
          request: correlation(),
        }),
      'malformed-response',
    );
  });
});
