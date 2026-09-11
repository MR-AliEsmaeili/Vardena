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
import { BranchesService } from '../../organization/application/branches.service.js';
import { WarehousesRepository } from '../data/warehouses.repository.js';
import type { Warehouse, WarehouseDto } from '../domain/warehouse.js';
import { toWarehouseDto } from '../domain/warehouse.js';
import { normalizeCode, normalizeName } from '../domain/master-data.js';
import { WAREHOUSE_PERMISSIONS } from '../domain/inventory-permissions.js';
import {
  WAREHOUSE_CREATED_EVENT,
  WAREHOUSE_DISABLED_EVENT,
  WAREHOUSE_ENABLED_EVENT,
  WAREHOUSE_UPDATED_EVENT,
} from '../domain/inventory.events.js';
import {
  assertCodeAndName,
  assertUsable,
  publishEvent,
  resolveSort,
} from './master-data-support.js';

const SORTABLE_FIELDS: Record<string, string> = {
  code: 'code',
  name: 'name',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

export interface ListWarehousesQuery {
  organizationId: string;
  page: number;
  pageSize: number;
  branchId?: string | undefined;
  isActive?: boolean | undefined;
  search?: string | undefined;
  sort?: string | undefined;
}

export interface CreateWarehouseInput {
  organizationId: string;
  branchId: string;
  code: string;
  name: string;
}

export interface UpdateWarehouseInput {
  branchId?: string | undefined;
  code?: string | undefined;
  name?: string | undefined;
}

/**
 * Warehouse administration — master data only (master-data-strategy.md §4,
 * ADR-0020 §1).
 *
 * Organization consistency is enforced in this layer: the branch must exist and
 * belong to the warehouse's organization. A foreign key cannot express that
 * (it only proves the branch row exists), so the check lives here.
 *
 * Cross-module boundary (AR-07): the branch is resolved through the
 * Organization module's public `BranchesService`, never by reading
 * `organization.branches`.
 *
 * No stock balances, movements, locations or reservations are created here —
 * those are future Inventory work (ADR-0017, OQ-24).
 */
@Injectable()
export class WarehousesService {
  constructor(
    private readonly repository: WarehousesRepository,
    private readonly organizations: OrganizationsService,
    private readonly branches: BranchesService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async listWarehouses(
    query: ListWarehousesQuery,
  ): Promise<PaginatedResult<WarehouseDto>> {
    await this.authorization.requireAllPermissions([
      WAREHOUSE_PERMISSIONS.VIEW,
    ]);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: {
        organizationId: query.organizationId,
        branchId: query.branchId,
        isActive: query.isActive,
        search: query.search,
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [{ code: 'asc' }]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toWarehouseDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getWarehouse(id: string): Promise<WarehouseDto> {
    await this.authorization.requireAllPermissions([
      WAREHOUSE_PERMISSIONS.VIEW,
    ]);
    return toWarehouseDto(await this.mustFind(id));
  }

  async createWarehouse(input: CreateWarehouseInput): Promise<WarehouseDto> {
    await this.authorization.requireAllPermissions([
      WAREHOUSE_PERMISSIONS.CREATE,
    ]);
    const code = normalizeCode(input.code);
    const name = normalizeName(input.name);
    assertCodeAndName(code, name);

    await this.organizations.requireUsableOrganization(input.organizationId);
    // Branch must exist, belong to this organization, and be enabled.
    await this.branches.requireUsableBranchInOrganization(
      input.branchId,
      input.organizationId,
    );

    const existing = await this.repository.findByCode(
      input.organizationId,
      code,
    );
    if (existing !== null) {
      throw AppException.conflict(
        'A warehouse with that code already exists in this organization.',
      );
    }

    const now = new Date();
    let created: Warehouse;
    try {
      created = await this.repository.create({
        id: generateId(),
        organizationId: input.organizationId,
        branchId: input.branchId,
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
          'A warehouse with that code already exists in this organization.',
        );
      }
      throw error;
    }

    await publishEvent(this.events, {
      type: WAREHOUSE_CREATED_EVENT,
      aggregateType: 'Warehouse',
      aggregateId: created.id,
      payload: {
        id: created.id,
        organizationId: created.organizationId,
        code: created.code,
      },
    });
    this.logger.log(
      'Warehouse created',
      {
        warehouseId: created.id,
        organizationId: created.organizationId,
        branchId: created.branchId,
      },
      WarehousesService.name,
    );
    return toWarehouseDto(created);
  }

  async updateWarehouse(
    id: string,
    input: UpdateWarehouseInput,
  ): Promise<WarehouseDto> {
    await this.authorization.requireAllPermissions([
      WAREHOUSE_PERMISSIONS.EDIT,
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
          'A warehouse with that code already exists in this organization.',
        );
      }
    }

    const patch: {
      branchId?: string;
      code?: string;
      name?: string;
      updatedAt: Date;
      updatedBy: string | null;
    } = { updatedAt: new Date(), updatedBy: getPrincipal()?.userId ?? null };
    if (code !== undefined) patch.code = code;
    if (name !== undefined) patch.name = name;

    // Only re-validate the branch when it changes: a warehouse whose branch was
    // disabled afterwards stays editable (master-data-strategy.md §7.4).
    if (input.branchId !== undefined && input.branchId !== current.branchId) {
      patch.branchId = input.branchId;
      await this.branches.requireUsableBranchInOrganization(
        input.branchId,
        current.organizationId,
      );
    }

    const updated = await this.repository.update(id, patch);
    if (updated === null) throw AppException.notFound('Warehouse', id);

    await publishEvent(this.events, {
      type: WAREHOUSE_UPDATED_EVENT,
      aggregateType: 'Warehouse',
      aggregateId: updated.id,
      payload: {
        id: updated.id,
        organizationId: updated.organizationId,
        code: updated.code,
      },
    });
    return toWarehouseDto(updated);
  }

  async enableWarehouse(id: string): Promise<WarehouseDto> {
    return this.setActive(id, true, WAREHOUSE_PERMISSIONS.ENABLE);
  }

  async disableWarehouse(id: string): Promise<WarehouseDto> {
    return this.setActive(id, false, WAREHOUSE_PERMISSIONS.DISABLE);
  }

  /**
   * Reference resolution for the future Inventory transactional flows: a stock
   * movement's warehouse is resolved through this method (AR-07).
   */
  async requireUsableWarehouseInOrganization(
    id: string,
    organizationId: string,
    options: { allowInactive?: boolean } = {},
  ): Promise<Warehouse> {
    const warehouse = await this.repository.findById(id);
    if (warehouse === null || warehouse.organizationId !== organizationId) {
      throw AppException.notFound('Warehouse', id);
    }
    assertUsable('Warehouse', warehouse.isActive, {
      allowInactive: options.allowInactive ?? false,
    });
    return warehouse;
  }

  // ---- internals ----------------------------------------------------------

  private async setActive(
    id: string,
    isActive: boolean,
    permission: string,
  ): Promise<WarehouseDto> {
    await this.authorization.requireAllPermissions([permission]);
    const current = await this.mustFind(id);
    if (current.isActive === isActive) return toWarehouseDto(current);

    const updated = await this.repository.update(id, {
      isActive,
      updatedAt: new Date(),
      updatedBy: getPrincipal()?.userId ?? null,
    });
    if (updated === null) throw AppException.notFound('Warehouse', id);

    await publishEvent(this.events, {
      type: isActive ? WAREHOUSE_ENABLED_EVENT : WAREHOUSE_DISABLED_EVENT,
      aggregateType: 'Warehouse',
      aggregateId: updated.id,
      payload: {
        id: updated.id,
        organizationId: updated.organizationId,
        code: updated.code,
      },
    });
    return toWarehouseDto(updated);
  }

  private async mustFind(id: string): Promise<Warehouse> {
    const warehouse = await this.repository.findById(id);
    if (warehouse === null) throw AppException.notFound('Warehouse', id);
    return warehouse;
  }
}
