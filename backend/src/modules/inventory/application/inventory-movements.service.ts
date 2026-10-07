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
import { InventoryMovementsRepository } from '../data/inventory-movements.repository.js';
import { InventoryOperationsRepository } from '../data/inventory-operations.repository.js';
import { InventoryBusinessDocumentsRepository } from '../data/inventory-business-documents.repository.js';
import { INVENTORY_DOCUMENT_REFERENCE_TYPE } from '../domain/inventory-business-document.js';
import { UnitConversionsRepository } from '../data/unit-conversions.repository.js';
import {
  isMovementType,
  isSinglePostType,
  movementSign,
  requiresReason,
  reversalTypeFor,
  type SinglePostType,
} from '../domain/movement-type.js';
import { subtractDecimalStrings } from '../domain/quantities.js';
import { resolveEffectivePolicy } from '../domain/negative-stock-policy.js';
import type {
  InventoryMovement,
  InventoryMovementDto,
} from '../domain/inventory-movement.js';
import { toInventoryMovementDto } from '../domain/inventory-movement.js';
import type { InventoryOperation } from '../domain/inventory-operation.js';
import { MOVEMENT_PERMISSIONS } from '../domain/inventory-core-permissions.js';
import { INVENTORY_MOVEMENT_POSTED_EVENT } from '../domain/inventory-core.events.js';
import { publishEvent, resolveSort } from './master-data-support.js';
import {
  buildRequestHash,
  canonicalClientDate,
  normalizeReference,
  normalizeReason,
  requireOperationKey,
  resolveEnteredToBase,
} from './inventory-posting-support.js';
import {
  AlreadyReversedError,
  InsufficientStockError,
} from '../data/inventory-posting-errors.js';
import { ItemsService } from './items.service.js';
import { WarehousesService } from './warehouses.service.js';
import { UnitsService } from './units.service.js';
import { InventoryValuationService } from './inventory-valuation.service.js';
import { resolveEnteredCost } from './inventory-cost-support.js';
import {
  isRepricingChoice,
  type RepricingChoice,
} from '../domain/backdating.js';
import { VALUATION_PERMISSIONS } from '../domain/inventory-valuation-permissions.js';

const SORTABLE_FIELDS: Record<string, string> = {
  movementDate: 'movementDate',
  createdAt: 'createdAt',
};

export interface ListMovementsQuery {
  organizationId: string;
  branchId?: string | undefined;
  warehouseId?: string | undefined;
  itemId?: string | undefined;
  movementType?: string | undefined;
  transferId?: string | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
  page: number;
  pageSize: number;
  sort?: string | undefined;
}

export interface PostMovementInput {
  operationKey: string;
  organizationId: string;
  warehouseId: string;
  itemId: string;
  movementType: string;
  quantity: string;
  unitId: string;
  movementDate?: Date | undefined;
  reason?: string | null | undefined;
  referenceType?: string | null | undefined;
  referenceId?: string | null | undefined;
  /**
   * OPTIONAL cost, inbound only (PDR-05 OD-VAL-05). At most one of the two
   * is accepted; neither is ever required, and both are refused on an issue
   * — a warehouse receipt must be postable with no money in it at all.
   */
  unitCost?: string | null | undefined;
  totalCost?: string | null | undefined;
  /** Acknowledgement of the backdating warning (OD-VAL-10). */
  backdateConfirmed?: boolean | undefined;
  /** The SECOND explicit choice a backdated posting needs (OD-VAL-11). */
  repricing?: string | null | undefined;
}

export interface ReverseMovementInput {
  operationKey: string;
  movementDate?: Date | undefined;
  /** Acknowledgement of the backdating warning (OD-VAL-10). */
  backdateConfirmed?: boolean | undefined;
  /** The SECOND explicit choice a backdated reversal needs (OD-VAL-11). */
  repricing?: string | null | undefined;
}

/**
 * Inventory movement posting and history (D-04/D-05, ADR-0022).
 *
 * A posting resolves everything it needs (references, conversion, policy)
 * and then commits movement + balance + idempotency row in ONE repository
 * transaction. The negative-stock policy is evaluated inside that transaction
 * against the locked balance row — never in a check-then-act across two
 * round trips — which is what makes concurrent postings race-safe.
 *
 * Idempotency: `operationKey` is required. A retried key with the identical
 * canonical request replays the stored movement; the same key with different
 * intent is rejected with 409 and never applied. Both the pre-check and the
 * unique-violation fallback (for two requests racing the same key) funnel
 * through `replayOrReject`.
 */
@Injectable()
export class InventoryMovementsService {
  constructor(
    private readonly movements: InventoryMovementsRepository,
    private readonly operations: InventoryOperationsRepository,
    private readonly documents: InventoryBusinessDocumentsRepository,
    private readonly conversions: UnitConversionsRepository,
    private readonly organizations: OrganizationsService,
    private readonly items: ItemsService,
    private readonly warehouses: WarehousesService,
    private readonly units: UnitsService,
    private readonly valuation: InventoryValuationService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async listMovements(
    query: ListMovementsQuery,
  ): Promise<PaginatedResult<InventoryMovementDto>> {
    await this.authorization.requireAllPermissions([MOVEMENT_PERMISSIONS.VIEW]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.movements.list({
      where: {
        organizationId: query.organizationId,
        branchId: query.branchId,
        warehouseId: query.warehouseId,
        itemId: query.itemId,
        movementType: query.movementType,
        transferId: query.transferId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [
        { movementDate: 'desc' },
        { createdAt: 'desc' },
      ]),
      skip,
      take,
    });
    const includeCost = await this.valuation.canViewCost();
    return toPaginatedResult(
      items.map((movement) => toInventoryMovementDto(movement, includeCost)),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getMovement(
    organizationId: string,
    id: string,
  ): Promise<InventoryMovementDto> {
    await this.authorization.requireAllPermissions([MOVEMENT_PERMISSIONS.VIEW]);
    await this.organizations.assertOrganizationInScope(organizationId);
    const movement = await this.movements.findById(id);
    if (movement === null || movement.organizationId !== organizationId) {
      throw AppException.notFound('Movement', id);
    }
    return toInventoryMovementDto(movement, await this.valuation.canViewCost());
  }

  async postMovement(input: PostMovementInput): Promise<InventoryMovementDto> {
    await this.authorization.requireAllPermissions([
      MOVEMENT_PERMISSIONS.CREATE,
    ]);
    const operationKey = requireOperationKey(input.operationKey);
    const movementType = requireSinglePostType(input.movementType);

    await this.organizations.requireUsableOrganization(input.organizationId);
    const warehouse =
      await this.warehouses.requireUsableWarehouseInOrganization(
        input.warehouseId,
        input.organizationId,
      );
    const item = await this.items.requireUsableItemInOrganization(
      input.itemId,
      input.organizationId,
    );
    await this.units.requireUsableUnitInOrganization(
      input.unitId,
      input.organizationId,
    );
    assertPostableItem(item.code, {
      isStockable: item.isStockable,
      requiresLot: item.requiresLot,
      requiresSerial: item.requiresSerial,
      requiresExpiry: item.requiresExpiry,
    });

    const reason = normalizeReason(input.reason, {
      required: requiresReason(movementType),
      operation: 'adjustments',
    });
    const reference = normalizeReference({
      referenceType: input.referenceType,
      referenceId: input.referenceId,
    });
    const movementDate = input.movementDate ?? new Date();
    const resolved = await resolveEnteredToBase({
      conversions: this.conversions,
      organizationId: input.organizationId,
      itemId: item.id,
      baseUnitId: item.baseUnitId,
      unitId: input.unitId,
      quantity: input.quantity,
      asOf: movementDate,
    });
    const baseQuantity =
      movementSign(movementType) === 1
        ? resolved.baseQuantity
        : `-${resolved.baseQuantity}`;

    // Cost is optional and inbound-only; `resolveEnteredCost` rejects a cost
    // on an issue and never rounds an amount a human typed.
    const enteredCost = resolveEnteredCost({
      input: { unitCost: input.unitCost, totalCost: input.totalCost },
      movementType,
      quantity: resolved.quantity,
    });
    if (enteredCost !== null) {
      // Entering a value is a different authority from recording a quantity:
      // a warehouse user may post the receipt, only accounting may price it.
      await this.authorization.requireAllPermissions([
        VALUATION_PERMISSIONS.ASSIGN_COST,
      ]);
    }
    const repricing = parseRepricing(input.repricing);
    const valuationMethod = await this.valuation.resolveMethodForPosting({
      organizationId: input.organizationId,
      itemId: item.id,
      asOf: movementDate,
    });

    const requestHash = buildRequestHash('movement_post', {
      organizationId: input.organizationId,
      warehouseId: input.warehouseId,
      itemId: input.itemId,
      movementType,
      quantity: resolved.quantity,
      unitId: input.unitId,
      // Hash the client's date intent, not the effective clock: when the
      // client omits the date it defaults to now() PER ATTEMPT, so including
      // it would make a dateless retry hash differently and falsely 409
      // instead of replaying (idempotency determinism, ADR-0022).
      movementDate: canonicalClientDate(input.movementDate),
      reason,
      referenceType: reference.referenceType,
      referenceId: reference.referenceId,
      // The cost IS part of the request's identity: the same key with a
      // different amount is different intent and must be rejected, not
      // replayed. The backdating answers are NOT: they are decisions about
      // the same posting, so a retry replays instead of re-asking.
      enteredCost,
    });
    const replay = await this.replayOrReject(
      input.organizationId,
      operationKey,
      requestHash,
      'movement_post',
    );
    if (replay !== null) return replay;

    // The backdating gate runs AFTER the replay decision on purpose: a retry
    // of an already-committed backdated posting must replay quietly instead
    // of demanding the confirmation a second time.
    const latestMovementDate = await this.movements.maxMovementDate(
      input.organizationId,
      input.warehouseId,
      input.itemId,
    );
    const backdating = await this.valuation.requireBackdateDecisions({
      organizationId: input.organizationId,
      warehouseId: input.warehouseId,
      itemId: input.itemId,
      movementDate,
      latestMovementDate,
      backdateConfirmed: input.backdateConfirmed === true,
      repricing,
    });
    if (backdating.repricing === 'recalculate') {
      // Choosing repricing is an accounting authority, not a warehouse side
      // effect. Check it BEFORE committing the quantity fact; otherwise a
      // caller who lacks Recalculate could create stock and then fail on the
      // second transaction.
      await this.authorization.requireAllPermissions([
        VALUATION_PERMISSIONS.RECALCULATE,
      ]);
    }

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    // Ids are generated in the application layer (never DB defaults), so the
    // idempotency envelope can reference the movement before it exists.
    const movementId = generateId();
    try {
      const { movement } = await this.movements.postMovement({
        movement: {
          id: movementId,
          organizationId: input.organizationId,
          branchId: warehouse.branchId,
          warehouseId: input.warehouseId,
          itemId: input.itemId,
          movementType,
          quantity: resolved.quantity,
          unitId: input.unitId,
          baseQuantity,
          baseUnitId: item.baseUnitId,
          conversionFactor: resolved.conversionFactor,
          movementDate,
          transferId: null,
          reversalOfMovementId: null,
          referenceType: reference.referenceType,
          referenceId: reference.referenceId,
          reason,
          operationKey,
          createdAt: now,
          updatedAt: now,
          createdBy: actorId,
        },
        operation: {
          id: generateId(),
          organizationId: input.organizationId,
          operationKey,
          operation: 'movement_post',
          requestHash,
          result: { kind: 'movement', movementIds: [movementId] },
          createdAt: now,
          updatedAt: now,
          createdBy: actorId,
        },
        allowNegative: resolveEffectivePolicy({
          itemAllow: item.allowNegativeStock,
          warehouseAllow: warehouse.allowNegativeStock,
        }),
        actorId,
        valuation: {
          method: valuationMethod.method,
          knownValue: enteredCost,
          knownValueSource: 'entered',
          backdated: backdating.backdated,
        },
      });
      await publishEvent(this.events, {
        type: INVENTORY_MOVEMENT_POSTED_EVENT,
        aggregateType: 'InventoryMovement',
        aggregateId: movement.id,
        payload: {
          id: movement.id,
          organizationId: movement.organizationId,
          branchId: movement.branchId,
          warehouseId: movement.warehouseId,
          itemId: movement.itemId,
          movementType: movement.movementType,
          transferId: movement.transferId,
          reversalOfMovementId: movement.reversalOfMovementId,
          operationKey: movement.operationKey,
        },
      });
      this.logger.log(
        'Inventory movement posted',
        {
          movementId: movement.id,
          organizationId: movement.organizationId,
          warehouseId: movement.warehouseId,
          itemId: movement.itemId,
          movementType: movement.movementType,
        },
        InventoryMovementsService.name,
      );
      // The repricing the operator explicitly asked for runs as its own
      // audited command AFTER the quantity fact is safely committed: a
      // failed repricing must never lose the warehouse's movement, and the
      // key honestly reports `stale` until the recalculation succeeds.
      const current =
        backdating.backdated && backdating.repricing === 'recalculate'
          ? await this.repriceAfterBackdatedPost({
              organizationId: movement.organizationId,
              warehouseId: movement.warehouseId,
              itemId: movement.itemId,
              operationKey,
              movementId: movement.id,
            })
          : movement;
      return toInventoryMovementDto(
        current,
        await this.valuation.canViewCost(),
      );
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        // Stable business subcode so the ERP UI can render its own Persian
        // insufficient-stock copy with the measured quantities instead of
        // parsing this English contract message (FE-UX-02 §1.2/§2.1: the
        // decision channel is the code, never the message text).
        throw AppException.businessRule(
          `Insufficient stock in warehouse "${warehouse.code}": ` +
            `on hand ${error.onHand}, requested ${error.requested}.`,
          {
            code: 'inventory.insufficient_stock',
            warehouseId: warehouse.id,
            itemId: input.itemId,
            onHand: error.onHand,
            requested: error.requested,
          },
        );
      }
      if (isUniqueViolation(error)) {
        // Lost a key race inside the transaction: the winner's row is what
        // decides replay-or-reject now.
        const raced = await this.replayOrReject(
          input.organizationId,
          operationKey,
          requestHash,
          'movement_post',
        );
        if (raced !== null) return raced;
      }
      throw error;
    }
  }

  /**
   * Reverse one posted movement with its exact mirror: same quantities with a
   * flipped sign, same units and factor, opposite-direction reversal type.
   * The mirror reuses the ORIGINAL conversion factor — re-resolving at the
   * reversal date could value the mirror differently and silently unbalance
   * the key.
   *
   * Reversals require active master data (a reversal is new ledger usage) but
   * bypass the lot/serial/expiry gate: they mirror an accepted fact rather
   * than introducing a new untracked one.
   */
  async reverseMovement(
    organizationId: string,
    id: string,
    input: ReverseMovementInput,
  ): Promise<InventoryMovementDto> {
    await this.authorization.requireAllPermissions([
      MOVEMENT_PERMISSIONS.REVERSE,
    ]);
    await this.organizations.assertOrganizationInScope(organizationId);
    const operationKey = requireOperationKey(input.operationKey);
    const original = await this.movements.findById(id);
    if (original === null || original.organizationId !== organizationId) {
      throw AppException.notFound('Movement', id);
    }

    // OD-REV-07 (C-59D): no reversal after Accounting Post. A movement that
    // belongs to a business document is reversed through that document
    // (its cancel/edit pipeline) while it is operational; once the document
    // has crossed the accounting boundary, its economic result is immutable
    // and the correction convention is an explicit accounting correction,
    // which Vardena does not implement (OQ-27). A document-less movement
    // (a direct posting) has no boundary to cross and reverses as before.
    if (original.referenceType === INVENTORY_DOCUMENT_REFERENCE_TYPE) {
      const [header] = await this.documents.listHeadersByIds(organizationId, [
        original.referenceId ?? '',
      ]);
      if (header !== undefined) {
        if (
          header.status === 'accounting_posted' ||
          header.status === 'immutable'
        ) {
          throw AppException.businessRule(
            'This movement belongs to an accounting-posted document and can no longer be reversed. Accounting-posted documents are immutable; use an explicit accounting correction once Vardena defines one (OQ-27).',
            {
              code: 'inventory.reversal.accounting_posted',
              movementId: original.id,
              documentId: header.id,
              documentStatus: header.status,
            },
          );
        }
      }
    }

    const movementDate = input.movementDate ?? new Date();
    if (movementDate.getTime() < original.movementDate.getTime()) {
      throw AppException.businessRule(
        'A reversal cannot be dated before the movement it reverses. Use a date on or after the original movement date.',
        { code: 'inventory.reversal_date_before_original' },
      );
    }
    const repricing = parseRepricing(input.repricing);
    const requestHash = buildRequestHash('movement_reversal', {
      movementId: original.id,
      // Same determinism rule as posting: hash the client date intent, never
      // the server's defaulted clock (a dateless retry must replay). The
      // backdating answers are excluded for the same reason as plain postings:
      // they are decisions about this reversal, not a different reversal.
      movementDate: canonicalClientDate(input.movementDate),
    });
    const replay = await this.replayOrReject(
      original.organizationId,
      operationKey,
      requestHash,
      'movement_reversal',
    );
    if (replay !== null) return replay;

    const warehouse =
      await this.warehouses.requireUsableWarehouseInOrganization(
        original.warehouseId,
        original.organizationId,
      );
    const item = await this.items.requireUsableItemInOrganization(
      original.itemId,
      original.organizationId,
    );
    await this.units.requireUsableUnitInOrganization(
      original.enteredUnitId,
      original.organizationId,
    );

    const reversalType = reversalTypeFor(original.baseQuantity);
    // A reversal is valued from the ORIGINAL movement's value inside the
    // posting transaction (the repository reads it from the locked row), so
    // nothing monetary is passed in here. The method still has to be
    // resolved: it decides how the key's state is maintained.
    const valuationMethod = await this.valuation.resolveMethodForPosting({
      organizationId: original.organizationId,
      itemId: original.itemId,
      asOf: movementDate,
    });
    const latestMovementDate = await this.movements.maxMovementDate(
      original.organizationId,
      original.warehouseId,
      original.itemId,
    );
    const backdating = await this.valuation.requireBackdateDecisions({
      organizationId: original.organizationId,
      warehouseId: original.warehouseId,
      itemId: original.itemId,
      movementDate,
      latestMovementDate,
      backdateConfirmed: input.backdateConfirmed === true,
      repricing,
    });
    if (backdating.repricing === 'recalculate') {
      await this.authorization.requireAllPermissions([
        VALUATION_PERMISSIONS.RECALCULATE,
      ]);
    }
    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const movementId = generateId();
    try {
      const { movement } = await this.movements.postReversal({
        originalMovementId: original.id,
        movement: {
          id: movementId,
          organizationId: original.organizationId,
          branchId: original.branchId,
          warehouseId: original.warehouseId,
          itemId: original.itemId,
          movementType: reversalType,
          quantity: original.quantity,
          unitId: original.enteredUnitId,
          baseQuantity: subtractDecimalStrings('0', original.baseQuantity),
          baseUnitId: original.baseUnitId,
          conversionFactor: original.conversionFactor,
          movementDate,
          transferId: null,
          reversalOfMovementId: original.id,
          referenceType: original.referenceType,
          referenceId: original.referenceId,
          reason: original.reason,
          operationKey,
          createdAt: now,
          updatedAt: now,
          createdBy: actorId,
        },
        operation: {
          id: generateId(),
          organizationId: original.organizationId,
          operationKey,
          operation: 'movement_reversal',
          requestHash,
          result: { kind: 'movement', movementIds: [movementId] },
          createdAt: now,
          updatedAt: now,
          createdBy: actorId,
        },
        allowNegative: resolveEffectivePolicy({
          itemAllow: item.allowNegativeStock,
          warehouseAllow: warehouse.allowNegativeStock,
        }),
        actorId,
        valuation: {
          method: valuationMethod.method,
          knownValue: null,
          backdated: backdating.backdated,
        },
      });
      await publishEvent(this.events, {
        type: INVENTORY_MOVEMENT_POSTED_EVENT,
        aggregateType: 'InventoryMovement',
        aggregateId: movement.id,
        payload: {
          id: movement.id,
          organizationId: movement.organizationId,
          branchId: movement.branchId,
          warehouseId: movement.warehouseId,
          itemId: movement.itemId,
          movementType: movement.movementType,
          transferId: movement.transferId,
          reversalOfMovementId: movement.reversalOfMovementId,
          operationKey: movement.operationKey,
        },
      });
      this.logger.log(
        'Inventory movement reversed',
        {
          movementId: movement.id,
          reversalOfMovementId: original.id,
          organizationId: movement.organizationId,
        },
        InventoryMovementsService.name,
      );
      const current =
        backdating.backdated && backdating.repricing === 'recalculate'
          ? await this.repriceAfterBackdatedPost({
              organizationId: movement.organizationId,
              warehouseId: movement.warehouseId,
              itemId: movement.itemId,
              operationKey,
              movementId: movement.id,
            })
          : movement;
      return toInventoryMovementDto(
        current,
        await this.valuation.canViewCost(),
      );
    } catch (error) {
      if (error instanceof AlreadyReversedError) {
        throw AppException.conflict('The movement has already been reversed.');
      }
      if (error instanceof InsufficientStockError) {
        // Same stable subcode as the posting path, with the reversal context.
        throw AppException.businessRule(
          `Reversing this movement would drive warehouse "${warehouse.code}" ` +
            `below zero: on hand ${error.onHand}, reversal needs ${error.requested}.`,
          {
            code: 'inventory.insufficient_stock',
            warehouseId: warehouse.id,
            itemId: original.itemId,
            onHand: error.onHand,
            requested: error.requested,
          },
        );
      }
      if (isUniqueViolation(error)) {
        const raced = await this.replayOrReject(
          original.organizationId,
          operationKey,
          requestHash,
          'movement_reversal',
        );
        if (raced !== null) return raced;
      }
      throw error;
    }
  }

  // ---- internals ------------------------------------------------------------

  /**
   * The idempotency decision for one (organization, key): no row → null (the
   * caller proceeds to post); row with a matching hash → the replayed DTO;
   * row with a different hash → 409 (the key is taken by other intent).
   */
  private async replayOrReject(
    organizationId: string,
    operationKey: string,
    requestHash: string,
    operation: 'movement_post' | 'movement_reversal',
  ): Promise<InventoryMovementDto | null> {
    const existing = await this.operations.findByKey(
      organizationId,
      operationKey,
    );
    if (existing === null) return null;
    assertReplayable(existing, requestHash, operation);
    const [movementId] = existing.result.movementIds;
    if (movementId === undefined) {
      throw new Error('Stored inventory operation has an empty result.');
    }
    const movement = await this.movements.findById(movementId);
    if (movement === null) {
      // Impossible: ledger rows are never deleted.
      throw new Error(
        `Replay of operation "${existing.id}" points at a missing movement.`,
      );
    }
    return toInventoryMovementDto(movement, await this.valuation.canViewCost());
  }

  /**
   * Run the repricing the operator explicitly chose after a backdated
   * posting, and return the movement as it looks afterwards.
   *
   * Deliberately NOT part of the posting transaction. A quantity fact that
   * the warehouse observed must survive a failed valuation replay; if the
   * recalculation fails, the movement stands and its key keeps reporting
   * `stale`, which is exactly the state the explicit command exists to
   * repair. The recalculation carries its own operation key (suffixed) so
   * it is idempotent on its own terms.
   */
  private async repriceAfterBackdatedPost(params: {
    organizationId: string;
    warehouseId: string;
    itemId: string;
    operationKey: string;
    movementId: string;
  }): Promise<InventoryMovement> {
    await this.valuation.recalculate({
      organizationId: params.organizationId,
      warehouseId: params.warehouseId,
      itemId: params.itemId,
      operationKey: `${params.operationKey}:reprice`.slice(0, 128),
      trigger: 'backdated_document',
      reason: 'Repricing requested with a backdated inventory operation.',
    });
    const refreshed = await this.movements.findById(params.movementId);
    if (refreshed === null) {
      throw new Error('The posted movement disappeared after repricing.');
    }
    return refreshed;
  }
}

// ---- Internal helpers ----

/**
 * The single-posting channel accepts plain postings only. Transfer legs and
 * reversals name their dedicated operations in the rejection so the caller
 * learns the right channel instead of a bare "invalid type".
 */
function requireSinglePostType(value: string): SinglePostType {
  if (isSinglePostType(value)) return value;
  if (value === 'transfer_in' || value === 'transfer_out') {
    throw AppException.businessRule(
      'Transfer legs cannot be posted directly. Post a transfer so both legs commit atomically.',
    );
  }
  if (value === 'reversal_in' || value === 'reversal_out') {
    throw AppException.businessRule(
      'Reversals cannot be posted directly. Reverse the original movement instead.',
    );
  }
  if (!isMovementType(value)) {
    throw AppException.badRequest(
      'Movement type must be one of: inbound, outbound, adjustment_in, adjustment_out.',
    );
  }
  throw AppException.businessRule(
    `Movement type "${value}" cannot be posted through this operation.`,
  );
}

/**
 * Fail-closed item gates for NEW ledger facts: non-stockable items (a service
 * must never enter physical stock) and lot/serial/expiry-tracked items (no
 * tracking implementation exists yet, so recording the movement would silently
 * drop traceability the item requires).
 */
export function assertPostableItem(
  itemCode: string,
  capabilities: {
    isStockable: boolean;
    requiresLot: boolean;
    requiresSerial: boolean;
    requiresExpiry: boolean;
  },
): void {
  if (!capabilities.isStockable) {
    throw AppException.businessRule(
      `Item "${itemCode}" is not stockable and cannot have inventory movements.`,
    );
  }
  if (capabilities.requiresLot) {
    throw AppException.businessRule(
      `Item "${itemCode}" requires lot tracking, which is not implemented yet. ` +
        'The movement is rejected rather than recorded without its lot.',
    );
  }
  if (capabilities.requiresSerial) {
    throw AppException.businessRule(
      `Item "${itemCode}" requires serial tracking, which is not implemented yet. ` +
        'The movement is rejected rather than recorded without its serial.',
    );
  }
  if (capabilities.requiresExpiry) {
    throw AppException.businessRule(
      `Item "${itemCode}" requires expiry tracking, which is not implemented yet. ` +
        'The movement is rejected rather than recorded without its expiry.',
    );
  }
}

function assertReplayable(
  existing: InventoryOperation,
  requestHash: string,
  operation: 'movement_post' | 'movement_reversal',
): asserts existing is InventoryOperation & {
  result: { kind: 'movement'; movementIds: string[] };
} {
  if (
    existing.operation !== operation ||
    existing.result.kind !== 'movement' ||
    existing.requestHash !== requestHash
  ) {
    throw AppException.conflict(
      'This operationKey was already used with a different request. ' +
        'Retry with the original request, or use a new key.',
    );
  }
}

/**
 * The repricing answer, or `null` when the client did not give one. An
 * invalid value is rejected rather than defaulted: "I did not understand
 * your choice" must never become "I chose for you" when the subject is
 * whether to restate existing values.
 */
function parseRepricing(
  value: string | null | undefined,
): RepricingChoice | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!isRepricingChoice(trimmed)) {
    throw AppException.validation([
      {
        field: 'repricing',
        message:
          'repricing must be "recalculate" or "skip". There is no default: valuation is never recalculated silently.',
        code: 'invalidRepricingChoice',
      },
    ]);
  }
  return trimmed;
}
