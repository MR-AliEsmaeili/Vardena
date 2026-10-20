import {
  createHash,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import type { TrustedLicenseKey } from './license-document.js';

/**
 * Signed license revocation artifact (`VREV1`) — customer-side parsing and
 * verification (OD-LIC-17).
 *
 * The normative design is `docs/licensing/revocation-artifact-protocol.md`.
 * This module implements ONLY the document half: transport, signature,
 * canonical form and payload shape. Everything that depends on this
 * installation's state — customer binding, installation binding, target
 * version, staleness and replay — belongs to `LicenseRevocationService`,
 * exactly like the license import split.
 *
 * Domain separation from the license contract is structural, not conventional:
 * a `VLIC2` document cannot verify here (different prefix), a `VREV1` document
 * cannot verify as a license, and the payload structs share no field order.
 * Neither canonicalizes the other's bytes. The signed `kind` is checked too.
 */

export const REVOCATION_FILE_FORMAT = 'vardena-revocation';
export const REVOCATION_FILE_VERSION = 1;
export const REVOCATION_DOCUMENT_PREFIX = 'VREV1';
export const REVOCATION_DOCUMENT_VERSION = 1;
export const REVOCATION_DOCUMENT_KIND = 'SERVER_LICENSE_REVOCATION';
export const REVOCATION_EFFECT_LICENSE_ONLY = 'LICENSE_ONLY';

/** The closed reason vocabulary; the Owner UI offers exactly these. */
export const REVOCATION_REASONS = [
  'NON_PAYMENT',
  'CONTRACT_TERMINATION',
  'FRAUD',
  'KEY_COMPROMISE',
  'ISSUED_IN_ERROR',
  'COURT_ORDER',
  'OTHER',
] as const;

export type RevocationReason = (typeof REVOCATION_REASONS)[number];

/**
 * Rejection reasons for the *document*: malformed transport, unsupported
 * version, bad signature, unknown or mismatched key, invalid payload, non
 * canonical bytes. State-dependent reasons live in the service.
 */
export type RevocationDocumentErrorReason =
  | 'malformed'
  | 'unsupported-version'
  | 'signature'
  | 'unknown-key'
  | 'key-mismatch'
  | 'payload'
  | 'canonical';

export class RevocationDocumentError extends Error {
  constructor(
    readonly reason: RevocationDocumentErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'RevocationDocumentError';
  }
}

export interface RevocationPayload {
  v: 1;
  kind: typeof REVOCATION_DOCUMENT_KIND;
  revocationId: string;
  licenseId: string;
  targetOperationId: string;
  customerId: string;
  customerCode: string;
  installationId: string;
  effect: typeof REVOCATION_EFFECT_LICENSE_ONLY;
  reason: RevocationReason;
  reasonDetail: string | null;
  issuerKeyId: string;
  issuedAt: Date;
}

export interface VerifiedRevocation {
  payload: RevocationPayload;
  /** The trusted key that actually verified the signature. */
  keyId: string;
  /** The exact canonical bytes the signature covered. */
  canonicalBody: string;
  /** SHA-256 of those bytes — the deduplication/evidence digest. */
  payloadDigest: string;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CUSTOMER_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;
const MAX_REASON_DETAIL = 500;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * The wire projection, in the protocol's fixed field order. Kept separate from
 * the typed payload so a future field cannot be accidentally emitted by
 * spreading the object.
 */
interface WireRevocation {
  v: 1;
  kind: string;
  revocationId: string;
  licenseId: string;
  targetOperationId: string;
  customerId: string;
  customerCode: string;
  installationId: string;
  effect: string;
  reason: string;
  reasonDetail: string | null;
  issuerKeyId: string;
  issuedAt: string;
}

/**
 * Canonical serialization — identical rules to the license contract: one line,
 * no whitespace, fixed order, `toISOString()` instants. Every field is always
 * emitted (there is no omission rule in this format).
 */
export function canonicalizeRevocation(payload: RevocationPayload): string {
  const wire: WireRevocation = {
    v: 1,
    kind: REVOCATION_DOCUMENT_KIND,
    revocationId: payload.revocationId,
    licenseId: payload.licenseId,
    targetOperationId: payload.targetOperationId,
    customerId: payload.customerId,
    customerCode: payload.customerCode,
    installationId: payload.installationId,
    effect: payload.effect,
    reason: payload.reason,
    reasonDetail: payload.reasonDetail,
    issuerKeyId: payload.issuerKeyId,
    issuedAt: payload.issuedAt.toISOString(),
  };
  return JSON.stringify(wire);
}

/**
 * Semantic validation shared by every caller. A document that is not readable
 * as exactly these 13 fields in exactly these types is refused before any
 * state is consulted.
 */
export function assertRevocationPayload(payload: RevocationPayload): void {
  for (const [field, value] of [
    ['revocationId', payload.revocationId],
    ['licenseId', payload.licenseId],
    ['targetOperationId', payload.targetOperationId],
    ['customerId', payload.customerId],
    ['installationId', payload.installationId],
  ] as const) {
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
      throw new RevocationDocumentError(
        'payload',
        `The revocation ${field} is missing or malformed.`,
      );
    }
  }
  if (
    typeof payload.customerCode !== 'string' ||
    !CUSTOMER_CODE_PATTERN.test(payload.customerCode) ||
    payload.customerCode === payload.customerId
  ) {
    throw new RevocationDocumentError(
      'payload',
      'The revocation customerCode is missing, malformed or equal to customerId.',
    );
  }
  if (payload.effect !== REVOCATION_EFFECT_LICENSE_ONLY) {
    throw new RevocationDocumentError(
      'payload',
      'Only a LICENSE_ONLY revocation effect is supported.',
    );
  }
  if (!REVOCATION_REASONS.includes(payload.reason)) {
    throw new RevocationDocumentError(
      'payload',
      'The revocation reason is not in the closed vocabulary.',
    );
  }
  if (payload.reasonDetail !== null) {
    if (
      typeof payload.reasonDetail !== 'string' ||
      payload.reasonDetail.length > MAX_REASON_DETAIL ||
      payload.reasonDetail.trim() === '' ||
      CONTROL_CHARACTERS.test(payload.reasonDetail)
    ) {
      throw new RevocationDocumentError(
        'payload',
        'The revocation reasonDetail is missing, too long or malformed.',
      );
    }
  }
  if (payload.reason === 'OTHER' && payload.reasonDetail === null) {
    throw new RevocationDocumentError(
      'payload',
      'A revocation reason of OTHER requires a reasonDetail.',
    );
  }
  if (
    typeof payload.issuerKeyId !== 'string' ||
    !KEY_ID_PATTERN.test(payload.issuerKeyId)
  ) {
    throw new RevocationDocumentError(
      'payload',
      'The revocation issuerKeyId is missing or malformed.',
    );
  }
  if (
    !(payload.issuedAt instanceof Date) ||
    Number.isNaN(payload.issuedAt.getTime())
  ) {
    throw new RevocationDocumentError(
      'payload',
      'The revocation issuedAt is missing or malformed.',
    );
  }
}

const ENVELOPE_KEYS = new Set(['format', 'fileVersion', 'revocation', 'keyId']);

/**
 * Decode the transport only. This says nothing about authenticity: it answers
 * "is this a revocation file, and which artifact bytes does it claim?". The
 * signature is checked next, on those exact bytes.
 */
export function decodeRevocationTransport(input: string): {
  document: string;
  transport: 'file' | 'text';
  keyId: string | null;
} {
  const value = input.trim();
  if (value === '') {
    throw new RevocationDocumentError('malformed', 'The file is empty.');
  }
  if (!value.startsWith('{')) {
    return { document: value, transport: 'text', keyId: null };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    throw new RevocationDocumentError(
      'malformed',
      'The revocation file is not readable.',
    );
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new RevocationDocumentError(
      'malformed',
      'The revocation file must contain one JSON object.',
    );
  }
  const envelope = raw as Record<string, unknown>;
  for (const key of Object.keys(envelope)) {
    if (!ENVELOPE_KEYS.has(key)) {
      throw new RevocationDocumentError(
        'malformed',
        `The revocation file carries an unexpected field "${key}".`,
      );
    }
  }
  if (envelope['format'] !== REVOCATION_FILE_FORMAT) {
    throw new RevocationDocumentError(
      'malformed',
      'The file does not declare the Vardena revocation format.',
    );
  }
  if (envelope['fileVersion'] !== REVOCATION_FILE_VERSION) {
    throw new RevocationDocumentError(
      'unsupported-version',
      'This revocation file version is not supported by this Vardena build.',
    );
  }
  const document = envelope['revocation'];
  if (typeof document !== 'string' || document.trim() === '') {
    throw new RevocationDocumentError(
      'malformed',
      'The revocation file does not contain a signed document.',
    );
  }
  const keyId = envelope['keyId'];
  if (keyId !== undefined && typeof keyId !== 'string') {
    throw new RevocationDocumentError(
      'malformed',
      'The revocation file key hint must be a string.',
    );
  }
  return { document: document.trim(), transport: 'file', keyId: keyId ?? null };
}

/**
 * Verify a revocation document against the configured trust list.
 *
 * Order (protocol §4, first failure wins):
 *   1. armor shape and version;
 *   2. non-empty payload/signature;
 *   3. key resolution — unknown hint is `unknown-key`, never a silent full-list
 *      scan that would hide a typo in the Owner's key id;
 *   4. Ed25519 signature over the exact payload bytes;
 *   5. payload is JSON and carries exactly the 13 typed fields;
 *   6. `issuerKeyId` equals the key that verified;
 *   7. re-canonicalizing the payload reproduces the signed bytes exactly.
 *
 * Nothing here writes, caches or logs the document.
 */
export function parseRevocationDocument(
  document: string,
  trustedKeys: readonly TrustedLicenseKey[],
  options: {
    keyId?: string | null;
    /** Injectable verifier so tests can pin the exact bytes checked. */
    verify?: (key: KeyObject, body: Buffer, signature: Buffer) => boolean;
  } = {},
): VerifiedRevocation {
  const verify =
    options.verify ??
    ((key, body, signature) => {
      try {
        return cryptoVerify(null, body, key, signature);
      } catch {
        return false;
      }
    });

  const parts = document.trim().split('.');
  if (parts.length !== 3) {
    throw new RevocationDocumentError(
      'malformed',
      'The revocation document is not a well-formed Vardena document.',
    );
  }
  const [prefix, bodyPart, signaturePart] = parts as [string, string, string];
  if (prefix !== REVOCATION_DOCUMENT_PREFIX) {
    throw new RevocationDocumentError(
      'unsupported-version',
      `Unsupported revocation document version "${prefix}".`,
    );
  }
  const body = Buffer.from(bodyPart, 'base64url');
  const signature = Buffer.from(signaturePart, 'base64url');
  if (body.length === 0 || signature.length === 0) {
    throw new RevocationDocumentError(
      'malformed',
      'The revocation document payload or signature is empty.',
    );
  }
  if (trustedKeys.length === 0) {
    throw new RevocationDocumentError(
      'signature',
      'No licensing authority public key is configured for this installation.',
    );
  }
  const hint = options.keyId ?? null;
  const candidates =
    hint === null ? trustedKeys : trustedKeys.filter((key) => key.id === hint);
  if (candidates.length === 0) {
    throw new RevocationDocumentError(
      'unknown-key',
      `The revocation document was signed with an unknown key "${hint}".`,
    );
  }
  const matched = candidates.find((key) => verify(key.key, body, signature));
  if (matched === undefined) {
    throw new RevocationDocumentError(
      'signature',
      'The revocation document signature is not valid for this installation.',
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(body.toString('utf8'));
  } catch {
    throw new RevocationDocumentError(
      'malformed',
      'The revocation document payload is not readable.',
    );
  }
  const payload = readRevocationPayload(raw);
  assertRevocationPayload(payload);
  if (payload.issuerKeyId !== matched.id) {
    throw new RevocationDocumentError(
      'key-mismatch',
      'The revocation issuerKeyId does not match the key that verified it.',
    );
  }
  const canonicalBody = canonicalizeRevocation(payload);
  if (canonicalBody !== body.toString('utf8')) {
    throw new RevocationDocumentError(
      'canonical',
      'The revocation document payload is not in canonical form.',
    );
  }
  return {
    payload,
    keyId: matched.id,
    canonicalBody,
    payloadDigest: createHash('sha256').update(body).digest('hex'),
  };
}

function readRevocationPayload(raw: unknown): RevocationPayload {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new RevocationDocumentError(
      'payload',
      'The revocation payload is not an object.',
    );
  }
  const wire = raw as Record<string, unknown>;
  const expected = [
    'v',
    'kind',
    'revocationId',
    'licenseId',
    'targetOperationId',
    'customerId',
    'customerCode',
    'installationId',
    'effect',
    'reason',
    'reasonDetail',
    'issuerKeyId',
    'issuedAt',
  ];
  // Field SET is what this check owns; field ORDER is owned by the canonical
  // round-trip in `parseRevocationDocument` (a payload with the right fields in
  // the wrong order is authentic but not canonical → `canonical`). Sorting here
  // would make the check compare an unordered set against an ordered list.
  const keys = Object.keys(wire);
  if (
    keys.length !== expected.length ||
    expected.some((key) => !Object.hasOwn(wire, key))
  ) {
    throw new RevocationDocumentError(
      'payload',
      'The revocation payload must carry exactly the documented fields.',
    );
  }
  if (wire['v'] !== REVOCATION_DOCUMENT_VERSION) {
    throw new RevocationDocumentError(
      'unsupported-version',
      `Only version ${REVOCATION_DOCUMENT_VERSION} revocation documents are supported.`,
    );
  }
  if (wire['kind'] !== REVOCATION_DOCUMENT_KIND) {
    throw new RevocationDocumentError(
      'payload',
      'The document is not a server license revocation.',
    );
  }
  const issuedAt = readInstant(wire['issuedAt']);
  const reasonDetail = wire['reasonDetail'];
  if (reasonDetail !== null && typeof reasonDetail !== 'string') {
    throw new RevocationDocumentError(
      'payload',
      'The revocation reasonDetail must be a string or null.',
    );
  }
  const effect = wire['effect'];
  if (effect !== REVOCATION_EFFECT_LICENSE_ONLY) {
    throw new RevocationDocumentError(
      'payload',
      'Only a LICENSE_ONLY revocation effect is supported.',
    );
  }
  const reason = wire['reason'];
  if (
    typeof reason !== 'string' ||
    !(REVOCATION_REASONS as readonly string[]).includes(reason)
  ) {
    throw new RevocationDocumentError(
      'payload',
      'The revocation reason is not in the closed vocabulary.',
    );
  }
  const payload: RevocationPayload = {
    v: 1,
    kind: REVOCATION_DOCUMENT_KIND,
    revocationId: readString(wire['revocationId'], 'revocationId'),
    licenseId: readString(wire['licenseId'], 'licenseId'),
    targetOperationId: readString(
      wire['targetOperationId'],
      'targetOperationId',
    ),
    customerId: readString(wire['customerId'], 'customerId'),
    customerCode: readString(wire['customerCode'], 'customerCode'),
    installationId: readString(wire['installationId'], 'installationId'),
    effect: REVOCATION_EFFECT_LICENSE_ONLY,
    reason: reason as RevocationReason,
    reasonDetail: reasonDetail as string | null,
    issuerKeyId: readString(wire['issuerKeyId'], 'issuerKeyId'),
    issuedAt,
  };
  return payload;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new RevocationDocumentError(
      'payload',
      `The revocation ${field} must be a string.`,
    );
  }
  return value;
}

/**
 * A canonical instant: it must round-trip through `toISOString()`, so a
 * payload that says `2026-10-20T10:00:00Z` (valid ISO, non-canonical form) is
 * refused rather than silently rewritten into another signed value.
 */
function readInstant(value: unknown): Date {
  if (typeof value !== 'string') {
    throw new RevocationDocumentError(
      'payload',
      'The revocation issuedAt is missing.',
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new RevocationDocumentError(
      'payload',
      'The revocation issuedAt is not a canonical ISO-8601 instant.',
    );
  }
  return parsed;
}
