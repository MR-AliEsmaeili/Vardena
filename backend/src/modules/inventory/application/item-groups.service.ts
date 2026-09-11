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
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { ItemGroupsRepository } from '../data/item-groups.repository.js';
import type { ItemGroup, ItemGroupDto } from '../domain/item-group.js';
import { toItemGroupDto } from '../domain/item-group.js';
import {
  collectDescendantIds,
  findHierarchyProblem,
} from '../domain/hierarchy.js';
import { normalizeCode, normalizeName } from '../domain/master-data.js';
import { ITEM_GROUP_PERMISSIONS } from '../domain/inventory-permissions.js';
import {
  ITEM_GROUP_CREATED_EVENT,
  ITEM_GROUP_DISABLED_EVENT,
  ITEM_GROUP_ENABLED_EVENT,
  ITEM_GROUP_UPDATED_EVENT,
} from '../domain/inventory.events.js';
import {
  assertCodeAndName,
  assertUsable,
  hierarchyProblemMessage,
  publishEvent,
  resolveSort,
} from './master-data-support.js';

const SORTABLE_FIELDS: Record<string, string> = {
  code: 'code',
  name: 'name',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

export interface ListItemGroupsQuery {
  organizationId: string;
  page: number;
  pageSize: number;
  isActive?: boolean | undefined;
  parentId?: string | undefined;
  search?: string | undefined;
  sort?: string | undefined;
}

export interface CreateItemGroupInput {
  organizationId: string;
  parentId?: string | null | undefined;
  code: string;
  name: string;
}

export interface UpdateItemGroupInput {
  parentId?: string | null | undefined;
  code?: string | undefined;
  name?: string | undefined;
}

/**
 * Item group administration — hierarchical classification, per organization
 * (master-data-strategy.md §3.2, blueprint §11).
 *
 * Not a universal category/tag system: one self-referencing tree validated with
 * exactly three rules (same organization, no self-parenting, no cycles).
 *
 * Groups do **not** carry capability or unit defaults in Task 6: nothing in the
 * approved model defines group-level defaults, and inventing them would let a
 * group silently shape items (master-data-strategy.md §3.2/§7.2 say groups may
 * supply defaults but do not define any). Item defaults come from the item's
 * kind, resolved at creation.
 */
@Injectable()
export class ItemGroupsService {
  constructor(
    private readonly repository: ItemGroupsRepository,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async listItemGroups(
    query: ListItemGroupsQuery,
  ): Promise<PaginatedResult<ItemGroupDto>> {
    await this.authorization.requireAllPermissions([
      ITEM_GROUP_PERMISSIONS.VIEW,
    ]);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: {
        organizationId: query.organizationId,
        isActive: query.isActive,
        parentId: query.parentId,
        search: query.search,
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [{ code: 'asc' }]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toItemGroupDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getItemGroup(id: string): Promise<ItemGroupDto> {
    await this.authorization.requireAllPermissions([
      ITEM_GROUP_PERMISSIONS.VIEW,
    ]);
    return toItemGroupDto(await this.mustFind(id));
  }

  async createItemGroup(input: CreateItemGroupInput): Promise<ItemGroupDto> {
    await this.authorization.requireAllPermissions([
      ITEM_GROUP_PERMISSIONS.CREATE,
    ]);
    const code = normalizeCode(input.code);
    const name = normalizeName(input.name);
    assertCodeAndName(code, name);

    await this.organizations.requireUsableOrganization(input.organizationId);

    const parentId = input.parentId ?? null;
    if (parentId !== null) {
      await this.assertParentAssignment({
        id: '',
        parentId,
        organizationId: input.organizationId,
        descendantIds: [],
      });
    }

    const existing = await this.repository.findByCode(
      input.organizationId,
      code,
    );
    if (existing !== null) {
      throw AppException.conflict(
        'An item group with that code already exists in this organization.',
      );
    }

    const now = new Date();
    let created: ItemGroup;
    try {
      created = await this.repository.create({
        id: generateId(),
        organizationId: input.organizationId,
        parentId,
        code,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        createdBy: getPrincipal()?.userId ?? null,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'An item group with that code already exists in this organization.',
        );
      }
      throw error;
    }

    await publishEvent(this.events, {
      type: ITEM_GROUP_CREATED_EVENT,
      aggregateType: 'ItemGroup',
      aggregateId: created.id,
      payload: {
        id: created.id,
        organizationId: created.organizationId,
        code: created.code,
      },
    });
    this.logger.log(
      'Item group created',
      { itemGroupId: created.id, organizationId: created.organizationId },
      ItemGroupsService.name,
    );
    return toItemGroupDto(created);
  }

  async updateItemGroup(
    id: string,
    input: UpdateItemGroupInput,
  ): Promise<ItemGroupDto> {
    await this.authorization.requireAllPermissions([
      ITEM_GROUP_PERMISSIONS.EDIT,
    ]);
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
          'An item group with that code already exists in this organization.',
        );
      }
    }

    const patch: {
      parentId?: string | null;
      code?: string;
      name?: string;
      updatedAt: Date;
      updatedBy: string | null;
    } = { updatedAt: new Date(), updatedBy: getPrincipal()?.userId ?? null };
    if (code !== undefined) patch.code = code;
    if (name !== undefined) patch.name = name;

    // Re-validate the hierarchy only when the parent actually changes.
    if (input.parentId !== undefined && input.parentId !== current.parentId) {
      const parentId = input.parentId;
      patch.parentId = parentId;
      if (parentId !== null) {
        const edges = await this.repository.listHierarchyEdges(
          current.organizationId,
        );
        await this.assertParentAssignment({
          id,
          parentId,
          organizationId: current.organizationId,
          descendantIds: collectDescendantIds(edges, id),
        });
      }
    }

    const updated = await this.repository.update(id, patch);
    if (updated === null) throw AppException.notFound('ItemGroup', id);

    await publishEvent(this.events, {
      type: ITEM_GROUP_UPDATED_EVENT,
      aggregateType: 'ItemGroup',
      aggregateId: updated.id,
      payload: {
        id: updated.id,
        organizationId: updated.organizationId,
        code: updated.code,
      },
    });
    return toItemGroupDto(updated);
  }

  async enableItemGroup(id: string): Promise<ItemGroupDto> {
    return this.setActive(id, true, ITEM_GROUP_PERMISSIONS.ENABLE);
  }

  async disableItemGroup(id: string): Promise<ItemGroupDto> {
    return this.setActive(id, false, ITEM_GROUP_PERMISSIONS.DISABLE);
  }

  /**
   * Reference resolution for `ItemsService`: an item's group must exist and
   * belong to the item's organization. A group from another organization is
   * reported as not found.
   */
  async requireUsableItemGroupInOrganization(
    id: string,
    organizationId: string,
    options: { allowInactive?: boolean } = {},
  ): Promise<ItemGroup> {
    const group = await this.repository.findById(id);
    if (group === null || group.organizationId !== organizationId) {
      throw AppException.notFound('ItemGroup', id);
    }
    assertUsable('Item group', group.isActive, {
      allowInactive: options.allowInactive ?? false,
    });
    return group;
  }

  // ---- internals ----------------------------------------------------------

  private async assertParentAssignment(params: {
    id: string;
    parentId: string;
    organizationId: string;
    descendantIds: readonly string[];
  }): Promise<void> {
    const parent = await this.repository.findById(params.parentId);
    if (parent === null) {
      throw AppException.notFound('ItemGroup', params.parentId);
    }
    const problem = findHierarchyProblem({
      id: params.id,
      parentId: params.parentId,
      organizationId: params.organizationId,
      parent: { organizationId: parent.organizationId },
      descendantIds: params.descendantIds,
    });
    if (problem !== null) {
      throw AppException.businessRule(
        hierarchyProblemMessage('item group', problem),
      );
    }
    assertUsable('Item group', parent.isActive, { allowInactive: false });
  }

  private async setActive(
    id: string,
    isActive: boolean,
    permission: string,
  ): Promise<ItemGroupDto> {
    await this.authorization.requireAllPermissions([permission]);
    const current = await this.mustFind(id);
    if (current.isActive === isActive) return toItemGroupDto(current);

    const updated = await this.repository.update(id, {
      isActive,
      updatedAt: new Date(),
      updatedBy: getPrincipal()?.userId ?? null,
    });
    if (updated === null) throw AppException.notFound('ItemGroup', id);

    await publishEvent(this.events, {
      type: isActive ? ITEM_GROUP_ENABLED_EVENT : ITEM_GROUP_DISABLED_EVENT,
      aggregateType: 'ItemGroup',
      aggregateId: updated.id,
      payload: {
        id: updated.id,
        organizationId: updated.organizationId,
        code: updated.code,
      },
    });
    return toItemGroupDto(updated);
  }

  private async mustFind(id: string): Promise<ItemGroup> {
    const group = await this.repository.findById(id);
    if (group === null) throw AppException.notFound('ItemGroup', id);
    return group;
  }
}
