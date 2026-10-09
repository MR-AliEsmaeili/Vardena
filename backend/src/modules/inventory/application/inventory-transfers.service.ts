import { Inject, Injectable } from '@nestjs/common';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { InventoryMovementsRepository } from '../data/inventory-movements.repository.js';
import { InventoryOperationsRepository } from '../data/inventory-operations.repository.js';
import { UnitConversionsRepository } from '../data/unit-conversions.repository.js';
import { resolveEffectivePolicy } from '../domain/negative-stock-policy.js';
import type { InventoryMovementDto } from '../domain/inventory-movement.js';
import { toInventoryMovementDto } from '../domain/inventory-movement.js';
import type { InventoryOperation } from '../domain/inventory-operation.js';
import { TRANSFER_PERMISSIONS } from '../domain/inventory-core-permissions.js';
import {
  INVENTORY_MOVEMENT_POSTED_EVENT,
  INVENTORY_TRANSFER_POSTED_EVENT,
} from '../domain/inventory-core.events.js';
import { publishEvent } from './master-data-support.js';
import { InventoryValuationService } from './inventory-valuation.service.js';
import type { BackdateAssessment } from '../domain/backdating.js';
import {
  BACKDATE_CONFIRMATION_CODE,
  transferBackdateConfirmationMessage,
} from '../domain/backdating.js';
import { DEFAULT_VALUATION_METHOD } from '../domain/valuation-method.js';
import {
  UnsupportedValuationMethodError,
  UnvaluedTransferReplayError,
} from '../domain/valuation-replay.js';
import { VALUATION_PERMISSIONS } from '../domain/inventory-valuation-permissions.js';
import {
  buildRequestHash,
  canonicalClientBusinessDate,
  normalizeReference,
  normalizeReason,
  requireOperationKey,
  resolveBusinessDateCarrier,
  resolveEnteredToBase,
} from './inventory-posting-support.js';
import type { BusinessDateInput } from '../../../kernel/datetime/business-date-input.js';
import { businessDateFromDbDate } from '../../../kernel/datetime/business-date.js';
import {
  InsufficientStockError,
  RecalculationTooLargeError,
  TransferBackdateConfirmationRequiredError,
} from '../data/inventory-posting-errors.js';
import { assertPostableItem } from './inventory-movements.service.js';
import { ItemsService } from './items.service.js';
import { WarehousesService } from './warehouses.service.js';
import { UnitsService } from './units.service.js';

export interface PostTransferInput {
  operationKey: string;
  organizationId: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  itemId: string;
  quantity: string;
  unitId: string;
  /**
   * C-63 business-date INPUT (OQ-73): a canonical Gregorian day, a declared
   * Jalali day (`{ calendar, value }`), or a legacy ISO instant resolved to
   * the day it falls on in the organization zone. Omit for today's business
   * day in the organization zone.
   */
  movementDate?: BusinessDateInput | undefined;
  reason?: string | null | undefined;
  referenceType?: string | null | undefined;
  referenceId?: string | null | undefined;
  /**
   * OD-VAL-10 acknowledgement: the operator knows the transfer is dated
   * before the latest movement on one of its two keys. Required only for a
   * backdated transfer; a confirmed one additionally requires
   * `Inventory.Valuation.Recalculate`, because the coupled replay restates
   * both keys from the transfer date onward.
   */
  backdateConfirmed?: boolean | undefined;
}

export interface TransferResultDto {
  transferId: string;
  outLeg: InventoryMovementDto;
  inLeg: InventoryMovementDto;
}

/**
 * Warehouse-to-warehouse transfers (D-24, ADR-0022).
 *
 * A transfer is an INVENTORY-ONLY operation: two movement facts
 * (`transfer_out` + `transfer_in`) sharing one `transferId`, committed
 * atomically — never one leg without the other. No accounting entry is
 * created (branches are one legal entity's scope, not separate books; OQ-31
 * keeps any future settlement design honest), and the organization's total
 * stock is unchanged by construction (the legs are exact mirrors).
 *
 * The negative-stock policy is evaluated on the SOURCE key inside the
 * transaction; the destination leg only adds and cannot violate it.
 */
@Injectable()
export class InventoryTransfersService {
  constructor(
    private readonly movements: InventoryMovementsRepository,
    private readonly operations: InventoryOperationsRepository,
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

  async postTransfer(input: PostTransferInput): Promise<TransferResultDto> {
    await this.authorization.requireAllPermissions([
      TRANSFER_PERMISSIONS.CREATE,
    ]);
    const operationKey = requireOperationKey(input.operationKey);
    if (input.sourceWarehouseId === input.destinationWarehouseId) {
      throw AppException.badRequest(
        'A transfer needs two different warehouses.',
      );
    }

    await this.organizations.requireUsableOrganization(input.organizationId);
    const source = await this.warehouses.requireUsableWarehouseInOrganization(
      input.sourceWarehouseId,
      input.organizationId,
    );
    const destination =
      await this.warehouses.requireUsableWarehouseInOrganization(
        input.destinationWarehouseId,
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
      required: false,
      operation: 'transfers',
    });
    const reference = normalizeReference({
      referenceType: input.referenceType,
      referenceId: input.referenceId,
    });
    // OQ-73: the transfer's business DATE is a calendar day (PostgreSQL
    // `date`), defaulted to today's business day in the organization zone.
    const { timeZone } = await this.organizations.getDateTimeSettings(
      input.organizationId,
    );
    const movementDate = resolveBusinessDateCarrier({
      field: 'movementDate',
      value: input.movementDate,
      timeZone,
    });
    const resolved = await resolveEnteredToBase({
      conversions: this.conversions,
      organizationId: input.organizationId,
      itemId: item.id,
      baseUnitId: item.baseUnitId,
      unitId: input.unitId,
      quantity: input.quantity,
      asOf: movementDate,
    });

    const requestHash = buildRequestHash('transfer_post', {
      organizationId: input.organizationId,
      sourceWarehouseId: input.sourceWarehouseId,
      destinationWarehouseId: input.destinationWarehouseId,
      itemId: input.itemId,
      quantity: resolved.quantity,
      unitId: input.unitId,
      // Client day intent only: a defaulted today must not enter the hash,
      // or a dateless retry would hash differently and fail to replay
      // (idempotency determinism, ADR-0022).
      movementDate: canonicalClientBusinessDate(input.movementDate),
      reason,
      referenceType: reference.referenceType,
      referenceId: reference.referenceId,
    });
    const replay = await this.replayOrReject(
      input.organizationId,
      operationKey,
      requestHash,
    );
    if (replay !== null) return replay;

    const [sourceBackdate, destinationBackdate] = await Promise.all([
      this.valuation.assessBackdateImpact({
        organizationId: input.organizationId,
        warehouseId: input.sourceWarehouseId,
        itemId: input.itemId,
        movementDate,
      }),
      this.valuation.assessBackdateImpact({
        organizationId: input.organizationId,
        warehouseId: input.destinationWarehouseId,
        itemId: input.itemId,
        movementDate,
      }),
    ]);
    const backdated = requireTransferBackdateDecision({
      movementDate,
      sourceWarehouseId: input.sourceWarehouseId,
      destinationWarehouseId: input.destinationWarehouseId,
      source: sourceBackdate,
      destination: destinationBackdate,
      confirmed: input.backdateConfirmed === true,
    });
    if (backdated) {
      // Restating existing values is a valuation authority, not a warehouse
      // side effect (C-57 hardening): check it BEFORE the quantity fact is
      // written, so a caller who lacks it cannot create stock and then fail.
      await this.authorization.requireAllPermissions([
        VALUATION_PERMISSIONS.RECALCULATE,
      ]);
    }

    // A transfer moves stock AND the value that stock carries, so the pair
    // is exactly value-neutral (PDR-05 rule 6). No cost is ever accepted on
    // a transfer: the value is whatever the source key already held.
    const valuationMethod = await this.valuation.resolveMethodForPosting({
      organizationId: input.organizationId,
      itemId: item.id,
      asOf: movementDate,
    });

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const transferId = generateId();
    const outLegId = generateId();
    const inLegId = generateId();
    try {
      const { outLeg, inLeg } = await this.movements.postTransfer({
        outLeg: {
          id: outLegId,
          organizationId: input.organizationId,
          branchId: source.branchId,
          warehouseId: input.sourceWarehouseId,
          itemId: input.itemId,
          movementType: 'transfer_out',
          quantity: resolved.quantity,
          unitId: input.unitId,
          baseQuantity: `-${resolved.baseQuantity}`,
          baseUnitId: item.baseUnitId,
          conversionFactor: resolved.conversionFactor,
          movementDate,
          transferId,
          reversalOfMovementId: null,
          referenceType: reference.referenceType,
          referenceId: reference.referenceId,
          reason,
          operationKey,
          createdAt: now,
          updatedAt: now,
          createdBy: actorId,
        },
        inLeg: {
          id: inLegId,
          organizationId: input.organizationId,
          branchId: destination.branchId,
          warehouseId: input.destinationWarehouseId,
          itemId: input.itemId,
          movementType: 'transfer_in',
          quantity: resolved.quantity,
          unitId: input.unitId,
          baseQuantity: resolved.baseQuantity,
          baseUnitId: item.baseUnitId,
          conversionFactor: resolved.conversionFactor,
          movementDate,
          transferId,
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
          operation: 'transfer_post',
          requestHash,
          result: { kind: 'transfer', movementIds: [outLegId, inLegId] },
          createdAt: now,
          updatedAt: now,
          createdBy: actorId,
        },
        sourceAllowNegative: resolveEffectivePolicy({
          itemAllow: item.allowNegativeStock,
          warehouseAllow: source.allowNegativeStock,
        }),
        actorId,
        valuationMethod: valuationMethod.method,
        // The repository re-derives the verdict from the LOCKED rows; this is
        // the operator's answer, not the repository's decision.
        backdateConfirmed: input.backdateConfirmed === true,
      });
      await publishEvent(this.events, {
        type: INVENTORY_MOVEMENT_POSTED_EVENT,
        aggregateType: 'InventoryMovement',
        aggregateId: outLeg.id,
        payload: {
          id: outLeg.id,
          organizationId: outLeg.organizationId,
          branchId: outLeg.branchId,
          warehouseId: outLeg.warehouseId,
          itemId: outLeg.itemId,
          movementType: outLeg.movementType,
          transferId: outLeg.transferId,
          reversalOfMovementId: outLeg.reversalOfMovementId,
          operationKey: outLeg.operationKey,
        },
      });
      await publishEvent(this.events, {
        type: INVENTORY_MOVEMENT_POSTED_EVENT,
        aggregateType: 'InventoryMovement',
        aggregateId: inLeg.id,
        payload: {
          id: inLeg.id,
          organizationId: inLeg.organizationId,
          branchId: inLeg.branchId,
          warehouseId: inLeg.warehouseId,
          itemId: inLeg.itemId,
          movementType: inLeg.movementType,
          transferId: inLeg.transferId,
          reversalOfMovementId: inLeg.reversalOfMovementId,
          operationKey: inLeg.operationKey,
        },
      });
      await publishEvent(this.events, {
        type: INVENTORY_TRANSFER_POSTED_EVENT,
        aggregateType: 'InventoryTransfer',
        aggregateId: transferId,
        payload: {
          transferId,
          organizationId: input.organizationId,
          sourceWarehouseId: input.sourceWarehouseId,
          destinationWarehouseId: input.destinationWarehouseId,
          itemId: input.itemId,
          outMovementId: outLeg.id,
          inMovementId: inLeg.id,
          operationKey,
        },
      });
      this.logger.log(
        'Inventory transfer posted',
        {
          transferId,
          organizationId: input.organizationId,
          sourceWarehouseId: input.sourceWarehouseId,
          destinationWarehouseId: input.destinationWarehouseId,
          itemId: input.itemId,
        },
        InventoryTransfersService.name,
      );
      const includeCost = await this.valuation.canViewCost();
      return {
        transferId,
        outLeg: toInventoryMovementDto(outLeg, includeCost),
        inLeg: toInventoryMovementDto(inLeg, includeCost),
      };
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        // Stable business subcode for the UI (see the movements service twin):
        // the source warehouse is the one that ran out.
        throw AppException.businessRule(
          `Insufficient stock in warehouse "${source.code}": ` +
            `on hand ${error.onHand}, requested ${error.requested}.`,
          {
            code: 'inventory.insufficient_stock',
            warehouseId: source.id,
            itemId: input.itemId,
            onHand: error.onHand,
            requested: error.requested,
          },
        );
      }
      const translated = translateTransferReplayError(error);
      if (translated !== null) throw translated;
      if (isUniqueViolation(error)) {
        const raced = await this.replayOrReject(
          input.organizationId,
          operationKey,
          requestHash,
        );
        if (raced !== null) return raced;
      }
      throw error;
    }
  }

  // ---- internals ------------------------------------------------------------

  private async replayOrReject(
    organizationId: string,
    operationKey: string,
    requestHash: string,
  ): Promise<TransferResultDto | null> {
    const existing = await this.operations.findByKey(
      organizationId,
      operationKey,
    );
    if (existing === null) return null;
    assertReplayable(existing, requestHash);
    const [outLegId, inLegId] = existing.result.movementIds;
    const legs = await this.movements.findIds([outLegId, inLegId]);
    const outLeg = legs.find((leg) => leg.id === outLegId) ?? null;
    const inLeg = legs.find((leg) => leg.id === inLegId) ?? null;
    if (outLeg === null || inLeg === null || outLeg.transferId === null) {
      // Impossible: legs are created atomically and never deleted.
      throw new Error(
        `Replay of operation "${existing.id}" points at missing legs.`,
      );
    }
    const includeCost = await this.valuation.canViewCost();
    return {
      transferId: outLeg.transferId,
      outLeg: toInventoryMovementDto(outLeg, includeCost),
      inLeg: toInventoryMovementDto(inLeg, includeCost),
    };
  }
}

// ---- Internal helpers ----

/**
 * The backdating gate for a transfer, shared with the C-58 Transfer document
 * finalize (`inventory-business-documents.service.ts`).
 *
 * A backdated transfer is SUPPORTED since C-59C: the coupled two-key replay
 * values the pair from the source position at the transfer date (OD-TRF-01).
 * What the operator must still do is acknowledge the backdating itself
 * (OD-VAL-10, question 1), because the replay restates both keys from that
 * date onward. There is deliberately no repricing question: the pair is one
 * valuation unit (OD-TRF-05) and the coupled replay is how the transfer is
 * valued, not an optional reprice of values that could be left alone.
 *
 * Returns `true` when the transfer is backdated and confirmed — the caller
 * then also needs `Inventory.Valuation.Recalculate` before writing.
 */
export function requireTransferBackdateDecision(params: {
  movementDate: Date;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  source: BackdateAssessment;
  destination: BackdateAssessment;
  confirmed: boolean;
}): boolean {
  const backdated = params.source.backdated || params.destination.backdated;
  if (!backdated) return false;
  if (params.confirmed) return true;
  const keys = [
    {
      warehouseId: params.sourceWarehouseId,
      latestMovementDate: params.source.latestMovementDate,
    },
    {
      warehouseId: params.destinationWarehouseId,
      latestMovementDate: params.destination.latestMovementDate,
    },
  ];
  throw AppException.businessRule(
    transferBackdateConfirmationMessage({
      movementDate: params.movementDate,
      keys,
    }),
    {
      code: BACKDATE_CONFIRMATION_CODE,
      movementDate: businessDateFromDbDate(params.movementDate),
      keys: keys.map((key) => ({
        warehouseId: key.warehouseId,
        latestMovementDate:
          key.latestMovementDate === null
            ? null
            : businessDateFromDbDate(key.latestMovementDate),
      })),
      source: backdateSummary(params.source),
      destination: backdateSummary(params.destination),
    },
  );
}

/**
 * The replay failures that are business answers rather than faults, mapped
 * once for every transfer surface (the direct endpoint and the C-58 Transfer
 * document). Returns `null` when the error is something else entirely.
 *
 * `TransferBackdateConfirmationRequiredError` is the same refusal as the gate
 * above, raised from the locked write when a concurrent posting made the
 * transfer backdated between the assessment and the transaction: the retry
 * with the confirmation resolves it, which is exactly what the message says.
 */
export function translateTransferReplayError(
  error: unknown,
): AppException | null {
  if (error instanceof TransferBackdateConfirmationRequiredError) {
    return AppException.businessRule(
      transferBackdateConfirmationMessage({
        movementDate: error.movementDate,
        keys: error.keys,
      }),
      {
        code: BACKDATE_CONFIRMATION_CODE,
        movementDate: businessDateFromDbDate(error.movementDate),
        keys: error.keys.map((key) => ({
          warehouseId: key.warehouseId,
          latestMovementDate:
            key.latestMovementDate === null
              ? null
              : businessDateFromDbDate(key.latestMovementDate),
        })),
      },
    );
  }
  if (error instanceof RecalculationTooLargeError) {
    return AppException.businessRule(error.message, {
      code: 'inventory.recalculation_too_large',
      limit: error.limit,
    });
  }
  if (error instanceof UnsupportedValuationMethodError) {
    // History configured with a method this build cannot execute: the replay
    // refuses rather than restating that period under today's method
    // (OD-VAL-14/OD-VAL-18).
    return AppException.businessRule(error.message, {
      code: 'inventory.valuation_method_not_implemented',
      method: error.method,
      movementId: error.movementId,
      activeMethods: [DEFAULT_VALUATION_METHOD],
    });
  }
  if (error instanceof UnvaluedTransferReplayError) {
    // A STORED leg of some OTHER transfer stands in the way: its counterpart
    // key is not part of this replay, so valuing it here would strand value.
    // Genuinely unresolvable by this command — price both keys of that
    // transfer together instead (OD-TRF-08/09).
    return AppException.businessRule(error.message, {
      code: 'inventory.transfer_replay_unpaired_leg',
      movementId: error.movementId,
      transferId: error.transferId,
      counterpartWarehouseId: error.counterpartWarehouseId,
    });
  }
  return null;
}

function backdateSummary(
  assessment: BackdateAssessment,
): Record<string, unknown> {
  return {
    backdated: assessment.backdated,
    movementDate: businessDateFromDbDate(assessment.movementDate),
    latestMovementDate:
      assessment.latestMovementDate === null
        ? null
        : businessDateFromDbDate(assessment.latestMovementDate),
    affectedMovements: assessment.affectedMovements,
    affectedValuedMovements: assessment.affectedValuedMovements,
    alreadyStale: assessment.alreadyStale,
  };
}

function assertReplayable(
  existing: InventoryOperation,
  requestHash: string,
): asserts existing is InventoryOperation & {
  result: { kind: 'transfer'; movementIds: [string, string] };
} {
  if (
    existing.operation !== 'transfer_post' ||
    existing.result.kind !== 'transfer' ||
    existing.requestHash !== requestHash
  ) {
    throw AppException.conflict(
      'This operationKey was already used with a different request. ' +
        'Retry with the original request, or use a new key.',
    );
  }
}
