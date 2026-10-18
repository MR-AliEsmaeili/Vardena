import type { MovementType } from './movement-type.js';

/**
 * Exact quantity values are decimal strings throughout Inventory (AR-12).
 * The domain type deliberately does not depend on Prisma.Decimal or HTTP DTOs.
 */
export interface KardexMovementLine {
  movementId: string;
  /** Canonical Gregorian business day (`inventory_movements.movement_date`). */
  date: string;
  /** Ledger entry instant, used as the second chronological ordering key. */
  createdAt: string;
  movementType: MovementType;
  /** Signed base-unit quantity: positive increases stock, negative decreases it. */
  quantityChange: string;
  /** Ledger-derived running base-unit quantity after this movement. */
  quantityAfter: string;
  /** Opaque source reference id, present only when the movement has a reference. */
  referenceId?: string;
  /** Opaque source reference kind, when `reference` is present. */
  referenceType?: string;
  /** Transfer identity, present for a transfer ledger leg. */
  transferId?: string;
  /** Original ledger movement identity, present for a reversal. */
  reversalOfMovementId?: string;
}

export interface QuantityKardexResult {
  items: KardexMovementLine[];
  total: number;
  page: number;
  pageSize: number;
  /** Signed ledger quantity before the requested range (or zero without dateFrom). */
  opening: string;
  /** Ledger-derived quantity after the full requested range, not just this page. */
  closing: string;
  openingBasis:
    'ledger_movements_before_date_from' | 'zero_before_all_recorded_movements';
  /** Opaque token required to keep subsequent pages on the same ledger snapshot. */
  snapshot: string;
  /** Unit identity for the base-unit quantities in `items`, `opening`, and `closing`. */
  unitId: string;
}
