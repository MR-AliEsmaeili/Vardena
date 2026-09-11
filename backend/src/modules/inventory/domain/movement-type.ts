/**
 * Movement type — the closed, code-defined vocabulary of the ledger (D-05,
 * ADR-0022).
 *
 * Eight types, each with a fixed sign. The sign is what makes balances
 * `SUM`-consistent by construction: postings never choose a direction, the
 * type does.
 *
 * What is NOT here, deliberately:
 * - document-flavoured types (`purchase_receipt`, `sales_issue`, … from the
 *   inventory-domain-analysis §2.1 sketch). Task 7 implements no documents,
 *   and naming a type after a document nobody can post would invent business
 *   semantics. Generic `inbound`/`outbound` carry those flows until the
 *   document modules arrive with their own designed types;
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
  outbound: -1,
  transfer_out: -1,
  adjustment_out: -1,
  reversal_out: -1,
};

export function movementSign(type: MovementType): 1 | -1 {
  return MOVEMENT_SIGNS[type];
}

/**
 * Types the single-posting endpoint (`POST /inventory/movements`) accepts.
 * Transfer legs are excluded: they only ever exist as the atomic pair the
 * transfer operation writes — a lone `transfer_in` would silently create
 * stock. Reversals are excluded: they only ever exist as the exact mirror the
 * reversal operation derives from the original movement.
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
