import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
} from 'node:crypto';
import { canonicalizeLicenseVersion } from '../modules/licensing/domain/license-document.js';
import type { LicenseVersionPayload } from '../modules/licensing/domain/license-document.js';
import { canonicalizeLicenseCodePayload } from '../modules/licensing/domain/license-code.js';
import { canonicalizeRevocation } from '../modules/licensing/domain/license-revocation.js';
import type { RevocationPayload } from '../modules/licensing/domain/license-revocation.js';
import type { LicensePayload } from '../modules/licensing/domain/license-code.js';
import {
  canonicalizeEnrollmentChallenge,
  canonicalizeDeviceReplacementChallenge,
  canonicalizeDeviceReplacementResponse,
  serializeDeviceReplacementRequestArtifact,
  DEVICE_REPLACEMENT_REQUEST_FORMAT,
} from '../modules/licensing/domain/client-device.js';
import type {
  EnrollmentChallengePayload,
  DeviceReplacementChallengePayload,
  DeviceReplacementResponsePayload,
} from '../modules/licensing/domain/client-device.js';

const ROOT = join(process.cwd(), '..', 'docs', 'licensing', 'vectors');

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function sha256hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

// --- Fail-safe key loading: missing/malformed fixture is a hard error ---
function loadKey(name: string): { priv: any; pub: any; json: any } {
  const path = join(ROOT, 'keys', name + '.json');
  if (!existsSync(path)) {
    throw new Error(
      `Missing committed test key fixture: ${path}. Regeneration is not allowed to invent keys.`,
    );
  }
  let json: any;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`Malformed test key fixture ${path}: ${String(e)}`);
  }
  if (
    typeof json.privateKeyPkcs8Base64 !== 'string' ||
    typeof json.publicKeySpkiBase64 !== 'string'
  ) {
    throw new Error(`Invalid test key fixture ${path}: missing key material.`);
  }
  if (typeof json.label !== 'string' || !json.label.includes('TEST-ONLY')) {
    throw new Error(
      `Invalid test key fixture ${path}: missing TEST-ONLY label.`,
    );
  }
  const priv = createPrivateKey({
    key: Buffer.from(json.privateKeyPkcs8Base64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const pub = createPublicKey({
    key: Buffer.from(json.publicKeySpkiBase64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  return { priv, pub, json };
}

mkdirSync(join(ROOT, 'keys'), { recursive: true });

const a = loadKey('authority-a');
const b = loadKey('authority-b');
const dev = loadKey('device-01');
const authA = { privateKey: a.priv, publicKey: a.pub };
const authB = { privateKey: b.priv, publicKey: b.pub };

// Fixed IDs
const OP = '01TESTOPERATION00000000000';
const LIC = '01TESTLICENSE0000000000000';
const CUST = '01TESTCUSTOMER000000000000';
const CUSTCODE = 'CUST-TEST-01';
const INST = '01TESTINSTALLATION000000000';
const DEV = '01TESTDEVICE00000000000000';

// --- Canonical vectors ---
for (const sub of ['canonical', 'valid', 'invalid', 'rotation', 'revocation']) {
  mkdirSync(join(ROOT, sub), { recursive: true });
}

let ci = 1;
function canonVector(
  name: string,
  version: string,
  caseName: string,
  input: unknown,
  canonical: string,
  notes: string,
): void {
  writeJson(
    join(ROOT, 'canonical', `CAN-${String(ci).padStart(2, '0')}.json`),
    {
      id: `CAN-${String(ci).padStart(2, '0')}`,
      name,
      protocolVersion: version,
      canonicalizationCase: caseName,
      input,
      expectedCanonicalUtf8: canonical,
      expectedCanonicalUtf8Hex: Buffer.from(canonical, 'utf8').toString('hex'),
      normalizationNotes: notes,
    },
  );
  ci++;
}

// VLIC2 Persian
const vlic2Input = {
  v: 2,
  kind: 'SERVER_LICENSE_VERSION',
  operationId: OP,
  licenseId: LIC,
  customerId: CUST,
  customerCode: CUSTCODE,
  customerName: 'شرکت تست',
  installationId: INST,
  status: 'ACTIVE',
  validFrom: '2027-01-01T00:00:00.000Z',
  validUntil: '2028-01-01T00:00:00.000Z',
  organizationLimit: 3,
  userLimit: 25,
  deviceLimit: 12,
  modules: ['inventory', 'accounting'],
  features: [],
  supersedesOperationId: null,
  issuedAt: '2026-10-11T00:00:00.000Z',
  deviceLimitSpecified: true,
};
const vlic2Payload: LicenseVersionPayload = {
  version: 2,
  kind: 'SERVER_LICENSE_VERSION',
  operationId: OP,
  licenseId: LIC,
  customerId: CUST,
  customerCode: CUSTCODE,
  customerName: 'شرکت تست',
  installationId: INST,
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
canonVector(
  'VLIC2 Persian customerName',
  'VLIC2',
  'persian-raw-utf8',
  vlic2Input,
  canonicalizeLicenseVersion(vlic2Payload),
  'modules/features sorted; deviceLimit present because specified; dates via toISOString.',
);

// VLIC2 control/boundary
const vlic2bInput = {
  ...vlic2Input,
  customerName: 'a\u0001b\u001f' + '\u007f' + '<>&/' + '\u2028\u2029',
};
const vlic2bPayload = {
  ...vlic2Payload,
  customerName: 'a\u0001b\u001f' + '\u007f' + '<>&/' + '\u2028\u2029',
};
canonVector(
  'VLIC2 control and boundary chars',
  'VLIC2',
  'control-chars',
  vlic2bInput,
  canonicalizeLicenseVersion(vlic2bPayload as any),
  'C0 -> \\\\u00xx lowercase; U+007F/U+2028/U+2029/<>&/ raw.',
);

// VLIC2 unspecified deviceLimit
const vlic2uInput = { ...vlic2Input };
delete (vlic2uInput as any).deviceLimit;
(vlic2uInput as any).deviceLimitSpecified = false;
const vlic2uPayload = {
  ...vlic2Payload,
  deviceLimit: null,
  deviceLimitSpecified: false,
};
canonVector(
  'VLIC2 deviceLimit unspecified (omitted)',
  'VLIC2',
  'device-limit-unspecified',
  vlic2uInput,
  canonicalizeLicenseVersion(vlic2uPayload as any),
  'deviceLimit omitted from signed bytes when unspecified.',
);

// VLIC2 unlimited deviceLimit
const vlic2nInput = {
  ...vlic2Input,
  deviceLimit: null,
  deviceLimitSpecified: true,
};
const vlic2nPayload = {
  ...vlic2Payload,
  deviceLimit: null,
  deviceLimitSpecified: true,
};
canonVector(
  'VLIC2 deviceLimit unlimited (null)',
  'VLIC2',
  'device-limit-unlimited',
  vlic2nInput,
  canonicalizeLicenseVersion(vlic2nPayload as any),
  'deviceLimit present null when explicitly unlimited.',
);

// VLIC1 legacy
const vlic1Input = {
  v: 1,
  licenseId: LIC,
  customerId: CUST,
  customerCode: CUSTCODE,
  customerName: 'Acme Holding',
  installationId: INST,
  status: 'ACTIVE',
  validFrom: '2027-01-01T00:00:00.000Z',
  validUntil: '2028-01-01T00:00:00.000Z',
  organizationLimit: 3,
  userLimit: 25,
  modules: ['inventory', 'accounting'],
  features: [],
};
const vlic1Payload: LicensePayload = {
  version: 1,
  licenseId: LIC,
  customerId: CUST,
  customerCode: CUSTCODE,
  customerName: 'Acme Holding',
  installationId: INST,
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
canonVector(
  'VLIC1 legacy payload',
  'VLIC1',
  'legacy-compat',
  vlic1Input,
  canonicalizeLicenseCodePayload(vlic1Payload),
  'VLIC1 has no deviceLimit field; canonical bytes ASCII-only.',
);

// VDEA1
const pubDer = dev.pub.export({ format: 'der', type: 'spki' });
const fp = createHash('sha256').update(pubDer).digest('hex');
const vdeaInput = {
  format: 'VDEA1',
  challengeId: '01TESTCHALLENGE0000000000',
  operationId: OP,
  deviceId: DEV,
  installationId: INST,
  customerId: CUST,
  customerCode: CUSTCODE,
  licenseId: LIC,
  licenseVersionId: '01TESTVERSION00000000000',
  purpose: 'DEVICE_ENROLLMENT',
  publicKey: pubDer.toString('base64url'),
  publicKeyFingerprint: fp,
  nonce: 'n'.repeat(32),
  issuedAt: '2026-10-11T00:00:00.000Z',
  expiresAt: '2026-10-11T00:15:00.000Z',
};
const vdeaPayload: EnrollmentChallengePayload = {
  format: 'VDEA1',
  challengeId: '01TESTCHALLENGE0000000000',
  operationId: OP,
  deviceId: DEV,
  installationId: INST,
  customerId: CUST,
  customerCode: CUSTCODE,
  licenseId: LIC,
  licenseVersionId: '01TESTVERSION00000000000',
  purpose: 'DEVICE_ENROLLMENT',
  publicKey: pubDer.toString('base64url'),
  publicKeyFingerprint: fp,
  nonce: 'n'.repeat(32),
  issuedAt: '2026-10-11T00:00:00.000Z',
  expiresAt: '2026-10-11T00:15:00.000Z',
};
canonVector(
  'VDEA1 enrollment challenge',
  'VDEA1',
  'enrollment-challenge',
  vdeaInput,
  canonicalizeEnrollmentChallenge(vdeaPayload),
  'Fixed key order; publicKey fingerprint must match key.',
);

// VDRQ1
const vdrqInput = {
  format: 'VDRQ1',
  requestId: '01TESTREQUEST000000000000',
  challengeId: '01TESTCHALLENGE0000000000',
  operationId: OP,
  installationId: INST,
  customerId: CUST,
  customerCode: CUSTCODE,
  licenseId: LIC,
  licenseVersionId: '01TESTVERSION00000000000',
  oldDeviceId: DEV,
  newDeviceId: '01TESTDEVICE200000000000',
  publicKey: pubDer.toString('base64url'),
  publicKeyFingerprint: fp,
  nonce: 'n'.repeat(32),
  issuedAt: '2026-10-11T00:00:00.000Z',
  challengeExpiresAt: '2026-10-11T00:15:00.000Z',
  expiresAt: '2026-11-10T00:00:00.000Z',
};
const vdrqPayload: DeviceReplacementChallengePayload = {
  format: 'VDRQ1',
  requestId: '01TESTREQUEST000000000000',
  challengeId: '01TESTCHALLENGE0000000000',
  operationId: OP,
  installationId: INST,
  customerId: CUST,
  customerCode: CUSTCODE,
  licenseId: LIC,
  licenseVersionId: '01TESTVERSION00000000000',
  oldDeviceId: DEV,
  newDeviceId: '01TESTDEVICE200000000000',
  publicKey: pubDer.toString('base64url'),
  publicKeyFingerprint: fp,
  nonce: 'n'.repeat(32),
  issuedAt: '2026-10-11T00:00:00.000Z',
  challengeExpiresAt: '2026-10-11T00:15:00.000Z',
  expiresAt: '2026-11-10T00:00:00.000Z',
};
const vdrqCanonical = canonicalizeDeviceReplacementChallenge(vdrqPayload);
canonVector(
  'VDRQ1 replacement request',
  'VDRQ1',
  'replacement-request',
  vdrqInput,
  vdrqCanonical,
  'requestHash is SHA-256 of the armored VDRQ1 artifact string.',
);

// Armored VDRQ1 request artifact, built ONCE here and reused both for the OK-03
// fixture and for the VDRP1 `requestHash` below, so the corpus cannot drift
// internally between the request it publishes and the response that references it.
//
// A VDRQ1 carries the NEW DEVICE's detached Ed25519 proof of possession over the
// exact canonical request bytes — never an authority signature. Authority:
// docs/licensing/licensing-protocol-vectors.md §4.3 ("VDRQ1 request, device
// signature over exact canonical bytes") and the customer API contract
// ("Exact fixed-order VDRQ1 challenge bytes to sign with the new device private
// key"). The canonical payload advertises the device's own SPKI public key and
// its full 64-hex fingerprint, so an authority-signed VDRQ1 fixture is one that
// no conforming verifier can accept: the signature would not verify against the
// key the artifact itself carries.
const vdrqBody = Buffer.from(vdrqCanonical, 'utf8');
const vdrqSig = cryptoSign(null, vdrqBody, dev.priv);
const vdrqArtifact = serializeDeviceReplacementRequestArtifact({
  canonicalPayload: vdrqCanonical,
  signature: b64url(vdrqSig),
});
// `requestHash` is the SHA-256 hex digest of the armored artifact STRING as
// UTF-8 (vectors §3.3) — not of the decoded canonical payload, and not of the
// JSON file envelope that transports it.
const vdrqRequestHash = sha256hex(vdrqArtifact);

// VDRP1
const vdrpInput = {
  format: 'VDRP1',
  responseOperationId: '01TESTRESPONSE0000000000',
  keyId: a.json.keyId,
  requestId: '01TESTREQUEST000000000000',
  challengeId: '01TESTCHALLENGE0000000000',
  requestOperationId: OP,
  requestHash: vdrqRequestHash,
  installationId: INST,
  customerId: CUST,
  customerCode: CUSTCODE,
  licenseId: LIC,
  licenseVersionId: '01TESTVERSION00000000000',
  oldDeviceId: DEV,
  newDeviceId: '01TESTDEVICE200000000000',
  publicKeyFingerprint: fp,
  decision: 'APPROVE',
  issuedAt: '2026-10-11T00:00:00.000Z',
  expiresAt: '2026-10-12T00:00:00.000Z',
};
const vdrpPayload: DeviceReplacementResponsePayload = {
  format: 'VDRP1',
  responseOperationId: '01TESTRESPONSE0000000000',
  keyId: a.json.keyId,
  requestId: '01TESTREQUEST000000000000',
  challengeId: '01TESTCHALLENGE0000000000',
  requestOperationId: OP,
  requestHash: vdrpInput.requestHash,
  installationId: INST,
  customerId: CUST,
  customerCode: CUSTCODE,
  licenseId: LIC,
  licenseVersionId: '01TESTVERSION00000000000',
  oldDeviceId: DEV,
  newDeviceId: '01TESTDEVICE200000000000',
  publicKeyFingerprint: fp,
  decision: 'APPROVE',
  issuedAt: '2026-10-11T00:00:00.000Z',
  expiresAt: '2026-10-12T00:00:00.000Z',
};
canonVector(
  'VDRP1 approval response',
  'VDRP1',
  'approval-response',
  vdrpInput,
  canonicalizeDeviceReplacementResponse(vdrpPayload),
  'decision is APPROVE only; requestHash over armored VDRQ1.',
);

// VLIC2 renewal reference (OD-LIC-06 / OQ-88), appended so every existing
// vector keeps its id, bytes, digest and signature. An early renewal: signed
// and issued on 2026-10-11 for a term that starts where the version it renews
// ends (2027-01-01), with `renewsOperationId` between `supersedesOperationId`
// and `issuedAt`. A document without the field is byte-identical to the
// pre-OQ-88 corpus, which CAN-01..CAN-08 continue to pin.
const renewalOperationId = '01TESTRENEWALOP00000000000';
const vlic2RenewalInput = {
  v: 2,
  kind: 'SERVER_LICENSE_VERSION',
  operationId: renewalOperationId,
  licenseId: LIC,
  customerId: CUST,
  customerCode: CUSTCODE,
  customerName: 'شرکت تست',
  installationId: INST,
  status: 'ACTIVE',
  validFrom: '2026-10-11T00:00:00.000Z',
  validUntil: '2028-01-01T00:00:00.000Z',
  organizationLimit: 3,
  userLimit: 25,
  deviceLimit: 12,
  modules: ['inventory', 'accounting'],
  features: [],
  supersedesOperationId: null,
  renewsOperationId: OP,
  issuedAt: '2026-10-11T00:00:00.000Z',
  deviceLimitSpecified: true,
};
const vlic2RenewalPayload: LicenseVersionPayload = {
  version: 2,
  kind: 'SERVER_LICENSE_VERSION',
  operationId: renewalOperationId,
  licenseId: LIC,
  customerId: CUST,
  customerCode: CUSTCODE,
  customerName: 'شرکت تست',
  installationId: INST,
  status: 'ACTIVE',
  validFrom: new Date('2026-10-11T00:00:00.000Z'),
  validUntil: new Date('2028-01-01T00:00:00.000Z'),
  organizationLimit: 3,
  userLimit: 25,
  deviceLimit: 12,
  deviceLimitSpecified: true,
  moduleEntitlements: ['inventory', 'accounting'],
  featureEntitlements: [],
  supersedesOperationId: null,
  renewsOperationId: OP,
  issuedAt: new Date('2026-10-11T00:00:00.000Z'),
};
canonVector(
  'VLIC2 renewal reference to a retained version',
  'VLIC2',
  'renewal-reference',
  vlic2RenewalInput,
  canonicalizeLicenseVersion(vlic2RenewalPayload),
  'renewsOperationId emitted between supersedesOperationId and issuedAt; omitted entirely when null, so pre-OQ-88 documents keep their exact bytes.',
);

// --- Valid artifacts ---
const vlic2Body = Buffer.from(canonicalizeLicenseVersion(vlic2Payload), 'utf8');
const vlic2Sig = cryptoSign(null, vlic2Body, authA.privateKey);
const vlic2Artifact = [
  'VLIC2',
  vlic2Body.toString('base64url'),
  vlic2Sig.toString('base64url'),
].join('.');
writeJson(join(ROOT, 'valid', 'OK-01.json'), {
  id: 'OK-01',
  name: 'valid VLIC2 artifact signed by authority A',
  protocolVersion: 'VLIC2',
  artifact: vlic2Artifact,
  signer: 'authority-a',
  keyId: a.json.keyId,
  expectedCanonicalUtf8Hex: vlic2Body.toString('hex'),
});

const vlic1Body = Buffer.from(
  canonicalizeLicenseCodePayload(vlic1Payload),
  'utf8',
);
const vlic1Sig = cryptoSign(null, vlic1Body, authA.privateKey);
const vlic1Artifact = [
  'VLIC1',
  vlic1Body.toString('base64url'),
  vlic1Sig.toString('base64url'),
].join('.');
writeJson(join(ROOT, 'valid', 'OK-02.json'), {
  id: 'OK-02',
  name: 'valid VLIC1 legacy artifact signed by authority A',
  protocolVersion: 'VLIC1',
  artifact: vlic1Artifact,
  signer: 'authority-a',
  keyId: a.json.keyId,
  expectedCanonicalUtf8Hex: vlic1Body.toString('hex'),
});

// OK-03 is DEVICE-signed, so it carries no authority `keyId`. Its signer is
// identified with the device `publicKeyFingerprint` convention — the full 64-hex
// SHA-256 of the SPKI DER, with no `sha256-` prefix — deliberately not the
// authority `keyId` convention (`sha256-<first 16 hex of SPKI DER>`). Conflating
// the two is the interop trap vectors §3.2 warns about.
writeJson(join(ROOT, 'valid', 'OK-03.json'), {
  id: 'OK-03',
  name: 'valid VDRQ1 request artifact (new-device detached signature)',
  protocolVersion: DEVICE_REPLACEMENT_REQUEST_FORMAT,
  artifact: vdrqArtifact,
  signer: 'device-01',
  devicePublicKeyFingerprint: fp,
  requestHash: vdrqRequestHash,
  expectedCanonicalUtf8Hex: vdrqBody.toString('hex'),
});

const vdrpBody = Buffer.from(
  canonicalizeDeviceReplacementResponse(vdrpPayload),
  'utf8',
);
const vdrpSig = cryptoSign(null, vdrpBody, authA.privateKey);
const vdrpArtifact = [
  'VDRP1',
  vdrpBody.toString('base64url'),
  vdrpSig.toString('base64url'),
].join('.');
writeJson(join(ROOT, 'valid', 'OK-04.json'), {
  id: 'OK-04',
  name: 'valid VDRP1 approval response',
  protocolVersion: 'VDRP1',
  artifact: vdrpArtifact,
  signer: 'authority-a',
  keyId: a.json.keyId,
  approvesRequestHash: vdrqRequestHash,
  expectedCanonicalUtf8Hex: vdrpBody.toString('hex'),
});

// --- Invalid artifacts ---
let bi = 1;
function bad(
  name: string,
  artifact: string,
  reason: string,
  protocol: string,
): void {
  writeJson(join(ROOT, 'invalid', `BAD-${String(bi).padStart(2, '0')}.json`), {
    id: `BAD-${String(bi).padStart(2, '0')}`,
    name,
    protocolVersion: protocol,
    artifact,
    expectedReason: reason,
  });
  bi++;
}
const vlic2Parts = vlic2Artifact.split('.');
const tamperedDecoded = JSON.parse(
  Buffer.from(vlic2Parts[1]!, 'base64url').toString('utf8'),
);
tamperedDecoded.userLimit = 100000;
const tamperedBody = Buffer.from(JSON.stringify(tamperedDecoded), 'utf8');
bad(
  'tampered payload (signature mismatch)',
  ['VLIC2', tamperedBody.toString('base64url'), vlic2Parts[2]!].join('.'),
  'signature',
  'VLIC2',
);

const sigB = cryptoSign(null, vlic2Body, authB.privateKey);
bad(
  'signed by untrusted authority B',
  ['VLIC2', vlic2Body.toString('base64url'), sigB.toString('base64url')].join(
    '.',
  ),
  'signature',
  'VLIC2',
);

bad('missing third segment', 'VLIC2.' + vlic2Parts[1]!, 'malformed', 'VLIC2');
bad(
  'unsupported prefix VLIC9',
  'VLIC9.' + vlic2Parts[1]! + '.' + vlic2Parts[2]!,
  'unsupported-version',
  'VLIC2',
);

// VDRP1 tampering
const vdrpParts = vdrpArtifact.split('.');
const vdrpTampered = JSON.parse(
  Buffer.from(vdrpParts[1]!, 'base64url').toString('utf8'),
);
vdrpTampered.requestHash = '0'.repeat(64);
const vdrpTamperedBody = Buffer.from(JSON.stringify(vdrpTampered), 'utf8');
bad(
  'VDRP1 tampered requestHash',
  ['VDRP1', vdrpTamperedBody.toString('base64url'), vdrpParts[2]!].join('.'),
  'response-signature',
  'VDRP1',
);

// --- Rotation ---
writeJson(join(ROOT, 'rotation', 'ROT-01.json'), {
  id: 'ROT-01',
  name: 'artifact signed by A accepted while A and B trusted',
  protocolVersion: 'VLIC2',
  trustKeys: ['authority-a', 'authority-b'],
  artifact: vlic2Artifact,
  expectedKeyId: a.json.keyId,
  expectedResult: 'accepted',
});
writeJson(join(ROOT, 'rotation', 'ROT-02.json'), {
  id: 'ROT-02',
  name: 'artifact signed by A rejected after A retired',
  protocolVersion: 'VLIC2',
  trustKeys: ['authority-b'],
  artifact: vlic2Artifact,
  expectedResult: 'signature',
});

// --- Signed revocation artifact (`VREV1`, OD-LIC-17) -----------------------
//
// A SEPARATE vector set: it never adds, removes or regenerates a license
// vector. Every instant is fixed, so regeneration is byte-identical (CI diffs
// this directory).
const REV = '01TESTREVOCATION0000000000';
const revocationPayload: RevocationPayload = {
  v: 1,
  kind: 'SERVER_LICENSE_REVOCATION',
  revocationId: REV,
  licenseId: LIC,
  targetOperationId: OP,
  customerId: CUST,
  customerCode: CUSTCODE,
  installationId: INST,
  effect: 'LICENSE_ONLY',
  reason: 'CONTRACT_TERMINATION',
  reasonDetail: 'Contract 2026-114 ended on 2026-10-20.',
  issuerKeyId: a.json.keyId,
  issuedAt: new Date('2026-10-20T09:30:00.000Z'),
};
const revocationCanonical = canonicalizeRevocation(revocationPayload);
writeJson(join(ROOT, 'revocation', 'CAN-01.json'), {
  id: 'REV-CAN-01',
  name: 'VREV1 canonical payload with a reasonDetail',
  protocolVersion: 'VREV1',
  input: { ...revocationPayload, issuedAt: '2026-10-20T09:30:00.000Z' },
  expectedCanonicalUtf8: revocationCanonical,
  expectedCanonicalUtf8Hex: Buffer.from(revocationCanonical, 'utf8').toString(
    'hex',
  ),
  notes:
    'Fixed field order from the protocol, every field present, instants as toISOString().',
});

const revocationNullDetail: RevocationPayload = {
  ...revocationPayload,
  revocationId: '01TESTREVOCATION0000000001',
  reason: 'NON_PAYMENT',
  reasonDetail: null,
  issuedAt: new Date('2026-10-20T09:31:00.000Z'),
};
const revocationNullDetailCanonical =
  canonicalizeRevocation(revocationNullDetail);
writeJson(join(ROOT, 'revocation', 'CAN-02.json'), {
  id: 'REV-CAN-02',
  name: 'VREV1 canonical payload with a null reasonDetail',
  protocolVersion: 'VREV1',
  input: { ...revocationNullDetail, issuedAt: '2026-10-20T09:31:00.000Z' },
  expectedCanonicalUtf8: revocationNullDetailCanonical,
  expectedCanonicalUtf8Hex: Buffer.from(
    revocationNullDetailCanonical,
    'utf8',
  ).toString('hex'),
  notes: 'null is the literal null; the field is never omitted.',
});

const revocationBody = Buffer.from(revocationCanonical, 'utf8');
const revocationSig = cryptoSign(null, revocationBody, authA.privateKey);
const revocationArtifact = [
  'VREV1',
  revocationBody.toString('base64url'),
  revocationSig.toString('base64url'),
].join('.');
writeJson(join(ROOT, 'revocation', 'OK-01.json'), {
  id: 'REV-OK-01',
  name: 'valid VREV1 revocation artifact signed by authority A',
  protocolVersion: 'VREV1',
  artifact: revocationArtifact,
  envelope: {
    format: 'vardena-revocation',
    fileVersion: 1,
    revocation: revocationArtifact,
    keyId: a.json.keyId,
  },
  signer: 'authority-a',
  keyId: a.json.keyId,
  expectedCanonicalUtf8Hex: revocationBody.toString('hex'),
});

// BAD-01: the signature is A's, but the signed payload claims B as issuer.
const issuerMismatchPayload: RevocationPayload = {
  ...revocationPayload,
  issuerKeyId: b.json.keyId,
};
const issuerMismatchBody = Buffer.from(
  canonicalizeRevocation(issuerMismatchPayload),
  'utf8',
);
const issuerMismatchSig = cryptoSign(
  null,
  issuerMismatchBody,
  authA.privateKey,
);
writeJson(join(ROOT, 'revocation', 'BAD-01.json'), {
  id: 'REV-BAD-01',
  name: 'issuerKeyId names a key that did not sign',
  envelope: {
    format: 'vardena-revocation',
    fileVersion: 1,
    revocation: [
      'VREV1',
      issuerMismatchBody.toString('base64url'),
      issuerMismatchSig.toString('base64url'),
    ].join('.'),
  },
  expectedReason: 'key-mismatch',
});

// BAD-02: a LICENSE envelope presented as a revocation.
writeJson(join(ROOT, 'revocation', 'BAD-02.json'), {
  id: 'REV-BAD-02',
  name: 'license file envelope cannot carry a revocation',
  raw: JSON.stringify({
    format: 'vardena-license',
    fileVersion: 1,
    document: vlic2Artifact,
  }),
  expectedReason: 'malformed',
});

// BAD-03: unsupported armor version.
const revocationParts = revocationArtifact.split('.');
writeJson(join(ROOT, 'revocation', 'BAD-03.json'), {
  id: 'REV-BAD-03',
  name: 'unsupported armor prefix VREV2',
  raw: ['VREV2', revocationParts[1]!, revocationParts[2]!].join('.'),
  expectedReason: 'unsupported-version',
});

// BAD-04: valid signature over NON-canonical bytes (pretty-printed JSON).
const prettyBody = Buffer.from(
  JSON.stringify(revocationPayload, null, 2),
  'utf8',
);
const prettySig = cryptoSign(null, prettyBody, authA.privateKey);
writeJson(join(ROOT, 'revocation', 'BAD-04.json'), {
  id: 'REV-BAD-04',
  name: 'signed but non-canonical payload',
  raw: [
    'VREV1',
    prettyBody.toString('base64url'),
    prettySig.toString('base64url'),
  ].join('.'),
  expectedReason: 'canonical',
});

// BAD-05: a reason outside the closed vocabulary.
const unknownReasonPayload = {
  ...revocationPayload,
  reason: 'TRAFFIC_VIOLATION',
} as unknown as RevocationPayload;
const unknownReasonBody = Buffer.from(
  canonicalizeRevocation(unknownReasonPayload),
  'utf8',
);
const unknownReasonSig = cryptoSign(null, unknownReasonBody, authA.privateKey);
writeJson(join(ROOT, 'revocation', 'BAD-05.json'), {
  id: 'REV-BAD-05',
  name: 'reason outside the closed vocabulary',
  raw: [
    'VREV1',
    unknownReasonBody.toString('base64url'),
    unknownReasonSig.toString('base64url'),
  ].join('.'),
  expectedReason: 'payload',
});

// BAD-06: customerCode equal to customerId (protocol §3 rule 7).
const codeEqualsIdPayload: RevocationPayload = {
  ...revocationPayload,
  customerCode: CUST,
};
const codeEqualsIdBody = Buffer.from(
  canonicalizeRevocation(codeEqualsIdPayload),
  'utf8',
);
const codeEqualsIdSig = cryptoSign(null, codeEqualsIdBody, authA.privateKey);
writeJson(join(ROOT, 'revocation', 'BAD-06.json'), {
  id: 'REV-BAD-06',
  name: 'customerCode equal to customerId',
  raw: [
    'VREV1',
    codeEqualsIdBody.toString('base64url'),
    codeEqualsIdSig.toString('base64url'),
  ].join('.'),
  expectedReason: 'payload',
});

// BAD-07: the envelope names a key this installation does not trust.
writeJson(join(ROOT, 'revocation', 'BAD-07.json'), {
  id: 'REV-BAD-07',
  name: 'unknown key hint in the envelope',
  envelope: {
    format: 'vardena-revocation',
    fileVersion: 1,
    revocation: revocationArtifact,
    keyId: 'sha256-0000000000000000',
  },
  expectedReason: 'unknown-key',
});

// BAD-08: a payload field this format does not define.
const extraFieldBody = Buffer.from(
  JSON.stringify({
    ...JSON.parse(revocationCanonical),
    reactivatesLicenseId: LIC,
  }),
  'utf8',
);
const extraFieldSig = cryptoSign(null, extraFieldBody, authA.privateKey);
writeJson(join(ROOT, 'revocation', 'BAD-08.json'), {
  id: 'REV-BAD-08',
  name: 'unknown payload field reactivatesLicenseId',
  raw: [
    'VREV1',
    extraFieldBody.toString('base64url'),
    extraFieldSig.toString('base64url'),
  ].join('.'),
  expectedReason: 'payload',
});

writeJson(join(ROOT, 'revocation', 'ROT-01.json'), {
  id: 'REV-ROT-01',
  name: 'revocation signed by A accepted while A and B are trusted',
  trustKeys: ['authority-a', 'authority-b'],
  envelope: {
    format: 'vardena-revocation',
    fileVersion: 1,
    revocation: revocationArtifact,
  },
  expectedKeyId: a.json.keyId,
  expectedResult: 'accepted',
});
writeJson(join(ROOT, 'revocation', 'ROT-02.json'), {
  id: 'REV-ROT-02',
  name: 'revocation signed by A rejected after A is retired',
  trustKeys: ['authority-b'],
  envelope: {
    format: 'vardena-revocation',
    fileVersion: 1,
    revocation: revocationArtifact,
  },
  expectedResult: 'signature',
});

console.log('Generated licensing vectors under', ROOT);
