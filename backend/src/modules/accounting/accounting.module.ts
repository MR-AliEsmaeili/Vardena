import { Module, forwardRef } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { FinancialAreasRepository } from './data/financial-areas.repository.js';
import { FiscalYearsRepository } from './data/fiscal-years.repository.js';
import { AccountingPeriodsRepository } from './data/accounting-periods.repository.js';
import { CodingStructuresRepository } from './data/coding-structures.repository.js';
import { AccountsRepository } from './data/accounts.repository.js';
import { AccountingDocumentsRepository } from './data/accounting-documents.repository.js';
import { AccountingDocumentLinesRepository } from './data/accounting-document-lines.repository.js';
import { AccountingPostingOperationsRepository } from './data/accounting-posting-operations.repository.js';
import { FinancialAreasService } from './application/financial-areas.service.js';
import { FiscalYearsService } from './application/fiscal-years.service.js';
import { AccountingPeriodsService } from './application/accounting-periods.service.js';
import { CodingStructuresService } from './application/coding-structures.service.js';
import { AccountsService } from './application/accounts.service.js';
import { AccountingPermissionRegistration } from './application/accounting-permission-registration.js';
import { AccountingDocumentTypeRegistration } from './application/accounting-document-type-registration.js';
import { AccountingDocumentsService } from './application/accounting-documents.service.js';
import { PostingReadinessService } from './application/posting-readiness.service.js';
import { FinancialAreasController } from './api/financial-areas.controller.js';
import { FiscalYearsController } from './api/fiscal-years.controller.js';
import { AccountingPeriodsController } from './api/accounting-periods.controller.js';
import { CodingStructuresController } from './api/coding-structures.controller.js';
import { AccountsController } from './api/accounts.controller.js';
import { AccountingDocumentsController } from './api/accounting-documents.controller.js';

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
 * no endpoint, no state. Detail dimensions, posting rules,
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
    AccountsController,
    AccountingDocumentsController,
  ],
  providers: [
    FinancialAreasRepository,
    FiscalYearsRepository,
    AccountingPeriodsRepository,
    CodingStructuresRepository,
    AccountsRepository,
    AccountingDocumentLinesRepository,
    AccountingDocumentsRepository,
    AccountingPostingOperationsRepository,
    FinancialAreasService,
    FiscalYearsService,
    AccountingPeriodsService,
    CodingStructuresService,
    AccountsService,
    AccountingDocumentsService,
    AccountingPermissionRegistration,
    AccountingDocumentTypeRegistration,
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
    AccountsService,
    // Task 10.4: the document aggregate's application service. A future source
    // module composes system-origin documents through IT (contract §16.3) and
    // never touches `accounting.*` tables (AC-I-13) — but no such caller exists
    // yet, because no production system posting is enabled before OQ-39.
    AccountingDocumentsService,
  ],
})
export class AccountingModule {}
