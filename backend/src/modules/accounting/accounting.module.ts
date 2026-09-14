import { Module, forwardRef } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { FinancialAreasRepository } from './data/financial-areas.repository.js';
import { FiscalYearsRepository } from './data/fiscal-years.repository.js';
import { AccountingPeriodsRepository } from './data/accounting-periods.repository.js';
import { FinancialAreasService } from './application/financial-areas.service.js';
import { FiscalYearsService } from './application/fiscal-years.service.js';
import { AccountingPeriodsService } from './application/accounting-periods.service.js';
import { AccountingPermissionRegistration } from './application/accounting-permission-registration.js';
import { FinancialAreasController } from './api/financial-areas.controller.js';
import { FiscalYearsController } from './api/fiscal-years.controller.js';
import { AccountingPeriodsController } from './api/accounting-periods.controller.js';

/**
 * Accounting module — FOUNDATION ONLY (Task 10.2, ADR-0026,
 * docs/accounting/domain-contract.md §4/§5/§6/§7).
 *
 * Owns schema `accounting`: financial areas, fiscal years and accounting
 * periods — the bookkeeping scope spine. The chart of accounts, detail
 * dimensions, accounting documents, posting rules and balance projections
 * arrive with later tasks (contract §28.2) and must not be anticipated
 * here (AR-29).
 *
 * Public surface (AR-07) — the application services are exported so future
 * posting flows resolve areas/years/periods through them and never read
 * `accounting.*` tables. `FiscalYearsService` exposes
 * `requireUsableFiscalYearInOrganization` and `FinancialAreasService`
 * exposes `requireUsableFinancialAreaInOrganization`; both carry no
 * permission of their own because the calling service has already
 * performed its own authorization check.
 *
 * Dependencies:
 * - `RbacModule` — `AuthorizationService` (the application-service check)
 *   and `PermissionRegistry` (registering the `Accounting.*` codes),
 * - `IdentityModule` — `AuthGuard`. `forwardRef` for the same reason as in
 *   `UsersModule`: a composition cycle, not a data cycle.
 * - `OrganizationModule` — the calendar is organization-scoped and the
 *   organization root is resolved through `OrganizationsService`. One
 *   direction only: Organization never imports Accounting, so there is no
 *   cycle here.
 */
@Module({
  imports: [RbacModule, forwardRef(() => IdentityModule), OrganizationModule],
  controllers: [
    FinancialAreasController,
    FiscalYearsController,
    AccountingPeriodsController,
  ],
  providers: [
    FinancialAreasRepository,
    FiscalYearsRepository,
    AccountingPeriodsRepository,
    FinancialAreasService,
    FiscalYearsService,
    AccountingPeriodsService,
    AccountingPermissionRegistration,
  ],
  exports: [
    FinancialAreasService,
    FiscalYearsService,
    AccountingPeriodsService,
  ],
})
export class AccountingModule {}
