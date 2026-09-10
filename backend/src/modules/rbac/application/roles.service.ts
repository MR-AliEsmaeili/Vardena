import { Inject, Injectable } from '@nestjs/common';
import {
  getCorrelationId,
  getPrincipal,
} from '../../../kernel/correlation/request-context.js';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import type { PaginatedResult } from '../../../kernel/pagination/paginated-result.js';
import {
  toOffset,
  toPaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { RolesRepository } from '../data/roles.repository.js';
import { isUniqueViolation } from '../data/prisma-errors.js';
import type { PermissionRef } from '../domain/permission.js';
import { RBAC_PERMISSIONS } from '../domain/rbac-permissions.js';
import {
  assignmentAggregateId,
  ROLE_CREATED_EVENT,
  ROLE_PERMISSION_ASSIGNED_EVENT,
  ROLE_PERMISSION_REMOVED_EVENT,
  ROLE_UPDATED_EVENT,
  type RoleCreatedEvent,
  type RolePermissionAssignedEvent,
  type RolePermissionRemovedEvent,
  type RoleUpdatedEvent,
} from '../domain/rbac.events.js';
import {
  MAX_ROLE_DESCRIPTION_LENGTH,
  MAX_ROLE_NAME_LENGTH,
  type Role,
  type RoleWithPermissions,
} from '../domain/role.js';
import { AuthorizationService } from './authorization.service.js';
import { PermissionsService } from './permissions.service.js';

/** Sortable fields for the role list (anything else is rejected). */
const SORTABLE_FIELDS: Record<string, string> = {
  name: 'name',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

export interface ListRolesQuery {
  page: number;
  pageSize: number;
  sort?: string | undefined;
}

export interface CreateRoleInput {
  name: string;
  description?: string | null | undefined;
  permissionCodes?: string[] | undefined;
}

export interface UpdateRoleInput {
  name?: string | undefined;
  description?: string | null | undefined;
}

/**
 * Role administration (docs/modules.md §RBAC, task §16).
 *
 * Responsibilities: role lifecycle + role ↔ permission assignment. All
 * writes are guarded twice — the route guard (defense in depth) and the
 * `requireAllPermissions` check below (the authoritative layer, AR-04/AR-21) —
 * and every change publishes a domain event for the future Audit module
 * (task §21/§22).
 *
 * Deliberately absent: role deletion. Role lifecycle (delete vs. deactivate)
 * and the protection of roles that are still assigned are not defined in the
 * repository, so inventing behaviour here would be a business rule — see
 * OQ-20.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly repository: RolesRepository,
    private readonly permissions: PermissionsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  async listRoles(
    query: ListRolesQuery,
  ): Promise<PaginatedResult<RoleSummary>> {
    await this.authorization.requireAllPermissions([
      RBAC_PERMISSIONS.ROLE_VIEW,
    ]);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      orderBy: resolveOrderBy(query.sort),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map((entry) => toRoleSummary(entry)),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getRole(id: string): Promise<RoleDetail> {
    await this.authorization.requireAllPermissions([
      RBAC_PERMISSIONS.ROLE_VIEW,
    ]);
    const found = await this.repository.findWithPermissions(id);
    if (found === null) {
      throw AppException.notFound('Role', id);
    }
    return toRoleDetail(found);
  }

  /**
   * Create a role, optionally with its initial permission set, in a single
   * transaction (§23): the permission mirror is resolved *before* the write so
   * an unknown code cannot leave a half-built role behind.
   */
  async createRole(input: CreateRoleInput): Promise<RoleDetail> {
    await this.authorization.requireAllPermissions([
      RBAC_PERMISSIONS.ROLE_CREATE,
    ]);
    const name = normalizeName(input.name);
    const description = normalizeDescription(input.description);
    const permissionCodes = [...new Set(input.permissionCodes ?? [])];

    const existing = await this.repository.findByName(name);
    if (existing !== null) {
      throw AppException.conflict('A role with that name already exists.');
    }
    const permissions =
      await this.permissions.resolveAssignablePermissions(permissionCodes);

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const role = await this.repository.createWithPermissions({
      id: generateId(),
      name,
      description,
      permissionIds: permissions.map((permission) => permission.id),
      now,
      createdBy: actorId,
    });

    const event: RoleCreatedEvent = {
      type: ROLE_CREATED_EVENT,
      aggregateType: 'Role',
      aggregateId: role.id,
      payload: {
        roleId: role.id,
        name: role.name,
        permissionCodes: permissions.map((permission) => permission.code),
      },
      correlationId: getCorrelationId(),
      occurredAt: now.getTime(),
    };
    await this.events.publish(event);
    this.logger.log(
      'Role created',
      { roleId: role.id, permissionCount: permissions.length },
      RolesService.name,
    );

    const created = await this.repository.findWithPermissions(role.id);
    return toRoleDetail(
      created ?? { role, permissions: permissions.map(toPermissionRef) },
    );
  }

  async updateRole(id: string, input: UpdateRoleInput): Promise<RoleDetail> {
    await this.authorization.requireAllPermissions([
      RBAC_PERMISSIONS.ROLE_EDIT,
    ]);
    const existing = await this.repository.findById(id);
    if (existing === null) {
      throw AppException.notFound('Role', id);
    }

    const patch: {
      name?: string;
      description?: string | null;
      updatedAt: Date;
      updatedBy: string | null;
    } = { updatedAt: new Date(), updatedBy: getPrincipal()?.userId ?? null };

    if (input.name !== undefined) {
      const name = normalizeName(input.name);
      if (name !== existing.name) {
        const clash = await this.repository.findByName(name);
        if (clash !== null) {
          throw AppException.conflict('A role with that name already exists.');
        }
        patch.name = name;
      }
    }
    if (input.description !== undefined) {
      patch.description = normalizeDescription(input.description);
    }

    const updated = await this.repository.update(id, patch);
    if (updated === null) {
      throw AppException.notFound('Role', id);
    }

    const event: RoleUpdatedEvent = {
      type: ROLE_UPDATED_EVENT,
      aggregateType: 'Role',
      aggregateId: updated.id,
      payload: { roleId: updated.id, name: updated.name },
      correlationId: getCorrelationId(),
      occurredAt: patch.updatedAt.getTime(),
    };
    await this.events.publish(event);

    const withPermissions = await this.repository.findWithPermissions(id);
    return toRoleDetail(withPermissions ?? { role: updated, permissions: [] });
  }

  /** Assign one permission to a role. Idempotency is *not* implied: a second
   * assignment is a conflict, because the caller asked for a state change that
   * is already true (and the DB says so via its composite primary key). */
  async assignPermissionToRole(roleId: string, code: string): Promise<void> {
    await this.authorization.requireAllPermissions([
      RBAC_PERMISSIONS.ROLE_PERMISSION_ASSIGN,
    ]);
    const role = await this.repository.findById(roleId);
    if (role === null) {
      throw AppException.notFound('Role', roleId);
    }
    const permission = await this.permissions.resolveAssignablePermission(code);

    const now = new Date();
    try {
      await this.repository.addPermission({
        roleId,
        permissionId: permission.id,
        now,
        createdBy: getPrincipal()?.userId ?? null,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'That permission is already assigned to this role.',
        );
      }
      throw error;
    }

    const event: RolePermissionAssignedEvent = {
      type: ROLE_PERMISSION_ASSIGNED_EVENT,
      aggregateType: 'RolePermission',
      aggregateId: assignmentAggregateId(roleId, permission.code),
      payload: { roleId, permissionCode: permission.code },
      correlationId: getCorrelationId(),
      occurredAt: now.getTime(),
    };
    await this.events.publish(event);
    this.logger.log(
      'Permission assigned to role',
      { roleId, permissionCode: permission.code },
      RolesService.name,
    );
  }

  async removePermissionFromRole(roleId: string, code: string): Promise<void> {
    await this.authorization.requireAllPermissions([
      RBAC_PERMISSIONS.ROLE_PERMISSION_REMOVE,
    ]);
    const role = await this.repository.findById(roleId);
    if (role === null) {
      throw AppException.notFound('Role', roleId);
    }
    const permission = await this.permissions.resolveAssignablePermission(code);

    const removed = await this.repository.removePermission(
      roleId,
      permission.id,
    );
    if (!removed) {
      throw AppException.notFound('RolePermission', code);
    }

    const now = Date.now();
    const event: RolePermissionRemovedEvent = {
      type: ROLE_PERMISSION_REMOVED_EVENT,
      aggregateType: 'RolePermission',
      aggregateId: assignmentAggregateId(roleId, permission.code),
      payload: { roleId, permissionCode: permission.code },
      correlationId: getCorrelationId(),
      occurredAt: now,
    };
    await this.events.publish(event);
    this.logger.log(
      'Permission removed from role',
      { roleId, permissionCode: permission.code },
      RolesService.name,
    );
  }
}

// ---- Response shapes (transport DTOs map these 1:1) ----

export interface RoleSummary {
  id: string;
  name: string;
  description: string | null;
  permissionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoleDetail extends RoleSummary {
  permissions: PermissionRef[];
}

// ---- Internal helpers ----

function toRoleSummary(entry: {
  role: Role;
  permissionCount: number;
}): RoleSummary {
  return {
    id: entry.role.id,
    name: entry.role.name,
    description: entry.role.description,
    permissionCount: entry.permissionCount,
    createdAt: entry.role.createdAt.toISOString(),
    updatedAt: entry.role.updatedAt.toISOString(),
  };
}

function toRoleDetail(found: RoleWithPermissions): RoleDetail {
  return {
    id: found.role.id,
    name: found.role.name,
    description: found.role.description,
    permissionCount: found.permissions.length,
    permissions: found.permissions,
    createdAt: found.role.createdAt.toISOString(),
    updatedAt: found.role.updatedAt.toISOString(),
  };
}

function toPermissionRef(permission: {
  code: string;
  description: string;
}): PermissionRef {
  return { code: permission.code, description: permission.description };
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw AppException.validation([
      { field: 'name', message: 'Role name is required.', code: 'isNotEmpty' },
    ]);
  }
  if (trimmed.length > MAX_ROLE_NAME_LENGTH) {
    throw AppException.validation([
      {
        field: 'name',
        message: `Role name must be at most ${MAX_ROLE_NAME_LENGTH} characters.`,
        code: 'maxLength',
      },
    ]);
  }
  return trimmed;
}

function normalizeDescription(
  description: string | null | undefined,
): string | null {
  if (description === undefined || description === null) return null;
  const trimmed = description.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_ROLE_DESCRIPTION_LENGTH) {
    throw AppException.validation([
      {
        field: 'description',
        message: `Description must be at most ${MAX_ROLE_DESCRIPTION_LENGTH} characters.`,
        code: 'maxLength',
      },
    ]);
  }
  return trimmed;
}

function resolveOrderBy(
  sort: string | undefined,
): Array<Record<string, 'asc' | 'desc'>> {
  if (sort === undefined || sort === '') return [{ createdAt: 'desc' }];
  return sort.split(',').map((entry) => {
    const [field, direction] = entry.split(':');
    const mapped = field === undefined ? undefined : SORTABLE_FIELDS[field];
    if (mapped === undefined || (direction !== 'asc' && direction !== 'desc')) {
      throw AppException.validation([
        {
          field: 'sort',
          message: `Cannot sort roles by "${field ?? ''}". Allowed: ${Object.keys(SORTABLE_FIELDS).join(', ')}.`,
          code: 'isSortableField',
        },
      ]);
    }
    return { [mapped]: direction };
  });
}
