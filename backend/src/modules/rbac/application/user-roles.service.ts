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
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { RolesRepository } from '../data/roles.repository.js';
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from '../data/prisma-errors.js';
import { UserRolesRepository } from '../data/user-roles.repository.js';
import { RBAC_PERMISSIONS } from '../domain/rbac-permissions.js';
import {
  assignmentAggregateId,
  USER_ROLE_ASSIGNED_EVENT,
  USER_ROLE_REMOVED_EVENT,
  type UserRoleAssignedEvent,
  type UserRoleRemovedEvent,
} from '../domain/rbac.events.js';
import { AuthorizationService } from './authorization.service.js';

/**
 * User ↔ role assignment (docs/modules.md §RBAC, task §16).
 *
 * The user side of the relation lives in `rbac.user_roles` (RBAC-owned data);
 * the database foreign key `fk_rbac_user_roles_user` is what proves a user
 * exists, so RBAC never reads the Users module's tables (AR-07). A role that
 * does not exist is rejected from RBAC's own table; an unknown user is
 * reported as `EntityNotFound(User)` from the foreign-key violation.
 */
@Injectable()
export class UserRolesService {
  constructor(
    private readonly roles: RolesRepository,
    private readonly userRoles: UserRolesRepository,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  /** Roles assigned to a user (self-service read is done via `/auth/me/permissions`). */
  async listRoleIdsForUser(userId: string): Promise<string[]> {
    await this.authorization.requireAllPermissions([
      RBAC_PERMISSIONS.ROLE_VIEW,
    ]);
    return this.userRoles.listRoleIdsForUser(userId);
  }

  async assignRoleToUser(roleId: string, userId: string): Promise<void> {
    await this.authorization.requireAllPermissions([
      RBAC_PERMISSIONS.USER_ROLE_ASSIGN,
    ]);
    await this.assertRoleExists(roleId);

    const now = new Date();
    try {
      await this.userRoles.assign({
        userId,
        roleId,
        now,
        createdBy: getPrincipal()?.userId ?? null,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'That role is already assigned to this user.',
        );
      }
      if (isForeignKeyViolation(error)) {
        // The only foreign key that can fail here is the user one: the role was
        // already checked in RBAC's own table.
        throw AppException.notFound('User', userId);
      }
      throw error;
    }

    const event: UserRoleAssignedEvent = {
      type: USER_ROLE_ASSIGNED_EVENT,
      aggregateType: 'UserRole',
      aggregateId: assignmentAggregateId(userId, roleId),
      payload: { userId, roleId },
      correlationId: getCorrelationId(),
      occurredAt: now.getTime(),
    };
    await this.events.publish(event);
    this.logger.log(
      'Role assigned to user',
      { userId, roleId },
      UserRolesService.name,
    );
  }

  async removeRoleFromUser(roleId: string, userId: string): Promise<void> {
    await this.authorization.requireAllPermissions([
      RBAC_PERMISSIONS.USER_ROLE_REMOVE,
    ]);
    await this.assertRoleExists(roleId);

    const removed = await this.userRoles.remove(userId, roleId);
    if (!removed) {
      throw AppException.notFound('UserRole', `${userId}:${roleId}`);
    }

    const event: UserRoleRemovedEvent = {
      type: USER_ROLE_REMOVED_EVENT,
      aggregateType: 'UserRole',
      aggregateId: assignmentAggregateId(userId, roleId),
      payload: { userId, roleId },
      correlationId: getCorrelationId(),
      occurredAt: Date.now(),
    };
    await this.events.publish(event);
    this.logger.log(
      'Role removed from user',
      { userId, roleId },
      UserRolesService.name,
    );
  }

  private async assertRoleExists(roleId: string): Promise<void> {
    const role = await this.roles.findById(roleId);
    if (role === null) {
      throw AppException.notFound('Role', roleId);
    }
  }
}
