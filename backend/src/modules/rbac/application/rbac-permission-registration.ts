import { Injectable, type OnModuleInit } from '@nestjs/common';
import { RBAC_PERMISSION_DEFINITIONS } from '../domain/rbac-permissions.js';
import { PermissionRegistry } from './permission-registry.js';

/**
 * Registers the RBAC module's own permission vocabulary at startup (AR-22).
 *
 * Same pattern as every other module (see `UsersPermissionRegistration`): the
 * owning module declares its codes, RBAC mirrors them. Failing here means two
 * modules disagree about a security identifier — the process must not boot.
 */
@Injectable()
export class RbacPermissionRegistration implements OnModuleInit {
  constructor(private readonly registry: PermissionRegistry) {}

  onModuleInit(): void {
    this.registry.register(RBAC_PERMISSION_DEFINITIONS);
  }
}
