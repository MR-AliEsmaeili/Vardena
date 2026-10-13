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
import {
  InventoryValuationRepository,
  type RecalculationInput,
} from '../data/inventory-valuation.repository.js';
import type { CoreTxClient } from '../data/inventory-core-rows.js';
import {
  ItemValuationMethodsRepository,
  ValuationMethodPlanRejectedError,
} from '../data/item-valuation-methods.repository.js';
import { InventoryMovementsRepository } from '../data/inventory-movements.repository.js';
import { InventoryOperationsRepository } from '../data/inventory-operations.repository.js';
import {
  CostAlreadyAssignedError,
  RecalculationTooLargeError,
} from '../data/inventory-posting-errors.js';
import { UnsupportedValuationMethodError } from '../domain/valuation-replay.js';
import type { BackdateAssessment } from '../domain/backdating.js';
import {
  backdateConfirmationMessage,
  BACKDATE_CONFIRMATION_CODE,
  isBackdated,
  REPRICING_CHOICE_CODE,
  repricingChoiceMessage,
  type RepricingChoice,
} from '../domain/backdating.js';
import type {
  InventoryValuationRunDto,
  InventoryValuationState,
  InventoryValuationStateDto,
} from '../domain/inventory-valuation.js';
import {
  toInventoryValuationRunDto,
  toInventoryValuationStateDto,
  type ValuationRunTrigger,
  type ValuationStateStatus,
} from '../domain/inventory-valuation.js';
import type {
  ItemValuationMethodDto,
  ResolvedValuationMethod,
  ValuationMethod,
} from '../domain/valuation-method.js';
import {
  DEFAULT_VALUATION_METHOD,
  inactiveMethodMessage,
  isActiveValuationMethod,
  isValuationMethod,
  resolveValuationMethodFrom,
  toItemValuationMethodDto,
  VALUATION_METHODS,
} from '../domain/valuation-method.js';
import { VALUATION_PERMISSIONS } from '../domain/inventory-valuation-permissions.js';
import type { InventoryMovementDto } from '../domain/inventory-movement.js';
import { toInventoryMovementDto } from '../domain/inventory-movement.js';
import { MOVEMENT_PERMISSIONS } from '../domain/inventory-core-permissions.js';
import {
  INVENTORY_VALUATION_METHOD_CONFIGURED_EVENT,
  INVENTORY_VALUATION_RECALCULATED_EVENT,
} from '../domain/inventory-core.events.js';
import { assertAmount } from './inventory-cost-support.js';
import { canonicalizeMoney } from '../domain/money.js';
import { publishEvent, resolveSort } from './master-data-support.js';
import {
  buildRequestHash,
  canonicalClientBusinessDate,
  requireOperationKey,
  requireBusinessDateInput,
  resolveBusinessDate as resolveBusinessDateInput,
  resolveBusinessDateFilter,
} from './inventory-posting-support.js';
import type { BusinessDateInput } from '../../../kernel/datetime/business-date-input.js';
import {
  businessDateFromInstant,
  type BusinessDate,
} from '../../../kernel/datetime/business-date.js';
import { ItemsService } from './items.service.js';
import { WarehousesService } from './warehouses.service.js';

/**
 * Inventory valuation: configuration, state, cost assignment and the
 * explicit recalculation command (PDR-05, ADR-0039, OQ-24).
 *
 * This service owns the VALUE questions. The quantity services
 * (`InventoryMovementsService`, `InventoryTransfersService`) own the
 * quantity questions and call into here only to resolve which method
 * applies to a posting — they never gate a posting on a monetary answer
 * (OD-VAL-05).
 *
 * Three rules shape every method below:
 *
 * 1. **Nothing is recalculated silently** (OD-VAL-11). Repricing happens
 *    only through an explicit command carrying an explicit choice, and every
 *    run is recorded with what it examined and what it changed.
 * 2. **Nothing claims more precision than it has.** A key whose value is
 *    inconsistent reports `stale`; a key with uncosted stock reports
 *    `pending_cost`. Neither is hidden behind an average that looks exact.
 * 3. **Value is a separate authority from quantity.** Reads redact monetary
 *    fields for callers without `Inventory.Valuation.View` instead of
 *    returning a different shape, and the four valuation permissions are
 *    distinct from the movement ones.
 */
/** The caller-facing shape of a single-key recalculation command. */
export interface RecalculateCommand {
  organizationId: string;
  warehouseId: string;
  itemId: string;
  operationKey: string;
  trigger?: string | undefined;
  /**
   * The business DAY the run is requested for — audit only, OQ-73 shape:
   * a canonical Gregorian day, a declared Jalali day, or a legacy instant.
   */
  fromDate?: BusinessDateInput | undefined;
  reason?: string | null | undefined;
}

/**
 * A recalculation that has passed every non-writing check and is ready to
 * be executed inside a transaction the caller owns.
 */
export interface PreparedRecalculation {
  input: RecalculationInput;
}

@Injectable()
export class InventoryValuationService {
  constructor(
    private readonly valuation: InventoryValuationRepository,
    private readonly methods: ItemValuationMethodsRepository,
    private readonly movements: InventoryMovementsRepository,
    private readonly operations: InventoryOperationsRepository,
    private readonly organizations: OrganizationsService,
    private readonly items: ItemsService,
    private readonly warehouses: WarehousesService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  // ---- method configuration ----------------------------------------------

  async listMethods(query: {
    organizationId: string;
    itemId?: string | undefined;
    activeAt?: BusinessDateInput | undefined;
    page: number;
    pageSize: number;
    sort?: string | undefined;
  }): Promise<PaginatedResult<ItemValuationMethodDto>> {
    await this.authorization.requireAllPermissions([
      VALUATION_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const activeAt =
      query.activeAt === undefined
        ? undefined
        : requireBusinessDateInput(query.activeAt, 'activeAt');
    const { items, total } = await this.methods.list({
      where: {
        organizationId: query.organizationId,
        itemId: query.itemId,
        activeAt,
      },
      orderBy: resolveSort(
        query.sort,
        { validFrom: 'validFrom', createdAt: 'createdAt' },
        [{ validFrom: 'desc' }],
      ),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toItemValuationMethodDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  /**
   * Which method governs an item on a business date, and where that answer
   * came from (`configured` vs the code-defined `default`).
   *
   * Exposed as its own endpoint because "why is this stock valued this way?"
   * must be answerable without reading the configuration table by eye — and
   * because the posting services use exactly this resolution, so the UI can
   * preview what a posting will do.
   */
  async resolveMethod(params: {
    organizationId: string;
    itemId: string;
    asOf?: BusinessDateInput | undefined;
  }): Promise<{
    organizationId: string;
    itemId: string;
    asOf: string;
    method: ValuationMethod;
    source: 'configured' | 'default';
    configurationId: string | null;
    validFrom: string | null;
    validTo: string | null;
    active: boolean;
  }> {
    await this.authorization.requireAllPermissions([
      VALUATION_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(params.organizationId);
    await this.items.requireUsableItemInOrganization(
      params.itemId,
      params.organizationId,
      { allowInactive: true },
    );
    const asOf =
      params.asOf === undefined
        ? businessDateFromInstant(
            new Date(),
            (
              await this.organizations.getDateTimeSettings(
                params.organizationId,
              )
            ).timeZone,
          )
        : requireBusinessDateInput(params.asOf, 'asOf');
    const resolved = await this.resolveMethodForPosting({
      organizationId: params.organizationId,
      itemId: params.itemId,
      asOf,
    });
    return {
      organizationId: params.organizationId,
      itemId: params.itemId,
      asOf,
      method: resolved.method,
      source: resolved.source,
      configurationId: resolved.configurationId,
      validFrom: resolved.validFrom,
      validTo: resolved.validTo,
      active: isActiveValuationMethod(resolved.method),
    };
  }

  /**
   * The resolution the POSTING path uses: no permission check (the caller
   * already authorized the posting) and no HTTP concerns, but the same
   * effective-dated answer.
   *
   * A method that is configured but not implemented fails the posting
   * closed — the alternative would be to value stock with a strategy nobody
   * wrote (AR-24).
   */
  async resolveMethodForPosting(params: {
    organizationId: string;
    itemId: string;
    asOf: BusinessDate;
  }): Promise<ResolvedValuationMethod> {
    // One row, chosen by the database: the version whose window covers
    // `asOf`. Reading the item's whole configuration history to pick one
    // version was never necessary, and this runs on every costed posting.
    const effective = await this.methods.findEffectiveVersionAt(
      params.organizationId,
      params.itemId,
      params.asOf,
    );
    const resolved = resolveValuationMethodFrom(effective);
    if (!isActiveValuationMethod(resolved.method)) {
      throw AppException.businessRule(inactiveMethodMessage(resolved.method), {
        code: 'inventory.valuation_method_not_implemented',
        method: resolved.method,
        activeMethods: [DEFAULT_VALUATION_METHOD],
      });
    }
    return resolved;
  }

  /**
   * Configure the method for an item from a given business date.
   *
   * Effective-dated, never in place: the previous open-ended version is
   * closed at the new `validFrom`, so a recalculation of an earlier period
   * still resolves the method that was in force then (D-21).
   */
  async configureMethod(input: {
    organizationId: string;
    itemId: string;
    method: string;
    validFrom?: BusinessDateInput | undefined;
    validTo?: BusinessDateInput | null | undefined;
    note?: string | null | undefined;
  }): Promise<ItemValuationMethodDto> {
    await this.authorization.requireAllPermissions([
      VALUATION_PERMISSIONS.CONFIGURE,
    ]);
    await this.organizations.requireUsableOrganization(input.organizationId);
    await this.items.requireUsableItemInOrganization(
      input.itemId,
      input.organizationId,
    );

    if (!isValuationMethod(input.method)) {
      throw AppException.validation([
        {
          field: 'method',
          message: `Unknown valuation method. Known methods: ${VALUATION_METHODS.join(', ')}.`,
          code: 'unknownValuationMethod',
        },
      ]);
    }
    if (!isActiveValuationMethod(input.method)) {
      throw AppException.businessRule(inactiveMethodMessage(input.method), {
        code: 'inventory.valuation_method_not_implemented',
        method: input.method,
        activeMethods: [DEFAULT_VALUATION_METHOD],
      });
    }

    const now = new Date();
    const { timeZone } = await this.organizations.getDateTimeSettings(
      input.organizationId,
    );
    const validFrom = resolveBusinessDateInput({
      field: 'validFrom',
      value: input.validFrom,
      timeZone,
      now,
    });
    const validTo =
      input.validTo === undefined || input.validTo === null
        ? null
        : resolveBusinessDateInput({
            field: 'validTo',
            value: input.validTo,
            timeZone,
          });
    if (validTo !== null && validTo <= validFrom) {
      throw AppException.validation([
        {
          field: 'validTo',
          message: 'validTo must be after validFrom.',
          code: 'invalidWindow',
        },
      ]);
    }

    const actorId = getPrincipal()?.userId ?? null;
    try {
      const { version, supersededVersionId } = await this.methods.createVersion(
        {
          create: {
            id: generateId(),
            organizationId: input.organizationId,
            itemId: input.itemId,
            method: input.method,
            validFrom,
            validTo,
            note: normalizeNote(input.note),
            createdAt: now,
            updatedAt: now,
            createdBy: actorId,
          },
          closeAudit: { updatedAt: now, updatedBy: actorId },
        },
      );
      await publishEvent(this.events, {
        type: INVENTORY_VALUATION_METHOD_CONFIGURED_EVENT,
        aggregateType: 'ItemValuationMethod',
        aggregateId: version.id,
        payload: {
          id: version.id,
          organizationId: version.organizationId,
          itemId: version.itemId,
          method: version.method,
          supersededVersionId,
        },
      });
      this.logger.log(
        'Item valuation method configured',
        {
          id: version.id,
          organizationId: version.organizationId,
          itemId: version.itemId,
          method: version.method,
        },
        InventoryValuationService.name,
      );
      return toItemValuationMethodDto(version);
    } catch (error) {
      if (error instanceof ValuationMethodPlanRejectedError) {
        throw AppException.businessRule(
          error.problem === 'invalid_window'
            ? 'validTo must be after validFrom.'
            : 'The requested validity window overlaps an existing valuation method version for this item.',
          { code: `inventory.valuation_method_${error.problem}` },
        );
      }
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'A valuation method version with the same start date already exists for this item.',
        );
      }
      throw error;
    }
  }

  // ---- state reads --------------------------------------------------------

  async listStates(query: {
    organizationId: string;
    branchId?: string | undefined;
    warehouseId?: string | undefined;
    itemId?: string | undefined;
    status?: string | undefined;
    page: number;
    pageSize: number;
    sort?: string | undefined;
  }): Promise<PaginatedResult<InventoryValuationStateDto>> {
    await this.authorization.requireAllPermissions([
      VALUATION_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.valuation.listStates({
      where: {
        organizationId: query.organizationId,
        branchId: query.branchId,
        warehouseId: query.warehouseId,
        itemId: query.itemId,
        status: query.status as ValuationStateStatus | undefined,
      },
      orderBy: resolveSort(
        query.sort,
        { updatedAt: 'updatedAt', createdAt: 'createdAt' },
        [{ updatedAt: 'desc' }],
      ),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toInventoryValuationStateDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  /**
   * Internal, ungated state read for a sibling service's correctness guard
   * (C-59D OD-RET-07: the sales-return cold-start refusal). Not an API: the
   * public `getState` enforces `Valuation.View` and 404s on a missing state,
   * both wrong for a guard that must see `null` and decide, not expose.
   */
  async findValuationState(params: {
    organizationId: string;
    warehouseId: string;
    itemId: string;
  }): Promise<InventoryValuationState | null> {
    return this.valuation.findState(params);
  }

  async getState(params: {
    organizationId: string;
    warehouseId: string;
    itemId: string;
  }): Promise<InventoryValuationStateDto> {
    await this.authorization.requireAllPermissions([
      VALUATION_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(params.organizationId);
    // `allowInactive`: reading or repairing the value of stock that sits in
    // a disabled warehouse must stay possible — history keeps its meaning
    // after master data is retired (master-data-strategy.md §7.4).
    await this.warehouses.requireUsableWarehouseInOrganization(
      params.warehouseId,
      params.organizationId,
      { allowInactive: true },
    );
    await this.items.requireUsableItemInOrganization(
      params.itemId,
      params.organizationId,
      { allowInactive: true },
    );
    const state = await this.valuation.findState(params);
    if (state === null) {
      throw AppException.notFound(
        'Inventory valuation state',
        `${params.warehouseId}/${params.itemId}`,
      );
    }
    return toInventoryValuationStateDto(state);
  }

  async listRuns(query: {
    organizationId: string;
    warehouseId?: string | undefined;
    itemId?: string | undefined;
    trigger?: string | undefined;
    page: number;
    pageSize: number;
    sort?: string | undefined;
  }): Promise<PaginatedResult<InventoryValuationRunDto>> {
    await this.authorization.requireAllPermissions([
      VALUATION_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.valuation.listRuns({
      where: {
        organizationId: query.organizationId,
        warehouseId: query.warehouseId,
        itemId: query.itemId,
        trigger: query.trigger as ValuationRunTrigger | undefined,
      },
      orderBy: resolveSort(
        query.sort,
        { executedAt: 'executedAt', createdAt: 'createdAt' },
        [{ executedAt: 'desc' }],
      ),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toInventoryValuationRunDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  // ---- backdating ---------------------------------------------------------

  /** Internal valuation-impact probe for application services that already
   * enforce their own inventory permission and organization-scope checks. */
  async assessBackdateImpact(params: {
    organizationId: string;
    warehouseId: string;
    itemId: string;
    movementDate: BusinessDate;
  }): Promise<BackdateAssessment> {
    return this.valuation.assessBackdate(params);
  }

  /**
   * What a posting dated `movementDate` would disturb — the data behind the
   * warning the UI must show BEFORE the user commits (OD-VAL-10).
   *
   * Gated by `Movement.Create`, not by a valuation permission: the person
   * who is about to post is the person who must see the consequence, even if
   * they are not allowed to see money. The response therefore carries counts
   * and dates, never amounts.
   */
  async checkBackdate(params: {
    organizationId: string;
    warehouseId: string;
    itemId: string;
    /** The business DAY to check, canonical Gregorian `YYYY-MM-DD`. */
    movementDate: string;
  }): Promise<{
    backdated: boolean;
    movementDate: string;
    latestMovementDate: string | null;
    affectedMovements: number;
    affectedValuedMovements: number;
    alreadyStale: boolean;
    confirmationRequired: boolean;
    repricingChoiceRequired: boolean;
    code: string | null;
  }> {
    await this.authorization.requireAllPermissions([
      MOVEMENT_PERMISSIONS.CREATE,
    ]);
    await this.organizations.assertOrganizationInScope(params.organizationId);
    await this.warehouses.requireUsableWarehouseInOrganization(
      params.warehouseId,
      params.organizationId,
      { allowInactive: true },
    );
    await this.items.requireUsableItemInOrganization(
      params.itemId,
      params.organizationId,
      { allowInactive: true },
    );
    const movementDate = resolveBusinessDateFilter(
      'movementDate',
      params.movementDate,
    );
    if (movementDate === undefined) {
      throw AppException.badRequest('movementDate is required.');
    }
    const assessment = await this.valuation.assessBackdate({
      organizationId: params.organizationId,
      warehouseId: params.warehouseId,
      itemId: params.itemId,
      movementDate,
    });
    return {
      backdated: assessment.backdated,
      movementDate: assessment.movementDate,
      latestMovementDate: assessment.latestMovementDate,
      affectedMovements: assessment.affectedMovements,
      affectedValuedMovements: assessment.affectedValuedMovements,
      alreadyStale: assessment.alreadyStale,
      confirmationRequired: assessment.backdated,
      repricingChoiceRequired: assessment.backdated,
      code: assessment.backdated ? BACKDATE_CONFIRMATION_CODE : null,
    };
  }

  /**
   * The gate the posting path runs. Throws 422 with the measured facts when
   * a backdated posting lacks either explicit decision; returns the choice
   * otherwise.
   *
   * Both refusals are deliberately distinct codes: "you are about to post
   * into the past" and "tell me what to do about the existing values" are
   * different questions, and a UI that collapses them into one dialog
   * cannot explain either.
   */
  async requireBackdateDecisions(params: {
    organizationId: string;
    warehouseId: string;
    itemId: string;
    movementDate: BusinessDate;
    latestMovementDate: BusinessDate | null;
    backdateConfirmed: boolean;
    repricing: RepricingChoice | null;
  }): Promise<{ backdated: boolean; repricing: RepricingChoice | null }> {
    const backdated = isBackdated({
      movementDate: params.movementDate,
      latestMovementDate: params.latestMovementDate,
    });
    if (!backdated) return { backdated: false, repricing: null };

    const assessment = await this.valuation.assessBackdate({
      organizationId: params.organizationId,
      warehouseId: params.warehouseId,
      itemId: params.itemId,
      movementDate: params.movementDate,
    });
    if (!params.backdateConfirmed) {
      throw AppException.businessRule(
        backdateConfirmationMessage(assessment),
        backdateDetails(assessment, BACKDATE_CONFIRMATION_CODE),
      );
    }
    if (params.repricing === null) {
      throw AppException.businessRule(
        repricingChoiceMessage(),
        backdateDetails(assessment, REPRICING_CHOICE_CODE),
      );
    }
    return { backdated: true, repricing: params.repricing };
  }

  // ---- commands -----------------------------------------------------------

  /**
   * Price a movement that was posted without a cost, and either reprice the
   * key now or leave it marked inconsistent — the operator's explicit
   * choice, never a default.
   */
  async assignCost(input: {
    organizationId: string;
    movementId: string;
    operationKey: string;
    totalCost: string;
    repricing: string;
    reason?: string | null | undefined;
  }): Promise<ValuationCommandResult> {
    await this.authorization.requireAllPermissions([
      VALUATION_PERMISSIONS.ASSIGN_COST,
    ]);
    await this.organizations.requireUsableOrganization(input.organizationId);
    const operationKey = requireOperationKey(input.operationKey);
    assertAmount(input.totalCost, 'totalCost');
    // Canonical form up front (`600.00` → `600`), so the amount that goes
    // into the request hash, the movement row and the response is the one
    // the database would hand back — a retry that differs only in trailing
    // zeros is the SAME intent and must replay, not conflict.
    const totalCost = canonicalizeMoney(input.totalCost);
    const repricing = requireRepricingChoice(input.repricing);
    if (repricing === 'recalculate') {
      // Assigning a late cost and restating existing movement values are two
      // separate authorities. `skip` needs only AssignCost; `recalculate`
      // additionally needs Recalculate before any row can be changed.
      await this.authorization.requireAllPermissions([
        VALUATION_PERMISSIONS.RECALCULATE,
      ]);
    }

    const movement = await this.movements.findById(input.movementId);
    if (movement === null || movement.organizationId !== input.organizationId) {
      throw AppException.notFound('Movement', input.movementId);
    }
    if (movement.valuationStatus !== 'unvalued') {
      throw AppException.conflict(
        `Movement "${movement.id}" already carries a cost. Reverse it and post the correction instead of overwriting the value.`,
      );
    }
    // Only stock coming IN can be priced directly: the value of an issue is
    // derived from the method, never typed (OD-VAL-07).
    if (movement.baseQuantity.trim().startsWith('-')) {
      throw AppException.businessRule(
        'Only an inbound movement can be priced directly. The value of an issue is derived from the valuation method; ' +
          'price the receipts it consumed and recalculate instead.',
        { code: 'inventory.cost_assignment_requires_inbound' },
      );
    }

    const requestHash = buildRequestHash('valuation_cost_assignment', {
      movementId: movement.id,
      totalCost,
    });
    const replayed = await this.replayValuation(
      input.organizationId,
      operationKey,
      requestHash,
      'valuation_cost_assignment',
    );
    if (replayed !== null) return replayed;

    const resolved = await this.resolveMethodForPosting({
      organizationId: input.organizationId,
      itemId: movement.itemId,
      asOf: movement.movementDate,
    });
    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    try {
      const runId = generateId();
      const result = await this.valuation.assignCost({
        movementId: movement.id,
        runId,
        key: {
          organizationId: movement.organizationId,
          branchId: movement.branchId,
          warehouseId: movement.warehouseId,
          itemId: movement.itemId,
        },
        method: resolved.method,
        totalCost,
        reason: normalizeNote(input.reason),
        recalculate: repricing === 'recalculate',
        operation: {
          id: generateId(),
          organizationId: input.organizationId,
          operationKey,
          operation: 'valuation_cost_assignment',
          requestHash,
          result: {
            kind: 'valuation',
            runId: repricing === 'recalculate' ? runId : null,
            movementId: movement.id,
          },
          createdAt: now,
          updatedAt: now,
          createdBy: actorId,
        },
        actorId,
        at: now,
      });
      this.logger.log(
        'Inventory cost assigned',
        {
          movementId: movement.id,
          organizationId: movement.organizationId,
          repricing,
          runId: result.run?.id ?? null,
        },
        InventoryValuationService.name,
      );
      if (result.run !== null) {
        await this.announceRecalculated(result.run);
      }
      const refreshed = await this.movements.findById(movement.id);
      return {
        movement:
          refreshed === null
            ? null
            : toInventoryMovementDto(refreshed, await this.canViewCost()),
        state: toInventoryValuationStateDto(result.state),
        run:
          result.run === null ? null : toInventoryValuationRunDto(result.run),
      };
    } catch (error) {
      if (error instanceof CostAlreadyAssignedError) {
        throw AppException.conflict(error.message);
      }
      if (error instanceof RecalculationTooLargeError) {
        throw AppException.businessRule(error.message, {
          code: 'inventory.recalculation_too_large',
          limit: error.limit,
        });
      }
      if (error instanceof UnsupportedValuationMethodError) {
        // History configured with a method this build cannot execute. The
        // replay refuses rather than revaluing that period with the method in
        // force today (OD-VAL-14/OD-VAL-18).
        throw AppException.businessRule(error.message, {
          code: 'inventory.valuation_method_not_implemented',
          method: error.method,
          movementId: error.movementId,
          activeMethods: [DEFAULT_VALUATION_METHOD],
        });
      }
      if (isUniqueViolation(error)) {
        const raced = await this.replayValuation(
          input.organizationId,
          operationKey,
          requestHash,
          'valuation_cost_assignment',
        );
        if (raced !== null) return raced;
      }
      throw error;
    }
  }

  /**
   * Reprice ONE item in ONE warehouse by replaying its movements in the
   * canonical ledger order.
   *
   * Bounded by construction: the key is a required input, the replay is a
   * single transaction, and a key with more movements than
   * `RECALCULATION_MOVEMENT_LIMIT` is refused rather than run. There is no
   * endpoint, parameter or flag anywhere that recalculates more than one key
   * (OD-VAL-12).
   */
  async recalculate(input: RecalculateCommand): Promise<{
    run: InventoryValuationRunDto;
    state: InventoryValuationStateDto;
  }> {
    const plan = await this.planRecalculation(input);
    if (plan.kind === 'replayed') {
      return { run: plan.run, state: plan.state };
    }
    try {
      const result = await this.valuation.recalculateKey(plan.input);
      await this.announceRecalculated(result.run);
      this.logger.log(
        'Inventory valuation recalculated',
        {
          runId: result.run.id,
          organizationId: result.run.organizationId,
          warehouseId: result.run.warehouseId,
          itemId: result.run.itemId,
          movementsExamined: result.run.movementsExamined,
          movementsRevalued: result.run.movementsRevalued,
        },
        InventoryValuationService.name,
      );
      return {
        run: toInventoryValuationRunDto(result.run),
        state: toInventoryValuationStateDto(result.state),
      };
    } catch (error) {
      const translated = this.translateRecalculationError(error);
      if (translated !== null) throw translated;
      if (isUniqueViolation(error)) {
        const raced = await this.replayValuation(
          input.organizationId,
          plan.input.operation.operationKey,
          plan.input.operation.requestHash,
          'valuation_recalculation',
        );
        if (raced !== null && raced.run !== null) {
          return { run: raced.run, state: raced.state };
        }
      }
      throw error;
    }
  }

  /**
   * The same recalculation, executed inside a transaction the CALLER owns.
   *
   * Same permissions, same resolution, same idempotency envelope and the
   * same single `recalculateKeyWithin` replay — the only difference is who
   * owns the `BEGIN … COMMIT`. A command that changes quantities AND must
   * reprice the affected keys (C-58 finalize/edit with an explicit
   * `repricing: "recalculate"`) can therefore make both halves one atomic
   * unit instead of two independently-committing ones.
   *
   * Everything that can be decided without writing — permissions, master
   * data, the idempotency replay, the method resolution — is decided BEFORE
   * the caller's transaction is entered (this method is meant to be invoked
   * from inside it only for the write). A failure inside propagates, which
   * rolls the caller's transaction back: there is no half-repriced commit
   * and no quantity fact left behind by a valuation that did not run.
   *
   * Returns `null` when the operation key was already executed (idempotent
   * replay): nothing was written and nothing has to be announced.
   */
  async prepareRecalculation(
    input: RecalculateCommand,
  ): Promise<PreparedRecalculation | null> {
    const plan = await this.planRecalculation(input);
    return plan.kind === 'replayed' ? null : { input: plan.input };
  }

  /**
   * Execute a plan built by {@link prepareRecalculation} inside the caller's
   * transaction. The returned run is NOT announced yet — the caller
   * publishes it with {@link announceRecalculated} after its own commit, so
   * no subscriber ever sees a valuation run that was rolled back.
   */
  async recalculateWithin(
    tx: CoreTxClient,
    prepared: PreparedRecalculation,
  ): Promise<InventoryValuationRunDto> {
    try {
      const result = await this.valuation.recalculateKeyWithin(
        tx,
        prepared.input,
      );
      return toInventoryValuationRunDto(result.run);
    } catch (error) {
      const translated = this.translateRecalculationError(error);
      if (translated !== null) throw translated;
      throw error;
    }
  }

  /** Shared preamble: everything decided before anything is written. */
  private async planRecalculation(input: RecalculateCommand): Promise<
    | {
        kind: 'replayed';
        run: InventoryValuationRunDto;
        state: InventoryValuationStateDto;
      }
    | {
        kind: 'pending';
        input: RecalculationInput;
      }
  > {
    await this.authorization.requireAllPermissions([
      VALUATION_PERMISSIONS.RECALCULATE,
    ]);
    await this.organizations.requireUsableOrganization(input.organizationId);
    const operationKey = requireOperationKey(input.operationKey);
    const warehouse =
      await this.warehouses.requireUsableWarehouseInOrganization(
        input.warehouseId,
        input.organizationId,
        { allowInactive: true },
      );
    const item = await this.items.requireUsableItemInOrganization(
      input.itemId,
      input.organizationId,
      { allowInactive: true },
    );
    const trigger = requireTrigger(input.trigger);
    // OQ-73: the run's audit business DATE is a calendar day (PostgreSQL
    // `date`), resolved once here; `null` when the caller supplied none.
    const { timeZone } = await this.organizations.getDateTimeSettings(
      input.organizationId,
    );
    const fromDate =
      input.fromDate === undefined
        ? null
        : resolveBusinessDateInput({
            field: 'fromDate',
            value: input.fromDate,
            timeZone,
          });

    const requestHash = buildRequestHash('valuation_recalculation', {
      warehouseId: input.warehouseId,
      itemId: input.itemId,
      trigger,
      // Client day intent only (a DATE is the stored intent, never an
      // instant): the same day under either calendar representation hashes
      // identically.
      fromDate: canonicalClientBusinessDate(input.fromDate),
    });
    const replayed = await this.replayValuation(
      input.organizationId,
      operationKey,
      requestHash,
      'valuation_recalculation',
    );
    if (replayed !== null) {
      if (replayed.run === null) {
        throw new Error('Stored recalculation operation has no run id.');
      }
      return {
        kind: 'replayed',
        run: replayed.run,
        state: replayed.state,
      };
    }

    // This resolution answers ONE question: which method the key is valued
    // under from now on. It is recorded on the run and the state row. It is
    // NOT applied to history — the replay resolves each movement's method at
    // that movement's own business date (OD-VAL-14), so a period that ran
    // under a different configured method is never silently restated under
    // today's one. Resolving it here also keeps the command fail-closed when
    // the CURRENT method is one this build cannot execute.
    const now = new Date();
    const resolved = await this.resolveMethodForPosting({
      organizationId: input.organizationId,
      itemId: item.id,
      asOf: businessDateFromInstant(now, timeZone),
    });
    const actorId = getPrincipal()?.userId ?? null;
    const runId = generateId();
    return {
      kind: 'pending',
      input: {
        runId,
        key: {
          organizationId: input.organizationId,
          branchId: warehouse.branchId,
          warehouseId: input.warehouseId,
          itemId: input.itemId,
        },
        method: resolved.method,
        trigger,
        fromDate,
        reason: normalizeNote(input.reason),
        operation: {
          id: generateId(),
          organizationId: input.organizationId,
          operationKey,
          operation: 'valuation_recalculation',
          requestHash,
          result: { kind: 'valuation', runId, movementId: null },
          createdAt: now,
          updatedAt: now,
          createdBy: actorId,
        },
        actorId,
        at: now,
      },
    };
  }

  /**
   * The two replay refusals that are business answers rather than faults.
   * Returns `null` when the error is something else entirely.
   */
  private translateRecalculationError(error: unknown): AppException | null {
    if (error instanceof RecalculationTooLargeError) {
      return AppException.businessRule(error.message, {
        code: 'inventory.recalculation_too_large',
        limit: error.limit,
      });
    }
    if (error instanceof UnsupportedValuationMethodError) {
      // History configured with a method this build cannot execute. The
      // replay refuses rather than revaluing that period with the method in
      // force today (OD-VAL-14/OD-VAL-18).
      return AppException.businessRule(error.message, {
        code: 'inventory.valuation_method_not_implemented',
        method: error.method,
        movementId: error.movementId,
        activeMethods: [DEFAULT_VALUATION_METHOD],
      });
    }
    return null;
  }

  /**
   * True when the caller may see monetary fields (field-level redaction,
   * brief §21).
   *
   * Non-throwing on purpose: this is not an access gate, it is a projection
   * decision. A warehouse user without `Inventory.Valuation.View` still gets
   * the movement — with the amounts blanked — instead of a 403 that would
   * make the quantity record unreadable too.
   *
   * No HTTP request in flight (bootstrap, worker, a direct service call in a
   * unit test) means no principal to evaluate; the caller is trusted exactly
   * as `requireAllPermissions` trusts it.
   */
  async canViewCost(): Promise<boolean> {
    const principal = getPrincipal();
    if (principal === undefined) return true;
    return this.authorization.hasAllPermissions(principal.userId, [
      VALUATION_PERMISSIONS.VIEW,
    ]);
  }

  // ---- internals ----------------------------------------------------------

  /**
   * Announce a completed recalculation. Public because a caller that runs
   * the replay inside ITS OWN transaction ({@link recalculateWithin}) must
   * publish only after that transaction has committed — a subscriber must
   * never be told about a run that was rolled back.
   */
  async announceRecalculated(run: {
    id: string;
    organizationId: string;
    branchId: string;
    warehouseId: string;
    itemId: string;
    trigger: ValuationRunTrigger;
    movementsExamined: number;
    movementsRevalued: number;
    resultingStatus: ValuationStateStatus;
  }): Promise<void> {
    await publishEvent(this.events, {
      type: INVENTORY_VALUATION_RECALCULATED_EVENT,
      aggregateType: 'InventoryValuationRun',
      aggregateId: run.id,
      payload: {
        id: run.id,
        organizationId: run.organizationId,
        branchId: run.branchId,
        warehouseId: run.warehouseId,
        itemId: run.itemId,
        trigger: run.trigger,
        movementsExamined: run.movementsExamined,
        movementsRevalued: run.movementsRevalued,
        resultingStatus: run.resultingStatus,
      },
    });
  }

  /**
   * The idempotency decision for a valuation command. Same contract as the
   * posting services: no row → `null`; matching hash → the stored result,
   * re-read fresh; different hash → 409.
   */
  private async replayValuation(
    organizationId: string,
    operationKey: string,
    requestHash: string,
    operation: 'valuation_cost_assignment' | 'valuation_recalculation',
  ): Promise<ValuationCommandResult | null> {
    const existing = await this.operations.findByKey(
      organizationId,
      operationKey,
    );
    if (existing === null) return null;
    if (existing.requestHash !== requestHash) {
      throw AppException.conflict(
        `Operation key "${operationKey}" was already used for a different ${operation} request.`,
      );
    }
    if (existing.result.kind !== 'valuation') {
      throw AppException.conflict(
        `Operation key "${operationKey}" was already used for a different operation.`,
      );
    }
    const movementId = existing.result.movementId;
    const movement =
      movementId === null ? null : await this.movements.findById(movementId);
    if (movement === null && movementId !== null) {
      throw new Error(
        `Replay of operation "${existing.id}" points at a missing movement.`,
      );
    }
    const key =
      movement !== null
        ? {
            organizationId: movement.organizationId,
            warehouseId: movement.warehouseId,
            itemId: movement.itemId,
          }
        : null;
    const run =
      existing.result.runId === null
        ? null
        : await this.valuation.findRunById(existing.result.runId);
    const state =
      key !== null
        ? await this.valuation.findState(key)
        : run === null
          ? null
          : await this.valuation.findState({
              organizationId: run.organizationId,
              warehouseId: run.warehouseId,
              itemId: run.itemId,
            });
    if (state === null) {
      throw new Error(
        `Replay of operation "${existing.id}" points at a missing valuation state.`,
      );
    }
    return {
      movement:
        movement === null
          ? null
          : toInventoryMovementDto(movement, await this.canViewCost()),
      state: toInventoryValuationStateDto(state),
      run: run === null ? null : toInventoryValuationRunDto(run),
    };
  }
}

/** What every valuation command returns: the fact, the key, and the run. */
export interface ValuationCommandResult {
  movement: InventoryMovementDto | null;
  state: InventoryValuationStateDto;
  run: InventoryValuationRunDto | null;
}

function backdateDetails(
  assessment: BackdateAssessment,
  code: string,
): Record<string, unknown> {
  return {
    code,
    movementDate: assessment.movementDate,
    latestMovementDate: assessment.latestMovementDate,
    affectedMovements: assessment.affectedMovements,
    affectedValuedMovements: assessment.affectedValuedMovements,
    alreadyStale: assessment.alreadyStale,
    repricingChoices: ['recalculate', 'skip'],
  };
}

function requireRepricingChoice(value: string): RepricingChoice {
  if (value === 'recalculate' || value === 'skip') return value;
  throw AppException.validation([
    {
      field: 'repricing',
      message:
        'repricing must be "recalculate" or "skip". There is no default: valuation is never recalculated silently.',
      code: 'invalidRepricingChoice',
    },
  ]);
}

function requireTrigger(value: string | undefined): ValuationRunTrigger {
  if (value === undefined) return 'manual';
  if (
    value === 'manual' ||
    value === 'backdated_document' ||
    value === 'cost_assignment'
  ) {
    return value;
  }
  throw AppException.validation([
    {
      field: 'trigger',
      message:
        'trigger must be "manual", "backdated_document" or "cost_assignment".',
      code: 'invalidTrigger',
    },
  ]);
}

function normalizeNote(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
