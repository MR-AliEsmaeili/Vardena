import type { ItemCapabilities } from './item-capabilities.js';

/**
 * Item kind — the closed, code-defined classification of an Item
 * (D-25, master-data-strategy.md §3.2, glossary §Item kind, OQ-33).
 *
 * **This list is the single source of truth.** Adding or renaming a kind is a
 * deliberate code + migration change, never database-configurable data: the
 * point is that behaviour stays type-safe and reportable (option I-2 in
 * master-data-strategy.md §3.1). A kind is stored as text rather than a
 * database enum so that adding one is an ordinary migration instead of an
 * `ALTER TYPE`; the application rejects anything outside this list, so no
 * arbitrary string can reach the column (AR-24).
 *
 * The list matches the glossary and OQ-33 exactly. OQ-33 is still open — it
 * asks whether the list is complete — so this file is where a confirmed change
 * lands.
 */
export const ITEM_KINDS = [
  'goods',
  'service',
  'consumable',
  'asset',
  'raw_material',
  'semi_finished',
  'finished_good',
  'other',
] as const;

export type ItemKind = (typeof ITEM_KINDS)[number];

export function isItemKind(value: string): value is ItemKind {
  return (ITEM_KINDS as readonly string[]).includes(value);
}

/**
 * Capability defaults per kind.
 *
 * Kind supplies **defaults at creation only**; the flags stored on the item
 * are the truth afterwards (master-data-strategy.md §3.2, §7.2 — "later changes
 * to the group do not silently change items"). Changing a default here never
 * rewrites an existing item.
 *
 * Provenance:
 * - `goods`, `service`, `consumable`, `asset` are read directly off the
 *   behaviour table in master-data-strategy.md §3.3 (warehouse dimension,
 *   stock movements, valuation, buy/sell columns).
 * - `raw_material`, `semi_finished`, `finished_good` and `other` are NOT
 *   covered by that table. Their defaults below are **recorded assumptions**
 *   registered under OQ-33, chosen to be the least surprising and, for
 *   `other`, fail-closed (no capability switched on by an unknown
 *   classification). They are defaults, not rules: every flag can be set
 *   explicitly per item at creation.
 * - `requires_lot`/`requires_serial`/`requires_expiry` default to `false`
 *   everywhere. §3.3 calls them "Configurable", i.e. per item. Note the
 *   tension for `asset` ("serial typical" in §3.3 vs "stock movements: No"):
 *   a serial implies a stock movement in this model, and an asset register is
 *   out of scope, so the default is `false` — flagged for OQ-33.
 */
export const ITEM_KIND_DEFAULTS: Record<ItemKind, ItemCapabilities> = {
  // §3.3: stocked, bought and sold, valued.
  goods: {
    isStockable: true,
    isPurchasable: true,
    isSellable: true,
    isValued: true,
    requiresLot: false,
    requiresSerial: false,
    requiresExpiry: false,
  },
  // §3.3: never stocked, no movements, no valuation; bought and sold.
  service: {
    isStockable: false,
    isPurchasable: true,
    isSellable: true,
    isValued: false,
    requiresLot: false,
    requiresSerial: false,
    requiresExpiry: false,
  },
  // §3.3: stocked and valued, bought internally, not sold.
  consumable: {
    isStockable: true,
    isPurchasable: true,
    isSellable: false,
    isValued: true,
    requiresLot: false,
    requiresSerial: false,
    requiresExpiry: false,
  },
  // §3.3: not stocked (asset register instead), bought only, not valued here.
  asset: {
    isStockable: false,
    isPurchasable: true,
    isSellable: false,
    isValued: false,
    requiresLot: false,
    requiresSerial: false,
    requiresExpiry: false,
  },
  // Assumption (OQ-33): produced or bought, stocked, valued, not sold.
  raw_material: {
    isStockable: true,
    isPurchasable: true,
    isSellable: false,
    isValued: true,
    requiresLot: false,
    requiresSerial: false,
    requiresExpiry: false,
  },
  // Assumption (OQ-33): produced internally, stocked, valued, not traded.
  semi_finished: {
    isStockable: true,
    isPurchasable: false,
    isSellable: false,
    isValued: true,
    requiresLot: false,
    requiresSerial: false,
    requiresExpiry: false,
  },
  // Assumption (OQ-33): produced internally, stocked, valued, sold.
  finished_good: {
    isStockable: true,
    isPurchasable: false,
    isSellable: true,
    isValued: true,
    requiresLot: false,
    requiresSerial: false,
    requiresExpiry: false,
  },
  // Assumption (OQ-33): fail closed — nothing enabled until stated explicitly.
  other: {
    isStockable: false,
    isPurchasable: false,
    isSellable: false,
    isValued: false,
    requiresLot: false,
    requiresSerial: false,
    requiresExpiry: false,
  },
};
