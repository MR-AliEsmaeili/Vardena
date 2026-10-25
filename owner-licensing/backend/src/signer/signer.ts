import { createPublicKey, timingSafeEqual, type KeyObject } from "node:crypto";
import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { SignerError } from "./errors.js";
import {
  ProtocolError,
  REVOCATION_REASONS,
  canonicalizeLicenseVersion,
  canonicalizeRevocation,
  decodeLicenseRequest,
  decodeRevocationRequest,
  deriveKeyId,
  hashKeyMaterial,
  licenseFileEnvelope,
  projectLicensePayload,
  revocationFileEnvelope,
  sha256Hex,
  signLicenseVersion,
  signRevocation,
  type LicenseRequestPayload,
  type RevocationPayload,
} from "../protocol.js";

/**
 * Air-gapped offline signer (OD-LIC-08, OD-LIC-11).
 *
 * Hard ordering rule: the private key is **not read or loaded** until
 *
 *   1. the request is structurally valid and canonical,
 *   2. the full 64-hex `request_payload_sha256` supplied over a channel
 *      independent of the request file matches the digest computed here,
 *   3. the request's pinned key id matches the signer's configured key id,
 *   4. the dates are inside the documented tolerance, and
 *   5. the operation was not already signed on this machine.
 *
 * `loadPrivateKey` is a callback precisely so the ordering is testable: a test
 * asserts the callback is never invoked on every refusal path.
 *
 * The signer has no network, no database and no import from the Owner API,
 * the Owner configuration or a customer runtime.
 */

export const SIGNER_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
export const SIGNER_CLOCK_TOLERANCE_MS = 10 * 60 * 1000;

export { SignerError, type SignerErrorCode } from "./errors.js";
export { assertKeyFilePrivate } from "./key-permissions.js";

export interface SignedLicenseResult {
  document: string;
  envelope: string;
  fileName: string;
  artifactSha256: string;
  requestPayloadSha256: string;
  requestBindingSha256: string;
  operationId: string;
  keyId: string;
}

export interface SignedRevocationResult {
  document: string;
  envelope: string;
  fileName: string;
  artifactSha256: string;
  requestPayloadSha256: string;
  requestBindingSha256: string;
  revocationId: string;
  keyId: string;
}

function requireDigest(expected: string | null | undefined): string {
  if (expected === null || expected === undefined || expected.trim() === "")
    throw new SignerError(
      "digest-missing",
      "The out-of-band request digest is required before the private key is read.",
    );
  const value = expected.trim();
  if (!SIGNER_DIGEST_PATTERN.test(value))
    throw new SignerError(
      "digest-malformed",
      "The out-of-band request digest must be exactly 64 lowercase hexadecimal characters; shortening it is forbidden.",
    );
  return value;
}

function equalDigest(expected: string, computed: string): void {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(computed, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new SignerError(
      "digest-mismatch",
      "The request file does not match the digest carried over the independent channel.",
    );
}

function decodeLicenseRequestOrFail(content: string) {
  try {
    return decodeLicenseRequest(content);
  } catch (error) {
    if (error instanceof ProtocolError)
      throw new SignerError("request-malformed", error.message);
    throw error;
  }
}

function decodeRevocationRequestOrFail(content: string) {
  try {
    return decodeRevocationRequest(content);
  } catch (error) {
    if (error instanceof ProtocolError)
      throw new SignerError("request-malformed", error.message);
    throw error;
  }
}

function assertLicenseWindow(request: LicenseRequestPayload, now: Date): void {
  const tolerance = SIGNER_CLOCK_TOLERANCE_MS;
  if (request.requestedAt.getTime() > now.getTime() + tolerance)
    throw new SignerError(
      "date-invalid",
      "The request claims a creation instant in the future.",
    );
  if (request.issuedAt.getTime() > now.getTime() + tolerance)
    throw new SignerError(
      "date-invalid",
      "The request claims an issuance instant in the future.",
    );
  if (request.validFrom.getTime() > now.getTime() + tolerance)
    throw new SignerError(
      "date-invalid",
      "The license would start in the future; a start date must never be future-dated.",
    );
  if (request.validUntil !== null) {
    if (request.validUntil.getTime() <= request.validFrom.getTime())
      throw new SignerError(
        "date-invalid",
        "The license end must be later than its start.",
      );
    if (request.validUntil.getTime() <= now.getTime())
      throw new SignerError(
        "date-invalid",
        "The license term has already ended; the customer runtime would refuse it.",
      );
  }
}

function assertRevocationWindow(payload: RevocationPayload, now: Date): void {
  if (payload.issuedAt.getTime() > now.getTime() + SIGNER_CLOCK_TOLERANCE_MS)
    throw new SignerError(
      "date-invalid",
      "The revocation claims an issue instant in the future.",
    );
}

async function assertNotAlreadySigned(
  statePath: string | undefined,
  identity: string,
): Promise<void> {
  if (statePath === undefined) return;
  let content = "";
  try {
    content = await readFile(statePath, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return;
    throw new SignerError(
      "state-unavailable",
      "The duplicate-suppression record is unreadable.",
    );
  }
  for (const line of content.split("\n")) {
    if (line.trim() === "") continue;
    const [, recorded] = line.split(/\s+/, 2);
    if (recorded === identity)
      throw new SignerError(
        "already-signed",
        "This operation was already signed on this signing station.",
      );
  }
}

async function recordSigned(
  statePath: string | undefined,
  identity: string,
  now: Date,
): Promise<void> {
  if (statePath === undefined) return;
  try {
    await mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
    await appendFile(statePath, `${now.toISOString()}\t${identity}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    const handle = await open(statePath, "r+");
    // Windows rejects fsync on a read-only handle; r+ keeps the durability
    // barrier without changing the replay semantics.
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    throw new SignerError(
      "state-unavailable",
      "The signature was produced but the duplicate-suppression record could not be updated.",
    );
  }
}

function checkDerivedKeyId(key: KeyObject, keyId: string): void {
  if (!keyId.startsWith("sha256-")) return; // operator-assigned trust-list id
  const publicKey = key.type === "private" ? createPublicKey(key) : key;
  if (deriveKeyId(publicKey) !== keyId)
    throw new SignerError(
      "key-id-mismatch",
      "The supplied private key does not correspond to the requested key id.",
    );
}

export interface SignLicenseOptions {
  requestContent: string;
  /** The full 64-hex digest carried over a channel independent of the file. */
  expectedDigest: string | null | undefined;
  /** Trust-list id the signer is configured to sign with. */
  keyId: string;
  /** Called only after every pre-key check has passed. */
  loadPrivateKey: () => KeyObject | Promise<KeyObject>;
  /** Append-only duplicate-suppression record; optional but recommended. */
  statePath?: string;
  now?: Date;
}

export async function signLicenseRequest(
  options: SignLicenseOptions,
): Promise<SignedLicenseResult> {
  // 1–2: structure and canonical form (no key touched).
  const decoded = decodeLicenseRequestOrFail(options.requestContent);
  // 3: the independent value, exactly 64 lowercase hex.
  const expected = requireDigest(options.expectedDigest);
  equalDigest(expected, decoded.requestDigest);
  // 4: the request must be for the key this station is configured to use.
  if (decoded.request.signingKeyId !== options.keyId)
    throw new SignerError(
      "key-id-mismatch",
      "The request pins a different signing key than this signing station.",
    );
  // 5: dates.
  const now = options.now ?? new Date();
  assertLicenseWindow(decoded.request, now);
  // 6: replay at the signer.
  await assertNotAlreadySigned(options.statePath, decoded.request.operationId);

  // 7: only now is the private key read or loaded.
  const privateKey = await options.loadPrivateKey();
  checkDerivedKeyId(privateKey, options.keyId);

  const payload = projectLicensePayload(decoded.request);
  const document = signLicenseVersion(payload, privateKey);
  const envelope = licenseFileEnvelope(document, options.keyId);
  const artifactSha256 = sha256Hex(Buffer.from(envelope, "utf8"));
  const requestBindingSha256 = sha256Hex(
    Buffer.from(canonicalizeLicenseVersion(payload), "utf8"),
  );
  await recordSigned(options.statePath, decoded.request.operationId, now);
  return {
    document,
    envelope,
    fileName: `vardena-license-${decoded.request.operationId}.json`,
    artifactSha256,
    requestPayloadSha256: decoded.requestDigest,
    requestBindingSha256,
    operationId: decoded.request.operationId,
    keyId: options.keyId,
  };
}

export interface SignRevocationOptions {
  requestContent: string;
  expectedDigest: string | null | undefined;
  keyId: string;
  loadPrivateKey: () => KeyObject | Promise<KeyObject>;
  statePath?: string;
  now?: Date;
}

export async function signRevocationRequest(
  options: SignRevocationOptions,
): Promise<SignedRevocationResult> {
  const decoded = decodeRevocationRequestOrFail(options.requestContent);
  const expected = requireDigest(options.expectedDigest);
  equalDigest(expected, decoded.requestDigest);
  const payload = decoded.payload;
  if (payload.issuerKeyId !== options.keyId)
    throw new SignerError(
      "key-id-mismatch",
      "The revocation pins a different signing key than this signing station.",
    );
  if (!REVOCATION_REASONS.includes(payload.reason))
    throw new SignerError("request-malformed", "Unknown revocation reason.");
  const now = options.now ?? new Date();
  assertRevocationWindow(payload, now);
  await assertNotAlreadySigned(options.statePath, payload.revocationId);

  const privateKey = await options.loadPrivateKey();
  checkDerivedKeyId(privateKey, options.keyId);

  const document = signRevocation(payload, privateKey);
  const envelope = revocationFileEnvelope(document, options.keyId);
  const artifactSha256 = sha256Hex(Buffer.from(envelope, "utf8"));
  const requestBindingSha256 = sha256Hex(
    Buffer.from(canonicalizeRevocation(payload), "utf8"),
  );
  await recordSigned(options.statePath, payload.revocationId, now);
  return {
    document,
    envelope,
    fileName: `vardena-revocation-${payload.revocationId}.json`,
    artifactSha256,
    requestPayloadSha256: decoded.requestDigest,
    requestBindingSha256,
    revocationId: payload.revocationId,
    keyId: options.keyId,
  };
}

/** Re-export for the CLI/tests: the id a bare trust entry would assign. */
export { hashKeyMaterial };

/** Refuse to run where an Owner API/service environment is detectable. */
export function assertSignerEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (
    env.OWNER_DATABASE_URL !== undefined ||
    env.OWNER_PUBLIC_ORIGIN !== undefined ||
    env.NODE_ENV === "production"
  ) {
    throw new SignerError(
      "unsafe-environment",
      "The offline signer must not run inside the Owner application or a production service environment.",
    );
  }
}
