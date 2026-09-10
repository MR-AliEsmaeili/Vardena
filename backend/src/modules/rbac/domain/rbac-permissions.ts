import type { PermissionDefinition } from './permission-definition.js';

/**
 * The RBAC module's own permissions (AR-22, docs/security.md §3).
 *
 * Registered by `RbacModule` at startup; the registry is mirrored into
 * `rbac.permissions`. Codes are `Rbac.<Entity>.<Action>`.
 *
 * Deliberately NOT defined here (no business rule invented, see OQ-14/OQ-19):
 *   - `Rbac.Role.Delete` — role lifecycle (deletion vs. deactivation) is not
 *     defined anywhere in the repository, so no delete endpoint or permission
 *     exists in this session.
 *   - any wildcard/`*` permission — wildcard semantics are undefined (task §5).
 */
export const RBAC_PERMISSIONS = {
  PERMISSION_VIEW: 'Rbac.Permission.View',
  ROLE_VIEW: 'Rbac.Role.View',
  ROLE_CREATE: 'Rbac.Role.Create',
  ROLE_EDIT: 'Rbac.Role.Edit',
  ROLE_PERMISSION_ASSIGN: 'Rbac.RolePermission.Assign',
  ROLE_PERMISSION_REMOVE: 'Rbac.RolePermission.Remove',
  USER_ROLE_ASSIGN: 'Rbac.UserRole.Assign',
  USER_ROLE_REMOVE: 'Rbac.UserRole.Remove',
} as const;

export const RBAC_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = [
  {
    code: RBAC_PERMISSIONS.PERMISSION_VIEW,
    description: 'View the permission registry (available permission codes).',
  },
  {
    code: RBAC_PERMISSIONS.ROLE_VIEW,
    description: 'View roles and the permissions assigned to them.',
  },
  {
    code: RBAC_PERMISSIONS.ROLE_CREATE,
    description: 'Create roles.',
  },
  {
    code: RBAC_PERMISSIONS.ROLE_EDIT,
    description: 'Edit role name and description.',
  },
  {
    code: RBAC_PERMISSIONS.ROLE_PERMISSION_ASSIGN,
    description: 'Assign permissions to a role.',
  },
  {
    code: RBAC_PERMISSIONS.ROLE_PERMISSION_REMOVE,
    description: 'Remove permissions from a role.',
  },
  {
    code: RBAC_PERMISSIONS.USER_ROLE_ASSIGN,
    description: 'Assign roles to users.',
  },
  {
    code: RBAC_PERMISSIONS.USER_ROLE_REMOVE,
    description: 'Remove roles from users.',
  },
];
