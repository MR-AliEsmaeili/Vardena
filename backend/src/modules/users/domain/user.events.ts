import type { DomainEvent } from '../../../kernel/events/domain-event-bus.js';

// ---------------------------------------------------------------------------
// User lifecycle domain events (docs/modules.md §Event catalog).
//
// These are emitted by the Users application service when a user is created,
// updated, or disabled. Other modules (Audit, Identity, Notifications)
// subscribe via the kernel `DomainEventBus` when they land.
// ---------------------------------------------------------------------------

export const USER_CREATED_EVENT = 'User.Created' as const;
export const USER_UPDATED_EVENT = 'User.Updated' as const;
export const USER_DISABLED_EVENT = 'User.Disabled' as const;

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

export type UserEvent = UserCreatedEvent | UserUpdatedEvent | UserDisabledEvent;
