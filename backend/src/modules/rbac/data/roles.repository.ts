import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import type {
  Role,
  RoleListEntry,
  RoleWithPermissions,
} from '../domain/role.js';
import type { PermissionRef } from '../domain/permission.js';
import { isRecordNotFound } from './prisma-errors.js';

/**
 * Data access for `rbac.roles` + `rbac.role_permissions`.
 *
 * Prisma client delegates: `role`, `rolePermission` (multi-schema models keep
 * their model name in the client API).
 */
@Injectable()
export class RolesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Role | null> {
    const client = await this.prisma.getClient<{
      role: {
        findUnique: (args: {
          where: { id: string };
        }) => Promise<PrismaRoleRecord | null>;
      };
    }>();
    const row = await client.role.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findByName(name: string): Promise<Role | null> {
    const client = await this.prisma.getClient<{
      role: {
        findUnique: (args: {
          where: { name: string };
        }) => Promise<PrismaRoleRecord | null>;
      };
    }>();
    const row = await client.role.findUnique({ where: { name } });
    return row === null ? null : toDomain(row);
  }

  async list(params: {
    orderBy: Array<Record<string, 'asc' | 'desc'>>;
    skip: number;
    take: number;
  }): Promise<{ items: RoleListEntry[]; total: number }> {
    const client = await this.prisma.getClient<{
      role: {
        findMany: (args: {
          orderBy: Array<Record<string, 'asc' | 'desc'>>;
          skip: number;
          take: number;
          include: { _count: { select: { rolePermissions: true } } };
        }) => Promise<PrismaRoleWithCount[]>;
        count: () => Promise<number>;
      };
    }>();
    const [rows, total] = await Promise.all([
      client.role.findMany({
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
        include: { _count: { select: { rolePermissions: true } } },
      }),
      client.role.count(),
    ]);
    return {
      items: rows.map((row) => ({
        role: toDomain(row),
        permissionCount: row._count.rolePermissions,
      })),
      total,
    };
  }

  async findWithPermissions(id: string): Promise<RoleWithPermissions | null> {
    const client = await this.prisma.getClient<{
      role: {
        findUnique: (args: {
          where: { id: string };
          include: {
            rolePermissions: {
              select: { permission: { select: PrismaPermissionRef } };
            };
          };
        }) => Promise<
          | (PrismaRoleRecord & {
              rolePermissions: Array<{ permission: PermissionRef }>;
            })
          | null
        >;
      };
    }>();
    const row = await client.role.findUnique({
      where: { id },
      include: {
        rolePermissions: {
          select: { permission: { select: { code: true, description: true } } },
        },
      },
    });
    if (row === null) return null;
    return {
      role: toDomain(row),
      permissions: sortPermissions(
        row.rolePermissions.map((entry) => entry.permission),
      ),
    };
  }

  /**
   * Create a role and its permission assignments in ONE transaction (§23): a
   * role is never observable with a partially applied permission set.
   */
  async createWithPermissions(input: {
    id: string;
    name: string;
    description: string | null;
    permissionIds: readonly string[];
    now: Date;
    createdBy: string | null;
  }): Promise<Role> {
    const client = await this.prisma.getClient<{
      role: {
        create: (args: {
          data: {
            id: string;
            name: string;
            description: string | null;
            createdAt: Date;
            updatedAt: Date;
            createdBy: string | null;
          };
        }) => Promise<PrismaRoleRecord>;
      };
      rolePermission: {
        createMany: (args: {
          data: Array<{
            roleId: string;
            permissionId: string;
            createdAt: Date;
            createdBy: string | null;
          }>;
        }) => Promise<{ count: number }>;
      };
      $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
    }>();

    return client.$transaction(async (tx) => {
      const scoped = tx as {
        role: typeof client.role;
        rolePermission: typeof client.rolePermission;
      };
      const row = await scoped.role.create({
        data: {
          id: input.id,
          name: input.name,
          description: input.description,
          createdAt: input.now,
          updatedAt: input.now,
          createdBy: input.createdBy,
        },
      });
      if (input.permissionIds.length > 0) {
        await scoped.rolePermission.createMany({
          data: input.permissionIds.map((permissionId) => ({
            roleId: input.id,
            permissionId,
            createdAt: input.now,
            createdBy: input.createdBy,
          })),
        });
      }
      return toDomain(row);
    });
  }

  async update(
    id: string,
    patch: {
      name?: string | undefined;
      description?: string | null | undefined;
      updatedAt: Date;
      updatedBy: string | null;
    },
  ): Promise<Role | null> {
    const client = await this.prisma.getClient<{
      role: {
        update: (args: {
          where: { id: string };
          data: typeof patch;
        }) => Promise<PrismaRoleRecord>;
      };
    }>();
    try {
      const row = await client.role.update({ where: { id }, data: patch });
      return toDomain(row);
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  /** Assign one permission to one role (composite PK prevents duplicates). */
  async addPermission(input: {
    roleId: string;
    permissionId: string;
    now: Date;
    createdBy: string | null;
  }): Promise<void> {
    const client = await this.prisma.getClient<{
      rolePermission: {
        create: (args: {
          data: {
            roleId: string;
            permissionId: string;
            createdAt: Date;
            createdBy: string | null;
          };
        }) => Promise<unknown>;
      };
    }>();
    await client.rolePermission.create({
      data: {
        roleId: input.roleId,
        permissionId: input.permissionId,
        createdAt: input.now,
        createdBy: input.createdBy,
      },
    });
  }

  /** Remove one permission from one role; returns false when not assigned. */
  async removePermission(
    roleId: string,
    permissionId: string,
  ): Promise<boolean> {
    const client = await this.prisma.getClient<{
      rolePermission: {
        deleteMany: (args: {
          where: { roleId: string; permissionId: string };
        }) => Promise<{ count: number }>;
      };
    }>();
    const result = await client.rolePermission.deleteMany({
      where: { roleId, permissionId },
    });
    return result.count > 0;
  }

  async isPermissionAssigned(
    roleId: string,
    permissionId: string,
  ): Promise<boolean> {
    const client = await this.prisma.getClient<{
      rolePermission: {
        findUnique: (args: {
          where: {
            roleId_permissionId: { roleId: string; permissionId: string };
          };
        }) => Promise<unknown | null>;
      };
    }>();
    const row = await client.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId, permissionId } },
    });
    return row !== null;
  }
}

// ---- Internal helpers ----

type PrismaPermissionRef = { code: true; description: true };

interface PrismaRoleRecord {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

type PrismaRoleWithCount = PrismaRoleRecord & {
  _count: { rolePermissions: number };
};

function toDomain(row: PrismaRoleRecord): Role {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
}

function sortPermissions(permissions: PermissionRef[]): PermissionRef[] {
  return [...permissions].sort((a, b) => a.code.localeCompare(b.code));
}
