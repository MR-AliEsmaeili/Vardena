import { Injectable } from '@nestjs/common';
import { AppException } from '../kernel/errors/app-exception.js';
import { SystemAdministratorRbacService } from '../modules/rbac/application/system-administrator-rbac.service.js';
import { UsersService } from '../modules/users/application/users.service.js';

export const BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME = 'مدیر';

// This installation credential is intentionally fixed by the bootstrap
// contract. It is passed only to UsersService, which hashes it with the
// existing Argon2id PasswordService before persistence. Never log or return it.
const BOOTSTRAP_SYSTEM_ADMINISTRATOR_INITIAL_PASSWORD = '1';

/**
 * Installation orchestrator for the real bootstrap administrator.
 *
 * The user is an ordinary Users-domain record; its role and grants are
 * ordinary RBAC records. Re-running the command reconciles missing registered
 * permissions and the role assignment but deliberately does NOT reset an
 * existing user's password or lifecycle state, so an operator's post-install
 * password change is never undone by a later deployment.
 */
@Injectable()
export class SystemAdministratorBootstrapService {
  constructor(
    private readonly users: UsersService,
    private readonly rbac: SystemAdministratorRbacService,
  ) {}

  async run(): Promise<{
    userId: string;
    roleId: string;
    permissionCount: number;
    userCreated: boolean;
    roleCreated: boolean;
    userRoleCreated: boolean;
  }> {
    const user = await this.ensureUser();
    const rbac = await this.rbac.ensureForUser(user.userId);
    return { ...user, ...rbac };
  }

  private async ensureUser(): Promise<{
    userId: string;
    userCreated: boolean;
  }> {
    const existing = await this.users.findByUsername(
      BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME,
    );
    if (existing !== null) {
      return { userId: existing.id, userCreated: false };
    }

    try {
      const created = await this.users.createUser({
        username: BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME,
        password: BOOTSTRAP_SYSTEM_ADMINISTRATOR_INITIAL_PASSWORD,
      });
      return { userId: created.id, userCreated: true };
    } catch (error) {
      // Concurrent bootstrap commands may both observe an empty database. The
      // username unique constraint chooses one creator; the loser adopts the
      // same real user and continues with idempotent RBAC reconciliation.
      if (error instanceof AppException && error.code === 'Conflict') {
        const raced = await this.users.findByUsername(
          BOOTSTRAP_SYSTEM_ADMINISTRATOR_USERNAME,
        );
        if (raced !== null) {
          return { userId: raced.id, userCreated: false };
        }
      }
      throw error;
    }
  }
}
