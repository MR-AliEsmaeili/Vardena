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
 * Deliberately NOT required of the grantor: membership of the target
 * organization. Requiring it would deadlock the first grant of every
 * organization (nobody would be able to bootstrap access), and the
 * `Organization.Membership.Grant` permission is the administration authority —
 * the same standing `Rbac.UserRole.Assign` has. This is administration, not
 * data access: ODR-3 binds the *organization-scoped data paths* (every
 * resolver that goes through `assertOrganizationInScope`), and a membership
 * grant is not one of them.
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
    // Administration resolution (existence + pin + usability). The listing
    // itself is not membership-bound: it is the administration view of the
    // binding, governed by the View permission.
    await this.organizations.requireAdministrableOrganization(organizationId);
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
    await this.organizations.requireAdministrableOrganization(organizationId);

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
    await this.organizations.requireAdministrableOrganization(organizationId);

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
}

function toMembership(row: OrganizationMembershipRow): OrganizationMembership {
  return {
    userId: row.userId,
    organizationId: row.organizationId,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}
