/**
 * Unit of measure (master-data-strategy.md §1/§3.4, glossary §Unit, OQ-29).
 *
 * Organization-scoped master data: the scope table in
 * master-data-strategy.md §1 assigns units to the Inventory module with
 * `organization` scope, and blueprint §11 lists units under
 * "Organization-scoped". Units are therefore **not** global rows shared across
 * organizations and **not** per-item copies: one `PCS` per organization,
 * referenced by every item that uses it.
 *
 * The model is deliberately generic — no Iranian-specific or otherwise
 * hard-coded unit set is seeded or implied.
 *
 * Per-unit decimal precision is expert-gated and unresolved (OQ-29): quantity
 * columns stay `numeric(18,4)` per AR-12 and no precision column is added
 * speculatively (AR-29).
 *
 * Framework-free (AR-05).
 */

export interface Unit {
  id: string;
  organizationId: string;
  /** e.g. `PCS`, `KG`, `M`, `BOX`. */
  code: string;
  name: string;
  symbol: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UnitDto {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  symbol: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toUnitDto(unit: Unit): UnitDto {
  return {
    id: unit.id,
    organizationId: unit.organizationId,
    code: unit.code,
    name: unit.name,
    symbol: unit.symbol,
    isActive: unit.isActive,
    createdAt: unit.createdAt.toISOString(),
    updatedAt: unit.updatedAt.toISOString(),
  };
}
