import { apiGet, apiPost, apiPatch } from './client';
import type {
  AuditArchiveBatchPage,
  AuditArchiveStatusReport,
  AuditPage,
  AuditQuery,
  AuthenticatedUser,
  CreateAuditArchiveBatchResult,
  Customer,
  CustomerRead,
  CustomerInput,
  OperationalRecord,
  Paginated,
  RecoverAuditArchiveResult,
  Role,
  VerifyAuditArchiveResult,
} from './contracts';
export const customers = (search: string, page: number, signal?: AbortSignal) =>
  apiGet<Paginated<CustomerRead>>('/customers', {
    params: { search: search || undefined, page },
    ...(signal ? { signal } : {}),
  });
export const customer = (id: string, signal?: AbortSignal) =>
  apiGet<CustomerRead>(
    `/customers/${encodeURIComponent(id)}`,
    signal ? { signal } : {},
  );
export const createCustomer = (body: CustomerInput) =>
  apiPost<Customer, CustomerInput>('/customers', body);
export const updateCustomer = (
  id: string,
  body: Omit<CustomerInput, 'customerCode'> & { reason: string },
) => apiPatch<Customer>(`/customers/${encodeURIComponent(id)}`, body);
export const users = (page: number) =>
  apiGet<Paginated<AuthenticatedUser>>('/users', { params: { page } });
export const createUser = (body: {
  username: string;
  password: string;
  role: Role;
}) => apiPost<AuthenticatedUser>('/users', body);
export const updateUser = (
  id: string,
  body: { role: Role; isActive: boolean; reason: string },
) => apiPatch<AuthenticatedUser>(`/users/${encodeURIComponent(id)}`, body);
export const resetPassword = (
  id: string,
  body: { password: string; reason: string },
) =>
  apiPost<AuthenticatedUser>(
    `/users/${encodeURIComponent(id)}/reset-password`,
    body,
  );
export const operationalRecords = (
  search: string,
  page: number,
  filters: { kind?: string; status?: string; customerId?: string },
  signal?: AbortSignal,
) =>
  apiGet<Paginated<OperationalRecord>>('/operational-records', {
    params: {
      search: search || undefined,
      page,
      kind: filters.kind || undefined,
      status: filters.status || undefined,
      customerId: filters.customerId || undefined,
    },
    ...(signal ? { signal } : {}),
  });
export const operationalRecord = (id: string, signal?: AbortSignal) =>
  apiGet<OperationalRecord>(
    `/operational-records/${encodeURIComponent(id)}`,
    signal ? { signal } : {},
  );
export const recordLicenseObservation = (body: {
  customerId: string;
  installationReference: string;
  reason: string;
  evidenceReference?: string;
  /**
   * The validity end the operator recorded having seen (EXCLUSIVE). There is
   * deliberately no `recordedOn` field: the recording day is derived by the
   * server and can never be supplied by a client.
   */
  observedValidityEnd?: string;
}) =>
  apiPost<OperationalRecord>('/operational-records/license-observations', body);
export const recordActivationObservation = (
  id: string,
  body: { reason: string; evidenceReference?: string },
) =>
  apiPost<OperationalRecord>(
    `/operational-records/${encodeURIComponent(id)}/activation-observations`,
    body,
  );
export const recordServerReplacement = (body: {
  customerId: string;
  oldInstallationReference: string;
  replacementInstallationReference: string;
  reason: string;
  evidenceReference?: string;
  emergencyOldServerLost: boolean;
  replacesRecordId?: string;
}) =>
  apiPost<OperationalRecord>('/operational-records/server-replacements', body);
export const recordOldServerObservation = (
  id: string,
  body: {
    reason: string;
    evidenceReference?: string;
    oldServerObservedState: 'DEACTIVATION_OBSERVED';
  },
) =>
  apiPost<OperationalRecord>(
    `/operational-records/${encodeURIComponent(id)}/old-server-observations`,
    body,
  );
export const recordReplacementObservation = (
  id: string,
  body: {
    reason: string;
    evidenceReference?: string;
    replacementObservedState: 'INSTALLATION_OBSERVED';
  },
) =>
  apiPost<OperationalRecord>(
    `/operational-records/${encodeURIComponent(id)}/replacement-observations`,
    body,
  );
export const auditEvents = (query: AuditQuery, signal?: AbortSignal) =>
  apiGet<AuditPage>('/audit-events', {
    // Undefined filters are omitted by Axios, so only applied criteria are sent.
    params: query,
    ...(signal ? { signal } : {}),
  });
export const auditArchiveStatus = (signal?: AbortSignal) =>
  apiGet<AuditArchiveStatusReport>(
    '/audit-archive/status',
    signal ? { signal } : {},
  );
export const auditArchiveBatches = (page = 1, signal?: AbortSignal) =>
  apiGet<AuditArchiveBatchPage>('/audit-archive/batches', {
    params: { page },
    ...(signal ? { signal } : {}),
  });
export const createAuditArchiveBatch = (body: {
  reason: string;
  maxEvents?: number;
}) => apiPost<CreateAuditArchiveBatchResult>('/audit-archive/batches', body);
export const verifyAuditArchive = (body: {
  reason: string;
  batchId?: string;
}) => apiPost<VerifyAuditArchiveResult>('/audit-archive/verify', body);
export const recoverAuditArchive = (body: { reason: string }) =>
  apiPost<RecoverAuditArchiveResult>('/audit-archive/recover', body);
