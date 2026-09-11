import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isMovementType } from '../domain/movement-type.js';
import {
  addDecimalStrings,
  subtractDecimalStrings,
} from '../domain/quantities.js';
import { violatesNegativePolicy } from '../domain/negative-stock-policy.js';
import type { InventoryMovement } from '../domain/inventory-movement.js';
import type { InventoryBalance } from '../domain/inventory-balance.js';
import {
  AlreadyReversedError,
  InsufficientStockError,
} from './inventory-posting-errors.js';
import type {
  BalanceKey,
  CoreClient,
  CoreTransactionalClient,
  MovementCreate,
  MovementRow,
  MovementWhere,
  OperationCreate,
} from './inventory-core-rows.js';
import {
  adjustBalanceCounters,
  lockBalanceRow,
  lockMovementRow,
} from './inventory-locks.js';
import { decimalToString } from './inventory-core-rows.js';
import { insertOperationRow } from './inventory-operations.repository.js';
import type { OrderBy } from './master-data-rows.js';

/**
 * Data access for `inventory_movements` — the immutable ledger (D-04/D-05,
 * ADR-0022).
 *
 * Every posting method owns ONE transaction shaped identically:
 *
 *   1. lock the balance row(s) (`SELECT … FOR UPDATE`, creating the zero row
 *      for a new key),
 *   2. evaluate the negative-stock policy against the LOCKED row,
 *   3. insert the movement row(s),
 *   4. apply the exact counter deltas in SQL,
 *   5. insert the idempotency row.
 *
 * The policy check inside the transaction (never before it) is what makes
 * concurrent postings race-safe: two writers for one key serialize on the
 * lock, and the loser evaluates against the winner's committed counters.
 *
 * There is deliberately no `update` and no `delete` here at all (AR-13):
 * corrections are counter-movements written by `postReversal`.
 */

export interface MovementListFilter {
  organizationId: string;
  branchId?: string | undefined;
  warehouseId?: string | undefined;
  itemId?: string | undefined;
  movementType?: string | undefined;
  transferId?: string | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
}

export interface PostMovementInput {
  movement: MovementCreate;
  operation: OperationCreate;
  /** Effective policy for (item override ?? warehouse). */
  allowNegative: boolean;
  actorId: string | null;
}

export interface PostTransferInput {
  /** Out-leg first: the order is the legs' stable identity. */
  outLeg: MovementCreate;
  inLeg: MovementCreate;
  operation: OperationCreate;
  /** Effective policy evaluated on the SOURCE key (the in-leg only adds). */
  sourceAllowNegative: boolean;
  actorId: string | null;
}

export interface PostReversalInput extends PostMovementInput {
  /** The original movement being reversed (locked for the check). */
  originalMovementId: string;
}

@Injectable()
export class InventoryMovementsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<CoreClient> {
    return this.prisma.getClient<CoreClient>();
  }

  private transacting(): Promise<CoreTransactionalClient> {
    return this.prisma.getClient<CoreTransactionalClient>();
  }

  // ---- reads --------------------------------------------------------------

  async findById(id: string): Promise<InventoryMovement | null> {
    const { inventoryMovement } = await this.client();
    const row = await inventoryMovement.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  async findIds(ids: string[]): Promise<InventoryMovement[]> {
    if (ids.length === 0) return [];
    const { inventoryMovement } = await this.client();
    const rows: InventoryMovement[] = [];
    for (const id of ids) {
      const row = await inventoryMovement.findUnique({ where: { id } });
      if (row !== null) rows.push(toDomain(row));
    }
    return rows;
  }

  async findByTransferId(transferId: string): Promise<InventoryMovement[]> {
    const { inventoryMovement } = await this.client();
    const rows = await inventoryMovement.findMany({
      where: { transferId },
      orderBy: [{ movementDate: 'asc' }],
      skip: 0,
      take: 10,
    });
    return rows.map(toDomain);
  }

  async list(params: {
    where: MovementListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: InventoryMovement[]; total: number }> {
    const { inventoryMovement } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      inventoryMovement.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      inventoryMovement.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async sumBaseQuantity(
    organizationId: string,
    warehouseId: string,
    itemId: string,
  ): Promise<string> {
    const { inventoryMovement } = await this.client();
    const result = await inventoryMovement.aggregate({
      where: { organizationId, warehouseId, itemId },
      _sum: { baseQuantity: true },
      _max: { movementDate: true },
    });
    return decimalToString(result._sum.baseQuantity ?? '0');
  }

  async maxMovementDate(
    organizationId: string,
    warehouseId: string,
    itemId: string,
  ): Promise<Date | null> {
    const { inventoryMovement } = await this.client();
    const result = await inventoryMovement.aggregate({
      where: { organizationId, warehouseId, itemId },
      _sum: { baseQuantity: true },
      _max: { movementDate: true },
    });
    return result._max.movementDate;
  }

  /** Master-data freeze guard: has this item ever moved? */
  async existsForItem(itemId: string): Promise<boolean> {
    const { inventoryMovement } = await this.client();
    return (await inventoryMovement.findFirst({ where: { itemId } })) !== null;
  }

  /** Master-data freeze guard: has this warehouse ever moved stock? */
  async existsForWarehouse(warehouseId: string): Promise<boolean> {
    const { inventoryMovement } = await this.client();
    return (
      (await inventoryMovement.findFirst({ where: { warehouseId } })) !== null
    );
  }

  // ---- postings (each owns its transaction) --------------------------------

  /**
   * Post one movement and advance its balance row atomically.
   *
   * @throws InsufficientStockError when the locked counters reject the delta.
   */
  async postMovement(
    input: PostMovementInput,
  ): Promise<{ movement: InventoryMovement; balance: InventoryBalance }> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const { balance } = await lockBalanceRow(
        tx,
        movementKey(input.movement),
        input.actorId,
      );
      assertSufficient(
        balance.onHand,
        input.movement.baseQuantity,
        input.allowNegative,
      );
      const movement = toDomain(
        await tx.inventoryMovement.create({ data: input.movement }),
      );
      await adjustBalanceCounters(tx, {
        balanceId: balance.id,
        onHandDelta: input.movement.baseQuantity,
        reservedDelta: '0',
        lastMovementAt: maxDate(
          balance.lastMovementAt,
          input.movement.movementDate,
        ),
        updatedAt: input.movement.updatedAt,
        updatedBy: input.actorId,
      });
      await insertOperationRow(tx, input.operation);
      return { movement, balance };
    });
  }

  /**
   * Post a warehouse-to-warehouse transfer: both legs (or neither) commit.
   * The two balance rows lock in ascending warehouse-id order — the fixed
   * global order that keeps concurrent transfers deadlock-free.
   */
  async postTransfer(
    input: PostTransferInput,
  ): Promise<{ outLeg: InventoryMovement; inLeg: InventoryMovement }> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const [first, second] = orderedKeys(input.outLeg, input.inLeg);
      const { balance: firstBalance } = await lockBalanceRow(
        tx,
        first.key,
        input.actorId,
      );
      const { balance: secondBalance } = await lockBalanceRow(
        tx,
        second.key,
        input.actorId,
      );
      const sourceBalance = first.role === 'out' ? firstBalance : secondBalance;

      // The source leg removes stock: the policy bites here. The destination
      // leg only adds and cannot violate a negative-stock policy.
      assertSufficient(
        sourceBalance.onHand,
        input.outLeg.baseQuantity,
        input.sourceAllowNegative,
      );

      const outLeg = toDomain(
        await tx.inventoryMovement.create({ data: input.outLeg }),
      );
      const inLeg = toDomain(
        await tx.inventoryMovement.create({ data: input.inLeg }),
      );
      const outBalance = first.role === 'out' ? firstBalance : secondBalance;
      const inBalance = first.role === 'out' ? secondBalance : firstBalance;
      await adjustBalanceCounters(tx, {
        balanceId: outBalance.id,
        onHandDelta: input.outLeg.baseQuantity,
        reservedDelta: '0',
        lastMovementAt: maxDate(
          outBalance.lastMovementAt,
          input.outLeg.movementDate,
        ),
        updatedAt: input.outLeg.updatedAt,
        updatedBy: input.actorId,
      });
      await adjustBalanceCounters(tx, {
        balanceId: inBalance.id,
        onHandDelta: input.inLeg.baseQuantity,
        reservedDelta: '0',
        lastMovementAt: maxDate(
          inBalance.lastMovementAt,
          input.inLeg.movementDate,
        ),
        updatedAt: input.inLeg.updatedAt,
        updatedBy: input.actorId,
      });
      await insertOperationRow(tx, input.operation);
      return { outLeg, inLeg };
    });
  }

  /**
   * Post a reversal: the exact mirror of one original movement. The original
   * row locks first, so two concurrent reversals of the same movement
   * serialize and the loser deterministically sees the winner's reversal —
   * the unique index stays as backstop, never as the primary mechanism.
   *
   * @throws AlreadyReversedError when the original already has a reversal.
   * @throws InsufficientStockError when the mirror would violate the policy
   *   (e.g. reversing an inbound whose stock was already consumed).
   */
  async postReversal(
    input: PostReversalInput,
  ): Promise<{ movement: InventoryMovement }> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const original = await lockMovementRow(tx, input.originalMovementId);
      if (original === null) {
        throw new Error(
          `Original movement "${input.originalMovementId}" does not exist.`,
        );
      }
      const prior = await tx.inventoryMovement.findFirst({
        where: { reversalOfMovementId: input.originalMovementId },
      });
      if (prior !== null) throw new AlreadyReversedError();

      const { balance } = await lockBalanceRow(
        tx,
        movementKey(input.movement),
        input.actorId,
      );
      assertSufficient(
        balance.onHand,
        input.movement.baseQuantity,
        input.allowNegative,
      );
      const movement = toDomain(
        await tx.inventoryMovement.create({ data: input.movement }),
      );
      await adjustBalanceCounters(tx, {
        balanceId: balance.id,
        onHandDelta: input.movement.baseQuantity,
        reservedDelta: '0',
        lastMovementAt: maxDate(
          balance.lastMovementAt,
          input.movement.movementDate,
        ),
        updatedAt: input.movement.updatedAt,
        updatedBy: input.actorId,
      });
      await insertOperationRow(tx, input.operation);
      return { movement };
    });
  }
}

// ---- Internal helpers ----

function movementKey(movement: MovementCreate): BalanceKey {
  return {
    organizationId: movement.organizationId,
    branchId: movement.branchId,
    warehouseId: movement.warehouseId,
    itemId: movement.itemId,
  };
}

/** The two transfer keys in the fixed locking order (ascending warehouse). */
type OrderedLeg = { role: 'out' | 'in'; key: BalanceKey };

function orderedKeys(
  outLeg: MovementCreate,
  inLeg: MovementCreate,
): [OrderedLeg, OrderedLeg] {
  const out: OrderedLeg = { role: 'out', key: movementKey(outLeg) };
  const into: OrderedLeg = { role: 'in', key: movementKey(inLeg) };
  return out.key.warehouseId.localeCompare(into.key.warehouseId) <= 0
    ? [out, into]
    : [into, out];
}

/** Policy evaluation against the locked row — exact decimal arithmetic. */
function assertSufficient(
  onHand: string,
  baseDelta: string,
  allowNegative: boolean,
): void {
  const resulting = addDecimalStrings(onHand, baseDelta);
  if (violatesNegativePolicy(resulting, allowNegative)) {
    // `requested` is the outbound magnitude (positive) for a readable message.
    const requested = baseDelta.trim().startsWith('-')
      ? decimalToString(subtractDecimalStrings('0', baseDelta))
      : baseDelta;
    throw new InsufficientStockError({ onHand, requested });
  }
}

function maxDate(current: Date | null, candidate: Date): Date {
  if (current === null || candidate.getTime() > current.getTime()) {
    return candidate;
  }
  return current;
}

function toWhere(filter: MovementListFilter): MovementWhere {
  const where: MovementWhere = { organizationId: filter.organizationId };
  if (filter.branchId !== undefined) where.branchId = filter.branchId;
  if (filter.warehouseId !== undefined) where.warehouseId = filter.warehouseId;
  if (filter.itemId !== undefined) where.itemId = filter.itemId;
  if (filter.movementType !== undefined)
    where.movementType = filter.movementType;
  if (filter.transferId !== undefined) where.transferId = filter.transferId;
  if (filter.dateFrom !== undefined || filter.dateTo !== undefined) {
    where.movementDate = {
      ...(filter.dateFrom === undefined ? {} : { gte: filter.dateFrom }),
      ...(filter.dateTo === undefined ? {} : { lte: filter.dateTo }),
    };
  }
  return where;
}

function toDomain(row: MovementRow): InventoryMovement {
  if (!isMovementType(row.movementType)) {
    throw new Error(
      `Stored movement "${row.id}" has an unknown type "${row.movementType}".`,
    );
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    branchId: row.branchId,
    warehouseId: row.warehouseId,
    itemId: row.itemId,
    movementType: row.movementType,
    quantity: decimalToString(row.quantity),
    enteredUnitId: row.unitId,
    baseQuantity: decimalToString(row.baseQuantity),
    baseUnitId: row.baseUnitId,
    conversionFactor: decimalToString(row.conversionFactor),
    movementDate: row.movementDate,
    transferId: row.transferId,
    reversalOfMovementId: row.reversalOfMovementId,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    reason: row.reason,
    operationKey: row.operationKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
