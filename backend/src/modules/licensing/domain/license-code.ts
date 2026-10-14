import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import { CUSTOMER_CODE_PATTERN } from './customer.js';
import type {
  InstallationLicense,
  LicenseEntitlement,
  LicenseLimit,
  LicenseStatus,
} from './license.js';

/**
 * The signed license code (L-02).
 *
 * A license code is a compact, self-describing, Ed25519-signed string:
 *
 *   VLIC1.<base64url(canonical JSON payload)>.<base64url(signature)>
 *
 * Why signed and not plain JSON: the client only ever hands the backend a
 * code. The backend derives the trusted payload from it and verifies the
 * signature against the configured licensing-authority PUBLIC key, so a
 * tampered limit, date or entitlement fails verification. The private key
 * never exists on the server: issuing is an out-of-band operation
 * (`npm run license:issue` in development, a commercial authority later).
 *
 * The payload is deliberately a flat, typed record — not a free-form JSON
 * document — so every field is validated before it can reach persistence.
 */

export const LICENSE_CODE_PREFIX = 'VLIC1';

export type LicenseCodeErrorReason =
  | 'malformed'
  | 'unsupported-version'
  | 'signature'
  | 'payload'
  | 'validity'
  | 'limits'
  | 'entitlements';

export class LicenseCodeError extends Error {
  constructor(
    readonly reason: LicenseCodeErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'LicenseCodeError';
  }
}

export interface LicensePayload {
  version: 1;
  licenseId: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  installationId: string;
  status: LicenseStatus;
  validFrom: Date;
  validUntil: Date | null;
  organizationLimit: LicenseLimit;
  userLimit: LicenseLimit;
  moduleEntitlements: readonly string[];
  featureEntitlements: readonly string[];
}

/**
 * Module codes an entitlement may name. A license that claims a module this
 * build does not know is rejected rather than silently ignored: it means the
 * code was issued for a different product version and its limits/entitlements
 * cannot be honoured faithfully.
 */
export const KNOWN_MODULE_CODES: readonly string[] = [
  'accounting',
  'documents',
  'inventory',
  'organization',
  'rbac',
  'users',
  'workflow',
];

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;
const CODE_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** Accepts a PEM block or base64 DER (SPKI) Ed25519 public key. */
export function parsePublicKey(material: string): KeyObject {
  const value = material.trim();
  if (value.includes('BEGIN')) {
    return createPublicKey({ key: value, format: 'pem' });
  }
  return createPublicKey({
    key: Buffer.from(value, 'base64'),
    format: 'der',
    type: 'spki',
  });
}

/** Accepts a PEM block or base64 DER (PKCS8) Ed25519 private key. */
export function parsePrivateKey(material: string): KeyObject {
  const value = material.trim();
  if (value.includes('BEGIN')) {
    return createPrivateKey({ key: value, format: 'pem' });
  }
  return createPrivateKey({
    key: Buffer.from(value, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

interface WirePayload {
  v: 1;
  licenseId: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  installationId: string;
  status: string;
  validFrom: string;
  validUntil: string | null;
  organizationLimit: number | null;
  userLimit: number | null;
  modules: string[];
  features: string[];
}

/**
 * Canonical serialization: fixed key order and normalized values, so the same
 * logical license always produces the same bytes (and therefore the same
 * signature and the same code hash).
 */
function canonicalize(payload: LicensePayload): string {
  const wire: WirePayload = {
    v: 1,
    licenseId: payload.licenseId,
    customerId: payload.customerId,
    customerCode: payload.customerCode,
    customerName: payload.customerName,
    installationId: payload.installationId,
    status: payload.status,
    validFrom: payload.validFrom.toISOString(),
    validUntil: payload.validUntil?.toISOString() ?? null,
    organizationLimit: payload.organizationLimit,
    userLimit: payload.userLimit,
    modules: [...payload.moduleEntitlements].sort(),
    features: [...payload.featureEntitlements].sort(),
  };
  return JSON.stringify(wire);
}

/** Issue a signed license code. Used only by the development issuing tool. */
export function signLicenseCode(
  payload: LicensePayload,
  privateKey: KeyObject,
): string {
  assertPayload(payload);
  const body = Buffer.from(canonicalize(payload), 'utf8');
  const signature = cryptoSign(null, body, privateKey);
  return [
    LICENSE_CODE_PREFIX,
    body.toString('base64url'),
    signature.toString('base64url'),
  ].join('.');
}

/** Stable identity of a code string (audit + idempotent re-activation). */
export function licenseCodeHash(code: string): string {
  return createHash('sha256').update(code.trim(), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Decoding + verification
// ---------------------------------------------------------------------------

/**
 * Verify a license code against the accepted authority public keys and return
 * the trusted payload. Throws `LicenseCodeError` for every rejection so the
 * application layer can map one reason to one API message.
 *
 * Installation binding and lifecycle (expiry/suspension) are NOT decided here:
 * this function answers "is this an authentic, well-formed license?" only.
 */
export function parseLicenseCode(
  code: string,
  publicKeys: readonly KeyObject[],
): LicensePayload {
  if (typeof code !== 'string' || code.trim() === '') {
    throw new LicenseCodeError('malformed', 'The license code is empty.');
  }
  const parts = code.trim().split('.');
  if (parts.length !== 3) {
    throw new LicenseCodeError(
      'malformed',
      'The license code is not a well-formed Vardena license code.',
    );
  }
  const [prefix, bodyPart, signaturePart] = parts as [string, string, string];
  if (prefix !== LICENSE_CODE_PREFIX) {
    throw new LicenseCodeError(
      'unsupported-version',
      `Unsupported license code version "${prefix}".`,
    );
  }
  const body = Buffer.from(bodyPart, 'base64url');
  const signature = Buffer.from(signaturePart, 'base64url');
  if (body.length === 0 || signature.length === 0) {
    throw new LicenseCodeError(
      'malformed',
      'The license code payload or signature is empty.',
    );
  }
  if (publicKeys.length === 0) {
    throw new LicenseCodeError(
      'signature',
      'No licensing authority public key is configured for this installation.',
    );
  }
  const authentic = publicKeys.some((key) => {
    try {
      return cryptoVerify(null, body, key, signature);
    } catch {
      return false;
    }
  });
  if (!authentic) {
    throw new LicenseCodeError(
      'signature',
      'The license code signature is not valid for this installation.',
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(body.toString('utf8'));
  } catch {
    throw new LicenseCodeError(
      'malformed',
      'The license code payload is not readable.',
    );
  }
  const payload = readPayload(raw);
  assertPayload(payload);
  // A signed payload must round-trip to exactly the signed bytes; anything
  // else means the canonical form and the signed form disagree.
  if (canonicalize(payload) !== body.toString('utf8')) {
    throw new LicenseCodeError(
      'payload',
      'The license code payload is not in canonical form.',
    );
  }
  return payload;
}

function readPayload(raw: unknown): LicensePayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new LicenseCodeError(
      'payload',
      'The license code payload is not an object.',
    );
  }
  const wire = raw as Partial<WirePayload>;
  if (wire.v !== 1) {
    throw new LicenseCodeError(
      'unsupported-version',
      'Only version 1 license payloads are supported.',
    );
  }
  const status = wire.status;
  if (status !== 'ACTIVE' && status !== 'EXPIRED' && status !== 'SUSPENDED') {
    throw new LicenseCodeError(
      'payload',
      'The license status must be ACTIVE, EXPIRED, or SUSPENDED.',
    );
  }
  const validFrom = readDate(wire.validFrom, 'validFrom');
  const validUntil =
    wire.validUntil === null || wire.validUntil === undefined
      ? null
      : readDate(wire.validUntil, 'validUntil');
  const customerId = readId(wire.customerId, 'customerId');
  const customerCode = readCustomerCode(wire.customerCode, customerId);
  return {
    version: 1,
    licenseId: readId(wire.licenseId, 'licenseId'),
    customerId,
    customerCode,
    customerName: readName(wire.customerName),
    installationId: readId(wire.installationId, 'installationId'),
    status: status as LicenseStatus,
    validFrom,
    validUntil,
    organizationLimit: readLimit(wire.organizationLimit, 'organizationLimit'),
    userLimit: readLimit(wire.userLimit, 'userLimit'),
    moduleEntitlements: readCodes(wire.modules, 'modules'),
    featureEntitlements: readCodes(wire.features, 'features'),
  };
}

function readId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new LicenseCodeError(
      'payload',
      `The license ${field} is missing or malformed.`,
    );
  }
  return value;
}

function readCustomerCode(value: unknown, customerId: string): string {
  if (typeof value !== 'string' || !CUSTOMER_CODE_PATTERN.test(value)) {
    throw new LicenseCodeError(
      'payload',
      'The license customerCode is missing or malformed.',
    );
  }
  if (value === customerId) {
    throw new LicenseCodeError(
      'payload',
      'The license customerCode must be an independent business code and must not equal customerId.',
    );
  }
  return value;
}

function readName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 200) {
    throw new LicenseCodeError(
      'payload',
      'The license customerName is missing or malformed.',
    );
  }
  return value;
}

function readDate(value: unknown, field: string): Date {
  if (typeof value !== 'string') {
    throw new LicenseCodeError('payload', `The license ${field} is missing.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new LicenseCodeError(
      'payload',
      `The license ${field} is not an ISO-8601 instant.`,
    );
  }
  return parsed;
}

function readLimit(value: unknown, field: string): LicenseLimit {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value)) {
    throw new LicenseCodeError(
      'limits',
      `The license ${field} must be an integer or null (unlimited).`,
    );
  }
  return value as number;
}

function readCodes(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new LicenseCodeError(
      'entitlements',
      `The license ${field} must be an array of codes.`,
    );
  }
  return value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new LicenseCodeError(
        'entitlements',
        `The license ${field} must contain only string codes.`,
      );
    }
    return entry;
  });
}

/** Semantic validation shared by issuing and verification. */
export function assertPayload(payload: LicensePayload): void {
  readId(payload.licenseId, 'licenseId');
  const customerId = readId(payload.customerId, 'customerId');
  readCustomerCode(payload.customerCode, customerId);
  readName(payload.customerName);
  readId(payload.installationId, 'installationId');
  if (
    payload.validUntil !== null &&
    payload.validUntil.getTime() <= payload.validFrom.getTime()
  ) {
    throw new LicenseCodeError(
      'validity',
      'The license validUntil must be later than validFrom.',
    );
  }
  for (const [field, limit] of [
    ['organizationLimit', payload.organizationLimit],
    ['userLimit', payload.userLimit],
  ] as const) {
    if (limit !== null && limit <= 0) {
      throw new LicenseCodeError(
        'limits',
        `The license ${field} must be a positive integer or null (unlimited).`,
      );
    }
  }
  const modules = new Set(payload.moduleEntitlements);
  if (modules.size !== payload.moduleEntitlements.length) {
    throw new LicenseCodeError(
      'entitlements',
      'The license repeats a module entitlement.',
    );
  }
  for (const code of payload.moduleEntitlements) {
    if (!KNOWN_MODULE_CODES.includes(code)) {
      throw new LicenseCodeError(
        'entitlements',
        `The license names an unknown module entitlement "${code}".`,
      );
    }
  }
  const features = new Set(payload.featureEntitlements);
  if (features.size !== payload.featureEntitlements.length) {
    throw new LicenseCodeError(
      'entitlements',
      'The license repeats a feature entitlement.',
    );
  }
  for (const code of payload.featureEntitlements) {
    if (!CODE_PATTERN.test(code)) {
      throw new LicenseCodeError(
        'entitlements',
        `The license names a malformed feature entitlement "${code}".`,
      );
    }
  }
}

export function payloadEntitlements(
  payload: LicensePayload,
): LicenseEntitlement[] {
  return [
    ...payload.moduleEntitlements.map((code) => ({
      kind: 'MODULE' as const,
      code,
    })),
    ...payload.featureEntitlements.map((code) => ({
      kind: 'FEATURE' as const,
      code,
    })),
  ];
}

export function toInstallationLicense(
  payload: LicensePayload,
  provider: string,
): InstallationLicense {
  return {
    customerId: payload.customerId,
    customerCode: payload.customerCode,
    installationId: payload.installationId,
    licenseId: payload.licenseId,
    status: payload.status,
    validFrom: payload.validFrom,
    validUntil: payload.validUntil,
    organizationLimit: payload.organizationLimit,
    userLimit: payload.userLimit,
    entitlements: payloadEntitlements(payload),
    provider,
  };
}
