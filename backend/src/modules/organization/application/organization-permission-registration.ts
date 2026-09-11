import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PermissionRegistry } from '../../rbac/application/permission-registry.js';
import { ORGANIZATION_PERMISSION_DEFINITIONS } from '../domain/organization-permissions.js';

/**
 * Registers the Organization module's permission vocabulary in the RBAC
 * registry at startup (AR-22, ADR-0006) — the same mechanism the Users module
 * uses (`UsersPermissionRegistration`).
 *
 * The module owns the codes and descriptions; RBAC owns the registry, the
 * `rbac.permissions` mirror and evaluation. Registration is a startup side
 * effect, so a malformed or duplicated code fails module initialization
 * instead of silently producing a permission nobody can enforce.
 */
@Injectable()
export class OrganizationPermissionRegistration implements OnModuleInit {
  constructor(private readonly registry: PermissionRegistry) {}

  onModuleInit(): void {
    this.registry.register(ORGANIZATION_PERMISSION_DEFINITIONS);
  }
}
