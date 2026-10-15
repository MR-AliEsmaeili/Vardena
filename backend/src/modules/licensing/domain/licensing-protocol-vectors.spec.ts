import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHash, createPrivateKey, sign as cryptoSign } from 'node:crypto';
import {
  LicenseDocumentError,
  parseLicenseDocument,
} from './license-document.js';
import { LicenseCodeError, parseLicenseCode } from './license-code.js';
import {
  DeviceProtocolError,
  verifyDeviceReplacementResponse,
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

  it('requestHash is SHA-256 of armored VDRQ1 artifact', () => {
    const vecs = loadDir('canonical');
    const vdrp = vecs.find(
      (x: any) => x.canonicalizationCase === 'approval-response',
    );
    expect(vdrp).toBeTruthy();
    const vdrq = vecs.find(
      (x: any) => x.canonicalizationCase === 'replacement-request',
    );
    expect(vdrq).toBeTruthy();
    // reconstruct armored request artifact from canonical bytes
    // verify the stored requestHash matches sha256 of armored VDRQ1
    const vdrqCanonical = vdrq.expectedCanonicalUtf8;
    const body = Buffer.from(vdrqCanonical, 'utf8');
    const keyJson = JSON.parse(
      readFileSync(join(VECTORS_ROOT, 'keys', 'authority-a.json'), 'utf8'),
    );
    const priv = createPrivateKey({
      key: Buffer.from(keyJson.privateKeyPkcs8Base64, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
    const sig = cryptoSign(null, body, priv);
    const armored =
      'VDRQ1.' + body.toString('base64url') + '.' + sig.toString('base64url');
    const expectedHash = createHash('sha256')
      .update(armored, 'utf8')
      .digest('hex');
    expect(vdrp.input.requestHash).toBe(expectedHash);
  });
});
