import type { DomainEvent } from '../../../kernel/events/domain-event-bus.js';

// ---------------------------------------------------------------------------
// Organization module domain events (docs/modules.md §Organization "Publishes",
// §Event catalog).
//
// Naming follows the repository convention `Entity.PastTenseVerb`. They are
// published by the module's application services and consumed by the future
// Audit/Notifications modules through the kernel `DomainEventBus`; there is no
// parallel audit table in this module (AR-23, master-data-strategy.md §7.10).
//
// Payload policy (task §39): stable identifiers plus the business code, and
// nothing else. In particular Party and Employee events carry NO name, email
// or phone — an event is a notification, not a copy of personal data.
// ---------------------------------------------------------------------------

/** Payload shared by every organization-scoped master-data event. */
export interface MasterDataEventPayload {
  /** ULID of the record. */
  id: string;
  /** Organization the record belongs to. */
  organizationId: string;
  /** Business code (not a name — codes are not personal data). */
  code: string;
}

/** Payload for the organization root itself (it has no parent organization). */
export interface OrganizationRootEventPayload {
  id: string;
  code: string;
}

interface ScopedEvent<
  TType extends string,
  TAggregate extends string,
  TPayload = MasterDataEventPayload,
> extends DomainEvent {
  type: TType;
  aggregateType: TAggregate;
  aggregateId: string;
  payload: TPayload;
}

// ---- Organization ----------------------------------------------------------

export const ORGANIZATION_CREATED_EVENT = 'Organization.Created' as const;
export const ORGANIZATION_UPDATED_EVENT = 'Organization.Updated' as const;
export const ORGANIZATION_ENABLED_EVENT = 'Organization.Enabled' as const;
export const ORGANIZATION_DISABLED_EVENT = 'Organization.Disabled' as const;

export type OrganizationCreatedEvent = ScopedEvent<
  typeof ORGANIZATION_CREATED_EVENT,
  'Organization',
  OrganizationRootEventPayload
>;
export type OrganizationUpdatedEvent = ScopedEvent<
  typeof ORGANIZATION_UPDATED_EVENT,
  'Organization',
  OrganizationRootEventPayload
>;
export type OrganizationEnabledEvent = ScopedEvent<
  typeof ORGANIZATION_ENABLED_EVENT,
  'Organization',
  OrganizationRootEventPayload
>;
export type OrganizationDisabledEvent = ScopedEvent<
  typeof ORGANIZATION_DISABLED_EVENT,
  'Organization',
  OrganizationRootEventPayload
>;

// ---- Branch ----------------------------------------------------------------

export const BRANCH_CREATED_EVENT = 'Branch.Created' as const;
export const BRANCH_UPDATED_EVENT = 'Branch.Updated' as const;
export const BRANCH_ENABLED_EVENT = 'Branch.Enabled' as const;
export const BRANCH_DISABLED_EVENT = 'Branch.Disabled' as const;

export type BranchCreatedEvent = ScopedEvent<
  typeof BRANCH_CREATED_EVENT,
  'Branch'
>;
export type BranchUpdatedEvent = ScopedEvent<
  typeof BRANCH_UPDATED_EVENT,
  'Branch'
>;
export type BranchEnabledEvent = ScopedEvent<
  typeof BRANCH_ENABLED_EVENT,
  'Branch'
>;
export type BranchDisabledEvent = ScopedEvent<
  typeof BRANCH_DISABLED_EVENT,
  'Branch'
>;

// ---- Department ------------------------------------------------------------

export const DEPARTMENT_CREATED_EVENT = 'Department.Created' as const;
export const DEPARTMENT_UPDATED_EVENT = 'Department.Updated' as const;
export const DEPARTMENT_ENABLED_EVENT = 'Department.Enabled' as const;
export const DEPARTMENT_DISABLED_EVENT = 'Department.Disabled' as const;

export type DepartmentCreatedEvent = ScopedEvent<
  typeof DEPARTMENT_CREATED_EVENT,
  'Department'
>;
export type DepartmentUpdatedEvent = ScopedEvent<
  typeof DEPARTMENT_UPDATED_EVENT,
  'Department'
>;
export type DepartmentEnabledEvent = ScopedEvent<
  typeof DEPARTMENT_ENABLED_EVENT,
  'Department'
>;
export type DepartmentDisabledEvent = ScopedEvent<
  typeof DEPARTMENT_DISABLED_EVENT,
  'Department'
>;

// ---- Employee --------------------------------------------------------------

export const EMPLOYEE_CREATED_EVENT = 'Employee.Created' as const;
export const EMPLOYEE_UPDATED_EVENT = 'Employee.Updated' as const;
export const EMPLOYEE_ENABLED_EVENT = 'Employee.Enabled' as const;
export const EMPLOYEE_DISABLED_EVENT = 'Employee.Disabled' as const;

export type EmployeeCreatedEvent = ScopedEvent<
  typeof EMPLOYEE_CREATED_EVENT,
  'Employee'
>;
export type EmployeeUpdatedEvent = ScopedEvent<
  typeof EMPLOYEE_UPDATED_EVENT,
  'Employee'
>;
export type EmployeeEnabledEvent = ScopedEvent<
  typeof EMPLOYEE_ENABLED_EVENT,
  'Employee'
>;
export type EmployeeDisabledEvent = ScopedEvent<
  typeof EMPLOYEE_DISABLED_EVENT,
  'Employee'
>;

// ---- Party -----------------------------------------------------------------

export const PARTY_CREATED_EVENT = 'Party.Created' as const;
export const PARTY_UPDATED_EVENT = 'Party.Updated' as const;
export const PARTY_ENABLED_EVENT = 'Party.Enabled' as const;
export const PARTY_DISABLED_EVENT = 'Party.Disabled' as const;

export type PartyCreatedEvent = ScopedEvent<typeof PARTY_CREATED_EVENT, 'Party'>;
export type PartyUpdatedEvent = ScopedEvent<typeof PARTY_UPDATED_EVENT, 'Party'>;
export type PartyEnabledEvent = ScopedEvent<typeof PARTY_ENABLED_EVENT, 'Party'>;
export type PartyDisabledEvent = ScopedEvent<
  typeof PARTY_DISABLED_EVENT,
  'Party'
>;

/** Every event this module publishes (used by tests to assert the catalog). */
export const ORGANIZATION_EVENT_TYPES = [
  ORGANIZATION_CREATED_EVENT,
  ORGANIZATION_UPDATED_EVENT,
  ORGANIZATION_ENABLED_EVENT,
  ORGANIZATION_DISABLED_EVENT,
  BRANCH_CREATED_EVENT,
  BRANCH_UPDATED_EVENT,
  BRANCH_ENABLED_EVENT,
  BRANCH_DISABLED_EVENT,
  DEPARTMENT_CREATED_EVENT,
  DEPARTMENT_UPDATED_EVENT,
  DEPARTMENT_ENABLED_EVENT,
  DEPARTMENT_DISABLED_EVENT,
  EMPLOYEE_CREATED_EVENT,
  EMPLOYEE_UPDATED_EVENT,
  EMPLOYEE_ENABLED_EVENT,
  EMPLOYEE_DISABLED_EVENT,
  PARTY_CREATED_EVENT,
  PARTY_UPDATED_EVENT,
  PARTY_ENABLED_EVENT,
  PARTY_DISABLED_EVENT,
] as const;
