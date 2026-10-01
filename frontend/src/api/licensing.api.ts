import { apiGet, apiPost } from './client';
import type {
  ActivateLicenseRequest,
  LicenseActivationResult,
  LicenseState,
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
 * Installation license activation (`POST /api/v1/license/activate`, L-02).
 *
 * The raw code travels exactly once, in the request body of this call: it is
 * never put in the URL, in a query string, in a header, in a log line or in
 * any browser storage, and the only thing kept afterwards is the backend's
 * own evaluated answer. The backend verifies the signature, the installation
 * binding and the lifecycle and persists the license — this function does no
 * validation beyond transporting the string.
 *
 * The response is a receipt (`LicenseActivationResult`): callers must re-read
 * `GET /license/current` for the authoritative state instead of treating a
 * 200 here as "the installation is licensed".
 */
export function activateLicense(
  request: ActivateLicenseRequest,
): Promise<LicenseActivationResult> {
  return apiPost<LicenseActivationResult, ActivateLicenseRequest>(
    '/license/activate',
    request,
  );
}
