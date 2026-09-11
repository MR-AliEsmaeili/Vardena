/**
 * Employee — minimal business reference data (OQ-32, glossary §Master-data
 * terms, master-data-strategy.md §1).
 *
 * **Employee is NOT User, and this entity has no link to `users.users`.**
 * The glossary draws the line explicitly: an Employee is "a person employed
 * by the organization, referenced by HR-ish attributes only … *Not to be
 * confused with:* User (a login account)". A person may exist operationally
 * (receiving stock, named on a document, an approval step) without ever
 * needing a login.
 *
 * The linkage is deliberately absent rather than speculative (AR-29):
 * - a `user_id` column here would be a cross-module foreign key from
 *   `organization` to `users`, and docs/database-strategy.md §5 keeps FKs to
 *   users logical unless the dependency is clean and documented;
 * - the direction is undecided (does a User point at an Employee, or the
 *   other way round?), and the answer depends on HR scope (OQ-32).
 * Recorded as OQ-37. Until it is answered, documents that need a person
 * reference an employee id, and Identity/Users stay untouched.
 *
 * HR, payroll, attendance and recruitment are out of scope (OQ-32).
 *
 * Framework-free (AR-05).
 */

export interface Employee {
  id: string;
  organizationId: string;
  /** Business key, unique within the organization. */
  employeeCode: string;
  firstName: string;
  lastName: string;
  /** Optional; must belong to the same organization (validated on write). */
  departmentId: string | null;
  /** Optional; must belong to the same organization (validated on write). */
  branchId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmployeeDto {
  id: string;
  organizationId: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  departmentId: string | null;
  branchId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toEmployeeDto(employee: Employee): EmployeeDto {
  return {
    id: employee.id,
    organizationId: employee.organizationId,
    employeeCode: employee.employeeCode,
    firstName: employee.firstName,
    lastName: employee.lastName,
    departmentId: employee.departmentId,
    branchId: employee.branchId,
    isActive: employee.isActive,
    createdAt: employee.createdAt.toISOString(),
    updatedAt: employee.updatedAt.toISOString(),
  };
}
