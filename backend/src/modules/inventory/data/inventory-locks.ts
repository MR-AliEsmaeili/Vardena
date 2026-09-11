import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import type { InventoryBalance } from '../domain/inventory-balance.js';
import type {
  BalanceCreate,
  BalanceKey,
  CoreTxClient,
  DecimalLike,
} from './inventory-core-rows.js';
import { decimalToString } from './inventory-core-rows.js';

/**
 * Row locking for the inventory core (Task 7, ADR-0022, ADR-0017).
 *
 * Every posting holds the balance row lock from BEFORE its ledger write until
 * commit; reconciliation and rebuild take the same lock around their
 * re-computation. That single rule is what makes concurrent postings and
 * maintenance race-safe:
 *
 * - two postings for one key serialize on the lock; the policy check reads
 *   the locked row, so check-then-act is atomic;
 * - a rebuild holding the lock sees exactly the committed movements (an
 *   in-flight posting either committed before the SUM and is included, or
 *   waits and increments after) — never a torn state.
 *
 * Lock ORDER is fixed wherever two rows are needed, and no deadlock cycle
 * exists: a balance row is never HELD while acquiring another lock (entity
 * locks come first — releases lock the reservation, reversals the original
 * movement, then the balance), and the one path locking two balances
 * (transfers) always ascends by warehouse id. So no transaction holding a
 * balance lock ever waits on a reservation/movement lock, and no two
 * transactions ever take two balance locks in opposite orders.
 *
 * Prisma cannot express `SELECT … FOR UPDATE`, hence the parameterized raw
 * statements below — the documented concurrency-critical path
 * (docs/modules.md §Inventory, AR-11). Numeric counter updates also run in SQL
 * (`SET on_hand = on_hand + $1`) so PostgreSQL's exact `numeric` arithmetic —
 * never a float — applies the delta.
 */

/** A locked balance row, mapped from its aliased columns. */
interface LockedBalanceRow {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  onHand: DecimalLike;
  reservedQuantity: DecimalLike;
  lastMovementAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Lock the balance row for a key, creating the zero row when the key is new.
 *
 * Two concurrent first-postings both miss the SELECT and race the INSERT; the
 * loser catches the unique violation and re-selects, which by then sees the
 * winner's committed row (or waits for it). Bounded retries — the loop only
 * repeats while another transaction owns the key.
 */
export async function lockBalanceRow(
  tx: CoreTxClient,
  key: BalanceKey,
  actorId: string | null,
): Promise<{ balance: InventoryBalance; created: boolean }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await tx.$queryRaw<LockedBalanceRow>`
      SELECT "id",
             "organization_id" AS "organizationId",
             "branch_id" AS "branchId",
             "warehouse_id" AS "warehouseId",
             "item_id" AS "itemId",
             "on_hand" AS "onHand",
             "reserved_quantity" AS "reservedQuantity",
             "last_movement_at" AS "lastMovementAt",
             "created_at" AS "createdAt",
             "updated_at" AS "updatedAt"
        FROM "inventory"."inventory_balances"
       WHERE "organization_id" = ${key.organizationId}
         AND "warehouse_id" = ${key.warehouseId}
         AND "item_id" = ${key.itemId}
       FOR UPDATE`;
    const [row] = existing;
    if (row !== undefined) return { balance: toBalance(row), created: false };

    const create: BalanceCreate = {
      id: generateId(),
      organizationId: key.organizationId,
      branchId: key.branchId,
      warehouseId: key.warehouseId,
      itemId: key.itemId,
      onHand: '0',
      reservedQuantity: '0',
      lastMovementAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: actorId,
    };
    try {
      const created = await tx.inventoryBalance.create({ data: create });
      return {
        balance: toBalance({
          id: created.id,
          organizationId: created.organizationId,
          branchId: created.branchId,
          warehouseId: created.warehouseId,
          itemId: created.itemId,
          onHand: created.onHand,
          reservedQuantity: created.reservedQuantity,
          lastMovementAt: created.lastMovementAt,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
        }),
        created: true,
      };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Lost the creation race — loop around and lock the winner's row.
    }
  }
  throw new Error(
    'Could not lock the stock balance row: too many concurrent writers for one key.',
  );
}

/**
 * Apply exact counter deltas to a LOCKED balance row. `lastMovementAt` is the
 * already-computed new maximum (or the unchanged value for reservation-only
 * operations) — the comparison happens in TypeScript, the write here.
 */
export async function adjustBalanceCounters(
  tx: CoreTxClient,
  input: {
    balanceId: string;
    onHandDelta: string;
    reservedDelta: string;
    lastMovementAt: Date | null;
    updatedAt: Date;
    updatedBy: string | null;
  },
): Promise<void> {
  await tx.$queryRaw<never>`
    UPDATE "inventory"."inventory_balances"
       SET "on_hand" = "on_hand" + ${input.onHandDelta}::numeric,
           "reserved_quantity" = "reserved_quantity" + ${input.reservedDelta}::numeric,
           "last_movement_at" = ${input.lastMovementAt}::timestamptz,
           "updated_at" = ${input.updatedAt}::timestamptz,
           "updated_by" = ${input.updatedBy}
     WHERE "id" = ${input.balanceId}`;
}

/**
 * Overwrite the counters of a LOCKED balance row with recomputed values
 * (rebuild path only — postings always use incremental `adjustBalanceCounters`
 * so concurrent increments compose instead of clobbering).
 */
export async function setBalanceAbsolute(
  tx: CoreTxClient,
  input: {
    balanceId: string;
    onHand: string;
    reserved: string;
    lastMovementAt: Date | null;
    updatedAt: Date;
    updatedBy: string | null;
  },
): Promise<void> {
  await tx.$queryRaw<never>`
    UPDATE "inventory"."inventory_balances"
       SET "on_hand" = ${input.onHand}::numeric,
           "reserved_quantity" = ${input.reserved}::numeric,
           "last_movement_at" = ${input.lastMovementAt}::timestamptz,
           "updated_at" = ${input.updatedAt}::timestamptz,
           "updated_by" = ${input.updatedBy}
     WHERE "id" = ${input.balanceId}`;
}

/**
 * Lock one reservation row (`null` when it does not exist), returning the
 * key columns the release needs so no second read is required inside the
 * transaction.
 */
export async function lockReservationRow(
  tx: CoreTxClient,
  reservationId: string,
): Promise<{
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  status: string;
  baseQuantity: string;
} | null> {
  const rows = await tx.$queryRaw<{
    id: string;
    organizationId: string;
    branchId: string;
    warehouseId: string;
    itemId: string;
    status: string;
    baseQuantity: DecimalLike;
  }>`
    SELECT "id",
           "organization_id" AS "organizationId",
           "branch_id" AS "branchId",
           "warehouse_id" AS "warehouseId",
           "item_id" AS "itemId",
           "status",
           "base_quantity" AS "baseQuantity"
      FROM "inventory"."inventory_reservations"
     WHERE "id" = ${reservationId}
     FOR UPDATE`;
  const [row] = rows;
  if (row === undefined) return null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    branchId: row.branchId,
    warehouseId: row.warehouseId,
    itemId: row.itemId,
    status: row.status,
    baseQuantity: decimalToString(row.baseQuantity),
  };
}

/**
 * Lock one movement row (reversal path: serializes concurrent reversals of
 * the same original so the "at most one reversal" rule resolves
 * deterministically instead of racing the unique index).
 */
export async function lockMovementRow(
  tx: CoreTxClient,
  movementId: string,
): Promise<{ id: string } | null> {
  const rows = await tx.$queryRaw<{ id: string }>`
    SELECT "id"
      FROM "inventory"."inventory_movements"
     WHERE "id" = ${movementId}
     FOR UPDATE`;
  const [row] = rows;
  return row === undefined ? null : { id: row.id };
}

function toBalance(row: LockedBalanceRow): InventoryBalance {
  return {
    id: row.id,
    organizationId: row.organizationId,
    branchId: row.branchId,
    warehouseId: row.warehouseId,
    itemId: row.itemId,
    onHand: decimalToString(row.onHand),
    reserved: decimalToString(row.reservedQuantity),
    lastMovementAt: row.lastMovementAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
