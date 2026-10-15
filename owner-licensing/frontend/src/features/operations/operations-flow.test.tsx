import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/providers';
import { AppRoutes } from '@/app/router';
import * as identity from '@/api/identity.api';
import * as api from '@/api/owner.api';
import { o } from '@/lib/owner-i18n';

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
  operationalRecords: vi.fn(),
  operationalRecord: vi.fn(),
  recordLicenseObservation: vi.fn(),
  recordActivationObservation: vi.fn(),
  recordServerReplacement: vi.fn(),
  recordOldServerObservation: vi.fn(),
  recordReplacementObservation: vi.fn(),
}));

const admin = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  username: 'owner',
  role: 'SYSTEM_ADMIN' as const,
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-10-15T00:00:00.000Z',
};
const customer = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  customerCode: 'Acme.01',
  displayName: 'مشتری',
  status: 'ACTIVE' as const,
  contractReference: 'HIDDEN',
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
  createdBy: admin.id,
  updatedBy: admin.id,
};
function mount(path: string) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
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
      'operations.view',
      'operations.record',
    ],
  });
  vi.mocked(api.customers).mockResolvedValue({
    items: [customer],
    total: 1,
    page: 1,
    pageSize: 50,
  });
  vi.mocked(api.operationalRecords).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
  });
  vi.mocked(api.recordLicenseObservation).mockResolvedValue({
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    customerId: customer.id,
    customerCode: customer.customerCode,
    displayName: customer.displayName,
    kind: 'LICENSE',
    observationCategory: 'EXTERNAL_ISSUANCE_OBSERVED',
    observedStatus: 'ISSUED',
    installationReference: 'INST-1',
    oldInstallationReference: null,
    replacementInstallationReference: null,
    oldServerObservedState: null,
    replacementObservedState: null,
    emergencyOldServerLost: false,
    replacesRecordId: null,
    evidenceBasis: 'OPERATOR_OBSERVED',
    cryptographicVerification: 'NOT_IMPLEMENTED',
    signedArtifactProduced: false,
    customerServerContacted: false,
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
    createdBy: admin.id,
    updatedBy: admin.id,
    transitions: [],
  });
});

describe('manual operations UI', () => {
  it('hides mutation controls from an observer and still labels observations as manual', async () => {
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      permissions: ['customers.view', 'audit.view', 'operations.view'],
    });
    mount('/app/operations');
    expect(await screen.findByText(o.emptyOperations)).toBeInTheDocument();
    expect(screen.getByText(o.manualBanner)).toBeInTheDocument();
    expect(screen.getByText(o.notReceipt)).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: o.recordIssuance }),
    ).not.toBeInTheDocument();
    expect(api.recordLicenseObservation).not.toHaveBeenCalled();
  });
  it('does not let Support open operational records', async () => {
    vi.mocked(identity.getCurrentUser).mockResolvedValue({
      ...admin,
      role: 'SUPPORT_SPECIALIST',
    });
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      permissions: ['customers.view'],
    });
    mount('/app/operations');
    expect(await screen.findByText(o.forbidden)).toBeInTheDocument();
    expect(api.operationalRecords).not.toHaveBeenCalled();
  });
  it('submits only a selected customer id after explicit manual confirmation', async () => {
    mount('/app/operations/activation/new');
    const user = userEvent.setup();
    expect(await screen.findByText(o.manualBanner)).toBeInTheDocument();
    await user.type(
      screen.getByRole('textbox', { name: o.customerSearch }),
      'Acme',
    );
    await user.click(await screen.findByRole('radio', { name: /مشتری/ }));
    await user.type(screen.getByLabelText(o.installation), 'INST-1');
    await user.type(screen.getByLabelText(o.reason), 'صدور خارجی مشاهده شد');
    await user.click(screen.getByRole('button', { name: o.recordIssuance }));
    expect(api.recordLicenseObservation).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('checkbox', { name: o.confirmObservation }),
    );
    await user.click(screen.getByRole('button', { name: o.recordIssuance }));
    expect(api.recordLicenseObservation).toHaveBeenCalledWith({
      customerId: customer.id,
      installationReference: 'INST-1',
      reason: 'صدور خارجی مشاهده شد',
      evidenceReference: undefined,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      o.savedObservation,
    );
  });
});
