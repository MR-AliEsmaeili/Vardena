import { apiGet, cleanParams } from './client';
import type { Branch, Organization, Paginated } from './contracts';

/**
 * Organization read surface (`backend/src/modules/organization`).
 *
 * `GET /organizations` is the only organization discovery endpoint the API
 * exposes to a session. Its behavior is deployment-defined (ADR-0025): a
 * deployment pinned with `DEPLOYMENT_ORGANIZATION_ID` returns exactly its own
 * organization, an unpinned one returns the organization list. The UI follows
 * whatever the contract returns — one organization ⇒ fixed context, several
 * ⇒ a switcher — and never treats the selection as authorization: every
 * organization-scoped request carries `organizationId` and the backend
 * re-asserts it through `assertOrganizationInScope` (Task 19, ODR-3).
 */

/** Hard page cap of the backend list contract (`MAX_PAGE_SIZE`). */
export const MAX_PAGE_SIZE = 500;

export function listOrganizations(
  params: { isActive?: boolean; pageSize?: number } = {},
  signal?: AbortSignal,
): Promise<Paginated<Organization>> {
  return apiGet<Paginated<Organization>>('/organizations', {
    params: cleanParams({
      isActive: params.isActive,
      page: 1,
      pageSize: params.pageSize ?? 100,
      sort: 'code:asc',
    }),
    ...(signal ? { signal } : {}),
  });
}

/**
 * One branch of the organization — the reference read behind a document's
 * optional header `branchId` (display only; the field itself stays a raw id
 * in the document contract).
 */
export function getBranch(
  organizationId: string,
  branchId: string,
  signal?: AbortSignal,
): Promise<Branch> {
  return apiGet<Branch>(`/branches/${encodeURIComponent(branchId)}`, {
    params: { organizationId },
    ...(signal ? { signal } : {}),
  });
}
