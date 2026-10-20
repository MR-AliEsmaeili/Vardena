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

export const issuances = (page: number, signal?: AbortSignal) =>
  apiGet<Paginated<Issuance>>('/license-issuances', {
    params: { page },
    ...(signal ? { signal } : {}),
  });

export const recordLimitProfiles = (customerId: string, signal?: AbortSignal) =>
  apiGet<{ items: unknown[] }>(
    `/customers/${encodeURIComponent(customerId)}/limit-profiles`,
    signal ? { signal } : {},
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
