/**
 * Movement type — the closed, code-defined vocabulary of the ledger (D-05,
 * ADR-0022).
 *
 * Ten types, each with a fixed sign. The sign is what makes balances
 * `SUM`-consistent by construction: postings never choose a direction, the
 * type does.
 *
 * What is NOT here, deliberately:
 * - purchase/sales RECEIPT/ISSUE document flavours (`purchase_receipt`,
 *   `sales_issue`, … from the inventory-domain-analysis §2.1 sketch):
 *   documents never changed what the generic directions mean, so the C-58
 *   Receipt/Issue runtime posts plain `inbound`/`outbound`. RETURNS are the
 *   exception the decisions force: a purchase return (PDR-08 OD-RET-02)
 *   leaves at the ORIGINAL receipt's own cost and a sales return (OD-RET-06)
 *   re-enters at the CURRENT average — both need a valuation treatment the
 *   generic types cannot express, so C-59D gives them their own types;
 * - an `opening` type. Initial loads post as `inbound`; whether openings need
 *   a distinct type (and how they link to accounting opening balances, OQ-23)
 *   is a designed follow-up, not a guess;
 * - user-defined types: there is no movement-type table and no API to invent
 *   one, ever (AR-23-ish: the vocabulary is code).
 *
 * Stored as text (like `item_kind`): adding a type is one code change, never
 * an `ALTER TYPE`. The application rejects anything outside this list.
 *
 * Framework-free (AR-05).
 */

export const MOVEMENT_TYPES = [
  'inbound',
  'outbound',
  'transfer_in',
  'transfer_out',
  'adjustment_in',
  'adjustment_out',
  'reversal_in',
  'reversal_out',
  'purchase_return',
  'sales_return',
] as const;

export type MovementType = (typeof MOVEMENT_TYPES)[number];

export function isMovementType(value: string): value is MovementType {
  return (MOVEMENT_TYPES as readonly string[]).includes(value);
}

/** The signed direction of a type: +1 increases on-hand stock, −1 decreases. */
const MOVEMENT_SIGNS: Record<MovementType, 1 | -1> = {
  inbound: 1,
  transfer_in: 1,
  adjustment_in: 1,
  reversal_in: 1,
  sales_return: 1,
  outbound: -1,
  transfer_out: -1,
  adjustment_out: -1,
  reversal_out: -1,
  purchase_return: -1,
};

export function movementSign(type: MovementType): 1 | -1 {
  return MOVEMENT_SIGNS[type];
}

/**
 * Types the single-posting endpoint (`POST /inventory/movements`) accepts.
 * Transfer legs are excluded: they only ever exist as the atomic pair the
 * transfer operation writes — a lone `transfer_in` would silently create
 * stock. Reversals are excluded: they only ever exist as the exact mirror the
 * reversal operation derives from the original movement. Returns are
 * excluded: they only ever exist through their business documents, which own
 * the basis/manual-amount rules that decide their value (PDR-08 OD-RET).
 */
export const SINGLE_POST_TYPES = [
  'inbound',
  'outbound',
  'adjustment_in',
  'adjustment_out',
] as const;

export type SinglePostType = (typeof SINGLE_POST_TYPES)[number];

export function isSinglePostType(value: string): value is SinglePostType {
  return (SINGLE_POST_TYPES as readonly string[]).includes(value);
}

/** Types that correct stock without a document: they require a reason. */
export function requiresReason(type: MovementType): boolean {
  return type === 'adjustment_in' || type === 'adjustment_out';
}

/**
 * The reversal type mirroring an original movement: an outbound original
 * (`base_quantity` < 0) reverses as `reversal_in`, anything else (inbound,
 * including an inbound that is itself a reversal) as `reversal_out`.
 */
export function reversalTypeFor(baseQuantity: string): MovementType {
  return baseQuantity.trim().startsWith('-') ? 'reversal_in' : 'reversal_out';
}
