/**
 * Organization — the business/tenant root of a Vardena deployment
 * (docs/architecture/domain/domain-glossary.md §Organizational terms,
 * master-data-strategy.md §1/§2, ADR-0020 §1, ADR-0021).
 *
 * The glossary defines Organization as "the single legal/business entity a
 * Vardena deployment serves" under the OQ-01 assumption of one organization
 * per deployment with no `organization_id` columns. Task 6 makes the
 * organization an explicit, addressable row and scopes master data to it,
 * which supersedes that assumption; the change and its consequences are
 * recorded in ADR-0021 and in the updated OQ-01/OQ-22 entries.
 *
 * This entity is a *boundary*, not a settings bag: the fiscal calendar,
 * numbering series, tax definitions, workflow definitions and custom-field
 * definitions that ADR-0020 also assigns to this module are NOT implemented
 * here (later tasks).
 *
 * Framework-free (AR-05).
 */

export interface Organization {
  /** ULID primary key. */
  id: string;
  /** Human business key, unique deployment-wide. */
  code: string;
  name: string;
  /**
   * Lifecycle (master-data-strategy.md §7.4). A disabled organization blocks
   * the creation of new organization-scoped records but keeps existing ones
   * readable and reportable.
   */
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** API representation. Audit actor ids are not exposed (AR-24). */
export interface OrganizationDto {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toOrganizationDto(organization: Organization): OrganizationDto {
  return {
    id: organization.id,
    code: organization.code,
    name: organization.name,
    isActive: organization.isActive,
    createdAt: organization.createdAt.toISOString(),
    updatedAt: organization.updatedAt.toISOString(),
  };
}
