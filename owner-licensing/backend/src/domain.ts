import { createHash, randomBytes } from "node:crypto";

export const roles = ["OWNER_ADMIN", "LICENSE_OPERATOR"] as const;
export type Role = (typeof roles)[number];
export type Permission =
  | "customers.view"
  | "customers.write"
  | "users.manage"
  | "audit.view"
  | "audit.archive"
  | "operations.view"
  | "operations.record"
  | "replacements.authorize"
  | "licenses.issue.time_limited"
  | "licenses.issue.perpetual"
  | "licenses.import"
  | "licenses.view"
  | "licenses.download"
  | "limit_profiles.manage";

/**
 * PDR-17 / PDR-11 §21 (2026-10-16 OQ-75 two-role MVP model), extended by
 * PDR-19 as amended on 2026-10-20.
 *
 * This function returns **eligibility**, not effective access:
 *
 *   OWNER_ADMIN      — the static role set. OD-LIC-12 (R-1) states explicitly
 *                      that OWNER_ADMIN is not placed under the grant model and
 *                      its access is unchanged.
 *   LICENSE_OPERATOR — the closed list of permissions that role may ever hold.
 *                      Since OD-LIC-12 (R-1) **none** of them is effective
 *                      without an explicit active grant row, so an operator's
 *                      effective set is `eligible(role) ∩ activeGrants`.
 *
 * No wildcard, no prefix expansion and no inference: a code not listed here is
 * ineligible until a reviewed migration amends the vocabulary. Superseded
 * four-role names receive [].
 */
export function permissions(role: string): Permission[] {
  if (role === "OWNER_ADMIN")
    return [
      "customers.view",
      "customers.write",
      "users.manage",
      "audit.view",
      "audit.archive",
      "operations.view",
      "operations.record",
      "replacements.authorize",
      "licenses.issue.time_limited",
      "licenses.issue.perpetual",
      "licenses.import",
      "licenses.view",
      "licenses.download",
      "limit_profiles.manage",
    ];
  if (role === "LICENSE_OPERATOR")
    return [
      "customers.view",
      "audit.view",
      "operations.view",
      "operations.record",
      "licenses.issue.time_limited",
      "licenses.import",
      "licenses.view",
      "licenses.download",
    ];
  return [];
}

/**
 * The closed set a per-user grant may name for a LICENSE_OPERATOR. Grants of
 * anything else are refused by the schema trigger AND by the service, so
 * neither layer alone carries the restriction.
 */
export const operatorGrantablePermissions: readonly Permission[] = [
  "customers.view",
  "audit.view",
  "operations.view",
  "operations.record",
  "licenses.issue.time_limited",
  "licenses.import",
  "licenses.view",
  "licenses.download",
];

export function isGrantablePermission(value: unknown): value is Permission {
  return (
    typeof value === "string" &&
    (operatorGrantablePermissions as readonly string[]).includes(value)
  );
}

/**
 * Effective access. OWNER_ADMIN is not configurable (unchanged by OD-LIC-12);
 * every other role is the intersection of its eligibility and its active
 * grants — a grant can narrow, never widen.
 */
export function effectivePermissions(
  role: string,
  activeGrants: readonly string[],
): Permission[] {
  if (role === "OWNER_ADMIN") return permissions(role);
  if (role !== "LICENSE_OPERATOR") return [];
  return permissions(role).filter((permission) =>
    activeGrants.includes(permission),
  );
}

export type AuthenticatedActor = User & { permissions: Permission[] };

export function hasEffectivePermission(
  actor: { role: string; permissions?: readonly Permission[] },
  permission: Permission,
): boolean {
  if (actor.permissions) return actor.permissions.includes(permission);
  // Fail closed for an operator: role eligibility alone is not access
  // (OD-LIC-12, R-1). OWNER_ADMIN is not under the grant model.
  return (
    actor.role === "OWNER_ADMIN" && permissions(actor.role).includes(permission)
  );
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function fail(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message);
}
export function invalid(message: string): never {
  return fail(400, "ValidationFailed", message);
}
export function object(
  value: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("Invalid request.");
  const o = value as Record<string, unknown>;
  if (Object.keys(o).some((k) => !allowed.includes(k)))
    invalid("Unknown field.");
  return o;
}
export function text(
  value: unknown,
  field: string,
  min: number,
  max: number,
  trim = true,
): string {
  if (typeof value !== "string") invalid(`${field} is required.`);
  const s = trim ? value.trim() : value;
  if (s.length < min || s.length > max || (min > 0 && !s.trim()))
    invalid(`${field} must contain ${min}..${max} characters.`);
  return s;
}
export function password(value: unknown): string {
  return text(value, "password", 8, 128, false);
}
export function role(value: unknown): Role {
  if (!roles.includes(value as Role)) invalid("Invalid role.");
  return value as Role;
}
export function isRole(value: unknown): value is Role {
  return roles.includes(value as Role);
}
/** Eligibility check (role vocabulary). Not an authorization decision. */
export function assertPermission(
  actorRole: unknown,
  requiredPermission: Permission,
): Role {
  if (
    !isRole(actorRole) ||
    !permissions(actorRole).includes(requiredPermission)
  )
    fail(403, "PermissionDenied", "You do not have permission.");
  return actorRole;
}

/**
 * Effective authorization: active, valid role, password already changed, and
 * the permission present in the actor's **effective** set. An actor object
 * without an effective set is denied unless it is OWNER_ADMIN, which the
 * grant model does not govern (OD-LIC-12).
 */
export function assertActiveAuthorizedActor(
  actor:
    | (Pick<User, "id" | "role" | "is_active" | "must_change_password"> & {
        permissions?: readonly Permission[];
      })
    | null
    | undefined,
  requiredPermission: Permission,
): Role {
  if (!actor || !actor.is_active || !isRole(actor.role))
    fail(401, "Unauthorized", "Authentication is required.");
  if (actor.must_change_password)
    fail(
      403,
      "PasswordChangeRequired",
      "Initial password must be changed first.",
    );
  if (!hasEffectivePermission(actor, requiredPermission))
    fail(403, "PermissionDenied", "You do not have permission.");
  return actor.role;
}
// PDR-14 grammar, case-sensitive, no implicit uppercasing or identity inference.
export function customerCode(value: unknown, id?: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/.test(value) ||
    value.trim() !== value ||
    value === id
  )
    invalid("Invalid customerCode.");
  return value;
}
export function status(value: unknown): string {
  if (value !== "ACTIVE" && value !== "INACTIVE") invalid("Invalid status.");
  return value;
}

// ---------------------------------------------------------------------------
// PDR-18 §1 — three separate date concepts
//
// Both stored day values are canonical BusinessDate calendar days
// (`YYYY-MM-DD`, docs/datetime.md, AR-32). They are deliberately separate:
//
//   contract dates      — commercial/administrative, may precede the recording.
//   Owner-side metadata — the day an operator RECORDED an observation (derived
//                         on read from the immutable `created_at` instant) and
//                         the validity end the operator recorded having seen.
//   signed-license validity — owned by the customer runtime; not modelled here.
//
// The Owner-side pair is never an attested property of a signed artifact:
// PDR-17 records cryptographic issuance and verification as not implemented,
// and every response states `cryptographicVerification = NOT_IMPLEMENTED`.
//
// Nothing here accepts a client clock or a browser-supplied date: the recording
// day is derived from a server-generated, immutable `timestamptz` column.
// ---------------------------------------------------------------------------

const BUSINESS_DAY_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/** The UTC calendar day of an authoritative instant (never a local day). */
export function utcCalendarDay(at: Date): string {
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  const day = String(at.getUTCDate()).padStart(2, "0");
  return `${String(at.getUTCFullYear()).padStart(4, "0")}-${month}-${day}`;
}

/** Validate one supplied canonical calendar day. */
export function businessDay(value: unknown, field: string): string {
  if (typeof value !== "string" || !BUSINESS_DAY_PATTERN.test(value))
    invalid(`${field} must be a canonical YYYY-MM-DD calendar day.`);
  const at = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(at.getTime()) || utcCalendarDay(at) !== value)
    invalid(`${field} is not a real calendar day.`);
  return value;
}

/** An omitted, null or empty value is "not recorded", never a default day. */
export function optionalBusinessDay(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  return businessDay(value, field);
}

/**
 * Read a PostgreSQL `date` column back as a canonical calendar day.
 *
 * node-postgres materializes `date` as a JS `Date` at LOCAL midnight, so the
 * value must be read through its UTC date components or a process running east
 * or west of UTC would silently shift the day. This is the only place that
 * conversion happens (persistence carrier; AR-32).
 */
export function persistedBusinessDay(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = value.getMonth();
    const day = value.getDate();
    return utcCalendarDay(new Date(Date.UTC(year, month, day)));
  }
  if (typeof value === "string") return value.slice(0, 10);
  fail(500, "InternalError", "The operation failed. Please retry.");
}

/**
 * The UTC calendar day on which an observation was RECORDED.
 *
 * This is derived, never stored and never accepted from a client: it is the
 * canonical BusinessDay projection of the row's `created_at` instant, a server
 * -generated `timestamptz` that migration 002 makes immutable. It answers
 * "when did an operator record this?", never "when was the license really
 * issued or activated?" — the Owner application has no cryptographic evidence
 * of the latter (PDR-17).
 */
export function recordedOnFor(createdAt: unknown): string {
  if (createdAt instanceof Date) return utcCalendarDay(createdAt);
  if (typeof createdAt === "string") {
    const at = new Date(createdAt);
    if (!Number.isNaN(at.getTime())) return utcCalendarDay(at);
  }
  fail(500, "InternalError", "The operation failed. Please retry.");
}

// There is deliberately NO rule comparing `observedValidityEnd` with
// `recordedOn`. The recording day is when an operator recorded the observation;
// it is not the signed license's technical activation start, which this
// application cannot know (PDR-17). An operator must be able to record an
// observation of an already-expired license, so the recorded end may precede,
// equal or follow the recording day. The signed-license interval convention
// (an end follows its own technical start) is untouched — it simply is not this
// model's start. A `null` end means "no end was recorded": it is never
// defaulted, never derived from the recording day and never derived from the
// contract dates.

/**
 * Contract dates are commercial: either side may be unrecorded, they may lie in
 * the past (issuance is allowed to follow the contract start), and the end may
 * equal the start (a single-day contract).
 */
export function assertContractDateOrder(
  start: string | null,
  end: string | null,
): void {
  if (start !== null && end !== null && end < start)
    invalid("contractEndDate must not be earlier than contractStartDate.");
}
export function page(value: unknown): number {
  if (value === undefined) return 1;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,5}$/.test(value))
    invalid("Invalid page.");
  return Number(value);
}
export function id(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(value))
    invalid("Invalid record id.");
  return value;
}
export function token(): string {
  return randomBytes(32).toString("base64url");
}
export function digest(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
export interface User {
  id: string;
  username: string;
  password_hash: string;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  created_at: Date;
}
export function safeUser(u: User) {
  return {
    id: u.id,
    username: u.username,
    role: role(u.role),
    isActive: u.is_active,
    mustChangePassword: u.must_change_password,
    createdAt: u.created_at.toISOString(),
  };
}

/** Explicit response allowlist for list AND detail; new DB columns cannot leak. */
export function customerResponse(c: Record<string, unknown>, actorRole: Role) {
  if (!permissions(actorRole).includes("customers.view"))
    fail(403, "Forbidden", "Customer read is not permitted.");
  return {
    id: c.id,
    customerCode: c.customer_code,
    displayName: c.display_name,
    status: c.status,
    contractReference: c.contract_reference,
    // PDR-18 §1: commercial contract dates, separate from and never rewritten
    // by, or derived from, any technical validity value.
    contractStartDate: persistedBusinessDay(c.contract_start_date),
    contractEndDate: persistedBusinessDay(c.contract_end_date),
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    createdBy: c.created_by,
    updatedBy: c.updated_by,
  };
}

// Manual observation vocabulary. These are operator facts, not license protocol
// states and not cryptographic confirmation. PDR-17 defines issued → activated
// and the manual replacement sequence only. No renewal, reversal, device
// replacement, signed receipt, or cancellation state is defined here.
export const licenseStatuses = ["ISSUED", "ACTIVATED"] as const;
export const replacementStatuses = [
  "REPLACEMENT_AUTHORIZED",
  "OLD_SERVER_STATE_RECORDED",
  "REPLACEMENT_RECORDED",
] as const;
export const observedStatuses = [
  ...licenseStatuses,
  ...replacementStatuses,
] as const;
export const operationKinds = ["LICENSE", "SERVER_REPLACEMENT"] as const;
const artifactMarkers =
  /(?:-----BEGIN |PRIVATE KEY|VLIC1|VLIC2|VDEA1|VDRQ1|VDRP1)/i;
function hasControlCharacter(value: string) {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// OQ-74 — signing-key tracking (Product Owner decision 2026-10-18).
//
// The Owner app is observational (PDR-17: cryptographic issuance is "not
// implemented" here). These validators record an operator's observation of
// which signing key was used for a license, and the key's current
// administrative status. The customer runtime remains the authority for actual
// signature verification.
//
// No private key material is ever accepted, stored, or returned by these
// types — only the public `keyId` (an opaque string up to 120 chars, matching
// the customer-side `LicenseVersion.keyId` field).
// ---------------------------------------------------------------------------

export const signingKeyStatuses = ["ACTIVE", "COMPROMISED", "REVOKED"] as const;
export type SigningKeyStatus = (typeof signingKeyStatuses)[number];

/** Derived safety status of a license observation, based on its signing key. */
export type SigningKeySafety = "SAFE" | "NEEDS_REVIEW" | "UNKNOWN";

/** Check raw metadata before trimming so boundary controls cannot disappear. */
export function signingKeyMetadata(
  value: unknown,
  field: string,
  min: number,
  max: number,
): string {
  const raw = text(value, field, min, max, false);
  if (/[\p{Cc}\p{Cf}]/u.test(raw) || artifactMarkers.test(raw))
    invalid(`${field} must not contain controls, key material or artifacts.`);
  return text(raw, field, min, max);
}

/**
 * Validate a signing-key id. Matches the customer-side `LicenseVersion.keyId`
 * constraints: an opaque string of 1..120 chars, no control characters, no
 * key-material or artifact markers, no whitespace.
 */
export function signingKeyId(value: unknown): string {
  const s = text(value, "signingKeyId", 1, 120, false);
  if (/[\p{Cc}\p{Cf}]/u.test(s) || artifactMarkers.test(s))
    invalid(
      "signingKeyId must not contain control characters, key material, or signed artifacts.",
    );
  if (/\s/.test(s)) invalid("signingKeyId must not contain whitespace.");
  return s;
}

/** Validate an optional signing-key id (null when not supplied). */
export function optionalSigningKeyId(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return signingKeyId(value);
}

/** Validate a signing-key label (human-friendly, no key material). */
export function signingKeyLabel(value: unknown): string {
  const s = signingKeyMetadata(value, "label", 1, 200);
  if (hasControlCharacter(s) || artifactMarkers.test(s))
    invalid(
      "label must not contain control characters, key material, or signed artifacts.",
    );
  return s;
}

/** Validate a signing-key status value. */
export function signingKeyStatus(value: unknown): SigningKeyStatus {
  if (!signingKeyStatuses.includes(value as SigningKeyStatus))
    invalid("Invalid signing-key status.");
  return value as SigningKeyStatus;
}

/** Optional notes for a signing key. Bounded; no key material or artifacts. */
export function signingKeyNotes(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return signingKeyMetadata(value, "notes", 1, 2000);
}

/** Optional evidence reference for a signing-key status change. */
export function signingKeyEvidenceRef(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return signingKeyMetadata(value, "evidenceReference", 1, 200);
}

/**
 * Compute the derived safety status of a license observation from its signing
 * key's current status. Returns `UNKNOWN` when no signing key is recorded.
 */
export function signingKeySafety(
  signingKeyStatusValue: string | null | undefined,
): SigningKeySafety {
  if (signingKeyStatusValue === null || signingKeyStatusValue === undefined)
    return "UNKNOWN";
  if (signingKeyStatusValue === "ACTIVE") return "SAFE";
  // COMPROMISED or REVOKED both surface as NEEDS_REVIEW — the Owner must
  // decide per-license whether to reissue, revoke, or accept.
  if (
    signingKeyStatusValue === "COMPROMISED" ||
    signingKeyStatusValue === "REVOKED"
  )
    return "NEEDS_REVIEW";
  return "UNKNOWN";
}

export interface SigningKeyRow {
  id: string;
  label: string;
  status: SigningKeyStatus;
  status_detected_at: Date | null;
  status_reason: string | null;
  evidence_ref: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  updated_by: string;
}

/** Explicit response allowlist for signing keys; private material never leaks. */
export function signingKeyResponse(
  row: Record<string, unknown>,
  actorRole: Role,
) {
  if (!permissions(actorRole).includes("customers.view"))
    fail(403, "Forbidden", "Signing-key read is not permitted.");
  return {
    id: row.id,
    label: row.label,
    status: signingKeyStatus(row.status),
    statusDetectedAt:
      row.status_detected_at instanceof Date
        ? row.status_detected_at.toISOString()
        : null,
    statusReason: row.status_reason,
    evidenceRef: row.evidence_ref,
    notes: row.notes,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : null,
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : null,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

export function boundedNote(
  value: unknown,
  field: string,
  min: number,
  max: number,
): string {
  const s = text(value, field, min, max);
  if (hasControlCharacter(s) || artifactMarkers.test(s))
    invalid(
      `${field} must not contain control characters, key material, or signed artifacts.`,
    );
  return s;
}
export function installationReference(value: unknown, field: string): string {
  const s = boundedNote(value, field, 1, 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(s))
    invalid(`Invalid ${field}.`);
  return s;
}
export function evidenceReference(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return boundedNote(value, "evidenceReference", 1, 200);
}
export function reasonText(value: unknown): string {
  return boundedNote(value, "reason", 1, 500);
}
export function flag(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(`${field} must be boolean.`);
  return value;
}
export function optionalId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return id(value);
}
export function queryText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) invalid(`Invalid ${field}.`);
  return value === "" ? undefined : text(value, field, 0, 100);
}

export const duplicateConstraints = [
  "operational_license_installation_unique",
  "operational_replacement_old_once",
  "operational_replacement_new_once",
] as const;
export function duplicateConstraintCode(
  constraint: string | undefined,
): "DuplicateOperation" | "Conflict" {
  return duplicateConstraints.includes(
    constraint as (typeof duplicateConstraints)[number],
  )
    ? "DuplicateOperation"
    : "Conflict";
}

const invalidTransition = () =>
  fail(
    409,
    "InvalidTransition",
    "The recorded state does not permit this observation.",
  );

/** External issuance observation. Never means this application issued an artifact. */
export function licenseObservationCreate() {
  return {
    kind: "LICENSE" as const,
    priorStatus: "UNRECORDED" as const,
    observedStatus: "ISSUED" as const,
    observationCategory: "EXTERNAL_ISSUANCE_OBSERVED" as const,
  };
}
/** PDR-17 issued → activated. Operator confirmation, not a receipt. */
export function licenseActivation(currentStatus: string) {
  if (currentStatus !== "ISSUED") invalidTransition();
  return {
    priorStatus: "ISSUED" as const,
    observedStatus: "ACTIVATED" as const,
    observationCategory: "ACTIVATION_OBSERVED" as const,
  };
}
/**
 * Unfinished cross-use only. Same-column reuse is a unique index.
 * A completed A→B followed by B→C is not a conflict. PDR-17 does not decide
 * whether a replaced reference may later be used as a replacement target.
 */
export function unfinishedReplacementCrossUse(
  existing: {
    observedStatus: string;
    oldInstallationReference: string;
    replacementInstallationReference: string;
  },
  requested: {
    oldInstallationReference: string;
    replacementInstallationReference: string;
  },
) {
  return (
    existing.observedStatus !== "REPLACEMENT_RECORDED" &&
    (existing.oldInstallationReference ===
      requested.replacementInstallationReference ||
      existing.replacementInstallationReference ===
        requested.oldInstallationReference)
  );
}
export function replacementCreate(emergency: boolean) {
  if (emergency)
    return {
      insertStatus: "OLD_SERVER_STATE_RECORDED" as const,
      insertCategory: "OLD_SERVER_STATE_OBSERVED" as const,
      oldServerObservedState: "UNAVAILABLE_EMERGENCY_LOSS" as const,
      transitions: [
        {
          prior: "UNRECORDED" as const,
          next: "REPLACEMENT_AUTHORIZED" as const,
        },
        {
          prior: "REPLACEMENT_AUTHORIZED" as const,
          next: "OLD_SERVER_STATE_RECORDED" as const,
        },
      ],
    };
  return {
    insertStatus: "REPLACEMENT_AUTHORIZED" as const,
    insertCategory: "REPLACEMENT_AUTHORIZED" as const,
    oldServerObservedState: null,
    transitions: [
      { prior: "UNRECORDED" as const, next: "REPLACEMENT_AUTHORIZED" as const },
    ],
  };
}
export function oldServerObservation(
  current: { observedStatus: string; emergency: boolean },
  observedState: unknown,
) {
  if (current.emergency)
    fail(
      409,
      "InvalidTransition",
      "An unavailable old server has no observed deactivation response.",
    );
  if (current.observedStatus !== "REPLACEMENT_AUTHORIZED") invalidTransition();
  if (observedState !== "DEACTIVATION_OBSERVED")
    invalid("Invalid old-server observed state.");
  return {
    priorStatus: "REPLACEMENT_AUTHORIZED" as const,
    observedStatus: "OLD_SERVER_STATE_RECORDED" as const,
    observationCategory: "OLD_SERVER_STATE_OBSERVED" as const,
    oldServerObservedState: "DEACTIVATION_OBSERVED" as const,
  };
}
export function replacementObservation(
  currentStatus: string,
  observedState: unknown,
) {
  if (currentStatus !== "OLD_SERVER_STATE_RECORDED") invalidTransition();
  if (observedState !== "INSTALLATION_OBSERVED")
    invalid("Invalid replacement observed state.");
  return {
    priorStatus: "OLD_SERVER_STATE_RECORDED" as const,
    observedStatus: "REPLACEMENT_RECORDED" as const,
    observationCategory: "REPLACEMENT_INSTALLATION_OBSERVED" as const,
    replacementObservedState: "INSTALLATION_OBSERVED" as const,
  };
}
export function operationKindFilter(value: unknown): string | undefined {
  const raw = queryText(value, "kind");
  if (raw === undefined) return undefined;
  if (!operationKinds.includes(raw as (typeof operationKinds)[number]))
    invalid("Invalid kind.");
  return raw;
}
export function operationStatusFilter(value: unknown): string | undefined {
  const raw = queryText(value, "status");
  if (raw === undefined) return undefined;
  if (!observedStatuses.includes(raw as (typeof observedStatuses)[number]))
    invalid("Invalid status.");
  return raw;
}

function instant(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value)))
    return new Date(value).toISOString();
  fail(500, "InternalError", "The operation failed. Please retry.");
}

/** Explicit allowlist. Contract references, secrets and extra columns cannot leak. */
export function operationResponse(
  row: Record<string, unknown>,
  actorRole: Role,
  transitions?: Record<string, unknown>[],
) {
  if (!permissions(actorRole).includes("operations.view"))
    fail(403, "PermissionDenied", "Operational records are not permitted.");
  const keyId = row.kind === "LICENSE" ? row.signing_key_id : null;
  const keyStatus = keyId ? row.signing_key_status : null;
  const body: Record<string, unknown> = {
    id: row.id,
    customerId: row.customer_id,
    customerCode: row.customer_code,
    displayName: row.display_name,
    kind: row.kind,
    observationCategory: row.observation_category,
    observedStatus: row.observed_status,
    installationReference: row.installation_reference,
    oldInstallationReference: row.old_installation_reference,
    replacementInstallationReference: row.replacement_installation_reference,
    oldServerObservedState: row.old_server_observed_state,
    replacementObservedState: row.replacement_observed_state,
    emergencyOldServerLost: row.emergency_old_server_lost,
    replacesRecordId: row.replaces_record_id,
    // PDR-18 §1 / PDR-17: Owner-side OBSERVATION metadata, not a claim about a
    // signed artifact. `recordedOn` is the day this observation was recorded —
    // the UTC BusinessDay projection of the immutable server-generated
    // `created_at` instant, never the license's actual issuance or activation
    // day. `observedValidityEnd` is the end the operator recorded having seen.
    recordedOn: recordedOnFor(row.created_at),
    observedValidityEnd: persistedBusinessDay(row.observed_validity_end),
    evidenceBasis: "OPERATOR_OBSERVED",
    cryptographicVerification: "NOT_IMPLEMENTED",
    signedArtifactProduced: false,
    customerServerContacted: false,
    // Administrative association only; current status comes from the LEFT JOIN.
    signingKeyId: keyId ?? null,
    signingKeyStatus: keyStatus ?? null,
    signingKeySafety: signingKeySafety(
      typeof keyStatus === "string" ? keyStatus : null,
    ),
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
  if (transitions)
    body.transitions = transitions.map((item) => {
      if (item.confirmation_kind !== "OPERATOR_OBSERVED")
        fail(500, "InternalError", "The operation failed. Please retry.");
      return {
        id: item.id,
        actorId: item.actor_id,
        occurredAt: instant(item.occurred_at),
        priorStatus: item.prior_status,
        newStatus: item.new_status,
        reason: item.reason,
        evidenceReference: item.evidence_reference,
        confirmationKind: "OPERATOR_OBSERVED",
      };
    });
  return body;
}
