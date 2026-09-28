import { Module, forwardRef } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { FinancialAreasRepository } from './data/financial-areas.repository.js';
import { FiscalYearsRepository } from './data/fiscal-years.repository.js';
import { AccountingPeriodsRepository } from './data/accounting-periods.repository.js';
import { CodingStructuresRepository } from './data/coding-structures.repository.js';
import { AccountingConfigurationsRepository } from './data/accounting-configurations.repository.js';
import { AccountsRepository } from './data/accounts.repository.js';
import { AccountingDocumentsRepository } from './data/accounting-documents.repository.js';
import { AccountingDocumentLinesRepository } from './data/accounting-document-lines.repository.js';
import { AccountingPostingOperationsRepository } from './data/accounting-posting-operations.repository.js';
import { LedgerEntriesRepository } from './data/ledger-entries.repository.js';
import { FinancialAreasService } from './application/financial-areas.service.js';
import { FiscalYearsService } from './application/fiscal-years.service.js';
import { AccountingPeriodsService } from './application/accounting-periods.service.js';
import { CodingStructuresService } from './application/coding-structures.service.js';
import { AccountingConfigurationsService } from './application/accounting-configurations.service.js';
import { AccountsService } from './application/accounts.service.js';
import { AccountingPermissionRegistration } from './application/accounting-permission-registration.js';
import { AccountingDocumentTypeRegistration } from './application/accounting-document-type-registration.js';
import { AccountingDocumentsService } from './application/accounting-documents.service.js';
import { PostingReadinessService } from './application/posting-readiness.service.js';
import { PostingService } from './application/posting.service.js';
import { AccountBalanceProjectionsRepository } from './data/account-balance-projections.repository.js';
import { AccountingBalancesService } from './application/accounting-balances.service.js';
import { LedgerMovementsService } from './application/ledger-movements.service.js';
import { FinancialAreasController } from './api/financial-areas.controller.js';
import { FiscalYearsController } from './api/fiscal-years.controller.js';
import { AccountingPeriodsController } from './api/accounting-periods.controller.js';
import { CodingStructuresController } from './api/coding-structures.controller.js';
import { AccountingConfigurationsController } from './api/accounting-configurations.controller.js';
import { AccountsController } from './api/accounts.controller.js';
import { AccountingDocumentsController } from './api/accounting-documents.controller.js';
import { AccountingBalancesController } from './api/accounting-balances.controller.js';
import { AccountingLedgerMovementsController } from './api/accounting-ledger-movements.controller.js';
import { AccountStatementsController } from './api/account-statements.controller.js';
import { AccountStatementsService } from './application/account-statements.service.js';
import { AccountStatementsRepository } from './data/account-statements.repository.js';
import { BaseChartTemplatesRepository } from './data/base-chart-templates.repository.js';
import { BaseChartAdoptionsRepository } from './data/base-chart-adoptions.repository.js';
import { AccountingReadQueryRepository } from './data/accounting-read-query.repository.js';
import { GeneralLedgerService } from './application/general-ledger.service.js';
import { TrialBalanceService } from './application/trial-balance.service.js';
import { ChartTreeService } from './application/chart-tree.service.js';
import { BaseChartTemplatesService } from './application/base-chart-templates.service.js';
import { BaseChartAdoptionsService } from './application/base-chart-adoptions.service.js';
import { GeneralLedgerController } from './api/general-ledger.controller.js';
import { TrialBalanceController } from './api/trial-balance.controller.js';
import { ChartTreeController } from './api/chart-tree.controller.js';
import { BaseChartTemplatesController } from './api/base-chart-templates.controller.js';
import { BaseChartTemplateVersionsController } from './api/base-chart-template-versions.controller.js';
import { BaseChartAdoptionsController } from './api/base-chart-adoptions.controller.js';
import { DetailStructuresRepository } from './data/detail-structures.repository.js';
import { DetailsRepository } from './data/details.repository.js';
import { DetailStructuresService } from './application/detail-structures.service.js';
import { DetailsService } from './application/details.service.js';
import { DetailStructuresController } from './api/detail-structures.controller.js';
import { DetailsController } from './api/details.controller.js';

/**
 * Accounting module — foundation + chart structure (Task 10.2, Task 10.3;
 * ADR-0026, docs/accounting/domain-contract.md §4…§9, §14).
 *
 * Owns schema `accounting`: financial areas, fiscal years, accounting periods
 * (the bookkeeping scope spine) plus the coding structure and the chart of
 * accounts (the account-structure spine) and the accounting document
 * aggregate — the voucher header + lines with its `draft → temporary → final`
 * lifecycle (Task 10.4, contract §12…§18). Task 10.5 adds the internal
 * posting-readiness seam (`PostingReadinessService` over the pure
 * `domain/posting-readiness.ts` decision): a read-only eligibility verdict
 * between the finalized voucher and the future Posting Engine — no posting,
 * no endpoint, no state. Task 10.7 materializes the immutable ledger entries
 * atomically inside finalization (`finalizeChecked` + `LedgerEntriesRepository`,
 * insert-only, no endpoint): `final` = posted, evidenced by the existing
 * `document_finalize` operation row. Detail dimensions, posting rules,
 * balance projections and the correction mechanisms arrive with later tasks
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
 * - `DocumentsModule` — the Document Foundation (ADR-0023): the type registry
 *   (`accounting_voucher` is registered at startup), the per-organization type
 *   configuration that decides whether a draft is required, and the numbering
 *   allocation. Accounting consumes its PUBLIC application services and never
 *   reads `documents.*` tables (AC-I-13, AR-07).
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
  imports: [
    RbacModule,
    forwardRef(() => IdentityModule),
    OrganizationModule,
    // The Document Foundation supplies the document type registry (the
    // `accounting_voucher` type is registered at startup), the per-organization
    // type configuration (`draft_required`, §15.1) and the number allocation
    // (§18). Accounting composes those; it re-implements none of them.
    DocumentsModule,
  ],
  controllers: [
    FinancialAreasController,
    FiscalYearsController,
    AccountingPeriodsController,
    CodingStructuresController,
    AccountingConfigurationsController,
    AccountsController,
    AccountingDocumentsController,
    AccountingBalancesController,
    AccountingLedgerMovementsController,
    // Task 17B: the bounded account statement — one GET, read-only.
    AccountStatementsController,
    // Task 18: explicit report APIs; each has its own permission.
    GeneralLedgerController,
    TrialBalanceController,
    // Task 19 (ODR-2): the Accounting-owned, read-only Chart Tree surface.
    ChartTreeController,
    // Task 23: the product-owned Base Chart template lifecycle and the
    // explicit organization adoption boundary.
    BaseChartTemplatesController,
    BaseChartTemplateVersionsController,
    BaseChartAdoptionsController,
    // Task 30: Detail Structures and Details (OD-29-03)
    DetailStructuresController,
    DetailsController,
  ],
  providers: [
    FinancialAreasRepository,
    FiscalYearsRepository,
    AccountingPeriodsRepository,
    CodingStructuresRepository,
    AccountingConfigurationsRepository,
    AccountsRepository,
    DetailStructuresRepository,
    DetailsRepository,
    AccountingDocumentLinesRepository,
    AccountingDocumentsRepository,
    AccountingPostingOperationsRepository,
    // Task 10.7: insert-only evidence reads (`findByVoucher`); the writes
    // happen inside `finalizeChecked`, never through this provider directly.
    LedgerEntriesRepository,
    // Task 12: turnover projection — rebuildable, report-only, maintained
    // transactionally inside finalization and via explicit audited rebuild.
    AccountBalanceProjectionsRepository,
    FinancialAreasService,
    FiscalYearsService,
    AccountingPeriodsService,
    CodingStructuresService,
    AccountingConfigurationsService,
    AccountsService,
    DetailStructuresService,
    DetailsService,
    AccountingDocumentsService,
    AccountingBalancesService,
    // Task 17A: the read-only movement source over the immutable ledger
    // (`listMovements` only). Provided (not exported): the future Reporting
    // consumer of this source does not exist yet, and a cross-module consumer
    // must arrive through the separately authorized Reporting task rather than
    // silently binding another module to this service (AR-07).
    LedgerMovementsService,
    // Task 17B: the account statement — the canonical account-movement
    // calculation (`getAccountStatement` only) over the same immutable
    // ledger. Read-only (no write verb exists), computed per request, never
    // persisted. Provided (not exported): report DELIVERY or other
    // cross-module consumption is gated by OQ-26 and must arrive through the
    // separately authorized Reporting task (platform boundary), never by
    // silently binding another module to this service (AR-07).
    AccountStatementsService,
    AccountStatementsRepository,
    // Task 18: one shared Accounting Read/Query Layer consumed by all three
    // report application services. It is Accounting-owned and read-only.
    AccountingReadQueryRepository,
    GeneralLedgerService,
    TrialBalanceService,
    // Task 19 (ODR-2): the read-only chart tree projection over the account
    // master — same repository as the administration surface, no second
    // Account master, no figures (Task 18 owns those).
    ChartTreeService,
    // Task 23: the Base Chart store. Provided (not exported) — tenant
    // consumption goes ONLY through the explicit adoption endpoints; no
    // cross-module consumer of this service is authorized yet (AR-07).
    BaseChartTemplatesRepository,
    BaseChartAdoptionsRepository,
    BaseChartTemplatesService,
    BaseChartAdoptionsService,
    AccountingPermissionRegistration,
    AccountingDocumentTypeRegistration,
    // Task 10.8: the posting orchestration seam — ONE entry point
    // (`postVoucher`) for the atomic act §15.5 defines: idempotency
    // replay-or-reject, the lifecycle verdict, the Task 10.7 transaction
    // (never wrapped in a second one), the `Finalized` event, and the
    // readiness/ledger verification of the result. Provided (not exported):
    // its only caller today is this module's own document service, and a
    // cross-module caller would need the §16.3 source-posting contract and
    // OQ-39's delivery decision first (AR-07). It adds no endpoint, no
    // permission, no event, no table and no transaction of its own.
    PostingService,
    // Task 10.5: the posting-readiness seam. Provided (not exported) — it is
    // an IN-MODULE contract for the future Posting Engine, which is
    // Accounting-owned (ADR-0026 §1). A cross-module consumer would need the
    // §16.3 source-posting contract and OQ-39's delivery decision first, so
    // the seam deliberately stops at the module boundary (AR-07). Read-only:
    // repositories + the organization pin are its only dependencies.
    PostingReadinessService,
  ],
  exports: [
    FinancialAreasService,
    FiscalYearsService,
    AccountingPeriodsService,
    CodingStructuresService,
    AccountingConfigurationsService,
    AccountsService,
    DetailStructuresService,
    DetailsService,
    // Task 10.4: the document aggregate's application service. A future source
    // module composes system-origin documents through IT (contract §16.3) and
    // never touches `accounting.*` tables (AC-I-13) — but no such caller exists
    // yet, because no production system posting is enabled before OQ-39.
    AccountingDocumentsService,
  ],
})
export class AccountingModule {}
