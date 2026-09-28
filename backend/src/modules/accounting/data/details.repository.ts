import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import type { Detail, DetailPlacementParent } from '../domain/detail.js';
import {
  planDetailPlacement,
  planDetailPostabilityChange,
} from '../domain/detail.js';
import { collectDescendantIds } from '../domain/hierarchy.js';
import type {
  AccountingTransactionalClient,
  DetailDelegate,
  DetailRow,
  DetailUpdate,
  DetailWhere,
  OrderBy,
} from './accounting-rows.js';

export class DetailPlacementRejectedError extends Error {
  constructor(public readonly problem: string) {
    super(`Detail placement rejected: ${problem}`);
    this.name = 'DetailPlacementRejectedError';
  }
}

export class DetailPostabilityRejectedError extends Error {
  constructor(public readonly childId: string) {
    super(`Cannot make detail postable because it has child records.`);
    this.name = 'DetailPostabilityRejectedError';
  }
}

export class DetailImmutableAfterUseError extends Error {
  constructor(public readonly fields: readonly string[]) {
    super(
      `Detail is referenced by accounting documents; ${fields.join(', ')} cannot be changed.`,
    );
    this.name = 'DetailImmutableAfterUseError';
  }
}

export interface DetailListFilter {
  organizationId: string;
  parentId?: string | null | undefined;
  level?: number | undefined;
  isActive?: boolean | undefined;
  isPostable?: boolean | undefined;
  detailStructureVersionId?: string | undefined;
  search?: string | undefined;
}

export interface DetailStructureSnapshot {
  versionId: string;
  maxDepth: number;
  levels: readonly { levelIndex: number; digitLength: number; title: string }[];
}

type Client = {
  detail: DetailDelegate;
};

@Injectable()
export class DetailsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private async client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  private async transacting(): Promise<AccountingTransactionalClient> {
    return this.prisma.getClient<AccountingTransactionalClient>();
  }

  async findById(id: string): Promise<Detail | null> {
    const { detail } = await this.client();
    const row = await detail.findUnique({ where: { id } });
    return row === null ? null : toDetail(row);
  }

  async findByCode(
    organizationId: string,
    code: string,
  ): Promise<Detail | null> {
    const { detail } = await this.client();
    const row = await detail.findFirst({
      where: { organizationId, code },
    });
    return row === null ? null : toDetail(row);
  }

  async findChild(
    organizationId: string,
    parentId: string,
  ): Promise<Detail | null> {
    const { detail } = await this.client();
    const row = await detail.findFirst({
      where: { organizationId, parentId },
    });
    return row === null ? null : toDetail(row);
  }

  async listHierarchyEdges(
    organizationId: string,
  ): Promise<Array<{ id: string; parentId: string | null }>> {
    const { detail } = await this.client();
    const rows = await detail.findMany({
      where: { organizationId },
      orderBy: [{ code: 'asc' }],
      skip: 0,
      take: 10000,
    });
    return rows.map((r) => ({ id: r.id, parentId: r.parentId }));
  }

  async list(params: {
    where: DetailListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: Detail[]; total: number }> {
    const { detail } = await this.client();
    const where: DetailWhere = { organizationId: params.where.organizationId };
    if (params.where.parentId !== undefined) {
      where.parentId = params.where.parentId;
    }
    if (params.where.level !== undefined) {
      where.level = params.where.level;
    }
    if (params.where.isActive !== undefined) {
      where.isActive = params.where.isActive;
    }
    if (params.where.isPostable !== undefined) {
      where.isPostable = params.where.isPostable;
    }
    if (params.where.detailStructureVersionId !== undefined) {
      where.detailStructureVersionId = params.where.detailStructureVersionId;
    }
    if (
      params.where.search !== undefined &&
      params.where.search.trim().length > 0
    ) {
      const term = params.where.search.trim();
      where.OR = [
        { code: { contains: term, mode: 'insensitive' } },
        { title: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      detail.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      detail.count({ where }),
    ]);

    return {
      items: rows.map(toDetail),
      total,
    };
  }

  async createChecked(input: {
    id: string;
    organizationId: string;
    code: string;
    title: string;
    parentId: string | null;
    isPostable: boolean;
    structure: DetailStructureSnapshot;
    now: Date;
    actorId: string | null;
  }): Promise<Detail> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      let parent: DetailPlacementParent | null = null;
      if (input.parentId !== null) {
        const parentRow = await tx.detail.findUnique({
          where: { id: input.parentId },
        });
        if (
          parentRow === null ||
          parentRow.organizationId !== input.organizationId
        ) {
          throw new DetailPlacementRejectedError('parent_not_found');
        }
        parent = {
          id: parentRow.id,
          organizationId: parentRow.organizationId,
          code: parentRow.code,
          level: parentRow.level,
          isPostable: parentRow.isPostable,
          isActive: parentRow.isActive,
          detailStructureVersionId: parentRow.detailStructureVersionId,
        };
      }

      const allDetails = await tx.detail.findMany({
        where: { organizationId: input.organizationId },
        orderBy: [{ code: 'asc' }],
        skip: 0,
        take: 10000,
      });
      const edges = allDetails.map((d) => ({ id: d.id, parentId: d.parentId }));
      const descendantIds = collectDescendantIds(edges, input.id);

      const plan = planDetailPlacement({
        id: input.id,
        organizationId: input.organizationId,
        parentId: input.parentId,
        code: input.code,
        parent,
        descendantIds,
        levels: input.structure.levels,
        maxDepth: input.structure.maxDepth,
      });

      if (plan.problem !== null) {
        throw new DetailPlacementRejectedError(plan.problem);
      }

      const row = await tx.detail.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          code: input.code,
          title: input.title.trim(),
          parentId: input.parentId,
          level: plan.level,
          detailStructureVersionId: input.structure.versionId,
          isPostable: input.isPostable,
          isActive: true,
          createdAt: input.now,
          updatedAt: input.now,
          createdBy: input.actorId,
        },
      });

      return toDetail(row);
    });
  }

  async updateChecked(input: {
    id: string;
    title?: string | undefined;
    isPostable?: boolean | undefined;
    parentId?: string | null | undefined;
    structure: DetailStructureSnapshot | null;
    now: Date;
    actorId: string | null;
  }): Promise<Detail> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const existing = await tx.detail.findUnique({
        where: { id: input.id },
      });
      if (existing === null) {
        throw new Error(`Detail "${input.id}" no longer exists.`);
      }

      const children = await tx.detail.findMany({
        where: {
          organizationId: existing.organizationId,
          parentId: existing.id,
        },
        orderBy: [{ id: 'asc' }],
        take: 2,
      });
      const hasChildren = children.length > 0;

      if (input.isPostable !== undefined) {
        const problem = planDetailPostabilityChange({
          isPostable: input.isPostable,
          hasChildren,
        });
        if (problem !== null) {
          throw new DetailPostabilityRejectedError(children[0]?.id ?? '');
        }
      }

      const parentChanging =
        input.parentId !== undefined && input.parentId !== existing.parentId;
      let level = existing.level;

      if (parentChanging) {
        if (input.structure === null) {
          throw new Error('Detail move requires the structure snapshot.');
        }

        let parent: DetailPlacementParent | null = null;
        if (input.parentId !== null && input.parentId !== undefined) {
          const parentRow = await tx.detail.findUnique({
            where: { id: input.parentId },
          });
          if (
            parentRow === null ||
            parentRow.organizationId !== existing.organizationId
          ) {
            throw new DetailPlacementRejectedError('parent_not_found');
          }
          parent = {
            id: parentRow.id,
            organizationId: parentRow.organizationId,
            code: parentRow.code,
            level: parentRow.level,
            isPostable: parentRow.isPostable,
            isActive: parentRow.isActive,
            detailStructureVersionId: parentRow.detailStructureVersionId,
          };
        }

        const allDetails = await tx.detail.findMany({
          where: { organizationId: existing.organizationId },
          orderBy: [{ code: 'asc' }],
          skip: 0,
          take: 10000,
        });
        const edges = allDetails.map((d) => ({
          id: d.id,
          parentId: d.parentId,
        }));
        const descendantIds = collectDescendantIds(edges, existing.id);

        const plan = planDetailPlacement({
          id: existing.id,
          organizationId: existing.organizationId,
          parentId: input.parentId ?? null,
          code: existing.code,
          parent,
          descendantIds,
          levels: input.structure.levels,
          maxDepth: input.structure.maxDepth,
        });

        if (plan.problem !== null) {
          throw new DetailPlacementRejectedError(plan.problem);
        }
        level = plan.level;
      }

      const patch: DetailUpdate = {
        updatedAt: input.now,
        updatedBy: input.actorId,
      };
      if (input.title !== undefined) patch.title = input.title.trim();
      if (input.isPostable !== undefined) patch.isPostable = input.isPostable;
      if (parentChanging) {
        patch.parentId = input.parentId ?? null;
        patch.level = level;
      }

      const updated = await tx.detail.update({
        where: { id: existing.id },
        data: patch,
      });

      return toDetail(updated);
    });
  }

  async update(
    id: string,
    patch: Partial<DetailUpdate>,
  ): Promise<Detail | null> {
    const { detail } = await this.client();
    try {
      return toDetail(
        await detail.update({ where: { id }, data: patch as DetailUpdate }),
      );
    } catch {
      return null;
    }
  }
}

export function toDetail(row: DetailRow): Detail {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    title: row.title,
    parentId: row.parentId,
    level: row.level,
    detailStructureVersionId: row.detailStructureVersionId,
    isPostable: row.isPostable,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
