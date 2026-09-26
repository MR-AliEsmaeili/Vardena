/**
 * Organization membership — the principal → organization binding
 * (Task 19, ODR-3: Principal-bound Organization Authorization).
 *
 * A membership row is the smallest repository-consistent authorization fact
 * this module can own: "this user may access this organization". It is NOT a
 * profile, NOT an employee link (OQ-37) and NOT a role — the full membership
 * model (per-organization roles, deactivation, effective dating) stays future
 * work under OQ-01/OQ-22. Presence is the authorization; removal is the
 * revocation, effective on the next request exactly like an RBAC permission
 * (no cache, docs/security.md §3).
 *
 * The shape deliberately mirrors `rbac.user_roles`, the repository's other
 * user-link table: composite identity (userId, organizationId), creation
 * audit only, nothing mutable. There is no second lifecycle mechanism
 * (master-data-strategy.md §7).
 *
 * Framework-free (AR-05).
 */

/** The principal → organization authorization fact. */
export interface OrganizationMembership {
  userId: string;
  organizationId: string;
  createdAt: Date;
  createdBy: string | null;
}

/** API representation. Audit actor ids are not exposed (AR-24). */
export interface OrganizationMembershipDto {
  userId: string;
  organizationId: string;
  createdAt: string;
}

export function toOrganizationMembershipDto(
  membership: OrganizationMembership,
): OrganizationMembershipDto {
  return {
    userId: membership.userId,
    organizationId: membership.organizationId,
    createdAt: membership.createdAt.toISOString(),
  };
}
