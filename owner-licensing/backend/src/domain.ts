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
  | "replacements.authorize";
// PDR-17 / PDR-11 §21 (2026-10-16 OQ-75 two-role MVP model): exact grants,
// no wildcards or prefix expansion. Superseded four-role names receive [].
// License Operator may view customers/operations/audit and record routine
// observations, but cannot manage users, mutate customers, perform privileged
// audit-archive operations, or authorize server replacements / emergency
// old-server loss decisions.
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
    ];
  if (role === "LICENSE_OPERATOR")
    return [
      "customers.view",
      "audit.view",
      "operations.view",
      "operations.record",
    ];
  return [];
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
export function assertActiveAuthorizedActor(
  actor:
    | Pick<User, "id" | "role" | "is_active" | "must_change_password">
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
  return assertPermission(actor.role, requiredPermission);
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
// PDR-18 §1 — contract dates and activation-validity dates
//
// Both pairs are canonical BusinessDate calendar days (`YYYY-MM-DD`,
// docs/datetime.md, AR-32). They are deliberately separate: contract dates are
// commercial/administrative and may precede issuance, while activation validity
// Owner-side observation metadata: the day an operator RECORDED an observation,
// derived on read from the immutable `created_at` instant, and the validity end
// the operator recorded having seen. Neither is an attested property of a
// signed artifact — PDR-17 records cryptographic issuance and verification as
// not implemented, and every response states
// `cryptographicVerification = NOT_IMPLEMENTED`.
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

/**
 * The retained interval convention for the operator-recorded validity end: it
 * must be later than the day the observation was recorded. A `null` end means
 * "no end was recorded" — it is never defaulted and never invented.
 */
export function assertObservedValidityEnd(
  recordedOn: string,
  end: string | null,
): void {
  if (end !== null && end <= recordedOn)
    invalid(
      "observedValidityEnd must be later than the day the observation is recorded.",
    );
}

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
    // by any activation-validity window.
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
