import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import type { User } from '../domain/user.js';

/**
 * Data access for `users.users`.
 *
 * Rules (AR-07, AR-03):
 * - Prisma access lives in the data layer only.
 * - Returns domain `User` objects; never exposes Prisma model types outside
 *   this file.
 * - Does not enforce business rules; it persists what the application layer
 *   hands it.
 *
 * Prisma client delegate: multi-schema models are exposed by their model name
 * (`prisma.user` for `model User` in schema `users`) — the schema name is part
 * of the database identity, not of the client API (Prisma multi-schema docs).
 */

/** Filter accepted by list/count; soft-deleted users are never returned. */
export interface UserListFilter {
  isActive?: boolean | undefined;
}

type UserWhere = {
  deletedAt: null;
  isActive?: boolean | undefined;
};

/** Prisma orderBy accepts an array of single-field directions. */
export type UserOrderBy = Array<Record<string, 'asc' | 'desc'>>;

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    const client = await this.prisma.getClient<{
      user: {
        findUnique: (args: {
          where: { id: string };
        }) => Promise<PrismaUserRecord | null>;
      };
    }>();
    const row = await client.user.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findByUsername(username: string): Promise<User | null> {
    const client = await this.prisma.getClient<{
      user: {
        findUnique: (args: {
          where: { username: string };
        }) => Promise<PrismaUserRecord | null>;
      };
    }>();
    const row = await client.user.findUnique({ where: { username } });
    return row === null ? null : toDomain(row);
  }

  /**
   * Username availability check for edits: a row with the same username but a
   * different id means "already taken" (soft-deleted rows keep their username,
   * matching the current unique index).
   */
  async findByUsernameExcludingId(
    username: string,
    excludeId: string,
  ): Promise<User | null> {
    const client = await this.prisma.getClient<{
      user: {
        findFirst: (args: {
          where: { username: string; id: { not: string } };
        }) => Promise<PrismaUserRecord | null>;
      };
    }>();
    const row = await client.user.findFirst({
      where: { username, id: { not: excludeId } },
    });
    return row === null ? null : toDomain(row);
  }

  async list(params: {
    where: UserListFilter;
    orderBy: UserOrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: User[]; total: number }> {
    const where = toWhere(params.where);
    const client = await this.prisma.getClient<{
      user: {
        findMany: (args: {
          where: UserWhere;
          orderBy: UserOrderBy;
          skip: number;
          take: number;
        }) => Promise<PrismaUserRecord[]>;
        count: (args: { where: UserWhere }) => Promise<number>;
      };
    }>();
    const [rows, total] = await Promise.all([
      client.user.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      client.user.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async countActive(): Promise<number> {
    const client = await this.prisma.getClient<{
      user: { count: (args: { where: UserWhere }) => Promise<number> };
    }>();
    return client.user.count({ where: { deletedAt: null, isActive: true } });
  }

  async create(input: {
    id: string;
    username: string;
    passwordHash: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string | null;
  }): Promise<User> {
    const client = await this.prisma.getClient<{
      user: {
        create: (args: { data: typeof input }) => Promise<PrismaUserRecord>;
      };
    }>();
    const row = await client.user.create({ data: input });
    return toDomain(row);
  }

  async update(
    id: string,
    patch: {
      username?: string | undefined;
      passwordHash?: string | undefined;
      isActive?: boolean | undefined;
      updatedAt: Date;
      updatedBy: string | null;
      deletedAt?: Date | null | undefined;
    },
  ): Promise<User | null> {
    const client = await this.prisma.getClient<{
      user: {
        update: (args: {
          where: { id: string };
          data: typeof patch;
        }) => Promise<PrismaUserRecord>;
      };
    }>();
    try {
      const row = await client.user.update({ where: { id }, data: patch });
      return toDomain(row);
    } catch (error) {
      // Prisma throws P2025 on "record to update not found".
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }
}

// ---- Internal helpers ----

interface PrismaUserRecord {
  id: string;
  username: string;
  passwordHash: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
}

function toWhere(filter: UserListFilter): UserWhere {
  const where: UserWhere = { deletedAt: null };
  if (filter.isActive !== undefined) {
    where.isActive = filter.isActive;
  }
  return where;
}

function toDomain(row: PrismaUserRecord): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.passwordHash,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'P2025'
  );
}
