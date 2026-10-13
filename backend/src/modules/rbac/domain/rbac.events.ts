import type { DomainEvent } from '../../../kernel/events/domain-event-bus.js';

// ---------------------------------------------------------------------------
// RBAC domain events (docs/modules.md §Event catalog, ADR-0006).
//
// Published by the RBAC application services. Consumers today: none (Audit
// and Notifications land in later sessions and subscribe here). Events carry
// the *assignment* change, never a permission decision, so the future Audit
// module can record "who changed what access" without this module owning a
// parallel audit table (task §21/§22).
// ---------------------------------------------------------------------------

export const ROLE_CREATED_EVENT = 'Role.Created' as const;
export const ROLE_UPDATED_EVENT = 'Role.Updated' as const;
export const ROLE_PERMISSION_ASSIGNED_EVENT =
  'RolePermission.Assigned' as const;
export const ROLE_PERMISSION_REMOVED_EVENT = 'RolePermission.Removed' as const;
export const USER_ROLE_ASSIGNED_EVENT = 'UserRole.Assigned' as const;
export const USER_ROLE_REMOVED_EVENT = 'UserRole.Removed' as const;

export interface RoleCreatedEvent extends DomainEvent {
  type: typeof ROLE_CREATED_EVENT;
  aggregateType: 'Role';
  aggregateId: string;
  payload: { roleId: string; name: string; permissionCodes: string[] };
}

export interface RoleUpdatedEvent extends DomainEvent {
  type: typeof ROLE_UPDATED_EVENT;
  aggregateType: 'Role';
  aggregateId: string;
  payload: { roleId: string; name: string };
}

export interface RolePermissionAssignedEvent extends DomainEvent {
  type: typeof ROLE_PERMISSION_ASSIGNED_EVENT;
  aggregateType: 'RolePermission';
  aggregateId: string;
  payload: { roleId: string; permissionCode: string };
}

export interface RolePermissionRemovedEvent extends DomainEvent {
  type: typeof ROLE_PERMISSION_REMOVED_EVENT;
  aggregateType: 'RolePermission';
  aggregateId: string;
  payload: { roleId: string; permissionCode: string };
}

export interface UserRoleAssignedEvent extends DomainEvent {
  type: typeof USER_ROLE_ASSIGNED_EVENT;
  aggregateType: 'UserRole';
  aggregateId: string;
  payload: { roleId: string; userId: string };
}

export interface UserRoleRemovedEvent extends DomainEvent {
  type: typeof USER_ROLE_REMOVED_EVENT;
  aggregateType: 'UserRole';
  aggregateId: string;
  payload: { roleId: string; userId: string };
}

export type RbacEvent =
  | RoleCreatedEvent
  | RoleUpdatedEvent
  | RolePermissionAssignedEvent
  | RolePermissionRemovedEvent
  | UserRoleAssignedEvent
  | UserRoleRemovedEvent;

/**
 * Stable aggregate id for assignment events (RolePermission/UserRole have a
 * composite key): `<left>:<right>`, so consumers can deduplicate.
 */
export function assignmentAggregateId(left: string, right: string): string {
  return `${left}:${right}`;
}
