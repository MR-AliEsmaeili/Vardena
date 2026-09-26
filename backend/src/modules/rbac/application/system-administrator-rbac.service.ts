import { Injectable } from '@nestjs/common';
import { generateId } from '../../../kernel/ids/ulid.js';
import { PermissionsRepository } from '../data/permissions.repository.js';
import { RolesRepository } from '../data/roles.repository.js';
import { PermissionRegistry } from './permission-registry.js';
import { PermissionSyncService } from './permission-sync.service.js';

export const SYSTEM_ADMINISTRATOR_ROLE_NAME = 'System Administrator';

const SYSTEM_ADMINISTRATOR_ROLE_DESCRIPTION =
  'Bootstrap administrator with every permission registered by the application.';

/**
 * RBAC-owned half of installation bootstrap.
 *
 * The code registry remains the only permission catalog (ADR-0006/AR-22).
 * This service first mirrors that catalog, resolves exactly those registered
 * rows, then creates ordinary Role → Permission and User → Role assignments.
 * It introduces no wildcard, role-name check, or runtime authorization bypass.
 */
@Injectable()
export class SystemAdministratorRbacService {
  constructor(
    private readonly registry: PermissionRegistry,
    private readonly permissionSync: PermissionSyncService,
    private readonly permissions: PermissionsRepository,
    private readonly roles: RolesRepository,
  ) {}

  async ensureForUser(userId: string): Promise<{
    roleId: string;
    permissionCount: number;
    roleCreated: boolean;
    userRoleCreated: boolean;
  }> {
    const syncResult = await this.permissionSync.sync();
    if (syncResult === null) {
      throw new Error(
        'Cannot bootstrap the system administrator because the permission catalog could not be synchronized.',
      );
    }

    const definitions = this.registry.all();
    const codes = definitions.map((definition) => definition.code);
    const mirrored = await this.permissions.findByCodes(codes);
    const mirroredByCode = new Map(
      mirrored.map((permission) => [permission.code, permission]),
    );
    const missingCount = codes.filter(
      (code) => !mirroredByCode.has(code),
    ).length;
    if (missingCount > 0 || mirrored.length !== definitions.length) {
      throw new Error(
        `Cannot bootstrap the system administrator because ${missingCount} registered permission(s) are missing from the database mirror.`,
      );
    }

    const ensured = await this.roles.ensureRoleWithPermissionsForUser({
      roleId: generateId(),
      roleName: SYSTEM_ADMINISTRATOR_ROLE_NAME,
      description: SYSTEM_ADMINISTRATOR_ROLE_DESCRIPTION,
      permissionIds: codes.map((code) => mirroredByCode.get(code)!.id),
      userId,
      now: new Date(),
    });
    if (ensured.permissionCount !== definitions.length) {
      throw new Error(
        'System Administrator permission reconciliation completed with an unexpected assignment count.',
      );
    }

    return {
      roleId: ensured.role.id,
      permissionCount: ensured.permissionCount,
      roleCreated: ensured.roleCreated,
      userRoleCreated: ensured.userRoleCreated,
    };
  }
}
