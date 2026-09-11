/**
 * Department — an internal functional unit of the organization, used for
 * responsibility reporting (glossary §Organizational terms,
 * master-data-strategy.md §1).
 *
 * Departments may be hierarchical through an explicit `parentDepartmentId`
 * self-reference. Whether a department is *also* an accounting dimension is
 * expert-gated and unresolved (OQ-22/OQ-25): nothing in this entity encodes
 * accounting meaning.
 *
 * Framework-free (AR-05).
 */

export interface Department {
  id: string;
  organizationId: string;
  /** Null for a root department. */
  parentDepartmentId: string | null;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DepartmentDto {
  id: string;
  organizationId: string;
  parentDepartmentId: string | null;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toDepartmentDto(department: Department): DepartmentDto {
  return {
    id: department.id,
    organizationId: department.organizationId,
    parentDepartmentId: department.parentDepartmentId,
    code: department.code,
    name: department.name,
    isActive: department.isActive,
    createdAt: department.createdAt.toISOString(),
    updatedAt: department.updatedAt.toISOString(),
  };
}
