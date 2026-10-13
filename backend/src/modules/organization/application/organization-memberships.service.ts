import { Inject, Injectable } from '@nestjs/common';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import {
  toOffset,
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from '../../../kernel/prisma/prisma-errors.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationMembershipsRepository } from '../data/organization-memberships.repository.js';
import type { OrganizationMembershipRow } from '../data/organization-memberships.repository.js';
import type {
  OrganizationMembership,
  OrganizationMembershipDto,
} from '../domain/organization-membership.js';
import { toOrganizationMembershipDto } from '../domain/organization-membership.js';
import { MEMBERSHIP_PERMISSIONS } from '../domain/organization-permissions.js';
import {
  ORGANIZATION_MEMBERSHIP_GRANTED_EVENT,
  ORGANIZATION_MEMBERSHIP_REVOKED_EVENT,
} from '../domain/organization.events.js';
import { publishEvent } from './master-data-support.js';
import { OrganizationsService } from './organizations.service.js';

/**
 * Principal → organization membership administration (Task 19, ODR-3).
 *
 * Mirrors `rbac.UserRolesService`, the repository's other user-link
 * administration service:
 * - every method re-checks its permission in THIS layer (AR-04, AR-21);
 * - the organization side is validated through `OrganizationsService`
 *   (`requireAdministrableOrganization`: exists + deployment pin + usable);
 * - the USER side is proven by the database foreign key
 *   (`fk_organization_memberships_user`) — an unknown user surfaces as a
 *   foreign-key violation mapped to 404, so this module never reads the Users
 *   module's tables (AR-07);
 * - a duplicate grant is a 409 (the composite primary key is the authority).
 *
 * **Membership administration is organization-bound (ODR-3).** Holding a
 * `Organization.Membership.*` permission is NOT by itself authority over an
 * arbitrary `organizationId`: permission alone must never cross an
 * organization boundary, on the administration surface exactly as on the data
 * surface. Every operation therefore also asserts the acting principal's own
 * membership of the target organization through the module's existing
 * chokepoint (`OrganizationsService.assertOrganizationInScope`).
 *
 * **The single exception — bootstrap of the first member.** When the target
 * organization has NO member at all (`hasAnyMember === false`), a principal
 * holding `Organization.Membership.Grant` may create the FIRST membership
 * without being a member itself; otherwise no organization could ever be
 * populated (the deadlock ODR-3 must avoid). The exception is deliberately
 * narrow:
 * - it applies to `grantMembership` only — never to list, never to revoke;
 * - it ends the moment the organization has one member (the second grant is
 *   already membership-bound);
 * - it is re-entered only if the organization's membership set becomes empty
 *   again (e.g. the last member revoked themselves), which is an accepted
 *   state, not a standing bypass.
 *
 * Failure semantics are the established isolation posture: a principal who is
 * not a member gets **404**, indistinguishable from an unknown organization id
 * — the API never reveals "this organization exists but you are not a member".
 */
@Injectable()
export class OrganizationMembershipsService {
  constructor(
    private readonly memberships: OrganizationMembershipsRepository,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  /** The members of one organization (paged, grant-audit order). */
  async listMembers(
    organizationId: string,
    query: { page: number; pageSize: number },
  ): Promise<PaginatedResult<OrganizationMembershipDto>> {
    await this.authorization.requireAllPermissions([
      MEMBERSHIP_PERMISSIONS.VIEW,
    ]);
    // Membership-bound (ODR-3): reading who belongs to an organization is
    // itself organization-scoped information. No bootstrap exception — there
    // is nothing to bootstrap by reading.
    await this.authorizeMembershipAdministration(organizationId, {
      allowBootstrap: false,
    });
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.memberships.listForOrganization({
      organizationId,
      skip,
      take,
    });
    return toPaginatedResult(
      items.map((row) => toOrganizationMembershipDto(toMembership(row))),
      total,
      query.page,
      query.pageSize,
    );
  }

  /** Grant a user access to an organization (idempotent-refused, 409). */
  async grantMembership(organizationId: string, userId: string): Promise<void> {
    await this.authorization.requireAllPermissions([
      MEMBERSHIP_PERMISSIONS.GRANT,
    ]);
    // Membership-bound, except for the first member of an empty organization
    // (the one bootstrap exception — see the class docs).
    await this.authorizeMembershipAdministration(organizationId, {
      allowBootstrap: true,
    });

    const now = new Date();
    try {
      await this.memberships.create({
        userId,
        organizationId,
        now,
        createdBy: getPrincipal()?.userId ?? null,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'That user is already a member of this organization.',
        );
      }
      if (isForeignKeyViolation(error)) {
        // The only foreign key that can fail here is the user one: the
        // organization was already validated through its owning service.
        throw AppException.notFound('User', userId);
      }
      throw error;
    }

    await publishEvent(this.events, {
      type: ORGANIZATION_MEMBERSHIP_GRANTED_EVENT,
      aggregateType: 'OrganizationMembership',
      aggregateId: `${userId}:${organizationId}`,
      payload: { userId, organizationId },
    });
    this.logger.log(
      'Organization membership granted',
      { userId, organizationId },
      OrganizationMembershipsService.name,
    );
  }

  /** Revoke a user's access to an organization (404 when not a member). */
  async revokeMembership(
    organizationId: string,
    userId: string,
  ): Promise<void> {
    await this.authorization.requireAllPermissions([
      MEMBERSHIP_PERMISSIONS.REVOKE,
    ]);
    // Membership-bound, always — revoking is never a bootstrap operation, and
    // the target being somebody else does not relax the acting principal's
    // own binding.
    await this.authorizeMembershipAdministration(organizationId, {
      allowBootstrap: false,
    });

    const removed = await this.memberships.remove(userId, organizationId);
    if (!removed) {
      throw AppException.notFound(
        'OrganizationMembership',
        `${userId}:${organizationId}`,
      );
    }

    await publishEvent(this.events, {
      type: ORGANIZATION_MEMBERSHIP_REVOKED_EVENT,
      aggregateType: 'OrganizationMembership',
      aggregateId: `${userId}:${organizationId}`,
      payload: { userId, organizationId },
    });
    this.logger.log(
      'Organization membership revoked',
      { userId, organizationId },
      OrganizationMembershipsService.name,
    );
  }

  // ---- internals ----------------------------------------------------------

  /**
   * THE ODR-3 membership-administration boundary. Ordering (docs/security.md
   * §3):
   *
   * 1. **Deployment scope** (ADR-0025) — an out-of-pin id answers 404 before
   *    anything touches the database.
   * 2. **Membership authorization** — `assertOrganizationInScope` binds the
   *    acting principal to the target organization (404 when there is no
   *    membership row, indistinguishable from an unknown organization).
   *    Skipped ONLY on the bootstrap path: `allowBootstrap` AND the target
   *    organization currently has zero members.
   * 3. **Organization resolution** — `requireAdministrableOrganization`:
   *    exists (404 otherwise, including for the bootstrap path, so an unknown
   *    id keeps the same posture) and is usable (a disabled organization
   *    answers 422 and may not anchor new records).
   *
   * System context (no HTTP request in flight — bootstrap scripts, workers,
   * services called directly) keeps the established trusted-caller posture:
   * `assertOrganizationInScope` and `requireAllPermissions` both no-op there,
   * and it is not reachable from HTTP.
   */
  private async authorizeMembershipAdministration(
    organizationId: string,
    options: { allowBootstrap: boolean },
  ): Promise<void> {
    this.organizations.assertDeploymentOrganizationPin(organizationId);
    const bootstrapping =
      options.allowBootstrap &&
      !(await this.memberships.hasAnyMember(organizationId));
    if (!bootstrapping) {
      await this.organizations.assertOrganizationInScope(organizationId);
    }
    await this.organizations.requireAdministrableOrganization(organizationId);
  }
}

function toMembership(row: OrganizationMembershipRow): OrganizationMembership {
  return {
    userId: row.userId,
    organizationId: row.organizationId,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}
