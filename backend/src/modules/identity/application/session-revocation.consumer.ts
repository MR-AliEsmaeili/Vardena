import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import {
  USER_DISABLED_EVENT,
  USER_PASSWORD_RESET_EVENT,
  type UserDisabledEvent,
  type UserPasswordResetEvent,
} from '../../users/domain/user.events.js';
import { SessionsRepository } from '../data/sessions.repository.js';

/**
 * Revokes a user's sessions when their account state or credentials change
 * (docs/modules.md §Identity: "deactivated users' sessions are revoked via
 * event"; docs/security.md §2).
 *
 * Subscribes to:
 * - `User.Disabled` — a disabled account must not keep working sessions.
 * - `User.PasswordReset` — an administrator reset must not leave a possibly
 *   stolen session usable (the user re-authenticates with the new password).
 *
 * This is defense in depth, not the primary control: `AuthGuard` re-validates
 * the user on every request, so a disabled user is rejected even if this
 * subscriber fails (the event bus deliberately swallows subscriber errors so a
 * notification failure never breaks the write that triggered it). The consumer
 * therefore logs what it revoked and never throws.
 *
 * Idempotence (AR-07): revoking an already-revoked session is a no-op, so
 * duplicate delivery is harmless.
 */
@Injectable()
export class SessionRevocationConsumer implements OnApplicationBootstrap {
  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
    private readonly sessions: SessionsRepository,
    private readonly logger: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.events.on<UserDisabledEvent>(USER_DISABLED_EVENT, (event) =>
      this.revokeAll(event.payload.userId, 'User.Disabled'),
    );
    this.events.on<UserPasswordResetEvent>(USER_PASSWORD_RESET_EVENT, (event) =>
      this.revokeAll(event.payload.userId, 'User.PasswordReset'),
    );
  }

  private async revokeAll(userId: string, cause: string): Promise<void> {
    try {
      const revoked = await this.sessions.revokeAllForUser(
        userId,
        null,
        new Date(),
      );
      this.logger.log(
        'Sessions revoked for user',
        { userId, revoked, cause },
        SessionRevocationConsumer.name,
      );
    } catch (error) {
      // Never rethrow: the account change itself already succeeded, and the
      // authentication guard still rejects the sessions (it re-reads the user).
      this.logger.error(
        'Failed to revoke sessions for user',
        {
          userId,
          cause,
          error: error instanceof Error ? error.message : String(error),
        },
        SessionRevocationConsumer.name,
      );
    }
  }
}
