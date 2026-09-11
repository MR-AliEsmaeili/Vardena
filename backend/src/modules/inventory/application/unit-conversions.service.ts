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
import { UnitConversionsRepository } from '../data/unit-conversions.repository.js';
import type {
  UnitConversion,
  UnitConversionDto,
} from '../domain/unit-conversion.js';
import {
  planNewVersion,
  resolveVersionAt,
  toUnitConversionDto,
} from '../domain/unit-conversion.js';
import { isPositiveDecimal } from '../domain/master-data.js';
import { UNIT_CONVERSION_PERMISSIONS } from '../domain/inventory-permissions.js';
import { UNIT_CONVERSION_CREATED_EVENT } from '../domain/inventory.events.js';
import { publishEvent, resolveSort } from './master-data-support.js';
import { UnitsService } from './units.service.js';
import { ItemsService } from './items.service.js';

const SORTABLE_FIELDS: Record<string, string> = {
  validFrom: 'validFrom',
  validTo: 'validTo',
  createdAt: 'createdAt',
};

export type ConversionScope = 'global' | 'item';

export interface ListConversionsQuery {
  organizationId: string;
  /** Which table to read: global pairs, or one item's pairs. */
  scope: ConversionScope;
  /** Required when `scope` is `item`. */
  itemId?: string | undefined;
  fromUnitId?: string | undefined;
  toUnitId?: string | undefined;
  /** Only versions in force at this instant. */
  activeAt?: Date | undefined;
  page: number;
  pageSize: number;
  sort?: string | undefined;
}

export interface CreateConversionInput {
  organizationId: string;
  /** Omit for a global conversion. */
  itemId?: string | null | undefined;
  fromUnitId: string;
  toUnitId: string;
  /** Decimal string, must be > 0. */
  factor: string;
  validFrom: Date;
  validTo?: Date | null | undefined;
}

export interface ResolveConversionInput {
  organizationId: string;
  /** When given, item-specific versions are preferred over global ones. */
  itemId?: string | null | undefined;
  fromUnitId: string;
  toUnitId: string;
  /** The instant to interpret — a document date, not "now". */
  asOf: Date;
}

/**
 * Unit conversion administration (D-26, D-21, master-data-strategy.md §3.4,
 * OQ-29).
 *
 * **Versioning is the whole point of this service.** A conversion is never
 * edited in place. Creating a later version inserts a row and *closes* the
 * previous open-ended version at the new `validFrom`, producing exactly:
 *
 *   Version A: [T1, T2)   factor 10
 *   Version B: [T2, ∞)    factor 12
 *
 * Version A is not rewritten (only its `valid_to` is set), so a quantity
 * recorded against it keeps the factor that was in force then, and
 * `resolveConversion(…, asOf: T1.5)` still returns A. That is how "conversion
 * changes never reinterpret recorded quantities" (D-26) is implemented.
 *
 * Item-specific conversions exist so that `1 BOX = 10 PCS` for item A and
 * `1 BOX = 24 PCS` for item B are both representable; resolution prefers the
 * item's own version over a global pair.
 *
 * There is **no rounding rule** and no precision policy here: rounding of
 * fractional conversions is expert-gated and unresolved (OQ-29) and must not be
 * invented. Factors are carried as decimal strings.
 */
@Injectable()
export class UnitConversionsService {
  constructor(
    private readonly repository: UnitConversionsRepository,
    private readonly organizations: OrganizationsService,
    private readonly units: UnitsService,
    private readonly items: ItemsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async listConversions(
    query: ListConversionsQuery,
  ): Promise<PaginatedResult<UnitConversionDto>> {
    await this.authorization.requireAllPermissions([
      UNIT_CONVERSION_PERMISSIONS.VIEW,
    ]);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const orderBy = resolveSort(query.sort, SORTABLE_FIELDS, [
      { validFrom: 'desc' },
    ]);

    if (query.scope === 'item') {
      if (query.itemId === undefined) {
        throw AppException.badRequest(
          'itemId is required when listing item-specific conversions.',
        );
      }
      const { items, total } = await this.repository.listForItem({
        where: {
          organizationId: query.organizationId,
          itemId: query.itemId,
          fromUnitId: query.fromUnitId,
          toUnitId: query.toUnitId,
          activeAt: query.activeAt,
        },
        orderBy,
        skip,
        take,
      });
      return toPaginatedResult(
        items.map(toUnitConversionDto),
        total,
        query.page,
        query.pageSize,
      );
    }

    const { items, total } = await this.repository.listGlobal({
      where: {
        organizationId: query.organizationId,
        fromUnitId: query.fromUnitId,
        toUnitId: query.toUnitId,
        activeAt: query.activeAt,
      },
      orderBy,
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toUnitConversionDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  /**
   * Read one version by id. Superseded (closed) versions stay readable — that
   * is what makes historical interpretation possible.
   */
  async getConversion(id: string): Promise<UnitConversionDto> {
    await this.authorization.requireAllPermissions([
      UNIT_CONVERSION_PERMISSIONS.VIEW,
    ]);
    const stored = await this.repository.findStoredById(id);
    if (stored === null) throw AppException.notFound('UnitConversion', id);
    return toUnitConversionDto(stored.conversion);
  }

  /**
   * Create a new version. Closes the version it supersedes in the same
   * transaction.
   *
   * @throws `BadRequest` for a malformed pair (same unit on both ends) or a
   *   non-positive/ill-formed factor.
   * @throws `BusinessRuleViolation` for an invalid window or an overlap that is
   *   not a clean supersession.
   */
  async createConversion(
    input: CreateConversionInput,
  ): Promise<UnitConversionDto> {
    await this.authorization.requireAllPermissions([
      UNIT_CONVERSION_PERMISSIONS.CREATE,
    ]);

    if (input.fromUnitId === input.toUnitId) {
      throw AppException.badRequest(
        'A conversion must have two different units.',
      );
    }
    if (!isPositiveDecimal(input.factor)) {
      throw AppException.badRequest(
        'Factor must be a positive decimal with at most 6 decimal places.',
      );
    }

    await this.organizations.requireUsableOrganization(input.organizationId);
    await this.units.requireUsableUnitInOrganization(
      input.fromUnitId,
      input.organizationId,
    );
    await this.units.requireUsableUnitInOrganization(
      input.toUnitId,
      input.organizationId,
    );

    const itemId = input.itemId ?? null;
    if (itemId !== null) {
      // Also proves the item belongs to this organization.
      await this.items.requireUsableItemInOrganization(
        itemId,
        input.organizationId,
      );
    }

    const validFrom = input.validFrom;
    const validTo = input.validTo ?? null;
    const existing =
      itemId === null
        ? await this.repository.findGlobalVersions(
            input.organizationId,
            input.fromUnitId,
            input.toUnitId,
          )
        : await this.repository.findItemVersions(
            itemId,
            input.fromUnitId,
            input.toUnitId,
          );

    const plan = planNewVersion({
      candidate: { validFrom, validTo },
      existing,
    });
    if (plan.problem === 'invalid_window') {
      throw AppException.businessRule(
        'validTo must be later than validFrom.',
      );
    }
    if (plan.problem === 'overlapping_version') {
      throw AppException.businessRule(
        'A conversion version already covers part of that period. A new version must start after the current one and supersede it.',
      );
    }

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const create = {
      id: generateId(),
      organizationId: input.organizationId,
      fromUnitId: input.fromUnitId,
      toUnitId: input.toUnitId,
      factor: input.factor,
      validFrom,
      validTo,
      createdAt: now,
      updatedAt: now,
      createdBy: actorId,
    };
    const close = {
      validTo: validFrom,
      updatedAt: now,
      updatedBy: actorId,
    };

    let created: UnitConversion;
    try {
      created =
        itemId === null
          ? await this.repository.createGlobalVersion({
              create,
              supersededId: plan.supersededId,
              close,
            })
          : await this.repository.createItemVersion({
              create: { ...create, itemId },
              supersededId: plan.supersededId,
              close,
            });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'A conversion version already starts at that instant for this unit pair.',
        );
      }
      throw error;
    }

    await publishEvent(this.events, {
      type: UNIT_CONVERSION_CREATED_EVENT,
      aggregateType: 'UnitConversion',
      aggregateId: created.id,
      payload: {
        id: created.id,
        organizationId: created.organizationId,
        itemId: created.itemId,
        fromUnitId: created.fromUnitId,
        toUnitId: created.toUnitId,
        factor: created.factor,
        validFrom: created.validFrom.toISOString(),
        supersededConversionId: plan.supersededId,
      },
    });
    this.logger.log(
      'Unit conversion version created',
      {
        unitConversionId: created.id,
        organizationId: created.organizationId,
        itemId: created.itemId,
        supersededConversionId: plan.supersededId,
      },
      UnitConversionsService.name,
    );
    return toUnitConversionDto(created);
  }

  /**
   * The conversion in force at `asOf` — item-specific first, then global.
   *
   * This is the read path future document lines will use, and it is the reason
   * effective dating matters: passing a past date returns the version that was
   * valid then, never the current one. Returns `null` when no version covers
   * the instant (callers must not silently assume a 1:1 factor — that would be
   * an invented conversion rule).
   */
  async resolveConversion(
    input: ResolveConversionInput,
  ): Promise<UnitConversionDto | null> {
    await this.authorization.requireAllPermissions([
      UNIT_CONVERSION_PERMISSIONS.VIEW,
    ]);

    if (input.itemId !== undefined && input.itemId !== null) {
      const itemVersions = await this.repository.findItemVersions(
        input.itemId,
        input.fromUnitId,
        input.toUnitId,
      );
      const itemMatch = resolveVersionAt(itemVersions, input.asOf);
      if (itemMatch !== null) return toUnitConversionDto(itemMatch);
    }

    const globalVersions = await this.repository.findGlobalVersions(
      input.organizationId,
      input.fromUnitId,
      input.toUnitId,
    );
    const globalMatch = resolveVersionAt(globalVersions, input.asOf);
    return globalMatch === null ? null : toUnitConversionDto(globalMatch);
  }
}
