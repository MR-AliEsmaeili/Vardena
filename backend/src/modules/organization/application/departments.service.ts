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
import { DepartmentsRepository } from '../data/departments.repository.js';
import type { Department, DepartmentDto } from '../domain/department.js';
import { toDepartmentDto } from '../domain/department.js';
import {
  collectDescendantIds,
  findHierarchyProblem,
} from '../domain/hierarchy.js';
import { normalizeCode, normalizeName } from '../domain/master-data.js';
import { DEPARTMENT_PERMISSIONS } from '../domain/organization-permissions.js';
import {
  DEPARTMENT_CREATED_EVENT,
  DEPARTMENT_DISABLED_EVENT,
  DEPARTMENT_ENABLED_EVENT,
  DEPARTMENT_UPDATED_EVENT,
} from '../domain/organization.events.js';
import {
  assertCodeAndName,
  assertUsable,
  hierarchyProblemMessage,
  publishEvent,
  resolveSort,
} from './master-data-support.js';
import { OrganizationsService } from './organizations.service.js';

const SORTABLE_FIELDS: Record<string, string> = {
  code: 'code',
  name: 'name',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

export interface ListDepartmentsQuery {
  organizationId: string;
  page: number;
  pageSize: number;
  isActive?: boolean | undefined;
  parentDepartmentId?: string | undefined;
  search?: string | undefined;
  sort?: string | undefined;
}

export interface CreateDepartmentInput {
  organizationId: string;
  parentDepartmentId?: string | null | undefined;
  code: string;
  name: string;
}

export interface UpdateDepartmentInput {
  parentDepartmentId?: string | null | undefined;
  code?: string | undefined;
  name?: string | undefined;
}

/**
 * Department administration — organizational structure for responsibility
 * reporting (glossary §Organizational terms, master-data-strategy.md §1).
 *
 * Hierarchy is an explicit self-reference validated with exactly three rules
 * (`domain/hierarchy.ts`): the parent must exist in the same organization, a
 * department cannot be its own parent, and a department cannot be moved under
 * one of its own descendants. Nothing else — no depth limit, no level policy,
 * no restructuring workflow, and no accounting meaning (whether a department
 * doubles as an accounting dimension is expert-gated: OQ-22/OQ-25).
 */
@Injectable()
export class DepartmentsService {
  constructor(
    private readonly repository: DepartmentsRepository,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async listDepartments(
    query: ListDepartmentsQuery,
  ): Promise<PaginatedResult<DepartmentDto>> {
    await this.authorization.requireAllPermissions([
      DEPARTMENT_PERMISSIONS.VIEW,
    ]);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: {
        organizationId: query.organizationId,
        isActive: query.isActive,
        parentDepartmentId: query.parentDepartmentId,
        search: query.search,
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [{ code: 'asc' }]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toDepartmentDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getDepartment(id: string): Promise<DepartmentDto> {
    await this.authorization.requireAllPermissions([
      DEPARTMENT_PERMISSIONS.VIEW,
    ]);
    return toDepartmentDto(await this.mustFind(id));
  }

  async createDepartment(input: CreateDepartmentInput): Promise<DepartmentDto> {
    await this.authorization.requireAllPermissions([
      DEPARTMENT_PERMISSIONS.CREATE,
    ]);
    const code = normalizeCode(input.code);
    const name = normalizeName(input.name);
    assertCodeAndName(code, name);

    await this.organizations.requireUsableOrganization(input.organizationId);

    const parentId = input.parentDepartmentId ?? null;
    if (parentId !== null) {
      await this.assertParentAssignment({
        id: '',
        parentId,
        organizationId: input.organizationId,
        descendantIds: [],
        // A brand-new department has no descendants, so only existence,
        // organization and activity can be wrong.
        requireActiveParent: true,
      });
    }

    const existing = await this.repository.findByCode(
      input.organizationId,
      code,
    );
    if (existing !== null) {
      throw AppException.conflict(
        'A department with that code already exists in this organization.',
      );
    }

    const now = new Date();
    let created: Department;
    try {
      created = await this.repository.create({
        id: generateId(),
        organizationId: input.organizationId,
        parentDepartmentId: parentId,
        code,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        createdBy: getPrincipal()?.userId ?? null,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'A department with that code already exists in this organization.',
        );
      }
      throw error;
    }

    await publishEvent(this.events, {
      type: DEPARTMENT_CREATED_EVENT,
      aggregateType: 'Department',
      aggregateId: created.id,
      payload: {
        id: created.id,
        organizationId: created.organizationId,
        code: created.code,
      },
    });
    this.logger.log(
      'Department created',
      { departmentId: created.id, organizationId: created.organizationId },
      DepartmentsService.name,
    );
    return toDepartmentDto(created);
  }

  async updateDepartment(
    id: string,
    input: UpdateDepartmentInput,
  ): Promise<DepartmentDto> {
    await this.authorization.requireAllPermissions([
      DEPARTMENT_PERMISSIONS.EDIT,
    ]);
    const current = await this.mustFind(id);
    const code =
      input.code === undefined ? undefined : normalizeCode(input.code);
    const name =
      input.name === undefined ? undefined : normalizeName(input.name);
    assertCodeAndName(code ?? current.code, name ?? current.name);

    if (code !== undefined && code !== current.code) {
      const taken = await this.repository.findByCodeExcludingId(
        current.organizationId,
        code,
        id,
      );
      if (taken !== null) {
        throw AppException.conflict(
          'A department with that code already exists in this organization.',
        );
      }
    }

    const patch: {
      parentDepartmentId?: string | null;
      code?: string;
      name?: string;
      updatedAt: Date;
      updatedBy: string | null;
    } = { updatedAt: new Date(), updatedBy: getPrincipal()?.userId ?? null };
    if (code !== undefined) patch.code = code;
    if (name !== undefined) patch.name = name;

    // Re-validate the hierarchy only when the parent actually changes: an
    // existing department whose parent was disabled afterwards must stay
    // editable (master-data-strategy.md §7.4).
    if (
      input.parentDepartmentId !== undefined &&
      input.parentDepartmentId !== current.parentDepartmentId
    ) {
      const parentId = input.parentDepartmentId;
      patch.parentDepartmentId = parentId;
      if (parentId !== null) {
        const edges = await this.repository.listHierarchyEdges(
          current.organizationId,
        );
        await this.assertParentAssignment({
          id,
          parentId,
          organizationId: current.organizationId,
          descendantIds: collectDescendantIds(edges, id),
          requireActiveParent: true,
        });
      }
    }

    const updated = await this.repository.update(id, patch);
    if (updated === null) throw AppException.notFound('Department', id);

    await publishEvent(this.events, {
      type: DEPARTMENT_UPDATED_EVENT,
      aggregateType: 'Department',
      aggregateId: updated.id,
      payload: {
        id: updated.id,
        organizationId: updated.organizationId,
        code: updated.code,
      },
    });
    return toDepartmentDto(updated);
  }

  async enableDepartment(id: string): Promise<DepartmentDto> {
    return this.setActive(id, true, DEPARTMENT_PERMISSIONS.ENABLE);
  }

  async disableDepartment(id: string): Promise<DepartmentDto> {
    return this.setActive(id, false, DEPARTMENT_PERMISSIONS.DISABLE);
  }

  /**
   * Cross-module / sibling-service reference resolution: the employee service
   * (and any future module) resolves an employee's department through this
   * method. A department from another organization is reported as not found.
   */
  async requireUsableDepartmentInOrganization(
    id: string,
    organizationId: string,
    options: { allowInactive?: boolean } = {},
  ): Promise<Department> {
    const department = await this.repository.findById(id);
    if (department === null || department.organizationId !== organizationId) {
      throw AppException.notFound('Department', id);
    }
    assertUsable('Department', department.isActive, {
      allowInactive: options.allowInactive ?? false,
    });
    return department;
  }

  // ---- internals ----------------------------------------------------------

  private async assertParentAssignment(params: {
    id: string;
    parentId: string;
    organizationId: string;
    descendantIds: readonly string[];
    requireActiveParent: boolean;
  }): Promise<void> {
    const parent = await this.repository.findById(params.parentId);
    if (parent === null) {
      throw AppException.notFound('Department', params.parentId);
    }
    const problem = findHierarchyProblem({
      id: params.id,
      parentId: params.parentId,
      organizationId: params.organizationId,
      parent: { organizationId: parent.organizationId },
      descendantIds: params.descendantIds,
    });
    if (problem !== null) {
      throw AppException.businessRule(
        hierarchyProblemMessage('department', problem),
      );
    }
    assertUsable('Department', parent.isActive, {
      allowInactive: !params.requireActiveParent,
    });
  }

  private async setActive(
    id: string,
    isActive: boolean,
    permission: string,
  ): Promise<DepartmentDto> {
    await this.authorization.requireAllPermissions([permission]);
    const current = await this.mustFind(id);
    if (current.isActive === isActive) return toDepartmentDto(current);

    const updated = await this.repository.update(id, {
      isActive,
      updatedAt: new Date(),
      updatedBy: getPrincipal()?.userId ?? null,
    });
    if (updated === null) throw AppException.notFound('Department', id);

    await publishEvent(this.events, {
      type: isActive ? DEPARTMENT_ENABLED_EVENT : DEPARTMENT_DISABLED_EVENT,
      aggregateType: 'Department',
      aggregateId: updated.id,
      payload: {
        id: updated.id,
        organizationId: updated.organizationId,
        code: updated.code,
      },
    });
    return toDepartmentDto(updated);
  }

  private async mustFind(id: string): Promise<Department> {
    const department = await this.repository.findById(id);
    if (department === null) throw AppException.notFound('Department', id);
    return department;
  }
}
