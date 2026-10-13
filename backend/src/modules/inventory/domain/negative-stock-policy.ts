import { compareDecimalStrings } from './quantities.js';

/**
 * Negative-stock policy (D-07, OQ-24, ADR-0022).
 *
 * The policy answers one question: may a posting drive a stocking key below
 * zero? It is boolean — allow or reject — configured per warehouse with an
 * optional per-item override, defaulting to reject (fail closed until the
 * business confirms otherwise, OQ-24).
 *
 * The SAME effective policy governs reservations: a reservation that would
 * drive availability (`on_hand − reserved`) below zero is rejected unless the
 * policy explicitly allows it. One policy, one meaning — "negative
 * availability is tolerated here" — instead of two switches whose interaction
 * nobody specified.
 *
 * Deliberately NOT here: an `allow_with_permission` level (sketched in the
 * inventory-domain-analysis §4 but never approved — inventing a
 * permission-gated level would be a business rule nobody signed off).
 *
 * Framework-free (AR-05).
 */

/**
 * Resolve the effective policy: the item override wins when set, otherwise
 * the warehouse setting applies. `itemAllow === null` means "no override —
 * follow the warehouse".
 */
export function resolveEffectivePolicy(input: {
  /** `items.allow_negative_stock`: true/false override, null = inherit. */
  itemAllow: boolean | null;
  /** `warehouses.allow_negative_stock`. */
  warehouseAllow: boolean;
}): boolean {
  return input.itemAllow ?? input.warehouseAllow;
}

/**
 * True when a resulting stock level violates the policy: any negative value
 * while the policy rejects. `resultingLevel` is the on-hand after a movement
 * or the availability after a reservation — both are "must not go negative"
 * levels under the same rule.
 */
export function violatesNegativePolicy(
  resultingLevel: string,
  allowNegative: boolean,
): boolean {
  if (allowNegative) return false;
  return compareDecimalStrings(resultingLevel, '0') < 0;
}
