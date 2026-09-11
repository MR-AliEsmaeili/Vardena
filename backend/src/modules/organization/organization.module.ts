import { Module, forwardRef } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { OrganizationsRepository } from './data/organizations.repository.js';
import { BranchesRepository } from './data/branches.repository.js';
import { DepartmentsRepository } from './data/departments.repository.js';
import { EmployeesRepository } from './data/employees.repository.js';
import { PartiesRepository } from './data/parties.repository.js';
import { OrganizationsService } from './application/organizations.service.js';
import { BranchesService } from './application/branches.service.js';
import { DepartmentsService } from './application/departments.service.js';
import { EmployeesService } from './application/employees.service.js';
import { PartiesService } from './application/parties.service.js';
import { OrganizationPermissionRegistration } from './application/organization-permission-registration.js';
import { OrganizationsController } from './api/organizations.controller.js';
import { BranchesController } from './api/branches.controller.js';
import { DepartmentsController } from './api/departments.controller.js';
import { EmployeesController } from './api/employees.controller.js';
import { PartiesController } from './api/parties.controller.js';

/**
 * Organization module (docs/modules.md §Organization, ADR-0020, ADR-0021).
 *
 * Owns schema `organization`: the organization root, branches, departments,
 * employees (minimal reference data) and the party master. Task 6 implements
 * the organizational-structure and party half of ADR-0020; the fiscal calendar,
 * numbering series, tax definitions, workflow definitions and custom-field
 * definitions stay with later tasks.
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
  imports: [RbacModule, forwardRef(() => IdentityModule)],
  controllers: [
    OrganizationsController,
    BranchesController,
    DepartmentsController,
    EmployeesController,
    PartiesController,
  ],
  providers: [
    OrganizationsRepository,
    BranchesRepository,
    DepartmentsRepository,
    EmployeesRepository,
    PartiesRepository,
    OrganizationsService,
    BranchesService,
    DepartmentsService,
    EmployeesService,
    PartiesService,
    OrganizationPermissionRegistration,
  ],
  exports: [
    OrganizationsService,
    BranchesService,
    DepartmentsService,
    EmployeesService,
    PartiesService,
  ],
})
export class OrganizationModule {}
