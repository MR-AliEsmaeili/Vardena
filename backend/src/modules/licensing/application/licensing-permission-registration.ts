import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PermissionRegistry } from '../../rbac/application/permission-registry.js';
import { LICENSING_PERMISSION_DEFINITIONS } from '../domain/licensing-permissions.js';

/**
 * Registers the Licensing module's permission vocabulary at startup (AR-22,
 * ADR-0006) — the same pattern every other module follows. Licensing owns the
 * codes; RBAC owns the registry, the mirror table and evaluation.
 */
@Injectable()
export class LicensingPermissionRegistration implements OnModuleInit {
  constructor(private readonly registry: PermissionRegistry) {}

  onModuleInit(): void {
    this.registry.register(LICENSING_PERMISSION_DEFINITIONS);
  }
}
