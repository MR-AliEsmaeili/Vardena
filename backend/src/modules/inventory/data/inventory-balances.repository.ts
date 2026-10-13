import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { businessDateFromDbDate } from '../../../kernel/datetime/business-date.js';
import type { BusinessDate } from '../../../kernel/datetime/business-date.js';
import { compareDecimalStrings } from '../domain/quantities.js';
import type { InventoryBalance } from '../domain/inventory-balance.js';
import type {
  BalanceRow,
  BalanceWhere,
  CoreClient,
  CoreTransactionalClient,
  CoreTxClient,
} from './inventory-core-rows.js';
import { lockBalanceRow, setBalanceAbsolute } from './inventory-locks.js';
import { decimalToString } from './inventory-core-rows.js';
import type { OrderBy } from './master-data-rows.js';

/**
 * Data access for `inventory_balances` — the materialized projection (D-04,
 * ADR-0022).
 *
 * Postings never write through this repository: balance counters advance only
 * inside the movement/reservation transactions that own them. What lives here
 * is reads, the master-data freeze guards, and the two maintenance
 * capabilities:
 *
 * - `compareKey` — recompute one key's expected counters and report the
 *   difference WITHOUT writing (the read-only reconciliation report);
 * - `rebuildKey` — recompute and overwrite one key's counters, deleting the
 *   row when the key has no facts at all (the audited maintenance rebuild).
 *
 * Both take the key's row lock around the re-computation, so a concurrent
 * posting either lands fully before the SUM (and is included) or fully after
 * (and increments from the rebuilt value) — maintenance can neither miss a
 * posting nor clobber one. Each key runs in its OWN short transaction: no
 * long maintenance transaction ever blocks postings (database-strategy §13).
 */

export interface BalanceListFilter {
  organizationId: string;
  branchId?: string | undefined;
  warehouseId?: string | undefined;
  itemId?: string | undefined;
}

export interface BalanceScope {
  organizationId: string;
  warehouseId?: string | undefined;
  itemId?: string | undefined;
}

export interface StockingKey {
  warehouseId: string;
  itemId: string;
}

export interface KeyExpectation {
  warehouseId: string;
  itemId: string;
  expectedOnHand: string;
  expectedReserved: string;
  expectedLastMovementDate: BusinessDate | null;
}

export interface KeyComparison extends KeyExpectation {
  stored: { onHand: string; reserved: string } | null;
  matches: boolean;
}

export type RebuildAction = 'created' | 'updated' | 'deleted' | 'noop';

export interface KeyRebuild extends KeyExpectation {
  storedBefore: { onHand: string; reserved: string } | null;
  action: RebuildAction;
}

@Injectable()
export class InventoryBalancesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<CoreClient> {
    return this.prisma.getClient<CoreClient>();
  }

  private transacting(): Promise<CoreTransactionalClient> {
    return this.prisma.getClient<CoreTransactionalClient>();
  }

  // ---- reads --------------------------------------------------------------

  async findByKey(
    organizationId: string,
    warehouseId: string,
    itemId: string,
  ): Promise<InventoryBalance | null> {
    const { inventoryBalance } = await this.client();
    const row = await inventoryBalance.findFirst({
      where: { organizationId, warehouseId, itemId },
    });
    return row === null ? null : toDomain(row);
  }

  async list(params: {
    where: BalanceListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: InventoryBalance[]; total: number }> {
    const { inventoryBalance } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      inventoryBalance.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      inventoryBalance.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  /**
   * Every stocking key with facts in the scope: keys present in the ledger,
   * in reservations, or as stored rows. The union matters — a phantom stored
   * row (no facts) and a missing row (facts exist) are both drift.
   */
  async listStockingKeys(scope: BalanceScope): Promise<StockingKey[]> {
    const { inventoryMovement, inventoryBalance, inventoryReservation } =
      await this.client();
    const movementWhere = {
      organizationId: scope.organizationId,
      ...(scope.warehouseId === undefined
        ? {}
        : { warehouseId: scope.warehouseId }),
      ...(scope.itemId === undefined ? {} : { itemId: scope.itemId }),
    };
    const [movementKeys, balanceKeys, reservationKeys] = await Promise.all([
      inventoryMovement.groupBy({
        by: ['warehouseId', 'itemId'],
        where: movementWhere,
      }),
      inventoryBalance.groupBy({
        by: ['warehouseId', 'itemId'],
        where: movementWhere,
      }),
      inventoryReservation.groupBy({
        by: ['warehouseId', 'itemId'],
        where: { ...movementWhere, status: 'active' },
      }),
    ]);
    const merged = new Map<string, StockingKey>();
    for (const key of [...movementKeys, ...balanceKeys, ...reservationKeys]) {
      merged.set(`${key.warehouseId}|${key.itemId}`, {
        warehouseId: key.warehouseId,
        itemId: key.itemId,
      });
    }
    return [...merged.values()].sort((a, b) =>
      `${a.warehouseId}|${a.itemId}`.localeCompare(
        `${b.warehouseId}|${b.itemId}`,
      ),
    );
  }

  /** Master-data freeze guard: does this item hold any stock or claims? */
  async hasBlockingBalanceForItem(itemId: string): Promise<boolean> {
    const { inventoryBalance } = await this.client();
    return (
      (await inventoryBalance.findFirst({
        where: {
          itemId,
          OR: [{ onHand: { not: '0' } }, { reservedQuantity: { not: '0' } }],
        },
      })) !== null
    );
  }

  /** Master-data freeze guard: does this warehouse hold any stock or claims? */
  async hasBlockingBalanceForWarehouse(warehouseId: string): Promise<boolean> {
    const { inventoryBalance } = await this.client();
    return (
      (await inventoryBalance.findFirst({
        where: {
          warehouseId,
          OR: [{ onHand: { not: '0' } }, { reservedQuantity: { not: '0' } }],
        },
      })) !== null
    );
  }

  // ---- maintenance (one short transaction per key) --------------------------

  /**
   * Recompute one key's expected counters under its row lock and compare
   * without writing. Read-only: the transaction never modifies data (a
   * missing row is reported, not created).
   */
  async compareKey(
    organizationId: string,
    key: StockingKey,
  ): Promise<KeyComparison> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const stored = await lockExistingBalanceRow(tx, organizationId, key);
      const expected = await this.expectation(tx, organizationId, key);
      if (stored === null) {
        return {
          ...expected,
          stored: null,
          matches:
            compareDecimalStrings(expected.expectedOnHand, '0') === 0 &&
            compareDecimalStrings(expected.expectedReserved, '0') === 0,
        };
      }
      return {
        ...expected,
        stored: { onHand: stored.onHand, reserved: stored.reserved },
        matches:
          compareDecimalStrings(stored.onHand, expected.expectedOnHand) === 0 &&
          compareDecimalStrings(stored.reserved, expected.expectedReserved) ===
            0,
      };
    });
  }

  /**
   * Recompute one key's counters under its row lock and store them: update
   * the row when it differs, create it when facts exist but no row does, and
   * delete it when neither facts nor counters exist (a phantom row). Returns
   * the before/after so the caller can report and audit every correction.
   */
  async rebuildKey(
    organizationId: string,
    branchId: string,
    key: StockingKey,
    actorId: string | null,
  ): Promise<KeyRebuild> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      // `lockBalanceRow` (not the read-only variant): two concurrent rebuilds
      // of a missing key race the INSERT, and the shared helper resolves that
      // race — the loser locks the winner's row instead of crashing on the
      // unique index. A row conjured here for a fact-less key is deleted again
      // below, inside the same transaction, so it is never observable.
      const { balance: stored, created: isNew } = await lockBalanceRow(
        tx,
        {
          organizationId,
          branchId,
          warehouseId: key.warehouseId,
          itemId: key.itemId,
        },
        actorId,
      );
      const expected = await this.expectation(tx, organizationId, key);
      const factsExist =
        compareDecimalStrings(expected.expectedOnHand, '0') !== 0 ||
        compareDecimalStrings(expected.expectedReserved, '0') !== 0 ||
        expected.expectedLastMovementDate !== null;
      const now = new Date();

      if (isNew) {
        if (!factsExist) {
          await tx.inventoryBalance.delete({ where: { id: stored.id } });
          return { ...expected, storedBefore: null, action: 'noop' };
        }
        await setBalanceAbsolute(tx, {
          balanceId: stored.id,
          onHand: expected.expectedOnHand,
          reserved: expected.expectedReserved,
          lastMovementDate: expected.expectedLastMovementDate,
          updatedAt: now,
          updatedBy: actorId,
        });
        return { ...expected, storedBefore: null, action: 'created' };
      }

      const storedBefore = {
        onHand: stored.onHand,
        reserved: stored.reserved,
      };
      if (!factsExist) {
        await tx.inventoryBalance.delete({ where: { id: stored.id } });
        return { ...expected, storedBefore, action: 'deleted' };
      }
      if (
        compareDecimalStrings(stored.onHand, expected.expectedOnHand) === 0 &&
        compareDecimalStrings(stored.reserved, expected.expectedReserved) ===
          0 &&
        sameBusinessDate(
          stored.lastMovementDate,
          expected.expectedLastMovementDate,
        )
      ) {
        return { ...expected, storedBefore, action: 'noop' };
      }
      await setBalanceAbsolute(tx, {
        balanceId: stored.id,
        onHand: expected.expectedOnHand,
        reserved: expected.expectedReserved,
        lastMovementDate: expected.expectedLastMovementDate,
        updatedAt: now,
        updatedBy: actorId,
      });
      return { ...expected, storedBefore, action: 'updated' };
    });
  }

  // ---- internals ------------------------------------------------------------

  /** The ledger-derived truth for one key (exact SUMs, no floats). */
  private async expectation(
    tx: CoreTxClient,
    organizationId: string,
    key: StockingKey,
  ): Promise<KeyExpectation> {
    const [movements, reservations] = await Promise.all([
      tx.inventoryMovement.aggregate({
        where: {
          organizationId,
          warehouseId: key.warehouseId,
          itemId: key.itemId,
        },
        _sum: { baseQuantity: true },
        _max: { movementDate: true },
      }),
      tx.inventoryReservation.aggregate({
        where: {
          organizationId,
          warehouseId: key.warehouseId,
          itemId: key.itemId,
          status: 'active',
        },
        _sum: { baseQuantity: true },
      }),
    ]);
    return {
      warehouseId: key.warehouseId,
      itemId: key.itemId,
      expectedOnHand: decimalToString(movements._sum.baseQuantity ?? '0'),
      expectedReserved: decimalToString(reservations._sum.baseQuantity ?? '0'),
      expectedLastMovementDate:
        movements._max.movementDate === null
          ? null
          : businessDateFromDbDate(movements._max.movementDate),
    };
  }
}

// ---- Internal helpers ----

function toWhere(filter: BalanceListFilter): BalanceWhere {
  const where: BalanceWhere = { organizationId: filter.organizationId };
  if (filter.branchId !== undefined) where.branchId = filter.branchId;
  if (filter.warehouseId !== undefined) where.warehouseId = filter.warehouseId;
  if (filter.itemId !== undefined) where.itemId = filter.itemId;
  return where;
}

/**
 * Lock the stored row for maintenance WITHOUT creating it when missing:
 * unlike postings (which own the key from here on), reconciliation must not
 * conjure rows for keys it merely inspects.
 */
async function lockExistingBalanceRow(
  tx: CoreTxClient,
  organizationId: string,
  key: StockingKey,
): Promise<{
  id: string;
  onHand: string;
  reserved: string;
  lastMovementDate: BusinessDate | null;
} | null> {
  const rows = await tx.$queryRaw<{
    id: string;
    onHand: string;
    reservedQuantity: string;
    lastMovementDate: Date | null;
  }>`
    SELECT "id",
           "on_hand" AS "onHand",
           "reserved_quantity" AS "reservedQuantity",
           "last_movement_date" AS "lastMovementDate"
      FROM "inventory"."inventory_balances"
     WHERE "organization_id" = ${organizationId}
       AND "warehouse_id" = ${key.warehouseId}
       AND "item_id" = ${key.itemId}
     FOR UPDATE`;
  const [row] = rows;
  if (row === undefined) return null;
  return {
    id: row.id,
    onHand: decimalToString(row.onHand),
    reserved: decimalToString(row.reservedQuantity),
    lastMovementDate:
      row.lastMovementDate === null
        ? null
        : businessDateFromDbDate(row.lastMovementDate),
  };
}

/** Canonical business-day equality (no instant or zone semantics). */
function sameBusinessDate(
  left: BusinessDate | null,
  right: BusinessDate | null,
): boolean {
  return left === right;
}

function toDomain(row: BalanceRow): InventoryBalance {
  return {
    id: row.id,
    organizationId: row.organizationId,
    branchId: row.branchId,
    warehouseId: row.warehouseId,
    itemId: row.itemId,
    onHand: decimalToString(row.onHand),
    reserved: decimalToString(row.reservedQuantity),
    lastMovementDate:
      row.lastMovementDate === null
        ? null
        : businessDateFromDbDate(row.lastMovementDate),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
