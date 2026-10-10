import { Module, forwardRef } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { AccountingModule } from '../accounting/accounting.module.js';
import { UnitsRepository } from './data/units.repository.js';
import { ItemGroupsRepository } from './data/item-groups.repository.js';
import { ItemsRepository } from './data/items.repository.js';
import { UnitConversionsRepository } from './data/unit-conversions.repository.js';
import { WarehousesRepository } from './data/warehouses.repository.js';
import { InventoryMovementsRepository } from './data/inventory-movements.repository.js';
import { InventoryKardexRepository } from './data/inventory-kardex.repository.js';
import { InventoryReservationsRepository } from './data/inventory-reservations.repository.js';
import { InventoryBalancesRepository } from './data/inventory-balances.repository.js';
import { InventoryOperationsRepository } from './data/inventory-operations.repository.js';
import { InventoryValuationRepository } from './data/inventory-valuation.repository.js';
import { ItemValuationMethodsRepository } from './data/item-valuation-methods.repository.js';
import { MaterialRequestsRepository } from './data/material-requests.repository.js';
import { InventoryBusinessDocumentsRepository } from './data/inventory-business-documents.repository.js';
import { InventoryAccountingPostingRepository } from './data/inventory-accounting-posting.repository.js';
import { InventoryPricingRepository } from './data/inventory-pricing.repository.js';
import { UnitsService } from './application/units.service.js';
import { ItemGroupsService } from './application/item-groups.service.js';
import { ItemsService } from './application/items.service.js';
import { UnitConversionsService } from './application/unit-conversions.service.js';
import { WarehousesService } from './application/warehouses.service.js';
import { InventoryMovementsService } from './application/inventory-movements.service.js';
import { InventoryKardexService } from './application/inventory-kardex.service.js';
import { InventoryTransfersService } from './application/inventory-transfers.service.js';
import { InventoryReservationsService } from './application/inventory-reservations.service.js';
import { InventoryBalancesService } from './application/inventory-balances.service.js';
import { InventoryValuationService } from './application/inventory-valuation.service.js';
import { InventoryPermissionRegistration } from './application/inventory-permission-registration.js';
import { MaterialRequestDocumentTypeRegistration } from './application/material-request-document-type-registration.js';
import { MaterialRequestsService } from './application/material-requests.service.js';
import { InventoryBusinessDocumentsService } from './application/inventory-business-documents.service.js';
import { InventoryAccountingPostingService } from './application/inventory-accounting-posting.service.js';
import { InventoryPricingService } from './application/inventory-pricing.service.js';
import { InventoryDocumentTypeRegistration } from './application/inventory-document-type-registration.js';
import { UnitsController } from './api/units.controller.js';
import { ItemGroupsController } from './api/item-groups.controller.js';
import { ItemsController } from './api/items.controller.js';
import { UnitConversionsController } from './api/unit-conversions.controller.js';
import { WarehousesController } from './api/warehouses.controller.js';
import { InventoryMovementsController } from './api/inventory-movements.controller.js';
import { InventoryKardexController } from './api/inventory-kardex.controller.js';
import { InventoryTransfersController } from './api/inventory-transfers.controller.js';
import { InventoryReservationsController } from './api/inventory-reservations.controller.js';
import { InventoryBalancesController } from './api/inventory-balances.controller.js';
import { InventoryValuationController } from './api/inventory-valuation.controller.js';
import { MaterialRequestsController } from './api/material-requests.controller.js';
import { InventoryBusinessDocumentsController } from './api/inventory-business-documents.controller.js';
import { InventoryPricingController } from './api/inventory-pricing.controller.js';

/**
 * Inventory module (docs/modules.md §Inventory, ADR-0017, ADR-0020, ADR-0021,
 * ADR-0022).
 *
 * Owns schema `inventory`. Task 6 implemented the **master-data** half —
 * units, unit conversions, item groups, items and warehouses
 * (master-data-strategy.md §3/§4, D-25/D-26). Task 7 adds the **core**
 * transactional half: the immutable movement ledger, the materialized
 * balance projection, reservations, atomic transfers, and ledger
 * reconciliation (ADR-0022). PDR-05/ADR-0039 add the VALUE half of that same
 * ledger: effective-dated valuation-method configuration, the Moving
 * Weighted Average state per item and warehouse, cost-optional postings, and
 * the explicit bounded recalculation. Documents and lot/serial/expiry
 * tracking stay out of scope (they arrive with later tasks), and so does
 * posting inventory value into Accounting — Inventory owns valuation,
 * Accounting owns journals.
 *
 * Public surface (AR-07) — the application services are exported so future
 * document modules resolve items, units, warehouses and balances through them
 * and never read `inventory.*` tables. Each exposes `requireUsable*` / query
 * methods that carry no permission of their own: the calling service has
 * already performed its own authorization check. The business-document
 * service owns the Jalali-history query and uses Organization's public
 * `withBusinessDateWriteLock` contract for every create/edit transaction; the
 * root composition layer supplies the history reader for the transition.
 *
 * Dependencies:
 * - `RbacModule` — `AuthorizationService` and `PermissionRegistry` for the
 *   `Inventory.*` codes,
 * - `IdentityModule` — `AuthGuard`; `forwardRef` because the composition graph
 *   contains a cycle (`IdentityModule` → `UsersModule` → …), not a data cycle,
 * - `OrganizationModule` — the Inventory data is organization-scoped and its
 *   branch references are resolved through `OrganizationsService` /
 *   `BranchesService`. One direction only: Organization never imports
 *   Inventory, so there is no cycle here.
 * - `DocumentsModule` (C-50) — Material Request allocates its number via
 *   `NumberingService` and records invocation into a subsequent process via
 *   `DocumentRelationsService`; one direction only, same as Accounting's own
 *   `DocumentsModule` import.
 */
@Module({
  imports: [
    RbacModule,
    OrganizationModule,
    DocumentsModule,
    // C-62: the one direction the Inventory → Accounting boundary runs.
    // Accounting does NOT import Inventory (verified), so this is not a cycle;
    // `forwardRef` is not needed and would only hide a real one.
    AccountingModule,
    forwardRef(() => IdentityModule),
  ],
  controllers: [
    UnitsController,
    ItemGroupsController,
    ItemsController,
    UnitConversionsController,
    WarehousesController,
    InventoryMovementsController,
    InventoryKardexController,
    InventoryTransfersController,
    InventoryReservationsController,
    InventoryBalancesController,
    InventoryValuationController,
    MaterialRequestsController,
    InventoryBusinessDocumentsController,
    InventoryPricingController,
  ],
  providers: [
    UnitsRepository,
    ItemGroupsRepository,
    ItemsRepository,
    UnitConversionsRepository,
    WarehousesRepository,
    InventoryMovementsRepository,
    InventoryKardexRepository,
    InventoryReservationsRepository,
    InventoryBalancesRepository,
    InventoryOperationsRepository,
    InventoryValuationRepository,
    ItemValuationMethodsRepository,
    MaterialRequestsRepository,
    InventoryBusinessDocumentsRepository,
    InventoryAccountingPostingRepository,
    InventoryPricingRepository,
    UnitsService,
    ItemGroupsService,
    ItemsService,
    UnitConversionsService,
    WarehousesService,
    InventoryMovementsService,
    InventoryKardexService,
    InventoryTransfersService,
    InventoryReservationsService,
    InventoryBalancesService,
    InventoryValuationService,
    MaterialRequestsService,
    InventoryBusinessDocumentsService,
    InventoryAccountingPostingService,
    InventoryPricingService,
    InventoryPermissionRegistration,
    MaterialRequestDocumentTypeRegistration,
    InventoryDocumentTypeRegistration,
  ],
  exports: [
    UnitsService,
    ItemGroupsService,
    ItemsService,
    UnitConversionsService,
    WarehousesService,
    InventoryMovementsService,
    InventoryTransfersService,
    InventoryReservationsService,
    InventoryBalancesService,
    InventoryValuationService,
    InventoryBusinessDocumentsService,
    InventoryAccountingPostingService,
    InventoryPricingService,
  ],
})
export class InventoryModule {}
