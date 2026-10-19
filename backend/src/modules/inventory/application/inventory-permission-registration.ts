import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PermissionRegistry } from '../../rbac/application/permission-registry.js';
import { INVENTORY_PERMISSION_DEFINITIONS } from '../domain/inventory-permissions.js';
import { INVENTORY_KARDEX_PERMISSION_DEFINITIONS } from '../domain/inventory-kardex-permissions.js';
import { INVENTORY_CORE_PERMISSION_DEFINITIONS } from '../domain/inventory-core-permissions.js';
import { MATERIAL_REQUEST_PERMISSION_DEFINITIONS } from '../domain/material-request-permissions.js';
import { INVENTORY_VALUATION_PERMISSION_DEFINITIONS } from '../domain/inventory-valuation-permissions.js';
import { INVENTORY_DOCUMENT_PERMISSION_DEFINITIONS } from '../domain/inventory-document-permissions.js';

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
 * Also registers the dedicated quantity Kardex read code, Material Request's
 * permission vocabulary (C-50), valuation (PDR-05) and Inventory Business
 * Document vocabulary (C-58) — same module, same startup hook, no separate
 * registration class: all are Inventory-owned, not new modules.
 */
@Injectable()
export class InventoryPermissionRegistration implements OnModuleInit {
  constructor(private readonly registry: PermissionRegistry) {}

  onModuleInit(): void {
    this.registry.register([
      ...INVENTORY_PERMISSION_DEFINITIONS,
      ...INVENTORY_KARDEX_PERMISSION_DEFINITIONS,
      ...INVENTORY_CORE_PERMISSION_DEFINITIONS,
      ...MATERIAL_REQUEST_PERMISSION_DEFINITIONS,
      ...INVENTORY_VALUATION_PERMISSION_DEFINITIONS,
      ...INVENTORY_DOCUMENT_PERMISSION_DEFINITIONS,
    ]);
  }
}
