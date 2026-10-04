/**
 * In-transaction valuation writes (PDR-05, ADR-0039).
 *
 * The posting paths in `inventory-movements.repository.ts` own the
 * transaction and the lock order; this file owns what happens to the VALUE
 * inside it, so the quantity ledger keeps reading as a quantity ledger and
 * the valuation rules live in one reviewable place.
 *
 * Shape of every call: the caller has ALREADY locked the valuation state row
 * (`lockValuationStateRow`, the last lock tier) and has ALREADY decided the
 * quantity question against the locked balance. These helpers then
 *
 *   1. run the pure strategy on the locked position (no I/O in the rules),
 *   2. write the complete resulting position back as an absolute update, and
 *   3. hand the caller the valuation columns to put on the movement row.
 *
 * Nothing here reads the clock or generates ids beyond what the caller
 * passes, so the same inputs always produce the same rows.
 */

import type {
  InventoryValuationState,
  MovementValuationStatus,
  ValuationSource,
} from '../domain/inventory-valuation.js';
import { resolveValuationStatus } from '../domain/inventory-valuation.js';
import type {
  MovementValuation,
  ValuationPosition,
} from '../domain/moving-weighted-average.js';
import {
  applyMovement,
  applyTransfer,
} from '../domain/moving-weighted-average.js';
import type { MovementType } from '../domain/movement-type.js';
import type { ValuationMethod } from '../domain/valuation-method.js';
import type {
  CoreTxClient,
  ValuationStateUpdate,
} from './inventory-core-rows.js';

/** The valuation columns written onto a movement row. */
export interface MovementValuationColumns {
  totalCost: string | null;
  valuationStatus: MovementValuationStatus;
  valuationSource: ValuationSource | null;
  valuedAt: Date | null;
  valuationRunId: string | null;
}

export function toMovementColumns(
  valuation: MovementValuation,
  valuedAt: Date,
): MovementValuationColumns {
  return {
    totalCost: valuation.totalCost,
    valuationStatus: valuation.status,
    valuationSource: valuation.source,
    valuedAt: valuation.status === 'unvalued' ? null : valuedAt,
    valuationRunId: null,
  };
}

/** The valuation columns a movement that was never valued carries. */
export const UNVALUED_COLUMNS: MovementValuationColumns = {
  totalCost: null,
  valuationStatus: 'unvalued',
  valuationSource: null,
  valuedAt: null,
  valuationRunId: null,
};

export function positionOf(state: InventoryValuationState): ValuationPosition {
  return {
    valuedQuantity: state.valuedQuantity,
    uncostedQuantity: state.uncostedQuantity,
    totalValue: state.totalValue,
  };
}

/**
 * Write a complete position back to a LOCKED state row.
 *
 * `staleSince` is sticky: a key that is already inconsistent stays
 * inconsistent (keeping the instant it first became so) until an explicit
 * recalculation clears it. A later movement never silently "repairs" the
 * flag, because the values it was computed from are still the wrong ones.
 */
export async function writeValuationState(
  tx: CoreTxClient,
  input: {
    state: InventoryValuationState;
    position: ValuationPosition;
    method: ValuationMethod;
    marksStale: boolean;
    at: Date;
    actorId: string | null;
    /** Set by a recalculation; left as-is otherwise. */
    recalculationId?: string | null;
    /** A recalculation clears staleness; a posting never does. */
    clearStale?: boolean;
  },
): Promise<void> {
  const clearStale = input.clearStale === true;
  const staleSince = clearStale
    ? input.marksStale
      ? input.at
      : null
    : (input.state.staleSince ?? (input.marksStale ? input.at : null));

  const data: ValuationStateUpdate = {
    method: input.method,
    valuedQuantity: input.position.valuedQuantity,
    uncostedQuantity: input.position.uncostedQuantity,
    totalValue: input.position.totalValue,
    status: resolveValuationStatus({
      uncostedQuantity: input.position.uncostedQuantity,
      staleSince,
    }),
    staleSince,
    lastValuedAt: input.at,
    lastRecalculationId:
      input.recalculationId === undefined
        ? input.state.lastRecalculationId
        : input.recalculationId,
    updatedAt: input.at,
    updatedBy: input.actorId,
  };
  await tx.inventoryValuationState.update({
    where: { id: input.state.id },
    data,
  });
}

/**
 * Value ONE movement against a locked state and persist the new position.
 * Returns the columns to write onto the movement row.
 */
export async function valueMovement(
  tx: CoreTxClient,
  input: {
    state: InventoryValuationState;
    method: ValuationMethod;
    movementType: MovementType;
    baseQuantity: string;
    knownValue: string | null;
    knownValueSource?: ValuationSource | undefined;
    backdated: boolean;
    at: Date;
    actorId: string | null;
  },
): Promise<MovementValuationColumns> {
  const outcome = applyMovement(positionOf(input.state), {
    movementType: input.movementType,
    baseQuantity: input.baseQuantity,
    knownValue: input.knownValue,
    ...(input.knownValueSource === undefined
      ? {}
      : { knownValueSource: input.knownValueSource }),
    backdated: input.backdated,
  });
  await writeValuationState(tx, {
    state: input.state,
    position: outcome.position,
    method: input.method,
    marksStale: outcome.marksStale,
    at: input.at,
    actorId: input.actorId,
  });
  return toMovementColumns(outcome.valuation, input.at);
}

/**
 * Value a transfer PAIR against two locked states. The pair is exactly
 * value-neutral, so both legs and both states are written from one call —
 * there is no code path that could update one side without the other.
 */
export async function valueTransfer(
  tx: CoreTxClient,
  input: {
    sourceState: InventoryValuationState;
    destinationState: InventoryValuationState;
    method: ValuationMethod;
    /** Positive base-unit magnitude moved. */
    quantity: string;
    at: Date;
    actorId: string | null;
  },
): Promise<{
  out: MovementValuationColumns;
  in: MovementValuationColumns;
}> {
  const outcome = applyTransfer({
    source: positionOf(input.sourceState),
    destination: positionOf(input.destinationState),
    quantity: input.quantity,
  });
  await writeValuationState(tx, {
    state: input.sourceState,
    position: outcome.source,
    method: input.method,
    marksStale: outcome.marksStale,
    at: input.at,
    actorId: input.actorId,
  });
  await writeValuationState(tx, {
    state: input.destinationState,
    position: outcome.destination,
    method: input.method,
    marksStale: outcome.marksStale,
    at: input.at,
    actorId: input.actorId,
  });
  return {
    out: toMovementColumns(outcome.outValuation, input.at),
    in: toMovementColumns(outcome.inValuation, input.at),
  };
}
