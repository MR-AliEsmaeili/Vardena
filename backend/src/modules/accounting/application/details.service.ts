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
  DetailsRepository,
  DetailImmutableAfterUseError,
  DetailPlacementRejectedError,
  DetailPostabilityRejectedError,
  type DetailListFilter,
  type DetailStructureSnapshot,
} from '../data/details.repository.js';
import type {
  Detail,
  DetailDto,
  DetailPlacementParent,
} from '../domain/detail.js';
import {
  detailPlacementProblemMessage,
  planDetailPlacement,
  planDetailPostabilityChange,
  toDetailDto,
} from '../domain/detail.js';
import { collectDescendantIds } from '../domain/hierarchy.js';
import { DETAIL_PERMISSIONS } from '../domain/accounting-permissions.js';
import { normalizeCode, normalizeTitle } from '../domain/master-data.js';
import {
  assertAccountCode,
  assertTitle,
  assertUsable,
  resolveSort,
} from './accounting-support.js';
import { DetailStructuresService } from './detail-structures.service.js';

const SORTABLE_FIELDS: Record<string, string> = {
  code: 'code',
  title: 'title',
  level: 'level',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

export interface ListDetailsQuery {
  organizationId: string;
  page: number;
  pageSize: number;
  parentId?: string | null | undefined;
  level?: number | undefined;
  isActive?: boolean | undefined;
  isPostable?: boolean | undefined;
  detailStructureVersionId?: string | undefined;
  search?: string | undefined;
  sort?: string | undefined;
}

export interface CreateDetailInput {
  organizationId: string;
  code: string;
  title: string;
  parentId?: string | null | undefined;
  isPostable?: boolean | undefined;
}

export interface UpdateDetailInput {
  title?: string | undefined;
  isPostable?: boolean | undefined;
  parentId?: string | null | undefined;
}

@Injectable()
export class DetailsService {
  constructor(
    private readonly repository: DetailsRepository,
    private readonly structures: DetailStructuresService,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
  ) {}

  async listDetails(
    query: ListDetailsQuery,
  ): Promise<PaginatedResult<DetailDto>> {
    await this.authorization.requireAllPermissions([DETAIL_PERMISSIONS.VIEW]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    if (query.parentId !== undefined && query.parentId !== null) {
      await this.mustFindInOrganization(query.organizationId, query.parentId);
    }
    const { skip, take } = toOffset(query.page, query.pageSize);
    const where: DetailListFilter = {
      organizationId: query.organizationId,
      parentId: query.parentId,
      level: query.level,
      isActive: query.isActive,
      isPostable: query.isPostable,
      detailStructureVersionId: query.detailStructureVersionId,
      search: query.search,
    };
    const { items, total } = await this.repository.list({
      where,
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [{ code: 'asc' }]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toDetailDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getDetail(organizationId: string, id: string): Promise<DetailDto> {
    await this.authorization.requireAllPermissions([DETAIL_PERMISSIONS.VIEW]);
    return toDetailDto(await this.mustFindInOrganization(organizationId, id));
  }

  async createDetail(input: CreateDetailInput): Promise<DetailDto> {
    await this.authorization.requireAllPermissions([DETAIL_PERMISSIONS.CREATE]);
    const code = normalizeCode(input.code);
    const title = normalizeTitle(input.title);
    assertAccountCode(code);
    assertTitle(title);

    await this.organizations.requireUsableOrganization(input.organizationId);

    const parentId = input.parentId ?? null;
    let parent: DetailPlacementParent | null = null;
    let structureVersionId: string;
    let structureSnapshot: DetailStructureSnapshot;

    if (parentId !== null) {
      const parentDetail = await this.mustFindInOrganization(
        input.organizationId,
        parentId,
      );
      structureVersionId = parentDetail.detailStructureVersionId;
      const version = await this.structures.requireVersionInOrganization(
        input.organizationId,
        structureVersionId,
      );
      structureSnapshot = {
        versionId: version.id,
        maxDepth: version.maxDepth,
        levels: version.levels,
      };
      parent = {
        id: parentDetail.id,
        organizationId: parentDetail.organizationId,
        code: parentDetail.code,
        level: parentDetail.level,
        isPostable: parentDetail.isPostable,
        isActive: parentDetail.isActive,
        detailStructureVersionId: parentDetail.detailStructureVersionId,
      };
    } else {
      const activeVersion = await this.structures.requireActiveVersionOrThrow(
        input.organizationId,
      );
      structureVersionId = activeVersion.id;
      structureSnapshot = {
        versionId: activeVersion.id,
        maxDepth: activeVersion.maxDepth,
        levels: activeVersion.levels,
      };
    }

    const plan = planDetailPlacement({
      id: '',
      organizationId: input.organizationId,
      parentId,
      code,
      parent,
      descendantIds: [],
      levels: structureSnapshot.levels,
      maxDepth: structureSnapshot.maxDepth,
    });

    if (plan.problem !== null) {
      throw AppException.businessRule(
        detailPlacementProblemMessage(plan.problem),
      );
    }

    const existing = await this.repository.findByCode(
      input.organizationId,
      code,
    );
    if (existing !== null) {
      throw AppException.conflict(
        'A detail record with that code already exists in this organization.',
      );
    }

    const isPostable = input.isPostable ?? true;
    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;

    try {
      const created = await this.repository.createChecked({
        id: generateId(),
        organizationId: input.organizationId,
        code,
        title,
        parentId,
        isPostable,
        structure: structureSnapshot,
        now,
        actorId,
      });
      this.logger.log(
        'Detail created',
        {
          detailId: created.id,
          organizationId: created.organizationId,
          code: created.code,
          level: created.level,
        },
        DetailsService.name,
      );
      return toDetailDto(created);
    } catch (error) {
      const mapped = mapDetailGuardError(error);
      if (mapped !== null) throw mapped;
      throw error;
    }
  }

  async updateDetail(
    organizationId: string,
    id: string,
    input: UpdateDetailInput,
  ): Promise<DetailDto> {
    await this.authorization.requireAllPermissions([DETAIL_PERMISSIONS.EDIT]);
    const current = await this.mustFindInOrganization(organizationId, id);

    const title =
      input.title === undefined ? undefined : normalizeTitle(input.title);
    if (title !== undefined) {
      assertTitle(title);
    }

    const parentChanging =
      input.parentId !== undefined &&
      (input.parentId ?? null) !== current.parentId;
    let parent: DetailPlacementParent | null = null;
    let structureForMove: DetailStructureSnapshot | null = null;

    if (parentChanging) {
      const version = await this.structures.requireVersionInOrganization(
        current.organizationId,
        current.detailStructureVersionId,
      );
      structureForMove = {
        versionId: version.id,
        maxDepth: version.maxDepth,
        levels: version.levels,
      };
      if (input.parentId !== null && input.parentId !== undefined) {
        const parentDetail = await this.mustFindInOrganization(
          current.organizationId,
          input.parentId,
        );
        parent = {
          id: parentDetail.id,
          organizationId: parentDetail.organizationId,
          code: parentDetail.code,
          level: parentDetail.level,
          isPostable: parentDetail.isPostable,
          isActive: parentDetail.isActive,
          detailStructureVersionId: parentDetail.detailStructureVersionId,
        };
      }
    }

    try {
      const updated = await this.repository.updateChecked({
        id,
        title,
        isPostable: input.isPostable,
        parentId: input.parentId,
        structure: structureForMove,
        now: new Date(),
        actorId: getPrincipal()?.userId ?? null,
      });
      return toDetailDto(updated);
    } catch (error) {
      const mapped = mapDetailGuardError(error);
      if (mapped !== null) throw mapped;
      throw error;
    }
  }

  async enableDetail(organizationId: string, id: string): Promise<DetailDto> {
    return this.setActive(organizationId, id, true, DETAIL_PERMISSIONS.ENABLE);
  }

  async disableDetail(organizationId: string, id: string): Promise<DetailDto> {
    return this.setActive(
      organizationId,
      id,
      false,
      DETAIL_PERMISSIONS.DISABLE,
    );
  }

  async requireUsableDetailInOrganization(
    id: string,
    organizationId: string,
    options: { allowInactive?: boolean } = {},
  ): Promise<Detail> {
    const detail = await this.repository.findById(id);
    if (detail === null || detail.organizationId !== organizationId) {
      throw AppException.notFound('Detail', id);
    }
    assertUsable('Detail', detail.isActive, {
      allowInactive: options.allowInactive ?? false,
    });
    return detail;
  }

  private async setActive(
    organizationId: string,
    id: string,
    isActive: boolean,
    permission: string,
  ): Promise<DetailDto> {
    await this.authorization.requireAllPermissions([permission]);
    const current = await this.mustFindInOrganization(organizationId, id);
    if (current.isActive === isActive) return toDetailDto(current);

    const updated = await this.repository.update(id, {
      isActive,
      updatedAt: new Date(),
      updatedBy: getPrincipal()?.userId ?? null,
    });
    if (updated === null) throw AppException.notFound('Detail', id);
    return toDetailDto(updated);
  }

  private async mustFindInOrganization(
    organizationId: string,
    id: string,
  ): Promise<Detail> {
    await this.organizations.assertOrganizationInScope(organizationId);
    const detail = await this.repository.findById(id);
    if (detail === null || detail.organizationId !== organizationId) {
      throw AppException.notFound('Detail', id);
    }
    return detail;
  }
}

function mapDetailGuardError(error: unknown): AppException | null {
  if (error instanceof DetailPlacementRejectedError) {
    return AppException.businessRule(
      detailPlacementProblemMessage(error.problem as any),
      { problem: error.problem },
    );
  }
  if (error instanceof DetailPostabilityRejectedError) {
    return AppException.businessRule(
      'Cannot make a detail with child records postable.',
      { blockingDetailId: error.childId },
    );
  }
  if (error instanceof DetailImmutableAfterUseError) {
    return AppException.businessRule(
      `The detail is referenced by document lines; ${error.fields.join(
        ', ',
      )} can no longer change.`,
      { refused: error.fields },
    );
  }
  return null;
}
