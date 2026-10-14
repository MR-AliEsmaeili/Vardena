import { Inject, Injectable } from '@nestjs/common';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '../../../kernel/config/app-config.js';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import type { DatabaseTransaction } from '../../../kernel/prisma/prisma.service.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import {
  getCorrelationId,
  getPrincipal,
} from '../../../kernel/correlation/request-context.js';
import type { PaginatedResult } from '../../../kernel/pagination/paginated-result.js';
import {
  toOffset,
  toPaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { UsersRepository } from '../data/users.repository.js';
import { PasswordService } from '../domain/password.service.js';
import type { User, UserDto } from '../domain/user.js';
import { toUserDto } from '../domain/user.js';
import { USER_PERMISSIONS } from '../domain/user-permissions.js';
import { LicensingService } from '../../licensing/application/licensing.service.js';
import {
  USER_CREATED_EVENT,
  USER_DISABLED_EVENT,
  USER_ENABLED_EVENT,
  USER_PASSWORD_CHANGED_EVENT,
  USER_PASSWORD_RESET_EVENT,
  USER_UPDATED_EVENT,
  type UserCreatedEvent,
  type UserDisabledEvent,
  type UserEnabledEvent,
  type UserPasswordChangedEvent,
  type UserPasswordResetEvent,
  type UserUpdatedEvent,
} from '../domain/user.events.js';

/**
 * Failure reason for credential verification. AUDIT-ONLY: Identity publishes
 * a `Login.Failed` event with this reason but never returns it to the client
 * (AR-24, security.md §2 — prevents username enumeration).
 */
export type CredentialFailureReason = 'invalid_credentials' | 'user_disabled';

export interface VerifyCredentialsResult {
  user: User | null;
  failureReason: CredentialFailureReason | null;
}

/** Sortable fields for the user list (anything else is rejected). */
const SORTABLE_FIELDS: Record<string, string> = {
  username: 'username',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

export interface ListUsersQuery {
  page: number;
  pageSize: number;
  isActive?: boolean | undefined;
  sort?: string | undefined;
}

export interface CreateUserInput {
  username: string;
  password: string;
  /** Not exposed by the API: creation always yields an active account. */
  isActive?: boolean | undefined;
  /** Internal bootstrap/provisioning flag requiring password change on login. */
  mustChangePassword?: boolean | undefined;
}

export interface UpdateUserInput {
  username?: string | undefined;
}

/**
 * Users module application service (docs/modules.md §Users).
 *
 * Two clearly separated groups of methods:
 *
 * - **Authentication/read helpers** (`verifyCredentials`, `findActiveById`,
 *   `findById`, `findByUsername`): consumed by Identity *before* a principal
 *   exists. They intentionally carry no permission check — login must work for
 *   anonymous callers — and never return a password hash to a controller.
 * - **Administration** (`listUsers`, `getUser`, `createUser`, `updateUser`,
 *   `enableUser`, `disableUser`, `resetPassword`): every one of them requires
 *   its `Users.User.*` permission. The check runs in this layer because that is
 *   the only place a background/worker call can be told apart from an HTTP
 *   request (`AuthorizationService` skips the check when there is no HTTP
 *   request context, 401s an anonymous request, and 403s a principal without
 *   the permission).
 *
 * Not in scope (no rule defined in the repository — do not invent):
 * - user deletion (OQ-18 keeps deletion semantics open),
 * - self-service password change (Identity's own-password flow),
 * - profiles/display names/email (later Users sessions).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly repository: UsersRepository,
    private readonly passwordService: PasswordService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
    private readonly licensing: LicensingService,
  ) {}

  // -----------------------------------------------------------------------
  // Authentication / read helpers (no permission check by design)
  // -----------------------------------------------------------------------

  /**
   * Find a user by login identifier (username) and verify their password.
   *
   * This method intentionally does NOT distinguish failure reasons to API
   * clients — authentication controllers respond with a single generic
   * error to avoid username enumeration (AR-24, security.md §2). The
   * failure reason is returned ONLY for audit/lockout event publishing,
   * which runs server-side and is never exposed.
   *
   * Timing-side-channel mitigation: runs a dummy hash verify when the
   * user is not found so response time does not trivially reveal user
   * existence.
   */
  async verifyCredentials(
    username: string,
    password: string,
  ): Promise<VerifyCredentialsResult> {
    const normalized = username.trim();
    const user = await this.repository.findByUsername(normalized);

    if (user === null) {
      await this.passwordService.verify(
        '$argon2id$v=19$m=19456,t=2,p=1$c29tZWR1bW15c2FsdHhzYWx0eHhhc2g$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMN',
        password,
      );
      return { user: null, failureReason: 'invalid_credentials' };
    }

    const ok = await this.passwordService.verify(user.passwordHash, password);
    if (!ok) {
      return { user: null, failureReason: 'invalid_credentials' };
    }
    if (!user.isActive || user.deletedAt !== null) {
      return { user: null, failureReason: 'user_disabled' };
    }
    return { user, failureReason: null };
  }

  /** Internal Identity contract: revalidate a verified credential under the user lock. */
  async withCurrentCredentials<T>(
    expected: Pick<User, 'id' | 'passwordHash'>,
    work: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T | null> {
    return this.repository.withCurrentCredentials(expected, work);
  }

  /**
   * Find a user by id for session validation. Returns `null` if the user
   * does not exist or has been disabled/deleted (so sessions for disabled
   * users are invalidated on next request).
   */
  async findActiveById(id: string): Promise<User | null> {
    const user = await this.repository.findById(id);
    if (user === null) return null;
    if (!user.isActive || user.deletedAt !== null) return null;
    return user;
  }

  /**
   * Find a user by id, regardless of active state. Used by admin/application
   * flows (never by authentication responses).
   */
  async findById(id: string): Promise<User | null> {
    return this.repository.findById(id);
  }

  /**
   * Find a user by username (audit / admin support). Callers must NOT use
   * this to drive authentication responses — use `verifyCredentials` to
   * avoid username enumeration.
   */
  async findByUsername(username: string): Promise<User | null> {
    return this.repository.findByUsername(username.trim());
  }

  // -----------------------------------------------------------------------
  // Administration (every method requires its Users.User.* permission)
  // -----------------------------------------------------------------------

  /** List users (paginated, soft-deleted rows are never returned). */
  async listUsers(query: ListUsersQuery): Promise<PaginatedResult<UserDto>> {
    await this.authorization.requireAllPermissions([USER_PERMISSIONS.VIEW]);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: { isActive: query.isActive },
      orderBy: resolveOrderBy(query.sort),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map((user) => toUserDto(user)),
      total,
      query.page,
      query.pageSize,
    );
  }

  /** Read one user by id (404 when it does not exist or is soft-deleted). */
  async getUser(id: string): Promise<UserDto> {
    await this.authorization.requireAllPermissions([USER_PERMISSIONS.VIEW]);
    const user = await this.repository.findById(id);
    if (user === null || user.deletedAt !== null) {
      throw AppException.notFound('User', id);
    }
    return toUserDto(user);
  }

  /**
   * Create a new user with an argon2id-hashed password.
   *
   * Also used by tests and (isolated) development seeding, which run outside a
   * request context: there they run in the documented *system context* where
   * authorization is the caller's responsibility.
   *
   * @throws `Conflict` if the username is already taken.
   */
  async createUser(params: CreateUserInput): Promise<UserDto> {
    await this.authorization.requireAllPermissions([USER_PERMISSIONS.CREATE]);
    const username = params.username.trim();
    if (username.length === 0) {
      throw AppException.badRequest('Username is required.');
    }
    if (username.length > 64) {
      throw AppException.badRequest('Username must be at most 64 characters.');
    }
    if (params.password.length < 1) {
      throw AppException.badRequest('Password is required.');
    }

    const existing = await this.repository.findByUsername(username);
    if (existing !== null) {
      throw AppException.conflict('A user with that username already exists.');
    }
    const createsActiveUser = params.isActive ?? true;
    const allocation = createsActiveUser
      ? await this.licensing.activeUserAllocation()
      : null;

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const passwordHash = await this.passwordService.hash(params.password);
    const mustChangePassword = params.mustChangePassword ?? false;
    const createInput = {
      id: generateId(),
      username,
      passwordHash,
      isActive: createsActiveUser,
      mustChangePassword,
      createdAt: now,
      updatedAt: now,
      createdBy: actorId,
    };
    const user =
      allocation === null
        ? await this.repository.create(createInput)
        : await this.repository.createActiveWithinLicenseLimit(
            createInput,
            allocation,
          );
    if (user === null) this.licensing.throwActiveUserLimitReached();

    await this.publish({
      type: USER_CREATED_EVENT,
      aggregateId: user.id,
      payload: { userId: user.id, username: user.username },
    });
    this.logger.log(
      'User created',
      { userId: user.id, username: user.username },
      UsersService.name,
    );
    return toUserDto(user);
  }

  /** Edit the user's identity (username). Cannot change password here. */
  async updateUser(id: string, input: UpdateUserInput): Promise<UserDto> {
    await this.authorization.requireAllPermissions([USER_PERMISSIONS.EDIT]);
    const user = await this.repository.findById(id);
    if (user === null || user.deletedAt !== null) {
      throw AppException.notFound('User', id);
    }

    const patch: {
      username?: string;
      updatedAt: Date;
      updatedBy: string | null;
    } = { updatedAt: new Date(), updatedBy: getPrincipal()?.userId ?? null };

    if (input.username !== undefined) {
      const username = input.username.trim();
      if (username.length === 0) {
        throw AppException.validation([
          {
            field: 'username',
            message: 'Username is required.',
            code: 'isNotEmpty',
          },
        ]);
      }
      if (username.length > 64) {
        throw AppException.validation([
          {
            field: 'username',
            message: 'Username must be at most 64 characters.',
            code: 'maxLength',
          },
        ]);
      }
      if (username !== user.username) {
        const clash = await this.repository.findByUsernameExcludingId(
          username,
          id,
        );
        if (clash !== null) {
          throw AppException.conflict(
            'A user with that username already exists.',
          );
        }
        patch.username = username;
      }
    }

    const updated = await this.repository.update(id, patch);
    if (updated === null) {
      throw AppException.notFound('User', id);
    }

    await this.publish({
      type: USER_UPDATED_EVENT,
      aggregateId: updated.id,
      payload: { userId: updated.id, username: updated.username },
    });
    return toUserDto(updated);
  }

  /**
   * Disable a user: the account can no longer authenticate and its existing
   * sessions are revoked by Identity, which subscribes to `User.Disabled`.
   *
   * Note (OQ-19): whether an administrator may disable *themselves* and how
   * the last remaining administrator account is protected are product
   * decisions that are not defined in the repository. This method therefore
   * applies no special case; the open question tracks the gap.
   */
  async disableUser(userId: string): Promise<UserDto> {
    await this.authorization.requireAllPermissions([USER_PERMISSIONS.DISABLE]);
    const updated = await this.repository.update(userId, {
      isActive: false,
      updatedAt: new Date(),
      updatedBy: getPrincipal()?.userId ?? null,
    });
    if (updated === null || updated.deletedAt !== null) {
      throw AppException.notFound('User', userId);
    }
    await this.publish({
      type: USER_DISABLED_EVENT,
      aggregateId: userId,
      payload: { userId, username: updated.username },
    });
    this.logger.log(
      'User disabled',
      { userId, username: updated.username },
      UsersService.name,
    );
    return toUserDto(updated);
  }

  /** Re-enable a previously disabled account. */
  async enableUser(userId: string): Promise<UserDto> {
    await this.authorization.requireAllPermissions([USER_PERMISSIONS.ENABLE]);
    const existing = await this.repository.findById(userId);
    if (existing === null || existing.deletedAt !== null) {
      throw AppException.notFound('User', userId);
    }
    const patch = {
      isActive: true as const,
      updatedAt: new Date(),
      updatedBy: getPrincipal()?.userId ?? null,
    };
    let updated: User | null;
    if (existing.isActive) {
      updated = await this.repository.update(userId, patch);
    } else {
      const allocation = await this.licensing.activeUserAllocation();
      const result = await this.repository.enableWithinLicenseLimit(
        userId,
        patch,
        allocation,
      );
      if (result.outcome === 'limit-reached') {
        this.licensing.throwActiveUserLimitReached();
      }
      updated = result.outcome === 'updated' ? result.user : null;
    }
    if (updated === null || updated.deletedAt !== null) {
      throw AppException.notFound('User', userId);
    }
    await this.publish({
      type: USER_ENABLED_EVENT,
      aggregateId: userId,
      payload: { userId, username: updated.username },
    });
    this.logger.log(
      'User enabled',
      { userId, username: updated.username },
      UsersService.name,
    );
    return toUserDto(updated);
  }

  /**
   * Administrator-initiated password reset (OQ-06: admin resets are the only
   * reset channel in v1; self-service reset is undecided).
   *
   * The new password is hashed and never logged or published. Identity revokes
   * the user's sessions on `User.PasswordReset` so a stolen session cannot
   * survive a credential change.
   *
   * No password *policy* is enforced beyond "non-empty": password rules are
   * not defined in the repository (OQ-06) and inventing one here would be a
   * business rule.
   */
  async resetPassword(
    userId: string,
    newPassword: string,
    options?: { mustChangePassword?: boolean | undefined },
  ): Promise<void> {
    await this.authorization.requireAllPermissions([
      USER_PERMISSIONS.RESET_PASSWORD,
    ]);
    if (newPassword.length < 1) {
      throw AppException.validation([
        {
          field: 'newPassword',
          message: 'New password is required.',
          code: 'isNotEmpty',
        },
      ]);
    }
    const user = await this.repository.findById(userId);
    if (user === null || user.deletedAt !== null) {
      throw AppException.notFound('User', userId);
    }

    const passwordHash = await this.passwordService.hash(newPassword);
    const mustChangePassword = options?.mustChangePassword ?? false;
    const updated = await this.repository.update(userId, {
      passwordHash,
      mustChangePassword,
      updatedAt: new Date(),
      updatedBy: getPrincipal()?.userId ?? null,
    });
    if (updated === null) {
      throw AppException.notFound('User', userId);
    }

    await this.publish({
      type: USER_PASSWORD_RESET_EVENT,
      aggregateId: userId,
      payload: { userId, username: updated.username },
    });
    this.logger.log(
      'User password reset by administrator',
      { userId, username: updated.username },
      UsersService.name,
    );
  }

  /**
   * Self-service password change for the authenticated user.
   *
   * Verifies `currentPassword` against the stored argon2id hash, enforces
   * password policy on `newPassword` (length, non-blank, distinct from
   * `currentPassword`), hashes `newPassword`, and atomically updates
   * `passwordHash` while clearing `mustChangePassword = false`.
   */
  async changeOwnPassword(
    userId: string,
    params: { currentPassword: string; newPassword: string },
    commitSessions: (transaction: DatabaseTransaction) => Promise<void>,
  ): Promise<User> {
    const existing = await this.findActiveById(userId);
    if (existing === null) {
      throw AppException.unauthorized('Authentication is required.');
    }

    if (params.currentPassword.length < 1) {
      throw AppException.validation([
        {
          field: 'currentPassword',
          message: 'Current password is required.',
          code: 'isNotEmpty',
        },
      ]);
    }

    const currentMatches = await this.passwordService.verify(
      existing.passwordHash,
      params.currentPassword,
    );
    if (!currentMatches) {
      throw AppException.validation([
        {
          field: 'currentPassword',
          message: 'Current password is incorrect.',
          code: 'invalidCurrentPassword',
        },
      ]);
    }

    if (
      params.newPassword.length < MIN_PASSWORD_LENGTH ||
      params.newPassword.trim().length === 0
    ) {
      throw AppException.validation([
        {
          field: 'newPassword',
          message: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
          code: 'minLength',
        },
      ]);
    }

    if (params.newPassword.length > MAX_PASSWORD_LENGTH) {
      throw AppException.validation([
        {
          field: 'newPassword',
          message: `New password must be at most ${MAX_PASSWORD_LENGTH} characters.`,
          code: 'maxLength',
        },
      ]);
    }

    if (
      params.newPassword === params.currentPassword ||
      (await this.passwordService.verify(
        existing.passwordHash,
        params.newPassword,
      ))
    ) {
      throw AppException.validation([
        {
          field: 'newPassword',
          message: 'New password must be different from the current password.',
          code: 'mustDifferFromCurrent',
        },
      ]);
    }

    const passwordHash = await this.passwordService.hash(params.newPassword);
    const updated = await this.withCurrentCredentials(
      existing,
      async (transaction) => {
        const changed = await this.repository.update(
          existing.id,
          {
            passwordHash,
            mustChangePassword: false,
            updatedAt: new Date(),
            updatedBy: existing.id,
          },
          transaction,
        );
        if (changed === null)
          throw AppException.unauthorized('Authentication is required.');
        // Identity owns session effects. Failure aborts BOTH modules' writes.
        await commitSessions(transaction);
        return changed;
      },
    );
    if (updated === null || !updated.isActive || updated.deletedAt !== null) {
      throw AppException.unauthorized('Authentication is required.');
    }

    await this.publish({
      type: USER_PASSWORD_CHANGED_EVENT,
      aggregateId: updated.id,
      payload: { userId: updated.id, username: updated.username },
    });
    this.logger.log(
      'User changed own password',
      { userId: updated.id, username: updated.username },
      UsersService.name,
    );
    return updated;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /** Attach correlation id + timestamp so every consumer sees a full event. */
  private async publish(
    event:
      | Omit<UserCreatedEvent, 'correlationId' | 'occurredAt' | 'aggregateType'>
      | Omit<UserUpdatedEvent, 'correlationId' | 'occurredAt' | 'aggregateType'>
      | Omit<
          UserDisabledEvent,
          'correlationId' | 'occurredAt' | 'aggregateType'
        >
      | Omit<UserEnabledEvent, 'correlationId' | 'occurredAt' | 'aggregateType'>
      | Omit<
          UserPasswordResetEvent,
          'correlationId' | 'occurredAt' | 'aggregateType'
        >
      | Omit<
          UserPasswordChangedEvent,
          'correlationId' | 'occurredAt' | 'aggregateType'
        >,
  ): Promise<void> {
    await this.events.publish({
      ...event,
      aggregateType: 'User',
      correlationId: getCorrelationId(),
      occurredAt: Date.now(),
    });
  }

  /**
   * How many users are active, for the licensing module's capacity-conflict
   * check (PDR-11 §8.6, L-04). Cross-module internal contract (AR-07):
   * carries no permission of its own — the calling operation has already
   * performed its own authorization — and counts through THIS module's
   * repository (`countActive()`), the exact count the active-user guard
   * enforces.
   */
  async countLicensedActiveUsers(): Promise<number> {
    return this.repository.countActive();
  }
}

// ---- Internal helpers ----

function resolveOrderBy(
  sort: string | undefined,
): Array<Record<string, 'asc' | 'desc'>> {
  if (sort === undefined || sort === '') return [{ username: 'asc' }];
  return sort.split(',').map((entry) => {
    const [field, direction] = entry.split(':');
    const mapped = field === undefined ? undefined : SORTABLE_FIELDS[field];
    if (mapped === undefined || (direction !== 'asc' && direction !== 'desc')) {
      throw AppException.validation([
        {
          field: 'sort',
          message: `Cannot sort users by "${field ?? ''}". Allowed: ${Object.keys(SORTABLE_FIELDS).join(', ')}.`,
          code: 'isSortableField',
        },
      ]);
    }
    return { [mapped]: direction };
  });
}
