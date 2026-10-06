/**
 * Return valuation — the arithmetic behind a basis-linked purchase return
 * (C-59D, PDR-08 OD-RET-02) and the sales-return cold-start guard
 * (OD-RET-07).
 *
 * The purchase return's basis rule: the goods leave at the ORIGINAL
 * receipt's own recorded cost, pro-rated to the returned quantity:
 *
 *     value = basis.total_cost × returnedBaseQty ÷ basis.baseQuantity
 *
 * ONE division of the exact product, then the single sanctioned rounding —
 * the same shape `moving-weighted-average.ts` uses for an average-derived
 * share (`shareOfValue`), never a pre-rounded unit cost multiplied back
 * (which would round twice and drift, OD-VAL-16). A full-quantity return
 * therefore mirrors the basis value exactly; a partial return carries its
 * exact pro-rated share.
 *
 * An unvalued basis is honoured as NO value: the return is unvalued too —
 * you cannot return goods "at the price they were purchased" when that price
 * was never assigned. No variance is ever invented (OD-RET-04).
 *
 * Framework-free (AR-05).
 */

import { divideToScale, multiplyMoney, roundToMoneyScale } from './money.js';
import { compareDecimalStrings } from './quantities.js';

/** The value of a basis movement as the return sees it. */
export interface ReturnBasisMovement {
  id: string;
  /** Base-unit magnitude of the basis movement; always > 0. */
  baseQuantity: string;
  /** The basis movement's own recorded value; `null` when unvalued. */
  totalCost: string | null;
}

/**
 * Value a purchase return line from its basis movement (OD-RET-02).
 *
 * @returns the exact pro-rated value the return carries, or `null` when the
 *   basis carries none.
 * @throws an Error when the return quantity exceeds the basis quantity —
 *   over-returning a receipt is refused, never silently re-priced at some
 *   other basis.
 */
export function purchaseReturnValueFromBasis(params: {
  basis: ReturnBasisMovement;
  /** Base-unit magnitude being returned; always > 0. */
  returnedBaseQuantity: string;
}): string | null {
  if (params.basis.totalCost === null) return null;
  if (compareDecimalStrings(params.returnedBaseQuantity, '0') <= 0) {
    throw new Error('A return quantity must be positive.');
  }
  if (
    compareDecimalStrings(
      params.returnedBaseQuantity,
      params.basis.baseQuantity,
    ) > 0
  ) {
    throw new Error(
      `The returned quantity exceeds the basis movement "${params.basis.id}" ` +
        `(${params.returnedBaseQuantity} > ${params.basis.baseQuantity}). ` +
        'A purchase return may not return more than the receipt it is based on.',
    );
  }
  // One division of the exact product at working scale, then the single
  // sanctioned rounding — mirror of `shareOfValue`, see the header.
  const WORKING_SCALE = 6;
  const share = divideToScale(
    multiplyMoney(params.basis.totalCost, params.returnedBaseQuantity),
    params.basis.baseQuantity,
    WORKING_SCALE,
  );
  if (share === null) {
    // Unreachable: the basis has a positive base quantity by construction.
    throw new Error(
      `Cannot pro-rate the basis value of movement "${params.basis.id}" over a zero quantity.`,
    );
  }
  return roundToMoneyScale(share);
}
