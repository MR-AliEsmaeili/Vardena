import type { PoolClient } from "pg";
import { invalid, page } from "./domain.js";

/**
 * Owner audit explorer contract (PDR-17 "Audit view"; `audit.view` only).
 *
 * Every filter is an exact match or a half-open UTC window. Values are validated
 * before any SQL is built, and SQL receives only positional parameters. There is
 * no substring search, so LIKE wildcards have no meaning here; wildcard and
 * metacharacter input is rejected as a malformed value rather than escaped.
 */
export const auditPageSize = 50;

export const auditTargetTypes = [
  "Customer",
  "OperationalRecord",
  "User",
  "AuditArchiveBatch",
] as const;
export const auditOutcomes = ["SUCCESS", "DENIED"] as const;
export type AuditTargetType = (typeof auditTargetTypes)[number];
export type AuditOutcome = (typeof auditOutcomes)[number];
export type AuditIncidentStatus = "NONE" | "UNRESOLVED";

export const MINIMUM_AUDIT_RETENTION_YEARS = 3;

export const securityIncidentEventTypes = [
  "AUTH_LOGIN_FAILED",
  "OPERATION_MUTATION_DENIED",
  "AUDIT_ARCHIVE_ACCESS_DENIED",
  "AUDIT_RETENTION_VIOLATION_BLOCKED",
] as const;

function isUtcLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Computes the exact 3-year minimum retention timestamp in UTC, matching
 * PostgreSQL `(((occurred_at AT TIME ZONE 'UTC') + INTERVAL '3 years') AT TIME ZONE 'UTC')`.
 * Feb 29 in a leap year clamps to Feb 28 in a non-leap target year (+3 years).
 */
export function computeMinimumRetainedUntil(occurredAt: Date | string): Date {
  const d =
    typeof occurredAt === "string"
      ? new Date(utcInstant(occurredAt, "occurredAt"))
      : new Date(occurredAt.getTime());
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1000) {
    invalid("occurredAt must be a valid UTC instant in year 1000 or later.");
  }
  const targetYear = d.getUTCFullYear() + MINIMUM_AUDIT_RETENTION_YEARS;
  const month = d.getUTCMonth();
  let day = d.getUTCDate();
  if (month === 1 && day === 29 && !isUtcLeapYear(targetYear)) {
    day = 28;
  }
  return new Date(
    Date.UTC(
      targetYear,
      month,
      day,
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
}

export function isInherentSecurityIncident(
  eventType: string,
  outcome: string,
): boolean {
  return (
    outcome === "DENIED" ||
    outcome === "FAILED" ||
    (securityIncidentEventTypes as readonly string[]).includes(eventType)
  );
}

const filterNames = [
  "page",
  "eventType",
  "actorId",
  "targetType",
  "targetId",
  "outcome",
  "occurredFrom",
  "occurredBefore",
] as const;
const eventTypePattern = /^[A-Z][A-Z0-9_]{0,119}$/;
const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;
/** Documented minimum year for instants (backend and frontend share this rule). */
const minimumAuditYear = 1000;
// Canonical UTC wire form only: `Z` suffix, no offsets, optional 1–3 digit fraction.
const instantPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

export interface AuditFilters {
  page: number;
  eventType?: string;
  actorId?: string;
  targetType?: AuditTargetType;
  targetId?: string;
  outcome?: AuditOutcome;
  /** Inclusive lower bound, canonical UTC ISO-8601 with milliseconds. */
  occurredFrom?: string;
  /** Exclusive upper bound, canonical UTC ISO-8601 with milliseconds. */
  occurredBefore?: string;
}

/**
 * Keys written by `audit()` callers. Anything else in before/after JSON is dropped
 * on read, so a future writer that stores a secret or internal field cannot leak
 * it through this endpoint.
 */
const auditStateKeys = new Set([
  "customerCode",
  "displayName",
  "status",
  "contractReference",
  "username",
  "role",
  "isActive",
  "mustChangePassword",
  "customerId",
  "kind",
  "observedStatus",
  "observationCategory",
  "installationReference",
  "oldInstallationReference",
  "replacementInstallationReference",
  "oldServerObservedState",
  "replacementObservedState",
  "emergencyOldServerLost",
  "replacesRecordId",
  "evidenceReference",
  "evidenceBasis",
  "milestones",
  "archiveBatchId",
  "archivedCount",
  "firstSequence",
  "lastSequence",
  "batchDigestSha256",
  "archiveVerified",
]);

function singleValue(
  query: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = query[name];
  if (value === undefined) return undefined;
  // Repeated keys arrive as arrays and would otherwise be silently coerced.
  if (typeof value !== "string") invalid(`${name} must be a single value.`);
  // An empty value means "not supplied", matching the operational-record filters.
  return value === "" ? undefined : value;
}

/** Strict canonical UTC instant; rejects offsets and calendar rollovers (e.g. Feb 31). */
export function utcInstant(value: string, field: string): string {
  const match = instantPattern.exec(value);
  if (!match) invalid(`${field} must be a UTC instant ending with Z.`);
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map(Number) as [number, number, number, number, number, number];
  // Documented minimum. Checked explicitly, before Date.UTC: that constructor maps
  // years 0–99 onto 1900–1999, so the round-trip below alone cannot enforce it.
  if (year < minimumAuditYear)
    invalid(`${field} must be a UTC instant in year 1000 or later.`);
  const millis = Number((match[7] ?? "0").padEnd(3, "0"));
  const date = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, millis),
  );
  // Round-trip check: Date.UTC maps years 0–99 to 1900+ and rolls invalid days over.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second ||
    date.getUTCMilliseconds() !== millis
  )
    invalid(`${field} is not a valid calendar instant.`);
  return date.toISOString();
}

/**
 * Parses and bounds every query parameter. Unknown keys are rejected so a typo
 * such as `actor=` cannot silently return an unfiltered history.
 */
export function auditFilters(query: Record<string, unknown>): AuditFilters {
  for (const key of Object.keys(query))
    if (!(filterNames as readonly string[]).includes(key))
      invalid("Unknown query parameter.");
  const filters: AuditFilters = { page: page(query.page) };
  const eventType = singleValue(query, "eventType");
  if (eventType !== undefined) {
    if (!eventTypePattern.test(eventType)) invalid("eventType is invalid.");
    filters.eventType = eventType;
  }
  const actorId = singleValue(query, "actorId");
  if (actorId !== undefined) {
    if (!ulidPattern.test(actorId)) invalid("actorId is invalid.");
    filters.actorId = actorId;
  }
  const targetType = singleValue(query, "targetType");
  if (targetType !== undefined) {
    if (!(auditTargetTypes as readonly string[]).includes(targetType))
      invalid("targetType is invalid.");
    filters.targetType = targetType as AuditTargetType;
  }
  const targetId = singleValue(query, "targetId");
  if (targetId !== undefined) {
    if (!ulidPattern.test(targetId)) invalid("targetId is invalid.");
    filters.targetId = targetId;
  }
  const outcome = singleValue(query, "outcome");
  if (outcome !== undefined) {
    if (!(auditOutcomes as readonly string[]).includes(outcome))
      invalid("outcome is invalid.");
    filters.outcome = outcome as AuditOutcome;
  }
  const from = singleValue(query, "occurredFrom");
  if (from !== undefined)
    filters.occurredFrom = utcInstant(from, "occurredFrom");
  const before = singleValue(query, "occurredBefore");
  if (before !== undefined)
    filters.occurredBefore = utcInstant(before, "occurredBefore");
  if (
    filters.occurredFrom !== undefined &&
    filters.occurredBefore !== undefined &&
    filters.occurredFrom >= filters.occurredBefore
  )
    invalid("occurredFrom must be earlier than occurredBefore.");
  return filters;
}

/** Explicit allowlist projection of the before/after JSON. */
export function auditState(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (!auditStateKeys.has(key)) continue;
    const item = source[key];
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    )
      out[key] = item;
    else if (
      Array.isArray(item) &&
      item.every((element) => typeof element === "string")
    )
      out[key] = [...item];
  }
  return out;
}

/**
 * Runs the filtered, ordered, bounded read inside the caller's transaction. The
 * caller has already passed the `audit.view` permission check.
 */
export async function listAuditEvents(
  tx: PoolClient,
  query: Record<string, unknown>,
) {
  const filters = auditFilters(query);
  const values: unknown[] = [];
  const bind = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const where: string[] = [];
  if (filters.eventType !== undefined)
    where.push(`event_type = ${bind(filters.eventType)}`);
  if (filters.actorId !== undefined)
    where.push(`actor_id = ${bind(filters.actorId)}`);
  if (filters.targetType !== undefined)
    where.push(`target_type = ${bind(filters.targetType)}`);
  if (filters.targetId !== undefined)
    where.push(`target_id = ${bind(filters.targetId)}`);
  if (filters.outcome !== undefined)
    where.push(`outcome = ${bind(filters.outcome)}`);
  if (filters.occurredFrom !== undefined)
    where.push(`occurred_at >= ${bind(filters.occurredFrom)}::timestamptz`);
  if (filters.occurredBefore !== undefined)
    where.push(`occurred_at < ${bind(filters.occurredBefore)}::timestamptz`);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  // One extra row decides hasNext without a count(*) over the append-only table.
  const limit = bind(auditPageSize + 1);
  const offset = bind((filters.page - 1) * auditPageSize);
  // `sequence` is UNIQUE and monotonic, so it is a total order and the tie-breaker.
  const rows = await tx.query<{
    id: string;
    actor_id: string | null;
    event_type: string;
    target_type: string;
    target_id: string | null;
    occurred_at: Date;
    minimum_retained_until?: Date;
    security_incident?: boolean;
    incident_status?: string;
    archive_batch_id?: string | null;
    outcome: string;
    reason: string | null;
    before_state: unknown;
    after_state: unknown;
  }>(
    `SELECT id, actor_id, event_type, target_type, target_id, occurred_at,
      minimum_retained_until,
      COALESCE(security_incident, owner.is_security_incident_event(event_type, outcome)) AS security_incident,
      COALESCE(
        incident_status,
        CASE
          WHEN COALESCE(security_incident, owner.is_security_incident_event(event_type, outcome))
          THEN 'UNRESOLVED'
          ELSE 'NONE'
        END
      ) AS incident_status,
      (SELECT a.batch_id FROM owner_audit_archive.archived_audit_events a WHERE a.id = owner.audit_events.id) AS archive_batch_id,
      outcome, reason, before_state, after_state
    FROM owner.audit_events ${clause}
    ORDER BY sequence DESC LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return {
    items: rows.rows.slice(0, auditPageSize).map((row) => {
      const minimumRetainedUntil = (
        row.minimum_retained_until ??
        computeMinimumRetainedUntil(row.occurred_at)
      ).toISOString();
      const securityIncident =
        typeof row.security_incident === "boolean"
          ? row.security_incident
          : isInherentSecurityIncident(row.event_type, row.outcome);
      const incidentStatus: AuditIncidentStatus =
        row.incident_status === "UNRESOLVED" || row.incident_status === "NONE"
          ? row.incident_status
          : securityIncident
            ? "UNRESOLVED"
            : "NONE";
      const archiveBatchId = row.archive_batch_id ?? null;
      return {
        id: row.id,
        actorId: row.actor_id,
        eventType: row.event_type,
        targetType: row.target_type,
        targetId: row.target_id,
        occurredAt: row.occurred_at.toISOString(),
        minimumRetainedUntil,
        securityIncident,
        incidentStatus,
        archived: archiveBatchId !== null,
        archiveBatchId,
        outcome: row.outcome,
        reason: row.reason,
        beforeState: auditState(row.before_state),
        afterState: auditState(row.after_state),
      };
    }),
    page: filters.page,
    pageSize: auditPageSize,
    hasNext: rows.rows.length > auditPageSize,
  };
}
