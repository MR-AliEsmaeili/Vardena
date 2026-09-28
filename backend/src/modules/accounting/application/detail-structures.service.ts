import { Injectable } from '@nestjs/common';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import {
  toOffset,
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import {
  DetailStructuresRepository,
  type DetailStructureListFilter,
  type DetailLevelWrite,
} from '../data/detail-structures.repository.js';
import type {
  DetailStructureLevelInput,
  DetailStructureVersion,
  DetailStructureVersionDto,
} from '../domain/detail-structure.js';
import {
  detailStructureProblemMessage,
  isDetailStructureStatus,
  planDetailStructure,
  toDetailStructureVersionDto,
} from '../domain/detail-structure.js';
import { DETAIL_STRUCTURE_PERMISSIONS } from '../domain/accounting-permissions.js';
import { normalizeTitle } from '../domain/master-data.js';
import { resolveSort } from './accounting-support.js';

const SORTABLE_FIELDS: Record<string, string> = {
  versionNumber: 'versionNumber',
  status: 'status',
  maxDepth: 'maxDepth',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

export interface ListDetailStructuresQuery {
  organizationId: string;
  page: number;
  pageSize: number;
  status?: string | undefined;
  sort?: string | undefined;
}

export interface CreateDetailStructureInput {
  organizationId: string;
  title?: string | undefined;
  maxDepth?: number | undefined;
  levels?: DetailStructureLevelInput[] | undefined;
}

export interface UpdateDetailStructureDraftInput {
  title?: string | undefined;
  maxDepth?: number | undefined;
  levels?: DetailStructureLevelInput[] | undefined;
}

@Injectable()
export class DetailStructuresService {
  constructor(
    private readonly repository: DetailStructuresRepository,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
  ) {}

  async listDetailStructures(
    query: ListDetailStructuresQuery,
  ): Promise<PaginatedResult<DetailStructureVersionDto>> {
    await this.authorization.requireAllPermissions([
      DETAIL_STRUCTURE_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(query.organizationId);

    if (query.status !== undefined && !isDetailStructureStatus(query.status)) {
      throw AppException.badRequest(
        'status must be "draft", "active", or "superseded".',
      );
    }

    const { skip, take } = toOffset(query.page, query.pageSize);
    const where: DetailStructureListFilter = {
      organizationId: query.organizationId,
      status: query.status,
    };
    const { items, total } = await this.repository.list({
      where,
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [
        { versionNumber: 'desc' },
      ]),
      skip,
      take,
    });

    return toPaginatedResult(
      items.map(toDetailStructureVersionDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getDetailStructure(
    organizationId: string,
    id: string,
  ): Promise<DetailStructureVersionDto> {
    await this.authorization.requireAllPermissions([
      DETAIL_STRUCTURE_PERMISSIONS.VIEW,
    ]);
    return toDetailStructureVersionDto(
      await this.mustFindInOrganization(organizationId, id),
    );
  }

  async getActiveDetailStructure(
    organizationId: string,
  ): Promise<DetailStructureVersionDto | null> {
    await this.authorization.requireAllPermissions([
      DETAIL_STRUCTURE_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(organizationId);
    const version = await this.repository.findActive(organizationId);
    return version === null ? null : toDetailStructureVersionDto(version);
  }

  async requireActiveVersionOrThrow(
    organizationId: string,
  ): Promise<DetailStructureVersion> {
    await this.organizations.assertOrganizationInScope(organizationId);
    const active = await this.repository.findActive(organizationId);
    if (active === null) {
      throw AppException.businessRule(
        'The organization has no active detail structure version.',
      );
    }
    return active;
  }

  async requireVersionInOrganization(
    organizationId: string,
    id: string,
  ): Promise<DetailStructureVersion> {
    return this.mustFindInOrganization(organizationId, id);
  }

  async createDraft(
    input: CreateDetailStructureInput,
  ): Promise<DetailStructureVersionDto> {
    await this.authorization.requireAllPermissions([
      DETAIL_STRUCTURE_PERMISSIONS.CONFIGURE,
    ]);
    await this.organizations.requireUsableOrganization(input.organizationId);

    const levels = input.levels ?? [];
    const maxDepth = input.maxDepth ?? (levels.length > 0 ? levels.length : 3);
    const plan = planDetailStructure({ maxDepth, levels });
    if (plan.problem !== null) {
      throw AppException.businessRule(
        detailStructureProblemMessage(plan.problem),
      );
    }

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const versionId = generateId();

    const levelWrites: DetailLevelWrite[] = levels.map((l) => ({
      id: generateId(),
      levelIndex: l.levelIndex,
      title: normalizeTitle(l.title),
      digitLength: l.digitLength,
    }));

    const created = await this.repository.createDraft({
      id: versionId,
      organizationId: input.organizationId,
      title: input.title ? normalizeTitle(input.title) : null,
      maxDepth,
      levels: levelWrites,
      now,
      actorId,
    });

    this.logger.log(
      'Detail structure draft created',
      {
        versionId: created.id,
        organizationId: created.organizationId,
        versionNumber: created.versionNumber,
      },
      DetailStructuresService.name,
    );
    return toDetailStructureVersionDto(created);
  }

  async updateDraft(
    organizationId: string,
    id: string,
    input: UpdateDetailStructureDraftInput,
  ): Promise<DetailStructureVersionDto> {
    await this.authorization.requireAllPermissions([
      DETAIL_STRUCTURE_PERMISSIONS.CONFIGURE,
    ]);
    const current = await this.mustFindInOrganization(organizationId, id);
    if (current.status !== 'draft') {
      throw AppException.businessRule(
        `Detail structure version "${id}" is ${current.status}; only drafts can be edited.`,
      );
    }

    const levels =
      input.levels ??
      current.levels.map((l) => ({
        levelIndex: l.levelIndex,
        title: l.title,
        digitLength: l.digitLength,
      }));
    const maxDepth = input.maxDepth ?? current.maxDepth;

    const plan = planDetailStructure({ maxDepth, levels });
    if (plan.problem !== null) {
      throw AppException.businessRule(
        detailStructureProblemMessage(plan.problem),
      );
    }

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const levelWrites: DetailLevelWrite[] = levels.map((l) => ({
      id: generateId(),
      levelIndex: l.levelIndex,
      title: normalizeTitle(l.title),
      digitLength: l.digitLength,
    }));

    const updated = await this.repository.updateDraft({
      id: current.id,
      organizationId,
      title:
        input.title !== undefined ? normalizeTitle(input.title) : current.title,
      maxDepth,
      levels: levelWrites,
      now,
      actorId,
    });

    return toDetailStructureVersionDto(updated);
  }

  async publishVersion(
    organizationId: string,
    id: string,
  ): Promise<DetailStructureVersionDto> {
    await this.authorization.requireAllPermissions([
      DETAIL_STRUCTURE_PERMISSIONS.CONFIGURE,
    ]);
    const current = await this.mustFindInOrganization(organizationId, id);
    if (current.status !== 'draft') {
      throw AppException.businessRule(
        `Detail structure version "${id}" is ${current.status}; only drafts can be published.`,
      );
    }

    const plan = planDetailStructure({
      maxDepth: current.maxDepth,
      levels: current.levels.map((l) => ({
        levelIndex: l.levelIndex,
        title: l.title,
        digitLength: l.digitLength,
      })),
    });
    if (plan.problem !== null) {
      throw AppException.businessRule(
        detailStructureProblemMessage(plan.problem),
      );
    }

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const published = await this.repository.publishVersion({
      id: current.id,
      organizationId,
      now,
      actorId,
    });

    this.logger.log(
      'Detail structure published',
      {
        versionId: published.id,
        organizationId: published.organizationId,
        versionNumber: published.versionNumber,
      },
      DetailStructuresService.name,
    );
    return toDetailStructureVersionDto(published);
  }

  private async mustFindInOrganization(
    organizationId: string,
    id: string,
  ): Promise<DetailStructureVersion> {
    await this.organizations.assertOrganizationInScope(organizationId);
    const version = await this.repository.findById(id);
    if (version === null || version.organizationId !== organizationId) {
      throw AppException.notFound('DetailStructureVersion', id);
    }
    return version;
  }
}
