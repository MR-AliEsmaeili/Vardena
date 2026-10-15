import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { canonicalizeLicenseVersion } from '../modules/licensing/domain/license-document.js';
import type { LicenseVersionPayload } from '../modules/licensing/domain/license-document.js';
import { canonicalizeEnrollmentChallenge, canonicalizeDeviceReplacementChallenge, canonicalizeDeviceReplacementResponse } from '../modules/licensing/domain/client-device.js';

// Output root: docs/licensing/vectors (relative to repo root; cwd is backend at runtime)
const ROOT = join(process.cwd(), '..', 'docs', 'licensing', 'vectors');

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sha256hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

// --- Keys (test-only) ---
import { readFileSync } from 'node:fs';
import { createPrivateKey, createPublicKey } from 'node:crypto';

// Deterministic: load committed test-only keys if present; otherwise generate
// once and persist. In CI the committed keys are always present, so output is
// byte-identical across runs.
function loadOrCreateKey(name: string, label: string): { priv: any; pub: any; json: any } {
  const path = join(ROOT, 'keys', name + '.json');
  let json: any;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    const kp = generateKeyPairSync('ed25519');
    const spki = kp.publicKey.export({ format: 'der', type: 'spki' });
    const pkcs8 = kp.privateKey.export({ format: 'der', type: 'pkcs8' });
    json = {
      label,
      privateKeyPkcs8Base64: pkcs8.toString('base64'),
      publicKeySpkiBase64: spki.toString('base64'),
      publicKeySpkiBase64Url: spki.toString('base64url'),
      fingerprint: createHash('sha256').update(spki).digest('hex'),
      keyId: name.startsWith('authority') ? 'sha256-' + createHash('sha256').update(spki).digest('hex').slice(0, 16) : undefined,
    };
    mkdirSync(join(ROOT, 'keys'), { recursive: true });
    writeJson(path, json);
  }
  const priv = createPrivateKey({ key: Buffer.from(json.privateKeyPkcs8Base64, 'base64'), format: 'der', type: 'pkcs8' });
  const pub = createPublicKey({ key: Buffer.from(json.publicKeySpkiBase64, 'base64'), format: 'der', type: 'spki' });
  if (name.startsWith('authority') && !json.keyId) {
    json.keyId = 'sha256-' + createHash('sha256').update(pub.export({ format: 'der', type: 'spki' })).digest('hex').slice(0, 16);
  }
  return { priv, pub, json };
}

mkdirSync(join(ROOT, 'keys'), { recursive: true });
const a = loadOrCreateKey('authority-a', 'TEST-ONLY authority A (never signed a real license)');
const b = loadOrCreateKey('authority-b', 'TEST-ONLY authority B (rotation)');
const d = loadOrCreateKey('device-01', 'TEST-ONLY device key (never used in production)');
const authA = { privateKey: a.priv, publicKey: a.pub };
const authB = { privateKey: b.priv, publicKey: b.pub };
const deviceKey = { privateKey: d.priv, publicKey: d.pub };
const keys: any = { 'authority-a': a.json, 'authority-b': b.json, 'device-01': d.json };
for (const [name, v] of Object.entries(keys)) {
  writeJson(join(ROOT, 'keys', name + '.json'), v);
}

// --- Canonical vectors ---
mkdirSync(join(ROOT, 'canonical'), { recursive: true });
let ci = 1;
function canonVector(name: string, payload: unknown, canonical: string): void {
  writeJson(join(ROOT, 'canonical', `CAN-${String(ci).padStart(2, '0')}.json`), {
    id: `CAN-${String(ci).padStart(2, '0')}`,
    name,
    canonicalUtf8Hex: Buffer.from(canonical, 'utf8').toString('hex'),
    canonicalUtf8: canonical,
  });
  ci++;
}

// Persian
const p1: LicenseVersionPayload = {
  version: 2, kind: 'SERVER_LICENSE_VERSION', operationId: "01TESTID000000000000000001", licenseId: "01TESTID000000000000000002",
  customerId: "01TESTID000000000000000003", customerCode: 'CUST-ACME-01', customerName: 'شرکت تست',
  installationId: "01TESTID000000000000000004", status: 'ACTIVE',
  validFrom: new Date('2027-01-01T00:00:00.000Z'), validUntil: new Date('2028-01-01T00:00:00.000Z'),
  organizationLimit: 3, userLimit: 25, deviceLimit: 12, deviceLimitSpecified: true,
  moduleEntitlements: ['accounting', 'inventory'], featureEntitlements: [],
  supersedesOperationId: null, issuedAt: new Date('2026-10-11T00:00:00.000Z'),
};
canonVector('persian customerName', p1, canonicalizeLicenseVersion(p1));

// control chars
const p2 = { ...p1, customerName: 'a\u0001b\u001f' + '\u007f' + '<>&/' + '\u2028\u2029' };
canonVector('control and boundary chars', p2, canonicalizeLicenseVersion(p2 as any));

// unspecified deviceLimit
const p3 = { ...p1, deviceLimit: null, deviceLimitSpecified: false };
canonVector('deviceLimit unspecified (omitted)', p3, canonicalizeLicenseVersion(p3 as any));

// unlimited deviceLimit
const p4 = { ...p1, deviceLimit: null, deviceLimitSpecified: true };
canonVector('deviceLimit unlimited (null)', p4, canonicalizeLicenseVersion(p4 as any));

// sorted arrays
const p5 = { ...p1, moduleEntitlements: ['users', 'accounting'], featureEntitlements: ['z', 'a'] };
canonVector('sorted modules/features', p5, canonicalizeLicenseVersion(p5 as any));

// --- Valid artifact (VLIC2) ---
mkdirSync(join(ROOT, 'valid'), { recursive: true });
const body = Buffer.from(canonicalizeLicenseVersion(p1), 'utf8');
const sig = cryptoSign(null, body, authA.privateKey);
const artifact = ['VLIC2', body.toString('base64url'), sig.toString('base64url')].join('.');
writeJson(join(ROOT, 'valid', 'OK-01.json'), {
  id: 'OK-01',
  name: 'valid VLIC2 artifact signed by authority A',
  artifact,
  keyId: keys['authority-a'].keyId,
  expectedCanonicalUtf8Hex: body.toString('hex'),
});

// --- Invalid artifacts ---
mkdirSync(join(ROOT, 'invalid'), { recursive: true });
let bi = 1;
function bad(name: string, artifact: string, reason: string): void {
  writeJson(join(ROOT, 'invalid', `BAD-${String(bi).padStart(2, '0')}.json`), {
    id: `BAD-${String(bi).padStart(2, '0')}`,
    name,
    artifact,
    expectedReason: reason,
  });
  bi++;
}
// tampered payload
const parts = artifact.split('.');
const decoded = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
decoded.userLimit = 100000;
const tamperedBody = Buffer.from(JSON.stringify(decoded), 'utf8');
const tampered = ['VLIC2', tamperedBody.toString('base64url'), parts[2]].join('.');
bad('tampered payload (signature mismatch)', tampered, 'signature');

// unknown key (signed by B, verified against A only) -> signature
const sigB = cryptoSign(null, body, authB.privateKey);
const byB = ['VLIC2', body.toString('base64url'), sigB.toString('base64url')].join('.');
bad('signed by untrusted authority B', byB, 'signature');

// malformed (missing segment)
bad('missing third segment', 'VLIC2.' + parts[1]!, 'malformed');

// unsupported version
bad('unsupported prefix VLIC9', 'VLIC9.' + parts[1]! + '.' + parts[2]!, 'unsupported-version');


// --- Rotation vectors ---
mkdirSync(join(ROOT, 'rotation'), { recursive: true });
writeJson(join(ROOT, 'rotation', 'ROT-01.json'), {
  id: 'ROT-01',
  name: 'artifact signed by A accepted while A and B trusted',
  trustKeys: ['authority-a', 'authority-b'],
  artifact,
  expectedKeyId: keys['authority-a'].keyId,
  expectedResult: 'accepted',
});

console.log('Generated licensing vectors under', ROOT);
