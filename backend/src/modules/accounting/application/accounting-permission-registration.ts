import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PermissionRegistry } from '../../rbac/application/permission-registry.js';
import { ACCOUNTING_PERMISSION_DEFINITIONS } from '../domain/accounting-permissions.js';

/**
 * Registers the Accounting module's permission vocabulary in the RBAC
 * registry at startup (AR-22, ADR-0006) — the same mechanism the
 * Organization module uses (`OrganizationPermissionRegistration`).
 *
 * Only the Task 10.2 codes are registered (financial areas, fiscal years,
 * accounting periods). The remaining contract §22 vocabulary arrives with
 * the tasks that enforce it — a code nobody enforces must not exist
 * (`docs/security.md` §3).
 */
@Injectable()
export class AccountingPermissionRegistration implements OnModuleInit {
  constructor(private readonly registry: PermissionRegistry) {}

  onModuleInit(): void {
    this.registry.register(ACCOUNTING_PERMISSION_DEFINITIONS);
  }
}
