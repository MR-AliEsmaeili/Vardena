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
  evidenceBasis: 'OPERATOR_OBSERVED';
  cryptographicVerification: 'NOT_IMPLEMENTED';
  signedArtifactProduced: false;
  customerServerContacted: false;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  transitions?: OperationTransition[];
}
export type AuditTargetType =
  'Customer' | 'OperationalRecord' | 'User' | 'AuditArchiveBatch';
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
    archiveStorageBoundary: 'SEPARATE_POSTGRES_SCHEMA_AND_EXPORTABLE_BUNDLE';
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
    cleanupEligibleEventCount: 0;
  };
  integrity: {
    verified: boolean;
    latestBatchId: string | null;
    latestBatchDigestSha256: string | null;
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
  lastArchivedSequence: number | null;
}
