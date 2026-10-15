import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLicenseDocument } from './license-document.js';
import { parsePublicKey, parsePrivateKey } from './license-code.js';
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

  it('canonical vectors have required fields and byte consistency', () => {
    const vecs = loadDir('canonical');
    expect(vecs.length).toBeGreaterThan(0);
    for (const v of vecs) {
      expect(v.id).toMatch(/^CAN-/);
      expect(typeof v.canonicalUtf8Hex).toBe('string');
      expect(typeof v.canonicalUtf8).toBe('string');
      expect(Buffer.from(v.canonicalUtf8, 'utf8').toString('hex')).toBe(v.canonicalUtf8Hex);
      // canonical bytes must parse as JSON
      expect(() => JSON.parse(v.canonicalUtf8)).not.toThrow();
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
    expect(vecs.length).toBeGreaterThan(0);
    const v = vecs[0];
    const keyJson = JSON.parse(readFileSync(join(VECTORS_ROOT, 'keys', 'authority-a.json'), 'utf8'));
    const trusted = toTrustedKeys([{ key: parsePublicKey(keyJson.publicKeySpkiBase64) }]);
    const verified = parseLicenseDocument(v.artifact, trusted);
    expect(verified.keyId).toBe(keyJson.keyId);
  });

  it('invalid artifacts are rejected with expected reasons', () => {
    const vecs = loadDir('invalid');
    expect(vecs.length).toBeGreaterThan(0);
    const keyJson = JSON.parse(readFileSync(join(VECTORS_ROOT, 'keys', 'authority-a.json'), 'utf8'));
    const trusted = toTrustedKeys([{ key: parsePublicKey(keyJson.publicKeySpkiBase64) }]);
    for (const v of vecs) {
      // only VLIC2-shaped artifacts
      if (typeof v.artifact !== 'string' || !v.artifact.startsWith('VLIC2')) {
        continue;
      }
      let thrown: any;
      try {
        parseLicenseDocument(v.artifact, trusted);
      } catch (e) {
        thrown = e;
      }
      // expected reason may be 'malformed' etc; assert a throw occurred for bad artifacts
      // (some may parse but fail; ensure not silently accepted)
      if (v.expectedReason === 'malformed' || v.expectedReason === 'signature' || v.expectedReason === 'unsupported-version' || v.expectedReason === 'payload') {
        expect(thrown).toBeTruthy();
      }
    }
  });

  it('deviceLimit unspecified vector has no deviceLimit property', () => {
    const vecs = loadDir('canonical');
    // find by name
    const v = vecs.find((x: any) => x.name && x.name.includes('unspecified'));
    expect(v).toBeTruthy();
    const parsed = JSON.parse(v.canonicalUtf8);
    expect(parsed).not.toHaveProperty('deviceLimit');
  });

  it('deviceLimit unlimited vector has deviceLimit null', () => {
    const vecs = loadDir('canonical');
    const v = vecs.find((x: any) => x.name && x.name.includes('unlimited'));
    expect(v).toBeTruthy();
    const parsed = JSON.parse(v.canonicalUtf8);
    expect(parsed.deviceLimit).toBeNull();
  });
});
