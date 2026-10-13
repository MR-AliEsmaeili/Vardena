/**
 * Master-data conventions shared by the Inventory module's master-data
 * entities (docs/architecture/domain/master-data-strategy.md §7).
 *
 * This mirrors `modules/organization/domain/master-data.ts`. The duplication is
 * deliberate: the two modules own different master data
 * (master-data-strategy.md §1) and a shared file would have to live either in
 * the kernel (forbidden for business conventions — AR-06) or in one module and
 * be imported by the other (cross-module coupling — AR-07). If a third module
 * ever needs master-data conventions, extracting them is an ADR-level decision.
 *
 * Lifecycle: `is_active` only; no `deleted_at` (see the organization copy and
 * OQ-36). Codes: no format is invented (OQ-12) — non-blank + column width only,
 * compared case-sensitively (OQ-36).
 *
 * Framework-free (AR-05).
 */

/** `inventory.items.code`, `item_groups.code`, `warehouses.code`. */
export const MAX_CODE_LENGTH = 64;
/** `inventory.units.code` — units are short (`PCS`, `KG`, `BOX`). */
export const MAX_UNIT_CODE_LENGTH = 32;
/** `inventory.units.name`. */
export const MAX_UNIT_NAME_LENGTH = 120;
/** `inventory.units.symbol`. */
export const MAX_UNIT_SYMBOL_LENGTH = 16;
/** `inventory.items.name`, `item_groups.name`, `warehouses.name`. */
export const MAX_NAME_LENGTH = 200;
/** `inventory.items.barcode`. */
export const MAX_BARCODE_LENGTH = 64;

/** Business codes are stored trimmed; nothing else is normalised. */
export function normalizeCode(value: string): string {
  return value.trim();
}

/** Names are stored trimmed with internal whitespace runs collapsed. */
export function normalizeName(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** True when a trimmed value has content. */
export function isNonBlank(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * A positive decimal literal, as accepted for `numeric(18,6)` columns
 * (conversion factors, docs/database-strategy.md §6).
 *
 * Factors are handled as **strings** end to end — never as `number` — so a
 * factor such as `0.000001` or `12.5` survives the round trip without
 * binary floating-point drift. Only the sign and the shape are checked here;
 * no rounding rule is applied, because fractional-conversion rounding is
 * unresolved and expert-gated (OQ-29).
 */
const POSITIVE_DECIMAL_PATTERN = /^\d{1,12}(\.\d{1,6})?$/;

export function isPositiveDecimal(value: string): boolean {
  if (!POSITIVE_DECIMAL_PATTERN.test(value)) return false;
  // Reject zero: a zero factor would map every quantity to zero.
  return Number(value) > 0;
}
