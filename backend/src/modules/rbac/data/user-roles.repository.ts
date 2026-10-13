import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';

/**
 * Data access for `rbac.user_roles` (the user ↔ role assignment table).
 *
 * Prisma client delegate: `userRole`.
 *
 * The table is RBAC-owned and deliberately has no Prisma relation to the
 * Users module's models beyond the database foreign key: user *existence* is
 * enforced by `fk_rbac_user_roles_user`, so RBAC answers "does this user
 * exist?" from its own data layer instead of reaching into another module
 * (AR-07). Role *existence* is validated by the caller within RBAC.
 */
@Injectable()
export class UserRolesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Assign a role to a user. Duplicates/FK violations surface to the caller. */
  async assign(input: {
    userId: string;
    roleId: string;
    now: Date;
    createdBy: string | null;
  }): Promise<void> {
    const client = await this.prisma.getClient<{
      userRole: {
        create: (args: {
          data: {
            userId: string;
            roleId: string;
            createdAt: Date;
            createdBy: string | null;
          };
        }) => Promise<unknown>;
      };
    }>();
    await client.userRole.create({
      data: {
        userId: input.userId,
        roleId: input.roleId,
        createdAt: input.now,
        createdBy: input.createdBy,
      },
    });
  }

  /** Remove a role from a user; false when the assignment did not exist. */
  async remove(userId: string, roleId: string): Promise<boolean> {
    const client = await this.prisma.getClient<{
      userRole: {
        deleteMany: (args: {
          where: { userId: string; roleId: string };
        }) => Promise<{ count: number }>;
      };
    }>();
    const result = await client.userRole.deleteMany({
      where: { userId, roleId },
    });
    return result.count > 0;
  }

  /** All permission codes reachable from the user's roles (evaluation). */
  async listPermissionCodesForUser(userId: string): Promise<string[]> {
    const client = await this.prisma.getClient<{
      rolePermission: {
        findMany: (args: {
          where: { role: { userRoles: { some: { userId: string } } } };
          select: { permission: { select: { code: true } } };
        }) => Promise<Array<{ permission: { code: string } }>>;
      };
    }>();
    const rows = await client.rolePermission.findMany({
      where: { role: { userRoles: { some: { userId } } } },
      select: { permission: { select: { code: true } } },
    });
    // A code can be granted through several roles: effective permissions are a
    // set, not a multiset (no duplicates for the client).
    return [...new Set(rows.map((row) => row.permission.code))].sort();
  }

  /** Role ids currently assigned to a user (self/admin role listing later). */
  async listRoleIdsForUser(userId: string): Promise<string[]> {
    const client = await this.prisma.getClient<{
      userRole: {
        findMany: (args: {
          where: { userId: string };
          select: { roleId: true };
          orderBy: Array<Record<string, 'asc' | 'desc'>>;
        }) => Promise<Array<{ roleId: string }>>;
      };
    }>();
    const rows = await client.userRole.findMany({
      where: { userId },
      select: { roleId: true },
      orderBy: [{ createdAt: 'asc' }],
    });
    return rows.map((row) => row.roleId);
  }

  /**
   * Does the user hold this permission? Single indexed lookup used by the
   * authorization service; a missing user row simply yields `false`.
   */
  async userHasPermission(userId: string, code: string): Promise<boolean> {
    const client = await this.prisma.getClient<{
      rolePermission: {
        findFirst: (args: {
          where: {
            permission: { code: string };
            role: { userRoles: { some: { userId: string } } };
          };
          select: { roleId: true };
        }) => Promise<{ roleId: string } | null>;
      };
    }>();
    const row = await client.rolePermission.findFirst({
      where: {
        permission: { code },
        role: { userRoles: { some: { userId } } },
      },
      select: { roleId: true },
    });
    return row !== null;
  }
}
