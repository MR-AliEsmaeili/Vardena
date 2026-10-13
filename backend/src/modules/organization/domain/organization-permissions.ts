import type { PermissionDefinition } from '../../rbac/domain/permission-definition.js';

/**
 * The Organization module's permissions (AR-22, ADR-0006, docs/security.md §3).
 *
 * Codes follow the established `Module.Entity.Action` form. The entity
 * segment repeats the module name for the organization root itself
 * (`Organization.Organization.View`) because that is exactly what the
 * existing convention produces (`Users.User.View`, `Rbac.Role.Create`);
 * `Organization.View` would be two segments and is rejected by
 * `isValidPermissionCode`.
 *
 * The action vocabulary matches the Users module: `Edit` (not `Update`), plus
 * separate `Enable`/`Disable` because enabling and disabling are separate
 * operations with separate audit value.
 *
 * There is deliberately **no `*.Delete` permission**: Task 6 implements no
 * delete operation for master data. Lifecycle is `is_active` only
 * (master-data-strategy.md §7.4); deletion semantics are OQ-36.
 *
 * No wildcards, no superuser, no implicit bypass (OQ-21).
 */

/** `View`/`Create`/`Edit`/`Enable`/`Disable` for one entity. */
function lifecycle(
  entity: 'Organization' | 'Branch' | 'Department' | 'Employee' | 'Party',
  label: string,
): {
  VIEW: string;
  CREATE: string;
  EDIT: string;
  ENABLE: string;
  DISABLE: string;
  definitions: readonly PermissionDefinition[];
} {
  const codes = {
    VIEW: `Organization.${entity}.View`,
    CREATE: `Organization.${entity}.Create`,
    EDIT: `Organization.${entity}.Edit`,
    ENABLE: `Organization.${entity}.Enable`,
    DISABLE: `Organization.${entity}.Disable`,
  } as const;
  return {
    ...codes,
    definitions: [
      { code: codes.VIEW, description: `View ${label} records and lists.` },
      { code: codes.CREATE, description: `Create ${label} records.` },
      { code: codes.EDIT, description: `Edit ${label} records.` },
      {
        code: codes.ENABLE,
        description: `Re-enable a disabled ${label} record.`,
      },
      {
        code: codes.DISABLE,
        description: `Disable a ${label} record (blocks new usage, keeps history readable).`,
      },
    ],
  };
}

const ORGANIZATION = lifecycle('Organization', 'organization');
const BRANCH = lifecycle('Branch', 'branch');
const DEPARTMENT = lifecycle('Department', 'department');
const EMPLOYEE = lifecycle('Employee', 'employee');
const PARTY = lifecycle('Party', 'party');

/**
 * Organization membership administration (Task 19, ODR-3).
 *
 * The actions follow the Grant/Revoke vocabulary the contract itself uses for
 * access grants (§5.5's `Accounting.FinancialAreaAccess.{View,Grant,Revoke}`
 * pattern) rather than Create/Delete: granting a membership is an
 * authorization act, not record creation. `View` reads an organization's
 * member list.
 *
 * **Holding one of these codes is NOT authority over an arbitrary
 * organization** (corrected by PR #55, the ODR-3 post-merge correction; the
 * earlier wording here described the pre-correction rule and was stale).
 * Membership ADMINISTRATION is organization-bound exactly like the data
 * surface: `listMembers`, `grantMembership` and `revokeMembership` each run
 * the permission check AND `OrganizationsService.assertOrganizationInScope`
 * (deployment pin → the acting principal's own membership) before the
 * business operation — see `OrganizationMembershipsService` and
 * `docs/security.md` §3.
 *
 * The ONLY exception is the bootstrap of the FIRST member: when the target
 * organization has no member at all, a principal holding
 * `Organization.Membership.Grant` may create that first membership without
 * being a member itself (otherwise no organization could ever be populated —
 * the deadlock ODR-3 must avoid). It applies to `grantMembership` only, never
 * to list or revoke, and it closes as soon as one member exists. Still no
 * wildcards, no superuser, no implicit bypass (OQ-21).
 */
const MEMBERSHIP = {
  VIEW: 'Organization.Membership.View',
  GRANT: 'Organization.Membership.Grant',
  REVOKE: 'Organization.Membership.Revoke',
} as const;

export const ORGANIZATION_PERMISSIONS = {
  VIEW: ORGANIZATION.VIEW,
  CREATE: ORGANIZATION.CREATE,
  EDIT: ORGANIZATION.EDIT,
  ENABLE: ORGANIZATION.ENABLE,
  DISABLE: ORGANIZATION.DISABLE,
} as const;

export const BRANCH_PERMISSIONS = {
  VIEW: BRANCH.VIEW,
  CREATE: BRANCH.CREATE,
  EDIT: BRANCH.EDIT,
  ENABLE: BRANCH.ENABLE,
  DISABLE: BRANCH.DISABLE,
} as const;

export const DEPARTMENT_PERMISSIONS = {
  VIEW: DEPARTMENT.VIEW,
  CREATE: DEPARTMENT.CREATE,
  EDIT: DEPARTMENT.EDIT,
  ENABLE: DEPARTMENT.ENABLE,
  DISABLE: DEPARTMENT.DISABLE,
} as const;

export const EMPLOYEE_PERMISSIONS = {
  VIEW: EMPLOYEE.VIEW,
  CREATE: EMPLOYEE.CREATE,
  EDIT: EMPLOYEE.EDIT,
  ENABLE: EMPLOYEE.ENABLE,
  DISABLE: EMPLOYEE.DISABLE,
} as const;

export const PARTY_PERMISSIONS = {
  VIEW: PARTY.VIEW,
  CREATE: PARTY.CREATE,
  EDIT: PARTY.EDIT,
  ENABLE: PARTY.ENABLE,
  DISABLE: PARTY.DISABLE,
} as const;

/** Task 19 (ODR-3): membership administration codes. */
export const MEMBERSHIP_PERMISSIONS = {
  VIEW: MEMBERSHIP.VIEW,
  GRANT: MEMBERSHIP.GRANT,
  REVOKE: MEMBERSHIP.REVOKE,
} as const;

export const ORGANIZATION_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] =
  [
    ...ORGANIZATION.definitions,
    ...BRANCH.definitions,
    ...DEPARTMENT.definitions,
    ...EMPLOYEE.definitions,
    ...PARTY.definitions,
    {
      code: MEMBERSHIP.VIEW,
      description:
        "View an organization's members (principal → organization memberships).",
    },
    {
      code: MEMBERSHIP.GRANT,
      description:
        'Grant a user access to an organization (ODR-3 membership administration).',
    },
    {
      code: MEMBERSHIP.REVOKE,
      description: "Revoke a user's access to an organization.",
    },
  ];
