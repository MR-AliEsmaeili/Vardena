import { Module, forwardRef } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { DocumentTypeConfigsRepository } from './data/document-type-configs.repository.js';
import { NumberingSeriesRepository } from './data/numbering-series.repository.js';
import { NumberingAllocationsRepository } from './data/numbering-allocations.repository.js';
import { DocumentRelationsRepository } from './data/document-relations.repository.js';
import { DocumentTypeRegistry } from './application/document-type-registry.js';
import { DocumentTypesService } from './application/document-types.service.js';
import { NumberingSeriesService } from './application/numbering-series.service.js';
import { NumberingService } from './application/numbering.service.js';
import { DocumentRelationsService } from './application/document-relations.service.js';
import { DocumentPermissionRegistration } from './application/document-permission-registration.js';
import { DocumentTypesController } from './api/document-types.controller.js';
import { NumberingSeriesController } from './api/numbering-series.controller.js';
import { DocumentRelationsController } from './api/document-relations.controller.js';

/**
 * Document Foundation (Task 8, ADR-0023; implements ADR-0019).
 *
 * Owns schema `documents` and the SHARED document mechanics every business
 * module will use: the code-defined document type registry + per-organization
 * type configuration, concurrency-safe numeric numbering (series + allocation
 * ledger), and typed, quantity-aware document relations. It owns NO business
 * document and exposes no generic `POST /documents` (Task 8 §20): Inventory,
 * Sales, Purchasing and Accounting each own their document tables and
 * endpoints and call this module's public services for numbering, relations
 * and type metadata.
 *
 * Public surface (AR-07) — the services are exported so future document
 * modules consume them instead of reading `documents.*` tables:
 *   - `DocumentTypesService.requireDocumentType` / `requireTypeSettings`
 *     (no-permission reference resolution),
 *   - `NumberingService.allocateNumber` (idempotent, concurrency-safe),
 *   - `DocumentRelationsService.linkDocuments` (cross-module link creation).
 *
 * Dependencies (one direction only, like Inventory):
 * - `RbacModule` — `AuthorizationService` + `PermissionRegistry` (codes),
 * - `OrganizationModule` — organizations are resolved through
 *   `OrganizationsService` (organization-scoped configuration),
 * - `IdentityModule` — `AuthGuard`; `forwardRef` for the same composition
 *   cycle as every other module, not a data cycle.
 */
@Module({
  imports: [RbacModule, OrganizationModule, forwardRef(() => IdentityModule)],
  controllers: [
    DocumentTypesController,
    NumberingSeriesController,
    DocumentRelationsController,
  ],
  providers: [
    DocumentTypeConfigsRepository,
    NumberingSeriesRepository,
    NumberingAllocationsRepository,
    DocumentRelationsRepository,
    DocumentTypeRegistry,
    DocumentTypesService,
    NumberingSeriesService,
    NumberingService,
    DocumentRelationsService,
    DocumentPermissionRegistration,
  ],
  exports: [
    DocumentTypeRegistry,
    DocumentTypesService,
    NumberingSeriesService,
    NumberingService,
    DocumentRelationsService,
  ],
})
export class DocumentsModule {}
