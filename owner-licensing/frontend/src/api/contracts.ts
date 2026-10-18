/** Owner-only wire contract. API integration tests exercise the matching response shapes. */
export type Role = 'OWNER_ADMIN' | 'LICENSE_OPERATOR';
export interface AuthenticatedUser {
  id: string;
  username: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}
export interface LoginRequest {
  username: string;
  password: string;
}
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
export interface EffectivePermissions {
  permissions: string[];
}
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total?: number;
}
/** Base customer identity and lifecycle status fields. */
export interface CustomerIdentity {
  id: string;
  customerCode: string;
  displayName: string;
  status: 'ACTIVE' | 'INACTIVE';
}
export interface Customer extends CustomerIdentity {
  contractReference: string;
  /** PDR-18 §1: commercial contract dates, independent of technical validity. */
  contractStartDate: string | null;
  contractEndDate: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}
export type CustomerRead = CustomerIdentity | Customer;
export interface CustomerInput {
  customerCode: string;
  displayName: string;
  status: 'ACTIVE' | 'INACTIVE';
  contractReference: string;
  contractStartDate?: string;
  contractEndDate?: string;
}
export interface OperationTransition {
  id: string;
  actorId: string;
  occurredAt: string;
  priorStatus: string;
  newStatus: string;
  reason: string;
  evidenceReference: string | null;
  confirmationKind: 'OPERATOR_OBSERVED';
}
/** Manual observation only. Never a signed artifact or cryptographic receipt. */
export interface OperationalRecord {
  id: string;
  customerId: string;
  customerCode: string;
  displayName: string;
  kind: 'LICENSE' | 'SERVER_REPLACEMENT';
  observationCategory: string;
  observedStatus: string;
  installationReference: string | null;
  oldInstallationReference: string | null;
  replacementInstallationReference: string | null;
  oldServerObservedState: string | null;
  replacementObservedState: string | null;
  emergencyOldServerLost: boolean;
  replacesRecordId: string | null;
  /**
   * PDR-18 §1 + PDR-17: Owner-side OBSERVATION metadata, never a claim about a
   * signed artifact. `recordedOn` is the UTC calendar day on which an operator
   * recorded this observation (derived by the server from the immutable
   * `createdAt` instant) — it is NOT the license's actual issuance or
   * activation date, which this application cannot verify.
   * `observedValidityEnd` is the validity end the operator recorded having
   * seen; null means no end was recorded.
   */
  recordedOn: string | null;
  observedValidityEnd: string | null;
  evidenceBasis: 'OPERATOR_OBSERVED';
  cryptographicVerification: 'NOT_IMPLEMENTED';
  signedArtifactProduced: false;
  customerServerContacted: false;
  /**
   * OQ-74 (2026-10-18): the signing key an operator observed on the license
   * artifact. Null when no key was recorded (the safety status will surface as
   * UNKNOWN). Only meaningful for LICENSE observations; always null for
   * SERVER_REPLACEMENT.
   */
  signingKeyId: string | null;
  /**
   * The current administrative status of the signing key, derived from a
   * live DB lookup at read time (no denormalized column to drift). Null when
   * no signing key was recorded or the key is not registered in
   * `owner.signing_keys`.
   */
  signingKeyStatus: 'ACTIVE' | 'COMPROMISED' | 'REVOKED' | null;
  /**
   * Derived safety status of this license observation, computed by the server
   * from `signingKeyStatus`:
   *   - SAFE         — signed with an ACTIVE key
   *   - NEEDS_REVIEW — signed with a COMPROMISED or REVOKED key
   *   - UNKNOWN      — no signing key recorded or key not registered
   */
  signingKeySafety: 'SAFE' | 'NEEDS_REVIEW' | 'UNKNOWN';
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  transitions?: OperationTransition[];
}
/** OQ-74: administrative record of an Owner signing key. No private material. */
export interface SigningKey {
  id: string;
  label: string;
  status: 'ACTIVE' | 'COMPROMISED' | 'REVOKED';
  /** ISO instant when the current status was detected/recorded. Null while ACTIVE. */
  statusDetectedAt: string | null;
  /** Operator reason for the latest status change. Null while ACTIVE. */
  statusReason: string | null;
  /** Optional reference to external evidence (ticket URL, doc id, etc.). */
  evidenceRef: string | null;
  /** Free-form notes about this key. Bounded. */
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}
export type AuditTargetType =
  | 'Customer'
  | 'OperationalRecord'
  | 'User'
  | 'AuditArchiveBatch'
  | 'SigningKey';
export type AuditOutcome = 'SUCCESS' | 'DENIED';
export type AuditIncidentStatus = 'NONE' | 'UNRESOLVED';
export interface AuditEvent {
  id: string;
  actorId: string | null;
  eventType: string;
  targetType: string;
  targetId: string | null;
  occurredAt: string;
  minimumRetainedUntil?: string;
  securityIncident?: boolean;
  incidentStatus?: AuditIncidentStatus;
  archived?: boolean;
  archiveBatchId?: string | null;
  outcome: AuditOutcome;
  reason: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
}
/** Query contract of `GET /audit-events`. Every filter is optional; `page` is 1-based. */
export interface AuditQuery {
  page: number;
  eventType?: string;
  actorId?: string;
  targetType?: AuditTargetType;
  targetId?: string;
  outcome?: AuditOutcome;
  /** Inclusive canonical UTC instant. */
  occurredFrom?: string;
  /** Exclusive canonical UTC instant. */
  occurredBefore?: string;
}
/** Audit pages carry `hasNext` from the backend; no total is computed over the append-only table. */
export interface AuditPage {
  items: AuditEvent[];
  page: number;
  pageSize: number;
  hasNext: boolean;
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
export interface AuditArchiveBatchPage {
  items: ArchiveBatchSummary[];
  page: number;
  pageSize: number;
  hasNext: boolean;
}
export interface AuditArchiveStatusReport {
  asOf: string;
  policy: {
    appendOnly: true;
    minimumRetentionYears: 3;
    threeYearMinimumIsPurgeDate: false;
    unresolvedSecurityIncidentsExcludedFromCleanup: true;
    permanentSeparateArchiveInForce: true;
    automaticDestructivePurgeEnabled: false;
    archiveStorageBoundary: 'INDEPENDENT_DURABLE_FILESYSTEM_STORE_AND_POSTGRES_LEDGER';
    cryptographicHardwareWormImplemented: false;
  };
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
export interface CreateAuditArchiveBatchResult {
  status: 'ARCHIVED' | 'NO_ELIGIBLE_EVENTS';
  archivedCount: number;
  batch: ArchiveBatchSummary | null;
}
export interface VerifyAuditArchiveResult {
  verified: true;
  batchCount: number;
  verifiedEventCount: number;
  latestBatchId: string | null;
  latestBatchDigestSha256: string | null;
  latestBundleDigestSha256: string | null;
  lastArchivedSequence: number | null;
}
export interface RecoverAuditArchiveResult {
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
