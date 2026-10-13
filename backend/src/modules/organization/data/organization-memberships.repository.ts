import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';

/**
 * Data access for `organization.organization_memberships` — the principal →
 * organization binding (Task 19, ODR-3).
 *
 * The table is Organization-owned. The user side is enforced by the database
 * foreign key `fk_organization_memberships_user`, exactly as in
 * `rbac.user_roles`: user *existence* is proven by the FK (an unknown user
 * surfaces as a foreign-key violation the service maps to 404), so this
 * module never reads the Users module's tables (AR-07).
 *
 * Prisma delegate: `organizationMembership` (multi-schema models keep their
 * model name in the client API).
 */

/** Row shape of `organization.organization_memberships`. */
export interface OrganizationMembershipRow {
  userId: string;
  organizationId: string;
  createdAt: Date;
  createdBy: string | null;
}

interface MembershipWhere {
  userId?: string;
  organizationId?: string;
}

type Client = {
  organizationMembership: {
    findFirst: (args: {
      where: MembershipWhere;
      select?: undefined;
    }) => Promise<OrganizationMembershipRow | null>;
    findMany: (args: {
      where: MembershipWhere;
      orderBy: Array<Record<string, 'asc' | 'desc'>>;
      skip?: number;
      take?: number;
    }) => Promise<OrganizationMembershipRow[]>;
    count: (args: { where: MembershipWhere }) => Promise<number>;
    create: (args: {
      data: {
        userId: string;
        organizationId: string;
        createdAt: Date;
        createdBy: string | null;
      };
    }) => Promise<OrganizationMembershipRow>;
    deleteMany: (args: {
      where: MembershipWhere;
    }) => Promise<{ count: number }>;
  };
};

@Injectable()
export class OrganizationMembershipsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * THE ODR-3 predicate: does this principal have access to this
   * organization? Single indexed lookup on the composite primary key; a
   * missing user or organization row simply yields `null` (no access).
   */
  async findMembership(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationMembershipRow | null> {
    const client = await this.prisma.getClient<Client>();
    return client.organizationMembership.findFirst({
      where: { userId, organizationId },
    });
  }

  /**
   * THE BOOTSTRAP predicate (ODR-3 post-merge correction): does this
   * organization have ANY member at all?
   *
   * An existence probe, not a listing: a single `LIMIT 1` lookup served by
   * `idx_organization_memberships_organization_id`, so the cost does not grow
   * with the member count and no member row is ever loaded into the
   * application for an authorization decision.
   */
  async hasAnyMember(organizationId: string): Promise<boolean> {
    const client = await this.prisma.getClient<Client>();
    const first = await client.organizationMembership.findFirst({
      where: { organizationId },
    });
    return first !== null;
  }

  /**
   * The organization BOOTSTRAP read's first half
   * (`OrganizationsService.listMyOrganizations`): every organization id this
   * user currently holds a membership row for, created-ascending. Membership
   * EXISTENCE is the complete authorization fact (ODR-3) — this reads no
   * permission and filters on nothing but the user id, unlike
   * `OrganizationsService.listOrganizations`, which is the
   * `Organization.Organization.View` administration catalog.
   *
   * Unbounded by design: a principal's own membership count is expected to
   * stay small (one row per organization it actually belongs to), so this is
   * a discovery read, not a paginated listing.
   */
  async listOrganizationIdsForUser(userId: string): Promise<string[]> {
    const client = await this.prisma.getClient<Client>();
    const rows = await client.organizationMembership.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }],
    });
    return rows.map((row) => row.organizationId);
  }

  /** Members of one organization, created-ascending (the grant audit order). */
  async listForOrganization(params: {
    organizationId: string;
    skip: number;
    take: number;
  }): Promise<{ items: OrganizationMembershipRow[]; total: number }> {
    const client = await this.prisma.getClient<Client>();
    const where: MembershipWhere = {
      organizationId: params.organizationId,
    };
    const [rows, total] = await Promise.all([
      client.organizationMembership.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
        skip: params.skip,
        take: params.take,
      }),
      client.organizationMembership.count({ where }),
    ]);
    return { items: rows, total };
  }

  /**
   * Grant a membership. Duplicate/FK violations surface to the caller (the
   * service maps them to 409 and 404 respectively).
   */
  async create(input: {
    userId: string;
    organizationId: string;
    now: Date;
    createdBy: string | null;
  }): Promise<OrganizationMembershipRow> {
    const client = await this.prisma.getClient<Client>();
    return client.organizationMembership.create({
      data: {
        userId: input.userId,
        organizationId: input.organizationId,
        createdAt: input.now,
        createdBy: input.createdBy,
      },
    });
  }

  /** Revoke a membership; false when it did not exist. */
  async remove(userId: string, organizationId: string): Promise<boolean> {
    const client = await this.prisma.getClient<Client>();
    const result = await client.organizationMembership.deleteMany({
      where: { userId, organizationId },
    });
    return result.count > 0;
  }
}
