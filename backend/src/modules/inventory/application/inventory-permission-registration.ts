import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PermissionRegistry } from '../../rbac/application/permission-registry.js';
import { INVENTORY_PERMISSION_DEFINITIONS } from '../domain/inventory-permissions.js';

/**
 * Registers the Inventory module's master-data permission vocabulary in the
 * RBAC registry at startup (AR-22, ADR-0006).
 *
 * The module owns the codes and descriptions; RBAC owns the registry, the
 * `rbac.permissions` mirror and evaluation. A malformed or duplicated code
 * fails module initialization instead of silently producing a permission
 * nobody can enforce.
 */
@Injectable()
export class InventoryPermissionRegistration implements OnModuleInit {
  constructor(private readonly registry: PermissionRegistry) {}

  onModuleInit(): void {
    this.registry.register(INVENTORY_PERMISSION_DEFINITIONS);
  }
}
