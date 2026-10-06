/**
 * Valuation compensation — the state fold behind Reverse Pricing
 * (C-59E+, PDR-08 OD-RVP-04…06).
 *
 * Reverse Pricing removes the effect of ONE pricing run on ONE key: the
 * movements that run valued are set back to `unvalued` (OD-RVP-06) and the
 * key's materialized position must then be recomputed from the SURVIVING
 * facts — without repricing anything (repricing is the Pricing Operation's
 * job, and the key is deliberately left `stale`, i.e. "requiring repricing",
 * until one runs).
 *
 * This module owns that fold. It is NOT a replay: a replay recomputes
 * average-derived values; the compensation fold PRESERVES every movement's
 * current value verbatim and only re-derives the position counters. The
 * distinction is the whole point — OD-RVP-05 restores the pre-run condition
 * of the STATE, it does not run the strategy.
 *
 * HOW EACH FACT FOLDS
 *
 *  - a movement WITH a value folds through the strategy itself
 *    (`applyMovement` with the movement's own value as its authority), so
 *    the position math — including the residual flush when a valued pool
 *    empties and the degradation when the pool no longer covers a reversal
 *    — is exactly the posting-time arithmetic, never a second opinion;
 *  - an unvalued INBOUND joins `uncostedQuantity` (the OD-VAL-05 quarantine);
 *  - an unvalued OUTBOUND consumes uncosted stock first, then valued STOCK
 *    without value attribution: the units leave `valuedQuantity` while their
 *    value stays parked in `totalValue` until the next Pricing Operation
 *    re-derives it.
 *
 * THE HONEST IMPERFECTION, AND WHY IT IS ACCEPTABLE
 *
 * That last rule means the fold cannot always keep
 * `SUM(movement.total_cost) == total_value`: an unvalued outbound may have
 * consumed valued stock before the reverse erased the value that covered it.
 * The key is marked STALE by the caller, so no reader may treat the number
 * as final; value is never DESTROYED without a movement (the same
 * conservative direction as OD-VAL-16's residual rule), and the next Pricing
 * Operation re-derives everything deterministically. Invariant (1) —
 * `on_hand == valued_quantity + uncosted_quantity` — the fold keeps exactly,
 * because every fact's quantity is counted once and the quantity ledger is
 * never touched (OD-RVP-04).
 *
 * Framework-free (AR-05): facts in, position out, nothing else.
 */

import type { MovementType } from './movement-type.js';
import type { ValuationSource } from './inventory-valuation.js';
import type { ValuationPosition } from './moving-weighted-average.js';
import { EMPTY_POSITION, applyMovement } from './moving-weighted-average.js';
import {
  addDecimalStrings,
  compareDecimalStrings,
  subtractDecimalStrings,
} from './quantities.js';

/**
 * One movement as the compensation fold sees it: quantity + current value.
 */
export interface CompensationFact {
  movementType: MovementType;
  /** SIGNED base-unit effect (+in / −out), straight off the ledger row. */
  baseQuantity: string;
  /** The movement's CURRENT signed value effect; `null` when unvalued. */
  totalCost: string | null;
  /** The movement's current valuation source, when it carries a value. */
  valuationSource: ValuationSource | null;
}

/**
 * One movement row as the reverse reads it from the database — INCLUDING the
 * stale half of the reverse itself: `reverseRunWithin` reads the key's rows,
 * un-values the ones the original run valued, and then folds FROM THE
 * ALREADY-READ SNAPSHOT (the read happened before the update, by design —
 * re-reading would be a second query for data this transaction just wrote).
 *
 * `toCompensationFacts` is the bridge that makes that snapshot honest: a row
 * whose `valuationRunId` is the run being reversed is the post-update
 * `unvalued` fact it BECOMES in this transaction — its value is passed to the
 * fold as `null`, never as the value the update just erased. Everything else
 * (survivors, previously-reversed rows, never-valued rows) passes through
 * verbatim.
 */
export interface CompensationSnapshotRow {
  movementType: MovementType;
  baseQuantity: string;
  totalCost: string | null;
  valuationSource: ValuationSource | null;
  /**
   * The per-key run that last valued this row, straight off the snapshot.
   * Rows the run being reversed valued carry that run's id — regardless of
   * what the database update in flight is writing onto them.
   */
  valuationRunId: string | null;
}

/**
 * Build the fold's facts from the pre-update snapshot, treating every row the
 * reversed run valued as the unvalued fact it becomes in the same
 * transaction. Pure — the single place the reverse's fold input is derived,
 * so it is unit-testable without a database.
 */
export function toCompensationFacts(
  rows: readonly CompensationSnapshotRow[],
  reversedRunId: string,
): CompensationFact[] {
  return rows.map((row) => {
    const reversedByThisRun = row.valuationRunId === reversedRunId;
    return {
      movementType: row.movementType,
      baseQuantity: row.baseQuantity,
      totalCost: reversedByThisRun ? null : row.totalCost,
      valuationSource: reversedByThisRun ? null : row.valuationSource,
    };
  });
}

function magnitude(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('-') ? trimmed.slice(1) : trimmed;
}

/**
 * Fold the facts in the given (canonical) order, preserving every current
 * value. See the header for the per-fact rules and the honest imperfection.
 */
export function foldPreservedPosition(
  facts: readonly CompensationFact[],
): ValuationPosition {
  let position = EMPTY_POSITION;
  for (const fact of facts) {
    const inbound = !fact.baseQuantity.trim().startsWith('-');
    if (fact.totalCost !== null) {
      // A movement with its own value folds through the strategy itself:
      // same consumption order, same residual flush, same degradation —
      // the movement's value is its authority in both directions.
      const outcome = applyMovement(position, {
        movementType: fact.movementType,
        baseQuantity: fact.baseQuantity,
        knownValue: magnitude(fact.totalCost),
        ...(fact.valuationSource === null
          ? {}
          : { knownValueSource: fact.valuationSource }),
        backdated: false,
      });
      position = outcome.position;
      continue;
    }
    if (inbound) {
      position = {
        ...position,
        uncostedQuantity: addDecimalStrings(
          position.uncostedQuantity,
          magnitude(fact.baseQuantity),
        ),
      };
      continue;
    }
    // Unvalued outbound: uncosted stock first, then valued STOCK with the
    // value parked (see the header — the key is stale, awaiting repricing).
    const quantity = magnitude(fact.baseQuantity);
    const uncostedPart =
      compareDecimalStrings(position.uncostedQuantity, quantity) >= 0
        ? quantity
        : position.uncostedQuantity;
    const fromValued = subtractDecimalStrings(quantity, uncostedPart);
    const uncostedQuantity = subtractDecimalStrings(
      position.uncostedQuantity,
      uncostedPart,
    );
    const valuedPart =
      compareDecimalStrings(position.valuedQuantity, fromValued) >= 0
        ? fromValued
        : position.valuedQuantity;
    position = {
      valuedQuantity: subtractDecimalStrings(
        position.valuedQuantity,
        valuedPart,
      ),
      uncostedQuantity,
      totalValue: position.totalValue,
    };
  }
  return position;
}
