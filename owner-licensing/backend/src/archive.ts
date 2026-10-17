import type { PoolClient } from "pg";
import { ulid } from "ulid";
import { audit } from "./db.js";
import {
  assertActiveAuthorizedActor,
  digest,
  fail,
  id as parseId,
  invalid,
  object,
  page as parsePage,
  reasonText as parseReason,
  type User,
} from "./domain.js";
import {
  MINIMUM_AUDIT_RETENTION_YEARS,
  auditState,
  computeMinimumRetainedUntil,
  isInherentSecurityIncident,
  securityIncidentEventTypes,
  utcInstant,
  type AuditIncidentStatus,
} from "./audit.js";

export type AuthorizedActorRow = {
  id: string;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
};

export {
  MINIMUM_AUDIT_RETENTION_YEARS,
  computeMinimumRetainedUntil,
  isInherentSecurityIncident,
  securityIncidentEventTypes,
  type AuditIncidentStatus,
};

export const archiveMetaEventTypes = [
  "AUDIT_ARCHIVE_BATCH_CREATED",
  "AUDIT_ARCHIVE_VERIFIED",
] as const;

const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const forbiddenArchiveValuePattern =
  /(password_hash|token_hash|sessionToken|\$argon2|BEGIN [A-Z0-9 ]*PRIVATE KEY)/i;

export type CleanupProtectionReason =
  | "WITHIN_THREE_YEAR_MINIMUM_RETENTION"
  | "UNRESOLVED_SECURITY_INCIDENT_HOLD"
  | "UNARCHIVED_SOURCE_EVIDENCE"
  | "PERMANENT_RETENTION_POLICY_NO_PURGE";

export type RetentionDisposition =
  | "RETAIN_ACTIVE_WITHIN_WINDOW_AND_INCIDENT_HOLD"
  | "RETAIN_ACTIVE_WITHIN_MINIMUM_WINDOW"
  | "RETAIN_PAST_FLOOR_INCIDENT_HOLD"
  | "RETAIN_PAST_FLOOR_AWAITING_ARCHIVE"
  | "RETAIN_PAST_FLOOR_ARCHIVED_PERMANENTLY";

export interface CanonicalArchiveEventPayload {
  sequence: number;
  id: string;
  actorId: string | null;
  eventType: string;
  targetType: string;
  targetId: string;
  occurredAt: string;
  minimumRetainedUntil: string;
  outcome: "SUCCESS" | "DENIED" | "FAILED";
  securityIncident: boolean;
  incidentStatus: AuditIncidentStatus;
  reason: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
}

export interface RetentionEvaluatedEventInput {
  sequence: number;
  id: string;
  actorId: string | null;
  eventType: string;
  targetType: string;
  targetId: string;
  occurredAt: Date | string;
  minimumRetainedUntil?: Date | string | null;
  outcome: string;
  securityIncident?: unknown;
  incidentStatus?: unknown;
  reason?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  archived?: unknown;
  archiveBatchId?: unknown;
  recordSha256?: unknown;
}

export interface AuditEventRetentionEvaluation {
  id: string;
  sequence: number;
  occurredAt: string;
  minimumRetainedUntil: string;
  evaluationTime: string;
  withinMinimumRetentionWindow: boolean;
  pastMinimumRetentionFloor: boolean;
  securityIncident: boolean;
  incidentStatus: AuditIncidentStatus;
  incidentProtected: boolean;
  archived: boolean;
  archiveBatchId: string | null;
  archiveVerified: boolean;
  cleanupEligible: false;
  cleanupProtectionReasons: CleanupProtectionReason[];
  retentionDisposition: RetentionDisposition;
}

export interface ArchiveBatchSummary {
  id: string;
  batchNumber: number;
  createdBy: string;
  createdAt: string;
  reason: string;
  firstSequence: number;
  lastSequence: number;
  eventCount: number;
  retentionCutoffAt: string;
  previousBatchDigest: string | null;
  batchDigestSha256: string;
}

export interface ArchivedAuditEventRecord extends CanonicalArchiveEventPayload {
  batchId: string;
  archivedAt: string;
  recordSha256: string;
}

export interface AuditArchiveBundle {
  batch: ArchiveBatchSummary;
  events: ArchivedAuditEventRecord[];
}

export interface AuditRetentionPolicyContract {
  appendOnly: true;
  minimumRetentionYears: 3;
  threeYearMinimumIsPurgeDate: false;
  unresolvedSecurityIncidentsExcludedFromCleanup: true;
  permanentSeparateArchiveInForce: true;
  automaticDestructivePurgeEnabled: false;
  archiveStorageBoundary: "SEPARATE_POSTGRES_SCHEMA_AND_EXPORTABLE_BUNDLE";
  cryptographicHardwareWormImplemented: false;
}

export const canonicalAuditRetentionPolicy: AuditRetentionPolicyContract = {
  appendOnly: true,
  minimumRetentionYears: 3,
  threeYearMinimumIsPurgeDate: false,
  unresolvedSecurityIncidentsExcludedFromCleanup: true,
  permanentSeparateArchiveInForce: true,
  automaticDestructivePurgeEnabled: false,
  archiveStorageBoundary: "SEPARATE_POSTGRES_SCHEMA_AND_EXPORTABLE_BUNDLE",
  cryptographicHardwareWormImplemented: false,
};

export interface AuditArchiveStatusReport {
  asOf: string;
  policy: AuditRetentionPolicyContract;
  counts: {
    totalSourceEvents: number;
    withinMinimumRetentionWindowCount: number;
    pastMinimumRetentionFloorCount: number;
    unresolvedSecurityIncidentCount: number;
    pastFloorUnresolvedIncidentHoldCount: number;
    archivedEventCount: number;
    unarchivedEligibleEventCount: number;
    archiveBatchCount: number;
    cleanupEligibleEventCount: 0;
  };
  integrity: {
    verified: boolean;
    latestBatchId: string | null;
    latestBatchDigestSha256: string | null;
    lastArchivedSequence: number | null;
  };
}

function canonicalizeValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  if (typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      if (src[key] !== undefined) {
        out[key] = canonicalizeValue(src[key]);
      }
    }
    return out;
  }
  return null;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value));
}

export function validateAndNormalizeIncidentMetadata(input: {
  eventType: unknown;
  outcome: unknown;
  securityIncident?: unknown;
  incidentStatus?: unknown;
}): { securityIncident: boolean; incidentStatus: AuditIncidentStatus } {
  if (
    typeof input.eventType !== "string" ||
    input.eventType.trim().length === 0
  ) {
    invalid("eventType is required for incident metadata validation.");
  }
  if (
    input.outcome !== "SUCCESS" &&
    input.outcome !== "DENIED" &&
    input.outcome !== "FAILED"
  ) {
    invalid("outcome must be SUCCESS, DENIED, or FAILED.");
  }
  const inherent = isInherentSecurityIncident(input.eventType, input.outcome);
  if (
    input.securityIncident !== undefined &&
    input.securityIncident !== null &&
    typeof input.securityIncident !== "boolean"
  ) {
    invalid("securityIncident must be a boolean.");
  }
  if (inherent && input.securityIncident === false) {
    fail(
      409,
      "InconsistentIncidentMetadata",
      `Security denial or failure event (${input.eventType}) must have securityIncident = true.`,
    );
  }
  const securityIncident =
    typeof input.securityIncident === "boolean"
      ? input.securityIncident
      : inherent;

  if (input.incidentStatus !== undefined && input.incidentStatus !== null) {
    if (input.incidentStatus === "RESOLVED") {
      fail(
        409,
        "UnsupportedIncidentResolution",
        "Unresolved security incidents cannot be marked RESOLVED without an approved incident-resolution workflow.",
      );
    }
    if (
      input.incidentStatus !== "NONE" &&
      input.incidentStatus !== "UNRESOLVED"
    ) {
      invalid("incidentStatus must be NONE or UNRESOLVED.");
    }
    if (securityIncident && input.incidentStatus !== "UNRESOLVED") {
      fail(
        409,
        "InconsistentIncidentMetadata",
        "Security incident events must have incidentStatus = UNRESOLVED.",
      );
    }
    if (!securityIncident && input.incidentStatus !== "NONE") {
      fail(
        409,
        "InconsistentIncidentMetadata",
        "Non-incident events must have incidentStatus = NONE.",
      );
    }
  }

  return {
    securityIncident,
    incidentStatus: securityIncident ? "UNRESOLVED" : "NONE",
  };
}

function assertMinimizedArchiveState(
  rawState: unknown,
  field: "beforeState" | "afterState",
): Record<string, unknown> | null {
  if (rawState === null || rawState === undefined) return null;
  if (typeof rawState !== "object" || Array.isArray(rawState)) {
    invalid(`${field} must be a JSON object or null.`);
  }
  const serialized = JSON.stringify(rawState);
  if (forbiddenArchiveValuePattern.test(serialized)) {
    fail(
      409,
      "ArchiveSecretLeakBlocked",
      `${field} contains forbidden secret or credential material.`,
    );
  }
  const projected = auditState(rawState);
  const rawKeys = Object.keys(rawState as Record<string, unknown>);
  const projectedKeys = Object.keys(projected ?? {});
  if (rawKeys.length !== projectedKeys.length) {
    fail(
      409,
      "ArchiveMinimizationViolation",
      `${field} contains non-allowlisted audit state keys.`,
    );
  }
  return projected;
}

export function computeArchivedEventDigest(
  payload: CanonicalArchiveEventPayload,
): string {
  if (!Number.isInteger(payload.sequence) || payload.sequence < 1) {
    invalid("Archived event sequence must be a positive integer.");
  }
  if (!ulidPattern.test(payload.id)) {
    invalid("Archived event id must be a 26-character ULID.");
  }
  if (payload.actorId !== null && !ulidPattern.test(payload.actorId)) {
    invalid("Archived event actorId must be a 26-character ULID or null.");
  }
  if (
    typeof payload.eventType !== "string" ||
    payload.eventType.trim().length === 0
  ) {
    invalid("Archived event eventType is required.");
  }
  if (
    typeof payload.targetType !== "string" ||
    payload.targetType.trim().length === 0
  ) {
    invalid("Archived event targetType is required.");
  }
  if (
    typeof payload.targetId !== "string" ||
    payload.targetId.trim().length === 0
  ) {
    invalid("Archived event targetId is required.");
  }
  const occurredIso = utcInstant(payload.occurredAt, "occurredAt");
  const minRetainedIso = utcInstant(
    payload.minimumRetainedUntil,
    "minimumRetainedUntil",
  );
  const expectedMinRetainedIso =
    computeMinimumRetainedUntil(occurredIso).toISOString();
  if (minRetainedIso !== expectedMinRetainedIso) {
    fail(
      409,
      "InconsistentRetentionMetadata",
      `minimumRetainedUntil (${minRetainedIso}) does not equal occurredAt + 3 years (${expectedMinRetainedIso}).`,
    );
  }
  const incident = validateAndNormalizeIncidentMetadata({
    eventType: payload.eventType,
    outcome: payload.outcome,
    securityIncident: payload.securityIncident,
    incidentStatus: payload.incidentStatus,
  });
  if (
    payload.reason !== null &&
    (typeof payload.reason !== "string" ||
      forbiddenArchiveValuePattern.test(payload.reason))
  ) {
    fail(
      409,
      "ArchiveSecretLeakBlocked",
      "Archived event reason contains invalid or forbidden material.",
    );
  }
  const beforeState = assertMinimizedArchiveState(
    payload.beforeState,
    "beforeState",
  );
  const afterState = assertMinimizedArchiveState(
    payload.afterState,
    "afterState",
  );

  return digest(
    canonicalJson({
      sequence: payload.sequence,
      id: payload.id,
      actorId: payload.actorId,
      eventType: payload.eventType,
      targetType: payload.targetType,
      targetId: payload.targetId,
      occurredAt: occurredIso,
      minimumRetainedUntil: minRetainedIso,
      outcome: payload.outcome,
      securityIncident: incident.securityIncident,
      incidentStatus: incident.incidentStatus,
      reason: payload.reason,
      beforeState,
      afterState,
    }),
  );
}

export function computeArchiveBatchDigest(input: {
  batchId: string;
  firstSequence: number;
  lastSequence: number;
  eventCount: number;
  retentionCutoffAt: string;
  previousBatchDigest: string | null;
  recordDigests: readonly string[];
}): string {
  if (!ulidPattern.test(input.batchId)) {
    invalid("batchId must be a 26-character ULID.");
  }
  if (!Number.isInteger(input.firstSequence) || input.firstSequence < 1) {
    invalid("firstSequence must be a positive integer.");
  }
  if (
    !Number.isInteger(input.lastSequence) ||
    input.lastSequence < input.firstSequence
  ) {
    invalid("lastSequence must be an integer >= firstSequence.");
  }
  if (
    !Number.isInteger(input.eventCount) ||
    input.eventCount < 1 ||
    input.eventCount !== input.recordDigests.length
  ) {
    fail(
      409,
      "InconsistentArchiveMetadata",
      "Archive batch eventCount must be >= 1 and match recordDigests length.",
    );
  }
  const cutoffIso = utcInstant(input.retentionCutoffAt, "retentionCutoffAt");
  if (
    input.previousBatchDigest !== null &&
    !sha256Pattern.test(input.previousBatchDigest)
  ) {
    fail(
      409,
      "InvalidArchiveMetadata",
      "previousBatchDigest must be a 64-character lowercase hex SHA-256 or null.",
    );
  }
  for (const d of input.recordDigests) {
    if (!sha256Pattern.test(d)) {
      fail(
        409,
        "InvalidArchiveMetadata",
        "Each recordDigest must be a 64-character lowercase hex SHA-256.",
      );
    }
  }
  return digest(
    canonicalJson({
      batchId: input.batchId,
      firstSequence: input.firstSequence,
      lastSequence: input.lastSequence,
      eventCount: input.eventCount,
      retentionCutoffAt: cutoffIso,
      previousBatchDigest: input.previousBatchDigest,
      recordDigests: [...input.recordDigests],
    }),
  );
}

export function evaluateAuditEventRetention(
  event: RetentionEvaluatedEventInput,
  evaluationTime: Date | string,
): AuditEventRetentionEvaluation {
  if (!Number.isInteger(event.sequence) || event.sequence < 1) {
    invalid("event.sequence must be a positive integer.");
  }
  if (typeof event.id !== "string" || !ulidPattern.test(event.id)) {
    invalid("event.id must be a 26-character ULID.");
  }
  if (
    event.actorId !== null &&
    (typeof event.actorId !== "string" || !ulidPattern.test(event.actorId))
  ) {
    invalid("event.actorId must be a 26-character ULID or null.");
  }
  const occurredIso =
    typeof event.occurredAt === "string"
      ? utcInstant(event.occurredAt, "occurredAt")
      : utcInstant(event.occurredAt.toISOString(), "occurredAt");
  const evalIso =
    typeof evaluationTime === "string"
      ? utcInstant(evaluationTime, "evaluationTime")
      : utcInstant(evaluationTime.toISOString(), "evaluationTime");

  const expectedMinRetainedIso =
    computeMinimumRetainedUntil(occurredIso).toISOString();
  if (
    event.minimumRetainedUntil !== undefined &&
    event.minimumRetainedUntil !== null
  ) {
    const providedMinIso =
      typeof event.minimumRetainedUntil === "string"
        ? utcInstant(event.minimumRetainedUntil, "minimumRetainedUntil")
        : utcInstant(
            event.minimumRetainedUntil.toISOString(),
            "minimumRetainedUntil",
          );
    if (providedMinIso !== expectedMinRetainedIso) {
      fail(
        409,
        "InconsistentRetentionMetadata",
        `minimumRetainedUntil (${providedMinIso}) contradicts occurredAt + 3 years (${expectedMinRetainedIso}).`,
      );
    }
  }

  const incident = validateAndNormalizeIncidentMetadata({
    eventType: event.eventType,
    outcome: event.outcome,
    securityIncident: event.securityIncident,
    incidentStatus: event.incidentStatus,
  });

  if (
    event.archived !== undefined &&
    event.archived !== null &&
    typeof event.archived !== "boolean"
  ) {
    invalid("archived must be a boolean.");
  }
  const archived = event.archived === true;
  const archiveBatchId =
    event.archiveBatchId === undefined || event.archiveBatchId === null
      ? null
      : event.archiveBatchId;

  if (archived) {
    if (
      typeof archiveBatchId !== "string" ||
      !ulidPattern.test(archiveBatchId)
    ) {
      fail(
        409,
        "InvalidArchiveMetadata",
        "Archived audit event must have a valid 26-character ULID archiveBatchId.",
      );
    }
    if (
      typeof event.recordSha256 !== "string" ||
      !sha256Pattern.test(event.recordSha256)
    ) {
      fail(
        409,
        "InvalidArchiveMetadata",
        "Archived audit event must have a valid 64-character SHA-256 recordSha256.",
      );
    }
    const expectedDigest = computeArchivedEventDigest({
      sequence: event.sequence,
      id: event.id,
      actorId: event.actorId,
      eventType: event.eventType,
      targetType: event.targetType,
      targetId: event.targetId,
      occurredAt: occurredIso,
      minimumRetainedUntil: expectedMinRetainedIso,
      outcome: event.outcome as "SUCCESS" | "DENIED" | "FAILED",
      securityIncident: incident.securityIncident,
      incidentStatus: incident.incidentStatus,
      reason: event.reason ?? null,
      beforeState: auditState(event.beforeState),
      afterState: auditState(event.afterState),
    });
    if (event.recordSha256 !== expectedDigest) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        `Archived audit event ${event.id} recordSha256 mismatch.`,
      );
    }
  } else if (
    archiveBatchId !== null ||
    (event.recordSha256 !== undefined && event.recordSha256 !== null)
  ) {
    fail(
      409,
      "InconsistentArchiveMetadata",
      "Unarchived audit event cannot carry archiveBatchId or recordSha256.",
    );
  }

  const evalMs = new Date(evalIso).getTime();
  const minRetainedMs = new Date(expectedMinRetainedIso).getTime();
  const withinMinimumRetentionWindow = evalMs < minRetainedMs;
  const pastMinimumRetentionFloor = evalMs >= minRetainedMs;
  const incidentProtected =
    incident.securityIncident && incident.incidentStatus === "UNRESOLVED";
  const archiveVerified = archived;

  const cleanupProtectionReasons: CleanupProtectionReason[] = [];
  if (withinMinimumRetentionWindow) {
    cleanupProtectionReasons.push("WITHIN_THREE_YEAR_MINIMUM_RETENTION");
  }
  if (incidentProtected) {
    cleanupProtectionReasons.push("UNRESOLVED_SECURITY_INCIDENT_HOLD");
  }
  if (!archiveVerified) {
    cleanupProtectionReasons.push("UNARCHIVED_SOURCE_EVIDENCE");
  }
  cleanupProtectionReasons.push("PERMANENT_RETENTION_POLICY_NO_PURGE");

  let retentionDisposition: RetentionDisposition;
  if (withinMinimumRetentionWindow && incidentProtected) {
    retentionDisposition = "RETAIN_ACTIVE_WITHIN_WINDOW_AND_INCIDENT_HOLD";
  } else if (withinMinimumRetentionWindow) {
    retentionDisposition = "RETAIN_ACTIVE_WITHIN_MINIMUM_WINDOW";
  } else if (incidentProtected) {
    retentionDisposition = "RETAIN_PAST_FLOOR_INCIDENT_HOLD";
  } else if (!archiveVerified) {
    retentionDisposition = "RETAIN_PAST_FLOOR_AWAITING_ARCHIVE";
  } else {
    retentionDisposition = "RETAIN_PAST_FLOOR_ARCHIVED_PERMANENTLY";
  }

  return {
    id: event.id,
    sequence: event.sequence,
    occurredAt: occurredIso,
    minimumRetainedUntil: expectedMinRetainedIso,
    evaluationTime: evalIso,
    withinMinimumRetentionWindow,
    pastMinimumRetentionFloor,
    securityIncident: incident.securityIncident,
    incidentStatus: incident.incidentStatus,
    incidentProtected,
    archived,
    archiveBatchId: archiveBatchId as string | null,
    archiveVerified,
    cleanupEligible: false,
    cleanupProtectionReasons,
    retentionDisposition,
  };
}

export function verifyExportedArchiveBundle(rawBundle: unknown): {
  verified: true;
  batchId: string;
  eventCount: number;
  firstSequence: number;
  lastSequence: number;
  batchDigestSha256: string;
} {
  const top = object(rawBundle, ["batch", "events"]);
  const rawBatch = object(top.batch, [
    "id",
    "batchNumber",
    "createdBy",
    "createdAt",
    "reason",
    "firstSequence",
    "lastSequence",
    "eventCount",
    "retentionCutoffAt",
    "previousBatchDigest",
    "batchDigestSha256",
  ]);
  if (!Array.isArray(top.events) || top.events.length === 0) {
    fail(
      409,
      "InvalidArchiveMetadata",
      "Archive bundle events must be a non-empty array.",
    );
  }
  const batchId = parseId(rawBatch.id);
  parseId(rawBatch.createdBy);
  utcInstant(String(rawBatch.createdAt ?? ""), "batch.createdAt");
  parseReason(rawBatch.reason);
  const firstSequence = Number(rawBatch.firstSequence);
  const lastSequence = Number(rawBatch.lastSequence);
  const eventCount = Number(rawBatch.eventCount);
  const retentionCutoffAt = utcInstant(
    String(rawBatch.retentionCutoffAt ?? ""),
    "batch.retentionCutoffAt",
  );
  const previousBatchDigest =
    rawBatch.previousBatchDigest === null
      ? null
      : typeof rawBatch.previousBatchDigest === "string"
        ? rawBatch.previousBatchDigest
        : "";
  if (
    previousBatchDigest !== null &&
    !sha256Pattern.test(previousBatchDigest)
  ) {
    fail(
      409,
      "InvalidArchiveMetadata",
      "batch.previousBatchDigest must be a 64-character hex SHA-256 or null.",
    );
  }
  if (
    typeof rawBatch.batchDigestSha256 !== "string" ||
    !sha256Pattern.test(rawBatch.batchDigestSha256)
  ) {
    fail(
      409,
      "InvalidArchiveMetadata",
      "batch.batchDigestSha256 must be a 64-character hex SHA-256.",
    );
  }

  const recordDigests: string[] = [];
  let prevSeq: number | null = null;
  for (let i = 0; i < top.events.length; i++) {
    const item = object(top.events[i], [
      "id",
      "batchId",
      "sequence",
      "actorId",
      "eventType",
      "targetType",
      "targetId",
      "occurredAt",
      "minimumRetainedUntil",
      "outcome",
      "securityIncident",
      "incidentStatus",
      "reason",
      "beforeState",
      "afterState",
      "archivedAt",
      "recordSha256",
    ]);
    if (item.batchId !== batchId) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        `events[${i}].batchId does not match batch.id.`,
      );
    }
    utcInstant(String(item.archivedAt ?? ""), `events[${i}].archivedAt`);
    const seq = Number(item.sequence);
    if (!Number.isInteger(seq) || seq < firstSequence || seq > lastSequence) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        `events[${i}].sequence (${String(item.sequence)}) is outside batch bounds [${firstSequence}, ${lastSequence}].`,
      );
    }
    if (prevSeq !== null && seq <= prevSeq) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        `events[${i}].sequence (${seq}) is not strictly increasing.`,
      );
    }
    prevSeq = seq;
    const expectedRecordDigest = computeArchivedEventDigest({
      sequence: seq,
      id: String(item.id ?? ""),
      actorId: item.actorId === null ? null : String(item.actorId ?? ""),
      eventType: String(item.eventType ?? ""),
      targetType: String(item.targetType ?? ""),
      targetId: String(item.targetId ?? ""),
      occurredAt: String(item.occurredAt ?? ""),
      minimumRetainedUntil: String(item.minimumRetainedUntil ?? ""),
      outcome: String(item.outcome ?? "") as "SUCCESS" | "DENIED" | "FAILED",
      securityIncident: item.securityIncident as boolean,
      incidentStatus: item.incidentStatus as AuditIncidentStatus,
      reason: item.reason === null ? null : String(item.reason ?? ""),
      beforeState: (item.beforeState as Record<string, unknown> | null) ?? null,
      afterState: (item.afterState as Record<string, unknown> | null) ?? null,
    });
    if (item.recordSha256 !== expectedRecordDigest) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        `events[${i}] (${String(item.id)}) recordSha256 mismatch.`,
      );
    }
    recordDigests.push(expectedRecordDigest);
  }

  if (
    top.events.length !== eventCount ||
    Number((top.events[0] as Record<string, unknown>).sequence) !==
      firstSequence ||
    Number(
      (top.events[top.events.length - 1] as Record<string, unknown>).sequence,
    ) !== lastSequence
  ) {
    fail(
      409,
      "ArchiveIntegrityViolation",
      "Archive bundle event sequences or count do not match batch header.",
    );
  }

  const expectedBatchDigest = computeArchiveBatchDigest({
    batchId,
    firstSequence,
    lastSequence,
    eventCount,
    retentionCutoffAt,
    previousBatchDigest,
    recordDigests,
  });
  if (rawBatch.batchDigestSha256 !== expectedBatchDigest) {
    fail(
      409,
      "ArchiveIntegrityViolation",
      "Archive bundle batchDigestSha256 mismatch.",
    );
  }

  return {
    verified: true,
    batchId,
    eventCount,
    firstSequence,
    lastSequence,
    batchDigestSha256: expectedBatchDigest,
  };
}

interface ArchiveBatchRow {
  id: string;
  batch_number: string | number;
  created_by: string;
  created_at: Date;
  reason: string;
  first_sequence: string | number;
  last_sequence: string | number;
  event_count: number;
  retention_cutoff_at: Date;
  previous_batch_digest: string | null;
  batch_digest_sha256: string;
}

interface ArchivedEventRow {
  id: string;
  batch_id: string;
  sequence: string | number;
  actor_id: string | null;
  event_type: string;
  target_type: string;
  target_id: string;
  occurred_at: Date;
  minimum_retained_until: Date;
  outcome: "SUCCESS" | "DENIED" | "FAILED";
  security_incident: boolean;
  incident_status: AuditIncidentStatus;
  reason: string | null;
  before_state: unknown;
  after_state: unknown;
  archived_at: Date;
  record_sha256: string;
}

interface SourceAuditRow {
  sequence: string | number;
  id: string;
  actor_id: string | null;
  event_type: string;
  target_type: string;
  target_id: string;
  occurred_at: Date;
  minimum_retained_until: Date;
  outcome: "SUCCESS" | "DENIED" | "FAILED";
  security_incident: boolean | null;
  incident_status: string | null;
  reason: string | null;
  before_state: unknown;
  after_state: unknown;
}

function mapBatchRow(row: ArchiveBatchRow): ArchiveBatchSummary {
  return {
    id: row.id,
    batchNumber: Number(row.batch_number),
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    reason: row.reason,
    firstSequence: Number(row.first_sequence),
    lastSequence: Number(row.last_sequence),
    eventCount: Number(row.event_count),
    retentionCutoffAt: row.retention_cutoff_at.toISOString(),
    previousBatchDigest: row.previous_batch_digest,
    batchDigestSha256: row.batch_digest_sha256,
  };
}

function mapArchivedEventRow(row: ArchivedEventRow): ArchivedAuditEventRecord {
  return {
    id: row.id,
    batchId: row.batch_id,
    sequence: Number(row.sequence),
    actorId: row.actor_id,
    eventType: row.event_type,
    targetType: row.target_type,
    targetId: row.target_id,
    occurredAt: row.occurred_at.toISOString(),
    minimumRetainedUntil: row.minimum_retained_until.toISOString(),
    outcome: row.outcome,
    securityIncident: row.security_incident,
    incidentStatus: row.incident_status,
    reason: row.reason,
    beforeState: auditState(row.before_state),
    afterState: auditState(row.after_state),
    archivedAt: row.archived_at.toISOString(),
    recordSha256: row.record_sha256,
  };
}

async function verifyArchiveLedgerInternal(
  tx: PoolClient,
  filterBatchId?: string,
): Promise<{
  verified: true;
  batchCount: number;
  verifiedEventCount: number;
  latestBatchId: string | null;
  latestBatchDigestSha256: string | null;
  lastArchivedSequence: number | null;
}> {
  const batchesRes = await tx.query<ArchiveBatchRow>(
    `SELECT id, batch_number, created_by, created_at, reason,
            first_sequence, last_sequence, event_count, retention_cutoff_at,
            previous_batch_digest, batch_digest_sha256
     FROM owner_audit_archive.archive_batches
     ORDER BY batch_number ASC`,
  );
  if (filterBatchId !== undefined) {
    const exists = batchesRes.rows.some((b) => b.id === filterBatchId);
    if (!exists) {
      fail(404, "EntityNotFound", "Archive batch was not found.");
    }
  }

  let prevDigest: string | null = null;
  let prevLastSeq = 0;
  let totalVerifiedEvents = 0;

  for (const batchRow of batchesRes.rows) {
    const batch = mapBatchRow(batchRow);
    if (batch.previousBatchDigest !== prevDigest) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        `Archive batch ${batch.id} previousBatchDigest mismatch.`,
      );
    }
    if (batch.firstSequence <= prevLastSeq) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        `Archive batch ${batch.id} firstSequence (${batch.firstSequence}) overlaps prior batch lastSequence (${prevLastSeq}).`,
      );
    }

    const eventsRes = await tx.query<ArchivedEventRow>(
      `SELECT id, batch_id, sequence, actor_id, event_type, target_type, target_id,
              occurred_at, minimum_retained_until, outcome, security_incident,
              incident_status, reason, before_state, after_state, archived_at, record_sha256
       FROM owner_audit_archive.archived_audit_events
       WHERE batch_id = $1
       ORDER BY sequence ASC`,
      [batch.id],
    );
    const events = eventsRes.rows.map(mapArchivedEventRow);
    verifyExportedArchiveBundle({ batch, events });

    const sourceRes = await tx.query<SourceAuditRow>(
      `SELECT sequence, id, actor_id, event_type, target_type, target_id,
              occurred_at, minimum_retained_until, outcome,
              COALESCE(security_incident, owner.is_security_incident_event(event_type, outcome)) AS security_incident,
              COALESCE(
                incident_status,
                CASE
                  WHEN COALESCE(security_incident, owner.is_security_incident_event(event_type, outcome))
                  THEN 'UNRESOLVED'
                  ELSE 'NONE'
                END
              ) AS incident_status,
              reason, before_state, after_state
       FROM owner.audit_events
       WHERE sequence BETWEEN $1 AND $2
       ORDER BY sequence ASC`,
      [batch.firstSequence, batch.lastSequence],
    );

    if (sourceRes.rows.length !== events.length) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        `Archive batch ${batch.id} event count (${events.length}) does not match source sequence range count (${sourceRes.rows.length}).`,
      );
    }

    for (let i = 0; i < events.length; i++) {
      const archivedEvent = events[i]!;
      const src = sourceRes.rows[i]!;
      const srcDigest = computeArchivedEventDigest({
        sequence: Number(src.sequence),
        id: src.id,
        actorId: src.actor_id,
        eventType: src.event_type,
        targetType: src.target_type,
        targetId: src.target_id,
        occurredAt: src.occurred_at.toISOString(),
        minimumRetainedUntil: src.minimum_retained_until.toISOString(),
        outcome: src.outcome,
        securityIncident: Boolean(src.security_incident),
        incidentStatus: (src.incident_status ?? "NONE") as AuditIncidentStatus,
        reason: src.reason,
        beforeState: auditState(src.before_state),
        afterState: auditState(src.after_state),
      });
      if (archivedEvent.recordSha256 !== srcDigest) {
        fail(
          409,
          "ArchiveIntegrityViolation",
          `Archived event ${archivedEvent.id} digest does not match source owner.audit_events record.`,
        );
      }
    }

    prevDigest = batch.batchDigestSha256;
    prevLastSeq = batch.lastSequence;
    totalVerifiedEvents += events.length;
  }

  const latest = batchesRes.rows.at(-1);
  return {
    verified: true,
    batchCount: batchesRes.rows.length,
    verifiedEventCount: totalVerifiedEvents,
    latestBatchId: latest ? latest.id : null,
    latestBatchDigestSha256: latest ? latest.batch_digest_sha256 : null,
    lastArchivedSequence: latest ? Number(latest.last_sequence) : null,
  };
}

function assertArchiveActor(actor: AuthorizedActorRow) {
  assertActiveAuthorizedActor(
    actor as Pick<User, "id" | "role" | "is_active" | "must_change_password">,
    "audit.archive",
  );
}

export async function getAuditArchiveStatus(
  tx: PoolClient,
  actor: AuthorizedActorRow,
  rawQuery: Record<string, unknown> = {},
): Promise<AuditArchiveStatusReport> {
  assertArchiveActor(actor);
  const q = object(rawQuery, ["asOf"]);
  const asOfIso =
    q.asOf !== undefined && q.asOf !== ""
      ? utcInstant(String(q.asOf), "asOf")
      : new Date().toISOString();

  const integrity = await verifyArchiveLedgerInternal(tx);

  const statsRes = await tx.query<{
    total_source_events: string;
    within_minimum_window_count: string;
    past_minimum_floor_count: string;
    unresolved_incident_count: string;
    past_floor_incident_hold_count: string;
    archived_event_count: string;
    unarchived_eligible_count: string;
  }>(
    `SELECT
       COUNT(*)::text AS total_source_events,
       COUNT(*) FILTER (WHERE minimum_retained_until > $1::timestamptz)::text AS within_minimum_window_count,
       COUNT(*) FILTER (WHERE minimum_retained_until <= $1::timestamptz)::text AS past_minimum_floor_count,
       COUNT(*) FILTER (
         WHERE COALESCE(security_incident, owner.is_security_incident_event(event_type, outcome)) = TRUE
       )::text AS unresolved_incident_count,
       COUNT(*) FILTER (
         WHERE minimum_retained_until <= $1::timestamptz
           AND COALESCE(security_incident, owner.is_security_incident_event(event_type, outcome)) = TRUE
       )::text AS past_floor_incident_hold_count,
       (SELECT COUNT(*)::text FROM owner_audit_archive.archived_audit_events) AS archived_event_count,
       COUNT(*) FILTER (
         WHERE event_type NOT IN ('AUDIT_ARCHIVE_BATCH_CREATED', 'AUDIT_ARCHIVE_VERIFIED')
           AND NOT EXISTS (
             SELECT 1 FROM owner_audit_archive.archived_audit_events a WHERE a.id = owner.audit_events.id
           )
       )::text AS unarchived_eligible_count
     FROM owner.audit_events`,
    [asOfIso],
  );
  const row = statsRes.rows[0]!;

  return {
    asOf: asOfIso,
    policy: canonicalAuditRetentionPolicy,
    counts: {
      totalSourceEvents: Number(row.total_source_events),
      withinMinimumRetentionWindowCount: Number(
        row.within_minimum_window_count,
      ),
      pastMinimumRetentionFloorCount: Number(row.past_minimum_floor_count),
      unresolvedSecurityIncidentCount: Number(row.unresolved_incident_count),
      pastFloorUnresolvedIncidentHoldCount: Number(
        row.past_floor_incident_hold_count,
      ),
      archivedEventCount: Number(row.archived_event_count),
      unarchivedEligibleEventCount: Number(row.unarchived_eligible_count),
      archiveBatchCount: integrity.batchCount,
      cleanupEligibleEventCount: 0,
    },
    integrity: {
      verified: integrity.verified,
      latestBatchId: integrity.latestBatchId,
      latestBatchDigestSha256: integrity.latestBatchDigestSha256,
      lastArchivedSequence: integrity.lastArchivedSequence,
    },
  };
}

export async function listAuditArchiveBatches(
  tx: PoolClient,
  actor: AuthorizedActorRow,
  rawQuery: Record<string, unknown> = {},
) {
  assertArchiveActor(actor);
  const q = object(rawQuery, ["page"]);
  const p = parsePage(q.page);
  const pageSize = 50;
  const rows = await tx.query<ArchiveBatchRow>(
    `SELECT id, batch_number, created_by, created_at, reason,
            first_sequence, last_sequence, event_count, retention_cutoff_at,
            previous_batch_digest, batch_digest_sha256
     FROM owner_audit_archive.archive_batches
     ORDER BY batch_number DESC
     LIMIT $1 OFFSET $2`,
    [pageSize + 1, (p - 1) * pageSize],
  );
  return {
    items: rows.rows.slice(0, pageSize).map(mapBatchRow),
    page: p,
    pageSize,
    hasNext: rows.rows.length > pageSize,
  };
}

export async function getAuditArchiveBatch(
  tx: PoolClient,
  actor: AuthorizedActorRow,
  rawBatchId: unknown,
): Promise<AuditArchiveBundle> {
  assertArchiveActor(actor);
  const batchId = parseId(rawBatchId);
  await verifyArchiveLedgerInternal(tx, batchId);

  const batchRes = await tx.query<ArchiveBatchRow>(
    `SELECT id, batch_number, created_by, created_at, reason,
            first_sequence, last_sequence, event_count, retention_cutoff_at,
            previous_batch_digest, batch_digest_sha256
     FROM owner_audit_archive.archive_batches
     WHERE id = $1`,
    [batchId],
  );
  if (!batchRes.rowCount) {
    fail(404, "EntityNotFound", "Archive batch was not found.");
  }
  const eventsRes = await tx.query<ArchivedEventRow>(
    `SELECT id, batch_id, sequence, actor_id, event_type, target_type, target_id,
            occurred_at, minimum_retained_until, outcome, security_incident,
            incident_status, reason, before_state, after_state, archived_at, record_sha256
     FROM owner_audit_archive.archived_audit_events
     WHERE batch_id = $1
     ORDER BY sequence ASC`,
    [batchId],
  );
  const bundle: AuditArchiveBundle = {
    batch: mapBatchRow(batchRes.rows[0]!),
    events: eventsRes.rows.map(mapArchivedEventRow),
  };
  verifyExportedArchiveBundle(bundle);
  return bundle;
}

export interface CreateAuditArchiveBatchOptions {
  /** Test-only hook invoked after archive inserts and before transaction completion to test rollback. */
  afterInsertHook?: (tx: PoolClient) => Promise<void> | void;
}

export async function createAuditArchiveBatch(
  tx: PoolClient,
  actor: AuthorizedActorRow,
  rawBody: unknown,
  options?: CreateAuditArchiveBatchOptions,
): Promise<{
  status: "ARCHIVED" | "NO_ELIGIBLE_EVENTS";
  archivedCount: number;
  batch: ArchiveBatchSummary | null;
}> {
  assertArchiveActor(actor);
  const body = object(rawBody, ["reason", "maxEvents", "upToOccurredAt"]);
  const archiveReason = parseReason(body.reason);
  let maxEvents = 200;
  if (body.maxEvents !== undefined) {
    const parsed = Number(body.maxEvents);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
      invalid("maxEvents must be an integer between 1 and 500.");
    }
    maxEvents = parsed;
  }
  const upToOccurredAt =
    body.upToOccurredAt !== undefined
      ? utcInstant(String(body.upToOccurredAt), "upToOccurredAt")
      : null;

  await tx.query(
    "LOCK TABLE owner_audit_archive.archive_batches IN EXCLUSIVE MODE",
  );

  // Verify existing archive chain before appending a new batch.
  const integrity = await verifyArchiveLedgerInternal(tx);
  const lastArchivedSeq = integrity.lastArchivedSequence ?? 0;

  // Check if any non-meta unarchived events exist in the requested window.
  const eligibleNonMetaRes = await tx.query<{ max_seq: string | null }>(
    `SELECT MAX(sequence)::text AS max_seq
     FROM owner.audit_events
     WHERE sequence > $1
       AND event_type NOT IN ('AUDIT_ARCHIVE_BATCH_CREATED', 'AUDIT_ARCHIVE_VERIFIED')
       AND ($2::timestamptz IS NULL OR occurred_at <= $2::timestamptz)`,
    [lastArchivedSeq, upToOccurredAt],
  );

  const maxEligibleNonMetaSeq = eligibleNonMetaRes.rows[0]?.max_seq
    ? Number(eligibleNonMetaRes.rows[0].max_seq)
    : null;

  if (maxEligibleNonMetaSeq === null) {
    return {
      status: "NO_ELIGIBLE_EVENTS",
      archivedCount: 0,
      batch: null,
    };
  }

  // Snapshot upper sequence bound before writing the batch audit row so this run
  // never recursively archives its own AUDIT_ARCHIVE_BATCH_CREATED event.
  const highWaterRes = await tx.query<{ max_seq: string }>(
    `SELECT COALESCE(MAX(sequence), 0)::text AS max_seq
     FROM owner.audit_events
     WHERE sequence > $1
       AND ($2::timestamptz IS NULL OR sequence <= $3)`,
    [lastArchivedSeq, upToOccurredAt, maxEligibleNonMetaSeq],
  );
  const snapshotUpperSequence = Number(highWaterRes.rows[0]!.max_seq);

  const candidatesRes = await tx.query<SourceAuditRow>(
    `SELECT sequence, id, actor_id, event_type, target_type, target_id,
            occurred_at, minimum_retained_until, outcome,
            COALESCE(security_incident, owner.is_security_incident_event(event_type, outcome)) AS security_incident,
            COALESCE(
              incident_status,
              CASE
                WHEN COALESCE(security_incident, owner.is_security_incident_event(event_type, outcome))
                THEN 'UNRESOLVED'
                ELSE 'NONE'
              END
            ) AS incident_status,
            reason, before_state, after_state
     FROM owner.audit_events
     WHERE sequence > $1 AND sequence <= $2
     ORDER BY sequence ASC
     LIMIT $3`,
    [lastArchivedSeq, snapshotUpperSequence, maxEvents],
  );

  const rows = candidatesRes.rows;
  const hasNonMetaInSlice = rows.some(
    (r) => !(archiveMetaEventTypes as readonly string[]).includes(r.event_type),
  );
  if (rows.length === 0 || !hasNonMetaInSlice) {
    return {
      status: "NO_ELIGIBLE_EVENTS",
      archivedCount: 0,
      batch: null,
    };
  }

  const batchId = ulid();
  const firstSequence = Number(rows[0]!.sequence);
  const lastSequence = Number(rows[rows.length - 1]!.sequence);
  const retentionCutoffAt = rows[rows.length - 1]!.occurred_at.toISOString();

  const preparedEvents: {
    payload: CanonicalArchiveEventPayload;
    recordSha256: string;
  }[] = rows.map((r) => {
    const payload: CanonicalArchiveEventPayload = {
      sequence: Number(r.sequence),
      id: r.id,
      actorId: r.actor_id,
      eventType: r.event_type,
      targetType: r.target_type,
      targetId: r.target_id,
      occurredAt: r.occurred_at.toISOString(),
      minimumRetainedUntil: r.minimum_retained_until.toISOString(),
      outcome: r.outcome,
      securityIncident: Boolean(r.security_incident),
      incidentStatus: (r.incident_status ?? "NONE") as AuditIncidentStatus,
      reason: r.reason,
      beforeState: auditState(r.before_state),
      afterState: auditState(r.after_state),
    };
    return {
      payload,
      recordSha256: computeArchivedEventDigest(payload),
    };
  });

  const batchDigestSha256 = computeArchiveBatchDigest({
    batchId,
    firstSequence,
    lastSequence,
    eventCount: preparedEvents.length,
    retentionCutoffAt,
    previousBatchDigest: integrity.latestBatchDigestSha256,
    recordDigests: preparedEvents.map((e) => e.recordSha256),
  });

  const insertedBatchRes = await tx.query<ArchiveBatchRow>(
    `INSERT INTO owner_audit_archive.archive_batches (
       id, created_by, reason, first_sequence, last_sequence, event_count,
       retention_cutoff_at, previous_batch_digest, batch_digest_sha256
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9)
     RETURNING id, batch_number, created_by, created_at, reason,
               first_sequence, last_sequence, event_count, retention_cutoff_at,
               previous_batch_digest, batch_digest_sha256`,
    [
      batchId,
      actor.id,
      archiveReason,
      firstSequence,
      lastSequence,
      preparedEvents.length,
      retentionCutoffAt,
      integrity.latestBatchDigestSha256,
      batchDigestSha256,
    ],
  );

  for (const item of preparedEvents) {
    const p = item.payload;
    await tx.query(
      `INSERT INTO owner_audit_archive.archived_audit_events (
         id, batch_id, sequence, actor_id, event_type, target_type, target_id,
         occurred_at, minimum_retained_until, outcome, security_incident,
         incident_status, reason, before_state, after_state, record_sha256
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8::timestamptz, $9::timestamptz, $10, $11,
         $12, $13, $14, $15, $16
       )`,
      [
        p.id,
        batchId,
        p.sequence,
        p.actorId,
        p.eventType,
        p.targetType,
        p.targetId,
        p.occurredAt,
        p.minimumRetainedUntil,
        p.outcome,
        p.securityIncident,
        p.incidentStatus,
        p.reason,
        p.beforeState ? JSON.stringify(p.beforeState) : null,
        p.afterState ? JSON.stringify(p.afterState) : null,
        item.recordSha256,
      ],
    );
  }

  if (options?.afterInsertHook) {
    await options.afterInsertHook(tx);
  }

  const batchSummary = mapBatchRow(insertedBatchRes.rows[0]!);

  await audit(tx, {
    actor: actor.id,
    type: "AUDIT_ARCHIVE_BATCH_CREATED",
    targetType: "AuditArchiveBatch",
    targetId: batchSummary.id,
    reason: archiveReason,
    after: {
      archiveBatchId: batchSummary.id,
      archivedCount: batchSummary.eventCount,
      firstSequence: batchSummary.firstSequence,
      lastSequence: batchSummary.lastSequence,
      batchDigestSha256: batchSummary.batchDigestSha256,
      archiveVerified: true,
    },
  });

  return {
    status: "ARCHIVED",
    archivedCount: batchSummary.eventCount,
    batch: batchSummary,
  };
}

export async function verifyAuditArchiveIntegrity(
  tx: PoolClient,
  actor: AuthorizedActorRow,
  rawBody: unknown,
) {
  assertArchiveActor(actor);
  const body = object(rawBody, ["reason", "batchId"]);
  const verifyReason = parseReason(body.reason);
  const filterBatchId =
    body.batchId !== undefined ? parseId(body.batchId) : undefined;

  const result = await verifyArchiveLedgerInternal(tx, filterBatchId);
  const targetId =
    filterBatchId ?? result.latestBatchId ?? "01ARZ3NDEKTSV4RRFFQ69G5FAV";

  await audit(tx, {
    actor: actor.id,
    type: "AUDIT_ARCHIVE_VERIFIED",
    targetType: "AuditArchiveBatch",
    targetId,
    reason: verifyReason,
    after: {
      ...(result.latestBatchId ? { archiveBatchId: result.latestBatchId } : {}),
      archivedCount: result.verifiedEventCount,
      ...(result.latestBatchDigestSha256
        ? { batchDigestSha256: result.latestBatchDigestSha256 }
        : {}),
      archiveVerified: true,
    },
  });

  return result;
}
