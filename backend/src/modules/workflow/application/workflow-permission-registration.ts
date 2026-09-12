import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PermissionRegistry } from '../../rbac/application/permission-registry.js';
import { WORKFLOW_PERMISSION_DEFINITIONS } from '../domain/workflow-permissions.js';

/**
 * Registers the Workflow Foundation's permission vocabulary in the RBAC
 * registry at startup (AR-22, ADR-0006) — the same mechanism every module
 * uses (`UsersPermissionRegistration`, `DocumentPermissionRegistration`).
 */
@Injectable()
export class WorkflowPermissionRegistration implements OnModuleInit {
  constructor(private readonly registry: PermissionRegistry) {}

  onModuleInit(): void {
    this.registry.register(WORKFLOW_PERMISSION_DEFINITIONS);
  }
}
