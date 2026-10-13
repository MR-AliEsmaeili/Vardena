import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import type {
  DetailStructureLevel,
  DetailStructureVersion,
} from '../domain/detail-structure.js';
import { isDetailStructureVersionStatus } from '../domain/detail-structure.js';
import type {
  AccountingTransactionalClient,
  DetailStructureLevelDelegate,
  DetailStructureLevelRow,
  DetailStructureVersionCreate,
  DetailStructureVersionDelegate,
  DetailStructureVersionRow,
  DetailStructureVersionWhere,
  OrderBy,
} from './accounting-rows.js';

export class DetailStructureNotDraftError extends Error {
  constructor(public readonly actualStatus: string) {
    super(`Detail structure version is "${actualStatus}", not "draft".`);
    this.name = 'DetailStructureNotDraftError';
  }
}

export class DetailStructurePlanRejectedError extends Error {
  constructor(public readonly problem: string) {
    super(`Detail structure configuration rejected: ${problem}`);
    this.name = 'DetailStructurePlanRejectedError';
  }
}

export interface DetailLevelWrite {
  id: string;
  levelIndex: number;
  title: string;
  digitLength: number;
}

export interface DetailStructureListFilter {
  organizationId: string;
  status?: string | undefined;
}

type Client = {
  detailStructureVersion: DetailStructureVersionDelegate;
  detailStructureLevel: DetailStructureLevelDelegate;
};

@Injectable()
export class DetailStructuresRepository {
  constructor(private readonly prisma: PrismaService) {}

  private async client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  private async transacting(): Promise<AccountingTransactionalClient> {
    return this.prisma.getClient<AccountingTransactionalClient>();
  }

  async findActive(
    organizationId: string,
  ): Promise<DetailStructureVersion | null> {
    const { detailStructureVersion, detailStructureLevel } =
      await this.client();
    const row = await detailStructureVersion.findFirst({
      where: { organizationId, status: 'active' },
    });
    if (row === null) return null;
    const levels = await detailStructureLevel.findMany({
      where: { versionId: row.id },
      orderBy: [{ levelIndex: 'asc' }],
    });
    return toDetailStructureVersion(row, levels);
  }

  async findById(id: string): Promise<DetailStructureVersion | null> {
    const { detailStructureVersion, detailStructureLevel } =
      await this.client();
    const row = await detailStructureVersion.findUnique({
      where: { id },
    });
    if (row === null) return null;
    const levels = await detailStructureLevel.findMany({
      where: { versionId: row.id },
      orderBy: [{ levelIndex: 'asc' }],
    });
    return toDetailStructureVersion(row, levels);
  }

  async list(params: {
    where: DetailStructureListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: DetailStructureVersion[]; total: number }> {
    const { detailStructureVersion, detailStructureLevel } =
      await this.client();
    const where: DetailStructureVersionWhere = {
      organizationId: params.where.organizationId,
    };
    if (params.where.status !== undefined) {
      where.status = params.where.status;
    }

    const [rows, total] = await Promise.all([
      detailStructureVersion.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      detailStructureVersion.count({ where }),
    ]);

    const results: DetailStructureVersion[] = [];
    for (const row of rows) {
      const levels = await detailStructureLevel.findMany({
        where: { versionId: row.id },
        orderBy: [{ levelIndex: 'asc' }],
      });
      results.push(toDetailStructureVersion(row, levels));
    }
    return { items: results, total };
  }

  async createDraft(input: {
    id: string;
    organizationId: string;
    title: string | null;
    maxDepth: number;
    levels: readonly DetailLevelWrite[];
    now: Date;
    actorId: string | null;
  }): Promise<DetailStructureVersion> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      // Find max versionNumber for organization
      const existing = await tx.detailStructureVersion.findMany({
        where: { organizationId: input.organizationId },
        orderBy: [{ versionNumber: 'desc' }],
        take: 1,
      });
      const nextVersionNumber = (existing[0]?.versionNumber ?? 0) + 1;

      const versionData: DetailStructureVersionCreate = {
        id: input.id,
        organizationId: input.organizationId,
        versionNumber: nextVersionNumber,
        status: 'draft',
        title: input.title,
        maxDepth: input.maxDepth,
        createdAt: input.now,
        updatedAt: input.now,
        createdBy: input.actorId,
      };

      const version = await tx.detailStructureVersion.create({
        data: versionData,
      });

      for (const l of input.levels) {
        await tx.detailStructureLevel.create({
          data: {
            id: l.id,
            organizationId: input.organizationId,
            versionId: input.id,
            levelIndex: l.levelIndex,
            title: l.title,
            digitLength: l.digitLength,
            createdAt: input.now,
            updatedAt: input.now,
            createdBy: input.actorId,
          },
        });
      }

      const levels = await tx.detailStructureLevel.findMany({
        where: { versionId: input.id },
        orderBy: [{ levelIndex: 'asc' }],
      });

      return toDetailStructureVersion(version, levels);
    });
  }

  async updateDraft(input: {
    id: string;
    organizationId: string;
    title: string | null;
    maxDepth: number;
    levels: readonly DetailLevelWrite[];
    now: Date;
    actorId: string | null;
  }): Promise<DetailStructureVersion> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const version = await tx.detailStructureVersion.findFirst({
        where: { id: input.id, organizationId: input.organizationId },
      });
      if (version === null) {
        throw new Error(`Detail structure version "${input.id}" not found.`);
      }
      if (version.status !== 'draft') {
        throw new DetailStructureNotDraftError(version.status);
      }

      await tx.detailStructureLevel.deleteMany({
        where: { versionId: input.id },
      });

      for (const l of input.levels) {
        await tx.detailStructureLevel.create({
          data: {
            id: l.id,
            organizationId: input.organizationId,
            versionId: input.id,
            levelIndex: l.levelIndex,
            title: l.title,
            digitLength: l.digitLength,
            createdAt: input.now,
            updatedAt: input.now,
            createdBy: input.actorId,
          },
        });
      }

      const updated = await tx.detailStructureVersion.update({
        where: { id: input.id },
        data: {
          title: input.title,
          maxDepth: input.maxDepth,
          updatedAt: input.now,
          updatedBy: input.actorId,
        },
      });

      const levels = await tx.detailStructureLevel.findMany({
        where: { versionId: input.id },
        orderBy: [{ levelIndex: 'asc' }],
      });

      return toDetailStructureVersion(updated, levels);
    });
  }

  async publishVersion(input: {
    id: string;
    organizationId: string;
    now: Date;
    actorId: string | null;
  }): Promise<DetailStructureVersion> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const target = await tx.detailStructureVersion.findFirst({
        where: { id: input.id, organizationId: input.organizationId },
      });
      if (target === null) {
        throw new Error(`Detail structure version "${input.id}" not found.`);
      }
      if (target.status !== 'draft') {
        throw new DetailStructureNotDraftError(target.status);
      }

      const levels = await tx.detailStructureLevel.findMany({
        where: { versionId: target.id },
        orderBy: [{ levelIndex: 'asc' }],
      });

      // Supersede current active version(s)
      const activeRows = await tx.detailStructureVersion.findMany({
        where: { organizationId: input.organizationId, status: 'active' },
      });
      for (const active of activeRows) {
        await tx.detailStructureVersion.update({
          where: { id: active.id },
          data: {
            status: 'superseded',
            updatedAt: input.now,
            updatedBy: input.actorId,
          },
        });
      }

      // Activate target version
      const updated = await tx.detailStructureVersion.update({
        where: { id: target.id },
        data: {
          status: 'active',
          updatedAt: input.now,
          updatedBy: input.actorId,
        },
      });

      return toDetailStructureVersion(updated, levels);
    });
  }
}

function toDetailStructureVersion(
  row: DetailStructureVersionRow,
  levelRows: DetailStructureLevelRow[],
): DetailStructureVersion {
  return {
    id: row.id,
    organizationId: row.organizationId,
    versionNumber: row.versionNumber,
    status: isDetailStructureVersionStatus(row.status) ? row.status : 'draft',
    title: row.title ?? null,
    maxDepth: row.maxDepth,
    levels: levelRows.map(toDetailStructureLevel),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDetailStructureLevel(
  row: DetailStructureLevelRow,
): DetailStructureLevel {
  return {
    id: row.id,
    organizationId: row.organizationId,
    versionId: row.versionId,
    levelIndex: row.levelIndex,
    title: row.title,
    digitLength: row.digitLength,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
