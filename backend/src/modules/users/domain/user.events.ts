import type { DomainEvent } from '../../../kernel/events/domain-event-bus.js';

// ---------------------------------------------------------------------------
// User lifecycle domain events (docs/modules.md §Event catalog).
//
// These are emitted by the Users application service when a user is created,
// updated, disabled/enabled, or has their password reset. Other modules
// (Audit, Identity, Notifications) subscribe via the kernel `DomainEventBus`.
//
// Payloads deliberately exclude the password hash and the new password: an
// event is a notification, not a data transfer for credentials (AR-24).
// ---------------------------------------------------------------------------

export const USER_CREATED_EVENT = 'User.Created' as const;
export const USER_UPDATED_EVENT = 'User.Updated' as const;
export const USER_DISABLED_EVENT = 'User.Disabled' as const;
export const USER_ENABLED_EVENT = 'User.Enabled' as const;
export const USER_PASSWORD_RESET_EVENT = 'User.PasswordReset' as const;

export interface UserCreatedEvent extends DomainEvent {
  type: typeof USER_CREATED_EVENT;
  aggregateType: 'User';
  aggregateId: string;
  payload: { userId: string; username: string };
}

export interface UserUpdatedEvent extends DomainEvent {
  type: typeof USER_UPDATED_EVENT;
  aggregateType: 'User';
  aggregateId: string;
  payload: { userId: string; username: string };
}

export interface UserDisabledEvent extends DomainEvent {
  type: typeof USER_DISABLED_EVENT;
  aggregateType: 'User';
  aggregateId: string;
  payload: { userId: string; username: string };
}

export interface UserEnabledEvent extends DomainEvent {
  type: typeof USER_ENABLED_EVENT;
  aggregateType: 'User';
  aggregateId: string;
  payload: { userId: string; username: string };
}

/** An administrator reset this user's password (no credential in the payload). */
export interface UserPasswordResetEvent extends DomainEvent {
  type: typeof USER_PASSWORD_RESET_EVENT;
  aggregateType: 'User';
  aggregateId: string;
  payload: { userId: string; username: string };
}

export type UserEvent =
  | UserCreatedEvent
  | UserUpdatedEvent
  | UserDisabledEvent
  | UserEnabledEvent
  | UserPasswordResetEvent;
