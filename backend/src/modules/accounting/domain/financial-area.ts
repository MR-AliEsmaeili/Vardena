/**
 * Financial Area — an Accounting-owned, organization-scoped bookkeeping
 * scope (contract §5, AC-D-02…AC-D-05, ADR-0026 §2/§3).
 *
 * An area selects *which book* an accounting document is written into, and
 * it is the scope for fiscal years, periods, document numbering and balance
 * projections. It is NOT the organization, NOT a branch, NOT a department
 * and NOT a legal entity/company (contract §5.1): those are independent
 * axes, and no FK or derivation connects them.
 *
 * Multiplicity (OQ-40): the model permits n ≥ 1 areas per organization.
 * The interim posture is structural — areas are created explicitly (never
 * seeded) and referenced as caller-supplied, scope-validated parameters,
 * exactly like `organizationId` today. User↔area access grants are NOT part
 * of Task 10.2 (OQ-40).
 *
 * Framework-free (AR-05).
 */

export interface FinancialArea {
  id: string;
  organizationId: string;
  code: string;
  title: string;
  /** Per-organization default (contract §5.5): at most one per org. */
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FinancialAreaDto {
  id: string;
  organizationId: string;
  code: string;
  title: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toFinancialAreaDto(area: FinancialArea): FinancialAreaDto {
  return {
    id: area.id,
    organizationId: area.organizationId,
    code: area.code,
    title: area.title,
    isDefault: area.isDefault,
    isActive: area.isActive,
    createdAt: area.createdAt.toISOString(),
    updatedAt: area.updatedAt.toISOString(),
  };
}
