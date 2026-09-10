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
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    const client = await this.prisma.getClient<{
      usersUser: {
        findUnique: (args: {
          where: { id: string };
        }) => Promise<PrismaUserRecord | null>;
      };
    }>();
    const row = await client.usersUser.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findByUsername(username: string): Promise<User | null> {
    const client = await this.prisma.getClient<{
      usersUser: {
        findUnique: (args: {
          where: { username: string };
        }) => Promise<PrismaUserRecord | null>;
      };
    }>();
    const row = await client.usersUser.findUnique({ where: { username } });
    return row === null ? null : toDomain(row);
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
      usersUser: {
        create: (args: { data: typeof input }) => Promise<PrismaUserRecord>;
      };
    }>();
    const row = await client.usersUser.create({ data: input });
    return toDomain(row);
  }

  async update(
    id: string,
    patch: {
      passwordHash?: string | undefined;
      isActive?: boolean | undefined;
      updatedAt: Date;
      updatedBy: string | null;
      deletedAt?: Date | null | undefined;
    },
  ): Promise<User | null> {
    const client = await this.prisma.getClient<{
      usersUser: {
        update: (args: {
          where: { id: string };
          data: typeof patch;
        }) => Promise<PrismaUserRecord>;
      };
    }>();
    try {
      const row = await client.usersUser.update({ where: { id }, data: patch });
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
