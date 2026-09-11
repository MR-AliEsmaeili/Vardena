/**
 * Branch — an organizational scope dimension of the organization
 * (master-data-strategy.md §1/§2, ADR-0020 §1, OQ-22, D-01).
 *
 * A branch is a place of business (main office, sales branch, factory) used
 * to scope documents, warehouses, numbering and reporting. It is **not** a
 * legal entity and **not** a separate set of books: there are no branch-level
 * ledger columns anywhere in this task, and multi-company stays deferred to
 * its own ADR.
 *
 * One organization may have any number of branches; a branch belongs to
 * exactly one organization.
 *
 * Framework-free (AR-05).
 */

export interface Branch {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BranchDto {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toBranchDto(branch: Branch): BranchDto {
  return {
    id: branch.id,
    organizationId: branch.organizationId,
    code: branch.code,
    name: branch.name,
    isActive: branch.isActive,
    createdAt: branch.createdAt.toISOString(),
    updatedAt: branch.updatedAt.toISOString(),
  };
}
