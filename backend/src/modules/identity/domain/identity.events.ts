import type { DomainEvent } from '../../../kernel/events/domain-event-bus.js';

// ---------------------------------------------------------------------------
// Identity lifecycle domain events (docs/modules.md §Event catalog).
//
// Published by Identity application services on meaningful auth state
// transitions so that Audit, Notifications, and future lockout/accounting
// modules can react without Identity needing to know about them (AR-07).
// ---------------------------------------------------------------------------

export const SESSION_CREATED_EVENT = 'UserSession.Created' as const;
export const SESSION_REVOKED_EVENT = 'UserSession.Revoked' as const;
export const LOGIN_FAILED_EVENT = 'Login.Failed' as const;

export interface SessionCreatedEvent extends DomainEvent {
  type: typeof SESSION_CREATED_EVENT;
  aggregateType: 'UserSession';
  aggregateId: string;
  payload: {
    sessionId: string;
    userId: string;
    username: string;
    ip: string | null;
  };
}

export interface SessionRevokedEvent extends DomainEvent {
  type: typeof SESSION_REVOKED_EVENT;
  aggregateType: 'UserSession';
  aggregateId: string;
  payload: {
    sessionId: string;
    userId: string;
    /** Why the session ended: 'logout' | 'revoked' | 'expired' | 'user_disabled' | 'password_change'. */
    reason:
      'logout' | 'revoked' | 'expired' | 'user_disabled' | 'password_change';
  };
}

export interface LoginFailedEvent extends DomainEvent {
  type: typeof LOGIN_FAILED_EVENT;
  aggregateType?: undefined;
  aggregateId?: undefined;
  payload: {
    /** Supplied username (always present — may not map to a real user). */
    username: string;
    /** Failure reason; never distinguishes "unknown user" vs "bad password"
     *  to the client, but is recorded for audit/lockout. */
    reason: 'invalid_credentials' | 'user_disabled';
    ip: string | null;
  };
}

export type IdentityEvent =
  SessionCreatedEvent | SessionRevokedEvent | LoginFailedEvent;
