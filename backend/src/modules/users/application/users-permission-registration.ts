import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PermissionRegistry } from '../../rbac/application/permission-registry.js';
import { USER_PERMISSION_DEFINITIONS } from '../domain/user-permissions.js';

/**
 * Registers the Users module's permission vocabulary in the RBAC registry at
 * startup (AR-22, ADR-0006).
 *
 * Who owns what: the Users module owns the *codes and descriptions* (they
 * describe its own operations); RBAC owns the registry, the mirror table, and
 * evaluation. Registration is a startup side effect, so a malformed or
 * duplicate code fails module initialization instead of silently producing a
 * permission nobody can enforce.
 */
@Injectable()
export class UsersPermissionRegistration implements OnModuleInit {
  constructor(private readonly registry: PermissionRegistry) {}

  onModuleInit(): void {
    this.registry.register(USER_PERMISSION_DEFINITIONS);
  }
}
