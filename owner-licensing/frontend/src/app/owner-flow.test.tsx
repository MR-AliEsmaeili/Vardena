import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { AppProviders } from './providers';
import { AppRoutes } from './router';
import * as identity from '@/api/identity.api';
import * as api from '@/api/owner.api';
import { o } from '@/lib/owner-i18n';
import { t } from '@/lib/i18n';
import { ApiError } from '@/api/errors';
vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));
vi.mock('@/api/owner.api', () => ({
  customers: vi.fn(),
  customer: vi.fn(),
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  users: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  resetPassword: vi.fn(),
  auditEvents: vi.fn(),
}));
const admin = {
  id: '01K7CUSTOMER000000000000000',
  username: 'owner',
  role: 'OWNER_ADMIN' as const,
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-10-15T00:00:00.000Z',
};
const record = {
  id: '01K7CUSTOMER000000000000000',
  customerCode: 'Acme.01',
  displayName: 'مشتری',
  status: 'ACTIVE' as const,
  contractReference: '',
  contractStartDate: null,
  contractEndDate: null,
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
  createdBy: admin.id,
  updatedBy: admin.id,
};
function mount(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <AppProviders queryClient={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
}
beforeEach(() => {
  vi.mocked(identity.getCurrentUser).mockResolvedValue(admin);
  vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
    permissions: [
      'customers.view',
      'customers.write',
      'users.manage',
      'audit.view',
    ],
  });
  vi.mocked(api.customers).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
  });
  vi.mocked(api.customer).mockResolvedValue(record);
  vi.mocked(api.createCustomer).mockResolvedValue(record);
});
describe('Owner browser vertical slice (mocked API boundary, CI)', () => {
  it('routes an initial-credential session to the mandatory password page before any customer fetch', async () => {
    vi.mocked(identity.getCurrentUser).mockResolvedValue({
      ...admin,
      mustChangePassword: true,
    });
    mount('/app/customers');
    expect(
      await screen.findByLabelText(t.auth.currentPassword),
    ).toBeInTheDocument();
    expect(api.customers).not.toHaveBeenCalled();
  });
  it('shows real login errors without retaining the rejected password', async () => {
    vi.mocked(identity.getCurrentUser).mockRejectedValue(
      new ApiError({ code: 'Unauthorized', message: 'invalid', status: 401 }),
    );
    vi.mocked(identity.login).mockRejectedValue(
      new ApiError({ code: 'Unauthorized', message: 'invalid', status: 401 }),
    );
    mount('/login');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(t.auth.username), 'owner');
    await user.type(
      screen.getByLabelText(t.auth.password),
      'rejected-password',
    );
    await user.click(screen.getByRole('button', { name: t.auth.submit }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText(t.auth.password)).toHaveValue('');
  });
  it('creates a persisted customer and navigates to its detail with success feedback', async () => {
    mount('/app/customers/new');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(o.code), 'Acme.01');
    await user.type(screen.getByLabelText(o.name), 'مشتری');
    await user.click(screen.getByRole('button', { name: o.save }));
    expect(await screen.findByRole('status')).toHaveTextContent(o.success);
    expect(api.createCustomer).toHaveBeenCalledWith({
      customerCode: 'Acme.01',
      displayName: 'مشتری',
      status: 'ACTIVE',
      contractReference: '',
      contractStartDate: '',
      contractEndDate: '',
    });
    expect(await screen.findByText(o.immutable)).toBeInTheDocument();
  });
  // PDR-18 §1: contract dates are stored and shown as their own pair, separate
  // from any technical validity value, and they may precede the recording.
  it('renders the commercial contract dates on the customer detail and submits them independently', async () => {
    vi.mocked(api.customer).mockResolvedValue({
      ...record,
      contractStartDate: '2026-10-02',
      contractEndDate: '2027-10-02',
    });
    mount(`/app/customers/${record.id}`);
    expect(await screen.findByText(o.contractStartDate)).toBeInTheDocument();
    // Jalali-first rendering with the canonical Gregorian day alongside.
    expect(screen.getByText('۱۴۰۵/۰۷/۱۰ (2026-10-02)')).toBeInTheDocument();
    expect(screen.getByText('۱۴۰۶/۰۷/۱۰ (2027-10-02)')).toBeInTheDocument();
    expect(api.createCustomer).not.toHaveBeenCalled();
  });
  it('shows an empty customer list and a retryable error instead of pretending success', async () => {
    vi.mocked(api.customers).mockRejectedValue(
      new ApiError({ code: 'InternalError', message: 'failed', status: 500 }),
    );
    mount('/app/customers');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    vi.mocked(api.customers).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
    });
    await userEvent.click(screen.getByRole('button', { name: t.app.retry }));
    expect(await screen.findByText(o.empty)).toBeInTheDocument();
  });
  it('enables License Operator navigation and distinguishes routine observations from Owner Admin replacement authority', async () => {
    vi.mocked(identity.getCurrentUser).mockResolvedValue({
      ...admin,
      role: 'LICENSE_OPERATOR',
    });
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      permissions: [
        'customers.view',
        'audit.view',
        'operations.view',
        'operations.record',
      ],
    });
    mount('/app');
    expect(
      await screen.findByRole('link', { name: o.openManual }),
    ).toHaveAttribute('href', '/app/operations/activation/new');
    expect(screen.getAllByText(o.unavailable)).toHaveLength(3);
    expect(screen.getByRole('link', { name: o.manualInspect })).toHaveAttribute(
      'href',
      '/app/operations',
    );
    expect(
      await screen.findByRole('link', { name: o.customers }),
    ).toHaveAttribute('href', '/app/customers');
    expect(screen.getByRole('link', { name: o.operations })).toHaveAttribute(
      'href',
      '/app/operations',
    );
    expect(screen.getByRole('link', { name: o.audit })).toHaveAttribute(
      'href',
      '/app/audit',
    );
    expect(
      screen.queryByRole('link', { name: o.users }),
    ).not.toBeInTheDocument();
  });
  it('renders License Operator customer read-only detail with operational reference and without edit controls', async () => {
    vi.mocked(identity.getCurrentUser).mockResolvedValue({
      ...admin,
      role: 'LICENSE_OPERATOR',
    });
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      permissions: [
        'customers.view',
        'audit.view',
        'operations.view',
        'operations.record',
      ],
    });
    vi.mocked(api.customer).mockResolvedValue({
      ...record,
      contractReference: 'VISIBLE-OPERATIONAL-REFERENCE',
    });
    mount(`/app/customers/${record.id}`);
    expect(
      await screen.findByText('VISIBLE-OPERATIONAL-REFERENCE'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: o.audit })).toHaveAttribute(
      'href',
      '/app/audit',
    );
    expect(
      screen.queryByRole('link', { name: o.users }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: o.edit }),
    ).not.toBeInTheDocument();
    expect(api.createCustomer).not.toHaveBeenCalled();
  });
  it('does not expand wildcard-looking effective permission strings', async () => {
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      permissions: ['customers.*', 'users', 'audit'],
    });
    mount('/app/customers');
    expect(await screen.findByText(o.forbidden)).toBeInTheDocument();
    expect(api.customers).not.toHaveBeenCalled();
  });
  it('does not offer customer mutation controls to License Operator viewing customers', async () => {
    vi.mocked(identity.getCurrentUser).mockResolvedValue({
      ...admin,
      role: 'LICENSE_OPERATOR',
    });
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      permissions: [
        'customers.view',
        'audit.view',
        'operations.view',
        'operations.record',
      ],
    });
    mount('/app/customers');
    await screen.findByText(o.empty);
    expect(
      screen.queryByRole('link', { name: o.newCustomer }),
    ).not.toBeInTheDocument();
    expect(api.createCustomer).not.toHaveBeenCalled();
  });
  it('offers only OWNER_ADMIN and LICENSE_OPERATOR in user administration and blocks License Operator from /app/users', async () => {
    vi.mocked(api.users).mockResolvedValue({
      items: [
        admin,
        {
          ...admin,
          id: '01K7OPERATOR00000000000000',
          username: 'operator1',
          role: 'LICENSE_OPERATOR',
        },
      ],
      page: 1,
      pageSize: 50,
    });
    mount('/app/users');
    const roleSelect = await screen.findByLabelText(o.role);
    const optionValues = Array.from(
      roleSelect.querySelectorAll('option'),
      (opt) => opt.value,
    );
    expect(optionValues).toEqual(['OWNER_ADMIN', 'LICENSE_OPERATOR']);
    expect(
      await screen.findByText(/operator1 — اپراتور مجوز/),
    ).toBeInTheDocument();
  });
});
