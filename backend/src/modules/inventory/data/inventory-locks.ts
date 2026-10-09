import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import type { InventoryBalance } from '../domain/inventory-balance.js';
import { isValuationMethod } from '../domain/valuation-method.js';
import type { ValuationMethod } from '../domain/valuation-method.js';
import { VALUATION_STATE_STATUSES } from '../domain/inventory-valuation.js';
import type {
  InventoryValuationState,
  ValuationStateStatus,
} from '../domain/inventory-valuation.js';
import type {
  BalanceCreate,
  BalanceKey,
  CoreTxClient,
  DecimalLike,
  ValuationStateCreate,
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
 * Lock ORDER is fixed wherever several rows are needed, and no deadlock
 * cycle exists. The global order is:
 *
 *     entity row (reservation / original movement)
 *   → balance row(s)
 *   → valuation state row(s)
 *
 * with the two-row paths (transfers) always ascending by warehouse id within
 * each tier. So no transaction holding a later-tier lock ever waits on an
 * earlier-tier one, and no two transactions ever take two rows of the same
 * tier in opposite orders.
 *
 * Valuation last is deliberate: a posting must decide the QUANTITY question
 * (is there enough stock?) against the locked balance before it touches
 * value, and a recalculation — which never changes quantity — takes ONLY the
 * valuation lock, so repricing one key can never block a receipt on another.
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
  lastMovementDate: Date | null;
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
             "last_movement_date" AS "lastMovementDate",
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
      lastMovementDate: null,
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
          lastMovementDate: created.lastMovementDate,
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
 * Apply exact counter deltas to a LOCKED balance row. `lastMovementDate` is the
 * already-computed new maximum (or the unchanged value for reservation-only
 * operations) — the comparison happens in TypeScript, the write here.
 */
export async function adjustBalanceCounters(
  tx: CoreTxClient,
  input: {
    balanceId: string;
    onHandDelta: string;
    reservedDelta: string;
    lastMovementDate: Date | null;
    updatedAt: Date;
    updatedBy: string | null;
  },
): Promise<void> {
  await tx.$queryRaw<never>`
    UPDATE "inventory"."inventory_balances"
       SET "on_hand" = "on_hand" + ${input.onHandDelta}::numeric,
           "reserved_quantity" = "reserved_quantity" + ${input.reservedDelta}::numeric,
           "last_movement_date" = ${input.lastMovementDate}::date,
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
    lastMovementDate: Date | null;
    updatedAt: Date;
    updatedBy: string | null;
  },
): Promise<void> {
  await tx.$queryRaw<never>`
    UPDATE "inventory"."inventory_balances"
       SET "on_hand" = ${input.onHand}::numeric,
           "reserved_quantity" = ${input.reserved}::numeric,
           "last_movement_date" = ${input.lastMovementDate}::date,
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
  /** Entered-unit remaining magnitude (the reservation's own `unitId`). */
  quantity: string;
  baseQuantity: string;
} | null> {
  const rows = await tx.$queryRaw<{
    id: string;
    organizationId: string;
    branchId: string;
    warehouseId: string;
    itemId: string;
    status: string;
    quantity: DecimalLike;
    baseQuantity: DecimalLike;
  }>`
    SELECT "id",
           "organization_id" AS "organizationId",
           "branch_id" AS "branchId",
           "warehouse_id" AS "warehouseId",
           "item_id" AS "itemId",
           "status",
           "quantity",
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
    quantity: decimalToString(row.quantity),
    baseQuantity: decimalToString(row.baseQuantity),
  };
}

/**
 * Lock one movement row (reversal path: serializes concurrent reversals of
 * the same original so the "at most one reversal" rule resolves
 * deterministically instead of racing the unique index).
 *
 * The locked row also yields the original's valuation, because a reversal
 * undoes the value the original actually carried (PDR-05 rule 7) and reading
 * it from the LOCKED row is what keeps that exact: a concurrent
 * recalculation of the same key cannot change the number between the read
 * and the write.
 */
export async function lockMovementRow(
  tx: CoreTxClient,
  movementId: string,
): Promise<{
  id: string;
  totalCost: string | null;
  valuationStatus: string;
  valuationSource: string | null;
  /**
   * C-59D: the basis quantity a return is bounded by (the over-return
   * guard). Signed like the stored row; a basis receipt is positive.
   */
  baseQuantity: string;
} | null> {
  const rows = await tx.$queryRaw<{
    id: string;
    totalCost: DecimalLike | null;
    valuationStatus: string;
    valuationSource: string | null;
    baseQuantity: DecimalLike;
  }>`
    SELECT "id",
           "total_cost" AS "totalCost",
           "valuation_status" AS "valuationStatus",
           "valuation_source" AS "valuationSource",
           "base_quantity" AS "baseQuantity"
      FROM "inventory"."inventory_movements"
     WHERE "id" = ${movementId}
     FOR UPDATE`;
  const [row] = rows;
  if (row === undefined) return null;
  return {
    id: row.id,
    totalCost: row.totalCost === null ? null : decimalToString(row.totalCost),
    valuationStatus: row.valuationStatus,
    valuationSource: row.valuationSource,
    baseQuantity: decimalToString(row.baseQuantity),
  };
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
    lastMovementDate: row.lastMovementDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** A locked valuation state row, mapped from its aliased columns. */
interface LockedValuationStateRow {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  method: string;
  valuedQuantity: DecimalLike;
  uncostedQuantity: DecimalLike;
  totalValue: DecimalLike;
  status: string;
  staleSince: Date | null;
  lastValuedAt: Date | null;
  lastRecalculationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Lock the valuation state row for a key, creating the zero row when the key
 * has never been valued (PDR-05).
 *
 * Same create-race handling as `lockBalanceRow`: two concurrent first
 * postings both miss the SELECT, the loser catches the unique violation and
 * re-selects the winner's row. The zero row is created with the method the
 * CALLER resolved for this posting, so a key's state always records which
 * strategy produced its numbers instead of assuming the current default.
 *
 * `status` is written as `valued` on creation because an empty key has
 * nothing uncosted and nothing stale; the first movement immediately
 * overwrites it with the derived status.
 */
export async function lockValuationStateRow(
  tx: CoreTxClient,
  key: BalanceKey,
  method: ValuationMethod,
  actorId: string | null,
): Promise<{ state: InventoryValuationState; created: boolean }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await tx.$queryRaw<LockedValuationStateRow>`
      SELECT "id",
             "organization_id" AS "organizationId",
             "branch_id" AS "branchId",
             "warehouse_id" AS "warehouseId",
             "item_id" AS "itemId",
             "method",
             "valued_quantity" AS "valuedQuantity",
             "uncosted_quantity" AS "uncostedQuantity",
             "total_value" AS "totalValue",
             "status",
             "stale_since" AS "staleSince",
             "last_valued_at" AS "lastValuedAt",
             "last_recalculation_id" AS "lastRecalculationId",
             "created_at" AS "createdAt",
             "updated_at" AS "updatedAt"
        FROM "inventory"."inventory_valuation_states"
       WHERE "organization_id" = ${key.organizationId}
         AND "warehouse_id" = ${key.warehouseId}
         AND "item_id" = ${key.itemId}
       FOR UPDATE`;
    const [row] = existing;
    if (row !== undefined) {
      return { state: toValuationState(row), created: false };
    }

    const now = new Date();
    const create: ValuationStateCreate = {
      id: generateId(),
      organizationId: key.organizationId,
      branchId: key.branchId,
      warehouseId: key.warehouseId,
      itemId: key.itemId,
      method,
      valuedQuantity: '0',
      uncostedQuantity: '0',
      totalValue: '0',
      status: 'valued',
      staleSince: null,
      lastValuedAt: null,
      lastRecalculationId: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actorId,
    };
    try {
      const created = await tx.inventoryValuationState.create({ data: create });
      return { state: toValuationState(created), created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Lost the creation race — loop around and lock the winner's row.
    }
  }
  throw new Error(
    'Could not lock the inventory valuation state row: too many concurrent writers for one key.',
  );
}

/**
 * The two transfer keys in the fixed valuation locking order (ascending
 * warehouse id), so a transfer and its mirror image can never deadlock.
 */
export function orderValuationKeys<T extends { warehouseId: string }>(
  first: T,
  second: T,
): [T, T] {
  return first.warehouseId.localeCompare(second.warehouseId) <= 0
    ? [first, second]
    : [second, first];
}

function toMethod(id: string, value: string): ValuationMethod {
  if (!isValuationMethod(value)) {
    throw new Error(
      `Stored valuation state "${id}" has an unknown method "${value}".`,
    );
  }
  return value;
}

function toStatus(id: string, value: string): ValuationStateStatus {
  if (!(VALUATION_STATE_STATUSES as readonly string[]).includes(value)) {
    throw new Error(
      `Stored valuation state "${id}" has an unknown status "${value}".`,
    );
  }
  return value as ValuationStateStatus;
}

function toValuationState(
  row: LockedValuationStateRow,
): InventoryValuationState {
  return {
    id: row.id,
    organizationId: row.organizationId,
    branchId: row.branchId,
    warehouseId: row.warehouseId,
    itemId: row.itemId,
    method: toMethod(row.id, row.method),
    valuedQuantity: decimalToString(row.valuedQuantity),
    uncostedQuantity: decimalToString(row.uncostedQuantity),
    totalValue: decimalToString(row.totalValue),
    status: toStatus(row.id, row.status),
    staleSince: row.staleSince,
    lastValuedAt: row.lastValuedAt,
    lastRecalculationId: row.lastRecalculationId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Lock SEVERAL valuation-state rows in the module's fixed multi-key order:
 * ascending `(warehouse_id, item_id)`. This is the N-key extension of the
 * transfer tier rule ("ascending warehouse id within each tier") and it is
 * the ONE order every multi-key writer must use — the C-59E Pricing batch,
 * Reverse Pricing, and the hardened Accounting Post all lock through here,
 * so any two of them serialize instead of deadlocking.
 *
 * `method` is only used to create a zero row for a key that has none yet
 * (same contract as {@link lockValuationStateRow}); callers that know the
 * keys exist pass the resolved method anyway — no behavior difference.
 */
export async function lockValuationStateRowsInOrder(
  tx: CoreTxClient,
  entries: readonly { key: BalanceKey; method: ValuationMethod }[],
  actorId: string | null,
): Promise<InventoryValuationState[]> {
  const ordered = [...entries].sort((left, right) => {
    const byWarehouse = left.key.warehouseId.localeCompare(
      right.key.warehouseId,
    );
    if (byWarehouse !== 0) return byWarehouse;
    return left.key.itemId.localeCompare(right.key.itemId);
  });
  const states: InventoryValuationState[] = [];
  for (const entry of ordered) {
    const { state } = await lockValuationStateRow(
      tx,
      entry.key,
      entry.method,
      actorId,
    );
    states.push(state);
  }
  return states;
}
