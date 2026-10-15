import { apiGet, apiPost, apiPatch } from './client';
import type {
  AuditEvent,
  AuthenticatedUser,
  Customer,
  CustomerRead,
  CustomerInput,
  Paginated,
  Role,
} from './contracts';
export const customers = (search: string, page: number, signal?: AbortSignal) =>
  apiGet<Paginated<CustomerRead>>('/customers', {
    params: { search: search || undefined, page },
    ...(signal ? { signal } : {}),
  });
export const customer = (id: string, signal?: AbortSignal) =>
  apiGet<CustomerRead>(
    `/customers/${encodeURIComponent(id)}`,
    signal ? { signal } : {},
  );
export const createCustomer = (body: CustomerInput) =>
  apiPost<Customer, CustomerInput>('/customers', body);
export const updateCustomer = (
  id: string,
  body: Omit<CustomerInput, 'customerCode'> & { reason: string },
) => apiPatch<Customer>(`/customers/${encodeURIComponent(id)}`, body);
export const users = (page: number) =>
  apiGet<Paginated<AuthenticatedUser>>('/users', { params: { page } });
export const createUser = (body: {
  username: string;
  password: string;
  role: Role;
}) => apiPost<AuthenticatedUser>('/users', body);
export const updateUser = (
  id: string,
  body: { role: Role; isActive: boolean; reason: string },
) => apiPatch<AuthenticatedUser>(`/users/${encodeURIComponent(id)}`, body);
export const resetPassword = (
  id: string,
  body: { password: string; reason: string },
) =>
  apiPost<AuthenticatedUser>(
    `/users/${encodeURIComponent(id)}/reset-password`,
    body,
  );
export const auditEvents = (page: number, targetId?: string) =>
  apiGet<Paginated<AuditEvent>>('/audit-events', {
    params: { page, targetId },
  });
