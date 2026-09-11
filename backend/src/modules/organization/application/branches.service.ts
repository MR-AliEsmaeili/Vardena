import { Inject, Injectable } from '@nestjs/common';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
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
import { BranchesRepository } from '../data/branches.repository.js';
import type { Branch, BranchDto } from '../domain/branch.js';
import { toBranchDto } from '../domain/branch.js';
import { normalizeCode, normalizeName } from '../domain/master-data.js';
import { BRANCH_PERMISSIONS } from '../domain/organization-permissions.js';
import {
  BRANCH_CREATED_EVENT,
  BRANCH_DISABLED_EVENT,
  BRANCH_ENABLED_EVENT,
  BRANCH_UPDATED_EVENT,
} from '../domain/organization.events.js';
import {
  assertCodeAndName,
  assertUsable,
  publishEvent,
  resolveSort,
} from './master-data-support.js';
import { OrganizationsService } from './organizations.service.js';

const SORTABLE_FIELDS: Record<string, string> = {
  code: 'code',
  name: 'name',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

export interface ListBranchesQuery {
  /** Mandatory: a branch list is never cross-organization. */
  organizationId: string;
  page: number;
  pageSize: number;
  isActive?: boolean | undefined;
  search?: string | undefined;
  sort?: string | undefined;
}

export interface CreateBranchInput {
  organizationId: string;
  code: string;
  name: string;
}

export interface UpdateBranchInput {
  code?: string | undefined;
  name?: string | undefined;
}

/**
 * Branch administration (master-data-strategy.md §2, ADR-0020 §1, OQ-22).
 *
 * A branch is a scope dimension, not a legal entity: this service manages the
 * structure only. Nothing here creates ledger, numbering or document scoping —
 * those arrive with their own modules and consume `branch_id` through this
 * module's public service (AR-07).
 *
 * Organization ownership is enforced in this layer, not left to callers:
 * a branch is always created under an existing, enabled organization, and the
 * list/read paths are always filtered by one organization.
 */
@Injectable()
export class BranchesService {
  constructor(
    private readonly repository: BranchesRepository,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async listBranches(
    query: ListBranchesQuery,
  ): Promise<PaginatedResult<BranchDto>> {
    await this.authorization.requireAllPermissions([BRANCH_PERMISSIONS.VIEW]);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: {
        organizationId: query.organizationId,
        isActive: query.isActive,
        search: query.search,
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [{ code: 'asc' }]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toBranchDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getBranch(id: string): Promise<BranchDto> {
    await this.authorization.requireAllPermissions([BRANCH_PERMISSIONS.VIEW]);
    return toBranchDto(await this.mustFind(id));
  }

  async createBranch(input: CreateBranchInput): Promise<BranchDto> {
    await this.authorization.requireAllPermissions([BRANCH_PERMISSIONS.CREATE]);
    const code = normalizeCode(input.code);
    const name = normalizeName(input.name);
    assertCodeAndName(code, name);

    // Organization must exist and be enabled: a disabled organization blocks
    // new organization-scoped records (master-data-strategy.md §7.4).
    await this.organizations.requireUsableOrganization(input.organizationId);

    const existing = await this.repository.findByCode(
      input.organizationId,
      code,
    );
    if (existing !== null) {
      throw AppException.conflict(
        'A branch with that code already exists in this organization.',
      );
    }

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    let created: Branch;
    try {
      created = await this.repository.create({
        id: generateId(),
        organizationId: input.organizationId,
        code,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'A branch with that code already exists in this organization.',
        );
      }
      throw error;
    }

    await publishEvent(this.events, {
      type: BRANCH_CREATED_EVENT,
      aggregateType: 'Branch',
      aggregateId: created.id,
      payload: {
        id: created.id,
        organizationId: created.organizationId,
        code: created.code,
      },
    });
    this.logger.log(
      'Branch created',
      { branchId: created.id, organizationId: created.organizationId },
      BranchesService.name,
    );
    return toBranchDto(created);
  }

  async updateBranch(id: string, input: UpdateBranchInput): Promise<BranchDto> {
    await this.authorization.requireAllPermissions([BRANCH_PERMISSIONS.EDIT]);
    const current = await this.mustFind(id);
    const code =
      input.code === undefined ? undefined : normalizeCode(input.code);
    const name =
      input.name === undefined ? undefined : normalizeName(input.name);
    assertCodeAndName(code ?? current.code, name ?? current.name);

    if (code !== undefined && code !== current.code) {
      const taken = await this.repository.findByCodeExcludingId(
        current.organizationId,
        code,
        id,
      );
      if (taken !== null) {
        throw AppException.conflict(
          'A branch with that code already exists in this organization.',
        );
      }
    }

    const patch: {
      code?: string;
      name?: string;
      updatedAt: Date;
      updatedBy: string | null;
    } = { updatedAt: new Date(), updatedBy: getPrincipal()?.userId ?? null };
    if (code !== undefined) patch.code = code;
    if (name !== undefined) patch.name = name;

    const updated = await this.repository.update(id, patch);
    if (updated === null) throw AppException.notFound('Branch', id);

    await publishEvent(this.events, {
      type: BRANCH_UPDATED_EVENT,
      aggregateType: 'Branch',
      aggregateId: updated.id,
      payload: {
        id: updated.id,
        organizationId: updated.organizationId,
        code: updated.code,
      },
    });
    return toBranchDto(updated);
  }

  async enableBranch(id: string): Promise<BranchDto> {
    return this.setActive(id, true, BRANCH_PERMISSIONS.ENABLE);
  }

  async disableBranch(id: string): Promise<BranchDto> {
    return this.setActive(id, false, BRANCH_PERMISSIONS.DISABLE);
  }

  /**
   * Cross-module reference resolution (AR-07): the Inventory module resolves a
   * warehouse's branch through this method and never reads
   * `organization.branches`.
   *
   * The organization consistency check is the important half: a branch from
   * another organization is reported as *not found* rather than as a
   * cross-organization error, so the API never confirms that an id belonging
   * to a different organization exists.
   */
  async requireUsableBranchInOrganization(
    id: string,
    organizationId: string,
    options: { allowInactive?: boolean } = {},
  ): Promise<Branch> {
    const branch = await this.repository.findById(id);
    if (branch === null || branch.organizationId !== organizationId) {
      throw AppException.notFound('Branch', id);
    }
    assertUsable('Branch', branch.isActive, {
      allowInactive: options.allowInactive ?? false,
    });
    return branch;
  }

  // ---- internals ----------------------------------------------------------

  private async setActive(
    id: string,
    isActive: boolean,
    permission: string,
  ): Promise<BranchDto> {
    await this.authorization.requireAllPermissions([permission]);
    const current = await this.mustFind(id);
    if (current.isActive === isActive) return toBranchDto(current);

    const updated = await this.repository.update(id, {
      isActive,
      updatedAt: new Date(),
      updatedBy: getPrincipal()?.userId ?? null,
    });
    if (updated === null) throw AppException.notFound('Branch', id);

    await publishEvent(this.events, {
      type: isActive ? BRANCH_ENABLED_EVENT : BRANCH_DISABLED_EVENT,
      aggregateType: 'Branch',
      aggregateId: updated.id,
      payload: {
        id: updated.id,
        organizationId: updated.organizationId,
        code: updated.code,
      },
    });
    return toBranchDto(updated);
  }

  private async mustFind(id: string): Promise<Branch> {
    const branch = await this.repository.findById(id);
    if (branch === null) throw AppException.notFound('Branch', id);
    return branch;
  }
}
