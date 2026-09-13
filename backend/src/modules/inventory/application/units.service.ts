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
import { UnitsRepository } from '../data/units.repository.js';
import type { Unit, UnitDto } from '../domain/unit.js';
import { toUnitDto } from '../domain/unit.js';
import {
  isNonBlank,
  MAX_UNIT_CODE_LENGTH,
  MAX_UNIT_NAME_LENGTH,
  MAX_UNIT_SYMBOL_LENGTH,
  normalizeCode,
  normalizeName,
} from '../domain/master-data.js';
import { UNIT_PERMISSIONS } from '../domain/inventory-permissions.js';
import {
  UNIT_CREATED_EVENT,
  UNIT_DISABLED_EVENT,
  UNIT_ENABLED_EVENT,
  UNIT_UPDATED_EVENT,
} from '../domain/inventory.events.js';
import {
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

export interface ListUnitsQuery {
  organizationId: string;
  page: number;
  pageSize: number;
  isActive?: boolean | undefined;
  search?: string | undefined;
  sort?: string | undefined;
}

export interface CreateUnitInput {
  organizationId: string;
  code: string;
  name: string;
  symbol?: string | null | undefined;
}

export interface UpdateUnitInput {
  code?: string | undefined;
  name?: string | undefined;
  symbol?: string | null | undefined;
}

/**
 * Unit of measure administration (master-data-strategy.md §1/§3.4, OQ-29).
 *
 * Units are organization-scoped master data owned by this module. The model is
 * generic: no Iranian-specific unit set is implied or seeded, and per-unit
 * decimal precision is not added because it is expert-gated and unresolved
 * (OQ-29) — quantities stay `numeric(18,4)` per AR-12.
 */
@Injectable()
export class UnitsService {
  constructor(
    private readonly repository: UnitsRepository,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async listUnits(query: ListUnitsQuery): Promise<PaginatedResult<UnitDto>> {
    await this.authorization.requireAllPermissions([UNIT_PERMISSIONS.VIEW]);
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
      items.map(toUnitDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getUnit(organizationId: string, id: string): Promise<UnitDto> {
    await this.authorization.requireAllPermissions([UNIT_PERMISSIONS.VIEW]);
    return toUnitDto(
      await this.mustFindInOrganization(organizationId, id),
    );
  }

  async createUnit(input: CreateUnitInput): Promise<UnitDto> {
    await this.authorization.requireAllPermissions([UNIT_PERMISSIONS.CREATE]);
    const code = normalizeCode(input.code);
    const name = normalizeName(input.name);
    const symbol = normalizeOptional(input.symbol);
    assertUnitShape(code, name, symbol);

    await this.organizations.requireUsableOrganization(input.organizationId);

    const existing = await this.repository.findByCode(
      input.organizationId,
      code,
    );
    if (existing !== null) {
      throw AppException.conflict(
        'A unit with that code already exists in this organization.',
      );
    }

    const now = new Date();
    let created: Unit;
    try {
      created = await this.repository.create({
        id: generateId(),
        organizationId: input.organizationId,
        code,
        name,
        symbol,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        createdBy: getPrincipal()?.userId ?? null,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'A unit with that code already exists in this organization.',
        );
      }
      throw error;
    }

    await publishEvent(this.events, {
      type: UNIT_CREATED_EVENT,
      aggregateType: 'Unit',
      aggregateId: created.id,
      payload: {
        id: created.id,
        organizationId: created.organizationId,
        code: created.code,
      },
    });
    this.logger.log(
      'Unit created',
      { unitId: created.id, organizationId: created.organizationId },
      UnitsService.name,
    );
    return toUnitDto(created);
  }

  async updateUnit(
    organizationId: string,
    id: string,
    input: UpdateUnitInput,
  ): Promise<UnitDto> {
    await this.authorization.requireAllPermissions([UNIT_PERMISSIONS.EDIT]);
    const current = await this.mustFindInOrganization(organizationId, id);
    const code =
      input.code === undefined ? undefined : normalizeCode(input.code);
    const name =
      input.name === undefined ? undefined : normalizeName(input.name);
    const symbol =
      input.symbol === undefined ? undefined : normalizeOptional(input.symbol);
    assertUnitShape(
      code ?? current.code,
      name ?? current.name,
      symbol === undefined ? current.symbol : symbol,
    );

    if (code !== undefined && code !== current.code) {
      const taken = await this.repository.findByCodeExcludingId(
        current.organizationId,
        code,
        id,
      );
      if (taken !== null) {
        throw AppException.conflict(
          'A unit with that code already exists in this organization.',
        );
      }
    }

    const patch: {
      code?: string;
      name?: string;
      symbol?: string | null;
      updatedAt: Date;
      updatedBy: string | null;
    } = { updatedAt: new Date(), updatedBy: getPrincipal()?.userId ?? null };
    if (code !== undefined) patch.code = code;
    if (name !== undefined) patch.name = name;
    if (symbol !== undefined) patch.symbol = symbol;

    const updated = await this.repository.update(id, patch);
    if (updated === null) throw AppException.notFound('Unit', id);

    await publishEvent(this.events, {
      type: UNIT_UPDATED_EVENT,
      aggregateType: 'Unit',
      aggregateId: updated.id,
      payload: {
        id: updated.id,
        organizationId: updated.organizationId,
        code: updated.code,
      },
    });
    return toUnitDto(updated);
  }

  async enableUnit(organizationId: string, id: string): Promise<UnitDto> {
    return this.setActive(
      organizationId,
      id,
      true,
      UNIT_PERMISSIONS.ENABLE,
    );
  }

  async disableUnit(organizationId: string, id: string): Promise<UnitDto> {
    return this.setActive(
      organizationId,
      id,
      false,
      UNIT_PERMISSIONS.DISABLE,
    );
  }

  /**
   * Reference resolution used by `ItemsService` (base unit) and
   * `UnitConversionsService` (both ends of a conversion). A unit from another
   * organization is reported as not found, so the organization boundary cannot
   * be crossed by guessing an id.
   */
  async requireUsableUnitInOrganization(
    id: string,
    organizationId: string,
    options: { allowInactive?: boolean } = {},
  ): Promise<Unit> {
    const unit = await this.repository.findById(id);
    if (unit === null || unit.organizationId !== organizationId) {
      throw AppException.notFound('Unit', id);
    }
    assertUsable('Unit', unit.isActive, {
      allowInactive: options.allowInactive ?? false,
    });
    return unit;
  }

  // ---- internals ----------------------------------------------------------

  private async setActive(
    organizationId: string,
    id: string,
    isActive: boolean,
    permission: string,
  ): Promise<UnitDto> {
    await this.authorization.requireAllPermissions([permission]);
    const current = await this.mustFindInOrganization(organizationId, id);
    if (current.isActive === isActive) return toUnitDto(current);

    const updated = await this.repository.update(id, {
      isActive,
      updatedAt: new Date(),
      updatedBy: getPrincipal()?.userId ?? null,
    });
    if (updated === null) throw AppException.notFound('Unit', id);

    await publishEvent(this.events, {
      type: isActive ? UNIT_ENABLED_EVENT : UNIT_DISABLED_EVENT,
      aggregateType: 'Unit',
      aggregateId: updated.id,
      payload: {
        id: updated.id,
        organizationId: updated.organizationId,
        code: updated.code,
      },
    });
    return toUnitDto(updated);
  }

  /**
   * Scoped by-id resolution for the API surface (ADR-0021 §4): a unit in
   * another organization is reported as not found. The deployment pin
   * (ADR-0025) is enforced here too, so a direct service caller is as bounded
   * as an HTTP caller.
   */
  private async mustFindInOrganization(
    organizationId: string,
    id: string,
  ): Promise<Unit> {
    this.organizations.assertOrganizationInScope(organizationId);
    const unit = await this.repository.findById(id);
    if (unit === null || unit.organizationId !== organizationId) {
      throw AppException.notFound('Unit', id);
    }
    return unit;
  }
}

// ---- Internal helpers ----

function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

function assertUnitShape(
  code: string,
  name: string,
  symbol: string | null,
): void {
  if (!isNonBlank(code) || code.length > MAX_UNIT_CODE_LENGTH) {
    throw AppException.badRequest(
      `Code is required and must be at most ${MAX_UNIT_CODE_LENGTH} characters.`,
    );
  }
  if (!isNonBlank(name) || name.length > MAX_UNIT_NAME_LENGTH) {
    throw AppException.badRequest(
      `Name is required and must be at most ${MAX_UNIT_NAME_LENGTH} characters.`,
    );
  }
  if (symbol !== null && symbol.length > MAX_UNIT_SYMBOL_LENGTH) {
    throw AppException.badRequest(
      `Symbol must be at most ${MAX_UNIT_SYMBOL_LENGTH} characters.`,
    );
  }
}
