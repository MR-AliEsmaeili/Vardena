import { ITEM_KIND_DEFAULTS, type ItemKind } from './item-kind.js';

/**
 * Item capabilities — explicit behaviour flags, stored per item
 * (D-25, master-data-strategy.md §3.2, glossary §Item capability).
 *
 * "Every behaviour the code branches on is a capability, never a string
 * comparison" (glossary). They are booleans on the row, never key/value
 * metadata, JSONB, or an attribute table: capabilities drive stock
 * movements, warehouse requirements and valuation, all of which must be
 * indexable and reportable (master-data-strategy.md §8).
 *
 * Framework-free (AR-05).
 */

export interface ItemCapabilities {
  /** Quantity is held in a warehouse; produces stock movements. */
  isStockable: boolean;
  /** May appear on a purchase document. */
  isPurchasable: boolean;
  /** May appear on a sales document. */
  isSellable: boolean;
  /** Contributes to inventory valuation. */
  isValued: boolean;
  /** Quantity-bearing movements must carry a lot/batch. */
  requiresLot: boolean;
  /** One serial number per unit. */
  requiresSerial: boolean;
  /** Movements must carry an expiry date. */
  requiresExpiry: boolean;
}

/**
 * Capabilities the caller states explicitly; the rest come from the kind.
 *
 * Written out rather than `Partial<ItemCapabilities>`: under
 * `exactOptionalPropertyTypes`, `Partial` produces `isStockable?: boolean`,
 * which rejects an explicitly-`undefined` value — and "not stated" is exactly
 * what an omitted body field or an untouched DTO property is.
 */
export type CapabilityOverrides = {
  [K in keyof ItemCapabilities]?: ItemCapabilities[K] | undefined;
};

/**
 * Resolve the stored capability set for a new item: kind defaults, overridden
 * by whatever the caller stated explicitly.
 *
 * This runs **once, at creation** (master-data-strategy.md §7.2). The resolved
 * values are stored on the row; a later change to `ITEM_KIND_DEFAULTS` never
 * rewrites an existing item, and no code re-derives capabilities at read time.
 */
export function resolveCapabilities(
  kind: ItemKind,
  overrides: CapabilityOverrides,
): ItemCapabilities {
  return { ...ITEM_KIND_DEFAULTS[kind], ...pickSetCapabilities(overrides) };
}

/**
 * The capability combinations that contradict the behaviour table in
 * master-data-strategy.md §3.2/§3.3.
 *
 * Only the *obvious* contradictions are rejected:
 * - `is_valued = false` is defined as "never contributes to inventory
 *   valuation" and `is_stockable = false` as "cannot appear in stock-balance
 *   reports" (§3.2) — so a valued item, or one requiring lot/serial/expiry
 *   traceability on its movements, must be stockable. A non-stockable item has
 *   no movements and no balance to trace or value.
 *
 * Deliberately **not** rejected: `isSellable` without `isStockable`. A service
 * is exactly that (`stockable = false, sellable = true`), and the Task 6 brief
 * forbids assuming "every sellable item must be stockable".
 *
 * Nothing more complex is invented: no per-kind mandatory flags beyond the
 * defaults, no mutually-exclusive pairs, no cross-entity rules.
 */
export type CapabilityProblem =
  | 'valued_requires_stockable'
  | 'lot_requires_stockable'
  | 'serial_requires_stockable'
  | 'expiry_requires_stockable';

export function findCapabilityProblem(
  capabilities: ItemCapabilities,
): CapabilityProblem | null {
  if (capabilities.isValued && !capabilities.isStockable) {
    return 'valued_requires_stockable';
  }
  if (capabilities.requiresLot && !capabilities.isStockable) {
    return 'lot_requires_stockable';
  }
  if (capabilities.requiresSerial && !capabilities.isStockable) {
    return 'serial_requires_stockable';
  }
  if (capabilities.requiresExpiry && !capabilities.isStockable) {
    return 'expiry_requires_stockable';
  }
  return null;
}

export function capabilityProblemMessage(problem: CapabilityProblem): string {
  switch (problem) {
    case 'valued_requires_stockable':
      return 'A valued item must be stockable: valuation applies to stock, and a non-stockable item has no balance to value.';
    case 'lot_requires_stockable':
      return 'An item that requires lot tracking must be stockable: lots are traced on stock movements.';
    case 'serial_requires_stockable':
      return 'An item that requires serial tracking must be stockable: serials are traced on stock movements.';
    case 'expiry_requires_stockable':
      return 'An item that requires expiry tracking must be stockable: expiry is tracked on stock movements.';
  }
}

/** The capability keys, in a fixed order — the only keys this module reads. */
export const CAPABILITY_KEYS = [
  'isStockable',
  'isPurchasable',
  'isSellable',
  'isValued',
  'requiresLot',
  'requiresSerial',
  'requiresExpiry',
] as const satisfies readonly (keyof ItemCapabilities)[];

/**
 * `exactOptionalPropertyTypes`-safe spread: keep only the capability keys that
 * are actually set.
 *
 * The key list is a whitelist on purpose. Callers pass a wider create/update
 * input object (it `extends CapabilityOverrides` for convenience), and
 * spreading its non-capability keys into the resolved set would carry raw
 * `code`/`name` into the stored row and undo normalization.
 */
function pickSetCapabilities(
  overrides: CapabilityOverrides,
): Partial<ItemCapabilities> {
  const result: Partial<ItemCapabilities> = {};
  for (const key of CAPABILITY_KEYS) {
    const value = overrides[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}
