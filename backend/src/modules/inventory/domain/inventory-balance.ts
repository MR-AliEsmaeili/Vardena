import { subtractDecimalStrings } from './quantities.js';

/**
 * Inventory balance — the materialized projection of the ledger for one
 * (organization, warehouse, item) key (D-04, ADR-0022).
 *
 * `onHand` and `reserved` are stored; `available` is ALWAYS derived as
 * `onHand − reserved` and never stored, so the three can never disagree on a
 * row. The stored pair is maintained in the same transaction as the ledger
 * write and is rebuildable from it at any time.
 *
 * Framework-free (AR-05).
 */

export interface InventoryBalance {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  /** Decimal string. */
  onHand: string;
  /** Decimal string. */
  reserved: string;
  lastMovementAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InventoryBalanceDto {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  itemId: string;
  onHand: string;
  reserved: string;
  /** Derived: `onHand − reserved`. Decimal string. */
  available: string;
  lastMovementAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Availability for a key: what is on hand minus what is promised. */
export function availableQuantity(balance: {
  onHand: string;
  reserved: string;
}): string {
  return subtractDecimalStrings(balance.onHand, balance.reserved);
}

export function toInventoryBalanceDto(
  balance: InventoryBalance,
): InventoryBalanceDto {
  return {
    id: balance.id,
    organizationId: balance.organizationId,
    branchId: balance.branchId,
    warehouseId: balance.warehouseId,
    itemId: balance.itemId,
    onHand: balance.onHand,
    reserved: balance.reserved,
    available: availableQuantity(balance),
    lastMovementAt: balance.lastMovementAt?.toISOString() ?? null,
    createdAt: balance.createdAt.toISOString(),
    updatedAt: balance.updatedAt.toISOString(),
  };
}
