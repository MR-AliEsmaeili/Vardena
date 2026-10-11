import {
  createHash,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import {
  KNOWN_MODULE_CODES,
  LicenseCodeError,
  type LicensePayload,
} from './license-code.js';
import type {
  LicenseEntitlement,
  LicenseLimit,
  LicenseStatus,
} from './license.js';

/**
 * The signed license document (L-03, ADR-0046).
 *
 * A license reaches an installation in one of three transport forms, and all
 * three decode into the SAME trust path:
 *
 *   file   : { "format": "vardena-license", "fileVersion": 1, "document": "VLIC2.…" }
 *   text   : VLIC2.<base64url(canonical payload)>.<base64url(signature)>
 *   legacy : VLIC1.<…>  (L-02 code, unchanged; parsed by `license-code.ts`)
 *
 * The file envelope is *not* trusted: it carries no licensing fact, unknown
 * top-level keys are rejected, and the only thing it contributes is a
 * self-describing, versionable container plus an optional signing-key hint
 * (which is checked against the trust list, never taken on faith). Text is the
 * same artifact without the envelope, so it is never a weaker path
 * (PDR-11 §7.12/§11.3, guardrail G-8).
 *
 * The payload is a deliberately flat, typed record — not a free-form JSON
 * document — so every field is validated before it can reach persistence. It
 * must round-trip to exactly the signed bytes: a re-serialization that differs
 * from what was signed is rejected.
 *
 * The private key never exists on a customer installation: the repository's
 * only issuer lives in `src/tools/development-license-authority.ts` and refuses
 * `NODE_ENV=production` (PDR-11 §4.4, G-3).
 */

export const LICENSE_FILE_FORMAT = 'vardena-license';
export const LICENSE_FILE_VERSION = 1;
export const LICENSE_DOCUMENT_PREFIX = 'VLIC2';
export const LICENSE_DOCUMENT_VERSION = 2;
export const LICENSE_DOCUMENT_KIND = 'SERVER_LICENSE_VERSION';

export type LicenseDocumentErrorReason =
  | 'malformed'
  | 'unsupported-version'
  | 'signature'
  | 'unknown-key'
  | 'payload'
  | 'validity'
  | 'limits'
  | 'entitlements';

/** One rejection reason, surfaced to the application layer for one message. */
export class LicenseDocumentError extends Error {
  constructor(
    readonly reason: LicenseDocumentErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'LicenseDocumentError';
  }
}

/** The typed, verified content of a v2 document. */
export interface LicenseVersionPayload {
  version: 2;
  kind: typeof LICENSE_DOCUMENT_KIND;
  /** Unique operation identity (replay protection, PDR-11 §10.7). */
  operationId: string;
  licenseId: string;
  customerId: string;
  customerName: string;
  installationId: string;
  status: LicenseStatus;
  validFrom: Date;
  /** null means perpetual; `validUntil` is exclusive. */
  validUntil: Date | null;
  organizationLimit: LicenseLimit;
  userLimit: LicenseLimit;
  moduleEntitlements: readonly string[];
  featureEntitlements: readonly string[];
  /**
   * Operation id of the retained version this document explicitly retires.
   * Overlap is only allowed through this field (no precedence rule is invented;
   * PDR-11 PQ-5 is open — see design §3.3).
   */
  supersedesOperationId: string | null;
  issuedAt: Date;
}

/** Transport a document arrived through (audited; never a trust decision). */
export type LicenseTransport = 'file' | 'text' | 'legacy-code';

export interface VerifiedLicenseDocument {
  documentVersion: 2;
  payload: LicenseVersionPayload;
  /** The armored artifact exactly as verified (never persisted). */
  document: string;
  /** SHA-256 of the armored artifact — the only thing persistence keeps. */
  documentHash: string;
  transport: LicenseTransport;
  /** Id of the trusted key that verified the signature. */
  keyId: string;
  legacy: false;
}

export interface VerifiedLegacyLicenseCode {
  documentVersion: 1;
  payload: LicensePayload;
  document: string;
  documentHash: string;
  transport: 'legacy-code';
  keyId: string;
  legacy: true;
}

export type VerifiedLicenseInput =
  VerifiedLicenseDocument | VerifiedLegacyLicenseCode;

// ---------------------------------------------------------------------------
// Parser-side constants (the issuing side imports the payload type, so the two
// can never drift apart — the same property `license-code.ts` already has)
// ---------------------------------------------------------------------------

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;
/** A configured key id: no colon, so `keyId:<material>` never parses wrongly. */
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CODE_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
const MAX_CUSTOMER_NAME = 200;

// ---------------------------------------------------------------------------
// Trusted keys
// ---------------------------------------------------------------------------

/**
 * One trusted authority public key with a stable id.
 *
 * `LICENSE_SIGNING_PUBLIC_KEYS` entries may be `keyId:<material>` or a bare
 * key. A bare key gets a deterministic id derived from its own bytes, so the
 * trust list is always addressable without inventing configuration. Rotation
 * is a list operation: several keys are trusted at once.
 */
export interface TrustedLicenseKey {
  id: string;
  key: KeyObject;
}

export function hashKeyMaterial(key: KeyObject): string {
  const der = key.export({ format: 'der', type: 'spki' });
  return `sha256-${createHash('sha256').update(der).digest('hex').slice(0, 16)}`;
}

/**
 * Split one configured trust entry into `keyId:<material>` or a bare key.
 *
 * The grammar is unambiguous because neither PEM text nor base64 DER contains
 * a colon; a `keyId` may not contain one either (`KEY_ID_PATTERN`).
 */
export function splitTrustedKeyEntry(entry: string): {
  id: string | null;
  material: string;
} {
  const value = entry.trim();
  const separator = value.indexOf(':');
  if (separator <= 0) return { id: null, material: value };
  const id = value.slice(0, separator);
  const material = value.slice(separator + 1).trim();
  if (!KEY_ID_PATTERN.test(id) || material === '') {
    return { id: null, material: value };
  }
  return { id, material };
}

/** Parse configured trust entries into keyed, addressable keys. */
export function toTrustedKeys(
  entries: readonly { id?: string; key: KeyObject }[],
): TrustedLicenseKey[] {
  return entries.map(({ id, key }) => ({
    id: id ?? hashKeyMaterial(key),
    key,
  }));
}

// ---------------------------------------------------------------------------
// Serialization (issuing side)
// ---------------------------------------------------------------------------

interface WirePayloadV2 {
  v: 2;
  kind: string;
  operationId: string;
  licenseId: string;
  customerId: string;
  customerName: string;
  installationId: string;
  status: string;
  validFrom: string;
  validUntil: string | null;
  organizationLimit: number | null;
  userLimit: number | null;
  modules: string[];
  features: string[];
  supersedesOperationId: string | null;
  issuedAt: string;
}

/**
 * Canonical serialization: fixed key order, normalized values and sorted
 * entitlement arrays, so the same logical version always produces the same
 * bytes — and therefore the same signature and the same document hash.
 */
export function canonicalizeLicenseVersion(
  payload: LicenseVersionPayload,
): string {
  const wire: WirePayloadV2 = {
    v: 2,
    kind: LICENSE_DOCUMENT_KIND,
    operationId: payload.operationId,
    licenseId: payload.licenseId,
    customerId: payload.customerId,
    customerName: payload.customerName,
    installationId: payload.installationId,
    status: payload.status,
    validFrom: payload.validFrom.toISOString(),
    validUntil: payload.validUntil?.toISOString() ?? null,
    organizationLimit: payload.organizationLimit,
    userLimit: payload.userLimit,
    modules: [...payload.moduleEntitlements].sort(),
    features: [...payload.featureEntitlements].sort(),
    supersedesOperationId: payload.supersedesOperationId,
    issuedAt: payload.issuedAt.toISOString(),
  };
  return JSON.stringify(wire);
}

/** Issue the signed artifact. Used only by the development issuing tool. */
export function signLicenseDocument(
  payload: LicenseVersionPayload,
  privateKey: KeyObject,
): string {
  assertLicenseVersionPayload(payload);
  const body = Buffer.from(canonicalizeLicenseVersion(payload), 'utf8');
  return [
    LICENSE_DOCUMENT_PREFIX,
    body.toString('base64url'),
    cryptoSign(null, body, privateKey).toString('base64url'),
  ].join('.');
}

/** Wrap an artifact in the versioned file envelope (primary transport). */
export function serializeLicenseFile(document: string, keyId?: string): string {
  return `${JSON.stringify(
    {
      format: LICENSE_FILE_FORMAT,
      fileVersion: LICENSE_FILE_VERSION,
      ...(keyId === undefined ? {} : { keyId }),
      document,
    },
    null,
    2,
  )}\n`;
}

export function licenseDocumentHash(document: string): string {
  return createHash('sha256').update(document.trim(), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Transport decoding
// ---------------------------------------------------------------------------

const ENVELOPE_KEYS = new Set(['format', 'fileVersion', 'document', 'keyId']);

/**
 * Decode the transport only. This says nothing about authenticity: it answers
 * "is this a file envelope or a bare artifact, and which artifact bytes does
 * it claim?" — the signature check happens next, on those bytes.
 */
export function decodeLicenseTransport(input: string): {
  document: string;
  transport: 'file' | 'text';
  keyId: string | null;
} {
  const value = input.trim();
  if (value === '') {
    throw new LicenseDocumentError(
      'malformed',
      'The license document is empty.',
    );
  }
  if (!value.startsWith('{')) {
    return { document: value, transport: 'text', keyId: null };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    throw new LicenseDocumentError(
      'malformed',
      'The license file is not readable.',
    );
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new LicenseDocumentError(
      'malformed',
      'The license file must contain one JSON object.',
    );
  }
  const envelope = raw as Record<string, unknown>;
  for (const key of Object.keys(envelope)) {
    if (!ENVELOPE_KEYS.has(key)) {
      throw new LicenseDocumentError(
        'malformed',
        `The license file carries an unexpected field "${key}".`,
      );
    }
  }
  if (envelope['format'] !== LICENSE_FILE_FORMAT) {
    throw new LicenseDocumentError(
      'malformed',
      'The license file does not declare the Vardena license format.',
    );
  }
  if (envelope['fileVersion'] !== LICENSE_FILE_VERSION) {
    throw new LicenseDocumentError(
      'unsupported-version',
      'This license file version is not supported by this Vardena build.',
    );
  }
  const document = envelope['document'];
  if (typeof document !== 'string' || document.trim() === '') {
    throw new LicenseDocumentError(
      'malformed',
      'The license file does not contain a signed document.',
    );
  }
  const keyId = envelope['keyId'];
  if (keyId !== undefined && typeof keyId !== 'string') {
    throw new LicenseDocumentError(
      'malformed',
      'The license file key hint must be a string.',
    );
  }
  return {
    document: document.trim(),
    transport: 'file',
    keyId: keyId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify a v2 artifact against the trust list and return the trusted payload.
 *
 * Installation binding, lifecycle and version conflicts are NOT decided here:
 * this answers "is this an authentic, well-formed license version?" only. The
 * application layer owns everything that depends on the installation's
 * current state.
 */
export function parseLicenseDocument(
  document: string,
  trustedKeys: readonly TrustedLicenseKey[],
  options: {
    /** Optional hint from the file envelope; must name a trusted key. */
    keyId?: string | null;
    /** Verifier, injectable so issuing and verification cannot drift. */
    verify?: (key: KeyObject, body: Buffer, signature: Buffer) => boolean;
  } = {},
): { payload: LicenseVersionPayload; keyId: string } {
  const verify =
    options.verify ??
    ((key, body, signature) => {
      try {
        return cryptoVerify(null, body, key, signature);
      } catch {
        return false;
      }
    });

  const value = document.trim();
  const parts = value.split('.');
  if (parts.length !== 3) {
    throw new LicenseDocumentError(
      'malformed',
      'The license document is not a well-formed Vardena document.',
    );
  }
  const [prefix, bodyPart, signaturePart] = parts as [string, string, string];
  if (prefix !== LICENSE_DOCUMENT_PREFIX) {
    throw new LicenseDocumentError(
      'unsupported-version',
      `Unsupported license document version "${prefix}".`,
    );
  }
  const body = Buffer.from(bodyPart, 'base64url');
  const signature = Buffer.from(signaturePart, 'base64url');
  if (body.length === 0 || signature.length === 0) {
    throw new LicenseDocumentError(
      'malformed',
      'The license document payload or signature is empty.',
    );
  }

  const hint = options.keyId ?? null;
  if (trustedKeys.length === 0) {
    throw new LicenseDocumentError(
      'signature',
      'No licensing authority public key is configured for this installation.',
    );
  }
  const candidates =
    hint === null ? trustedKeys : trustedKeys.filter((key) => key.id === hint);
  if (candidates.length === 0) {
    throw new LicenseDocumentError(
      'unknown-key',
      `The license document was signed with an unknown key "${hint}".`,
    );
  }
  const matched = candidates.find((key) => verify(key.key, body, signature));
  if (matched === undefined) {
    throw new LicenseDocumentError(
      'signature',
      'The license document signature is not valid for this installation.',
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(body.toString('utf8'));
  } catch {
    throw new LicenseDocumentError(
      'malformed',
      'The license document payload is not readable.',
    );
  }
  const payload = readLicenseVersionPayload(raw);
  assertLicenseVersionPayload(payload);
  if (canonicalizeLicenseVersion(payload) !== body.toString('utf8')) {
    throw new LicenseDocumentError(
      'payload',
      'The license document payload is not in canonical form.',
    );
  }
  return { payload, keyId: matched.id };
}

function readLicenseVersionPayload(raw: unknown): LicenseVersionPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new LicenseDocumentError(
      'payload',
      'The license document payload is not an object.',
    );
  }
  const wire = raw as Partial<WirePayloadV2>;
  if (wire.v !== LICENSE_DOCUMENT_VERSION) {
    throw new LicenseDocumentError(
      'unsupported-version',
      `Only version ${LICENSE_DOCUMENT_VERSION} license documents are supported.`,
    );
  }
  if (wire.kind !== LICENSE_DOCUMENT_KIND) {
    throw new LicenseDocumentError(
      'payload',
      'The license document is not a server license version.',
    );
  }
  return {
    version: LICENSE_DOCUMENT_VERSION,
    kind: LICENSE_DOCUMENT_KIND,
    operationId: readId(wire.operationId, 'operationId'),
    licenseId: readId(wire.licenseId, 'licenseId'),
    customerId: readId(wire.customerId, 'customerId'),
    customerName: readName(wire.customerName),
    installationId: readId(wire.installationId, 'installationId'),
    status: readStatus(wire.status),
    validFrom: readDate(wire.validFrom, 'validFrom'),
    validUntil:
      wire.validUntil === null || wire.validUntil === undefined
        ? null
        : readDate(wire.validUntil, 'validUntil'),
    organizationLimit: readLimit(wire.organizationLimit, 'organizationLimit'),
    userLimit: readLimit(wire.userLimit, 'userLimit'),
    moduleEntitlements: readCodes(wire.modules, 'modules'),
    featureEntitlements: readCodes(wire.features, 'features'),
    supersedesOperationId:
      wire.supersedesOperationId === null ||
      wire.supersedesOperationId === undefined
        ? null
        : readId(wire.supersedesOperationId, 'supersedesOperationId'),
    issuedAt: readDate(wire.issuedAt, 'issuedAt'),
  };
}

function readId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new LicenseDocumentError(
      'payload',
      `The license ${field} is missing or malformed.`,
    );
  }
  return value;
}

function readName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > MAX_CUSTOMER_NAME
  ) {
    throw new LicenseDocumentError(
      'payload',
      'The license customerName is missing or malformed.',
    );
  }
  return value;
}

function readStatus(value: unknown): LicenseStatus {
  if (value !== 'ACTIVE' && value !== 'EXPIRED' && value !== 'SUSPENDED') {
    throw new LicenseDocumentError(
      'payload',
      'The license status must be ACTIVE, EXPIRED, or SUSPENDED.',
    );
  }
  return value;
}

function readDate(value: unknown, field: string): Date {
  if (typeof value !== 'string') {
    throw new LicenseDocumentError(
      'payload',
      `The license ${field} is missing.`,
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new LicenseDocumentError(
      'payload',
      `The license ${field} is not an ISO-8601 instant.`,
    );
  }
  return parsed;
}

function readLimit(value: unknown, field: string): LicenseLimit {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value)) {
    throw new LicenseDocumentError(
      'limits',
      `The license ${field} must be an integer or null (unlimited).`,
    );
  }
  return value as number;
}

function readCodes(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new LicenseDocumentError(
      'entitlements',
      `The license ${field} must be an array of codes.`,
    );
  }
  return value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new LicenseDocumentError(
        'entitlements',
        `The license ${field} must contain only string codes.`,
      );
    }
    return entry;
  });
}

/**
 * Semantic validation shared by issuing and verification. Nothing here knows
 * about the installation's current state — that is the import service's job.
 */
export function assertLicenseVersionPayload(
  payload: LicenseVersionPayload,
): void {
  if (
    payload.validUntil !== null &&
    payload.validUntil.getTime() <= payload.validFrom.getTime()
  ) {
    throw new LicenseDocumentError(
      'validity',
      'The license validUntil must be later than validFrom.',
    );
  }
  if (
    payload.supersedesOperationId !== null &&
    payload.supersedesOperationId === payload.operationId
  ) {
    throw new LicenseDocumentError(
      'payload',
      'A license version cannot supersede itself.',
    );
  }
  for (const [field, limit] of [
    ['organizationLimit', payload.organizationLimit],
    ['userLimit', payload.userLimit],
  ] as const) {
    if (limit !== null && limit <= 0) {
      throw new LicenseDocumentError(
        'limits',
        `The license ${field} must be a positive integer or null (unlimited).`,
      );
    }
  }
  const modules = new Set(payload.moduleEntitlements);
  if (modules.size !== payload.moduleEntitlements.length) {
    throw new LicenseDocumentError(
      'entitlements',
      'The license repeats a module entitlement.',
    );
  }
  for (const code of payload.moduleEntitlements) {
    if (!KNOWN_MODULE_CODES.includes(code)) {
      throw new LicenseDocumentError(
        'entitlements',
        `The license names an unknown module entitlement "${code}".`,
      );
    }
  }
  const features = new Set(payload.featureEntitlements);
  if (features.size !== payload.featureEntitlements.length) {
    throw new LicenseDocumentError(
      'entitlements',
      'The license repeats a feature entitlement.',
    );
  }
  for (const code of payload.featureEntitlements) {
    if (!CODE_PATTERN.test(code)) {
      throw new LicenseDocumentError(
        'entitlements',
        `The license names a malformed feature entitlement "${code}".`,
      );
    }
  }
}

export function licenseVersionEntitlements(
  payload: LicenseVersionPayload,
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

export { LicenseCodeError };
