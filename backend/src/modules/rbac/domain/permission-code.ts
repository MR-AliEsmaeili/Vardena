/**
 * Permission code format (ADR-0006, AR-22, docs/security.md §3).
 *
 * Canonical form: `Module.Entity.Action` — exactly three PascalCase-ish
 * segments, e.g. `Users.User.View`, `Inventory.Receipt.Create`,
 * `Rbac.RolePermission.Assign`.
 *
 * This is a *technical* format check. Which codes exist is decided by the
 * modules that register them in the permission registry — never by a client
 * and never by free-text API input.
 *
 * This file is framework-free (AR-05).
 */

/** Maximum stored length of a permission code (`rbac.permissions.code`). */
export const MAX_PERMISSION_CODE_LENGTH = 160;

/**
 * `Module.Entity.Action`:
 *   - Module: module name, e.g. `Users`, `Rbac`, `Inventory`
 *   - Entity: business entity in that module, e.g. `User`, `Receipt`
 *   - Action: `View`, `Create`, `Edit`, `Delete`, or a domain action defined
 *     by the owning module (`Post`, `Approve`, `Import`, …)
 * Wildcards (`*`) and lower-case segments are deliberately not accepted:
 * wildcard semantics are not defined anywhere in the repository.
 */
export const PERMISSION_CODE_PATTERN =
  /^[A-Z][A-Za-z0-9]*\.[A-Z][A-Za-z0-9]*\.[A-Z][A-Za-z0-9]*$/;

export const PERMISSION_CODE_RULE =
  'Permission codes must use the "Module.Entity.Action" form (for example "Users.User.View").';

/** True when `code` is a well-formed permission code (registry/API input). */
export function isValidPermissionCode(code: string): boolean {
  return (
    code.length > 0 &&
    code.length <= MAX_PERMISSION_CODE_LENGTH &&
    PERMISSION_CODE_PATTERN.test(code)
  );
}
