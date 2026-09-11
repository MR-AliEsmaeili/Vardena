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
import {
  buildRequestHash,
  normalizeReference,
  normalizeReason,
  requireOperationKey,
  resolveEnteredToBase,
} from './inventory-posting-support.js';
import { InsufficientStockError } from '../data/inventory-posting-errors.js';
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
  movementDate?: Date | undefined;
  reason?: string | null | undefined;
  referenceType?: string | null | undefined;
  referenceId?: string | null | undefined;
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

    const requestHash = buildRequestHash('transfer_post', {
      organizationId: input.organizationId,
      sourceWarehouseId: input.sourceWarehouseId,
      destinationWarehouseId: input.destinationWarehouseId,
      itemId: input.itemId,
      quantity: resolved.quantity,
      unitId: input.unitId,
      movementDate: movementDate.toISOString(),
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
      return {
        transferId,
        outLeg: toInventoryMovementDto(outLeg),
        inLeg: toInventoryMovementDto(inLeg),
      };
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        throw AppException.businessRule(
          `Insufficient stock in warehouse "${source.code}": ` +
            `on hand ${error.onHand}, requested ${error.requested}.`,
        );
      }
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
    return {
      transferId: outLeg.transferId,
      outLeg: toInventoryMovementDto(outLeg),
      inLeg: toInventoryMovementDto(inLeg),
    };
  }
}

// ---- Internal helpers ----

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
