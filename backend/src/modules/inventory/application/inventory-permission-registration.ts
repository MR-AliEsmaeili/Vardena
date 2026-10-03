import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PermissionRegistry } from '../../rbac/application/permission-registry.js';
import { INVENTORY_PERMISSION_DEFINITIONS } from '../domain/inventory-permissions.js';
import { INVENTORY_CORE_PERMISSION_DEFINITIONS } from '../domain/inventory-core-permissions.js';
import { MATERIAL_REQUEST_PERMISSION_DEFINITIONS } from '../domain/material-request-permissions.js';

/**
 * Registers the Inventory module's permission vocabulary in the RBAC registry
 * at startup (AR-22, ADR-0006): the Task 6 master-data codes plus the Task 7
 * core codes (ADR-0022).
 *
 * The module owns the codes and descriptions; RBAC owns the registry, the
 * `rbac.permissions` mirror and evaluation. A malformed or duplicated code
 * fails module initialization instead of silently producing a permission
 * nobody can enforce.
 *
 * Also registers Material Request's permission vocabulary (C-50) — same
 * module, same startup hook, no separate registration class: Material
 * Request is Inventory-owned, not a new module.
 */
@Injectable()
export class InventoryPermissionRegistration implements OnModuleInit {
  constructor(private readonly registry: PermissionRegistry) {}

  onModuleInit(): void {
    this.registry.register([
      ...INVENTORY_PERMISSION_DEFINITIONS,
      ...INVENTORY_CORE_PERMISSION_DEFINITIONS,
      ...MATERIAL_REQUEST_PERMISSION_DEFINITIONS,
    ]);
  }
}
