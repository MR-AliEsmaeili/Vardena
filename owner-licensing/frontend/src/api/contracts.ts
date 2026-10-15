/** Owner-only wire contract. API integration tests exercise the matching response shapes. */
export type Role =
  | 'SYSTEM_ADMIN'
  | 'LICENSE_ISSUANCE'
  | 'READ_ONLY_OBSERVER'
  | 'SUPPORT_SPECIALIST';
export interface AuthenticatedUser {
  id: string;
  username: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}
export interface LoginRequest {
  username: string;
  password: string;
}
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
export interface EffectivePermissions {
  permissions: string[];
}
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total?: number;
}
/** The only customer fields available to Support, on both list and detail. */
export interface CustomerIdentity {
  id: string;
  customerCode: string;
  displayName: string;
  status: 'ACTIVE' | 'INACTIVE';
}
export interface Customer extends CustomerIdentity {
  contractReference: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}
export type CustomerRead = CustomerIdentity | Customer;
export interface CustomerInput {
  customerCode: string;
  displayName: string;
  status: 'ACTIVE' | 'INACTIVE';
  contractReference: string;
}
export interface AuditEvent {
  id: string;
  actorId: string | null;
  eventType: string;
  targetType: string;
  targetId: string | null;
  occurredAt: string;
  outcome: string;
  reason: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
}
