import { normalizeApiError, type ApiError } from '@/api/errors';
import { t } from '@/lib/i18n';

/**
 * Operation-scoped error presentation for user/role administration — the
 * administration twin of the organization mapper (FE-UX-02 §2).
 *
 * Decision order, implemented exactly:
 * 1. classify by the STABLE ERROR CODE of the normalized envelope — never by
 *    searching the backend `message` (which is never user copy);
 * 2. pick the Persian copy for that code in the context of THIS resource and
 *    THIS operation;
 * 3. fall back to the safe operation-scoped failure copy.
 *
 * The users/rbac services raise their conflicts and rule rejections as plain
 * 409/404/422 envelopes without a structured sub-code, so — like the
 * organization and inventory mappers — the only honest mapping is
 * resource + operation scoped copy. Nothing here parses message text and no
 * sub-case is invented beyond the codes the envelopes actually carry.
 */

export type AdministrationResource = 'user' | 'role' | 'permission';

export type AdministrationOperation =
  | 'load'
  | 'list'
  | 'create'
  | 'update'
  | 'enable'
  | 'disable'
  | 'resetPassword'
  | 'assign'
  | 'remove'
  | 'assignUser'
  | 'removeUser';

export interface AdministrationErrorMessage {
  message: string;
  /** Support correlation id — never the reason for the failure. */
  correlationId?: string | undefined;
}

const OPERATION_FAILURE: Record<AdministrationOperation, string> = {
  load: t.errors.unknown,
  list: t.errors.unknown,
  create: t.usersAdmin.createFailed,
  update: t.usersAdmin.updateFailed,
  enable: t.usersAdmin.enableFailed,
  disable: t.usersAdmin.disableFailed,
  resetPassword: t.usersAdmin.resetFailed,
  assign: t.rolesAdmin.assignFailed,
  remove: t.rolesAdmin.removeFailed,
  assignUser: t.rolesAdmin.assignUserFailed,
  removeUser: t.rolesAdmin.unassignFailed,
};

/**
 * Conflict copy per (resource, operation). The backend raises 409 for:
 * - user create/edit when the username already exists;
 * - role create/edit when the role name already exists;
 * - permission/role-user ASSIGNMENT when the assignment already exists.
 */
const CONFLICT_COPY: Record<
  AdministrationResource,
  Partial<Record<AdministrationOperation, string>>
> = {
  user: {
    create: t.usersAdmin.duplicateUsername,
    update: t.usersAdmin.duplicateUsername,
  },
  role: {
    create: t.rolesAdmin.duplicateRoleName,
    update: t.rolesAdmin.duplicateRoleName,
    assign: t.rolesAdmin.permissionAlreadyAssigned,
    assignUser: t.rolesAdmin.roleAlreadyAssigned,
  },
  permission: {
    assign: t.rolesAdmin.permissionAlreadyAssigned,
  },
};

/**
 * 404 copy per (resource, operation): a missing assignment reads very
 * differently from a missing record, and both arrive as EntityNotFound.
 */
const NOT_FOUND_COPY: Partial<
  Record<`${AdministrationResource}:${AdministrationOperation}`, string>
> = {
  'role:remove': t.rolesAdmin.assignmentMissing,
  'role:removeUser': t.rolesAdmin.userOrRoleMissing,
  'role:assignUser': t.rolesAdmin.userOrRoleMissing,
  'user:removeUser': t.rolesAdmin.userOrRoleMissing,
};

export function administrationErrorMessage(
  resource: AdministrationResource,
  operation: AdministrationOperation,
  error: unknown,
): AdministrationErrorMessage {
  const apiError: ApiError = normalizeApiError(error);
  const correlation =
    apiError.correlationId !== undefined
      ? { correlationId: apiError.correlationId }
      : {};

  switch (apiError.code) {
    case 'PermissionDenied':
      return { message: t.errors.forbidden };
    case 'EntityNotFound':
      // Also the answer for an out-of-scope record: the backend reports it
      // as 404, never 403.
      return {
        message:
          NOT_FOUND_COPY[`${resource}:${operation}`] ?? t.errors.notFound,
      };
    case 'Conflict':
      return {
        message:
          CONFLICT_COPY[resource][operation] ?? OPERATION_FAILURE[operation],
        ...correlation,
      };
    case 'ValidationFailed':
    case 'BadRequest':
      return {
        message:
          resource === 'role' && operation === 'assign'
            ? t.rolesAdmin.permissionMissing
            : resource === 'role' && operation === 'assignUser'
              ? t.rolesAdmin.userIdInvalid
              : OPERATION_FAILURE[operation],
        ...correlation,
      };
    default:
      return { message: OPERATION_FAILURE[operation], ...correlation };
  }
}

/** Persian toast copy for a successful mutation, per (resource, operation). */
export function administrationSuccessMessage(
  resource: AdministrationResource,
  operation: AdministrationOperation,
): string {
  if (resource === 'user') {
    switch (operation) {
      case 'create':
        return t.usersAdmin.userCreated;
      case 'update':
        return t.usersAdmin.userUpdated;
      case 'enable':
        return t.usersAdmin.userEnabled;
      case 'disable':
        return t.usersAdmin.userDisabled;
      case 'resetPassword':
        return t.usersAdmin.passwordReset;
      default:
        return t.usersAdmin.userUpdated;
    }
  }
  switch (operation) {
    case 'create':
      return t.rolesAdmin.roleCreated;
    case 'update':
      return t.rolesAdmin.roleUpdated;
    case 'assign':
      return t.rolesAdmin.permissionAssigned;
    case 'remove':
      return t.rolesAdmin.permissionRemoved;
    case 'assignUser':
      return t.rolesAdmin.userAssigned;
    case 'removeUser':
      return t.rolesAdmin.userUnassigned;
    default:
      return t.rolesAdmin.roleUpdated;
  }
}
