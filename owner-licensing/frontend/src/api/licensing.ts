import { apiClient, apiGet, apiPost } from './client';

/**
 * Owner-side license lifecycle (OD-LIC-07…19).
 *
 * The browser never holds a private key, never signs and never invents a
 * success: it prepares an unsigned request, shows the full digests the operator
 * must carry to the offline signer, uploads the returned artifact for the
 * backend to verify and archive, and downloads what the backend stored.
 */

export type LicenseKind = 'TIME_LIMITED' | 'PERPETUAL';
export type RevocationReason =
  | 'NON_PAYMENT'
  | 'CONTRACT_TERMINATION'
  | 'FRAUD'
  | 'KEY_COMPROMISE'
  | 'ISSUED_IN_ERROR'
  | 'COURT_ORDER'
  | 'OTHER';

export interface IssuanceRevocation {
  revocationId: string;
  reason: RevocationReason;
  status: 'REQUEST_PREPARED' | 'SIGNED_RECORDED' | 'ABANDONED';
  importedAt: string | null;
}

export interface Issuance {
  id: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  licenseId: string;
  operationId: string;
  installationIdentityId: string;
  installationId: string;
  licenseKind: LicenseKind;
  validFrom: string;
  validUntil: string | null;
  organizationLimit: number | null;
  userLimit: number | null;
  deviceLimit: number | null;
  deviceLimitSpecified: boolean;
  modules: string[];
  features: string[];
  limitProfileId: string | null;
  signingKeyId: string | null;
  supersedesOperationId: string | null;
  renewsOperationId: string | null;
  status: 'REQUEST_PREPARED' | 'SIGNED_RECORDED' | 'ABANDONED';
  protocolVersion: 'VLIC2';
  requestPayloadSha256: string;
  requestBindingSha256: string;
  requestedAt: string;
  requestedBy: string;
  signedAt: string | null;
  importedAt: string | null;
  importedBy: string | null;
  artifactSha256: string | null;
  artifactAvailable: boolean;
  requestAgeDays: number;
  customerImportAdvisory: 'IMPORTABLE' | 'TERM_ENDED';
  revocation: IssuanceRevocation | null;
  signedArtifactProduced: boolean;
}

export interface Revocation {
  revocationId: string;
  issuanceId: string;
  licenseId: string;
  targetOperationId: string;
  customerId: string;
  customerCode: string;
  installationId: string;
  reason: RevocationReason;
  reasonDetail: string | null;
  effect: 'LICENSE_ONLY';
  protocolVersion: 'VREV1';
  signingKeyId: string | null;
  status: 'REQUEST_PREPARED' | 'SIGNED_RECORDED' | 'ABANDONED';
  issuedAt: string;
  requestPayloadSha256: string;
  requestBindingSha256: string;
  requestedAt: string;
  artifactSha256: string | null;
  artifactAvailable: boolean;
  signedArtifactProduced: boolean;
  reactivationPermitted: false;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
}

/**
 * A registered installation identity (OD-LIC-09).
 *
 * `bindingEvidence` is a constant in the wire contract and is deliberately
 * copied into the type: the identifier is an operator-confirmed claim read from
 * the customer Vardena page, never cryptographic proof of possession
 * (ADR-0048 Decision 5).
 */
export interface InstallationIdentity {
  id: string;
  customerId: string;
  installationId: string;
  source: string;
  sourceDetail: string | null;
  confirmedBy: string;
  confirmedAt: string;
  confirmationEvidenceRef: string | null;
  status: 'ACTIVE' | 'RETIRED';
  createdBy: string;
  createdAt: string;
  bindingEvidence: 'OPERATOR_RECORDED_NOT_CRYPTOGRAPHIC';
}

export interface InstallationIdentityList {
  customerId: string;
  items: InstallationIdentity[];
}

export interface RegisterInstallationIdentityInput {
  customerId: string;
  /** ULID read from the customer deployment's licensing screen. */
  installationId: string;
  source: 'CUSTOMER_VARDENA_SCREEN';
  sourceDetail?: string;
  /** Must be re-entered identically; the backend refuses a single paste. */
  confirmationInstallationId: string;
  confirmationEvidenceRef?: string;
  confirmed: true;
}

/**
 * A customer limit profile (F-1, OD-LIC-13, OD-LIC-14).
 *
 * `null` ceilings mean “no stored ceiling”, which is **not** the same as
 * “issuance forbidden”. The columns are immutable after creation; a change is
 * retire-plus-create, and reactivating the same retired row restores the
 * identical ceiling.
 */
export interface LimitProfile {
  id: string;
  customerId: string;
  organizationLimit: number | null;
  userLimit: number | null;
  allowedModules: string[];
  perpetualAllowed: boolean;
  status: 'ACTIVE' | 'RETIRED';
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface LimitProfileList {
  customerId: string;
  activeProfile: LimitProfile | null;
  items: LimitProfile[];
}

export interface CreateLimitProfileInput {
  organizationLimit: number | null;
  userLimit: number | null;
  allowedModules: string[];
  perpetualAllowed: boolean;
}

export const MODULE_CODES = [
  'accounting',
  'documents',
  'inventory',
  'organization',
  'rbac',
  'users',
  'workflow',
] as const;

export const REVOCATION_REASONS: readonly RevocationReason[] = [
  'NON_PAYMENT',
  'CONTRACT_TERMINATION',
  'FRAUD',
  'KEY_COMPROMISE',
  'ISSUED_IN_ERROR',
  'COURT_ORDER',
  'OTHER',
];

export const issuances = (
  page: number,
  filters: { customerId?: string } = {},
  signal?: AbortSignal,
) =>
  apiGet<Paginated<Issuance>>('/license-issuances', {
    params: { page, customerId: filters.customerId || undefined },
    ...(signal ? { signal } : {}),
  });

/** Registered installations of one customer (OD-LIC-09). */
export const installationIdentities = (
  customerId: string,
  signal?: AbortSignal,
) =>
  apiGet<InstallationIdentityList>(
    `/customers/${encodeURIComponent(customerId)}/installation-identities`,
    signal ? { signal } : {},
  );

export const registerInstallationIdentity = (
  body: RegisterInstallationIdentityInput,
) => apiPost<InstallationIdentityList>('/installation-identities', body);

export const retireInstallationIdentity = (
  id: string,
  body: { reason: string },
) =>
  apiPost<InstallationIdentityList>(
    `/installation-identities/${encodeURIComponent(id)}/retire`,
    body,
  );

export const limitProfiles = (customerId: string, signal?: AbortSignal) =>
  apiGet<LimitProfileList>(
    `/customers/${encodeURIComponent(customerId)}/limit-profiles`,
    signal ? { signal } : {},
  );

export const createLimitProfile = (
  customerId: string,
  body: CreateLimitProfileInput,
) =>
  apiPost<LimitProfile>(
    `/customers/${encodeURIComponent(customerId)}/limit-profiles`,
    body,
  );

export const retireLimitProfile = (id: string, body: { reason: string }) =>
  apiPost<LimitProfileList>(
    `/limit-profiles/${encodeURIComponent(id)}/retire`,
    body,
  );

export const reactivateLimitProfile = (id: string, body: { reason: string }) =>
  apiPost<LimitProfileList>(
    `/limit-profiles/${encodeURIComponent(id)}/reactivate`,
    body,
  );

export interface PrepareIssuanceInput {
  customerId: string;
  installationIdentityId: string;
  /** `null` means perpetual; a time-limited license sends a canonical instant. */
  validUntil: string | null;
  organizationLimit: number | null;
  userLimit: number | null;
  deviceLimit: number | null;
  deviceLimitSpecified: boolean;
  modules: string[];
  features: string[];
  signingKeyId: string;
  supersedesOperationId: string | null;
  renewsOperationId: string | null;
}

export interface PreparedRequest<T> {
  requestPayloadSha256: string;
  requestBindingSha256: string;
  requestFileName: string;
  unsignedRequest: true;
  signedArtifactProduced: false;
  issuance?: T;
  revocation?: T;
}

export const prepareIssuance = (body: PrepareIssuanceInput) =>
  apiPost<PreparedRequest<Issuance>, PrepareIssuanceInput>(
    '/license-issuances',
    body,
  );

export const issuance = (id: string, signal?: AbortSignal) =>
  apiGet<Issuance>(
    `/license-issuances/${encodeURIComponent(id)}`,
    signal ? { signal } : {},
  );

export const issuanceRequest = (id: string) =>
  apiGet<{
    fileName: string;
    fileContent: string;
    requestPayloadSha256: string;
    requestBindingSha256: string;
  }>(`/license-issuances/${encodeURIComponent(id)}/request`);

export const importIssuanceArtifact = (id: string, fileContent: string) =>
  apiPost<{ issuance: Issuance; replayed: boolean; historicalResult: boolean }>(
    `/license-issuances/${encodeURIComponent(id)}/import`,
    { fileContent },
  );

export const abandonIssuance = (id: string, reason: string) =>
  apiPost<Issuance>(`/license-issuances/${encodeURIComponent(id)}/abandon`, {
    reason,
  });

export const prepareRevocation = (
  issuanceId: string,
  body: {
    reason: RevocationReason;
    reasonDetail: string | null;
    signingKeyId: string;
  },
) =>
  apiPost<PreparedRequest<Revocation>, typeof body>(
    `/license-issuances/${encodeURIComponent(issuanceId)}/revocations`,
    body,
  );

export const revocationRequest = (id: string) =>
  apiGet<{
    fileName: string;
    fileContent: string;
    requestPayloadSha256: string;
    requestBindingSha256: string;
  }>(`/license-revocations/${encodeURIComponent(id)}/request`);

export const importRevocationArtifact = (id: string, fileContent: string) =>
  apiPost<{ revocation: Revocation; replayed: boolean }>(
    `/license-revocations/${encodeURIComponent(id)}/import`,
    { fileContent },
  );

/** Exact bytes the Owner API archived, fetched through the session cookie. */
export async function downloadArtifact(
  kind: 'license-issuances' | 'license-revocations',
  id: string,
): Promise<Blob> {
  const response = await apiClient.get<Blob>(
    `/${kind}/${encodeURIComponent(id)}/artifact`,
    { responseType: 'blob' },
  );
  return response.data;
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
