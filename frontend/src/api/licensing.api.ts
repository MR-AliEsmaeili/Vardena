import { apiGet } from './client';
import type { LicenseState } from './contracts';

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
