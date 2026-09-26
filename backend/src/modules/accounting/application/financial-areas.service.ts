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
import { FinancialAreasRepository } from '../data/financial-areas.repository.js';
import { AreaHasOpenYearsError } from '../data/accounting-calendar-errors.js';
import type {
  FinancialArea,
  FinancialAreaDto,
} from '../domain/financial-area.js';
import { toFinancialAreaDto } from '../domain/financial-area.js';
import { normalizeCode, normalizeTitle } from '../domain/master-data.js';
import { FINANCIAL_AREA_PERMISSIONS } from '../domain/accounting-permissions.js';
import {
  FINANCIAL_AREA_CREATED_EVENT,
  FINANCIAL_AREA_DISABLED_EVENT,
  FINANCIAL_AREA_ENABLED_EVENT,
  FINANCIAL_AREA_UPDATED_EVENT,
} from '../domain/accounting.events.js';
import {
  assertCodeAndTitle,
  assertUsable,
  publishEvent,
  resolveSort,
} from './accounting-support.js';

const SORTABLE_FIELDS: Record<string, string> = {
  code: 'code',
  title: 'title',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

export interface ListFinancialAreasQuery {
  /** Mandatory: an area list is never cross-organization. */
  organizationId: string;
  page: number;
  pageSize: number;
  isActive?: boolean | undefined;
  isDefault?: boolean | undefined;
  search?: string | undefined;
  sort?: string | undefined;
}

export interface CreateFinancialAreaInput {
  organizationId: string;
  code: string;
  title: string;
}

export interface UpdateFinancialAreaInput {
  code?: string | undefined;
  title?: string | undefined;
  /**
   * Set the organization's default area. `true` flags this area and clears
   * the previous default in one transaction; `false` unflags this area.
   * A newly created area is never the default implicitly.
   */
  isDefault?: boolean | undefined;
}

/**
 * Financial area administration (contract §5, AC-D-02…AC-D-05, ADR-0026).
 *
 * An area is a bookkeeping scope, not a tenant and not a company: the
 * organization stays the tenant/security boundary (AC-D-01), and every
 * by-id read/action is organization-qualified with the 404-not-403
 * posture (ADR-0021 §4).
 *
 * Multiplicity (OQ-40): n ≥ 1 areas per organization are permitted and
 * created explicitly — never seeded. User↔area access grants are NOT part
 * of Task 10.2; until they exist, area access is structural
 * (caller-supplied, scope-validated), exactly like `organizationId` today.
 *
 * Organization ownership is enforced in this layer, not left to callers:
 * an area is always created under an existing, enabled organization.
 */
@Injectable()
export class FinancialAreasService {
  constructor(
    private readonly repository: FinancialAreasRepository,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async listFinancialAreas(
    query: ListFinancialAreasQuery,
  ): Promise<PaginatedResult<FinancialAreaDto>> {
    await this.authorization.requireAllPermissions([
      FINANCIAL_AREA_PERMISSIONS.VIEW,
    ]);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: {
        organizationId: query.organizationId,
        isActive: query.isActive,
        isDefault: query.isDefault,
        search: query.search,
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [{ code: 'asc' }]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toFinancialAreaDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getFinancialArea(
    organizationId: string,
    id: string,
  ): Promise<FinancialAreaDto> {
    await this.authorization.requireAllPermissions([
      FINANCIAL_AREA_PERMISSIONS.VIEW,
    ]);
    return toFinancialAreaDto(
      await this.mustFindInOrganization(organizationId, id),
    );
  }

  async createFinancialArea(
    input: CreateFinancialAreaInput,
  ): Promise<FinancialAreaDto> {
    await this.authorization.requireAllPermissions([
      FINANCIAL_AREA_PERMISSIONS.CREATE,
    ]);
    const code = normalizeCode(input.code);
    const title = normalizeTitle(input.title);
    assertCodeAndTitle(code, title);

    // Organization must exist and be enabled: a disabled organization blocks
    // new organization-scoped records (master-data-strategy.md §7.4).
    await this.organizations.requireUsableOrganization(input.organizationId);

    const existing = await this.repository.findByCode(
      input.organizationId,
      code,
    );
    if (existing !== null) {
      throw AppException.conflict(
        'A financial area with that code already exists in this organization.',
      );
    }

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    let created: FinancialArea;
    try {
      created = await this.repository.create({
        id: generateId(),
        organizationId: input.organizationId,
        code,
        title,
        isDefault: false,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'A financial area with that code already exists in this organization.',
        );
      }
      throw error;
    }

    await publishEvent(this.events, {
      type: FINANCIAL_AREA_CREATED_EVENT,
      aggregateType: 'FinancialArea',
      aggregateId: created.id,
      payload: {
        id: created.id,
        organizationId: created.organizationId,
        code: created.code,
      },
    });
    this.logger.log(
      'Financial area created',
      { financialAreaId: created.id, organizationId: created.organizationId },
      FinancialAreasService.name,
    );
    return toFinancialAreaDto(created);
  }

  async updateFinancialArea(
    organizationId: string,
    id: string,
    input: UpdateFinancialAreaInput,
  ): Promise<FinancialAreaDto> {
    await this.authorization.requireAllPermissions([
      FINANCIAL_AREA_PERMISSIONS.EDIT,
    ]);
    const current = await this.mustFindInOrganization(organizationId, id);
    const code =
      input.code === undefined ? undefined : normalizeCode(input.code);
    const title =
      input.title === undefined ? undefined : normalizeTitle(input.title);
    assertCodeAndTitle(code ?? current.code, title ?? current.title);

    if (code !== undefined && code !== current.code) {
      const taken = await this.repository.findByCodeExcludingId(
        current.organizationId,
        code,
        id,
      );
      if (taken !== null) {
        throw AppException.conflict(
          'A financial area with that code already exists in this organization.',
        );
      }
    }

    // Flagging the default goes through the guarded transaction (it clears
    // the previous default atomically); every other change is a plain
    // update. Unflagging (`false`) needs no guard — "at most one" cannot
    // be violated by removing a flag.
    if (input.isDefault === true && current.isDefault !== true) {
      const { area } = await this.repository.setDefaultChecked({
        id,
        organizationId: current.organizationId,
        updatedAt: new Date(),
        updatedBy: getPrincipal()?.userId ?? null,
      });
      // A code/title change in the same request applies on top of the
      // default flag (the flag move itself is already committed).
      const updated =
        code === undefined && title === undefined
          ? area
          : await this.applyCodeTitle(id, code, title);
      await this.publishUpdated(updated ?? area);
      return toFinancialAreaDto(updated ?? area);
    }

    const patch: {
      code?: string;
      title?: string;
      isDefault?: boolean;
      updatedAt: Date;
      updatedBy: string | null;
    } = { updatedAt: new Date(), updatedBy: getPrincipal()?.userId ?? null };
    if (code !== undefined) patch.code = code;
    if (title !== undefined) patch.title = title;
    if (input.isDefault === false) patch.isDefault = false;

    let updated: FinancialArea | null;
    try {
      updated = await this.repository.update(id, patch);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'A financial area with that code already exists in this organization.',
        );
      }
      throw error;
    }
    if (updated === null) throw AppException.notFound('FinancialArea', id);
    await this.publishUpdated(updated);
    return toFinancialAreaDto(updated);
  }

  async enableFinancialArea(
    organizationId: string,
    id: string,
  ): Promise<FinancialAreaDto> {
    await this.authorization.requireAllPermissions([
      FINANCIAL_AREA_PERMISSIONS.ENABLE,
    ]);
    const current = await this.mustFindInOrganization(organizationId, id);
    if (current.isActive) return toFinancialAreaDto(current);

    const updated = await this.repository.update(id, {
      isActive: true,
      updatedAt: new Date(),
      updatedBy: getPrincipal()?.userId ?? null,
    });
    if (updated === null) throw AppException.notFound('FinancialArea', id);

    await publishEvent(this.events, {
      type: FINANCIAL_AREA_ENABLED_EVENT,
      aggregateType: 'FinancialArea',
      aggregateId: updated.id,
      payload: {
        id: updated.id,
        organizationId: updated.organizationId,
        code: updated.code,
      },
    });
    return toFinancialAreaDto(updated);
  }

  async disableFinancialArea(
    organizationId: string,
    id: string,
  ): Promise<FinancialAreaDto> {
    await this.authorization.requireAllPermissions([
      FINANCIAL_AREA_PERMISSIONS.DISABLE,
    ]);
    const current = await this.mustFindInOrganization(organizationId, id);
    if (!current.isActive) return toFinancialAreaDto(current);

    let updated: FinancialArea;
    try {
      updated = await this.repository.disableChecked({
        id,
        updatedAt: new Date(),
        updatedBy: getPrincipal()?.userId ?? null,
      });
    } catch (error) {
      if (error instanceof AreaHasOpenYearsError) {
        throw AppException.businessRule(
          'The financial area has an open fiscal year and cannot be disabled. Close or seal the year first.',
          { openFiscalYearId: error.openYearId },
        );
      }
      throw error;
    }

    await publishEvent(this.events, {
      type: FINANCIAL_AREA_DISABLED_EVENT,
      aggregateType: 'FinancialArea',
      aggregateId: updated.id,
      payload: {
        id: updated.id,
        organizationId: updated.organizationId,
        code: updated.code,
      },
    });
    return toFinancialAreaDto(updated);
  }

  /**
   * Same-module reference resolution for fiscal years (AR-07): years
   * resolve their owning area through this method.
   *
   * The organization consistency check is the important half: an area from
   * another organization is reported as *not found* rather than as a
   * cross-organization error, so the API never confirms that an id
   * belonging to a different organization exists.
   */
  async requireUsableFinancialAreaInOrganization(
    id: string,
    organizationId: string,
    options: { allowInactive?: boolean } = {},
  ): Promise<FinancialArea> {
    const area = await this.repository.findById(id);
    if (area === null || area.organizationId !== organizationId) {
      throw AppException.notFound('FinancialArea', id);
    }
    assertUsable('Financial area', area.isActive, {
      allowInactive: options.allowInactive ?? false,
    });
    return area;
  }

  // ---- internals ----------------------------------------------------------

  private async applyCodeTitle(
    id: string,
    code: string | undefined,
    title: string | undefined,
  ): Promise<FinancialArea | null> {
    const patch: {
      code?: string;
      title?: string;
      updatedAt: Date;
      updatedBy: string | null;
    } = { updatedAt: new Date(), updatedBy: getPrincipal()?.userId ?? null };
    if (code !== undefined) patch.code = code;
    if (title !== undefined) patch.title = title;
    try {
      return await this.repository.update(id, patch);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'A financial area with that code already exists in this organization.',
        );
      }
      throw error;
    }
  }

  private async publishUpdated(area: FinancialArea): Promise<void> {
    await publishEvent(this.events, {
      type: FINANCIAL_AREA_UPDATED_EVENT,
      aggregateType: 'FinancialArea',
      aggregateId: area.id,
      payload: {
        id: area.id,
        organizationId: area.organizationId,
        code: area.code,
      },
    });
  }

  /**
   * Scoped by-id resolution for the API surface (ADR-0021 §4): an area in
   * another organization is reported as not found, so the boundary cannot
   * be crossed by guessing an id. The deployment organization pin (ADR-0025)
   * is enforced here too, so direct service callers are bounded exactly
   * like HTTP callers.
   */
  private async mustFindInOrganization(
    organizationId: string,
    id: string,
  ): Promise<FinancialArea> {
    await this.organizations.assertOrganizationInScope(organizationId);
    const area = await this.repository.findById(id);
    if (area === null || area.organizationId !== organizationId) {
      throw AppException.notFound('FinancialArea', id);
    }
    return area;
  }
}
