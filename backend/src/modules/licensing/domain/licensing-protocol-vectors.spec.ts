import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createHash,
  createPublicKey,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import {
  LicenseDocumentError,
  parseLicenseDocument,
} from './license-document.js';
import { LicenseCodeError, parseLicenseCode } from './license-code.js';
import {
  DeviceProtocolError,
  canonicalizeDeviceReplacementChallenge,
  serializeDeviceReplacementRequestFile,
  validateDeviceReplacementCorrelation,
  verifyDeviceReplacementResponse,
  type DeviceReplacementCorrelation,
} from './client-device.js';
import { parsePublicKey } from './license-code.js';
import { toTrustedKeys } from './license-document.js';

const VECTORS_ROOT = join(process.cwd(), '..', 'docs', 'licensing', 'vectors');

function loadDir(sub: string): any[] {
  const dir = join(VECTORS_ROOT, sub);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

function loadKeyFixture(name: string): any {
  return JSON.parse(
    readFileSync(join(VECTORS_ROOT, 'keys', `${name}.json`), 'utf8'),
  );
}

function spkiPublicKey(base64Der: string): KeyObject {
  return createPublicKey({
    key: Buffer.from(base64Der, 'base64'),
    format: 'der',
    type: 'spki',
  });
}

function sha256hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Independent VDRQ1 / requestHash oracle.
//
// Every expectation in the tests below is either (a) a literal pinned in this
// file, or (b) computed here from the COMMITTED fixture bytes with node:crypto
// alone. Nothing is derived at test time from the production canonicalizers or
// from the vector generator, so a regression in either one fails these tests
// instead of being silently reproduced by them. The previous version of this
// oracle rebuilt the armored artifact from the generator's own canonical bytes,
// re-signed it with a key the generator also used, and compared the result to a
// digest computed in the same breath — a tautology that passed even though the
// committed OK-03 fixture was signed by the wrong key.
//
// The VDRQ1 verifier is deliberately re-implemented here instead of imported:
// the customer runtime only ever SERIALIZES a VDRQ1 (the device signature has
// already been verified at proof time by `verifyDeviceProof`), so there is no
// production VDRQ1 parser to import. This is test-tree code only. It is not an
// Owner-side issuer and adds no VDRQ1 parsing to any production module,
// endpoint or build target (ADR-0048 separation boundary, Proposed;
// ADR-0046 Decision 9).
// ---------------------------------------------------------------------------

/** Ed25519 detached signature length in bytes. */
const ED25519_SIGNATURE_BYTES = 64;

/** Pinned: SHA-256 hex of the committed OK-03 armored VDRQ1 artifact string. */
const VDRQ1_ARMORED_SHA256 =
  'eeccbe4c57207ad6cb2c9a5967e1538b543a44f02e1d9bc6448bda687de6a3b0';

/** Pinned: SHA-256 of the DECODED canonical payload — must never be the hash. */
const VDRQ1_PAYLOAD_ONLY_SHA256 =
  '83268d74f4fb3ab00332cb3d169158946b93404449c91cd977b9f11bb7db79dc';

/** Pinned: SHA-256 of the JSON file envelope — must never be the hash. */
const VDRQ1_FILE_ENVELOPE_SHA256 =
  'a16487b3293d1e7c4df4e7e1dfa8b519d700762da0ddef326d1a7d96d3d9be2a';

/** Pinned: SHA-256 of the same payload with its field order reversed. */
const VDRQ1_REORDERED_FIELDS_SHA256 =
  '344cd591827a32a3e97461d3bdfdcbe51318fb11d1bdee6fcfacba826c50e15d';

/**
 * Pinned: full 64-hex SHA-256 of the device SPKI DER. This is the DEVICE
 * fingerprint convention — not the authority `keyId` convention
 * (`sha256-<first 16 hex>`); vectors §3.2 warns against conflating them.
 */
const VDRQ1_DEVICE_FINGERPRINT =
  '90d31a35753045d5a8cf431f9046924cebfffe339f27ea6f9d2bdaec0ed2a310';

interface ParsedVdrq1 {
  prefix: string;
  canonicalBytes: Buffer;
  canonicalUtf8: string;
  signature: Buffer;
  payload: Record<string, unknown>;
}

/**
 * Parse an armored VDRQ1 from the documented wire format only
 * (`VDRQ1.<base64url canonical payload>.<base64url Ed25519 signature>`).
 * Structural problems throw; cryptographic verification is separate so a test
 * can assert refusal rather than receive an exception it did not ask for.
 */
function parseVdrq1(artifact: string): ParsedVdrq1 {
  const segments = artifact.split('.');
  if (segments.length !== 3) {
    throw new Error(
      `VDRQ1 must have exactly 3 segments, got ${segments.length}`,
    );
  }
  const canonicalBytes = Buffer.from(segments[1]!, 'base64url');
  const canonicalUtf8 = canonicalBytes.toString('utf8');
  return {
    prefix: segments[0]!,
    canonicalBytes,
    canonicalUtf8,
    signature: Buffer.from(segments[2]!, 'base64url'),
    payload: JSON.parse(canonicalUtf8) as Record<string, unknown>,
  };
}

/** Verify the detached Ed25519 signature over the exact canonical bytes. */
function vdrq1SignatureValid(
  parsed: ParsedVdrq1,
  publicKey: KeyObject,
): boolean {
  if (parsed.signature.length !== ED25519_SIGNATURE_BYTES) return false;
  try {
    return cryptoVerify(
      null,
      parsed.canonicalBytes,
      publicKey,
      parsed.signature,
    );
  } catch {
    return false;
  }
}

describe('licensing protocol vector corpus (Phase 1)', () => {
  it('corpus directory exists', () => {
    expect(existsSync(VECTORS_ROOT)).toBe(true);
  });

  it('canonical vectors have required fields, inputs, and byte consistency', () => {
    const vecs = loadDir('canonical');
    expect(vecs.length).toBeGreaterThan(0);
    for (const v of vecs) {
      expect(v.id).toMatch(/^CAN-/);
      expect(typeof v.protocolVersion).toBe('string');
      expect(typeof v.canonicalizationCase).toBe('string');
      expect(v.input).toBeTruthy();
      expect(typeof v.expectedCanonicalUtf8).toBe('string');
      expect(typeof v.expectedCanonicalUtf8Hex).toBe('string');
      expect(Buffer.from(v.expectedCanonicalUtf8, 'utf8').toString('hex')).toBe(
        v.expectedCanonicalUtf8Hex,
      );
      expect(() => JSON.parse(v.expectedCanonicalUtf8)).not.toThrow();
      expect(typeof v.normalizationNotes).toBe('string');
    }
  });

  it('keys are test-only fixtures with required fields', () => {
    const keys = loadDir('keys');
    expect(keys.length).toBeGreaterThanOrEqual(3);
    for (const k of keys) {
      expect(typeof k.publicKeySpkiBase64Url).toBe('string');
      expect(typeof k.fingerprint).toBe('string');
      expect(k.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(k.label).toContain('TEST-ONLY');
    }
  });

  it('valid VLIC2 artifact verifies against authority A', () => {
    const vecs = loadDir('valid');
    const v = vecs.find((x: any) => x.protocolVersion === 'VLIC2');
    expect(v).toBeTruthy();
    const keyJson = JSON.parse(
      readFileSync(join(VECTORS_ROOT, 'keys', 'authority-a.json'), 'utf8'),
    );
    const trusted = toTrustedKeys([
      { key: parsePublicKey(keyJson.publicKeySpkiBase64) },
    ]);
    const verified = parseLicenseDocument(v.artifact, trusted);
    expect(verified.keyId).toBe(keyJson.keyId);
  });

  it('valid VLIC1 legacy artifact verifies', () => {
    const vecs = loadDir('valid');
    const v = vecs.find((x: any) => x.protocolVersion === 'VLIC1');
    expect(v).toBeTruthy();
    const keyJson = JSON.parse(
      readFileSync(join(VECTORS_ROOT, 'keys', 'authority-a.json'), 'utf8'),
    );
    const keys = [parsePublicKey(keyJson.publicKeySpkiBase64)];
    const parsed = parseLicenseCode(v.artifact, keys);
    expect(parsed.licenseId).toBeTruthy();
  });

  it('valid VDRP1 approval response verifies', () => {
    const vecs = loadDir('valid');
    const v = vecs.find((x: any) => x.protocolVersion === 'VDRP1');
    expect(v).toBeTruthy();
    const keyJson = JSON.parse(
      readFileSync(join(VECTORS_ROOT, 'keys', 'authority-a.json'), 'utf8'),
    );
    const trusted = toTrustedKeys([
      { id: keyJson.keyId, key: parsePublicKey(keyJson.publicKeySpkiBase64) },
    ]);
    const verified = verifyDeviceReplacementResponse(v.artifact, trusted);
    expect(verified.payload.decision).toBe('APPROVE');
  });

  it('invalid VLIC2 artifacts throw LicenseDocumentError with expected reason', () => {
    const vecs = loadDir('invalid').filter(
      (x: any) => x.protocolVersion === 'VLIC2',
    );
    const keyJson = JSON.parse(
      readFileSync(join(VECTORS_ROOT, 'keys', 'authority-a.json'), 'utf8'),
    );
    const trusted = toTrustedKeys([
      { key: parsePublicKey(keyJson.publicKeySpkiBase64) },
    ]);
    for (const v of vecs) {
      let thrown: any;
      try {
        parseLicenseDocument(v.artifact, trusted);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(LicenseDocumentError);
      expect((thrown as LicenseDocumentError).reason).toBe(v.expectedReason);
    }
  });

  it('invalid VDRP1 artifact throws DeviceProtocolError with expected reason', () => {
    const vecs = loadDir('invalid').filter(
      (x: any) => x.protocolVersion === 'VDRP1',
    );
    const keyJson = JSON.parse(
      readFileSync(join(VECTORS_ROOT, 'keys', 'authority-a.json'), 'utf8'),
    );
    const trusted = toTrustedKeys([
      { id: keyJson.keyId, key: parsePublicKey(keyJson.publicKeySpkiBase64) },
    ]);
    for (const v of vecs) {
      let thrown: any;
      try {
        verifyDeviceReplacementResponse(v.artifact, trusted);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(DeviceProtocolError);
      expect((thrown as DeviceProtocolError).reason).toBe(v.expectedReason);
    }
  });

  it('negative control: wrong expected reason fails', () => {
    // A tampered payload must not be reported as 'payload' (it is 'signature').
    const vecs = loadDir('invalid').filter(
      (x: any) => x.protocolVersion === 'VLIC2',
    );
    const tampered = vecs.find(
      (x: any) => x.name && x.name.includes('tampered'),
    );
    expect(tampered).toBeTruthy();
    const keyJson = JSON.parse(
      readFileSync(join(VECTORS_ROOT, 'keys', 'authority-a.json'), 'utf8'),
    );
    const trusted = toTrustedKeys([
      { key: parsePublicKey(keyJson.publicKeySpkiBase64) },
    ]);
    let thrown: any;
    try {
      parseLicenseDocument(tampered.artifact, trusted);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as LicenseDocumentError).reason).not.toBe('payload');
    expect((thrown as LicenseDocumentError).reason).toBe('signature');
  });

  it('key rotation: ROT-01 accepted, ROT-02 rejected', () => {
    const vecs = loadDir('rotation');
    const rot1 = vecs.find((x: any) => x.id === 'ROT-01');
    const rot2 = vecs.find((x: any) => x.id === 'ROT-02');
    expect(rot1).toBeTruthy();
    expect(rot2).toBeTruthy();
    const keyA = JSON.parse(
      readFileSync(join(VECTORS_ROOT, 'keys', 'authority-a.json'), 'utf8'),
    );
    const keyB = JSON.parse(
      readFileSync(join(VECTORS_ROOT, 'keys', 'authority-b.json'), 'utf8'),
    );
    const trustedBoth = toTrustedKeys([
      { key: parsePublicKey(keyA.publicKeySpkiBase64) },
      { key: parsePublicKey(keyB.publicKeySpkiBase64) },
    ]);
    const trustedBOnly = toTrustedKeys([
      { key: parsePublicKey(keyB.publicKeySpkiBase64) },
    ]);
    const v1 = parseLicenseDocument(rot1.artifact, trustedBoth);
    expect(v1.keyId).toBe(keyA.keyId);
    let thrown: any;
    try {
      parseLicenseDocument(rot2.artifact, trustedBOnly);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(LicenseDocumentError);
    expect((thrown as LicenseDocumentError).reason).toBe('signature');
  });

  it('deviceLimit semantics vectors', () => {
    const vecs = loadDir('canonical');
    const unspec = vecs.find(
      (x: any) => x.canonicalizationCase === 'device-limit-unspecified',
    );
    const unlim = vecs.find(
      (x: any) => x.canonicalizationCase === 'device-limit-unlimited',
    );
    expect(unspec).toBeTruthy();
    expect(unlim).toBeTruthy();
    const pUnspec = JSON.parse(unspec.expectedCanonicalUtf8);
    const pUnlim = JSON.parse(unlim.expectedCanonicalUtf8);
    expect(pUnspec).not.toHaveProperty('deviceLimit');
    expect(pUnlim.deviceLimit).toBeNull();
  });

  it('requestHash is the pinned SHA-256 of the committed armored VDRQ1', () => {
    const ok3 = loadDir('valid').find((x: any) => x.id === 'OK-03');
    const ok4 = loadDir('valid').find((x: any) => x.id === 'OK-04');
    const vdrp = loadDir('canonical').find(
      (x: any) => x.canonicalizationCase === 'approval-response',
    );
    expect(ok3).toBeTruthy();
    expect(ok4).toBeTruthy();
    expect(vdrp).toBeTruthy();

    // (1) THE ORACLE: computed here from the committed fixture bytes and
    //     compared against a literal pinned in this file. Neither the generator
    //     nor a production canonicalizer participates.
    expect(sha256hex(ok3.artifact)).toBe(VDRQ1_ARMORED_SHA256);
    // (2) the fixture's own recorded hash agrees with the independent pin
    expect(ok3.requestHash).toBe(VDRQ1_ARMORED_SHA256);
    // (3) the VDRP1 canonical vector approves exactly that hash
    expect(vdrp.input.requestHash).toBe(VDRQ1_ARMORED_SHA256);
    // (4) the committed VDRP1 artifact fixture records the same approval
    expect(ok4.approvesRequestHash).toBe(VDRQ1_ARMORED_SHA256);
    // (5) and the hash actually embedded in the signed OK-04 payload matches,
    //     read back out of the artifact rather than out of any generator state
    expect(parseVdrq1(ok3.artifact).prefix).toBe('VDRQ1');
    const ok4Body = Buffer.from(ok4.artifact.split('.')[1]!, 'base64url');
    expect(JSON.parse(ok4Body.toString('utf8')).requestHash).toBe(
      VDRQ1_ARMORED_SHA256,
    );
  });

  it('OK-03 is a committed armored VDRQ1 signed by the NEW DEVICE key', () => {
    const ok3 = loadDir('valid').find((x: any) => x.id === 'OK-03');
    expect(ok3).toBeTruthy();
    expect(ok3.protocolVersion).toBe('VDRQ1');
    expect(ok3.signer).toBe('device-01');

    const device = loadKeyFixture('device-01');
    const authorityA = loadKeyFixture('authority-a');
    const parsed = parseVdrq1(ok3.artifact);

    expect(parsed.prefix).toBe('VDRQ1');
    expect(parsed.signature).toHaveLength(ED25519_SIGNATURE_BYTES);
    // the artifact's decoded body is exactly the committed canonical bytes
    expect(parsed.canonicalBytes.toString('hex')).toBe(
      ok3.expectedCanonicalUtf8Hex,
    );
    // REGRESSION (the defect this oracle exists to catch): the detached
    // signature must verify under the device key the payload itself advertises.
    expect(
      vdrq1SignatureValid(parsed, spkiPublicKey(device.publicKeySpkiBase64)),
    ).toBe(true);
    // ... and must NOT verify under an issuing authority key. A VDRQ1 is a
    // device proof of possession, never an authority signature (vectors §4.3).
    expect(
      vdrq1SignatureValid(
        parsed,
        spkiPublicKey(authorityA.publicKeySpkiBase64),
      ),
    ).toBe(false);
    // key identity binding: payload advertises the device key that signed it
    expect(parsed.payload.publicKey).toBe(device.publicKeySpkiBase64Url);
    expect(parsed.payload.publicKeyFingerprint).toBe(VDRQ1_DEVICE_FINGERPRINT);
    expect(ok3.devicePublicKeyFingerprint).toBe(VDRQ1_DEVICE_FINGERPRINT);
    // the fingerprint really is SHA-256 over the SPKI DER (device convention)
    expect(
      createHash('sha256')
        .update(Buffer.from(device.publicKeySpkiBase64, 'base64'))
        .digest('hex'),
    ).toBe(VDRQ1_DEVICE_FINGERPRINT);
    // a VDRQ1 carries no authority key identifier at all
    expect(parsed.payload).not.toHaveProperty('keyId');
    expect(ok3).not.toHaveProperty('keyId');
  });

  it('negative control: hashing the decoded payload is NOT the requestHash', () => {
    const ok3 = loadDir('valid').find((x: any) => x.id === 'OK-03');
    const vdrp = loadDir('canonical').find(
      (x: any) => x.canonicalizationCase === 'approval-response',
    );
    const parsed = parseVdrq1(ok3.artifact);
    // vectors §3.3 names this the single most likely interop mistake
    expect(sha256hex(parsed.canonicalUtf8)).toBe(VDRQ1_PAYLOAD_ONLY_SHA256);
    expect(VDRQ1_PAYLOAD_ONLY_SHA256).not.toBe(VDRQ1_ARMORED_SHA256);
    expect(vdrp.input.requestHash).not.toBe(VDRQ1_PAYLOAD_ONLY_SHA256);
  });

  it('negative control: hashing the file envelope is NOT the requestHash', () => {
    const ok3 = loadDir('valid').find((x: any) => x.id === 'OK-03');
    // envelope shape pinned from vectors §3.4, built here without production code
    const envelope = JSON.stringify(
      {
        format: 'vardena-device-replacement-request',
        fileVersion: 1,
        request: ok3.artifact,
      },
      null,
      2,
    );
    expect(sha256hex(envelope)).toBe(VDRQ1_FILE_ENVELOPE_SHA256);
    expect(VDRQ1_FILE_ENVELOPE_SHA256).not.toBe(VDRQ1_ARMORED_SHA256);
    // the production serializer emits byte-identical envelope text
    expect(serializeDeviceReplacementRequestFile(ok3.artifact)).toBe(envelope);
  });

  it('negative control: reordering payload fields changes the digest', () => {
    const ok3 = loadDir('valid').find((x: any) => x.id === 'OK-03');
    const parsed = parseVdrq1(ok3.artifact);
    const keys = Object.keys(parsed.payload).reverse();
    const reordered: Record<string, unknown> = {};
    for (const k of keys) reordered[k] = parsed.payload[k];
    const reorderedUtf8 = JSON.stringify(reordered);

    expect(reorderedUtf8).not.toBe(parsed.canonicalUtf8);
    expect(sha256hex(reorderedUtf8)).toBe(VDRQ1_REORDERED_FIELDS_SHA256);
    expect(VDRQ1_REORDERED_FIELDS_SHA256).not.toBe(VDRQ1_ARMORED_SHA256);
    // field order is canonicalized, not preserved: re-canonicalizing the
    // reordered object through the production canonicalizer restores the exact
    // committed signed bytes (vectors §4.2 CAN-13 round-trip rule)
    expect(
      canonicalizeDeviceReplacementChallenge(parsed.payload as never),
    ).toBe(parsed.canonicalUtf8);
  });

  it('committed OK-03 request and OK-04 response correlate end to end', () => {
    const ok3 = loadDir('valid').find((x: any) => x.id === 'OK-03');
    const ok4 = loadDir('valid').find((x: any) => x.id === 'OK-04');
    const authorityA = loadKeyFixture('authority-a');
    const request = parseVdrq1(ok3.artifact).payload;

    // verify the response with the production verifier and a trusted authority
    const verified = verifyDeviceReplacementResponse(
      ok4.artifact,
      toTrustedKeys([
        {
          id: authorityA.keyId,
          key: parsePublicKey(authorityA.publicKeySpkiBase64),
        },
      ]),
    );
    expect(verified.payload.decision).toBe('APPROVE');
    expect(verified.payload.requestHash).toBe(VDRQ1_ARMORED_SHA256);

    // the retained-request side of the correlation, as the repository would
    // supply it. The license validity window is not part of the VDRQ1/VDRP1
    // fixtures, so it is stated here explicitly and bounds the response.
    const correlation: DeviceReplacementCorrelation = {
      requestId: String(request.requestId),
      challengeId: String(request.challengeId),
      requestOperationId: String(request.operationId),
      requestHash: VDRQ1_ARMORED_SHA256,
      installationId: String(request.installationId),
      customerId: String(request.customerId),
      customerCode: String(request.customerCode),
      licenseId: String(request.licenseId),
      licenseVersionId: String(request.licenseVersionId),
      oldDeviceId: String(request.oldDeviceId),
      newDeviceId: String(request.newDeviceId),
      publicKeyFingerprint: String(request.publicKeyFingerprint),
      requestIssuedAt: new Date(String(request.issuedAt)),
      requestExpiresAt: new Date(String(request.expiresAt)),
      licenseValidFrom: new Date('2026-01-01T00:00:00.000Z'),
      licenseValidUntil: new Date('2027-01-01T00:00:00.000Z'),
      now: new Date('2026-10-11T12:00:00.000Z'),
    };
    expect(() =>
      validateDeviceReplacementCorrelation({
        response: verified.payload,
        request: correlation,
      }),
    ).not.toThrow();

    // refusal path: a response correlated against a DIFFERENT request hash is
    // rejected, proving the pin above is load-bearing and not decorative
    expect(() =>
      validateDeviceReplacementCorrelation({
        response: verified.payload,
        request: { ...correlation, requestHash: VDRQ1_PAYLOAD_ONLY_SHA256 },
      }),
    ).toThrow(DeviceProtocolError);
  });
});
