import {
  chmod,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { ulid } from "ulid";
import { audit } from "./db.js";
import {
  ApiError,
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
  "AUDIT_ARCHIVE_RECOVERED",
] as const;

const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const durableFileNamePattern = /^batch-[0-9]{6,}-[0-9A-HJKMNP-TV-Z]{26}\.json$/;
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
  targetId: string | null;
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
  targetId: string | null;
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
  durableFileName: string;
  bundleDigestSha256: string;
}

export interface ArchivedAuditEventRecord extends CanonicalArchiveEventPayload {
  batchId: string;
  archivedAt: string;
  recordSha256: string;
}

export interface AuditArchiveBundle {
  batch: ArchiveBatchSummary;
  events: ArchivedAuditEventRecord[];
  durableStorage?: {
    persisted: true;
    fileName: string;
    bundleDigestSha256: string;
    verified: true;
    presentInDbLedger: boolean;
  };
}

export interface DurableArchiveManifestEntry {
  id: string;
  batchNumber: number;
  fileName: string;
  firstSequence: number;
  lastSequence: number;
  eventCount: number;
  retentionCutoffAt: string;
  previousBatchDigest: string | null;
  batchDigestSha256: string;
  bundleDigestSha256: string;
}

export interface DurableArchiveManifest {
  format: "vardena-owner-audit-archive-manifest";
  formatVersion: 1;
  updatedAt: string;
  latestBatchId: string | null;
  latestBatchNumber: number;
  latestBatchDigestSha256: string | null;
  lastArchivedSequence: number | null;
  batches: DurableArchiveManifestEntry[];
  manifestDigestSha256: string;
}

export interface DurableArchiveBundleFile {
  format: "vardena-owner-audit-archive-bundle";
  formatVersion: 1;
  durableFileName: string;
  bundleDigestSha256: string;
  batch: ArchiveBatchSummary;
  events: ArchivedAuditEventRecord[];
}

export interface AuditArchiveStore {
  readonly rootDir: string;
  verifyStore(): Promise<{
    verified: true;
    manifest: DurableArchiveManifest;
    bundles: DurableArchiveBundleFile[];
  }>;
  persistBatch(bundle: {
    batch: ArchiveBatchSummary;
    events: ArchivedAuditEventRecord[];
  }): Promise<{
    entry: DurableArchiveManifestEntry;
    rollback: () => Promise<void>;
  }>;
}

export interface AuditRetentionPolicyContract {
  appendOnly: true;
  minimumRetentionYears: 3;
  threeYearMinimumIsPurgeDate: false;
  unresolvedSecurityIncidentsExcludedFromCleanup: true;
  permanentSeparateArchiveInForce: true;
  automaticDestructivePurgeEnabled: false;
  archiveStorageBoundary: "INDEPENDENT_DURABLE_FILESYSTEM_STORE_AND_POSTGRES_LEDGER";
  cryptographicHardwareWormImplemented: false;
}

export const canonicalAuditRetentionPolicy: AuditRetentionPolicyContract = {
  appendOnly: true,
  minimumRetentionYears: 3,
  threeYearMinimumIsPurgeDate: false,
  unresolvedSecurityIncidentsExcludedFromCleanup: true,
  permanentSeparateArchiveInForce: true,
  automaticDestructivePurgeEnabled: false,
  archiveStorageBoundary:
    "INDEPENDENT_DURABLE_FILESYSTEM_STORE_AND_POSTGRES_LEDGER",
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
    durableStoreBatchCount: number;
    durableStoreEventCount: number;
    cleanupEligibleEventCount: 0;
  };
  integrity: {
    verified: boolean;
    durableStoreConfigured: boolean;
    durableStoreVerified: boolean;
    dbLedgerVerified: boolean;
    crossStoreConsistent: boolean;
    recoveryRequired: boolean;
    issueCode: string | null;
    issueMessage: string | null;
    latestBatchId: string | null;
    latestBatchDigestSha256: string | null;
    latestBundleDigestSha256: string | null;
    lastArchivedSequence: number | null;
  };
}

export interface AuditArchiveRecoveryResult {
  verified: true;
  recoveredBatchCount: number;
  recoveredSourceEventCount: number;
  recoveredLedgerEventCount: number;
  rehydratedDurableBatchCount: number;
  batchCount: number;
  verifiedEventCount: number;
  latestBatchId: string | null;
  latestBatchDigestSha256: string | null;
  latestBundleDigestSha256: string | null;
  lastArchivedSequence: number | null;
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

export function formatDurableBatchFileName(
  batchNumber: number,
  batchId: string,
): string {
  if (!Number.isInteger(batchNumber) || batchNumber < 1) {
    invalid("batchNumber must be a positive integer.");
  }
  if (!ulidPattern.test(batchId)) {
    invalid("batchId must be a 26-character ULID.");
  }
  return `batch-${String(batchNumber).padStart(6, "0")}-${batchId}.json`;
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
    payload.targetId !== null &&
    (typeof payload.targetId !== "string" ||
      payload.targetId.trim().length === 0)
  ) {
    invalid("Archived event targetId must be a non-empty string or null.");
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
    invalid("lastSequence must be >= firstSequence.");
  }
  if (
    !Number.isInteger(input.eventCount) ||
    input.eventCount < 1 ||
    input.eventCount !== input.recordDigests.length
  ) {
    fail(
      409,
      "InvalidArchiveMetadata",
      "Archive batch eventCount must be a positive integer matching recordDigests.length.",
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

export function computeManifestDigest(
  entries: readonly DurableArchiveManifestEntry[],
): string {
  return digest(
    canonicalJson({
      format: "vardena-owner-audit-archive-manifest",
      formatVersion: 1,
      batches: entries.map((e) => ({
        id: e.id,
        batchNumber: e.batchNumber,
        fileName: e.fileName,
        firstSequence: e.firstSequence,
        lastSequence: e.lastSequence,
        eventCount: e.eventCount,
        retentionCutoffAt: e.retentionCutoffAt,
        previousBatchDigest: e.previousBatchDigest,
        batchDigestSha256: e.batchDigestSha256,
        bundleDigestSha256: e.bundleDigestSha256,
      })),
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
  batchNumber: number;
  eventCount: number;
  firstSequence: number;
  lastSequence: number;
  batchDigestSha256: string;
  bundleDigestSha256: string;
  durableFileName: string;
} {
  const top = object(rawBundle, [
    "batch",
    "events",
    "format",
    "formatVersion",
    "durableFileName",
    "bundleDigestSha256",
    "durableStorage",
  ]);
  if (
    top.format !== undefined &&
    top.format !== "vardena-owner-audit-archive-bundle"
  ) {
    fail(
      409,
      "ArchiveIntegrityViolation",
      "Invalid archive bundle format identifier.",
    );
  }
  if (top.formatVersion !== undefined && top.formatVersion !== 1) {
    fail(
      409,
      "ArchiveIntegrityViolation",
      "Unsupported archive bundle formatVersion.",
    );
  }
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
    "durableFileName",
    "bundleDigestSha256",
  ]);
  if (!Array.isArray(top.events) || top.events.length === 0) {
    fail(
      409,
      "InvalidArchiveMetadata",
      "Archive bundle events must be a non-empty array.",
    );
  }
  const batchId = parseId(rawBatch.id);
  const batchNumber = Number(rawBatch.batchNumber);
  if (!Number.isInteger(batchNumber) || batchNumber < 1) {
    fail(
      409,
      "InvalidArchiveMetadata",
      "batch.batchNumber must be a positive integer.",
    );
  }
  const createdBy = parseId(rawBatch.createdBy);
  const createdAt = utcInstant(
    String(rawBatch.createdAt ?? ""),
    "batch.createdAt",
  );
  const reason = parseReason(rawBatch.reason);
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
  const expectedFileName = formatDurableBatchFileName(batchNumber, batchId);
  if (
    rawBatch.durableFileName !== undefined &&
    rawBatch.durableFileName !== expectedFileName
  ) {
    fail(
      409,
      "ArchiveIntegrityViolation",
      `batch.durableFileName (${String(rawBatch.durableFileName)}) does not match expected ${expectedFileName}.`,
    );
  }
  if (
    top.durableFileName !== undefined &&
    top.durableFileName !== expectedFileName
  ) {
    fail(
      409,
      "ArchiveIntegrityViolation",
      `bundle.durableFileName (${String(top.durableFileName)}) does not match expected ${expectedFileName}.`,
    );
  }

  const recordDigests: string[] = [];
  const canonicalEvents: Record<string, unknown>[] = [];
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
    const archivedAt = utcInstant(
      String(item.archivedAt ?? ""),
      `events[${i}].archivedAt`,
    );
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
    const occurredAt = utcInstant(
      String(item.occurredAt ?? ""),
      `events[${i}].occurredAt`,
    );
    const minimumRetainedUntil = utcInstant(
      String(item.minimumRetainedUntil ?? ""),
      `events[${i}].minimumRetainedUntil`,
    );
    const actorId = item.actorId === null ? null : String(item.actorId ?? "");
    const eventType = String(item.eventType ?? "");
    const targetType = String(item.targetType ?? "");
    const targetId =
      item.targetId === null ? null : String(item.targetId ?? "");
    const outcome = String(item.outcome ?? "") as
      "SUCCESS" | "DENIED" | "FAILED";
    const securityIncident = item.securityIncident as boolean;
    const incidentStatus = item.incidentStatus as AuditIncidentStatus;
    const itemReason = item.reason === null ? null : String(item.reason ?? "");
    const beforeState =
      (item.beforeState as Record<string, unknown> | null) ?? null;
    const afterState =
      (item.afterState as Record<string, unknown> | null) ?? null;

    const expectedRecordDigest = computeArchivedEventDigest({
      sequence: seq,
      id: String(item.id ?? ""),
      actorId,
      eventType,
      targetType,
      targetId,
      occurredAt,
      minimumRetainedUntil,
      outcome,
      securityIncident,
      incidentStatus,
      reason: itemReason,
      beforeState,
      afterState,
    });
    if (item.recordSha256 !== expectedRecordDigest) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        `events[${i}] (${String(item.id)}) recordSha256 mismatch.`,
      );
    }
    recordDigests.push(expectedRecordDigest);
    canonicalEvents.push({
      id: String(item.id ?? ""),
      batchId,
      sequence: seq,
      actorId,
      eventType,
      targetType,
      targetId,
      occurredAt,
      minimumRetainedUntil,
      outcome,
      securityIncident,
      incidentStatus,
      reason: itemReason,
      beforeState,
      afterState,
      archivedAt,
      recordSha256: expectedRecordDigest,
    });
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

  const expectedBundleDigest = digest(
    canonicalJson({
      format: "vardena-owner-audit-archive-bundle",
      formatVersion: 1,
      batch: {
        id: batchId,
        batchNumber,
        createdBy,
        createdAt,
        reason,
        firstSequence,
        lastSequence,
        eventCount,
        retentionCutoffAt,
        previousBatchDigest,
        batchDigestSha256: expectedBatchDigest,
      },
      events: canonicalEvents,
    }),
  );

  if (
    rawBatch.bundleDigestSha256 !== undefined &&
    rawBatch.bundleDigestSha256 !== expectedBundleDigest
  ) {
    fail(
      409,
      "ArchiveIntegrityViolation",
      "Archive batch bundleDigestSha256 mismatch.",
    );
  }
  if (
    top.bundleDigestSha256 !== undefined &&
    top.bundleDigestSha256 !== expectedBundleDigest
  ) {
    fail(
      409,
      "ArchiveIntegrityViolation",
      "Archive bundle bundleDigestSha256 mismatch.",
    );
  }

  return {
    verified: true,
    batchId,
    batchNumber,
    eventCount,
    firstSequence,
    lastSequence,
    batchDigestSha256: expectedBatchDigest,
    bundleDigestSha256: expectedBundleDigest,
    durableFileName: expectedFileName,
  };
}

export function computeArchiveBundleDigest(bundle: {
  batch: Omit<ArchiveBatchSummary, "durableFileName" | "bundleDigestSha256"> & {
    durableFileName?: string;
    bundleDigestSha256?: string;
  };
  events: readonly ArchivedAuditEventRecord[];
}): string {
  return verifyExportedArchiveBundle(bundle).bundleDigestSha256;
}

export class FilesystemAuditArchiveStore implements AuditArchiveStore {
  public readonly rootDir: string;
  private readonly batchesDir: string;
  private readonly manifestPath: string;

  constructor(rootDir: string) {
    if (
      typeof rootDir !== "string" ||
      rootDir.trim().length === 0 ||
      rootDir.includes("\0") ||
      !path.isAbsolute(rootDir.trim())
    ) {
      throw new Error(
        "FilesystemAuditArchiveStore requires an absolute directory path.",
      );
    }
    const resolved = path.resolve(rootDir.trim());
    if (resolved === path.parse(resolved).root) {
      throw new Error(
        "FilesystemAuditArchiveStore rootDir must not be the filesystem root.",
      );
    }
    this.rootDir = resolved;
    this.batchesDir = path.join(this.rootDir, "batches");
    this.manifestPath = path.join(this.rootDir, "manifest.json");
  }

  private async syncDirectory(dirPath: string): Promise<void> {
    let dirHandle;
    try {
      dirHandle = await open(dirPath, "r");
      await dirHandle.sync();
    } catch {
      // Directory fsync may return EINVAL on some virtual filesystems; file fsync is always enforced.
    } finally {
      if (dirHandle) await dirHandle.close();
    }
  }

  private async writeAtomicFsync(
    targetPath: string,
    content: string,
    options: { exclusive: boolean; mode?: number },
  ): Promise<void> {
    const parentDir = path.dirname(targetPath);
    await mkdir(parentDir, { recursive: true });
    const tmpPath = path.join(
      parentDir,
      `.tmp-${path.basename(targetPath)}-${process.pid}-${ulid()}`,
    );
    let fh;
    try {
      fh = await open(tmpPath, "wx", 0o600);
      await fh.writeFile(Buffer.from(content, "utf8"));
      await fh.sync();
      await fh.close();
      fh = undefined;
      if (options.mode !== undefined) {
        await chmod(tmpPath, options.mode);
      }
      if (options.exclusive) {
        await link(tmpPath, targetPath);
        await unlink(tmpPath);
      } else {
        await rename(tmpPath, targetPath);
      }
      await this.syncDirectory(parentDir);
    } catch (err) {
      if (fh) {
        try {
          await fh.close();
        } catch {
          // ignore close error
        }
      }
      await rm(tmpPath, { force: true }).catch(() => {});
      const code = (err as { code?: string }).code;
      if (code === "EEXIST") {
        fail(
          409,
          "ArchiveIntegrityViolation",
          `Durable archive file ${path.basename(targetPath)} already exists and is write-once.`,
        );
      }
      fail(
        503,
        "ArchiveStorageUnavailable",
        `Failed to persist durable archive artifact ${path.basename(targetPath)}.`,
      );
    }
  }

  private async fileExists(targetPath: string): Promise<boolean> {
    try {
      const st = await stat(targetPath);
      return st.isFile();
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") return false;
      fail(
        503,
        "ArchiveStorageUnavailable",
        `Durable archive storage path is inaccessible (${path.basename(targetPath)}).`,
      );
    }
  }

  public async verifyStore(): Promise<{
    verified: true;
    manifest: DurableArchiveManifest;
    bundles: DurableArchiveBundleFile[];
  }> {
    let batchFilesOnDisk: string[] = [];
    try {
      const entries = await readdir(this.batchesDir);
      batchFilesOnDisk = entries.filter((f) => !f.startsWith(".")).sort();
    } catch (err) {
      if ((err as { code?: string }).code !== "ENOENT") {
        fail(
          503,
          "ArchiveStorageUnavailable",
          "Failed to read durable archive batches directory.",
        );
      }
    }

    const hasManifest = await this.fileExists(this.manifestPath);
    if (!hasManifest) {
      if (batchFilesOnDisk.length > 0) {
        fail(
          409,
          "ArchiveIntegrityViolation",
          "Durable archive manifest.json is missing while batch files exist on disk.",
        );
      }
      return {
        verified: true,
        manifest: {
          format: "vardena-owner-audit-archive-manifest",
          formatVersion: 1,
          updatedAt: new Date(0).toISOString(),
          latestBatchId: null,
          latestBatchNumber: 0,
          latestBatchDigestSha256: null,
          lastArchivedSequence: null,
          batches: [],
          manifestDigestSha256: computeManifestDigest([]),
        },
        bundles: [],
      };
    }

    let rawManifestText = "";
    let rawManifestObj: Record<string, unknown>;
    try {
      rawManifestText = await readFile(this.manifestPath, "utf8");
      rawManifestObj = object(JSON.parse(rawManifestText), [
        "format",
        "formatVersion",
        "updatedAt",
        "latestBatchId",
        "latestBatchNumber",
        "latestBatchDigestSha256",
        "lastArchivedSequence",
        "batches",
        "manifestDigestSha256",
      ]);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      fail(
        409,
        "ArchiveIntegrityViolation",
        "Durable archive manifest.json is corrupted or unreadable.",
      );
    }

    if (
      rawManifestObj.format !== "vardena-owner-audit-archive-manifest" ||
      rawManifestObj.formatVersion !== 1 ||
      !Array.isArray(rawManifestObj.batches)
    ) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        "Durable archive manifest.json header is invalid.",
      );
    }
    const updatedAt = utcInstant(
      String(rawManifestObj.updatedAt ?? ""),
      "manifest.updatedAt",
    );

    const manifestEntries: DurableArchiveManifestEntry[] = [];
    let prevDigest: string | null = null;
    let prevLastSeq = 0;

    for (let i = 0; i < rawManifestObj.batches.length; i++) {
      let item: Record<string, unknown>;
      try {
        item = object(rawManifestObj.batches[i], [
          "id",
          "batchNumber",
          "fileName",
          "firstSequence",
          "lastSequence",
          "eventCount",
          "retentionCutoffAt",
          "previousBatchDigest",
          "batchDigestSha256",
          "bundleDigestSha256",
        ]);
      } catch {
        fail(
          409,
          "ArchiveIntegrityViolation",
          `Durable archive manifest entry [${i}] is malformed.`,
        );
      }
      const id = String(item.id ?? "");
      const batchNumber = Number(item.batchNumber);
      const fileName = String(item.fileName ?? "");
      const firstSequence = Number(item.firstSequence);
      const lastSequence = Number(item.lastSequence);
      const eventCount = Number(item.eventCount);
      const retentionCutoffAt = utcInstant(
        String(item.retentionCutoffAt ?? ""),
        `manifest.batches[${i}].retentionCutoffAt`,
      );
      const previousBatchDigest =
        item.previousBatchDigest === null
          ? null
          : String(item.previousBatchDigest ?? "");
      const batchDigestSha256 = String(item.batchDigestSha256 ?? "");
      const bundleDigestSha256 = String(item.bundleDigestSha256 ?? "");

      if (
        !ulidPattern.test(id) ||
        batchNumber !== i + 1 ||
        fileName !== formatDurableBatchFileName(batchNumber, id) ||
        !durableFileNamePattern.test(fileName) ||
        !Number.isInteger(firstSequence) ||
        firstSequence <= prevLastSeq ||
        !Number.isInteger(lastSequence) ||
        lastSequence < firstSequence ||
        !Number.isInteger(eventCount) ||
        eventCount < 1 ||
        previousBatchDigest !== prevDigest ||
        !sha256Pattern.test(batchDigestSha256) ||
        !sha256Pattern.test(bundleDigestSha256)
      ) {
        fail(
          409,
          "ArchiveIntegrityViolation",
          `Durable archive manifest hash chain or sequence invariant failed at batch #${i + 1}.`,
        );
      }

      prevDigest = batchDigestSha256;
      prevLastSeq = lastSequence;
      manifestEntries.push({
        id,
        batchNumber,
        fileName,
        firstSequence,
        lastSequence,
        eventCount,
        retentionCutoffAt,
        previousBatchDigest,
        batchDigestSha256,
        bundleDigestSha256,
      });
    }

    const expectedManifestDigest = computeManifestDigest(manifestEntries);
    if (rawManifestObj.manifestDigestSha256 !== expectedManifestDigest) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        "Durable archive manifest.json digest mismatch.",
      );
    }

    const lastEntry = manifestEntries.at(-1) ?? null;
    if (
      rawManifestObj.latestBatchId !== (lastEntry ? lastEntry.id : null) ||
      Number(rawManifestObj.latestBatchNumber) !==
        (lastEntry ? lastEntry.batchNumber : 0) ||
      rawManifestObj.latestBatchDigestSha256 !==
        (lastEntry ? lastEntry.batchDigestSha256 : null) ||
      (rawManifestObj.lastArchivedSequence === null
        ? null
        : Number(rawManifestObj.lastArchivedSequence)) !==
        (lastEntry ? lastEntry.lastSequence : null)
    ) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        "Durable archive manifest summary pointers do not match batch entries.",
      );
    }

    const expectedFileNames = manifestEntries.map((e) => e.fileName).sort();
    if (
      batchFilesOnDisk.length !== expectedFileNames.length ||
      batchFilesOnDisk.some((f, idx) => f !== expectedFileNames[idx])
    ) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        "Durable archive batch files on disk do not match manifest.json inventory.",
      );
    }

    const bundles: DurableArchiveBundleFile[] = [];
    for (const entry of manifestEntries) {
      const filePath = path.join(this.batchesDir, entry.fileName);
      let rawBundleText = "";
      let rawBundle: unknown;
      try {
        rawBundleText = await readFile(filePath, "utf8");
        rawBundle = JSON.parse(rawBundleText);
      } catch {
        fail(
          409,
          "ArchiveIntegrityViolation",
          `Durable archive batch file ${entry.fileName} is unreadable or corrupted JSON.`,
        );
      }
      const verified = verifyExportedArchiveBundle(rawBundle);
      if (
        verified.batchId !== entry.id ||
        verified.batchNumber !== entry.batchNumber ||
        verified.firstSequence !== entry.firstSequence ||
        verified.lastSequence !== entry.lastSequence ||
        verified.eventCount !== entry.eventCount ||
        verified.batchDigestSha256 !== entry.batchDigestSha256 ||
        verified.bundleDigestSha256 !== entry.bundleDigestSha256 ||
        verified.durableFileName !== entry.fileName
      ) {
        fail(
          409,
          "ArchiveIntegrityViolation",
          `Durable archive batch file ${entry.fileName} does not match manifest entry.`,
        );
      }
      const parsedObj = rawBundle as DurableArchiveBundleFile;
      const canonicalBundle: DurableArchiveBundleFile = {
        format: "vardena-owner-audit-archive-bundle",
        formatVersion: 1,
        durableFileName: entry.fileName,
        bundleDigestSha256: entry.bundleDigestSha256,
        batch: {
          ...parsedObj.batch,
          durableFileName: entry.fileName,
          bundleDigestSha256: entry.bundleDigestSha256,
        },
        events: parsedObj.events,
      };
      if (rawBundleText.trim() !== canonicalJson(canonicalBundle)) {
        fail(
          409,
          "ArchiveIntegrityViolation",
          `Durable archive batch file ${entry.fileName} raw content does not match canonical bundle representation.`,
        );
      }
      bundles.push(canonicalBundle);
    }

    const canonicalManifest: DurableArchiveManifest = {
      format: "vardena-owner-audit-archive-manifest",
      formatVersion: 1,
      updatedAt,
      latestBatchId: lastEntry ? lastEntry.id : null,
      latestBatchNumber: lastEntry ? lastEntry.batchNumber : 0,
      latestBatchDigestSha256: lastEntry ? lastEntry.batchDigestSha256 : null,
      lastArchivedSequence: lastEntry ? lastEntry.lastSequence : null,
      batches: manifestEntries,
      manifestDigestSha256: expectedManifestDigest,
    };
    if (rawManifestText.trim() !== canonicalJson(canonicalManifest)) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        "Durable archive manifest.json raw content does not match canonical manifest representation.",
      );
    }

    return {
      verified: true,
      manifest: canonicalManifest,
      bundles,
    };
  }

  public async persistBatch(bundle: {
    batch: ArchiveBatchSummary;
    events: ArchivedAuditEventRecord[];
  }): Promise<{
    entry: DurableArchiveManifestEntry;
    rollback: () => Promise<void>;
  }> {
    const current = await this.verifyStore();
    const verified = verifyExportedArchiveBundle(bundle);

    const existingLast = current.manifest.batches.at(-1);
    if (
      existingLast &&
      existingLast.id === verified.batchId &&
      existingLast.bundleDigestSha256 === verified.bundleDigestSha256
    ) {
      return {
        entry: existingLast,
        rollback: async () => {},
      };
    }

    if (
      verified.batchNumber !== current.manifest.latestBatchNumber + 1 ||
      bundle.batch.previousBatchDigest !==
        current.manifest.latestBatchDigestSha256 ||
      verified.firstSequence <= (current.manifest.lastArchivedSequence ?? 0)
    ) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        `Durable archive batch #${verified.batchNumber} (${verified.batchId}) does not chain cleanly onto durable manifest latest batch #${current.manifest.latestBatchNumber}.`,
      );
    }

    let priorManifestRaw: string | null = null;
    if (await this.fileExists(this.manifestPath)) {
      priorManifestRaw = await readFile(this.manifestPath, "utf8");
    }

    const batchFilePath = path.join(this.batchesDir, verified.durableFileName);
    const bundleFile: DurableArchiveBundleFile = {
      format: "vardena-owner-audit-archive-bundle",
      formatVersion: 1,
      durableFileName: verified.durableFileName,
      bundleDigestSha256: verified.bundleDigestSha256,
      batch: {
        ...bundle.batch,
        durableFileName: verified.durableFileName,
        bundleDigestSha256: verified.bundleDigestSha256,
      },
      events: bundle.events,
    };

    await this.writeAtomicFsync(
      batchFilePath,
      `${canonicalJson(bundleFile)}\n`,
      {
        exclusive: true,
        mode: 0o444,
      },
    );

    // Read back from disk and verify before updating manifest.json
    try {
      const readBackText = await readFile(batchFilePath, "utf8");
      const readBackVerified = verifyExportedArchiveBundle(
        JSON.parse(readBackText),
      );
      if (readBackVerified.bundleDigestSha256 !== verified.bundleDigestSha256) {
        throw new Error("Read-back bundle digest mismatch");
      }
    } catch (err) {
      await chmod(batchFilePath, 0o600).catch(() => {});
      await rm(batchFilePath, { force: true }).catch(() => {});
      if (err instanceof ApiError) throw err;
      fail(
        503,
        "ArchiveStorageUnavailable",
        "Durable archive batch read-back verification failed.",
      );
    }

    const newEntry: DurableArchiveManifestEntry = {
      id: verified.batchId,
      batchNumber: verified.batchNumber,
      fileName: verified.durableFileName,
      firstSequence: verified.firstSequence,
      lastSequence: verified.lastSequence,
      eventCount: verified.eventCount,
      retentionCutoffAt: bundle.batch.retentionCutoffAt,
      previousBatchDigest: bundle.batch.previousBatchDigest,
      batchDigestSha256: verified.batchDigestSha256,
      bundleDigestSha256: verified.bundleDigestSha256,
    };
    const nextEntries = [...current.manifest.batches, newEntry];
    const nextManifest: DurableArchiveManifest = {
      format: "vardena-owner-audit-archive-manifest",
      formatVersion: 1,
      updatedAt: new Date().toISOString(),
      latestBatchId: newEntry.id,
      latestBatchNumber: newEntry.batchNumber,
      latestBatchDigestSha256: newEntry.batchDigestSha256,
      lastArchivedSequence: newEntry.lastSequence,
      batches: nextEntries,
      manifestDigestSha256: computeManifestDigest(nextEntries),
    };

    try {
      await this.writeAtomicFsync(
        this.manifestPath,
        `${canonicalJson(nextManifest)}\n`,
        {
          exclusive: false,
        },
      );
    } catch (err) {
      await chmod(batchFilePath, 0o600).catch(() => {});
      await rm(batchFilePath, { force: true }).catch(() => {});
      throw err;
    }

    return {
      entry: newEntry,
      rollback: async () => {
        try {
          if (priorManifestRaw === null) {
            await rm(this.manifestPath, { force: true });
          } else {
            await this.writeAtomicFsync(this.manifestPath, priorManifestRaw, {
              exclusive: false,
            });
          }
        } finally {
          await chmod(batchFilePath, 0o600).catch(() => {});
          await rm(batchFilePath, { force: true }).catch(() => {});
        }
      },
    };
  }
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
  durable_file_name: string;
  durable_bundle_sha256: string;
}

interface ArchivedEventRow {
  id: string;
  batch_id: string;
  sequence: string | number;
  actor_id: string | null;
  event_type: string;
  target_type: string;
  target_id: string | null;
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
  target_id: string | null;
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
    durableFileName: row.durable_file_name,
    bundleDigestSha256: row.durable_bundle_sha256,
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

function assertArchiveActor(actor: AuthorizedActorRow) {
  assertActiveAuthorizedActor(
    actor as Pick<User, "id" | "role" | "is_active" | "must_change_password">,
    "audit.archive",
  );
}

function assertDurableStoreConfigured(
  store: AuditArchiveStore | undefined,
): AuditArchiveStore {
  if (!store) {
    fail(
      503,
      "ArchiveStorageUnavailable",
      "Independent durable archive storage (OWNER_AUDIT_ARCHIVE_DIR) is not configured.",
    );
  }
  return store;
}

async function verifyDbLedgerOnly(tx: PoolClient): Promise<{
  batches: { batch: ArchiveBatchSummary; events: ArchivedAuditEventRecord[] }[];
  totalVerifiedEvents: number;
  latestBatchId: string | null;
  latestBatchDigestSha256: string | null;
  latestBundleDigestSha256: string | null;
  lastArchivedSequence: number | null;
}> {
  const batchesRes = await tx.query<ArchiveBatchRow>(
    `SELECT id, batch_number, created_by, created_at, reason,
            first_sequence, last_sequence, event_count, retention_cutoff_at,
            previous_batch_digest, batch_digest_sha256,
            durable_file_name, durable_bundle_sha256
     FROM owner_audit_archive.archive_batches
     ORDER BY batch_number ASC`,
  );

  let prevDigest: string | null = null;
  let prevLastSeq = 0;
  let totalVerifiedEvents = 0;
  const batches: {
    batch: ArchiveBatchSummary;
    events: ArchivedAuditEventRecord[];
  }[] = [];

  for (let idx = 0; idx < batchesRes.rows.length; idx++) {
    const batch = mapBatchRow(batchesRes.rows[idx]!);
    if (batch.batchNumber !== idx + 1) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        `Archive batch ${batch.id} batchNumber (${batch.batchNumber}) is not contiguous (#${idx + 1}).`,
      );
    }
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
    const verifiedBundle = verifyExportedArchiveBundle({ batch, events });
    if (verifiedBundle.bundleDigestSha256 !== batch.bundleDigestSha256) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        `Archive batch ${batch.id} durable_bundle_sha256 mismatch.`,
      );
    }

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
    batches.push({ batch, events });
  }

  const latest = batches.at(-1)?.batch ?? null;
  return {
    batches,
    totalVerifiedEvents,
    latestBatchId: latest ? latest.id : null,
    latestBatchDigestSha256: latest ? latest.batchDigestSha256 : null,
    latestBundleDigestSha256: latest ? latest.bundleDigestSha256 : null,
    lastArchivedSequence: latest ? latest.lastSequence : null,
  };
}

async function verifyArchiveLedgerInternal(
  tx: PoolClient,
  store: AuditArchiveStore,
): Promise<{
  verified: true;
  batchCount: number;
  verifiedEventCount: number;
  latestBatchId: string | null;
  latestBatchDigestSha256: string | null;
  latestBundleDigestSha256: string | null;
  lastArchivedSequence: number | null;
}> {
  const durable = await store.verifyStore();
  const dbState = await verifyDbLedgerOnly(tx);

  if (durable.manifest.batches.length !== dbState.batches.length) {
    fail(
      409,
      "ArchiveIntegrityViolation",
      `Independent durable archive store batch count (${durable.manifest.batches.length}) does not match PostgreSQL archive ledger batch count (${dbState.batches.length}); run archive recovery to reconcile.`,
    );
  }

  for (let i = 0; i < dbState.batches.length; i++) {
    const dbItem = dbState.batches[i]!.batch;
    const storeItem = durable.manifest.batches[i]!;
    if (
      dbItem.id !== storeItem.id ||
      dbItem.batchNumber !== storeItem.batchNumber ||
      dbItem.firstSequence !== storeItem.firstSequence ||
      dbItem.lastSequence !== storeItem.lastSequence ||
      dbItem.eventCount !== storeItem.eventCount ||
      dbItem.previousBatchDigest !== storeItem.previousBatchDigest ||
      dbItem.batchDigestSha256 !== storeItem.batchDigestSha256 ||
      dbItem.durableFileName !== storeItem.fileName ||
      dbItem.bundleDigestSha256 !== storeItem.bundleDigestSha256
    ) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        `Archive batch #${i + 1} (${dbItem.id}) metadata in PostgreSQL ledger contradicts independent durable archive store.`,
      );
    }
  }

  return {
    verified: true,
    batchCount: dbState.batches.length,
    verifiedEventCount: dbState.totalVerifiedEvents,
    latestBatchId: dbState.latestBatchId,
    latestBatchDigestSha256: dbState.latestBatchDigestSha256,
    latestBundleDigestSha256: dbState.latestBundleDigestSha256,
    lastArchivedSequence: dbState.lastArchivedSequence,
  };
}

export async function getVerifiedDurableBatchIds(
  tx: PoolClient,
  store?: AuditArchiveStore,
): Promise<ReadonlySet<string>> {
  if (!store) return new Set<string>();
  try {
    const durable = await store.verifyStore();
    const dbState = await verifyDbLedgerOnly(tx);
    const durableById = new Map(
      durable.manifest.batches.map((b) => [b.id, b] as const),
    );
    const verifiedIds = new Set<string>();
    for (const item of dbState.batches) {
      const d = durableById.get(item.batch.id);
      if (
        d &&
        d.batchNumber === item.batch.batchNumber &&
        d.batchDigestSha256 === item.batch.batchDigestSha256 &&
        d.bundleDigestSha256 === item.batch.bundleDigestSha256
      ) {
        verifiedIds.add(item.batch.id);
      }
    }
    return verifiedIds;
  } catch {
    return new Set<string>();
  }
}

export async function getAuditArchiveStatus(
  tx: PoolClient,
  actor: AuthorizedActorRow,
  rawQuery: Record<string, unknown> = {},
  store?: AuditArchiveStore,
): Promise<AuditArchiveStatusReport> {
  assertArchiveActor(actor);
  const q = object(rawQuery, ["asOf"]);
  const asOfIso =
    q.asOf !== undefined && q.asOf !== ""
      ? utcInstant(String(q.asOf), "asOf")
      : new Date().toISOString();

  let durableStoreConfigured = Boolean(store);
  let durableStoreVerified = false;
  let dbLedgerVerified = false;
  let crossStoreConsistent = false;
  let recoveryRequired = false;
  let issueCode: string | null = null;
  let issueMessage: string | null = null;
  let durableStoreBatchCount = 0;
  let durableStoreEventCount = 0;
  let latestBatchId: string | null = null;
  let latestBatchDigestSha256: string | null = null;
  let latestBundleDigestSha256: string | null = null;
  let lastArchivedSequence: number | null = null;
  const verifiedBatchIdList: string[] = [];

  let durableResult: Awaited<
    ReturnType<AuditArchiveStore["verifyStore"]>
  > | null = null;
  if (!store) {
    issueCode = "ArchiveStorageUnavailable";
    issueMessage =
      "Independent durable archive storage (OWNER_AUDIT_ARCHIVE_DIR) is not configured.";
  } else {
    try {
      durableResult = await store.verifyStore();
      durableStoreVerified = true;
      durableStoreBatchCount = durableResult.manifest.batches.length;
      durableStoreEventCount = durableResult.manifest.batches.reduce(
        (sum, b) => sum + b.eventCount,
        0,
      );
    } catch (err) {
      durableStoreVerified = false;
      issueCode =
        err instanceof ApiError ? err.code : "ArchiveIntegrityViolation";
      issueMessage =
        err instanceof Error
          ? err.message
          : "Independent durable archive store failed verification.";
    }
  }

  let dbResult: Awaited<ReturnType<typeof verifyDbLedgerOnly>> | null = null;
  try {
    dbResult = await verifyDbLedgerOnly(tx);
    dbLedgerVerified = true;
  } catch (err) {
    dbLedgerVerified = false;
    recoveryRequired = durableStoreVerified && durableStoreBatchCount > 0;
    if (!issueCode) {
      issueCode =
        err instanceof ApiError ? err.code : "ArchiveIntegrityViolation";
      issueMessage =
        err instanceof Error
          ? err.message
          : "PostgreSQL archive ledger failed verification.";
    }
  }

  if (durableResult && dbResult) {
    const durableById = new Map(
      durableResult.manifest.batches.map((b) => [b.id, b] as const),
    );
    let prefixMismatch = false;
    const minLen = Math.min(
      durableResult.manifest.batches.length,
      dbResult.batches.length,
    );
    for (let i = 0; i < minLen; i++) {
      const d = durableResult.manifest.batches[i]!;
      const dbB = dbResult.batches[i]!.batch;
      if (
        d.id !== dbB.id ||
        d.batchNumber !== dbB.batchNumber ||
        d.batchDigestSha256 !== dbB.batchDigestSha256 ||
        d.bundleDigestSha256 !== dbB.bundleDigestSha256
      ) {
        prefixMismatch = true;
        break;
      }
    }
    for (const item of dbResult.batches) {
      const d = durableById.get(item.batch.id);
      if (
        d &&
        d.batchNumber === item.batch.batchNumber &&
        d.batchDigestSha256 === item.batch.batchDigestSha256 &&
        d.bundleDigestSha256 === item.batch.bundleDigestSha256
      ) {
        verifiedBatchIdList.push(item.batch.id);
      }
    }
    if (
      !prefixMismatch &&
      durableResult.manifest.batches.length === dbResult.batches.length
    ) {
      crossStoreConsistent = true;
      latestBatchId = dbResult.latestBatchId;
      latestBatchDigestSha256 = dbResult.latestBatchDigestSha256;
      latestBundleDigestSha256 = dbResult.latestBundleDigestSha256;
      lastArchivedSequence = dbResult.lastArchivedSequence;
    } else if (!prefixMismatch) {
      crossStoreConsistent = false;
      recoveryRequired = true;
      issueCode = "ArchiveRecoveryRequired";
      issueMessage =
        durableResult.manifest.batches.length > dbResult.batches.length
          ? "Independent durable archive store contains verified batches not yet present in PostgreSQL ledger; recovery is required."
          : "PostgreSQL archive ledger contains batches missing from independent durable archive store; recovery is required.";
      latestBatchId =
        dbResult.latestBatchId ?? durableResult.manifest.latestBatchId;
      latestBatchDigestSha256 =
        dbResult.latestBatchDigestSha256 ??
        durableResult.manifest.latestBatchDigestSha256;
      latestBundleDigestSha256 =
        dbResult.latestBundleDigestSha256 ??
        durableResult.manifest.batches.at(-1)?.bundleDigestSha256 ??
        null;
      lastArchivedSequence =
        dbResult.lastArchivedSequence ??
        durableResult.manifest.lastArchivedSequence;
    } else {
      crossStoreConsistent = false;
      recoveryRequired = false;
      issueCode = "ArchiveIntegrityViolation";
      issueMessage =
        "Independent durable archive store and PostgreSQL archive ledger have conflicting batch digests.";
    }
  }

  const verified =
    durableStoreConfigured &&
    durableStoreVerified &&
    dbLedgerVerified &&
    crossStoreConsistent;

  const statsRes = await tx.query<{
    total_source_events: string;
    within_minimum_window_count: string;
    past_minimum_floor_count: string;
    unresolved_incident_count: string;
    past_floor_incident_hold_count: string;
    archived_event_count: string;
    unarchived_eligible_count: string;
    db_batch_count: string;
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
       (
         SELECT COUNT(*)::text
         FROM owner_audit_archive.archived_audit_events a
         WHERE a.batch_id = ANY($2::varchar[])
       ) AS archived_event_count,
       COUNT(*) FILTER (
         WHERE event_type <> ALL($3::text[])
           AND NOT EXISTS (
             SELECT 1
             FROM owner_audit_archive.archived_audit_events a
             WHERE a.id = owner.audit_events.id
               AND a.batch_id = ANY($2::varchar[])
           )
       )::text AS unarchived_eligible_count,
       (SELECT COUNT(*)::text FROM owner_audit_archive.archive_batches) AS db_batch_count
     FROM owner.audit_events`,
    [asOfIso, verifiedBatchIdList, [...archiveMetaEventTypes]],
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
      archiveBatchCount: Number(row.db_batch_count),
      durableStoreBatchCount,
      durableStoreEventCount,
      cleanupEligibleEventCount: 0,
    },
    integrity: {
      verified,
      durableStoreConfigured,
      durableStoreVerified,
      dbLedgerVerified,
      crossStoreConsistent,
      recoveryRequired,
      issueCode,
      issueMessage,
      latestBatchId,
      latestBatchDigestSha256,
      latestBundleDigestSha256,
      lastArchivedSequence,
    },
  };
}

export async function listAuditArchiveBatches(
  tx: PoolClient,
  actor: AuthorizedActorRow,
  rawQuery: Record<string, unknown> = {},
  store?: AuditArchiveStore,
) {
  assertArchiveActor(actor);
  const q = object(rawQuery, ["page"]);
  const p = parsePage(q.page);
  const pageSize = 50;

  if (store) {
    const durable = await store.verifyStore();
    if (durable.bundles.length > 0) {
      const sorted = [...durable.bundles]
        .map((b) => b.batch)
        .sort((a, b) => b.batchNumber - a.batchNumber);
      const offset = (p - 1) * pageSize;
      const slice = sorted.slice(offset, offset + pageSize + 1);
      return {
        items: slice.slice(0, pageSize),
        page: p,
        pageSize,
        hasNext: slice.length > pageSize,
      };
    }
  }

  const rows = await tx.query<ArchiveBatchRow>(
    `SELECT id, batch_number, created_by, created_at, reason,
            first_sequence, last_sequence, event_count, retention_cutoff_at,
            previous_batch_digest, batch_digest_sha256,
            durable_file_name, durable_bundle_sha256
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
  store?: AuditArchiveStore,
): Promise<AuditArchiveBundle> {
  assertArchiveActor(actor);
  const batchId = parseId(rawBatchId);
  const durableStore = assertDurableStoreConfigured(store);
  const durable = await durableStore.verifyStore();
  const durableBundle = durable.bundles.find((b) => b.batch.id === batchId);
  if (!durableBundle) {
    fail(
      404,
      "EntityNotFound",
      "Archive batch was not found in durable store.",
    );
  }

  const dbBatchRes = await tx.query<ArchiveBatchRow>(
    `SELECT id, batch_number, created_by, created_at, reason,
            first_sequence, last_sequence, event_count, retention_cutoff_at,
            previous_batch_digest, batch_digest_sha256,
            durable_file_name, durable_bundle_sha256
     FROM owner_audit_archive.archive_batches
     WHERE id = $1`,
    [batchId],
  );
  const dbBatchRow = dbBatchRes.rows[0];
  if (dbBatchRow) {
    const dbBatch = mapBatchRow(dbBatchRow);
    if (
      dbBatch.batchNumber !== durableBundle.batch.batchNumber ||
      dbBatch.batchDigestSha256 !== durableBundle.batch.batchDigestSha256 ||
      dbBatch.bundleDigestSha256 !== durableBundle.bundleDigestSha256 ||
      dbBatch.durableFileName !== durableBundle.durableFileName
    ) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        `Archive batch ${batchId} in PostgreSQL ledger contradicts independent durable archive store.`,
      );
    }
  }

  return {
    batch: durableBundle.batch,
    events: durableBundle.events,
    durableStorage: {
      persisted: true,
      fileName: durableBundle.durableFileName,
      bundleDigestSha256: durableBundle.bundleDigestSha256,
      verified: true,
      presentInDbLedger: Boolean(dbBatchRow),
    },
  };
}

async function insertBatchAndEventsToDb(
  tx: PoolClient,
  batch: ArchiveBatchSummary,
  events: readonly ArchivedAuditEventRecord[],
): Promise<ArchiveBatchSummary> {
  const insertedBatchRes = await tx.query<ArchiveBatchRow>(
    `INSERT INTO owner_audit_archive.archive_batches (
       id, batch_number, created_by, created_at, reason,
       first_sequence, last_sequence, event_count,
       retention_cutoff_at, previous_batch_digest, batch_digest_sha256,
       durable_file_name, durable_bundle_sha256
     )
     VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9::timestamptz, $10, $11, $12, $13)
     RETURNING id, batch_number, created_by, created_at, reason,
               first_sequence, last_sequence, event_count, retention_cutoff_at,
               previous_batch_digest, batch_digest_sha256,
               durable_file_name, durable_bundle_sha256`,
    [
      batch.id,
      batch.batchNumber,
      batch.createdBy,
      batch.createdAt,
      batch.reason,
      batch.firstSequence,
      batch.lastSequence,
      batch.eventCount,
      batch.retentionCutoffAt,
      batch.previousBatchDigest,
      batch.batchDigestSha256,
      batch.durableFileName,
      batch.bundleDigestSha256,
    ],
  );

  for (const p of events) {
    await tx.query(
      `INSERT INTO owner_audit_archive.archived_audit_events (
         id, batch_id, sequence, actor_id, event_type, target_type, target_id,
         occurred_at, minimum_retained_until, outcome, security_incident,
         incident_status, reason, before_state, after_state, archived_at, record_sha256
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8::timestamptz, $9::timestamptz, $10, $11,
         $12, $13, $14, $15, $16::timestamptz, $17
       )`,
      [
        p.id,
        batch.id,
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
        p.archivedAt,
        p.recordSha256,
      ],
    );
  }

  return mapBatchRow(insertedBatchRes.rows[0]!);
}

async function reconcilePendingDurableBatchesOnRetry(
  tx: PoolClient,
  actorId: string,
  store: AuditArchiveStore,
): Promise<ArchiveBatchSummary[]> {
  const durable = await store.verifyStore();
  const dbState = await verifyDbLedgerOnly(tx);

  if (dbState.batches.length > durable.bundles.length) {
    fail(
      409,
      "ArchiveIntegrityViolation",
      "Durable archive store is missing batches recorded in PostgreSQL ledger; run POST /api/v1/audit-archive/recover or investigate storage loss.",
    );
  }

  for (let i = 0; i < dbState.batches.length; i++) {
    const dbItem = dbState.batches[i]!.batch;
    const storeItem = durable.manifest.batches[i]!;
    if (
      dbItem.id !== storeItem.id ||
      dbItem.batchNumber !== storeItem.batchNumber ||
      dbItem.batchDigestSha256 !== storeItem.batchDigestSha256 ||
      dbItem.bundleDigestSha256 !== storeItem.bundleDigestSha256
    ) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        `Archive batch #${i + 1} (${dbItem.id}) in PostgreSQL ledger contradicts independent durable archive store.`,
      );
    }
  }

  const reconciled: ArchiveBatchSummary[] = [];
  for (let i = dbState.batches.length; i < durable.bundles.length; i++) {
    const bundle = durable.bundles[i]!;
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
      [bundle.batch.firstSequence, bundle.batch.lastSequence],
    );

    if (sourceRes.rows.length !== bundle.events.length) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        `Source audit events are missing for durable archive batch ${bundle.batch.id}; run POST /api/v1/audit-archive/recover to restore missing source and ledger records.`,
      );
    }

    for (let j = 0; j < bundle.events.length; j++) {
      const ev = bundle.events[j]!;
      const src = sourceRes.rows[j]!;
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
      if (src.id !== ev.id || srcDigest !== ev.recordSha256) {
        fail(
          409,
          "ArchiveIntegrityViolation",
          `Source audit event ${src.id} contradicts durable archive batch ${bundle.batch.id}.`,
        );
      }
    }

    const summary = await insertBatchAndEventsToDb(
      tx,
      bundle.batch,
      bundle.events,
    );
    await audit(tx, {
      actor: actorId,
      type: "AUDIT_ARCHIVE_BATCH_CREATED",
      targetType: "AuditArchiveBatch",
      targetId: summary.id,
      reason: summary.reason,
      after: {
        archiveBatchId: summary.id,
        archivedCount: summary.eventCount,
        firstSequence: summary.firstSequence,
        lastSequence: summary.lastSequence,
        batchDigestSha256: summary.batchDigestSha256,
        bundleDigestSha256: summary.bundleDigestSha256,
        durableFileName: summary.durableFileName,
        archiveVerified: true,
      },
    });
    reconciled.push(summary);
  }

  return reconciled;
}

export async function createAuditArchiveBatch(
  tx: PoolClient,
  actor: AuthorizedActorRow,
  rawBody: unknown,
  options?: {
    store?: AuditArchiveStore | undefined;
    afterInsertHook?: (tx: PoolClient) => Promise<void> | void;
    skipDiskRollbackOnError?: boolean;
  },
): Promise<{
  status: "ARCHIVED" | "NO_ELIGIBLE_EVENTS";
  archivedCount: number;
  batch: ArchiveBatchSummary | null;
}> {
  assertArchiveActor(actor);
  const store = assertDurableStoreConfigured(options?.store);
  const body = object(rawBody, ["reason", "upToOccurredAt", "maxEvents"]);
  const archiveReason = parseReason(body.reason);

  let upToOccurredAt: string | null = null;
  if (
    body.upToOccurredAt !== undefined &&
    body.upToOccurredAt !== null &&
    body.upToOccurredAt !== ""
  ) {
    upToOccurredAt = utcInstant(String(body.upToOccurredAt), "upToOccurredAt");
  }

  let maxEvents = 500;
  if (body.maxEvents !== undefined && body.maxEvents !== null) {
    if (
      typeof body.maxEvents !== "number" ||
      !Number.isInteger(body.maxEvents) ||
      body.maxEvents < 1 ||
      body.maxEvents > 1000
    ) {
      invalid("maxEvents must be an integer between 1 and 1000.");
    }
    maxEvents = body.maxEvents;
  }

  await tx.query("SELECT pg_advisory_xact_lock(77004001)");

  const reconciled = await reconcilePendingDurableBatchesOnRetry(
    tx,
    actor.id,
    store,
  );
  const integrity = await verifyArchiveLedgerInternal(tx, store);
  const lastArchivedSeq = integrity.lastArchivedSequence ?? 0;

  const eligibleNonMetaRes = await tx.query<{ max_seq: string | null }>(
    `SELECT MAX(sequence)::text AS max_seq
     FROM owner.audit_events
     WHERE sequence > $1
       AND event_type <> ALL($2::text[])
       AND ($3::timestamptz IS NULL OR occurred_at <= $3::timestamptz)`,
    [lastArchivedSeq, [...archiveMetaEventTypes], upToOccurredAt],
  );

  const maxEligibleNonMetaSeq = eligibleNonMetaRes.rows[0]?.max_seq
    ? Number(eligibleNonMetaRes.rows[0].max_seq)
    : null;

  if (maxEligibleNonMetaSeq === null) {
    if (reconciled.length > 0) {
      const lastReconciled = reconciled[reconciled.length - 1]!;
      return {
        status: "ARCHIVED",
        archivedCount: lastReconciled.eventCount,
        batch: lastReconciled,
      };
    }
    return {
      status: "NO_ELIGIBLE_EVENTS",
      archivedCount: 0,
      batch: null,
    };
  }

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
    if (reconciled.length > 0) {
      const lastReconciled = reconciled[reconciled.length - 1]!;
      return {
        status: "ARCHIVED",
        archivedCount: lastReconciled.eventCount,
        batch: lastReconciled,
      };
    }
    return {
      status: "NO_ELIGIBLE_EVENTS",
      archivedCount: 0,
      batch: null,
    };
  }

  const batchId = ulid();
  const batchNumber = integrity.batchCount + 1;
  const nowIso = new Date().toISOString();
  const firstSequence = Number(rows[0]!.sequence);
  const lastSequence = Number(rows[rows.length - 1]!.sequence);
  const retentionCutoffAt = rows[rows.length - 1]!.occurred_at.toISOString();

  const preparedEvents: ArchivedAuditEventRecord[] = rows.map((r) => {
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
    const recordSha256 = computeArchivedEventDigest(payload);
    return {
      ...payload,
      batchId,
      archivedAt: nowIso,
      recordSha256,
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

  const durableFileName = formatDurableBatchFileName(batchNumber, batchId);
  const baseBatchSummary = {
    id: batchId,
    batchNumber,
    createdBy: actor.id,
    createdAt: nowIso,
    reason: archiveReason,
    firstSequence,
    lastSequence,
    eventCount: preparedEvents.length,
    retentionCutoffAt,
    previousBatchDigest: integrity.latestBatchDigestSha256,
    batchDigestSha256,
    durableFileName,
  };
  const bundleDigestSha256 = computeArchiveBundleDigest({
    batch: baseBatchSummary,
    events: preparedEvents,
  });
  const candidateBatchSummary: ArchiveBatchSummary = {
    ...baseBatchSummary,
    bundleDigestSha256,
  };

  const batchSummary = await insertBatchAndEventsToDb(
    tx,
    candidateBatchSummary,
    preparedEvents,
  );

  const persisted = await store.persistBatch({
    batch: batchSummary,
    events: preparedEvents,
  });

  try {
    if (options?.afterInsertHook) {
      await options.afterInsertHook(tx);
    }

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
        bundleDigestSha256: batchSummary.bundleDigestSha256,
        durableFileName: batchSummary.durableFileName,
        archiveVerified: true,
      },
    });
  } catch (err) {
    if (!options?.skipDiskRollbackOnError) {
      await persisted.rollback();
    }
    throw err;
  }

  return {
    status: "ARCHIVED",
    archivedCount: batchSummary.eventCount,
    batch: batchSummary,
  };
}

export async function verifyAuditArchiveIntegrity(
  tx: PoolClient,
  actor: AuthorizedActorRow,
  rawBody: unknown = {},
  store?: AuditArchiveStore,
) {
  assertArchiveActor(actor);
  const durableStore = assertDurableStoreConfigured(store);
  const body = object(rawBody ?? {}, ["reason"]);
  const verifyReason =
    body.reason !== undefined && body.reason !== null && body.reason !== ""
      ? parseReason(body.reason)
      : "Periodic audit archive integrity verification";

  const result = await verifyArchiveLedgerInternal(tx, durableStore);

  await audit(tx, {
    actor: actor.id,
    type: "AUDIT_ARCHIVE_VERIFIED",
    targetType: "AuditArchiveBatch",
    targetId: result.latestBatchId ?? "EMPTY_ARCHIVE",
    reason: verifyReason,
    after: {
      archiveBatchId: result.latestBatchId,
      archivedCount: result.verifiedEventCount,
      lastSequence: result.lastArchivedSequence,
      batchDigestSha256: result.latestBatchDigestSha256,
      bundleDigestSha256: result.latestBundleDigestSha256,
      archiveVerified: true,
    },
  });

  return result;
}

export async function recoverAuditArchiveService(
  tx: PoolClient,
  actor: AuthorizedActorRow,
  rawBody: unknown = {},
  store?: AuditArchiveStore,
): Promise<AuditArchiveRecoveryResult> {
  assertArchiveActor(actor);
  const durableStore = assertDurableStoreConfigured(store);
  const body = object(rawBody ?? {}, ["reason"]);
  const recoveryReason = parseReason(body.reason);

  await tx.query("SELECT pg_advisory_xact_lock(77004001)");

  const durable = await durableStore.verifyStore();
  const dbBatchesRes = await tx.query<ArchiveBatchRow>(
    `SELECT id, batch_number, created_by, created_at, reason,
            first_sequence, last_sequence, event_count, retention_cutoff_at,
            previous_batch_digest, batch_digest_sha256,
            durable_file_name, durable_bundle_sha256
     FROM owner_audit_archive.archive_batches
     ORDER BY batch_number ASC`,
  );
  const dbBatches = dbBatchesRes.rows.map(mapBatchRow);

  const minLen = Math.min(durable.bundles.length, dbBatches.length);
  for (let i = 0; i < minLen; i++) {
    const d = durable.bundles[i]!.batch;
    const dbB = dbBatches[i]!;
    if (
      d.id !== dbB.id ||
      d.batchNumber !== dbB.batchNumber ||
      d.firstSequence !== dbB.firstSequence ||
      d.lastSequence !== dbB.lastSequence ||
      d.eventCount !== dbB.eventCount ||
      d.previousBatchDigest !== dbB.previousBatchDigest ||
      d.batchDigestSha256 !== dbB.batchDigestSha256 ||
      d.bundleDigestSha256 !== dbB.bundleDigestSha256 ||
      d.durableFileName !== dbB.durableFileName
    ) {
      fail(
        409,
        "ArchiveIntegrityViolation",
        `Conflicting archive batch #${i + 1} between independent durable store and PostgreSQL ledger.`,
      );
    }
  }

  let recoveredBatchCount = 0;
  let recoveredSourceEventCount = 0;
  let recoveredLedgerEventCount = 0;
  let rehydratedDurableBatchCount = 0;

  // 1. Ensure all source audit events and DB ledger rows exist for every verified bundle in durable store
  for (const bundle of durable.bundles) {
    for (const ev of bundle.events) {
      const existingSrcRes = await tx.query<SourceAuditRow>(
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
         WHERE id = $1 OR sequence = $2`,
        [ev.id, ev.sequence],
      );

      if (existingSrcRes.rows.length === 0) {
        await tx.query(
          `INSERT INTO owner.audit_events (
             sequence, id, actor_id, event_type, target_type, target_id,
             occurred_at, outcome, reason, before_state, after_state,
             security_incident, incident_status
           )
           OVERRIDING SYSTEM VALUE
           VALUES (
             $1, $2, $3, $4, $5, $6,
             $7::timestamptz, $8, $9, $10, $11,
             $12, $13
           )`,
          [
            ev.sequence,
            ev.id,
            ev.actorId,
            ev.eventType,
            ev.targetType,
            ev.targetId,
            ev.occurredAt,
            ev.outcome,
            ev.reason,
            ev.beforeState ? JSON.stringify(ev.beforeState) : null,
            ev.afterState ? JSON.stringify(ev.afterState) : null,
            ev.securityIncident,
            ev.incidentStatus,
          ],
        );
        recoveredSourceEventCount += 1;
      } else {
        const src = existingSrcRes.rows[0]!;
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
          incidentStatus: (src.incident_status ??
            "NONE") as AuditIncidentStatus,
          reason: src.reason,
          beforeState: auditState(src.before_state),
          afterState: auditState(src.after_state),
        });
        if (
          existingSrcRes.rows.length > 1 ||
          src.id !== ev.id ||
          Number(src.sequence) !== ev.sequence ||
          srcDigest !== ev.recordSha256
        ) {
          fail(
            409,
            "ArchiveIntegrityViolation",
            `Existing source audit event ${src.id} (seq ${String(src.sequence)}) conflicts with durable archive event ${ev.id} (seq ${ev.sequence}).`,
          );
        }
      }
    }

    const batchExistsInDb = dbBatches.some((b) => b.id === bundle.batch.id);
    if (!batchExistsInDb) {
      await insertBatchAndEventsToDb(tx, bundle.batch, bundle.events);
      recoveredBatchCount += 1;
      recoveredLedgerEventCount += bundle.events.length;
    } else {
      // Check if any archived_audit_events rows for this batch were missing
      const existingArchivedRes = await tx.query<{ id: string }>(
        `SELECT id FROM owner_audit_archive.archived_audit_events WHERE batch_id = $1`,
        [bundle.batch.id],
      );
      const existingIds = new Set(existingArchivedRes.rows.map((r) => r.id));
      for (const p of bundle.events) {
        if (!existingIds.has(p.id)) {
          await tx.query(
            `INSERT INTO owner_audit_archive.archived_audit_events (
               id, batch_id, sequence, actor_id, event_type, target_type, target_id,
               occurred_at, minimum_retained_until, outcome, security_incident,
               incident_status, reason, before_state, after_state, archived_at, record_sha256
             )
             VALUES (
               $1, $2, $3, $4, $5, $6, $7,
               $8::timestamptz, $9::timestamptz, $10, $11,
               $12, $13, $14, $15, $16::timestamptz, $17
             )`,
            [
              p.id,
              bundle.batch.id,
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
              p.archivedAt,
              p.recordSha256,
            ],
          );
          recoveredLedgerEventCount += 1;
        }
      }
    }
  }

  if (recoveredSourceEventCount > 0) {
    await tx.query(
      `SELECT setval(
         pg_get_serial_sequence('owner.audit_events', 'sequence'),
         GREATEST((SELECT COALESCE(MAX(sequence), 1) FROM owner.audit_events), 1),
         true
       )`,
    );
  }

  // 2. If PostgreSQL ledger has verified batches beyond the durable store (e.g. replaced archive volume),
  // verify them against source and rehydrate the missing durable batch files.
  if (dbBatches.length > durable.bundles.length) {
    const dbVerified = await verifyDbLedgerOnly(tx);
    for (let i = durable.bundles.length; i < dbVerified.batches.length; i++) {
      const item = dbVerified.batches[i]!;
      await durableStore.persistBatch({
        batch: item.batch,
        events: item.events,
      });
      rehydratedDurableBatchCount += 1;
    }
  }

  const finalVerify = await verifyArchiveLedgerInternal(tx, durableStore);

  await audit(tx, {
    actor: actor.id,
    type: "AUDIT_ARCHIVE_RECOVERED",
    targetType: "AuditArchiveBatch",
    targetId: finalVerify.latestBatchId ?? "EMPTY_ARCHIVE",
    reason: recoveryReason,
    after: {
      archiveBatchId: finalVerify.latestBatchId,
      recoveredBatchCount,
      recoveredSourceEventCount,
      recoveredLedgerEventCount,
      rehydratedDurableBatchCount,
      archivedCount: finalVerify.verifiedEventCount,
      lastSequence: finalVerify.lastArchivedSequence,
      batchDigestSha256: finalVerify.latestBatchDigestSha256,
      bundleDigestSha256: finalVerify.latestBundleDigestSha256,
      archiveVerified: true,
    },
  });

  return {
    verified: true,
    recoveredBatchCount,
    recoveredSourceEventCount,
    recoveredLedgerEventCount,
    rehydratedDurableBatchCount,
    batchCount: finalVerify.batchCount,
    verifiedEventCount: finalVerify.verifiedEventCount,
    latestBatchId: finalVerify.latestBatchId,
    latestBatchDigestSha256: finalVerify.latestBatchDigestSha256,
    latestBundleDigestSha256: finalVerify.latestBundleDigestSha256,
    lastArchivedSequence: finalVerify.lastArchivedSequence,
  };
}
