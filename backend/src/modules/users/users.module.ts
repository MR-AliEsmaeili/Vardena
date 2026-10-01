import { Module, forwardRef } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { UsersRepository } from './data/users.repository.js';
import { PasswordService } from './domain/password.service.js';
import { UsersService } from './application/users.service.js';
import { UsersPermissionRegistration } from './application/users-permission-registration.js';
import { UsersController } from './api/users.controller.js';
import { LicensingModule } from '../licensing/licensing.module.js';

/**
 * Users module (docs/modules.md §Users).
 *
 * This module owns `users.users` (records + password hash) and exposes its
 * public application service `UsersService` — Identity depends on it to verify
 * credentials and resolve users during session validation.
 *
 * Dependencies for the admin API:
 * - `RbacModule` — `AuthorizationService` (the application-service check) and
 *   `PermissionRegistry` (registering `Users.User.*` codes),
 * - `IdentityModule` — `AuthGuard` (authentication). The edge is `forwardRef`
 *   because Identity imports this module for credential verification; the
 *   cycle is a composition cycle, not a data cycle (AR-07).
 */
@Module({
  imports: [RbacModule, forwardRef(() => IdentityModule), LicensingModule],
  controllers: [UsersController],
  providers: [
    PasswordService,
    UsersRepository,
    UsersService,
    UsersPermissionRegistration,
  ],
  exports: [UsersService, PasswordService],
})
export class UsersModule {}
