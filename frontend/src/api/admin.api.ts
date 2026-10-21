import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import type {
  AdminPermission,
  AdminPermissionListQuery,
  AdminRole,
  AdminRoleDetail,
  AdminRoleListQuery,
  AdminUser,
  AdminUserListQuery,
  CreateRoleRequest,
  CreateUserRequest,
  Paginated,
  ResetPasswordRequest,
  UpdateRoleRequest,
  UpdateUserRequest,
} from './contracts';

/**
 * Administration surface for user accounts and roles
 * (`backend/src/modules/users`, `backend/src/modules/rbac`).
 *
 * Transport only: every route below is authenticated and permission-checked
 * by the backend (`Users.User.*`, `Rbac.*`); the frontend permission checks
 * are a UX affordance (AR-21). There is deliberately NO delete for users or
 * roles and no read endpoint for role↔user assignments — the backend does
 * not offer one, so the UI never pretends otherwise (it reports the 409/404
 * of an assign/remove that does not apply).
 *
 * The permission REGISTRY read (`GET /permissions`) is the catalog behind the
 * role editor's permission picker; it is authorized separately with
 * `Rbac.Permission.View`.
 */

// --- Users -------------------------------------------------------------------

export function listUsers(
  query: AdminUserListQuery,
  signal?: AbortSignal,
): Promise<Paginated<AdminUser>> {
  return apiGet<Paginated<AdminUser>>('/users', {
    params: {
      page: query.page,
      pageSize: query.pageSize,
      ...(query.sort !== undefined ? { sort: query.sort } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    },
    ...(signal ? { signal } : {}),
  });
}

export function getUser(
  userId: string,
  signal?: AbortSignal,
): Promise<AdminUser> {
  return apiGet<AdminUser>(`/users/${encodeURIComponent(userId)}`, {
    ...(signal ? { signal } : {}),
  });
}

export function createUser(body: CreateUserRequest): Promise<AdminUser> {
  return apiPost<AdminUser, CreateUserRequest>('/users', body);
}

export function updateUser(
  userId: string,
  body: UpdateUserRequest,
): Promise<AdminUser> {
  return apiPatch<AdminUser, UpdateUserRequest>(
    `/users/${encodeURIComponent(userId)}`,
    body,
  );
}

export function enableUser(userId: string): Promise<AdminUser> {
  return apiPost<AdminUser, undefined>(
    `/users/${encodeURIComponent(userId)}/enable`,
    undefined,
  );
}

export function disableUser(userId: string): Promise<AdminUser> {
  return apiPost<AdminUser, undefined>(
    `/users/${encodeURIComponent(userId)}/disable`,
    undefined,
  );
}

/** Administrator password reset — answers 204 with no body. */
export function resetUserPassword(
  userId: string,
  body: ResetPasswordRequest,
): Promise<void> {
  return apiPost<void, ResetPasswordRequest>(
    `/users/${encodeURIComponent(userId)}/password-reset`,
    body,
  );
}

// --- Roles -------------------------------------------------------------------

export function listRoles(
  query: AdminRoleListQuery,
  signal?: AbortSignal,
): Promise<Paginated<AdminRole>> {
  return apiGet<Paginated<AdminRole>>('/roles', {
    params: {
      page: query.page,
      pageSize: query.pageSize,
      ...(query.sort !== undefined ? { sort: query.sort } : {}),
    },
    ...(signal ? { signal } : {}),
  });
}

export function getRole(
  roleId: string,
  signal?: AbortSignal,
): Promise<AdminRoleDetail> {
  return apiGet<AdminRoleDetail>(`/roles/${encodeURIComponent(roleId)}`, {
    ...(signal ? { signal } : {}),
  });
}

export function createRole(body: CreateRoleRequest): Promise<AdminRoleDetail> {
  return apiPost<AdminRoleDetail, CreateRoleRequest>('/roles', body);
}

export function updateRole(
  roleId: string,
  body: UpdateRoleRequest,
): Promise<AdminRoleDetail> {
  return apiPatch<AdminRoleDetail, UpdateRoleRequest>(
    `/roles/${encodeURIComponent(roleId)}`,
    body,
  );
}

/** Assign one permission — answers 204 with no body. */
export function assignRolePermission(
  roleId: string,
  code: string,
): Promise<void> {
  return apiPost<void, { code: string }>(
    `/roles/${encodeURIComponent(roleId)}/permissions`,
    { code },
  );
}

/** Remove one permission — answers 204 with no body. */
export function removeRolePermission(
  roleId: string,
  code: string,
): Promise<void> {
  return apiDelete<void>(
    `/roles/${encodeURIComponent(roleId)}/permissions/${encodeURIComponent(code)}`,
  );
}

/** Assign the role to a user — answers 204 with no body. */
export function assignUserToRole(
  roleId: string,
  userId: string,
): Promise<void> {
  return apiPost<void, { userId: string }>(
    `/roles/${encodeURIComponent(roleId)}/users`,
    { userId },
  );
}

/** Remove the role from a user — answers 204 with no body. */
export function removeUserFromRole(
  roleId: string,
  userId: string,
): Promise<void> {
  return apiDelete<void>(
    `/roles/${encodeURIComponent(roleId)}/users/${encodeURIComponent(userId)}`,
  );
}

// --- Permission registry -----------------------------------------------------

export function listPermissions(
  query: AdminPermissionListQuery,
  signal?: AbortSignal,
): Promise<Paginated<AdminPermission>> {
  return apiGet<Paginated<AdminPermission>>('/permissions', {
    params: {
      page: query.page,
      pageSize: query.pageSize,
      ...(query.sort !== undefined ? { sort: query.sort } : {}),
    },
    ...(signal ? { signal } : {}),
  });
}
