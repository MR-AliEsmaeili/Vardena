/**
 * Moving Weighted Average — the only valuation strategy this MVP executes
 * (PDR-05 OD-VAL-02, OQ-24).
 *
 * Pure functions of (current position, one movement fact) → (next position,
 * what that movement is worth). No I/O, no clock, no ids, no framework
 * (AR-05): the caller supplies every input, so the same facts always produce
 * the same numbers — which is what makes `replay()` a trustworthy
 * recalculation and lets the whole strategy be unit-tested without a
 * database.
 *
 * TWO INVARIANTS THIS FILE EXISTS TO PROTECT
 *
 *   (1) quantity:  onHand == valuedQuantity + uncostedQuantity
 *   (2) value:     SUM(movement.totalCost) == totalValue
 *
 * (1) is what makes "cost-optional warehouse operations" honest: a receipt
 * posted with no cost (OD-VAL-05) lands in `uncostedQuantity`, so the system
 * can always say exactly how much stock it cannot value yet instead of
 * quietly averaging a zero into the cost.
 *
 * (2) is what makes the ledger the single source of truth for value, exactly
 * as it already is for quantity (D-04): every change to `totalValue` is
 * attributed to a movement row. A branch that removed value from the pool
 * without writing it onto a movement would turn the state into a second,
 * unverifiable truth — so no branch does.
 *
 * MOVEMENT STATUS MEANS FINALITY, NOT COMPLETENESS
 *
 *   `valued`      — the row carries its final value.
 *   `provisional` — the row carries a value an explicit recalculation will
 *                   change (it was derived while the key was backdated or
 *                   partly uncosted). The key is marked STALE so the number
 *                   is labelled inconsistent until someone decides to
 *                   reprice (OD-VAL-10/11 — never a silent recalculation).
 *   `unvalued`    — the row carries no value at all (`totalCost IS NULL`).
 *
 * THE RULES
 *
 * 1. **Inbound with a cost is always valued**, even backdated: adding value
 *    to a pool is commutative, so order does not change the result. It still
 *    marks the key stale, because the ISSUES that happened after its date
 *    were valued at the old average and only a recalculation fixes those.
 *
 * 2. **Inbound without a cost is not an error** — it is the normal warehouse
 *    receipt. The stock joins `uncostedQuantity`; it is never valued at zero,
 *    which would silently drag the average down and understate the inventory.
 *
 * 3. **An issue is valued at the average only when the average is
 *    meaningful.** Any uncosted stock on the key means part of the pool has
 *    an unknown cost, so the issue consumes the uncosted quantity first and
 *    is not final. This is the point of the uncosted counter: it quarantines
 *    the unknown instead of spreading it.
 *
 * 4. **A backdated issue is never final.** Its value depends on the average
 *    AT ITS DATE, which today's state cannot reconstruct. It takes a
 *    provisional value (so invariant 2 holds) and marks the key stale; the
 *    explicit recalculation command is what finalises it.
 *
 * 5. **The last issue flushes the residual.** An issue that takes the valued
 *    quantity to exactly zero is assigned the ENTIRE remaining value, not
 *    `round(avg × qty)`, so rounding residue can never survive with no stock
 *    behind it. Zero quantity ⇒ zero value, always.
 *
 * 6. **A transfer moves value with the stock.** The pair is exactly
 *    value-neutral: whatever leaves the source arrives at the destination,
 *    and the uncosted part of the quantity stays uncosted on the other side.
 *    A transfer therefore cannot create or destroy inventory value — the
 *    failure mode a quantity-only transfer would have introduced the moment
 *    this state table existed. Which warehouse's average a transfer uses when
 *    the two differ was OQ-67, decided 2026-10-06 (PDR-08 OD-TRF-01…03,
 *    source-side valuation); moving the source's own value is what conserves
 *    it, and the destination's divergence afterwards is intended.
 *
 * 7. **A reversal undoes the original's value exactly.** Not the current
 *    average: a correction must leave the pool as if the original had never
 *    been posted. If the original was unvalued, so is the reversal.
 *
 * 8. **Negative stock is impossible here.** Sufficiency is enforced against
 *    the locked balance row before this module is reached (D-07); the
 *    strategy never values stock that is not there. It still fails closed on
 *    an inconsistent position rather than producing a negative quantity.
 *
 * 9. **A sales return re-enters at the CURRENT average — never at the sales
 *    price** (C-59D, OD-RET-05/06). An inbound `sales_return` with no value
 *    of its own is valued at `total_value × quantity ÷ valued_quantity` (one
 *    division, one sanctioned rounding), so by construction the average is
 *    unchanged: the goods come back at what they cost, not at what they were
 *    sold for. A manual amount supplied with a basis on the original issue is
 *    an ordinary Manual Price (rule 1). The rule NEVER invents an average:
 *    with no valued pool the return is unvalued (`insufficient_valued_quantity`),
 *    and the document layer refuses the operation up front (OD-RET-07 cold
 *    start). It is PROVISIONAL when the fact is backdated or uncosted stock
 *    sits on the key — a later repricing changes what "current" means, and a
 *    later cost assignment can move the average the return was valued at.
 */

import {
  addMoney,
  divideToScale,
  multiplyMoney,
  negateMoney,
  roundToMoneyScale,
  subtractMoney,
} from './money.js';
import type { MovementType } from './movement-type.js';
import {
  addDecimalStrings,
  compareDecimalStrings,
  subtractDecimalStrings,
} from './quantities.js';
import type {
  MovementValuationStatus,
  UnvaluedReason,
  ValuationSource,
} from './inventory-valuation.js';

/**
 * The part of the valuation state this strategy reads and writes. A narrow
 * structural type, not the persisted row: the pure core must not depend on
 * ids, timestamps or audit columns.
 */
export interface ValuationPosition {
  /** Base-unit quantity carrying a value. Decimal string, scale 4. */
  valuedQuantity: string;
  /** Base-unit quantity with no value yet. Decimal string, scale 4. */
  uncostedQuantity: string;
  /** Value of `valuedQuantity`. Decimal string, scale 2. */
  totalValue: string;
}

export const EMPTY_POSITION: ValuationPosition = {
  valuedQuantity: '0',
  uncostedQuantity: '0',
  totalValue: '0',
};

/**
 * One movement as the strategy sees it.
 *
 * `baseQuantity` is the SIGNED base-unit effect straight off the ledger row
 * (+in / −out, never 0), so the strategy never re-derives a direction the
 * movement type already fixed.
 *
 * `knownValue` is the positive total value this fact carries on its own
 * authority — a cost a human entered on a receipt, the value a transfer leg
 * moved, or the value a reversal undoes — or `null` when the fact has none
 * and the average must supply it. It is the ONLY value input: an
 * average-derived value is never fed back in, which is what makes a replay
 * reproduce identical numbers instead of compounding its own rounding.
 */
export interface ValuationFact {
  movementType: MovementType;
  baseQuantity: string;
  knownValue: string | null;
  /** Source to record when `knownValue` is used. Defaults to `entered`. */
  knownValueSource?: ValuationSource | undefined;
  /** True when this fact is dated before the key's latest movement. */
  backdated?: boolean | undefined;
  /**
   * C-59D (OD-RET-02/04): a basis-linked purchase return whose receipt
   * basis carries NO value. The goods still leave (quantities always
   * move), but the exit carries no value and NEVER derives one from the
   * average — the return exits at "the price they were purchased", and
   * that price was never assigned. Deterministic in replay: the movement
   * row records `valuation_source = 'return_basis'` with a NULL value, so
   * a recalculation rebuilds the same fact (see `toReplayFact`).
   */
  forceUnvalued?: boolean | undefined;
}

/** What one movement is worth, as written onto its ledger row. */
export interface MovementValuation {
  status: MovementValuationStatus;
  /** SIGNED value effect mirroring `baseQuantity`; `null` when unvalued. */
  totalCost: string | null;
  source: ValuationSource | null;
  /** Populated exactly when `status === 'unvalued'`. */
  unvaluedReason: UnvaluedReason | null;
}

export interface ValuationOutcome {
  position: ValuationPosition;
  valuation: MovementValuation;
  /**
   * True when this fact leaves the key's stored value inconsistent — i.e. it
   * produced a provisional value. The CALLER decides what to do: mark the
   * key stale, or ask the operator to run an explicit recalculation. The
   * strategy never recalculates on its own.
   */
  marksStale: boolean;
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function unvalued(
  reason: UnvaluedReason,
  /**
   * Set ONLY by the basis-linked unvalued purchase return (OD-RET-02/04):
   * the row records `return_basis` so a replay can tell "no value because
   * the basis had none" (stays unvalued, `forceUnvalued`) from "no basis,
   * derive from the average" (`source: null`).
   */
  source: ValuationSource | null = null,
): MovementValuation {
  return {
    status: 'unvalued',
    totalCost: null,
    source,
    unvaluedReason: reason,
  };
}

function settled(
  status: 'valued' | 'provisional',
  totalCost: string,
  source: ValuationSource,
): MovementValuation {
  return { status, totalCost, source, unvaluedReason: null };
}

function increasesStock(baseQuantity: string): boolean {
  return !baseQuantity.trim().startsWith('-');
}

/** `|baseQuantity|` — the magnitude the counters move by. */
function magnitude(baseQuantity: string): string {
  const trimmed = baseQuantity.trim();
  return trimmed.startsWith('-') ? trimmed.slice(1) : trimmed;
}

function isZero(value: string): boolean {
  return compareDecimalStrings(value, '0') === 0;
}

/**
 * `totalValue × quantity ÷ valuedQuantity` as ONE division of the exact
 * product, so only a single rounding happens downstream. Multiplying by a
 * pre-rounded unit cost would round twice and drift away from invariant (2).
 *
 * The working scale (6) is two digits wider than the quantity scale, enough
 * for the caller's half-up rounding to scale 2 to be decided correctly.
 */
function shareOfValue(position: ValuationPosition, quantity: string): string {
  const WORKING_SCALE = 6;
  const share = divideToScale(
    multiplyMoney(position.totalValue, quantity),
    position.valuedQuantity,
    WORKING_SCALE,
  );
  if (share === null) {
    // Unreachable: every caller establishes a non-zero valued quantity
    // first. Fail loudly rather than fabricate a zero value.
    throw new Error(
      'Cannot derive an average cost from a zero valued quantity.',
    );
  }
  return roundToMoneyScale(share);
}

/**
 * Take `quantity` out of a position, uncosted stock first.
 *
 * Returns the quantity split and the value that left with the valued part —
 * the caller MUST attribute that value to a movement row, or invariant (2)
 * breaks. Rule 5 (residual flush) lives here: emptying the valued pool takes
 * all of its remaining value.
 */
interface Consumption {
  position: ValuationPosition;
  uncostedPart: string;
  valuedPart: string;
  removedValue: string;
}

function consume(position: ValuationPosition, quantity: string): Consumption {
  const uncostedPart =
    compareDecimalStrings(position.uncostedQuantity, quantity) >= 0
      ? quantity
      : position.uncostedQuantity;
  const requested = subtractDecimalStrings(quantity, uncostedPart);
  const uncostedQuantity = subtractDecimalStrings(
    position.uncostedQuantity,
    uncostedPart,
  );

  if (isZero(requested)) {
    return {
      position: { ...position, uncostedQuantity },
      uncostedPart,
      valuedPart: '0',
      removedValue: '0',
    };
  }

  // The valued pool covers the remainder, or is emptied by it. Capping at
  // the pool size cannot hide a negative stock posting: sufficiency was
  // already checked against the locked balance row.
  const closesPool =
    compareDecimalStrings(position.valuedQuantity, requested) <= 0;
  const valuedPart = closesPool ? position.valuedQuantity : requested;
  const removedValue = closesPool
    ? position.totalValue
    : shareOfValue(position, requested);

  return {
    position: {
      valuedQuantity: subtractDecimalStrings(
        position.valuedQuantity,
        valuedPart,
      ),
      uncostedQuantity,
      totalValue: subtractMoney(position.totalValue, removedValue),
    },
    uncostedPart,
    valuedPart,
    removedValue,
  };
}

/**
 * Would an outbound fact with NO value of its own take value out of the
 * valued pool at this position? Exposed for the replay driver's transfer-leg
 * guard (`valuation-replay.ts`): an unvalued `transfer_out` leg that would
 * consume valued stock must be REFUSED rather than silently valued on one
 * side of the pair only.
 */
export function outboundConsumesValuedStock(
  position: ValuationPosition,
  quantity: string,
): boolean {
  return !isZero(consume(position, quantity).valuedPart);
}

// ---------------------------------------------------------------------------
// Single-key movements
// ---------------------------------------------------------------------------

/**
 * Apply one movement to one key's position.
 *
 * Total by construction: every direction and every combination of
 * (known value?, uncosted stock present?, backdated?) resolves to exactly one
 * branch, and each branch either values the movement or names the reason it
 * could not. There is no "unknown" outcome and no silent pass-through.
 */
export function applyMovement(
  position: ValuationPosition,
  fact: ValuationFact,
): ValuationOutcome {
  const quantity = magnitude(fact.baseQuantity);
  const backdated = fact.backdated === true;
  const source: ValuationSource = fact.knownValueSource ?? 'entered';

  // --- inbound direction ---------------------------------------------------
  if (increasesStock(fact.baseQuantity)) {
    if (fact.knownValue === null) {
      // Rule 9: a sales return without its own amount re-enters at the
      // CURRENT average — inventory cost, never the sales price, and never
      // an invented one (OD-RET-05/06/07).
      if (fact.movementType === 'sales_return') {
        if (isZero(position.valuedQuantity)) {
          // No valued pool to derive a cost from. The document layer refuses
          // this before posting (OD-RET-07); the strategy still degrades
          // honestly rather than inventing an average or valuing at zero.
          return {
            position: {
              ...position,
              uncostedQuantity: addDecimalStrings(
                position.uncostedQuantity,
                quantity,
              ),
            },
            valuation: unvalued('insufficient_valued_quantity'),
            marksStale: false,
          };
        }
        const value = shareOfValue(position, quantity);
        const provisional = backdated || !isZero(position.uncostedQuantity);
        return {
          position: {
            valuedQuantity: addDecimalStrings(
              position.valuedQuantity,
              quantity,
            ),
            uncostedQuantity: position.uncostedQuantity,
            totalValue: addMoney(position.totalValue, value),
          },
          valuation: settled(
            provisional ? 'provisional' : 'valued',
            value,
            'average_cost',
          ),
          marksStale: provisional,
        };
      }
      // Rule 2: a receipt with no cost is normal, not an error.
      return {
        position: {
          ...position,
          uncostedQuantity: addDecimalStrings(
            position.uncostedQuantity,
            quantity,
          ),
        },
        valuation: unvalued('no_cost_supplied'),
        marksStale: false,
      };
    }
    // Rule 1: value is order-independent on the way in, so a backdated
    // costed receipt is applied — but the issues after its date are now
    // wrong, so the key is stale until an explicit recalculation.
    const value = roundToMoneyScale(fact.knownValue);
    return {
      position: {
        valuedQuantity: addDecimalStrings(position.valuedQuantity, quantity),
        uncostedQuantity: position.uncostedQuantity,
        totalValue: addMoney(position.totalValue, value),
      },
      valuation: settled('valued', value, source),
      marksStale: backdated,
    };
  }

  // --- outbound direction forced to carry no value (OD-RET-02/04) -----------
  if (fact.forceUnvalued === true) {
    // Consume exactly like any other outbound (quantities are the source of
    // truth), but record no value and derive none. If the pool's valued
    // quantity is consumed while its value stays, the key is honestly
    // inconsistent and flagged — the same degradation rule 7 uses, never a
    // silent average and never zero.
    const consumed = consume(position, quantity);
    return {
      position: consumed.position,
      valuation: unvalued('no_cost_supplied', 'return_basis'),
      marksStale: !isZero(consumed.valuedPart),
    };
  }

  // --- outbound direction with a value of its own (rule 7: reversals) ------
  if (fact.knownValue !== null) {
    if (compareDecimalStrings(position.valuedQuantity, quantity) < 0) {
      // The pool no longer holds what the original put in (later issues
      // already consumed it). Undo what can be undone and flag the key
      // rather than invent a negative valued quantity.
      const consumed = consume(position, quantity);
      if (isZero(consumed.removedValue)) {
        return {
          position: consumed.position,
          valuation: unvalued('insufficient_valued_quantity'),
          marksStale: false,
        };
      }
      return {
        position: consumed.position,
        valuation: settled(
          'provisional',
          negateMoney(consumed.removedValue),
          source,
        ),
        marksStale: true,
      };
    }
    const value = roundToMoneyScale(fact.knownValue);
    const remainingQuantity = subtractDecimalStrings(
      position.valuedQuantity,
      quantity,
    );
    // Emptying the pool must empty its value too (rule 5): the reversal
    // carries whatever is actually left, which equals the original's value
    // unless later rounding moved it.
    const removedValue = isZero(remainingQuantity)
      ? position.totalValue
      : value;
    return {
      position: {
        valuedQuantity: remainingQuantity,
        uncostedQuantity: position.uncostedQuantity,
        totalValue: subtractMoney(position.totalValue, removedValue),
      },
      valuation: settled('valued', negateMoney(removedValue), source),
      // A backdated outbound fact with its own value (today: reversal of an
      // inbound) changes the average that later issues saw. The value itself
      // is preserved by replay, but the affected later average-derived rows
      // must not be reported as current until an explicit recalculation.
      marksStale: backdated,
    };
  }

  // --- outbound direction valued from the average (rules 3, 4, 5, 8) -------
  const consumed = consume(position, quantity);
  const partlyUncosted = !isZero(consumed.uncostedPart);

  if (isZero(consumed.valuedPart)) {
    // Nothing left the valued pool: no value to attribute, and nothing
    // inconsistent happened. The key is simply `pending_cost`.
    return {
      position: consumed.position,
      valuation: unvalued(
        partlyUncosted ? 'uncosted_stock' : 'insufficient_valued_quantity',
      ),
      marksStale: false,
    };
  }

  // Value left the pool, so it must be written onto this row (invariant 2).
  // It is final only when the whole quantity came from the valued pool and
  // the fact is in order; otherwise a recalculation will change it.
  const provisional = partlyUncosted || backdated;
  return {
    position: consumed.position,
    valuation: settled(
      provisional ? 'provisional' : 'valued',
      negateMoney(consumed.removedValue),
      'average_cost',
    ),
    marksStale: provisional,
  };
}

// ---------------------------------------------------------------------------
// Transfers (two keys, one atomic pair — rule 6)
// ---------------------------------------------------------------------------

export interface TransferValuationOutcome {
  source: ValuationPosition;
  destination: ValuationPosition;
  outValuation: MovementValuation;
  inValuation: MovementValuation;
  marksStale: boolean;
}

/**
 * Move `quantity` of stock, and whatever value it carries, from one key to
 * another.
 *
 * Exactly value-neutral: the value removed from the source is the value
 * added to the destination, and the uncosted part of the quantity stays
 * uncosted on the other side. Both legs are FINAL — a later recalculation of
 * either key preserves a transfer leg's stored value rather than recomputing
 * it, because recomputing one side would silently contradict the other
 * (bounded recalculation, OD-VAL-12).
 */
export function applyTransfer(params: {
  source: ValuationPosition;
  destination: ValuationPosition;
  /** Positive base-unit magnitude moved. */
  quantity: string;
}): TransferValuationOutcome {
  const consumed = consume(params.source, params.quantity);
  const movedValue = consumed.removedValue;

  const destination: ValuationPosition = {
    valuedQuantity: addDecimalStrings(
      params.destination.valuedQuantity,
      consumed.valuedPart,
    ),
    uncostedQuantity: addDecimalStrings(
      params.destination.uncostedQuantity,
      consumed.uncostedPart,
    ),
    totalValue: addMoney(params.destination.totalValue, movedValue),
  };

  if (isZero(movedValue)) {
    return {
      source: consumed.position,
      destination,
      outValuation: unvalued('uncosted_stock'),
      inValuation: unvalued('uncosted_stock'),
      marksStale: false,
    };
  }

  return {
    source: consumed.position,
    destination,
    outValuation: settled('valued', negateMoney(movedValue), 'transfer'),
    inValuation: settled('valued', movedValue, 'transfer'),
    marksStale: false,
  };
}
