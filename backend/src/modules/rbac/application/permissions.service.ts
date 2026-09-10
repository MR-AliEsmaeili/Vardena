import { Injectable } from '@nestjs/common';
import { AppException } from '../../../kernel/errors/app-exception.js';
import type { PaginatedResult } from '../../../kernel/pagination/paginated-result.js';
import {
  toOffset,
  toPaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { PermissionsRepository } from '../data/permissions.repository.js';
import type { Permission, PermissionRef } from '../domain/permission.js';
import {
  isValidPermissionCode,
  PERMISSION_CODE_RULE,
} from '../domain/permission-code.js';
import { PermissionRegistry } from './permission-registry.js';

/** Sortable fields for the permission list (anything else is rejected). */
const SORTABLE_FIELDS: Record<string, string> = {
  code: 'code',
  createdAt: 'createdAt',
};

export interface ListPermissionsQuery {
  page: number;
  pageSize: number;
  sort?: string | undefined;
}

/**
 * Permission queries (docs/modules.md §RBAC API).
 *
 * Permissions are configuration/reference data: this service exposes *reads*
 * and the assignment-side validation used by `RolesService`. There is
 * deliberately no create/update/delete path — permissions come from the code
 * registry (ADR-0006), so an API caller can never invent a security code.
 */
@Injectable()
export class PermissionsService {
  constructor(
    private readonly registry: PermissionRegistry,
    private readonly repository: PermissionsRepository,
  ) {}

  /** List the mirrored permission registry (paginated, deterministic order). */
  async list(
    query: ListPermissionsQuery,
  ): Promise<PaginatedResult<PermissionRef>> {
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      orderBy: resolveOrderBy(query.sort),
      skip,
      take,
    });
    return toPaginatedResult(items, total, query.page, query.pageSize);
  }

  /**
   * Resolve a permission code that a caller wants to assign.
   *
   * Two gates, in this order:
   * 1. the code must be well-formed (`Module.Entity.Action`) — a client typo
   *    is a validation error, not a 404;
   * 2. the code must exist in the code registry AND in its database mirror —
   *    anything else is "no such permission" (404). This enforces "a
   *    permission no code checks cannot be assigned".
   */
  async resolveAssignablePermission(code: string): Promise<Permission> {
    if (!isValidPermissionCode(code)) {
      throw AppException.validation([
        {
          field: 'code',
          message: PERMISSION_CODE_RULE,
          code: 'isPermissionCode',
        },
      ]);
    }
    if (!this.registry.has(code)) {
      throw AppException.notFound('Permission', code);
    }
    const permission = await this.repository.findByCode(code);
    if (permission === null) {
      // Registry knows the code but the mirror row is missing (e.g. the
      // startup sync has not run yet, or the database is behind the code).
      // Treat as not-found: assigning a permission that does not exist in the
      // RBAC tables would create a dangling assignment.
      throw AppException.notFound('Permission', code);
    }
    return permission;
  }

  /**
   * Resolve several permission codes at once (role creation). Fails on the
   * first unknown/malformed code — all-or-nothing, so a role never ends up
   * with a partially applied permission set.
   */
  async resolveAssignablePermissions(
    codes: readonly string[],
  ): Promise<Permission[]> {
    const resolved: Permission[] = [];
    for (const code of codes) {
      resolved.push(await this.resolveAssignablePermission(code));
    }
    return resolved;
  }
}

// ---- Internal helpers ----

function resolveOrderBy(
  sort: string | undefined,
): Array<Record<string, 'asc' | 'desc'>> {
  if (sort === undefined || sort === '') return [{ code: 'asc' }];
  return sort.split(',').map((entry) => {
    const [field, direction] = entry.split(':');
    const mapped = field === undefined ? undefined : SORTABLE_FIELDS[field];
    if (mapped === undefined || (direction !== 'asc' && direction !== 'desc')) {
      throw AppException.validation([
        {
          field: 'sort',
          message: `Cannot sort permissions by "${field ?? ''}". Allowed: ${Object.keys(SORTABLE_FIELDS).join(', ')}.`,
          code: 'isSortableField',
        },
      ]);
    }
    return { [mapped]: direction };
  });
}
