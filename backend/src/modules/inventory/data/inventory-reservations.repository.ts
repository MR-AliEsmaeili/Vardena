import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import {
  addDecimalStrings,
  compareDecimalStrings,
  subtractDecimalStrings,
} from '../domain/quantities.js';
import { violatesNegativePolicy } from '../domain/negative-stock-policy.js';
import {
  isReservationStatus,
  type InventoryReservation,
} from '../domain/inventory-reservation.js';
import {
  BalanceDriftError,
  ReservationAvailabilityError,
  ReservationNotActiveError,
} from './inventory-posting-errors.js';
import type {
  CoreClient,
  CoreTransactionalClient,
  OperationCreate,
  ReservationCreate,
  ReservationRow,
  ReservationWhere,
} from './inventory-core-rows.js';
import {
  adjustBalanceCounters,
  lockBalanceRow,
  lockReservationRow,
} from './inventory-locks.js';
import { decimalToString } from './inventory-core-rows.js';
import { insertOperationRow } from './inventory-operations.repository.js';
import type { OrderBy } from './master-data-rows.js';

/**
 * Data access for `inventory_reservations` (D-07, ADR-0022).
 *
 * Both writes own ONE transaction and hold the balance row lock across the
 * check and the counter update, so concurrent reservations for one key are
 * evaluated against each other's committed counters:
 *
 * - reserve: lock → availability check → insert (ACTIVE) → bump `reserved`;
 * - release: lock balance → lock reservation row → ACTIVE check → mark
 *   RELEASED → decrement `reserved`.
 *
 * The reservation row lock on release is what makes double-release
 * deterministic: two concurrent releases of one reservation serialize, and
 * the loser sees RELEASED instead of decrementing twice.
 *
 * There is no `delete` here: terminal rows are audit history.
 */

export interface ReservationListFilter {
  organizationId: string;
  warehouseId?: string | undefined;
  itemId?: string | undefined;
  status?: string | undefined;
}

export interface CreateReservationInput {
  reservation: ReservationCreate;
  operation: OperationCreate;
  /** Effective policy for (item override ?? warehouse). */
  allowNegative: boolean;
  actorId: string | null;
}

export interface ReleaseReservationInput {
  reservationId: string;
  operation: OperationCreate;
  releasedAt: Date;
  actorId: string | null;
}

@Injectable()
export class InventoryReservationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<CoreClient> {
    return this.prisma.getClient<CoreClient>();
  }

  private transacting(): Promise<CoreTransactionalClient> {
    return this.prisma.getClient<CoreTransactionalClient>();
  }

  // ---- reads --------------------------------------------------------------

  async findById(id: string): Promise<InventoryReservation | null> {
    const { inventoryReservation } = await this.client();
    const row = await inventoryReservation.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async list(params: {
    where: ReservationListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: InventoryReservation[]; total: number }> {
    const { inventoryReservation } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      inventoryReservation.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      inventoryReservation.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async sumActiveBaseQuantity(
    organizationId: string,
    warehouseId: string,
    itemId: string,
  ): Promise<string> {
    const { inventoryReservation } = await this.client();
    const result = await inventoryReservation.aggregate({
      where: { organizationId, warehouseId, itemId, status: 'active' },
      _sum: { baseQuantity: true },
    });
    return decimalToString(result._sum.baseQuantity ?? '0');
  }

  // ---- writes (each owns its transaction) ----------------------------------

  /**
   * Reserve availability: insert the ACTIVE row and bump the `reserved`
   * counter atomically.
   *
   * @throws ReservationAvailabilityError when the claim would drive
   *   availability negative under a reject policy.
   */
  async createReservation(
    input: CreateReservationInput,
  ): Promise<InventoryReservation> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const { balance } = await lockBalanceRow(
        tx,
        {
          organizationId: input.reservation.organizationId,
          branchId: input.reservation.branchId,
          warehouseId: input.reservation.warehouseId,
          itemId: input.reservation.itemId,
        },
        input.actorId,
      );
      const resultingReserved = addDecimalStrings(
        balance.reserved,
        input.reservation.baseQuantity,
      );
      const resultingAvailable = subtractDecimalStrings(
        balance.onHand,
        resultingReserved,
      );
      if (violatesNegativePolicy(resultingAvailable, input.allowNegative)) {
        throw new ReservationAvailabilityError({
          available: subtractDecimalStrings(balance.onHand, balance.reserved),
          requested: input.reservation.baseQuantity,
        });
      }
      const reservation = toDomain(
        await tx.inventoryReservation.create({ data: input.reservation }),
      );
      await adjustBalanceCounters(tx, {
        balanceId: balance.id,
        onHandDelta: '0',
        reservedDelta: input.reservation.baseQuantity,
        lastMovementAt: balance.lastMovementAt,
        updatedAt: input.reservation.updatedAt,
        updatedBy: input.actorId,
      });
      await insertOperationRow(tx, input.operation);
      return reservation;
    });
  }

  /**
   * Release an ACTIVE reservation: mark it RELEASED and decrement the
   * `reserved` counter atomically.
   *
   * @throws ReservationNotActiveError when the reservation already released.
   * @throws BalanceDriftError when the stored counter contradicts the release
   *   (drift is refused, never silently clamped — see the error docs).
   */
  async releaseReservation(
    input: ReleaseReservationInput,
  ): Promise<InventoryReservation> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const locked = await lockReservationRow(tx, input.reservationId);
      if (locked === null) {
        throw new Error(`Reservation "${input.reservationId}" does not exist.`);
      }
      if (locked.status !== 'active') {
        throw new ReservationNotActiveError(locked.status);
      }
      const { balance } = await lockBalanceRow(
        tx,
        {
          organizationId: locked.organizationId,
          branchId: locked.branchId,
          warehouseId: locked.warehouseId,
          itemId: locked.itemId,
        },
        input.actorId,
      );
      const resultingReserved = subtractDecimalStrings(
        balance.reserved,
        locked.baseQuantity,
      );
      if (compareDecimalStrings(resultingReserved, '0') < 0) {
        throw new BalanceDriftError();
      }
      const released = toDomain(
        await tx.inventoryReservation.update({
          where: { id: input.reservationId },
          data: {
            status: 'released',
            releasedAt: input.releasedAt,
            releasedBy: input.actorId,
            releaseOperationKey: input.operation.operationKey,
            updatedAt: input.releasedAt,
            updatedBy: input.actorId,
          },
        }),
      );
      await adjustBalanceCounters(tx, {
        balanceId: balance.id,
        onHandDelta: '0',
        reservedDelta: subtractDecimalStrings('0', locked.baseQuantity),
        lastMovementAt: balance.lastMovementAt,
        updatedAt: input.releasedAt,
        updatedBy: input.actorId,
      });
      await insertOperationRow(tx, input.operation);
      return released;
    });
  }
}

// ---- Internal helpers ----

function toWhere(filter: ReservationListFilter): ReservationWhere {
  const where: ReservationWhere = { organizationId: filter.organizationId };
  if (filter.warehouseId !== undefined) where.warehouseId = filter.warehouseId;
  if (filter.itemId !== undefined) where.itemId = filter.itemId;
  if (filter.status !== undefined) where.status = filter.status;
  return where;
}

function toDomain(row: ReservationRow): InventoryReservation {
  if (!isReservationStatus(row.status)) {
    throw new Error(
      `Stored reservation "${row.id}" has an unknown status "${row.status}".`,
    );
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    branchId: row.branchId,
    warehouseId: row.warehouseId,
    itemId: row.itemId,
    quantity: decimalToString(row.quantity),
    enteredUnitId: row.unitId,
    baseQuantity: decimalToString(row.baseQuantity),
    baseUnitId: row.baseUnitId,
    conversionFactor: decimalToString(row.conversionFactor),
    status: row.status,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    reason: row.reason,
    operationKey: row.operationKey,
    releasedAt: row.releasedAt,
    releasedBy: row.releasedBy,
    releaseOperationKey: row.releaseOperationKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
