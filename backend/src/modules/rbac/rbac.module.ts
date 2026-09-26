import { Module, forwardRef } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { PermissionsRepository } from './data/permissions.repository.js';
import { RolesRepository } from './data/roles.repository.js';
import { UserRolesRepository } from './data/user-roles.repository.js';
import { AuthorizationGuard } from './application/authorization.guard.js';
import { AuthorizationService } from './application/authorization.service.js';
import { PermissionRegistry } from './application/permission-registry.js';
import { PermissionSyncService } from './application/permission-sync.service.js';
import { PermissionsService } from './application/permissions.service.js';
import { RbacPermissionRegistration } from './application/rbac-permission-registration.js';
import { RolesService } from './application/roles.service.js';
import { UserRolesService } from './application/user-roles.service.js';
import { SystemAdministratorRbacService } from './application/system-administrator-rbac.service.js';
import { PermissionsController } from './api/permissions.controller.js';
import { RolesController } from './api/roles.controller.js';

/**
 * RBAC module (docs/modules.md §RBAC).
 *
 * Public surface for other modules: `AuthorizationService` (evaluation),
 * `PermissionRegistry` (registration), `AuthorizationGuard` +
 * `@RequirePermission` (route enforcement) — everything else stays internal.
 *
 * `PermissionSyncService` mirrors the registry into `rbac.permissions` on
 * bootstrap; each module registers its own definitions through its own
 * startup registration provider (`RbacPermissionRegistration` here,
 * `UsersPermissionRegistration` in UsersModule).
 *
 * Imports `IdentityModule` for `AuthGuard` (session authentication) so every
 * RBAC route is authenticated *and* authorized. The edge is `forwardRef`
 * because Identity imports Users and Users imports RBAC (for the authorization
 * service) — the triangle is intentional: no module owns another's data, they
 * only use each other's public surface.
 */
@Module({
  imports: [forwardRef(() => IdentityModule)],
  controllers: [RolesController, PermissionsController],
  providers: [
    PermissionRegistry,
    PermissionsRepository,
    RolesRepository,
    UserRolesRepository,
    AuthorizationService,
    AuthorizationGuard,
    PermissionsService,
    RolesService,
    UserRolesService,
    PermissionSyncService,
    RbacPermissionRegistration,
    SystemAdministratorRbacService,
  ],
  exports: [
    AuthorizationService,
    PermissionRegistry,
    AuthorizationGuard,
    SystemAdministratorRbacService,
  ],
})
export class RbacModule {}
