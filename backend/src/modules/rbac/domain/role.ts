import type { PermissionRef } from './permission.js';

/**
 * Role entity (docs/modules.md §RBAC, ADR-0006).
 *
 * A role is a named, admin-managed set of permissions. It carries no
 * inheritance and no wildcard semantics: the permissions of a role are
 * exactly the rows in `rbac.role_permissions` for that role.
 *
 * Framework-free (AR-05).
 */
export interface Role {
  id: string;
  name: string;
  description: string | null;
  /** Audit columns (AR-12). */
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

/** A role together with its assigned permissions (detail response). */
export interface RoleWithPermissions {
  role: Role;
  permissions: PermissionRef[];
}

/** Number of permissions shown in role list responses. */
export interface RoleListEntry {
  role: Role;
  permissionCount: number;
}

/** Name constraints (validated at the edge; storage is VarChar(120)). */
export const MAX_ROLE_NAME_LENGTH = 120;
export const MAX_ROLE_DESCRIPTION_LENGTH = 500;
