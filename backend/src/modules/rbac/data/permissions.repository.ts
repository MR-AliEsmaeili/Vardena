import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import type { PermissionDefinition } from '../domain/permission-definition.js';
import type { Permission, PermissionRef } from '../domain/permission.js';

/**
 * Data access for `rbac.permissions` (the DB mirror of the code registry).
 *
 * Prisma client delegate: `permission` (multi-schema models keep their model
 * name in the client API).
 */
@Injectable()
export class PermissionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Mirror registry definitions into the table: upsert by `code`.
   *
   * Runs in a single transaction so a partially synced registry (some
   * permissions present, some not) can never be observed. Definitions are
   * never deleted: a code that disappears from the registry would still be
   * referenced by existing role assignments, and pruning it is a lifecycle
   * decision the repository does not define (registered as OQ-20).
   */
  async syncDefinitions(
    definitions: readonly PermissionDefinition[],
    now: Date,
  ): Promise<{ created: number; updated: number; total: number }> {
    if (definitions.length === 0) {
      return { created: 0, updated: 0, total: 0 };
    }
    const client = await this.prisma.getClient<{
      permission: {
        findMany: (args: {
          where: { code: { in: string[] } };
          select: { code: true };
        }) => Promise<Array<{ code: string }>>;
        upsert: (args: {
          where: { code: string };
          create: {
            id: string;
            code: string;
            description: string;
            createdAt: Date;
            updatedAt: Date;
          };
          update: { description: string; updatedAt: Date };
        }) => Promise<unknown>;
      };
      $transaction: (operations: Array<Promise<unknown>>) => Promise<unknown[]>;
    }>();

    const codes = definitions.map((definition) => definition.code);
    const existing = await client.permission.findMany({
      where: { code: { in: codes } },
      select: { code: true },
    });
    const existingCodes = new Set(existing.map((row) => row.code));

    await client.$transaction(
      definitions.map((definition) =>
        client.permission.upsert({
          where: { code: definition.code },
          create: {
            id: generateId(),
            code: definition.code,
            description: definition.description,
            createdAt: now,
            updatedAt: now,
          },
          update: {
            description: definition.description,
            updatedAt: now,
          },
        }),
      ),
    );

    const created = definitions.filter(
      (definition) => !existingCodes.has(definition.code),
    ).length;
    return {
      created,
      updated: definitions.length - created,
      total: definitions.length,
    };
  }

  async findByCode(code: string): Promise<Permission | null> {
    const client = await this.prisma.getClient<{
      permission: {
        findUnique: (args: {
          where: { code: string };
        }) => Promise<PrismaPermissionRecord | null>;
      };
    }>();
    const row = await client.permission.findUnique({ where: { code } });
    return row === null ? null : toDomain(row);
  }

  /** Batch lookup used by role creation (all-or-nothing validation). */
  async findByCodes(codes: readonly string[]): Promise<Permission[]> {
    if (codes.length === 0) return [];
    const client = await this.prisma.getClient<{
      permission: {
        findMany: (args: {
          where: { code: { in: string[] } };
        }) => Promise<PrismaPermissionRecord[]>;
      };
    }>();
    const rows = await client.permission.findMany({
      where: { code: { in: [...codes] } },
    });
    return rows.map(toDomain);
  }

  async list(params: {
    orderBy: Array<Record<string, 'asc' | 'desc'>>;
    skip: number;
    take: number;
    allowedCodes?: string[];
  }): Promise<{ items: PermissionRef[]; total: number }> {
    const client = await this.prisma.getClient<{
      permission: {
        findMany: (args: {
          where?: { code: { in: string[] } };
          orderBy: Array<Record<string, 'asc' | 'desc'>>;
          skip: number;
          take: number;
          select: { code: true; description: true };
        }) => Promise<PermissionRef[]>;
        count: (args?: {
          where: { code: { in: string[] } };
        }) => Promise<number>;
      };
    }>();
    const where =
      params.allowedCodes === undefined
        ? undefined
        : { code: { in: params.allowedCodes } };
    const [items, total] = await Promise.all([
      client.permission.findMany({
        ...(where === undefined ? {} : { where }),
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
        select: { code: true, description: true },
      }),
      where === undefined
        ? client.permission.count()
        : client.permission.count({ where }),
    ]);
    return { items, total };
  }
}

// ---- Internal helpers ----

interface PrismaPermissionRecord {
  id: string;
  code: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

function toDomain(row: PrismaPermissionRecord): Permission {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
