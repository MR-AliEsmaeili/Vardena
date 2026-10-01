import { apiGet, apiPost, cleanParams } from './client';
import type {
  Branch,
  CreateOrganizationRequest,
  GrantMembershipRequest,
  Organization,
  Paginated,
} from './contracts';

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
 * Create an organization (`POST /organizations`).
 *
 * Ordinary `Organization.Organization.Create` administration, not a
 * first-install special case: the backend refuses this call outright when
 * the deployment is pinned (`DEPLOYMENT_ORGANIZATION_ID`, ADR-0025) and
 * otherwise applies its normal code/name validation. The caller does not
 * become a member of the created organization by this call alone — that is
 * `grantMembership`, a separate ODR-3 authorization act (Task 19).
 */
export function createOrganization(
  body: CreateOrganizationRequest,
): Promise<Organization> {
  return apiPost<Organization, CreateOrganizationRequest>(
    '/organizations',
    body,
  );
}

/**
 * Grant a user membership of an organization
 * (`POST /organizations/:id/members`).
 *
 * Ordinary `Organization.Membership.Grant` administration (Task 19, ODR-3).
 * The backend's own first-member bootstrap exception is what lets a caller
 * who is not yet a member of ANY organization grant themselves the first
 * membership of a newly created, still-empty organization; nothing on the
 * frontend re-implements or relaxes that rule.
 */
export function grantMembership(
  organizationId: string,
  body: GrantMembershipRequest,
): Promise<void> {
  return apiPost<void, GrantMembershipRequest>(
    `/organizations/${encodeURIComponent(organizationId)}/members`,
    body,
  );
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
