import { Inject, Injectable } from '@nestjs/common';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import {
  toOffset,
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { EmployeesRepository } from '../data/employees.repository.js';
import type { Employee, EmployeeDto } from '../domain/employee.js';
import { toEmployeeDto } from '../domain/employee.js';
import {
  isNonBlank,
  MAX_EMPLOYEE_CODE_LENGTH,
  MAX_PERSON_NAME_LENGTH,
  normalizeCode,
  normalizeName,
} from '../domain/master-data.js';
import { EMPLOYEE_PERMISSIONS } from '../domain/organization-permissions.js';
import {
  EMPLOYEE_CREATED_EVENT,
  EMPLOYEE_DISABLED_EVENT,
  EMPLOYEE_ENABLED_EVENT,
  EMPLOYEE_UPDATED_EVENT,
} from '../domain/organization.events.js';
import {
  assertUsable,
  publishEvent,
  resolveSort,
} from './master-data-support.js';
import { OrganizationsService } from './organizations.service.js';
import { BranchesService } from './branches.service.js';
import { DepartmentsService } from './departments.service.js';

const SORTABLE_FIELDS: Record<string, string> = {
  employeeCode: 'employeeCode',
  firstName: 'firstName',
  lastName: 'lastName',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

export interface ListEmployeesQuery {
  organizationId: string;
  page: number;
  pageSize: number;
  isActive?: boolean | undefined;
  departmentId?: string | undefined;
  branchId?: string | undefined;
  search?: string | undefined;
  sort?: string | undefined;
}

export interface CreateEmployeeInput {
  organizationId: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  departmentId?: string | null | undefined;
  branchId?: string | null | undefined;
}

export interface UpdateEmployeeInput {
  employeeCode?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  departmentId?: string | null | undefined;
  branchId?: string | null | undefined;
}

/**
 * Employee administration — minimal business reference data (OQ-32).
 *
 * Organization consistency is enforced here, not assumed: the employee's
 * department and branch must both belong to the employee's organization. That
 * check cannot be expressed by a foreign key (the FK only proves the row
 * exists), so it lives in this service — the same rule the Task 6 brief calls
 * "organization consistency validation".
 *
 * There is deliberately no link to `users.users` and no HR/payroll surface;
 * see `domain/employee.ts` and OQ-32/OQ-37.
 */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly repository: EmployeesRepository,
    private readonly organizations: OrganizationsService,
    private readonly branches: BranchesService,
    private readonly departments: DepartmentsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async listEmployees(
    query: ListEmployeesQuery,
  ): Promise<PaginatedResult<EmployeeDto>> {
    await this.authorization.requireAllPermissions([EMPLOYEE_PERMISSIONS.VIEW]);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: {
        organizationId: query.organizationId,
        isActive: query.isActive,
        departmentId: query.departmentId,
        branchId: query.branchId,
        search: query.search,
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [
        { employeeCode: 'asc' },
      ]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toEmployeeDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getEmployee(organizationId: string, id: string): Promise<EmployeeDto> {
    await this.authorization.requireAllPermissions([EMPLOYEE_PERMISSIONS.VIEW]);
    return toEmployeeDto(await this.mustFindInOrganization(organizationId, id));
  }

  async createEmployee(input: CreateEmployeeInput): Promise<EmployeeDto> {
    await this.authorization.requireAllPermissions([
      EMPLOYEE_PERMISSIONS.CREATE,
    ]);
    const employeeCode = normalizeCode(input.employeeCode);
    const firstName = normalizeName(input.firstName);
    const lastName = normalizeName(input.lastName);
    assertNames(employeeCode, firstName, lastName);

    await this.organizations.requireUsableOrganization(input.organizationId);

    const departmentId = input.departmentId ?? null;
    const branchId = input.branchId ?? null;
    if (departmentId !== null) {
      await this.departments.requireUsableDepartmentInOrganization(
        departmentId,
        input.organizationId,
      );
    }
    if (branchId !== null) {
      await this.branches.requireUsableBranchInOrganization(
        branchId,
        input.organizationId,
      );
    }

    const existing = await this.repository.findByCode(
      input.organizationId,
      employeeCode,
    );
    if (existing !== null) {
      throw AppException.conflict(
        'An employee with that code already exists in this organization.',
      );
    }

    const now = new Date();
    let created: Employee;
    try {
      created = await this.repository.create({
        id: generateId(),
        organizationId: input.organizationId,
        employeeCode,
        firstName,
        lastName,
        departmentId,
        branchId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        createdBy: getPrincipal()?.userId ?? null,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'An employee with that code already exists in this organization.',
        );
      }
      throw error;
    }

    await publishEvent(this.events, {
      type: EMPLOYEE_CREATED_EVENT,
      aggregateType: 'Employee',
      aggregateId: created.id,
      // No name in the payload: an event is not a copy of personal data.
      payload: {
        id: created.id,
        organizationId: created.organizationId,
        code: created.employeeCode,
      },
    });
    this.logger.log(
      'Employee created',
      { employeeId: created.id, organizationId: created.organizationId },
      EmployeesService.name,
    );
    return toEmployeeDto(created);
  }

  async updateEmployee(
    organizationId: string,
    id: string,
    input: UpdateEmployeeInput,
  ): Promise<EmployeeDto> {
    await this.authorization.requireAllPermissions([EMPLOYEE_PERMISSIONS.EDIT]);
    const current = await this.mustFindInOrganization(organizationId, id);

    const employeeCode =
      input.employeeCode === undefined
        ? undefined
        : normalizeCode(input.employeeCode);
    const firstName =
      input.firstName === undefined
        ? undefined
        : normalizeName(input.firstName);
    const lastName =
      input.lastName === undefined ? undefined : normalizeName(input.lastName);
    assertNames(
      employeeCode ?? current.employeeCode,
      firstName ?? current.firstName,
      lastName ?? current.lastName,
    );

    if (employeeCode !== undefined && employeeCode !== current.employeeCode) {
      const taken = await this.repository.findByCodeExcludingId(
        current.organizationId,
        employeeCode,
        id,
      );
      if (taken !== null) {
        throw AppException.conflict(
          'An employee with that code already exists in this organization.',
        );
      }
    }

    const patch: {
      employeeCode?: string;
      firstName?: string;
      lastName?: string;
      departmentId?: string | null;
      branchId?: string | null;
      updatedAt: Date;
      updatedBy: string | null;
    } = { updatedAt: new Date(), updatedBy: getPrincipal()?.userId ?? null };
    if (employeeCode !== undefined) patch.employeeCode = employeeCode;
    if (firstName !== undefined) patch.firstName = firstName;
    if (lastName !== undefined) patch.lastName = lastName;

    // Only re-validate a reference when it changes; an employee whose branch
    // or department was disabled afterwards stays editable.
    if (
      input.departmentId !== undefined &&
      input.departmentId !== current.departmentId
    ) {
      const departmentId = input.departmentId;
      patch.departmentId = departmentId;
      if (departmentId !== null) {
        await this.departments.requireUsableDepartmentInOrganization(
          departmentId,
          current.organizationId,
        );
      }
    }
    if (input.branchId !== undefined && input.branchId !== current.branchId) {
      const branchId = input.branchId;
      patch.branchId = branchId;
      if (branchId !== null) {
        await this.branches.requireUsableBranchInOrganization(
          branchId,
          current.organizationId,
        );
      }
    }

    const updated = await this.repository.update(id, patch);
    if (updated === null) throw AppException.notFound('Employee', id);

    await publishEvent(this.events, {
      type: EMPLOYEE_UPDATED_EVENT,
      aggregateType: 'Employee',
      aggregateId: updated.id,
      payload: {
        id: updated.id,
        organizationId: updated.organizationId,
        code: updated.employeeCode,
      },
    });
    return toEmployeeDto(updated);
  }

  async enableEmployee(
    organizationId: string,
    id: string,
  ): Promise<EmployeeDto> {
    return this.setActive(
      organizationId,
      id,
      true,
      EMPLOYEE_PERMISSIONS.ENABLE,
    );
  }

  async disableEmployee(
    organizationId: string,
    id: string,
  ): Promise<EmployeeDto> {
    return this.setActive(
      organizationId,
      id,
      false,
      EMPLOYEE_PERMISSIONS.DISABLE,
    );
  }

  /** Reference resolution for future modules (documents, approvals). */
  async requireUsableEmployeeInOrganization(
    id: string,
    organizationId: string,
    options: { allowInactive?: boolean } = {},
  ): Promise<Employee> {
    const employee = await this.repository.findById(id);
    if (employee === null || employee.organizationId !== organizationId) {
      throw AppException.notFound('Employee', id);
    }
    assertUsable('Employee', employee.isActive, {
      allowInactive: options.allowInactive ?? false,
    });
    return employee;
  }

  // ---- internals ----------------------------------------------------------

  private async setActive(
    organizationId: string,
    id: string,
    isActive: boolean,
    permission: string,
  ): Promise<EmployeeDto> {
    await this.authorization.requireAllPermissions([permission]);
    const current = await this.mustFindInOrganization(organizationId, id);
    if (current.isActive === isActive) return toEmployeeDto(current);

    const updated = await this.repository.update(id, {
      isActive,
      updatedAt: new Date(),
      updatedBy: getPrincipal()?.userId ?? null,
    });
    if (updated === null) throw AppException.notFound('Employee', id);

    await publishEvent(this.events, {
      type: isActive ? EMPLOYEE_ENABLED_EVENT : EMPLOYEE_DISABLED_EVENT,
      aggregateType: 'Employee',
      aggregateId: updated.id,
      payload: {
        id: updated.id,
        organizationId: updated.organizationId,
        code: updated.employeeCode,
      },
    });
    return toEmployeeDto(updated);
  }

  private async mustFindInOrganization(
    organizationId: string,
    id: string,
  ): Promise<Employee> {
    await this.organizations.assertOrganizationInScope(organizationId);
    const employee = await this.repository.findById(id);
    if (employee === null || employee.organizationId !== organizationId) {
      throw AppException.notFound('Employee', id);
    }
    return employee;
  }
}

function assertNames(
  employeeCode: string,
  firstName: string,
  lastName: string,
): void {
  if (
    !isNonBlank(employeeCode) ||
    employeeCode.length > MAX_EMPLOYEE_CODE_LENGTH
  ) {
    throw AppException.badRequest(
      `Employee code is required and must be at most ${MAX_EMPLOYEE_CODE_LENGTH} characters.`,
    );
  }
  if (!isNonBlank(firstName) || firstName.length > MAX_PERSON_NAME_LENGTH) {
    throw AppException.badRequest(
      `First name is required and must be at most ${MAX_PERSON_NAME_LENGTH} characters.`,
    );
  }
  if (!isNonBlank(lastName) || lastName.length > MAX_PERSON_NAME_LENGTH) {
    throw AppException.badRequest(
      `Last name is required and must be at most ${MAX_PERSON_NAME_LENGTH} characters.`,
    );
  }
}
