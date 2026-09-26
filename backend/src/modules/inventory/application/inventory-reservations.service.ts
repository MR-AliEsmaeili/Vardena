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
import { InventoryReservationsRepository } from '../data/inventory-reservations.repository.js';
import { InventoryOperationsRepository } from '../data/inventory-operations.repository.js';
import { UnitConversionsRepository } from '../data/unit-conversions.repository.js';
import { resolveEffectivePolicy } from '../domain/negative-stock-policy.js';
import type { InventoryReservationDto } from '../domain/inventory-reservation.js';
import { toInventoryReservationDto } from '../domain/inventory-reservation.js';
import type { InventoryOperation } from '../domain/inventory-operation.js';
import { RESERVATION_PERMISSIONS } from '../domain/inventory-core-permissions.js';
import {
  INVENTORY_RESERVATION_CREATED_EVENT,
  INVENTORY_RESERVATION_RELEASED_EVENT,
} from '../domain/inventory-core.events.js';
import { publishEvent, resolveSort } from './master-data-support.js';
import {
  buildRequestHash,
  normalizeReference,
  normalizeReason,
  requireOperationKey,
  resolveEnteredToBase,
} from './inventory-posting-support.js';
import {
  BalanceDriftError,
  ReservationAvailabilityError,
  ReservationNotActiveError,
} from '../data/inventory-posting-errors.js';
import { assertPostableItem } from './inventory-movements.service.js';
import { ItemsService } from './items.service.js';
import { WarehousesService } from './warehouses.service.js';
import { UnitsService } from './units.service.js';

const SORTABLE_FIELDS: Record<string, string> = {
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  status: 'status',
};

export interface ListReservationsQuery {
  organizationId: string;
  warehouseId?: string | undefined;
  itemId?: string | undefined;
  status?: string | undefined;
  page: number;
  pageSize: number;
  sort?: string | undefined;
}

export interface CreateReservationInput {
  operationKey: string;
  organizationId: string;
  warehouseId: string;
  itemId: string;
  quantity: string;
  unitId: string;
  reason?: string | null | undefined;
  referenceType?: string | null | undefined;
  referenceId?: string | null | undefined;
}

export interface ReleaseReservationInput {
  operationKey: string;
}

/**
 * Inventory reservations — soft claims on availability (D-07, ADR-0022).
 *
 * A reservation promises stock without moving it: `reserved` rises, `onHand`
 * does not move, and the ledger never sees the claim. The lifecycle is
 * ACTIVE → RELEASED, terminal — a release is refused (never silently
 * double-applied) when the reservation already released.
 *
 * Availability is guarded by the SAME effective negative-stock policy as
 * movements: a claim that would drive availability below zero is rejected
 * unless the policy explicitly allows it. The check runs inside the
 * transaction against the locked balance row, so concurrent claims compose
 * instead of racing.
 *
 * Reservations deliberately reference no Sales concepts: the owner is an
 * opaque logical reference the future Sales module will fill in.
 */
@Injectable()
export class InventoryReservationsService {
  constructor(
    private readonly reservations: InventoryReservationsRepository,
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

  async listReservations(
    query: ListReservationsQuery,
  ): Promise<PaginatedResult<InventoryReservationDto>> {
    await this.authorization.requireAllPermissions([
      RESERVATION_PERMISSIONS.VIEW,
    ]);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.reservations.list({
      where: {
        organizationId: query.organizationId,
        warehouseId: query.warehouseId,
        itemId: query.itemId,
        status: query.status,
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [
        { createdAt: 'desc' },
      ]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toInventoryReservationDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getReservation(
    organizationId: string,
    id: string,
  ): Promise<InventoryReservationDto> {
    await this.authorization.requireAllPermissions([
      RESERVATION_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(organizationId);
    const reservation = await this.reservations.findById(id);
    if (reservation === null || reservation.organizationId !== organizationId) {
      throw AppException.notFound('Reservation', id);
    }
    return toInventoryReservationDto(reservation);
  }

  async createReservation(
    input: CreateReservationInput,
  ): Promise<InventoryReservationDto> {
    await this.authorization.requireAllPermissions([
      RESERVATION_PERMISSIONS.CREATE,
    ]);
    const operationKey = requireOperationKey(input.operationKey);

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
      required: false,
      operation: 'reservations',
    });
    const reference = normalizeReference({
      referenceType: input.referenceType,
      referenceId: input.referenceId,
    });
    // Reservations carry no business date: the claim applies to stock now, so
    // the conversion resolves at now.
    const now = new Date();
    const resolved = await resolveEnteredToBase({
      conversions: this.conversions,
      organizationId: input.organizationId,
      itemId: item.id,
      baseUnitId: item.baseUnitId,
      unitId: input.unitId,
      quantity: input.quantity,
      asOf: now,
    });

    const requestHash = buildRequestHash('reservation_create', {
      organizationId: input.organizationId,
      warehouseId: input.warehouseId,
      itemId: input.itemId,
      quantity: resolved.quantity,
      unitId: input.unitId,
      reason,
      referenceType: reference.referenceType,
      referenceId: reference.referenceId,
    });
    const replay = await this.replayOrReject(
      input.organizationId,
      operationKey,
      requestHash,
      'reservation_create',
    );
    if (replay !== null) return replay;

    const actorId = getPrincipal()?.userId ?? null;
    const reservationId = generateId();
    try {
      const created = await this.reservations.createReservation({
        reservation: {
          id: reservationId,
          organizationId: input.organizationId,
          branchId: warehouse.branchId,
          warehouseId: input.warehouseId,
          itemId: input.itemId,
          quantity: resolved.quantity,
          unitId: input.unitId,
          baseQuantity: resolved.baseQuantity,
          baseUnitId: item.baseUnitId,
          conversionFactor: resolved.conversionFactor,
          status: 'active',
          referenceType: reference.referenceType,
          referenceId: reference.referenceId,
          reason,
          operationKey,
          releasedAt: null,
          releasedBy: null,
          releaseOperationKey: null,
          createdAt: now,
          updatedAt: now,
          createdBy: actorId,
        },
        operation: {
          id: generateId(),
          organizationId: input.organizationId,
          operationKey,
          operation: 'reservation_create',
          requestHash,
          result: { kind: 'reservation', reservationId },
          createdAt: now,
          updatedAt: now,
          createdBy: actorId,
        },
        allowNegative: resolveEffectivePolicy({
          itemAllow: item.allowNegativeStock,
          warehouseAllow: warehouse.allowNegativeStock,
        }),
        actorId,
      });
      await publishEvent(this.events, {
        type: INVENTORY_RESERVATION_CREATED_EVENT,
        aggregateType: 'InventoryReservation',
        aggregateId: created.id,
        payload: {
          id: created.id,
          organizationId: created.organizationId,
          branchId: created.branchId,
          warehouseId: created.warehouseId,
          itemId: created.itemId,
          operationKey: created.operationKey,
        },
      });
      this.logger.log(
        'Inventory reservation created',
        {
          reservationId: created.id,
          organizationId: created.organizationId,
          warehouseId: created.warehouseId,
          itemId: created.itemId,
        },
        InventoryReservationsService.name,
      );
      return toInventoryReservationDto(created);
    } catch (error) {
      if (error instanceof ReservationAvailabilityError) {
        throw AppException.businessRule(
          `Insufficient available stock in warehouse "${warehouse.code}": ` +
            `available ${error.available}, requested ${error.requested}.`,
        );
      }
      if (isUniqueViolation(error)) {
        const raced = await this.replayOrReject(
          input.organizationId,
          operationKey,
          requestHash,
          'reservation_create',
        );
        if (raced !== null) return raced;
      }
      throw error;
    }
  }

  async releaseReservation(
    organizationId: string,
    id: string,
    input: ReleaseReservationInput,
  ): Promise<InventoryReservationDto> {
    await this.authorization.requireAllPermissions([
      RESERVATION_PERMISSIONS.RELEASE,
    ]);
    await this.organizations.assertOrganizationInScope(organizationId);
    const operationKey = requireOperationKey(input.operationKey);
    const current = await this.reservations.findById(id);
    if (current === null || current.organizationId !== organizationId) {
      throw AppException.notFound('Reservation', id);
    }

    const requestHash = buildRequestHash('reservation_release', {
      reservationId: current.id,
    });
    const replay = await this.replayOrReject(
      current.organizationId,
      operationKey,
      requestHash,
      'reservation_release',
    );
    if (replay !== null) return replay;

    const releasedAt = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    try {
      const released = await this.reservations.releaseReservation({
        reservationId: current.id,
        operation: {
          id: generateId(),
          organizationId: current.organizationId,
          operationKey,
          operation: 'reservation_release',
          requestHash,
          result: { kind: 'reservation', reservationId: current.id },
          createdAt: releasedAt,
          updatedAt: releasedAt,
          createdBy: actorId,
        },
        releasedAt,
        actorId,
      });
      await publishEvent(this.events, {
        type: INVENTORY_RESERVATION_RELEASED_EVENT,
        aggregateType: 'InventoryReservation',
        aggregateId: released.id,
        payload: {
          id: released.id,
          organizationId: released.organizationId,
          branchId: released.branchId,
          warehouseId: released.warehouseId,
          itemId: released.itemId,
          operationKey,
        },
      });
      this.logger.log(
        'Inventory reservation released',
        {
          reservationId: released.id,
          organizationId: released.organizationId,
        },
        InventoryReservationsService.name,
      );
      return toInventoryReservationDto(released);
    } catch (error) {
      if (error instanceof ReservationNotActiveError) {
        throw AppException.businessRule(
          'The reservation is already released. A release is terminal and cannot be applied twice.',
        );
      }
      if (error instanceof BalanceDriftError) {
        throw AppException.conflict(
          'The stored reserved quantity contradicts this release. ' +
            'Run reconciliation to diagnose it before retrying.',
        );
      }
      if (isUniqueViolation(error)) {
        const raced = await this.replayOrReject(
          current.organizationId,
          operationKey,
          requestHash,
          'reservation_release',
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
    operation: 'reservation_create' | 'reservation_release',
  ): Promise<InventoryReservationDto | null> {
    const existing = await this.operations.findByKey(
      organizationId,
      operationKey,
    );
    if (existing === null) return null;
    assertReplayable(existing, requestHash, operation);
    const reservation = await this.reservations.findById(
      existing.result.reservationId,
    );
    if (reservation === null) {
      // Impossible: reservation rows are never deleted.
      throw new Error(
        `Replay of operation "${existing.id}" points at a missing reservation.`,
      );
    }
    return toInventoryReservationDto(reservation);
  }
}

// ---- Internal helpers ----

function assertReplayable(
  existing: InventoryOperation,
  requestHash: string,
  operation: 'reservation_create' | 'reservation_release',
): asserts existing is InventoryOperation & {
  result: { kind: 'reservation'; reservationId: string };
} {
  if (
    existing.operation !== operation ||
    existing.result.kind !== 'reservation' ||
    existing.requestHash !== requestHash
  ) {
    throw AppException.conflict(
      'This operationKey was already used with a different request. ' +
        'Retry with the original request, or use a new key.',
    );
  }
}
