import type { AxiosRequestConfig } from 'axios';
import { apiGet, apiPost } from './client';
import type {
  ClientDevice,
  ClientDeviceHistory,
  ClientDeviceInventory,
  CreateDeviceEnrollmentChallengeRequest,
  CreateDeviceReplacementChallengeRequest,
  DeviceEnrollmentChallenge,
  DeviceReplacementChallenge,
  DeviceReplacementCompletion,
  DeviceReplacementRequestExport,
  DeviceReplacementResult,
  ImportDeviceReplacementResponseRequest,
  ImportLicenseDocumentRequest,
  LicenseImportResult,
  LicenseState,
  ProveDeviceEnrollmentRequest,
  ProveDeviceReplacementRequest,
} from './contracts';

/**
 * Licensing self-read (`backend/src/modules/licensing`, ADR-0030).
 *
 * `GET /api/v1/license/current` is an authenticated bootstrap read that needs
 * no RBAC permission — it is the backend's own evaluated, non-secret license
 * state. It is consumed here as a UX signal only (same contract as
 * `getEffectivePermissions`): the backend re-evaluates the same license on
 * every licensed capability (e.g. `OrganizationsService.createOrganization`)
 * regardless of what this read reports, so nothing here is ever a security
 * boundary.
 */
export function getLicenseState(signal?: AbortSignal): Promise<LicenseState> {
  return apiGet<LicenseState>('/license/current', signal ? { signal } : {});
}

/**
 * Signed license import (`POST /api/v1/license/import`, L-03, ADR-0046).
 *
 * One route for every license a customer receives: the signed file envelope,
 * a bare VLIC2 artifact, or a legacy VLIC1 code. The document travels exactly
 * once, in the request body of this call: it is never put in the URL, in a
 * query string, in a header, in a log line or in any browser storage, and the
 * only thing kept afterwards is the backend's own evaluated answer.
 *
 * The backend verifies the signature against its trusted keys, the
 * installation binding, the payload (window, limits, entitlements) and the
 * position of the document in the retained version history — this function
 * does no validation beyond transporting the string. A future-dated document
 * is retained and becomes effective at its own `validFrom`; a repeated
 * operation is refused with 409 and changes nothing.
 *
 * The response is a receipt (`LicenseImportResult`): callers must re-read
 * `GET /license/current` for the authoritative state instead of treating a
 * 200 here as "the installation is licensed".
 */
export function importLicenseDocument(
  request: ImportLicenseDocumentRequest,
): Promise<LicenseImportResult> {
  return apiPost<LicenseImportResult, ImportLicenseDocumentRequest>(
    '/license/import',
    request,
    // The license import form owns its own «در حال بررسی و ثبت مجوز…» state;
    // a second generic global announcement would be duplicate feedback.
    { vardenaRequestActivity: { scope: 'background' } },
  );
}

/**
 * Device lifecycle commands are explicit, user-initiated exchanges; none of
 * them is a routine save, so they report the neutral `processing` message.
 */
const DEVICE_ACTIVITY: AxiosRequestConfig = {
  vardenaRequestActivity: { message: 'processing' },
};

/** Retained installation-wide client-device inventory and signed quota. */
export function getClientDeviceInventory(
  signal?: AbortSignal,
): Promise<ClientDeviceInventory> {
  return apiGet<ClientDeviceInventory>(
    '/license/devices',
    signal ? { signal } : {},
  );
}

/** One device's retained lifecycle audit history. */
export function getClientDeviceHistory(
  deviceId: string,
  signal?: AbortSignal,
): Promise<ClientDeviceHistory> {
  return apiGet<ClientDeviceHistory>(
    `/license/devices/${encodeURIComponent(deviceId)}/history`,
    signal ? { signal } : {},
  );
}

/** Start Ed25519 proof-of-possession enrollment without sending a private key. */
export function createDeviceEnrollmentChallenge(
  request: CreateDeviceEnrollmentChallengeRequest,
): Promise<DeviceEnrollmentChallenge> {
  return apiPost<
    DeviceEnrollmentChallenge,
    CreateDeviceEnrollmentChallengeRequest
  >('/license/devices/enrollment-challenges', request, DEVICE_ACTIVITY);
}

/** Verify the device's detached signature and activate its retained row. */
export function activateDeviceEnrollment(
  challengeId: string,
  request: ProveDeviceEnrollmentRequest,
): Promise<ClientDevice> {
  return apiPost<ClientDevice, ProveDeviceEnrollmentRequest>(
    `/license/devices/enrollment-challenges/${encodeURIComponent(challengeId)}/activate`,
    request,
    DEVICE_ACTIVITY,
  );
}

/** Explicitly deactivate an active device; its history remains retained. */
export function deactivateClientDevice(
  deviceId: string,
): Promise<ClientDevice> {
  return apiPost<ClientDevice>(
    `/license/devices/${encodeURIComponent(deviceId)}/deactivate`,
    undefined,
    DEVICE_ACTIVITY,
  );
}

/** Start the offline signed replacement exchange for an active device. */
export function createDeviceReplacementChallenge(
  oldDeviceId: string,
  request: CreateDeviceReplacementChallengeRequest,
): Promise<DeviceReplacementChallenge> {
  return apiPost<
    DeviceReplacementChallenge,
    CreateDeviceReplacementChallengeRequest
  >(
    `/license/devices/${encodeURIComponent(oldDeviceId)}/replacement-challenges`,
    request,
    DEVICE_ACTIVITY,
  );
}

/** Submit the new device's detached proof and obtain the signed VDRQ1 export. */
export function proveDeviceReplacement(
  requestId: string,
  request: ProveDeviceReplacementRequest,
): Promise<DeviceReplacementRequestExport> {
  return apiPost<DeviceReplacementRequestExport, ProveDeviceReplacementRequest>(
    `/license/devices/replacements/${encodeURIComponent(requestId)}/prove`,
    request,
    DEVICE_ACTIVITY,
  );
}

/** Re-export the retained request while its signed lifecycle remains pending. */
export function exportDeviceReplacementRequest(
  requestId: string,
  signal?: AbortSignal,
): Promise<DeviceReplacementRequestExport> {
  return apiGet<DeviceReplacementRequestExport>(
    `/license/devices/replacements/${encodeURIComponent(requestId)}/export`,
    signal ? { signal } : {},
  );
}

/** Verify and atomically import an authority-signed VDRP1 response. */
export function importDeviceReplacementResponse(
  request: ImportDeviceReplacementResponseRequest,
): Promise<DeviceReplacementCompletion> {
  return apiPost<
    DeviceReplacementCompletion,
    ImportDeviceReplacementResponseRequest
  >('/license/devices/replacements/import', request, DEVICE_ACTIVITY);
}

/** Terminally cancel a challenge or pending replacement request. */
export function cancelDeviceReplacement(
  requestId: string,
): Promise<DeviceReplacementResult> {
  return apiPost<DeviceReplacementResult>(
    `/license/devices/replacements/${encodeURIComponent(requestId)}/cancel`,
    undefined,
    DEVICE_ACTIVITY,
  );
}
