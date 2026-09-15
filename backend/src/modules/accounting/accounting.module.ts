import { Module, forwardRef } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { FinancialAreasRepository } from './data/financial-areas.repository.js';
import { FiscalYearsRepository } from './data/fiscal-years.repository.js';
import { AccountingPeriodsRepository } from './data/accounting-periods.repository.js';
import { CodingStructuresRepository } from './data/coding-structures.repository.js';
import { AccountsRepository } from './data/accounts.repository.js';
import { FinancialAreasService } from './application/financial-areas.service.js';
import { FiscalYearsService } from './application/fiscal-years.service.js';
import { AccountingPeriodsService } from './application/accounting-periods.service.js';
import { CodingStructuresService } from './application/coding-structures.service.js';
import { AccountsService } from './application/accounts.service.js';
import { AccountingPermissionRegistration } from './application/accounting-permission-registration.js';
import { FinancialAreasController } from './api/financial-areas.controller.js';
import { FiscalYearsController } from './api/fiscal-years.controller.js';
import { AccountingPeriodsController } from './api/accounting-periods.controller.js';
import { CodingStructuresController } from './api/coding-structures.controller.js';
import { AccountsController } from './api/accounts.controller.js';

/**
 * Accounting module — foundation + chart structure (Task 10.2, Task 10.3;
 * ADR-0026, docs/accounting/domain-contract.md §4…§9, §14).
 *
 * Owns schema `accounting`: financial areas, fiscal years, accounting periods
 * (the bookkeeping scope spine) plus the coding structure and the chart of
 * accounts (the account-structure spine). Detail dimensions, accounting
 * documents, posting rules and balance projections arrive with later tasks
 * (contract §28.2) and must not be anticipated here (AR-29).
 *
 * Public surface (AR-07) — the application services are exported so future
 * posting flows resolve areas/years/periods/accounts through them and never
 * read `accounting.*` tables: `FiscalYearsService` exposes
 * `requireUsableFiscalYearInOrganization`, `FinancialAreasService` exposes
 * `requireUsableFinancialAreaInOrganization` and `AccountsService` exposes
 * `requireUsableAccountInOrganization` (existence + organization scope +
 * usability; postability itself is the posting task's rule, AC-I-09). None of
 * them carries a permission of its own, because the calling service has already
 * performed its own authorization check.
 *
 * Dependencies:
 * - `RbacModule` — `AuthorizationService` (the application-service check)
 *   and `PermissionRegistry` (registering the `Accounting.*` codes),
 * - `IdentityModule` — `AuthGuard`. `forwardRef` for the same reason as in
 *   `UsersModule`: a composition cycle, not a data cycle.
 * - `OrganizationModule` — the calendar and the chart are organization-scoped
 *   and the organization root is resolved through `OrganizationsService`. One
 *   direction only: Organization never imports Accounting, so there is no
 *   cycle here. No membership logic is duplicated: the coding structure and
 *   the chart hang off the same organization scope the areas/years use
 *   (contract §4/§5.4, AC-D-04), and NO financial-area membership is invented
 *   for accounts (area applicability is a posting-time concern and an open
 *   OQ-40 question about chart scope).
 *
 * Within the module, `AccountsService` consumes `CodingStructuresService` for
 * structure resolution (constructor injection, one direction) so no service
 * reaches around into another aggregate's repository, and both stay
 * `application/` → `data/` (AR-02).
 */
@Module({
  imports: [RbacModule, forwardRef(() => IdentityModule), OrganizationModule],
  controllers: [
    FinancialAreasController,
    FiscalYearsController,
    AccountingPeriodsController,
    CodingStructuresController,
    AccountsController,
  ],
  providers: [
    FinancialAreasRepository,
    FiscalYearsRepository,
    AccountingPeriodsRepository,
    CodingStructuresRepository,
    AccountsRepository,
    FinancialAreasService,
    FiscalYearsService,
    AccountingPeriodsService,
    CodingStructuresService,
    AccountsService,
    AccountingPermissionRegistration,
  ],
  exports: [
    FinancialAreasService,
    FiscalYearsService,
    AccountingPeriodsService,
    CodingStructuresService,
    AccountsService,
  ],
})
export class AccountingModule {}
