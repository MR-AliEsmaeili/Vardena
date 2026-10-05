/**
 * Valuation state and status — the VALUE projection of the quantity ledger
 * (PDR-05, ADR-0039, D-04/D-06, OQ-24).
 *
 * `inventory_balances` answers "how much is here?". `inventory_valuation_states`
 * answers "what is it worth, and how much of it has no value yet?" for the
 * SAME key — `(organization, warehouse, item)` — because value follows
 * physical stock, and physical stock in this system is warehouse-scoped
 * (`uq_balances_org_warehouse_item`).
 *
 * Both are materialized projections of the one ledger (D-04): the ledger is
 * the truth, the state is a cache maintained inside the same transaction as
 * every movement and rebuildable at any time by replaying the key's
 * movements. Nothing here invents a second ledger.
 *
 * THE LOAD-BEARING INVARIANT
 *
 *     balance.onHand == state.valuedQuantity + state.uncostedQuantity
 *
 * Quantity is never gated by value (OD-VAL-05): a receipt with no cost posts
 * normally and lands in `uncostedQuantity`. That split is what makes
 * "cost-optional warehouse operations" honest — the system can always say
 * exactly how much of the stock it cannot value yet, instead of quietly
 * averaging a zero into the cost.
 *
 * STATUS IS DERIVED, NEVER GUESSED
 *
 * - `pending_cost` — some stock on this key carries no value yet. The number
 *   on screen is the value of the valued part only.
 * - `stale` — a backdated or repriced fact landed out of order and the
 *   operator chose NOT to recalculate (OD-VAL-10/11). The stored value is
 *   honestly labelled inconsistent until an explicit recalculation. This is
 *   deliberately visible, never silently repaired.
 * - `valued` — everything on this key has a value and nothing is pending.
 *
 * `stale` outranks `pending_cost`: an inconsistent number is a worse problem
 * than an incomplete one, and the recalculation command is the fix for it.
 *
 * `averageUnitCost` is DERIVED on read (`totalValue ÷ valuedQuantity`) and
 * never stored: a stored per-unit figure would be a rounded second truth that
 * drifts away from `SUM(total_cost)`.
 *
 * Framework-free (AR-05).
 */

import {
  compareMoney,
  divideToScale,
  UNIT_COST_DISPLAY_DIGITS,
} from './money.js';
import { addDecimalStrings } from './quantities.js';
import type { ValuationMethod } from './valuation-method.js';

/**
 * Per-movement valuation marker stored on the ledger row. It states
 * FINALITY, not completeness:
 *
 *   `unvalued`    — no value at all (`total_cost IS NULL`);
 *   `provisional` — carries a value an explicit recalculation will change
 *                   (derived while the key was backdated or partly
 *                   uncosted); its key is marked stale;
 *   `valued`      — carries its final value.
 */
export const MOVEMENT_VALUATION_STATUSES = [
  'unvalued',
  'provisional',
  'valued',
] as const;
export type MovementValuationStatus =
  (typeof MOVEMENT_VALUATION_STATUSES)[number];

/**
 * Where a movement's value came from. Everything except `average_cost` is a
 * value the fact carries on its own authority and is PRESERVED verbatim by
 * every recalculation; `average_cost` is derived by the Moving Weighted
 * Average strategy and is what a replay recomputes.
 */
export const VALUATION_SOURCES = [
  'entered',
  'average_cost',
  'transfer',
  'reversal',
] as const;
export type ValuationSource = (typeof VALUATION_SOURCES)[number];

/**
 * Why a movement carries no value. Returned by the API and shown in the
 * Inventory Accounting worklist; NOT stored — it is a function of the facts,
 * and storing it would create a field that can contradict them.
 */
export const UNVALUED_REASONS = [
  'no_cost_supplied',
  'uncosted_stock',
  'insufficient_valued_quantity',
] as const;
export type UnvaluedReason = (typeof UNVALUED_REASONS)[number];

export function unvaluedReasonMessage(reason: UnvaluedReason): string {
  switch (reason) {
    case 'no_cost_supplied':
      return 'Posted without a cost. Assign a cost to include this receipt in the inventory value.';
    case 'uncosted_stock':
      return 'The stock this movement consumed has no cost yet, so there is no average cost to value it with.';
    case 'insufficient_valued_quantity':
      return 'No valued stock remained on this item and warehouse when the movement was applied.';
  }
}

/** Key-level status, derived from the state counters. */
export const VALUATION_STATE_STATUSES = [
  'valued',
  'pending_cost',
  'stale',
] as const;
export type ValuationStateStatus = (typeof VALUATION_STATE_STATUSES)[number];

/**
 * The materialized value projection of one `(organization, warehouse, item)`
 * key.
 */
export interface InventoryValuationState {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  method: ValuationMethod;
  /** Base-unit quantity that carries a value. Decimal string, scale 4. */
  valuedQuantity: string;
  /** Base-unit quantity with no value yet. Decimal string, scale 4. */
  uncostedQuantity: string;
  /** Value of `valuedQuantity`. Decimal string, scale 2. */
  totalValue: string;
  status: ValuationStateStatus;
  /** When the key first became inconsistent; `null` when it is not. */
  staleSince: Date | null;
  lastValuedAt: Date | null;
  lastRecalculationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InventoryValuationStateDto {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  method: ValuationMethod;
  valuedQuantity: string;
  uncostedQuantity: string;
  totalValue: string;
  /** `valuedQuantity + uncostedQuantity`; equals the balance's on-hand. */
  totalQuantity: string;
  /** Derived `totalValue ÷ valuedQuantity`; `null` when nothing is valued. */
  averageUnitCost: string | null;
  status: ValuationStateStatus;
  staleSince: string | null;
  lastValuedAt: string | null;
  lastRecalculationId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Status from the counters. Precedence: stale > pending_cost > valued.
 *
 * A key with nothing in it (no stock, no value) is `valued`, not
 * `pending_cost`: there is nothing left to cost.
 */
export function resolveValuationStatus(params: {
  uncostedQuantity: string;
  staleSince: Date | null;
}): ValuationStateStatus {
  if (params.staleSince !== null) return 'stale';
  if (compareMoney(params.uncostedQuantity, '0') !== 0) return 'pending_cost';
  return 'valued';
}

/** `totalValue ÷ valuedQuantity`, rounded for display; `null` at zero. */
export function averageUnitCost(state: {
  totalValue: string;
  valuedQuantity: string;
}): string | null {
  if (compareMoney(state.valuedQuantity, '0') === 0) return null;
  return divideToScale(
    state.totalValue,
    state.valuedQuantity,
    UNIT_COST_DISPLAY_DIGITS,
  );
}

export function toInventoryValuationStateDto(
  state: InventoryValuationState,
): InventoryValuationStateDto {
  return {
    id: state.id,
    organizationId: state.organizationId,
    branchId: state.branchId,
    warehouseId: state.warehouseId,
    itemId: state.itemId,
    method: state.method,
    valuedQuantity: state.valuedQuantity,
    uncostedQuantity: state.uncostedQuantity,
    totalValue: state.totalValue,
    totalQuantity: addDecimalStrings(
      state.valuedQuantity,
      state.uncostedQuantity,
    ),
    averageUnitCost: averageUnitCost(state),
    status: state.status,
    staleSince: state.staleSince?.toISOString() ?? null,
    lastValuedAt: state.lastValuedAt?.toISOString() ?? null,
    lastRecalculationId: state.lastRecalculationId,
    createdAt: state.createdAt.toISOString(),
    updatedAt: state.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Valuation runs (the audit record of an explicit repricing command)
// ---------------------------------------------------------------------------

/** What asked for a recalculation. Only explicit commands exist (OD-VAL-11). */
export const VALUATION_RUN_TRIGGERS = [
  'backdated_document',
  'cost_assignment',
  'manual',
] as const;
export type ValuationRunTrigger = (typeof VALUATION_RUN_TRIGGERS)[number];

export interface InventoryValuationRun {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  method: ValuationMethod;
  trigger: ValuationRunTrigger;
  /** Informational lower bound the caller asked for; `null` = whole key. */
  fromDate: Date | null;
  movementsExamined: number;
  movementsRevalued: number;
  resultingValuedQuantity: string;
  resultingUncostedQuantity: string;
  resultingTotalValue: string;
  resultingStatus: ValuationStateStatus;
  operationKey: string;
  reason: string | null;
  executedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface InventoryValuationRunDto {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  method: ValuationMethod;
  trigger: ValuationRunTrigger;
  fromDate: string | null;
  movementsExamined: number;
  movementsRevalued: number;
  resultingValuedQuantity: string;
  resultingUncostedQuantity: string;
  resultingTotalValue: string;
  resultingStatus: ValuationStateStatus;
  operationKey: string;
  reason: string | null;
  executedAt: string;
  createdAt: string;
  updatedAt: string;
}

export function toInventoryValuationRunDto(
  run: InventoryValuationRun,
): InventoryValuationRunDto {
  return {
    id: run.id,
    organizationId: run.organizationId,
    branchId: run.branchId,
    warehouseId: run.warehouseId,
    itemId: run.itemId,
    method: run.method,
    trigger: run.trigger,
    fromDate: run.fromDate?.toISOString() ?? null,
    movementsExamined: run.movementsExamined,
    movementsRevalued: run.movementsRevalued,
    resultingValuedQuantity: run.resultingValuedQuantity,
    resultingUncostedQuantity: run.resultingUncostedQuantity,
    resultingTotalValue: run.resultingTotalValue,
    resultingStatus: run.resultingStatus,
    operationKey: run.operationKey,
    reason: run.reason,
    executedAt: run.executedAt.toISOString(),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}
