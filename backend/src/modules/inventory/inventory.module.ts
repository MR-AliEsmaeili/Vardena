import { Module, forwardRef } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { UnitsRepository } from './data/units.repository.js';
import { ItemGroupsRepository } from './data/item-groups.repository.js';
import { ItemsRepository } from './data/items.repository.js';
import { UnitConversionsRepository } from './data/unit-conversions.repository.js';
import { WarehousesRepository } from './data/warehouses.repository.js';
import { UnitsService } from './application/units.service.js';
import { ItemGroupsService } from './application/item-groups.service.js';
import { ItemsService } from './application/items.service.js';
import { UnitConversionsService } from './application/unit-conversions.service.js';
import { WarehousesService } from './application/warehouses.service.js';
import { InventoryPermissionRegistration } from './application/inventory-permission-registration.js';
import { UnitsController } from './api/units.controller.js';
import { ItemGroupsController } from './api/item-groups.controller.js';
import { ItemsController } from './api/items.controller.js';
import { UnitConversionsController } from './api/unit-conversions.controller.js';
import { WarehousesController } from './api/warehouses.controller.js';

/**
 * Inventory module (docs/modules.md §Inventory, ADR-0017, ADR-0020, ADR-0021).
 *
 * Owns schema `inventory`. Task 6 implements only the **master-data** half of
 * the module — units, unit conversions, item groups, items and warehouses
 * (master-data-strategy.md §3/§4, D-25/D-26). The transactional half (receipts,
 * issues, transfers, adjustments, stock balances, reservations, valuation) is
 * explicitly out of scope and arrives with later tasks; no ledger, movement or
 * balance table exists yet.
 *
 * Public surface (AR-07) — the five application services are exported so future
 * document modules resolve items, units and warehouses through them and never
 * read `inventory.*` tables. Each exposes a `requireUsable*` method that
 * carries no permission of its own: the calling service has already performed
 * its own authorization check.
 *
 * Dependencies:
 * - `RbacModule` — `AuthorizationService` and `PermissionRegistry` for the
 *   `Inventory.*` codes,
 * - `IdentityModule` — `AuthGuard`; `forwardRef` because the composition graph
 *   contains a cycle (`IdentityModule` → `UsersModule` → …), not a data cycle,
 * - `OrganizationModule` — the Inventory master data is organization-scoped and
 *   its branch references are resolved through `OrganizationsService` /
 *   `BranchesService`. One direction only: Organization never imports
 *   Inventory, so there is no cycle here.
 */
@Module({
  imports: [RbacModule, OrganizationModule, forwardRef(() => IdentityModule)],
  controllers: [
    UnitsController,
    ItemGroupsController,
    ItemsController,
    UnitConversionsController,
    WarehousesController,
  ],
  providers: [
    UnitsRepository,
    ItemGroupsRepository,
    ItemsRepository,
    UnitConversionsRepository,
    WarehousesRepository,
    UnitsService,
    ItemGroupsService,
    ItemsService,
    UnitConversionsService,
    WarehousesService,
    InventoryPermissionRegistration,
  ],
  exports: [
    UnitsService,
    ItemGroupsService,
    ItemsService,
    UnitConversionsService,
    WarehousesService,
  ],
})
export class InventoryModule {}
