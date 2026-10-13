import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PermissionRegistry } from '../../rbac/application/permission-registry.js';
import { DOCUMENT_PERMISSION_DEFINITIONS } from '../domain/document-permissions.js';

/**
 * Registers the Document Foundation's permission vocabulary in the RBAC
 * registry at startup (AR-22, ADR-0006) — the same mechanism every module
 * uses (`UsersPermissionRegistration`, `OrganizationPermissionRegistration`).
 */
@Injectable()
export class DocumentPermissionRegistration implements OnModuleInit {
  constructor(private readonly registry: PermissionRegistry) {}

  onModuleInit(): void {
    this.registry.register(DOCUMENT_PERMISSION_DEFINITIONS);
  }
}
