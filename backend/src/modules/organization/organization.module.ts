import { Module, forwardRef } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { DeploymentOrganizationScopeGuard } from './application/deployment-scope.guard.js';
import { OrganizationsRepository } from './data/organizations.repository.js';
import { BranchesRepository } from './data/branches.repository.js';
import { DepartmentsRepository } from './data/departments.repository.js';
import { EmployeesRepository } from './data/employees.repository.js';
import { PartiesRepository } from './data/parties.repository.js';
import { OrganizationMembershipsRepository } from './data/organization-memberships.repository.js';
import { OrganizationsService } from './application/organizations.service.js';
import { BranchesService } from './application/branches.service.js';
import { DepartmentsService } from './application/departments.service.js';
import { EmployeesService } from './application/employees.service.js';
import { PartiesService } from './application/parties.service.js';
import { OrganizationMembershipsService } from './application/organization-memberships.service.js';
import { OrganizationPermissionRegistration } from './application/organization-permission-registration.js';
import { OrganizationsController } from './api/organizations.controller.js';
import { BranchesController } from './api/branches.controller.js';
import { DepartmentsController } from './api/departments.controller.js';
import { EmployeesController } from './api/employees.controller.js';
import { PartiesController } from './api/parties.controller.js';
import { OrganizationMembershipsController } from './api/organization-memberships.controller.js';
import { LicensingModule } from '../licensing/licensing.module.js';

/**
 * Organization module (docs/modules.md §Organization, ADR-0020, ADR-0021).
 *
 * Owns schema `organization`: the organization root, branches, departments,
 * employees (minimal reference data) and the party master. Task 6 implements
 * the organizational-structure and party half of ADR-0020; the fiscal calendar,
 * numbering series, tax definitions, workflow definitions and custom-field
 * definitions stay with later tasks. Task 19 (ODR-3) adds the principal →
 * organization membership (`organization_memberships`) — the binding that makes
 * organization authorization principal-bound — and enforces it inside
 * `OrganizationsService.assertOrganizationInScope`, the chokepoint every
 * module's organization-scoped resolution passes through.
 *
 * Public surface (AR-07) — the five application services are exported so other
 * modules resolve organization structure and counterparties through them and
 * never read `organization.*` tables. Each exposes a `requireUsable*` method
 * for cross-module reference resolution that carries no permission of its own:
 * the calling service has already performed its own authorization check.
 *
 * Dependencies:
 * - `RbacModule` — `AuthorizationService` (the application-service check) and
 *   `PermissionRegistry` (registering the `Organization.*` codes),
 * - `IdentityModule` — `AuthGuard`. `forwardRef` for the same reason as in
 *   `UsersModule`: a composition cycle, not a data cycle.
 */
@Module({
  imports: [RbacModule, forwardRef(() => IdentityModule), LicensingModule],
  controllers: [
    OrganizationsController,
    BranchesController,
    DepartmentsController,
    EmployeesController,
    PartiesController,
    OrganizationMembershipsController,
  ],
  providers: [
    OrganizationsRepository,
    BranchesRepository,
    DepartmentsRepository,
    EmployeesRepository,
    PartiesRepository,
    // Task 19 (ODR-3): the principal → organization binding. Organization-owned
    // data in THIS module's schema; the user side is a database foreign key,
    // never a cross-module read (AR-07).
    OrganizationMembershipsRepository,
    OrganizationsService,
    BranchesService,
    DepartmentsService,
    EmployeesService,
    PartiesService,
    OrganizationMembershipsService,
    OrganizationPermissionRegistration,
    // Global pin enforcement (ADR-0025): no-op unless
    // DEPLOYMENT_ORGANIZATION_ID is configured. Registered from the module
    // that owns organizational scope so every module is confined.
    { provide: APP_GUARD, useClass: DeploymentOrganizationScopeGuard },
  ],
  exports: [
    OrganizationsService,
    // Exported for the installation bootstrap command, which must create the
    // administrator's ordinary deployment membership through the service that
    // owns it (never by writing the table from outside the module, AR-07).
    OrganizationMembershipsService,
    BranchesService,
    DepartmentsService,
    EmployeesService,
    PartiesService,
  ],
})
export class OrganizationModule {}
