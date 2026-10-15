import {
  createHash,
  createPublicKey,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import { CUSTOMER_CODE_PATTERN } from './customer.js';
import type { TrustedLicenseKey } from './license-document.js';

export const DEVICE_ENROLLMENT_CHALLENGE_FORMAT = 'VDEA1';
export const DEVICE_REPLACEMENT_REQUEST_FORMAT = 'VDRQ1';
export const DEVICE_REPLACEMENT_RESPONSE_FORMAT = 'VDRP1';
export const DEVICE_REPLACEMENT_REQUEST_FILE_FORMAT =
  'vardena-device-replacement-request';
export const DEVICE_REPLACEMENT_RESPONSE_FILE_FORMAT =
  'vardena-device-replacement-response';
export const DEVICE_REPLACEMENT_FILE_VERSION = 1;

export const DEVICE_ENROLLMENT_CHALLENGE_TTL_MS = 15 * 60 * 1000;
export const DEVICE_REPLACEMENT_REQUEST_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DEVICE_REPLACEMENT_MAX_FILE_BYTES = 65_536;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const ED25519_PUBLIC_KEY_DER_BYTES = 44;
const ED25519_SIGNATURE_BYTES = 64;

export type DeviceProtocolErrorReason =
  | 'invalid-public-key'
  | 'invalid-signature'
  | 'malformed-challenge'
  | 'malformed-request'
  | 'malformed-response'
  | 'unsupported-response-version'
  | 'unknown-signing-key'
  | 'response-signature';

export type DeviceLifecycleErrorReason =
  | 'license-required'
  | 'license-not-active'
  | 'license-binding-mismatch'
  | 'device-entitlement-unspecified'
  | 'device-limit-reached'
  | 'device-key-already-registered'
  | 'device-not-found'
  | 'device-not-active'
  | 'device-operation-conflict'
  | 'enrollment-challenge-not-found'
  | 'enrollment-challenge-expired'
  | 'enrollment-challenge-consumed'
  | 'enrollment-challenge-stale'
  | 'replacement-request-not-found'
  | 'replacement-request-not-pending'
  | 'replacement-request-expired'
  | 'replacement-already-pending'
  | 'replacement-device-key-used'
  | 'replacement-response-invalid'
  | 'replacement-response-replayed'
  | 'replacement-request-cancelled';

export class DeviceLifecycleError extends Error {
  constructor(
    readonly reason: DeviceLifecycleErrorReason,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DeviceLifecycleError';
  }
}

/** A bounded protocol rejection; never carries submitted payloads or key bytes. */
export class DeviceProtocolError extends Error {
  constructor(
    readonly reason: DeviceProtocolErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'DeviceProtocolError';
  }
}

export interface ParsedDevicePublicKey {
  /** Canonical base64url DER SubjectPublicKeyInfo; no PEM or private key. */
  encoded: string;
  fingerprint: string;
  key: KeyObject;
}

/** Validate the Ed25519 SPKI public key exported by Web Crypto. */
export function parseDevicePublicKey(value: unknown): ParsedDevicePublicKey {
  if (typeof value !== 'string' || value.length > 256) {
    throw new DeviceProtocolError(
      'invalid-public-key',
      'A canonical Ed25519 public key is required.',
    );
  }
  const der = decodeBase64url(value, 'invalid-public-key');
  if (der.length !== ED25519_PUBLIC_KEY_DER_BYTES) {
    throw new DeviceProtocolError(
      'invalid-public-key',
      'A canonical Ed25519 public key is required.',
    );
  }
  try {
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') {
      throw new Error('unexpected-key-type');
    }
    const canonicalDer = key.export({ format: 'der', type: 'spki' });
    if (!canonicalDer.equals(der)) throw new Error('noncanonical-key');
    return {
      encoded: der.toString('base64url'),
      fingerprint: createHash('sha256').update(der).digest('hex'),
      key,
    };
  } catch {
    throw new DeviceProtocolError(
      'invalid-public-key',
      'A canonical Ed25519 public key is required.',
    );
  }
}

/** Verify a detached Ed25519 signature over the exact canonical UTF-8 bytes. */
export function verifyDeviceProof(params: {
  canonicalPayload: string;
  signature: unknown;
  publicKey: string;
}): boolean {
  const parsed = parseDevicePublicKey(params.publicKey);
  const signature = decodeBase64url(params.signature, 'invalid-signature');
  if (signature.length !== ED25519_SIGNATURE_BYTES) {
    throw new DeviceProtocolError(
      'invalid-signature',
      'A detached Ed25519 signature is required.',
    );
  }
  try {
    return cryptoVerify(
      null,
      Buffer.from(params.canonicalPayload, 'utf8'),
      parsed.key,
      signature,
    );
  } catch {
    return false;
  }
}

export interface EnrollmentChallengePayload {
  format: typeof DEVICE_ENROLLMENT_CHALLENGE_FORMAT;
  challengeId: string;
  operationId: string;
  deviceId: string;
  installationId: string;
  customerId: string;
  customerCode: string;
  licenseId: string;
  licenseVersionId: string;
  purpose: 'DEVICE_ENROLLMENT';
  publicKey: string;
  publicKeyFingerprint: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}

export interface DeviceReplacementChallengePayload {
  format: typeof DEVICE_REPLACEMENT_REQUEST_FORMAT;
  requestId: string;
  challengeId: string;
  operationId: string;
  installationId: string;
  customerId: string;
  customerCode: string;
  licenseId: string;
  licenseVersionId: string;
  oldDeviceId: string;
  newDeviceId: string;
  publicKey: string;
  publicKeyFingerprint: string;
  nonce: string;
  issuedAt: string;
  /** Short deadline to prove possession on the new device. */
  challengeExpiresAt: string;
  /** Longer signed deadline for the offline authority exchange. */
  expiresAt: string;
}

/** Fixed-order canonical bytes for a server-issued enrollment challenge. */
export function canonicalizeEnrollmentChallenge(
  payload: EnrollmentChallengePayload,
): string {
  assertChallengeIdentity(payload);
  return JSON.stringify({
    format: DEVICE_ENROLLMENT_CHALLENGE_FORMAT,
    challengeId: payload.challengeId,
    operationId: payload.operationId,
    deviceId: payload.deviceId,
    installationId: payload.installationId,
    customerId: payload.customerId,
    customerCode: payload.customerCode,
    licenseId: payload.licenseId,
    licenseVersionId: payload.licenseVersionId,
    purpose: 'DEVICE_ENROLLMENT',
    publicKey: payload.publicKey,
    publicKeyFingerprint: payload.publicKeyFingerprint,
    nonce: payload.nonce,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  });
}

/** Fixed-order canonical bytes for a server-issued replacement challenge. */
export function canonicalizeDeviceReplacementChallenge(
  payload: DeviceReplacementChallengePayload,
): string {
  assertChallengeIdentity(payload);
  assertId(payload.requestId);
  assertId(payload.oldDeviceId);
  assertId(payload.newDeviceId);
  assertIsoInstant(payload.challengeExpiresAt);
  assertIsoInstant(payload.expiresAt);
  return JSON.stringify({
    format: DEVICE_REPLACEMENT_REQUEST_FORMAT,
    requestId: payload.requestId,
    challengeId: payload.challengeId,
    operationId: payload.operationId,
    installationId: payload.installationId,
    customerId: payload.customerId,
    customerCode: payload.customerCode,
    licenseId: payload.licenseId,
    licenseVersionId: payload.licenseVersionId,
    oldDeviceId: payload.oldDeviceId,
    newDeviceId: payload.newDeviceId,
    publicKey: payload.publicKey,
    publicKeyFingerprint: payload.publicKeyFingerprint,
    nonce: payload.nonce,
    issuedAt: payload.issuedAt,
    challengeExpiresAt: payload.challengeExpiresAt,
    expiresAt: payload.expiresAt,
  });
}

export interface DeviceReplacementResponsePayload {
  format: typeof DEVICE_REPLACEMENT_RESPONSE_FORMAT;
  responseOperationId: string;
  keyId: string;
  requestId: string;
  challengeId: string;
  requestOperationId: string;
  requestHash: string;
  installationId: string;
  customerId: string;
  customerCode: string;
  licenseId: string;
  licenseVersionId: string;
  oldDeviceId: string;
  newDeviceId: string;
  publicKeyFingerprint: string;
  decision: 'APPROVE';
  issuedAt: string;
  expiresAt: string;
}

export interface VerifiedDeviceReplacementResponse {
  payload: DeviceReplacementResponsePayload;
  /** Exact VDRP1 artifact used for verification; never persisted. */
  artifact: string;
  artifactHash: string;
  transport: 'file' | 'text';
}

/** Fixed-order canonical response bytes (the authority signs this exact text). */
export function canonicalizeDeviceReplacementResponse(
  payload: DeviceReplacementResponsePayload,
): string {
  assertId(payload.responseOperationId);
  assertId(payload.keyId);
  assertId(payload.requestId);
  assertId(payload.challengeId);
  assertId(payload.requestOperationId);
  assertHexHash(payload.requestHash);
  assertId(payload.installationId);
  assertId(payload.customerId);
  assertCustomerCode(payload.customerCode);
  assertId(payload.licenseId);
  assertId(payload.licenseVersionId);
  assertId(payload.oldDeviceId);
  assertId(payload.newDeviceId);
  assertFingerprint(payload.publicKeyFingerprint);
  if (payload.decision !== 'APPROVE') {
    throw new DeviceProtocolError(
      'malformed-response',
      'The device replacement response is invalid.',
    );
  }
  assertIsoInstant(payload.issuedAt);
  assertIsoInstant(payload.expiresAt);
  return JSON.stringify({
    format: DEVICE_REPLACEMENT_RESPONSE_FORMAT,
    responseOperationId: payload.responseOperationId,
    keyId: payload.keyId,
    requestId: payload.requestId,
    challengeId: payload.challengeId,
    requestOperationId: payload.requestOperationId,
    requestHash: payload.requestHash,
    installationId: payload.installationId,
    customerId: payload.customerId,
    customerCode: payload.customerCode,
    licenseId: payload.licenseId,
    licenseVersionId: payload.licenseVersionId,
    oldDeviceId: payload.oldDeviceId,
    newDeviceId: payload.newDeviceId,
    publicKeyFingerprint: payload.publicKeyFingerprint,
    decision: 'APPROVE',
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  });
}

/** Parse and cryptographically verify a VDRP1 file or text artifact. */
export function verifyDeviceReplacementResponse(
  rawInput: string,
  trustedKeys: readonly TrustedLicenseKey[],
): VerifiedDeviceReplacementResponse {
  if (
    typeof rawInput !== 'string' ||
    rawInput.length === 0 ||
    Buffer.byteLength(rawInput, 'utf8') > DEVICE_REPLACEMENT_MAX_FILE_BYTES
  ) {
    throw new DeviceProtocolError(
      'malformed-response',
      'The device replacement response is invalid.',
    );
  }
  const decoded = decodeReplacementResponseTransport(rawInput);
  const parts = decoded.artifact.split('.');
  if (
    parts.length !== 3 ||
    parts[0] !== DEVICE_REPLACEMENT_RESPONSE_FORMAT ||
    parts[1] === '' ||
    parts[2] === ''
  ) {
    throw new DeviceProtocolError(
      'malformed-response',
      'The device replacement response is invalid.',
    );
  }
  const payloadBytes = decodeBase64url(parts[1], 'malformed-response');
  const signature = decodeBase64url(parts[2], 'malformed-response');
  if (signature.length !== ED25519_SIGNATURE_BYTES) {
    throw new DeviceProtocolError(
      'malformed-response',
      'The device replacement response is invalid.',
    );
  }
  const payloadText = payloadBytes.toString('utf8');
  if (!Buffer.from(payloadText, 'utf8').equals(payloadBytes)) {
    throw new DeviceProtocolError(
      'malformed-response',
      'The device replacement response is invalid.',
    );
  }
  const payload = parseResponsePayload(payloadText);
  const canonical = canonicalizeDeviceReplacementResponse(payload);
  if (canonical !== payloadText) {
    throw new DeviceProtocolError(
      'malformed-response',
      'The device replacement response is not canonical.',
    );
  }
  const trusted = trustedKeys.find(({ id }) => id === payload.keyId);
  if (trusted === undefined) {
    throw new DeviceProtocolError(
      'unknown-signing-key',
      'The response was signed by an unknown licensing authority key.',
    );
  }
  let signatureValid = false;
  try {
    signatureValid = cryptoVerify(null, payloadBytes, trusted.key, signature);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    throw new DeviceProtocolError(
      'response-signature',
      'The device replacement response signature is invalid.',
    );
  }
  return {
    payload,
    artifact: decoded.artifact,
    artifactHash: createHash('sha256')
      .update(decoded.artifact, 'utf8')
      .digest('hex'),
    transport: decoded.transport,
  };
}

export interface DeviceReplacementCorrelation {
  requestId: string;
  challengeId: string;
  requestOperationId: string;
  requestHash: string;
  installationId: string;
  customerId: string;
  customerCode: string;
  licenseId: string;
  licenseVersionId: string;
  oldDeviceId: string;
  newDeviceId: string;
  publicKeyFingerprint: string;
  requestIssuedAt: Date;
  requestExpiresAt: Date;
  licenseValidFrom: Date;
  licenseValidUntil: Date | null;
  now: Date;
}

/** Validate signed response correlation and its full retained validity window. */
export function validateDeviceReplacementCorrelation(params: {
  response: DeviceReplacementResponsePayload;
  request: DeviceReplacementCorrelation;
}): void {
  const { response, request } = params;
  const matches =
    response.requestId === request.requestId &&
    response.challengeId === request.challengeId &&
    response.requestOperationId === request.requestOperationId &&
    response.requestHash === request.requestHash &&
    response.installationId === request.installationId &&
    response.customerId === request.customerId &&
    response.customerCode === request.customerCode &&
    response.licenseId === request.licenseId &&
    response.licenseVersionId === request.licenseVersionId &&
    response.oldDeviceId === request.oldDeviceId &&
    response.newDeviceId === request.newDeviceId &&
    response.publicKeyFingerprint === request.publicKeyFingerprint;
  if (!matches) {
    throw new DeviceProtocolError(
      'malformed-response',
      'The response does not match the pending device replacement request.',
    );
  }
  const issuedAt = parseIsoInstant(response.issuedAt);
  const expiresAt = parseIsoInstant(response.expiresAt);
  if (
    issuedAt.getTime() < request.requestIssuedAt.getTime() ||
    issuedAt.getTime() > request.requestExpiresAt.getTime() ||
    issuedAt.getTime() > request.now.getTime() ||
    expiresAt.getTime() <= issuedAt.getTime() ||
    expiresAt.getTime() > request.requestExpiresAt.getTime() ||
    expiresAt.getTime() <= request.now.getTime() ||
    issuedAt.getTime() < request.licenseValidFrom.getTime() ||
    (request.licenseValidUntil !== null &&
      expiresAt.getTime() > request.licenseValidUntil.getTime())
  ) {
    throw new DeviceProtocolError(
      'malformed-response',
      'The signed response is outside the valid request or license window.',
    );
  }
}

export function serializeDeviceReplacementRequestArtifact(params: {
  canonicalPayload: string;
  signature: string;
}): string {
  const signature = decodeBase64url(params.signature, 'invalid-signature');
  if (signature.length !== ED25519_SIGNATURE_BYTES) {
    throw new DeviceProtocolError(
      'invalid-signature',
      'A detached Ed25519 signature is required.',
    );
  }
  return [
    DEVICE_REPLACEMENT_REQUEST_FORMAT,
    Buffer.from(params.canonicalPayload, 'utf8').toString('base64url'),
    signature.toString('base64url'),
  ].join('.');
}

export function serializeDeviceReplacementRequestFile(
  artifact: string,
): string {
  return JSON.stringify(
    {
      format: DEVICE_REPLACEMENT_REQUEST_FILE_FORMAT,
      fileVersion: DEVICE_REPLACEMENT_FILE_VERSION,
      request: artifact,
    },
    null,
    2,
  );
}

function decodeReplacementResponseTransport(input: string): {
  artifact: string;
  transport: 'file' | 'text';
} {
  const trimmed = input.trim();
  if (!trimmed.startsWith('{')) return { artifact: trimmed, transport: 'text' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new DeviceProtocolError(
      'malformed-response',
      'The device replacement file is invalid.',
    );
  }
  if (!isRecord(parsed)) {
    throw new DeviceProtocolError(
      'malformed-response',
      'The device replacement file is invalid.',
    );
  }
  assertExactKeys(
    parsed,
    ['format', 'fileVersion', 'response'],
    'malformed-response',
  );
  if (
    parsed.format !== DEVICE_REPLACEMENT_RESPONSE_FILE_FORMAT ||
    parsed.fileVersion !== DEVICE_REPLACEMENT_FILE_VERSION ||
    typeof parsed.response !== 'string'
  ) {
    throw new DeviceProtocolError(
      'unsupported-response-version',
      'The device replacement file format is not supported.',
    );
  }
  return { artifact: parsed.response, transport: 'file' };
}

function parseResponsePayload(text: string): DeviceReplacementResponsePayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new DeviceProtocolError(
      'malformed-response',
      'The device replacement response payload is invalid.',
    );
  }
  if (!isRecord(parsed)) {
    throw new DeviceProtocolError(
      'malformed-response',
      'The device replacement response payload is invalid.',
    );
  }
  const expectedKeys = [
    'format',
    'responseOperationId',
    'keyId',
    'requestId',
    'challengeId',
    'requestOperationId',
    'requestHash',
    'installationId',
    'customerId',
    'customerCode',
    'licenseId',
    'licenseVersionId',
    'oldDeviceId',
    'newDeviceId',
    'publicKeyFingerprint',
    'decision',
    'issuedAt',
    'expiresAt',
  ];
  assertExactKeys(parsed, expectedKeys, 'malformed-response');
  if (parsed.format !== DEVICE_REPLACEMENT_RESPONSE_FORMAT) {
    throw new DeviceProtocolError(
      'unsupported-response-version',
      'The device replacement response format is not supported.',
    );
  }
  if (
    typeof parsed.responseOperationId !== 'string' ||
    typeof parsed.keyId !== 'string' ||
    typeof parsed.requestId !== 'string' ||
    typeof parsed.challengeId !== 'string' ||
    typeof parsed.requestOperationId !== 'string' ||
    typeof parsed.requestHash !== 'string' ||
    typeof parsed.installationId !== 'string' ||
    typeof parsed.customerId !== 'string' ||
    typeof parsed.customerCode !== 'string' ||
    typeof parsed.licenseId !== 'string' ||
    typeof parsed.licenseVersionId !== 'string' ||
    typeof parsed.oldDeviceId !== 'string' ||
    typeof parsed.newDeviceId !== 'string' ||
    typeof parsed.publicKeyFingerprint !== 'string' ||
    parsed.decision !== 'APPROVE' ||
    typeof parsed.issuedAt !== 'string' ||
    typeof parsed.expiresAt !== 'string'
  ) {
    throw new DeviceProtocolError(
      'malformed-response',
      'The device replacement response payload is invalid.',
    );
  }
  return parsed as unknown as DeviceReplacementResponsePayload;
}

function assertChallengeIdentity(payload: {
  challengeId: string;
  operationId: string;
  installationId: string;
  customerId: string;
  customerCode: string;
  licenseId: string;
  licenseVersionId: string;
  publicKey: string;
  publicKeyFingerprint: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}): void {
  assertId(payload.challengeId);
  assertId(payload.operationId);
  assertId(payload.installationId);
  assertId(payload.customerId);
  assertCustomerCode(payload.customerCode);
  assertId(payload.licenseId);
  assertId(payload.licenseVersionId);
  assertFingerprint(payload.publicKeyFingerprint);
  if (payload.nonce.length < 32 || payload.nonce.length > 128) {
    throw new DeviceProtocolError(
      'malformed-challenge',
      'The server-issued device challenge is invalid.',
    );
  }
  assertIsoInstant(payload.issuedAt);
  assertIsoInstant(payload.expiresAt);
  const key = parseDevicePublicKey(payload.publicKey);
  if (key.fingerprint !== payload.publicKeyFingerprint) {
    throw new DeviceProtocolError(
      'malformed-challenge',
      'The server-issued device challenge is invalid.',
    );
  }
}

function assertId(value: string): void {
  if (!ID_PATTERN.test(value)) {
    throw new DeviceProtocolError(
      'malformed-response',
      'The signed device data is invalid.',
    );
  }
}

function assertCustomerCode(value: string): void {
  if (!CUSTOMER_CODE_PATTERN.test(value)) {
    throw new DeviceProtocolError(
      'malformed-response',
      'The signed device data is invalid.',
    );
  }
}

function assertFingerprint(value: string): void {
  if (!FINGERPRINT_PATTERN.test(value)) {
    throw new DeviceProtocolError(
      'malformed-response',
      'The signed device data is invalid.',
    );
  }
}

function assertHexHash(value: string): void {
  if (!FINGERPRINT_PATTERN.test(value)) {
    throw new DeviceProtocolError(
      'malformed-response',
      'The signed device data is invalid.',
    );
  }
}

function assertIsoInstant(value: string): void {
  parseIsoInstant(value);
}

function parseIsoInstant(value: string): Date {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    throw new DeviceProtocolError(
      'malformed-response',
      'The signed device data contains an invalid instant.',
    );
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new DeviceProtocolError(
      'malformed-response',
      'The signed device data contains an invalid instant.',
    );
  }
  return date;
}

function decodeBase64url(
  value: unknown,
  reason: DeviceProtocolErrorReason,
): Buffer {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    !BASE64URL_PATTERN.test(value)
  ) {
    throw new DeviceProtocolError(
      reason,
      'The signed device data is malformed.',
    );
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) {
    throw new DeviceProtocolError(
      reason,
      'The signed device data is malformed.',
    );
  }
  return decoded;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  reason: DeviceProtocolErrorReason,
): void {
  const keys = Object.keys(value);
  if (
    keys.length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new DeviceProtocolError(
      reason,
      'The signed device data contains unsupported fields.',
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
