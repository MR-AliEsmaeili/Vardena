import type { PermissionDefinition } from '../../rbac/domain/permission-definition.js';

/**
 * The Users module's permissions (AR-22, docs/security.md §3).
 *
 * Registered by `UsersModule` at startup and mirrored into `rbac.permissions`
 * together with every other module's definitions — the Users module does not
 * own a permission store, it only declares its vocabulary (ADR-0006).
 *
 * `Users.User.Enable` exists because enable and disable are separate
 * operations with separate audit value; a deployment that wants "can toggle
 * account state" grants both. No `Users.User.Delete`: user deletion semantics
 * are not defined in the repository (soft delete exists in the schema, but no
 * product rule says who may delete users or what happens to their history).
 */
export const USER_PERMISSIONS = {
  VIEW: 'Users.User.View',
  CREATE: 'Users.User.Create',
  EDIT: 'Users.User.Edit',
  ENABLE: 'Users.User.Enable',
  DISABLE: 'Users.User.Disable',
  RESET_PASSWORD: 'Users.User.ResetPassword',
} as const;

export const USER_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = [
  {
    code: USER_PERMISSIONS.VIEW,
    description: 'View user records and the user list.',
  },
  {
    code: USER_PERMISSIONS.CREATE,
    description: 'Create user accounts.',
  },
  {
    code: USER_PERMISSIONS.EDIT,
    description: 'Edit user account identity (username).',
  },
  {
    code: USER_PERMISSIONS.ENABLE,
    description: 'Re-enable a disabled user account.',
  },
  {
    code: USER_PERMISSIONS.DISABLE,
    description: 'Disable a user account (blocks login, revokes sessions).',
  },
  {
    code: USER_PERMISSIONS.RESET_PASSWORD,
    description:
      "Reset another user's password (admin-initiated password reset).",
  },
];
