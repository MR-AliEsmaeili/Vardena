import type { PermissionDefinition } from '../../rbac/domain/permission-definition.js';

/**
 * The Licensing module's permissions (AR-22, docs/security.md §3).
 *
 * `Licensing.License.Activate` is an ordinary RBAC permission: it must be
 * granted to a role and held by the principal like any other code. It is the
 * only permission in the repository that is not itself gated by a module
 * entitlement (`isPlatformPermission`), because requiring a license to
 * install a license is an unbreakable deadlock on a fresh installation.
 *
 * Reading the evaluated state (`GET /api/v1/license/current`) deliberately
 * has NO permission: it is an authenticated post-login bootstrap self-read
 * that returns non-secret state (ADR-0030).
 */
export const LICENSING_PERMISSIONS = {
  LICENSE_ACTIVATE: 'Licensing.License.Activate',
} as const;

export const LICENSING_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] =
  [
    {
      code: LICENSING_PERMISSIONS.LICENSE_ACTIVATE,
      description:
        'Activate or replace the installation license from a signed license code.',
    },
  ];
