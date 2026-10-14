import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  type DatabaseTransaction,
} from '../../../kernel/prisma/prisma.service.js';
import type { Session } from '../domain/session.js';

/**
 * Data access for `identity.sessions` (docs/database-strategy.md §10).
 *
 * - Prisma access lives here only (AR-03/07).
 * - Returns domain `Session` objects; no Prisma model types escape.
 */
@Injectable()
export class SessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** User lock is already held; lock/revalidate the initiating session next. */
  async lockById(
    sessionId: string,
    transaction: DatabaseTransaction,
  ): Promise<Session | null> {
    const client = await this.prisma.getClient<{
      $queryRaw(
        query: TemplateStringsArray,
        ...values: unknown[]
      ): Promise<unknown>;
    }>(transaction);
    await client.$queryRaw`SELECT "id" FROM "identity"."sessions" WHERE "id" = ${sessionId} FOR UPDATE`;
    return this.findById(sessionId, transaction);
  }

  async create(
    input: {
      id: string;
      userId: string;
      tokenHash: string;
      userAgent: string | null;
      ipAddress: string | null;
      createdAt: Date;
      lastSeenAt: Date;
      expiresAt: Date;
      absoluteExpiresAt: Date;
    },
    transaction?: DatabaseTransaction,
  ): Promise<Session> {
    const client = await this.prisma.getClient<{
      session: {
        create: (args: { data: typeof input }) => Promise<PrismaSessionRecord>;
      };
    }>(transaction);
    const row = await client.session.create({ data: input });
    return toDomain(row);
  }

  async findById(
    id: string,
    transaction?: DatabaseTransaction,
  ): Promise<Session | null> {
    const client = await this.prisma.getClient<{
      session: {
        findUnique: (args: {
          where: { id: string };
        }) => Promise<PrismaSessionRecord | null>;
      };
    }>(transaction);
    const row = await client.session.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    const client = await this.prisma.getClient<{
      session: {
        findUnique: (args: {
          where: { tokenHash: string };
        }) => Promise<PrismaSessionRecord | null>;
      };
    }>();
    const row = await client.session.findUnique({
      where: { tokenHash },
    });
    return row === null ? null : toDomain(row);
  }

  async touch(
    id: string,
    data: { lastSeenAt: Date; expiresAt: Date },
  ): Promise<void> {
    const client = await this.prisma.getClient<{
      session: {
        update: (args: {
          where: { id: string };
          data: { lastSeenAt: Date; expiresAt: Date };
        }) => Promise<unknown>;
      };
    }>();
    await client.session.update({ where: { id }, data });
  }

  async revoke(id: string, revokedAt: Date): Promise<void> {
    const client = await this.prisma.getClient<{
      session: {
        update: (args: {
          where: { id: string };
          data: { revokedAt: Date };
        }) => Promise<unknown>;
      };
    }>();
    await client.session.update({
      where: { id },
      data: { revokedAt },
    });
  }

  /** Revoke all sessions for a user except optionally one (current session). */
  async revokeAllForUser(
    userId: string,
    exceptSessionId: string | null,
    revokedAt: Date,
    transaction?: DatabaseTransaction,
  ): Promise<number> {
    const client = await this.prisma.getClient<{
      session: {
        updateMany: (args: {
          where: {
            userId: string;
            revokedAt: null;
            id?: { not: string } | undefined;
          };
          data: { revokedAt: Date };
        }) => Promise<{ count: number }>;
      };
    }>(transaction);
    const where: {
      userId: string;
      revokedAt: null;
      id?: { not: string };
    } = { userId, revokedAt: null };
    if (exceptSessionId !== null) {
      where.id = { not: exceptSessionId };
    }
    const result = await client.session.updateMany({
      where,
      data: { revokedAt },
    });
    return result.count;
  }
}

// ---- Internal helpers ----

interface PrismaSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}

function toDomain(row: PrismaSessionRecord): Session {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    userAgent: row.userAgent,
    ipAddress: row.ipAddress,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
    absoluteExpiresAt: row.absoluteExpiresAt,
    revokedAt: row.revokedAt,
  };
}
