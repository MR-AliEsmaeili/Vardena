import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";

/**
 * Owner-side implementation of the ratified licensing byte contract.
 *
 * The Owner may not import the customer's crypto module (ADR-0048, PDR-16
 * D-2(a)), so this file is an independent implementation of exactly the same
 * rules. Conformance is proven by the shared vector corpus
 * (`docs/licensing/vectors/**`), by literal golden values pinned in the Owner
 * tests, and by a round trip through the offline signer.
 *
 * Formats implemented here:
 *   - `VLIC2`  signed license version (payload `v = 2`)
 *   - `VREV1`  signed revocation (payload `v = 1`, OD-LIC-17)
 *   - `VLSR1`  unsigned signing request for a license (Owner transport only)
 *   - `VRRQ1`  unsigned signing request for a revocation (Owner transport only)
 *
 * The two request formats are transport, never credentials. They carry no
 * signature and are never described as licenses or revocations.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LICENSE_FILE_FORMAT = "vardena-license";
export const LICENSE_FILE_VERSION = 1;
export const LICENSE_DOCUMENT_PREFIX = "VLIC2";
export const LICENSE_DOCUMENT_VERSION = 2;
export const LICENSE_DOCUMENT_KIND = "SERVER_LICENSE_VERSION";

export const REQUEST_FILE_FORMAT = "vardena-license-signing-request";
export const REQUEST_FILE_VERSION = 1;
export const REQUEST_PREFIX = "VLSR1";
export const REQUEST_KIND = "SERVER_LICENSE_ISSUANCE_REQUEST";

export const REVOCATION_FILE_FORMAT = "vardena-revocation";
export const REVOCATION_FILE_VERSION = 1;
export const REVOCATION_PREFIX = "VREV1";
export const REVOCATION_KIND = "SERVER_LICENSE_REVOCATION";

export const REVOCATION_REQUEST_FILE_FORMAT =
  "vardena-revocation-signing-request";
export const REVOCATION_REQUEST_PREFIX = "VRRQ1";

/** The only signed revocation effect: one license, nothing else. */
export const REVOCATION_EFFECT_LICENSE_ONLY = "LICENSE_ONLY";

/** Closed reason vocabulary (docs/licensing/revocation-artifact-protocol.md §3). */
export const REVOCATION_REASONS = [
  "NON_PAYMENT",
  "CONTRACT_TERMINATION",
  "FRAUD",
  "KEY_COMPROMISE",
  "ISSUED_IN_ERROR",
  "COURT_ORDER",
  "OTHER",
] as const;
export type RevocationReason = (typeof REVOCATION_REASONS)[number];

/** Same catalog the customer accepts (license-code.ts KNOWN_MODULE_CODES). */
export const KNOWN_MODULE_CODES: readonly string[] = [
  "accounting",
  "documents",
  "inventory",
  "organization",
  "rbac",
  "users",
  "workflow",
];

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CODE_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
const CUSTOMER_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const MAX_CUSTOMER_NAME = 200;

export type ProtocolErrorReason =
  | "malformed"
  | "unsupported-version"
  | "signature"
  | "unknown-key"
  | "key-mismatch"
  | "payload"
  | "validity"
  | "limits"
  | "entitlements"
  | "canonical";

/** One stable, secret-free rejection reason. */
export class ProtocolError extends Error {
  constructor(
    readonly reason: ProtocolErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

// ---------------------------------------------------------------------------
// Trust list — identical grammar to the customer runtime
// ---------------------------------------------------------------------------

export interface TrustedLicenseKey {
  id: string;
  key: KeyObject;
}

export function hashKeyMaterial(key: KeyObject): string {
  const der = key.export({ format: "der", type: "spki" });
  return `sha256-${createHash("sha256").update(der).digest("hex").slice(0, 16)}`;
}

/** Accepts a PEM block or base64 DER (SPKI) Ed25519 public key. */
export function parsePublicKey(material: string): KeyObject {
  const value = material.trim();
  if (value.includes("BEGIN")) {
    return createPublicKey({ key: value, format: "pem" });
  }
  return createPublicKey({
    key: Buffer.from(value, "base64"),
    format: "der",
    type: "spki",
  });
}

/** Accepts a PEM block or base64 DER (PKCS8) Ed25519 private key. */
export function parsePrivateKey(material: string): KeyObject {
  const value = material.trim();
  if (value.includes("BEGIN")) {
    return createPrivateKey({ key: value, format: "pem" });
  }
  return createPrivateKey({
    key: Buffer.from(value, "base64"),
    format: "der",
    type: "pkcs8",
  });
}

export function splitTrustedKeyEntry(entry: string): {
  id: string | null;
  material: string;
} {
  const value = entry.trim();
  const separator = value.indexOf(":");
  if (separator <= 0) return { id: null, material: value };
  const id = value.slice(0, separator);
  const material = value.slice(separator + 1).trim();
  if (!KEY_ID_PATTERN.test(id) || material === "") {
    return { id: null, material: value };
  }
  return { id, material };
}

/** Parse `keyId:<material>` / bare entries; duplicate ids are refused. */
export function parseTrustedLicenseKeys(
  entries: readonly string[],
): TrustedLicenseKey[] {
  const seen = new Set<string>();
  return entries.map((entry, index) => {
    const { id, material } = splitTrustedKeyEntry(entry);
    let key: KeyObject;
    try {
      key = parsePublicKey(material);
    } catch {
      throw new Error(
        `OWNER_LICENSE_TRUSTED_PUBLIC_KEYS entry ${index + 1} is not a valid Ed25519 public key.`,
      );
    }
    const resolved = id ?? hashKeyMaterial(key);
    if (seen.has(resolved)) {
      throw new Error(
        `OWNER_LICENSE_TRUSTED_PUBLIC_KEYS contains the duplicate key id "${resolved}".`,
      );
    }
    seen.add(resolved);
    return { id: resolved, key };
  });
}

/** The id a trust list will give this public key. */
export function deriveKeyId(publicKey: KeyObject): string {
  return hashKeyMaterial(publicKey);
}

// ---------------------------------------------------------------------------
// License payload
// ---------------------------------------------------------------------------

export type LicenseStatus = "ACTIVE" | "EXPIRED" | "SUSPENDED";

export interface LicenseVersionPayload {
  version: 2;
  kind: typeof LICENSE_DOCUMENT_KIND;
  operationId: string;
  licenseId: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  installationId: string;
  status: LicenseStatus;
  validFrom: Date;
  validUntil: Date | null;
  organizationLimit: number | null;
  userLimit: number | null;
  deviceLimit: number | null;
  deviceLimitSpecified: boolean;
  moduleEntitlements: readonly string[];
  featureEntitlements: readonly string[];
  supersedesOperationId: string | null;
  renewsOperationId: string | null;
  issuedAt: Date;
}

interface WireLicensePayload {
  v: 2;
  kind: string;
  operationId: string;
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
  deviceLimit?: number | null;
  modules: string[];
  features: string[];
  supersedesOperationId: string | null;
  renewsOperationId?: string | null;
  issuedAt: string;
}

/**
 * Canonical license bytes. Field order, conditional omission of `deviceLimit`
 * and `renewsOperationId`, sorted entitlements and no whitespace are the
 * ratified contract; changing any of them changes every signature.
 */
export function canonicalizeLicenseVersion(
  payload: LicenseVersionPayload,
): string {
  const wire: WireLicensePayload = {
    v: 2,
    kind: LICENSE_DOCUMENT_KIND,
    operationId: payload.operationId,
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
    ...(payload.deviceLimitSpecified
      ? { deviceLimit: payload.deviceLimit }
      : {}),
    modules: [...payload.moduleEntitlements].sort(),
    features: [...payload.featureEntitlements].sort(),
    supersedesOperationId: payload.supersedesOperationId,
    ...(payload.renewsOperationId === null
      ? {}
      : { renewsOperationId: payload.renewsOperationId }),
    issuedAt: payload.issuedAt.toISOString(),
  };
  return JSON.stringify(wire);
}

/** Armor the signed artifact exactly as the customer produces/accepts it. */
export function signLicenseVersion(
  payload: LicenseVersionPayload,
  privateKey: KeyObject,
): string {
  assertLicenseVersionPayload(payload);
  const body = Buffer.from(canonicalizeLicenseVersion(payload), "utf8");
  return [
    LICENSE_DOCUMENT_PREFIX,
    body.toString("base64url"),
    cryptoSign(null, body, privateKey).toString("base64url"),
  ].join(".");
}

export function licenseFileEnvelope(document: string, keyId?: string): string {
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

export interface VerifiedLicenseVersion {
  payload: LicenseVersionPayload;
  keyId: string;
  canonicalBody: string;
  digest: string;
}

/** Verify a `VLIC2` document (bare armor) against the Owner trust list. */
export function verifyLicenseVersion(
  document: string,
  trustedKeys: readonly TrustedLicenseKey[],
  options: { keyIdHint?: string | null } = {},
): VerifiedLicenseVersion {
  const value = document.trim();
  const parts = value.split(".");
  if (parts.length !== 3) {
    throw new ProtocolError(
      "malformed",
      "The license document is not a well-formed Vardena document.",
    );
  }
  const [prefix, bodyPart, signaturePart] = parts as [string, string, string];
  if (prefix !== LICENSE_DOCUMENT_PREFIX) {
    throw new ProtocolError(
      "unsupported-version",
      `Unsupported license document version "${prefix}".`,
    );
  }
  const body = Buffer.from(bodyPart, "base64url");
  const signature = Buffer.from(signaturePart, "base64url");
  if (body.length === 0 || signature.length === 0) {
    throw new ProtocolError(
      "malformed",
      "The license document payload or signature is empty.",
    );
  }
  if (trustedKeys.length === 0) {
    throw new ProtocolError(
      "signature",
      "No licensing authority public key is configured for the Owner application.",
    );
  }
  const hint = options.keyIdHint ?? null;
  const candidates =
    hint === null ? trustedKeys : trustedKeys.filter((key) => key.id === hint);
  if (candidates.length === 0) {
    throw new ProtocolError(
      "unknown-key",
      `The license document was signed with an unknown key "${hint}".`,
    );
  }
  const matched = candidates.find((key) => {
    try {
      return cryptoVerify(null, body, key.key, signature);
    } catch {
      return false;
    }
  });
  if (matched === undefined) {
    throw new ProtocolError(
      "signature",
      "The license document signature is not valid for the configured trust list.",
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(body.toString("utf8"));
  } catch {
    throw new ProtocolError(
      "malformed",
      "The license document payload is not readable.",
    );
  }
  const payload = parseLicenseVersionPayload(raw);
  assertLicenseVersionPayload(payload);
  const canonicalBody = canonicalizeLicenseVersion(payload);
  if (canonicalBody !== body.toString("utf8")) {
    throw new ProtocolError(
      "canonical",
      "The license document payload is not in canonical form.",
    );
  }
  return {
    payload,
    keyId: matched.id,
    canonicalBody,
    digest: sha256Hex(body),
  };
}

/** Decode the transport envelope only; it carries no authority. */
export function decodeLicenseEnvelope(input: string): {
  document: string;
  keyId: string | null;
} {
  const value = input.trim();
  if (value === "") {
    throw new ProtocolError("malformed", "The license document is empty.");
  }
  if (!value.startsWith("{")) {
    return { document: value, keyId: null };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    throw new ProtocolError("malformed", "The license file is not readable.");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ProtocolError(
      "malformed",
      "The license file must contain one JSON object.",
    );
  }
  const envelope = raw as Record<string, unknown>;
  const allowed = new Set(["format", "fileVersion", "document", "keyId"]);
  for (const key of Object.keys(envelope)) {
    if (!allowed.has(key)) {
      throw new ProtocolError(
        "malformed",
        `The license file carries an unexpected field "${key}".`,
      );
    }
  }
  if (envelope["format"] !== LICENSE_FILE_FORMAT) {
    throw new ProtocolError(
      "malformed",
      "The license file does not declare the Vardena license format.",
    );
  }
  if (envelope["fileVersion"] !== LICENSE_FILE_VERSION) {
    throw new ProtocolError(
      "unsupported-version",
      "This license file version is not supported by this Vardena build.",
    );
  }
  const document = envelope["document"];
  if (typeof document !== "string" || document.trim() === "") {
    throw new ProtocolError(
      "malformed",
      "The license file does not contain a signed document.",
    );
  }
  const keyId = envelope["keyId"];
  if (keyId !== undefined && typeof keyId !== "string") {
    throw new ProtocolError(
      "malformed",
      "The license file key hint must be a string.",
    );
  }
  return { document: document.trim(), keyId: keyId ?? null };
}

export function parseLicenseVersionPayload(
  raw: unknown,
): LicenseVersionPayload {
  if (typeof raw !== "object" || raw === null) {
    throw new ProtocolError(
      "payload",
      "The license document payload is not an object.",
    );
  }
  const wire = raw as Partial<WireLicensePayload>;
  if (wire.v !== LICENSE_DOCUMENT_VERSION) {
    throw new ProtocolError(
      "unsupported-version",
      `Only version ${LICENSE_DOCUMENT_VERSION} license documents are supported.`,
    );
  }
  if (wire.kind !== LICENSE_DOCUMENT_KIND) {
    throw new ProtocolError(
      "payload",
      "The license document is not a server license version.",
    );
  }
  const customerId = readId(wire.customerId, "customerId");
  const deviceLimitSpecified = Object.prototype.hasOwnProperty.call(
    raw,
    "deviceLimit",
  );
  return {
    version: 2,
    kind: LICENSE_DOCUMENT_KIND,
    operationId: readId(wire.operationId, "operationId"),
    licenseId: readId(wire.licenseId, "licenseId"),
    customerId,
    customerCode: readCustomerCode(wire.customerCode, customerId),
    customerName: readName(wire.customerName),
    installationId: readId(wire.installationId, "installationId"),
    status: readStatus(wire.status),
    validFrom: readDate(wire.validFrom, "validFrom"),
    validUntil:
      wire.validUntil === null || wire.validUntil === undefined
        ? null
        : readDate(wire.validUntil, "validUntil"),
    organizationLimit: readLimit(wire.organizationLimit, "organizationLimit"),
    userLimit: readLimit(wire.userLimit, "userLimit"),
    deviceLimit: deviceLimitSpecified
      ? readDeviceLimit(wire.deviceLimit)
      : null,
    deviceLimitSpecified,
    moduleEntitlements: readCodes(wire.modules, "modules"),
    featureEntitlements: readCodes(wire.features, "features"),
    supersedesOperationId:
      wire.supersedesOperationId === null ||
      wire.supersedesOperationId === undefined
        ? null
        : readId(wire.supersedesOperationId, "supersedesOperationId"),
    renewsOperationId:
      wire.renewsOperationId === null || wire.renewsOperationId === undefined
        ? null
        : readId(wire.renewsOperationId, "renewsOperationId"),
    issuedAt: readDate(wire.issuedAt, "issuedAt"),
  };
}

/** Semantic rules shared by request creation, signing and import. */
export function assertLicenseVersionPayload(
  payload: LicenseVersionPayload,
): void {
  readId(payload.operationId, "operationId");
  readId(payload.licenseId, "licenseId");
  const customerId = readId(payload.customerId, "customerId");
  readCustomerCode(payload.customerCode, customerId);
  readName(payload.customerName);
  readId(payload.installationId, "installationId");
  readStatus(payload.status);
  if (payload.status !== "ACTIVE") {
    throw new ProtocolError(
      "payload",
      "Only an ACTIVE license version can be issued.",
    );
  }
  if (payload.supersedesOperationId !== null) {
    readId(payload.supersedesOperationId, "supersedesOperationId");
  }
  if (payload.renewsOperationId !== null) {
    readId(payload.renewsOperationId, "renewsOperationId");
    if (payload.supersedesOperationId !== null) {
      throw new ProtocolError(
        "payload",
        "A license version cannot both renew and supersede a version.",
      );
    }
    if (payload.renewsOperationId === payload.operationId) {
      throw new ProtocolError(
        "payload",
        "A license version cannot renew itself.",
      );
    }
    if (payload.validFrom.getTime() > payload.issuedAt.getTime()) {
      throw new ProtocolError(
        "payload",
        "A renewal cannot become valid after it was issued.",
      );
    }
  }
  if (
    payload.supersedesOperationId !== null &&
    payload.supersedesOperationId === payload.operationId
  ) {
    throw new ProtocolError(
      "payload",
      "A license version cannot supersede itself.",
    );
  }
  if (
    payload.validUntil !== null &&
    payload.validUntil.getTime() <= payload.validFrom.getTime()
  ) {
    throw new ProtocolError(
      "validity",
      "The license validUntil must be later than validFrom.",
    );
  }
  if (
    typeof payload.deviceLimitSpecified !== "boolean" ||
    (!payload.deviceLimitSpecified && payload.deviceLimit !== null) ||
    (payload.deviceLimitSpecified &&
      payload.deviceLimit !== null &&
      (!Number.isInteger(payload.deviceLimit) || payload.deviceLimit < 0))
  ) {
    throw new ProtocolError(
      "limits",
      "The license deviceLimit must be an explicitly signed non-negative integer or null.",
    );
  }
  for (const [field, limit] of [
    ["organizationLimit", payload.organizationLimit],
    ["userLimit", payload.userLimit],
  ] as const) {
    if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
      throw new ProtocolError(
        "limits",
        `The license ${field} must be a positive integer or null (unlimited).`,
      );
    }
  }
  const modules = new Set(payload.moduleEntitlements);
  if (modules.size !== payload.moduleEntitlements.length) {
    throw new ProtocolError(
      "entitlements",
      "The license repeats a module entitlement.",
    );
  }
  for (const code of payload.moduleEntitlements) {
    if (!KNOWN_MODULE_CODES.includes(code)) {
      throw new ProtocolError(
        "entitlements",
        `The license names an unknown module entitlement "${code}".`,
      );
    }
  }
  const features = new Set(payload.featureEntitlements);
  if (features.size !== payload.featureEntitlements.length) {
    throw new ProtocolError(
      "entitlements",
      "The license repeats a feature entitlement.",
    );
  }
  for (const code of payload.featureEntitlements) {
    if (!CODE_PATTERN.test(code)) {
      throw new ProtocolError(
        "entitlements",
        `The license names a malformed feature entitlement "${code}".`,
      );
    }
  }
}

function readId(value: unknown, field: string): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new ProtocolError(
      "payload",
      `The license ${field} is missing or malformed.`,
    );
  }
  return value;
}

function readCustomerCode(value: unknown, customerId: string): string {
  if (typeof value !== "string" || !CUSTOMER_CODE_PATTERN.test(value)) {
    throw new ProtocolError(
      "payload",
      "The license customerCode is missing or malformed.",
    );
  }
  if (value === customerId) {
    throw new ProtocolError(
      "payload",
      "The license customerCode must be independent of customerId.",
    );
  }
  return value;
}

function readName(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > MAX_CUSTOMER_NAME
  ) {
    throw new ProtocolError(
      "payload",
      "The license customerName is missing or malformed.",
    );
  }
  return value;
}

function readStatus(value: unknown): LicenseStatus {
  if (value !== "ACTIVE" && value !== "EXPIRED" && value !== "SUSPENDED") {
    throw new ProtocolError(
      "payload",
      "The license status must be ACTIVE, EXPIRED, or SUSPENDED.",
    );
  }
  return value;
}

function readDate(value: unknown, field: string): Date {
  if (typeof value !== "string") {
    throw new ProtocolError("payload", `The license ${field} is missing.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ProtocolError(
      "payload",
      `The license ${field} is not an ISO-8601 instant.`,
    );
  }
  return parsed;
}

function readLimit(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value)) {
    throw new ProtocolError(
      "limits",
      `The license ${field} must be an integer or null (unlimited).`,
    );
  }
  return value as number;
}

function readDeviceLimit(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new ProtocolError(
      "limits",
      "The license deviceLimit must be a non-negative integer or null.",
    );
  }
  return value as number;
}

function readCodes(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ProtocolError(
      "entitlements",
      `The license ${field} must be an array of codes.`,
    );
  }
  return value.map((entry) => {
    if (typeof entry !== "string") {
      throw new ProtocolError(
        "entitlements",
        `The license ${field} must contain only string codes.`,
      );
    }
    return entry;
  });
}

// ---------------------------------------------------------------------------
// Signing request (`VLSR1`) — unsigned transport, Owner internal
// ---------------------------------------------------------------------------

export interface LicenseRequestPayload {
  v: 1;
  kind: typeof REQUEST_KIND;
  requestId: string;
  operationId: string;
  licenseId: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  installationId: string;
  status: "ACTIVE";
  validFrom: Date;
  validUntil: Date | null;
  organizationLimit: number | null;
  userLimit: number | null;
  deviceLimit: number | null;
  deviceLimitSpecified: boolean;
  modules: readonly string[];
  features: readonly string[];
  supersedesOperationId: string | null;
  renewsOperationId: string | null;
  issuedAt: Date;
  requestedAt: Date;
  requestedByUserId: string;
  /** Trust-list id the signer must use; never part of the signed projection. */
  signingKeyId: string;
}

/** The exact `VLIC2` payload this request commits to. */
export function projectLicensePayload(
  request: LicenseRequestPayload,
): LicenseVersionPayload {
  return {
    version: 2,
    kind: LICENSE_DOCUMENT_KIND,
    operationId: request.operationId,
    licenseId: request.licenseId,
    customerId: request.customerId,
    customerCode: request.customerCode,
    customerName: request.customerName,
    installationId: request.installationId,
    status: "ACTIVE",
    validFrom: request.validFrom,
    validUntil: request.validUntil,
    organizationLimit: request.organizationLimit,
    userLimit: request.userLimit,
    deviceLimit: request.deviceLimit,
    deviceLimitSpecified: request.deviceLimitSpecified,
    moduleEntitlements: request.modules,
    featureEntitlements: request.features,
    supersedesOperationId: request.supersedesOperationId,
    renewsOperationId: request.renewsOperationId,
    issuedAt: request.issuedAt,
  };
}

/** Canonical request bytes: every field present, fixed order. */
export function canonicalizeLicenseRequest(
  request: LicenseRequestPayload,
): string {
  return JSON.stringify({
    v: 1,
    kind: REQUEST_KIND,
    requestId: request.requestId,
    operationId: request.operationId,
    licenseId: request.licenseId,
    customerId: request.customerId,
    customerCode: request.customerCode,
    customerName: request.customerName,
    installationId: request.installationId,
    status: request.status,
    validFrom: request.validFrom.toISOString(),
    validUntil: request.validUntil?.toISOString() ?? null,
    organizationLimit: request.organizationLimit,
    userLimit: request.userLimit,
    deviceLimit: request.deviceLimit,
    deviceLimitSpecified: request.deviceLimitSpecified,
    modules: [...request.modules].sort(),
    features: [...request.features].sort(),
    supersedesOperationId: request.supersedesOperationId,
    renewsOperationId: request.renewsOperationId,
    issuedAt: request.issuedAt.toISOString(),
    requestedAt: request.requestedAt.toISOString(),
    requestedByUserId: request.requestedByUserId,
    signingKeyId: request.signingKeyId,
  });
}

export interface PreparedRequest {
  canonical: string;
  requestDigest: string;
  bindingDigest: string;
  armored: string;
  envelope: string;
  fileName: string;
}

export function prepareLicenseRequest(
  request: LicenseRequestPayload,
): PreparedRequest {
  const projection = projectLicensePayload(request);
  assertLicenseVersionPayload(projection);
  verifyRequestIdentity(request);
  const canonical = canonicalizeLicenseRequest(request);
  const requestDigest = sha256Hex(Buffer.from(canonical, "utf8"));
  const bindingDigest = sha256Hex(
    Buffer.from(canonicalizeLicenseVersion(projection), "utf8"),
  );
  const armored = `${REQUEST_PREFIX}.${Buffer.from(canonical, "utf8").toString("base64url")}`;
  const envelope = `${JSON.stringify(
    {
      format: REQUEST_FILE_FORMAT,
      fileVersion: REQUEST_FILE_VERSION,
      request: armored,
    },
    null,
    2,
  )}\n`;
  return {
    canonical,
    requestDigest,
    bindingDigest,
    armored,
    envelope,
    fileName: `vardena-signing-request-${request.operationId}.json`,
  };
}

function verifyRequestIdentity(request: LicenseRequestPayload): void {
  for (const [field, value] of [
    ["requestId", request.requestId],
    ["operationId", request.operationId],
    ["licenseId", request.licenseId],
    ["customerId", request.customerId],
    ["installationId", request.installationId],
    ["requestedByUserId", request.requestedByUserId],
  ] as const) {
    if (!ID_PATTERN.test(value)) {
      throw new ProtocolError(
        "payload",
        `The signing request ${field} is missing or malformed.`,
      );
    }
  }
  if (!KEY_ID_PATTERN.test(request.signingKeyId)) {
    throw new ProtocolError(
      "payload",
      "The signing request signingKeyId is malformed.",
    );
  }
  if (request.status !== "ACTIVE") {
    throw new ProtocolError(
      "payload",
      "Only an ACTIVE license can be requested.",
    );
  }
  if (
    request.supersedesOperationId !== null &&
    request.renewsOperationId !== null
  ) {
    throw new ProtocolError(
      "payload",
      "A request cannot both renew and supersede a version.",
    );
  }
  if (request.requestedAt.getTime() > request.issuedAt.getTime()) {
    throw new ProtocolError(
      "validity",
      "The request time cannot be later than the pinned issuedAt.",
    );
  }
}

export interface DecodedLicenseRequest {
  canonical: string;
  request: LicenseRequestPayload;
  requestDigest: string;
  bindingDigest: string;
}

/** Parse and structurally validate an `VLSR1` request (signer side). */
export function decodeLicenseRequest(input: string): DecodedLicenseRequest {
  let envelope: unknown;
  try {
    envelope = JSON.parse(input);
  } catch {
    throw new ProtocolError("malformed", "The signing request is not JSON.");
  }
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    Array.isArray(envelope)
  ) {
    throw new ProtocolError(
      "malformed",
      "The signing request must contain one JSON object.",
    );
  }
  const fields = envelope as Record<string, unknown>;
  for (const key of Object.keys(fields)) {
    if (!["format", "fileVersion", "request"].includes(key)) {
      throw new ProtocolError(
        "malformed",
        `The signing request carries an unexpected field "${key}".`,
      );
    }
  }
  if (fields["format"] !== REQUEST_FILE_FORMAT) {
    throw new ProtocolError(
      "malformed",
      "The file does not declare the Vardena signing-request format.",
    );
  }
  if (fields["fileVersion"] !== REQUEST_FILE_VERSION) {
    throw new ProtocolError(
      "unsupported-version",
      "This signing-request version is not supported.",
    );
  }
  const armored = fields["request"];
  if (typeof armored !== "string") {
    throw new ProtocolError(
      "malformed",
      "The signing request is missing its payload.",
    );
  }
  const parts = armored.split(".");
  if (parts.length !== 2 || parts[0] !== REQUEST_PREFIX) {
    throw new ProtocolError(
      "malformed",
      "The signing request is not a well-formed Vardena request.",
    );
  }
  const body = Buffer.from(parts[1] as string, "base64url");
  if (body.length === 0) {
    throw new ProtocolError("malformed", "The signing request is empty.");
  }
  const canonical = body.toString("utf8");

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(canonical) as Record<string, unknown>;
  } catch {
    throw new ProtocolError(
      "payload",
      "The signing request payload is not readable.",
    );
  }
  const expectedKeys = [
    "v",
    "kind",
    "requestId",
    "operationId",
    "licenseId",
    "customerId",
    "customerCode",
    "customerName",
    "installationId",
    "status",
    "validFrom",
    "validUntil",
    "organizationLimit",
    "userLimit",
    "deviceLimit",
    "deviceLimitSpecified",
    "modules",
    "features",
    "supersedesOperationId",
    "renewsOperationId",
    "issuedAt",
    "requestedAt",
    "requestedByUserId",
    "signingKeyId",
  ];
  for (const key of Object.keys(raw)) {
    if (!expectedKeys.includes(key)) {
      throw new ProtocolError(
        "payload",
        `The signing request payload carries an unexpected field "${key}".`,
      );
    }
  }
  for (const key of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      throw new ProtocolError(
        "payload",
        `The signing request payload is missing "${key}".`,
      );
    }
  }
  if (raw["v"] !== 1 || raw["kind"] !== REQUEST_KIND) {
    throw new ProtocolError(
      "payload",
      "The signing request payload is not a server license issuance request.",
    );
  }
  const request: LicenseRequestPayload = {
    v: 1,
    kind: REQUEST_KIND,
    requestId: readStringField(raw, "requestId"),
    operationId: readStringField(raw, "operationId"),
    licenseId: readStringField(raw, "licenseId"),
    customerId: readStringField(raw, "customerId"),
    customerCode: readStringField(raw, "customerCode"),
    customerName: readStringField(raw, "customerName"),
    installationId: readStringField(raw, "installationId"),
    status: raw["status"] as "ACTIVE",
    validFrom: readDateField(raw, "validFrom"),
    validUntil: readNullableDateField(raw, "validUntil"),
    organizationLimit: readNullableInt(raw, "organizationLimit"),
    userLimit: readNullableInt(raw, "userLimit"),
    deviceLimit: readNullableInt(raw, "deviceLimit"),
    deviceLimitSpecified: readBoolean(raw, "deviceLimitSpecified"),
    modules: readStringArray(raw, "modules"),
    features: readStringArray(raw, "features"),
    supersedesOperationId: readNullableString(raw, "supersedesOperationId"),
    renewsOperationId: readNullableString(raw, "renewsOperationId"),
    issuedAt: readDateField(raw, "issuedAt"),
    requestedAt: readDateField(raw, "requestedAt"),
    requestedByUserId: readStringField(raw, "requestedByUserId"),
    signingKeyId: readStringField(raw, "signingKeyId"),
  };
  if (request.status !== "ACTIVE") {
    throw new ProtocolError(
      "payload",
      "The signing request status must be ACTIVE.",
    );
  }
  const prepared = prepareLicenseRequest(request);
  if (prepared.canonical !== canonical) {
    throw new ProtocolError(
      "canonical",
      "The signing request payload is not in canonical form.",
    );
  }
  return {
    canonical,
    request,
    requestDigest: prepared.requestDigest,
    bindingDigest: prepared.bindingDigest,
  };
}

function readStringField(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== "string") {
    throw new ProtocolError(
      "payload",
      `The signing request ${key} is missing or malformed.`,
    );
  }
  return value;
}

function readNullableString(
  raw: Record<string, unknown>,
  key: string,
): string | null {
  const value = raw[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new ProtocolError(
      "payload",
      `The signing request ${key} must be a string or null.`,
    );
  }
  return value;
}

function readNullableInt(
  raw: Record<string, unknown>,
  key: string,
): number | null {
  const value = raw[key];
  if (value === null) return null;
  if (!Number.isInteger(value)) {
    throw new ProtocolError(
      "limits",
      `The signing request ${key} must be an integer or null.`,
    );
  }
  return value as number;
}

function readBoolean(raw: Record<string, unknown>, key: string): boolean {
  const value = raw[key];
  if (typeof value !== "boolean") {
    throw new ProtocolError(
      "payload",
      `The signing request ${key} must be a boolean.`,
    );
  }
  return value;
}

function readStringArray(raw: Record<string, unknown>, key: string): string[] {
  const value = raw[key];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new ProtocolError(
      "payload",
      `The signing request ${key} must be an array of strings.`,
    );
  }
  return value as string[];
}

function readDateField(raw: Record<string, unknown>, key: string): Date {
  const value = raw[key];
  if (typeof value !== "string") {
    throw new ProtocolError(
      "payload",
      `The signing request ${key} is missing.`,
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new ProtocolError(
      "payload",
      `The signing request ${key} is not a canonical ISO instant.`,
    );
  }
  return parsed;
}

function readNullableDateField(
  raw: Record<string, unknown>,
  key: string,
): Date | null {
  if (raw[key] === null) return null;
  return readDateField(raw, key);
}

// ---------------------------------------------------------------------------
// Revocation artifact (`VREV1`) — OD-LIC-17
// ---------------------------------------------------------------------------

export interface RevocationPayload {
  v: 1;
  kind: typeof REVOCATION_KIND;
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

export function canonicalizeRevocation(payload: RevocationPayload): string {
  return JSON.stringify({
    v: 1,
    kind: REVOCATION_KIND,
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
  });
}

export function assertRevocationPayload(payload: RevocationPayload): void {
  for (const [field, value] of [
    ["revocationId", payload.revocationId],
    ["licenseId", payload.licenseId],
    ["targetOperationId", payload.targetOperationId],
    ["customerId", payload.customerId],
    ["installationId", payload.installationId],
  ] as const) {
    if (!ULID_PATTERN.test(value)) {
      throw new ProtocolError(
        "payload",
        `The revocation ${field} is missing or malformed.`,
      );
    }
  }
  if (
    !CUSTOMER_CODE_PATTERN.test(payload.customerCode) ||
    payload.customerCode === payload.customerId
  ) {
    throw new ProtocolError(
      "payload",
      "The revocation customerCode is missing, malformed or equal to customerId.",
    );
  }
  if (payload.effect !== REVOCATION_EFFECT_LICENSE_ONLY) {
    throw new ProtocolError(
      "payload",
      "Only a LICENSE_ONLY revocation effect is supported.",
    );
  }
  if (!REVOCATION_REASONS.includes(payload.reason)) {
    throw new ProtocolError("payload", "The revocation reason is not known.");
  }
  if (payload.reasonDetail !== null) {
    if (
      typeof payload.reasonDetail !== "string" ||
      payload.reasonDetail.trim() === "" ||
      payload.reasonDetail.length > 500 ||
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u001f\u007f]/.test(payload.reasonDetail)
    ) {
      throw new ProtocolError(
        "payload",
        "The revocation reasonDetail is malformed.",
      );
    }
  }
  if (payload.reason === "OTHER" && payload.reasonDetail === null) {
    throw new ProtocolError(
      "payload",
      "A revocation reason of OTHER requires a reasonDetail.",
    );
  }
  if (!KEY_ID_PATTERN.test(payload.issuerKeyId)) {
    throw new ProtocolError(
      "payload",
      "The revocation issuerKeyId is malformed.",
    );
  }
  if (Number.isNaN(payload.issuedAt.getTime())) {
    throw new ProtocolError("payload", "The revocation issuedAt is malformed.");
  }
}

export function signRevocation(
  payload: RevocationPayload,
  privateKey: KeyObject,
): string {
  assertRevocationPayload(payload);
  const body = Buffer.from(canonicalizeRevocation(payload), "utf8");
  return [
    REVOCATION_PREFIX,
    body.toString("base64url"),
    cryptoSign(null, body, privateKey).toString("base64url"),
  ].join(".");
}

export function revocationFileEnvelope(
  document: string,
  keyId?: string,
): string {
  return `${JSON.stringify(
    {
      format: REVOCATION_FILE_FORMAT,
      fileVersion: REVOCATION_FILE_VERSION,
      ...(keyId === undefined ? {} : { keyId }),
      revocation: document,
    },
    null,
    2,
  )}\n`;
}

export interface VerifiedRevocation {
  payload: RevocationPayload;
  keyId: string;
  canonicalBody: string;
  digest: string;
}

export function verifyRevocation(
  document: string,
  trustedKeys: readonly TrustedLicenseKey[],
  options: { keyIdHint?: string | null } = {},
): VerifiedRevocation {
  const parts = document.trim().split(".");
  if (parts.length !== 3) {
    throw new ProtocolError(
      "malformed",
      "The revocation document is not a well-formed Vardena document.",
    );
  }
  const [prefix, bodyPart, signaturePart] = parts as [string, string, string];
  if (prefix !== REVOCATION_PREFIX) {
    throw new ProtocolError(
      "unsupported-version",
      `Unsupported revocation document version "${prefix}".`,
    );
  }
  const body = Buffer.from(bodyPart, "base64url");
  const signature = Buffer.from(signaturePart, "base64url");
  if (body.length === 0 || signature.length === 0) {
    throw new ProtocolError(
      "malformed",
      "The revocation document payload or signature is empty.",
    );
  }
  if (trustedKeys.length === 0) {
    throw new ProtocolError(
      "signature",
      "No licensing authority public key is configured.",
    );
  }
  const hint = options.keyIdHint ?? null;
  const candidates =
    hint === null ? trustedKeys : trustedKeys.filter((key) => key.id === hint);
  if (candidates.length === 0) {
    throw new ProtocolError(
      "unknown-key",
      `The revocation document was signed with an unknown key "${hint}".`,
    );
  }
  const matched = candidates.find((key) => {
    try {
      return cryptoVerify(null, body, key.key, signature);
    } catch {
      return false;
    }
  });
  if (matched === undefined) {
    throw new ProtocolError(
      "signature",
      "The revocation document signature is not valid.",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(body.toString("utf8"));
  } catch {
    throw new ProtocolError(
      "malformed",
      "The revocation document payload is not readable.",
    );
  }
  const payload = readRevocationPayload(raw);
  assertRevocationPayload(payload);
  if (payload.issuerKeyId !== matched.id) {
    throw new ProtocolError(
      "key-mismatch",
      "The revocation issuer key id does not match the verifying key.",
    );
  }
  const canonicalBody = canonicalizeRevocation(payload);
  if (canonicalBody !== body.toString("utf8")) {
    throw new ProtocolError(
      "canonical",
      "The revocation document payload is not in canonical form.",
    );
  }
  return { payload, keyId: matched.id, canonicalBody, digest: sha256Hex(body) };
}

export function decodeRevocationEnvelope(input: string): {
  document: string;
  keyId: string | null;
} {
  const value = input.trim();
  if (value === "") {
    throw new ProtocolError("malformed", "The revocation document is empty.");
  }
  if (!value.startsWith("{")) {
    throw new ProtocolError(
      "malformed",
      "The revocation file must be a versioned JSON envelope.",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    throw new ProtocolError(
      "malformed",
      "The revocation file is not readable.",
    );
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ProtocolError(
      "malformed",
      "The revocation file must contain one JSON object.",
    );
  }
  const envelope = raw as Record<string, unknown>;
  const allowed = new Set(["format", "fileVersion", "revocation", "keyId"]);
  for (const key of Object.keys(envelope)) {
    if (!allowed.has(key)) {
      throw new ProtocolError(
        "malformed",
        `The revocation file carries an unexpected field "${key}".`,
      );
    }
  }
  if (envelope["format"] !== REVOCATION_FILE_FORMAT) {
    throw new ProtocolError(
      "malformed",
      "The file does not declare the Vardena revocation format.",
    );
  }
  if (envelope["fileVersion"] !== REVOCATION_FILE_VERSION) {
    throw new ProtocolError(
      "unsupported-version",
      "This revocation file version is not supported.",
    );
  }
  const document = envelope["revocation"];
  if (typeof document !== "string" || document.trim() === "") {
    throw new ProtocolError(
      "malformed",
      "The revocation file does not contain a signed document.",
    );
  }
  const keyId = envelope["keyId"];
  if (keyId !== undefined && typeof keyId !== "string") {
    throw new ProtocolError(
      "malformed",
      "The revocation file key hint must be a string.",
    );
  }
  return { document: document.trim(), keyId: keyId ?? null };
}

function readRevocationPayload(raw: unknown): RevocationPayload {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ProtocolError(
      "payload",
      "The revocation payload is not an object.",
    );
  }
  const wire = raw as Record<string, unknown>;
  const expected = [
    "v",
    "kind",
    "revocationId",
    "licenseId",
    "targetOperationId",
    "customerId",
    "customerCode",
    "installationId",
    "effect",
    "reason",
    "reasonDetail",
    "issuerKeyId",
    "issuedAt",
  ];
  for (const key of Object.keys(wire)) {
    if (!expected.includes(key)) {
      throw new ProtocolError(
        "payload",
        `The revocation payload carries an unexpected field "${key}".`,
      );
    }
  }
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(wire, key)) {
      throw new ProtocolError(
        "payload",
        `The revocation payload is missing "${key}".`,
      );
    }
  }
  if (wire["v"] !== 1 || wire["kind"] !== REVOCATION_KIND) {
    throw new ProtocolError(
      "payload",
      "The document is not a server license revocation.",
    );
  }
  const issuedAtRaw = wire["issuedAt"];
  if (typeof issuedAtRaw !== "string") {
    throw new ProtocolError("payload", "The revocation issuedAt is missing.");
  }
  const issuedAt = new Date(issuedAtRaw);
  if (
    Number.isNaN(issuedAt.getTime()) ||
    issuedAt.toISOString() !== issuedAtRaw
  ) {
    throw new ProtocolError(
      "payload",
      "The revocation issuedAt is not a canonical ISO instant.",
    );
  }
  const reasonDetail = wire["reasonDetail"];
  if (reasonDetail !== null && typeof reasonDetail !== "string") {
    throw new ProtocolError(
      "payload",
      "The revocation reasonDetail must be a string or null.",
    );
  }
  return {
    v: 1,
    kind: REVOCATION_KIND,
    revocationId: requireString(wire, "revocationId"),
    licenseId: requireString(wire, "licenseId"),
    targetOperationId: requireString(wire, "targetOperationId"),
    customerId: requireString(wire, "customerId"),
    customerCode: requireString(wire, "customerCode"),
    installationId: requireString(wire, "installationId"),
    effect: requireString(
      wire,
      "effect",
    ) as typeof REVOCATION_EFFECT_LICENSE_ONLY,
    reason: requireString(wire, "reason") as RevocationReason,
    reasonDetail: reasonDetail as string | null,
    issuerKeyId: requireString(wire, "issuerKeyId"),
    issuedAt,
  };
}

function requireString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== "string") {
    throw new ProtocolError(
      "payload",
      `The revocation ${key} is missing or malformed.`,
    );
  }
  return value;
}

/** Unsigned revocation signing request (`VRRQ1`). */
export interface PreparedRevocationRequest {
  canonical: string;
  requestDigest: string;
  bindingDigest: string;
  armored: string;
  envelope: string;
  fileName: string;
}

export function prepareRevocationRequest(
  payload: RevocationPayload,
): PreparedRevocationRequest {
  assertRevocationPayload(payload);
  const canonical = canonicalizeRevocation(payload);
  const digest = sha256Hex(Buffer.from(canonical, "utf8"));
  const armored = `${REVOCATION_REQUEST_PREFIX}.${Buffer.from(canonical, "utf8").toString("base64url")}`;
  return {
    canonical,
    requestDigest: digest,
    bindingDigest: digest,
    armored,
    envelope: `${JSON.stringify(
      {
        format: REVOCATION_REQUEST_FILE_FORMAT,
        fileVersion: 1,
        request: armored,
      },
      null,
      2,
    )}\n`,
    fileName: `vardena-revocation-request-${payload.revocationId}.json`,
  };
}

export function decodeRevocationRequest(input: string): {
  payload: RevocationPayload;
  requestDigest: string;
} {
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch {
    throw new ProtocolError("malformed", "The revocation request is not JSON.");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ProtocolError(
      "malformed",
      "The revocation request must contain one JSON object.",
    );
  }
  const fields = raw as Record<string, unknown>;
  for (const key of Object.keys(fields)) {
    if (!["format", "fileVersion", "request"].includes(key)) {
      throw new ProtocolError(
        "malformed",
        `The revocation request carries an unexpected field "${key}".`,
      );
    }
  }
  if (fields["format"] !== REVOCATION_REQUEST_FILE_FORMAT) {
    throw new ProtocolError(
      "malformed",
      "The file does not declare the revocation signing-request format.",
    );
  }
  if (fields["fileVersion"] !== 1) {
    throw new ProtocolError(
      "unsupported-version",
      "This revocation request version is not supported.",
    );
  }
  const armored = fields["request"];
  if (typeof armored !== "string") {
    throw new ProtocolError(
      "malformed",
      "The revocation request is missing its payload.",
    );
  }
  const parts = armored.split(".");
  if (parts.length !== 2 || parts[0] !== REVOCATION_REQUEST_PREFIX) {
    throw new ProtocolError(
      "malformed",
      "The revocation request is not well formed.",
    );
  }
  const body = Buffer.from(parts[1] as string, "base64url");
  if (body.length === 0) {
    throw new ProtocolError("malformed", "The revocation request is empty.");
  }
  const canonical = body.toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonical);
  } catch {
    throw new ProtocolError(
      "payload",
      "The revocation request payload is not readable.",
    );
  }
  const payload = readRevocationPayload(parsed);
  assertRevocationPayload(payload);
  if (canonicalizeRevocation(payload) !== canonical) {
    throw new ProtocolError(
      "canonical",
      "The revocation request payload is not in canonical form.",
    );
  }
  return { payload, requestDigest: sha256Hex(Buffer.from(canonical, "utf8")) };
}
