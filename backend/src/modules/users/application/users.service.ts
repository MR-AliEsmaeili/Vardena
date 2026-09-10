import { Inject, Injectable } from '@nestjs/common';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import {
  getCorrelationId,
  getPrincipal,
} from '../../../kernel/correlation/request-context.js';
import { UsersRepository } from '../data/users.repository.js';
import { PasswordService } from '../domain/password.service.js';
import type { User, UserDto } from '../domain/user.js';
import { toUserDto } from '../domain/user.js';
import {
  USER_CREATED_EVENT,
  USER_DISABLED_EVENT,
  type UserCreatedEvent,
  type UserDisabledEvent,
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

/**
 * Users public application service.
 *
 * Owns: creating users, enabling/disabling, changing passwords, finding
 * users for authentication. The Identity module consumes this to verify
 * credentials; other modules consume it to read user data.
 *
 * NOT in scope for this session (per task brief):
 * - User CRUD endpoints (controller) — lands with the Users admin module.
 * - Roles / permissions (RBAC).
 * - Profiles / display names / email.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly repository: UsersRepository,
    private readonly passwordService: PasswordService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

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
   * Find a user by id, regardless of active state (used by admin flows —
   * not consumed by authentication).
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

  /**
   * Create a new user with an argon2id-hashed password. Used by seeding
   * scripts/tests in this session; a proper admin UI arrives with the Users
   * module.
   *
   * @throws `Conflict` if the username is already taken.
   */
  async createUser(params: {
    username: string;
    password: string;
    isActive?: boolean | undefined;
  }): Promise<UserDto> {
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

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const passwordHash = await this.passwordService.hash(params.password);
    const user = await this.repository.create({
      id: generateId(),
      username,
      passwordHash,
      isActive: params.isActive ?? true,
      createdAt: now,
      updatedAt: now,
      createdBy: actorId,
    });

    const event: UserCreatedEvent = {
      type: USER_CREATED_EVENT,
      aggregateType: 'User',
      aggregateId: user.id,
      payload: { userId: user.id, username: user.username },
      correlationId: getCorrelationId(),
      occurredAt: Date.now(),
    };
    await this.events.publish(event);

    this.logger.log(
      'User created',
      { userId: user.id, username: user.username },
      UsersService.name,
    );

    return toUserDto(user);
  }

  /** Disable a user. Called from the Users admin flow; Identity reacts to it. */
  async disableUser(userId: string): Promise<void> {
    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const updated = await this.repository.update(userId, {
      isActive: false,
      updatedAt: now,
      updatedBy: actorId,
    });
    if (updated === null) {
      throw AppException.notFound('User', userId);
    }
    const event: UserDisabledEvent = {
      type: USER_DISABLED_EVENT,
      aggregateType: 'User',
      aggregateId: userId,
      payload: { userId, username: updated.username },
      correlationId: getCorrelationId(),
      occurredAt: Date.now(),
    };
    await this.events.publish(event);
    this.logger.log('User disabled', { userId }, UsersService.name);
  }
}
