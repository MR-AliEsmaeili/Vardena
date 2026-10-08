import type { WarehouseAccountingPostingMode } from './warehouse-posting-mode.js';

/**
 * Warehouse — a stock location, master data
 * (master-data-strategy.md §1/§4, ADR-0020 §1, blueprint §11, glossary).
 *
 * **A warehouse belongs to exactly one branch.** That is stated in three
 * places (ADR-0020 §1 "warehouses belong to exactly one branch";
 * master-data-strategy.md §1 "Scope: branch" and §4 "belongs to exactly one
 * branch"; blueprint §11 "a warehouse belongs to exactly one branch"), so
 * `branchId` is required rather than optional — Task 5 decides this, it is not
 * an invention here.
 *
 * Multiple warehouses per organization (and per branch) are the normal case:
 * main, raw materials, finished goods, damaged goods, per-branch warehouses.
 * A warehouse is master data, never an enum.
 *
 * This entity is *only* the master-data foundation. Stock balances, movements,
 * locations/bins, reservations and valuation are future Inventory work
 * (ADR-0017, OQ-24) and are deliberately absent (AR-29).
 *
 * Framework-free (AR-05).
 */

export interface Warehouse {
  id: string;
  organizationId: string;
  branchId: string;
  code: string;
  name: string;
  /**
   * The warehouse half of the negative-stock policy (D-07, ADR-0022):
   * whether postings may drive this warehouse's stock below zero. Default
   * false (fail closed); an item may override it via
   * `Item.allowNegativeStock`.
   */
  allowNegativeStock: boolean;
  /**
   * Material Request warehouse setting (C-50 §3.7): whether ACTIVE
   * reservations in this warehouse reduce the READ-time `available` figure
   * (`onHand − reserved` vs `onHand`). Reservations never change `onHand`
   * regardless of this setting; the write-time admission check that guards
   * against over-reservation is unaffected by it (it always compares against
   * `onHand − reserved`, same as before this setting existed). Default true
   * preserves every existing consumer's current reading.
   */
  reservationsReduceAvailable: boolean;
  /**
   * C-62 (PDR-10 C62-OD-02): how an Accounting-eligible Inventory document of
   * THIS warehouse reaches the General Ledger — `direct_final` (one command
   * produces a final Accounting voucher) or `draft` (the command produces an
   * Accounting-owned draft an accountant registers or cancels later).
   *
   * Resolved through `resolveWarehouseAccountingPostingMode`, which fails
   * closed on an unknown stored value: guessing `draft` would silently post
   * nothing, guessing `direct_final` would silently post to the General
   * Ledger.
   */
  accountingPostingMode: WarehouseAccountingPostingMode;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WarehouseDto {
  id: string;
  organizationId: string;
  branchId: string;
  code: string;
  name: string;
  allowNegativeStock: boolean;
  reservationsReduceAvailable: boolean;
  accountingPostingMode: WarehouseAccountingPostingMode;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toWarehouseDto(warehouse: Warehouse): WarehouseDto {
  return {
    id: warehouse.id,
    organizationId: warehouse.organizationId,
    branchId: warehouse.branchId,
    code: warehouse.code,
    name: warehouse.name,
    allowNegativeStock: warehouse.allowNegativeStock,
    reservationsReduceAvailable: warehouse.reservationsReduceAvailable,
    accountingPostingMode: warehouse.accountingPostingMode,
    isActive: warehouse.isActive,
    createdAt: warehouse.createdAt.toISOString(),
    updatedAt: warehouse.updatedAt.toISOString(),
  };
}
