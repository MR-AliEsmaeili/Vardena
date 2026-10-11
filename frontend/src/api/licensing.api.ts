import { apiGet, apiPost } from './client';
import type {
  ImportLicenseDocumentRequest,
  LicenseImportResult,
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
  );
}
