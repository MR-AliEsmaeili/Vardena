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
import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { NumberingSeriesRepository } from '../data/numbering-series.repository.js';
import {
  isNumberingReusePolicy,
  isNumberingStrategy,
  isValidWidth,
  MAX_SERIES_NAME_LENGTH,
  DEFAULT_NUMBERING_STRATEGY,
  DEFAULT_NUMBERING_REUSE_POLICY,
} from '../domain/numbering.js';
import type { NumberingSeries } from '../domain/numbering-series.js';
import { toNumberingSeriesDto } from '../domain/numbering-series.js';
import { NUMBERING_SERIES_PERMISSIONS } from '../domain/document-permissions.js';
import { requireScopeKey } from './documents-support.js';
import { DocumentTypesService } from './document-types.service.js';

const SORTABLE_FIELDS: Record<string, string> = {
  name: 'name',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

export interface ListNumberingSeriesQuery {
  organizationId: string;
  documentType?: string | undefined;
  isActive?: boolean | undefined;
  page: number;
  pageSize: number;
  sort?: string | undefined;
}

export interface CreateNumberingSeriesInput {
  organizationId: string;
  documentType: string;
  scopeKey?: string | null | undefined;
  name: string;
  strategy?: string | null | undefined;
  width?: number | undefined;
  reusePolicy?: string | null | undefined;
}

export interface UpdateNumberingSeriesInput {
  name?: string | undefined;
  strategy?: string | undefined;
  width?: number | undefined;
  reusePolicy?: string | undefined;
  isActive?: boolean | undefined;
}

/**
 * Numbering series configuration (Task 8 §11).
 *
 * A series is the configuration slice a number allocation runs against:
 * (organization, document type, scope) → strategy + width + reuse policy +
 * counter. This service administers the configuration; the allocation itself
 * (with its row lock and idempotency) lives in `NumberingService`.
 *
 * The counter (`last_value`) is never editable through configuration: it is
 * advanced only by the allocation transaction, so numbers can never be
 * back-filled or reused by editing configuration (ADR-0019 §7).
 */
@Injectable()
export class NumberingSeriesService {
  constructor(
    private readonly repository: NumberingSeriesRepository,
    private readonly organizations: OrganizationsService,
    private readonly documentTypes: DocumentTypesService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
  ) {}

  async listNumberingSeries(
    query: ListNumberingSeriesQuery,
  ): Promise<PaginatedResult<ReturnType<typeof toNumberingSeriesDto>>> {
    await this.authorization.requireAllPermissions([
      NUMBERING_SERIES_PERMISSIONS.VIEW,
    ]);
    await this.organizations.requireUsableOrganization(query.organizationId);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: {
        organizationId: query.organizationId,
        documentType: query.documentType,
        isActive: query.isActive,
      },
      orderBy: resolveSort(query.sort),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toNumberingSeriesDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getNumberingSeries(organizationId: string, id: string) {
    await this.authorization.requireAllPermissions([
      NUMBERING_SERIES_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(organizationId);
    return toNumberingSeriesDto(
      await this.requireSeriesInOrganization(organizationId, id),
    );
  }

  async createNumberingSeries(input: CreateNumberingSeriesInput) {
    await this.authorization.requireAllPermissions([
      NUMBERING_SERIES_PERMISSIONS.CREATE,
    ]);
    await this.organizations.requireUsableOrganization(input.organizationId);
    // Only a registered document type can be numbered (Task 8 §6: the type is
    // code; there is no free-text type and no arbitrary numbering).
    this.documentTypes.requireDocumentType(input.documentType);

    const scopeKey = requireScopeKey(input.scopeKey);
    const name = normalizeSeriesName(input.name);
    const strategy = normalizeStrategy(input.strategy);
    const width = normalizeWidth(input.width);
    const reusePolicy = normalizeReusePolicy(input.reusePolicy);

    const existing = await this.repository.findByScope(
      input.organizationId,
      input.documentType,
      scopeKey,
    );
    if (existing !== null) {
      throw AppException.conflict(
        'A numbering series already exists for this organization, document type and scope.',
      );
    }

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    let created: NumberingSeries;
    try {
      created = await this.repository.create({
        id: generateId(),
        organizationId: input.organizationId,
        documentType: input.documentType,
        scopeKey,
        name,
        strategy,
        width,
        reusePolicy,
        lastValue: 0n,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'A numbering series already exists for this organization, document type and scope.',
        );
      }
      throw error;
    }
    this.logger.log(
      'Numbering series created',
      { seriesId: created.id, organizationId: created.organizationId },
      NumberingSeriesService.name,
    );
    return toNumberingSeriesDto(created);
  }

  async updateNumberingSeries(
    organizationId: string,
    id: string,
    input: UpdateNumberingSeriesInput,
  ) {
    await this.authorization.requireAllPermissions([
      NUMBERING_SERIES_PERMISSIONS.EDIT,
    ]);
    await this.requireSeriesInOrganization(organizationId, id);

    const patch: {
      name?: string;
      strategy?: string;
      width?: number;
      reusePolicy?: string;
      isActive?: boolean;
      updatedAt: Date;
      updatedBy: string | null;
    } = { updatedAt: new Date(), updatedBy: getPrincipal()?.userId ?? null };

    if (input.name !== undefined) patch.name = normalizeSeriesName(input.name);
    if (input.strategy !== undefined) {
      patch.strategy = normalizeStrategy(input.strategy);
    }
    if (input.width !== undefined) patch.width = normalizeWidth(input.width);
    if (input.reusePolicy !== undefined) {
      patch.reusePolicy = normalizeReusePolicy(input.reusePolicy);
    }
    if (input.isActive !== undefined) patch.isActive = input.isActive;

    const updated = await this.repository.update(id, patch);
    if (updated === null) throw AppException.notFound('Numbering series', id);
    this.logger.log(
      'Numbering series updated',
      { seriesId: updated.id, organizationId: updated.organizationId },
      NumberingSeriesService.name,
    );
    return toNumberingSeriesDto(updated);
  }

  /**
   * Cross-module series resolution (AR-07): the numbering allocation path
   * resolves a series through this method. No permission of its own — the
   * calling service has already authorized its action.
   */
  async resolveSeries(
    organizationId: string,
    documentType: string,
    scopeKey: string,
  ): Promise<NumberingSeries | null> {
    return this.repository.findByScope(organizationId, documentType, scopeKey);
  }

  /**
   * Organization-scoped by-id resolution (AR-07, ADR-0016). A series that does
   * not exist or belongs to another organization is reported as *not found*,
   * so the API never confirms that an id from another tenant exists. No
   * permission of its own — the calling service has already authorized its
   * action.
   */
  async requireSeriesInOrganization(
    organizationId: string,
    id: string,
  ): Promise<NumberingSeries> {
    const series = await this.repository.findById(id);
    if (series === null || series.organizationId !== organizationId) {
      throw AppException.notFound('Numbering series', id);
    }
    return series;
  }
}

// ---- Internal helpers ----

function resolveSort(
  sort: string | undefined,
): Array<Record<string, 'asc' | 'desc'>> {
  if (sort === undefined || sort === '') {
    return [{ createdAt: 'asc' }];
  }
  return sort.split(',').map((entry) => {
    const [field, direction] = entry.split(':');
    const mapped = field === undefined ? undefined : SORTABLE_FIELDS[field];
    if (mapped === undefined || (direction !== 'asc' && direction !== 'desc')) {
      throw AppException.validation([
        {
          field: 'sort',
          message: `Cannot sort by "${field ?? ''}". Allowed: ${Object.keys(SORTABLE_FIELDS).join(', ')}.`,
          code: 'isSortableField',
        },
      ]);
    }
    return { [mapped]: direction };
  });
}

function normalizeSeriesName(value: string): string {
  const name = value.trim();
  if (name === '') {
    throw AppException.badRequest('The series name is required.');
  }
  if (name.length > MAX_SERIES_NAME_LENGTH) {
    throw AppException.badRequest(
      `The series name must be at most ${MAX_SERIES_NAME_LENGTH} characters.`,
    );
  }
  return name;
}

function normalizeStrategy(value: string | null | undefined): string {
  const strategy = value?.trim() || DEFAULT_NUMBERING_STRATEGY;
  if (!isNumberingStrategy(strategy)) {
    throw AppException.badRequest(
      `Numbering strategy must be one of: ${'monotonic'}.`,
    );
  }
  return strategy;
}

function normalizeWidth(value: number | undefined): number {
  const width = value ?? 0;
  if (!isValidWidth(width)) {
    throw AppException.badRequest(
      `Numbering width must be an integer between 0 and 32.`,
    );
  }
  return width;
}

function normalizeReusePolicy(value: string | null | undefined): string {
  const policy = value?.trim() || DEFAULT_NUMBERING_REUSE_POLICY;
  if (!isNumberingReusePolicy(policy)) {
    throw AppException.badRequest(
      `Reuse policy must be one of: never, recycle.`,
    );
  }
  return policy;
}
