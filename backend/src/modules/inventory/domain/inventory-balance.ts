import { subtractDecimalStrings } from './quantities.js';
import {
  formatBusinessDate,
  type BusinessDate,
} from '../../../kernel/datetime/business-date.js';
import type { CalendarSystem } from '../../../kernel/datetime/calendar-system.js';

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
  /** Newest movement's canonical Gregorian business day, if any. */
  lastMovementDate: BusinessDate | null;
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
  /**
   * `onHand − reserved` when `reservationsReduceAvailable` is true for this
   * row's warehouse (the default); `onHand` unchanged when false (C-50
   * §3.7). See {@link resolveAvailableQuantity} — every read that reports
   * availability shares this one calculation so they can never disagree for
   * the same key.
   */
  available: string;
  /** This row's warehouse's C-50 §3.7 setting, echoed for transparency. */
  reservationsReduceAvailable: boolean;
  /** Newest movement business day, canonical Gregorian `YYYY-MM-DD`. */
  lastMovementDate: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Whether a stored Inventory BusinessDate can be displayed under the
 * organization's captured calendar. Gregorian keeps the general canonical
 * API range; Jalali also requires the reversible rendering envelope.
 */
export function isInventoryBusinessDateRenderable(
  businessDate: BusinessDate,
  calendarSystem: CalendarSystem,
): boolean {
  return (
    formatBusinessDate(businessDate, 'GREGORIAN') !== null &&
    (calendarSystem === 'GREGORIAN' ||
      formatBusinessDate(businessDate, 'JALALI') !== null)
  );
}

/** Availability for a key: what is on hand minus what is promised. */
export function availableQuantity(balance: {
  onHand: string;
  reserved: string;
}): string {
  return subtractDecimalStrings(balance.onHand, balance.reserved);
}

/**
 * Availability for a key honoring the warehouse's C-50 §3.7 setting: when
 * `reservationsReduceAvailable` is true (the default), `onHand − reserved`;
 * when false, `onHand` unchanged. `onHand` itself is NEVER affected by this
 * setting — only what is reported as "available".
 *
 * This is the ONE shared helper for that calculation (AR — avoid duplicated
 * business logic): single-key `getAvailability`, the `/inventory/balances`
 * list, and the cross-warehouse view all call this so they can never disagree
 * for the same (warehouse, item) key.
 */
export function resolveAvailableQuantity(
  balance: { onHand: string; reserved: string },
  reservationsReduceAvailable: boolean,
): string {
  return reservationsReduceAvailable
    ? availableQuantity(balance)
    : balance.onHand;
}

export function toInventoryBalanceDto(
  balance: InventoryBalance,
  reservationsReduceAvailable: boolean,
): InventoryBalanceDto {
  return {
    id: balance.id,
    organizationId: balance.organizationId,
    branchId: balance.branchId,
    warehouseId: balance.warehouseId,
    itemId: balance.itemId,
    onHand: balance.onHand,
    reserved: balance.reserved,
    available: resolveAvailableQuantity(balance, reservationsReduceAvailable),
    reservationsReduceAvailable,
    lastMovementDate: balance.lastMovementDate,
    createdAt: balance.createdAt.toISOString(),
    updatedAt: balance.updatedAt.toISOString(),
  };
}
