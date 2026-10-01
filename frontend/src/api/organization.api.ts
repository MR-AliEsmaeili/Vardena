import { apiGet, apiPatch, apiPost, cleanParams } from './client';
import type {
  Branch,
  BranchListQuery,
  CreateBranchRequest,
  CreateDepartmentRequest,
  CreateEmployeeRequest,
  CreateOrganizationRequest,
  CreatePartyRequest,
  Department,
  DepartmentListQuery,
  Employee,
  EmployeeListQuery,
  GrantMembershipRequest,
  Organization,
  Paginated,
  Party,
  PartyListQuery,
  UpdateBranchRequest,
  UpdateDepartmentRequest,
  UpdateEmployeeRequest,
  UpdateOrganizationRequest,
  UpdatePartyRequest,
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

// ---------------------------------------------------------------------------
// Organization administration & master data (FE-ORG-01)
//
// One function per endpoint the organization module actually exposes
// (`backend/src/modules/organization/api/*.controller.ts`). There is NO
// generic `crudApi<Entity>()` helper: each domain owns its own signature, so
// the call sites read as the backend contract reads.
//
// Three contract facts are encoded here and must not be "improved" away:
// 1. **No DELETE exists** for any of these resources — the lifecycle is
//    `enable`/`disable` over `is_active` (master-data-strategy.md §7.4).
// 2. **Every branch/department/employee/party call carries `organizationId`**
//    (query parameter, or body on create). The backend re-asserts it through
//    `assertOrganizationInScope`, which answers 404 — never 403 — for an
//    organization outside the caller's scope.
// 3. The `/organizations/:id` operations take NO organization query: the id in
//    the path IS the organization, and a pinned deployment (ADR-0025) refuses
//    any id other than its own.
// ---------------------------------------------------------------------------

/** Sort fields the backend allow-lists per resource (`SORTABLE_FIELDS`). */
export const ORGANIZATION_SORT_FIELDS = [
  'code',
  'name',
  'createdAt',
  'updatedAt',
] as const;
export const BRANCH_SORT_FIELDS = ORGANIZATION_SORT_FIELDS;
export const DEPARTMENT_SORT_FIELDS = ORGANIZATION_SORT_FIELDS;
export const EMPLOYEE_SORT_FIELDS = [
  'employeeCode',
  'firstName',
  'lastName',
  'createdAt',
  'updatedAt',
] as const;
export const PARTY_SORT_FIELDS = [
  'code',
  'displayName',
  'createdAt',
  'updatedAt',
] as const;

/** Organization-scope query shared by every scoped read/write below. */
function scope(organizationId: string): { organizationId: string } {
  return { organizationId };
}

// --- Organization ----------------------------------------------------------

export function getOrganization(
  organizationId: string,
  signal?: AbortSignal,
): Promise<Organization> {
  return apiGet<Organization>(
    `/organizations/${encodeURIComponent(organizationId)}`,
    signal ? { signal } : {},
  );
}

export function updateOrganization(
  organizationId: string,
  body: UpdateOrganizationRequest,
): Promise<Organization> {
  return apiPatch<Organization, UpdateOrganizationRequest>(
    `/organizations/${encodeURIComponent(organizationId)}`,
    body,
  );
}

export function enableOrganization(
  organizationId: string,
): Promise<Organization> {
  return apiPost<Organization>(
    `/organizations/${encodeURIComponent(organizationId)}/enable`,
  );
}

export function disableOrganization(
  organizationId: string,
): Promise<Organization> {
  return apiPost<Organization>(
    `/organizations/${encodeURIComponent(organizationId)}/disable`,
  );
}

// --- Branch ----------------------------------------------------------------

export function listBranches(
  query: BranchListQuery,
  signal?: AbortSignal,
): Promise<Paginated<Branch>> {
  return apiGet<Paginated<Branch>>('/branches', {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

export function createBranch(body: CreateBranchRequest): Promise<Branch> {
  return apiPost<Branch, CreateBranchRequest>('/branches', body);
}

export function updateBranch(
  organizationId: string,
  branchId: string,
  body: UpdateBranchRequest,
): Promise<Branch> {
  return apiPatch<Branch, UpdateBranchRequest>(
    `/branches/${encodeURIComponent(branchId)}`,
    body,
    { params: scope(organizationId) },
  );
}

export function enableBranch(
  organizationId: string,
  branchId: string,
): Promise<Branch> {
  return apiPost<Branch>(
    `/branches/${encodeURIComponent(branchId)}/enable`,
    undefined,
    { params: scope(organizationId) },
  );
}

export function disableBranch(
  organizationId: string,
  branchId: string,
): Promise<Branch> {
  return apiPost<Branch>(
    `/branches/${encodeURIComponent(branchId)}/disable`,
    undefined,
    { params: scope(organizationId) },
  );
}

// --- Department ------------------------------------------------------------

export function listDepartments(
  query: DepartmentListQuery,
  signal?: AbortSignal,
): Promise<Paginated<Department>> {
  return apiGet<Paginated<Department>>('/departments', {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

export function getDepartment(
  organizationId: string,
  departmentId: string,
  signal?: AbortSignal,
): Promise<Department> {
  return apiGet<Department>(
    `/departments/${encodeURIComponent(departmentId)}`,
    { params: scope(organizationId), ...(signal ? { signal } : {}) },
  );
}

export function createDepartment(
  body: CreateDepartmentRequest,
): Promise<Department> {
  return apiPost<Department, CreateDepartmentRequest>('/departments', body);
}

export function updateDepartment(
  organizationId: string,
  departmentId: string,
  body: UpdateDepartmentRequest,
): Promise<Department> {
  return apiPatch<Department, UpdateDepartmentRequest>(
    `/departments/${encodeURIComponent(departmentId)}`,
    body,
    { params: scope(organizationId) },
  );
}

export function enableDepartment(
  organizationId: string,
  departmentId: string,
): Promise<Department> {
  return apiPost<Department>(
    `/departments/${encodeURIComponent(departmentId)}/enable`,
    undefined,
    { params: scope(organizationId) },
  );
}

export function disableDepartment(
  organizationId: string,
  departmentId: string,
): Promise<Department> {
  return apiPost<Department>(
    `/departments/${encodeURIComponent(departmentId)}/disable`,
    undefined,
    { params: scope(organizationId) },
  );
}

// --- Employee --------------------------------------------------------------

export function listEmployees(
  query: EmployeeListQuery,
  signal?: AbortSignal,
): Promise<Paginated<Employee>> {
  return apiGet<Paginated<Employee>>('/employees', {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

export function getEmployee(
  organizationId: string,
  employeeId: string,
  signal?: AbortSignal,
): Promise<Employee> {
  return apiGet<Employee>(`/employees/${encodeURIComponent(employeeId)}`, {
    params: scope(organizationId),
    ...(signal ? { signal } : {}),
  });
}

export function createEmployee(body: CreateEmployeeRequest): Promise<Employee> {
  return apiPost<Employee, CreateEmployeeRequest>('/employees', body);
}

export function updateEmployee(
  organizationId: string,
  employeeId: string,
  body: UpdateEmployeeRequest,
): Promise<Employee> {
  return apiPatch<Employee, UpdateEmployeeRequest>(
    `/employees/${encodeURIComponent(employeeId)}`,
    body,
    { params: scope(organizationId) },
  );
}

export function enableEmployee(
  organizationId: string,
  employeeId: string,
): Promise<Employee> {
  return apiPost<Employee>(
    `/employees/${encodeURIComponent(employeeId)}/enable`,
    undefined,
    { params: scope(organizationId) },
  );
}

export function disableEmployee(
  organizationId: string,
  employeeId: string,
): Promise<Employee> {
  return apiPost<Employee>(
    `/employees/${encodeURIComponent(employeeId)}/disable`,
    undefined,
    { params: scope(organizationId) },
  );
}

// --- Party -----------------------------------------------------------------

export function listParties(
  query: PartyListQuery,
  signal?: AbortSignal,
): Promise<Paginated<Party>> {
  return apiGet<Paginated<Party>>('/parties', {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

export function getParty(
  organizationId: string,
  partyId: string,
  signal?: AbortSignal,
): Promise<Party> {
  return apiGet<Party>(`/parties/${encodeURIComponent(partyId)}`, {
    params: scope(organizationId),
    ...(signal ? { signal } : {}),
  });
}

export function createParty(body: CreatePartyRequest): Promise<Party> {
  return apiPost<Party, CreatePartyRequest>('/parties', body);
}

export function updateParty(
  organizationId: string,
  partyId: string,
  body: UpdatePartyRequest,
): Promise<Party> {
  return apiPatch<Party, UpdatePartyRequest>(
    `/parties/${encodeURIComponent(partyId)}`,
    body,
    { params: scope(organizationId) },
  );
}

export function enableParty(
  organizationId: string,
  partyId: string,
): Promise<Party> {
  return apiPost<Party>(
    `/parties/${encodeURIComponent(partyId)}/enable`,
    undefined,
    { params: scope(organizationId) },
  );
}

export function disableParty(
  organizationId: string,
  partyId: string,
): Promise<Party> {
  return apiPost<Party>(
    `/parties/${encodeURIComponent(partyId)}/disable`,
    undefined,
    { params: scope(organizationId) },
  );
}
