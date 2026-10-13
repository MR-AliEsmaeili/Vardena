import { Module, forwardRef } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { WorkflowDefinitionsRepository } from './data/workflow-definitions.repository.js';
import { WorkflowVersionsRepository } from './data/workflow-versions.repository.js';
import { WorkflowStatesRepository } from './data/workflow-states.repository.js';
import { WorkflowTransitionsRepository } from './data/workflow-transitions.repository.js';
import { WorkflowInstancesRepository } from './data/workflow-instances.repository.js';
import { WorkflowHistoryRepository } from './data/workflow-history.repository.js';
import { WorkflowApprovalsRepository } from './data/workflow-approvals.repository.js';
import { WorkflowAutomationsRepository } from './data/workflow-automations.repository.js';
import { AutomationActionRegistry } from './application/automation-action-registry.js';
import { WorkflowDefinitionsService } from './application/workflow-definitions.service.js';
import { WorkflowVersionsService } from './application/workflow-versions.service.js';
import { WorkflowStatesService } from './application/workflow-states.service.js';
import { WorkflowTransitionsService } from './application/workflow-transitions.service.js';
import { WorkflowInstancesService } from './application/workflow-instances.service.js';
import { WorkflowApprovalsService } from './application/workflow-approvals.service.js';
import { WorkflowAutomationsService } from './application/workflow-automations.service.js';
import { WorkflowPermissionRegistration } from './application/workflow-permission-registration.js';
import { WorkflowDefinitionsController } from './api/workflow-definitions.controller.js';
import { WorkflowVersionsController } from './api/workflow-versions.controller.js';
import { WorkflowStatesController } from './api/workflow-states.controller.js';
import { WorkflowTransitionsController } from './api/workflow-transitions.controller.js';
import { WorkflowInstancesController } from './api/workflow-instances.controller.js';
import { WorkflowApprovalsController } from './api/workflow-approvals.controller.js';
import { WorkflowAutomationsController } from './api/workflow-automations.controller.js';

/**
 * Workflow Foundation (Task 9, ADR-0024; bounded part of ADR-0018).
 *
 * Owns schema `workflow` and the REUSABLE workflow primitives future
 * business modules will consume: versioned definitions, bounded states,
 * explicit permission-bound transitions, entity bindings with a locked
 * current state, append-only transition history, single-level approvals
 * and automation bindings. It owns NO business document and exposes no
 * generic entity-mutation API (Task 9 §11/§22): Inventory, Sales,
 * Purchasing and Accounting each keep their tables and call this
 * module's public services for binding, transitions and approvals.
 *
 * Public surface (AR-07) — the services are exported so future document
 * modules consume them instead of reading `workflow.*` tables:
 *   - `WorkflowInstancesService.bindInstance` / `executeTransition` /
 *     `listAvailableTransitions` (runtime),
 *   - `WorkflowApprovalsService.requestApproval` / `decideApproval`,
 *   - `WorkflowVersionsService.requireBindableVersion` (version resolution),
 *   - `AutomationActionRegistry` (the catalogue future dispatchers register
 *     their actions in).
 *
 * Dependencies (one direction only, like Documents):
 * - `RbacModule` — `AuthorizationService` + `PermissionRegistry` (codes),
 * - `OrganizationModule` — organizations are resolved through
 *   `OrganizationsService` (organization-scoped configuration),
 * - `IdentityModule` — `AuthGuard`; `forwardRef` for the same composition
 *   cycle as every other module, not a data cycle.
 *
 * Bound entities are LOGICAL references (module + type + id) the module
 * stores but never dereferences — no dependency on Documents, Inventory
 * or any future business module (AR-07/08).
 */
@Module({
  imports: [RbacModule, OrganizationModule, forwardRef(() => IdentityModule)],
  controllers: [
    WorkflowDefinitionsController,
    WorkflowVersionsController,
    WorkflowStatesController,
    WorkflowTransitionsController,
    WorkflowInstancesController,
    WorkflowApprovalsController,
    WorkflowAutomationsController,
  ],
  providers: [
    WorkflowDefinitionsRepository,
    WorkflowVersionsRepository,
    WorkflowStatesRepository,
    WorkflowTransitionsRepository,
    WorkflowInstancesRepository,
    WorkflowHistoryRepository,
    WorkflowApprovalsRepository,
    WorkflowAutomationsRepository,
    AutomationActionRegistry,
    WorkflowDefinitionsService,
    WorkflowVersionsService,
    WorkflowStatesService,
    WorkflowTransitionsService,
    WorkflowInstancesService,
    WorkflowApprovalsService,
    WorkflowAutomationsService,
    WorkflowPermissionRegistration,
  ],
  exports: [
    AutomationActionRegistry,
    WorkflowDefinitionsService,
    WorkflowVersionsService,
    WorkflowStatesService,
    WorkflowTransitionsService,
    WorkflowInstancesService,
    WorkflowApprovalsService,
    WorkflowAutomationsService,
  ],
})
export class WorkflowModule {}
