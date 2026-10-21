import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/providers';
import { AppRoutes } from '@/app/router';
import * as identity from '@/api/identity.api';
import * as lic from '@/api/licensing';
import * as owner from '@/api/owner.api';
import { o } from '@/lib/owner-i18n';

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));
vi.mock('@/api/owner.api', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/owner.api')>('@/api/owner.api');
  return { ...actual, customer: vi.fn(), customers: vi.fn() };
});
vi.mock('@/api/licensing', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/licensing')>('@/api/licensing');
  return {
    ...actual,
    installationIdentities: vi.fn(),
    registerInstallationIdentity: vi.fn(),
    retireInstallationIdentity: vi.fn(),
    limitProfiles: vi.fn(),
    createLimitProfile: vi.fn(),
    retireLimitProfile: vi.fn(),
    reactivateLimitProfile: vi.fn(),
  };
});

const admin = {
  id: '01K76ZC2C29NQRB7R7R3GZAGZN',
  username: 'owner',
  role: 'OWNER_ADMIN' as const,
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-10-15T00:00:00.000Z',
};

const customerId = '01K76ZC2C29NQRB7R7R3GZAGZZ';
const installationId = '01K770CDMRGZP7RTERFB7A5A4V';

const customer = {
  id: customerId,
  customerCode: 'CUST-UI-01',
  displayName: 'مشتری رابط',
  status: 'ACTIVE' as const,
  contractReference: '',
  contractStartDate: null,
  contractEndDate: null,
  createdAt: '2026-10-19T08:00:00.000Z',
  updatedAt: '2026-10-19T08:00:00.000Z',
  createdBy: admin.id,
  updatedBy: admin.id,
};

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <AppProviders queryClient={client}>
      <MemoryRouter initialEntries={[`/app/customers/${customerId}`]}>
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
      'licenses.view',
      'licenses.issue.time_limited',
      'limit_profiles.manage',
    ],
  });
  vi.mocked(owner.customer).mockResolvedValue(customer);
  vi.mocked(lic.installationIdentities).mockResolvedValue({
    customerId,
    items: [
      {
        id: '01K7D0T5SET4HY654W9HREVCFT',
        customerId,
        installationId,
        source: 'CUSTOMER_VARDENA_SCREEN',
        sourceDetail: null,
        confirmedBy: admin.id,
        confirmedAt: '2026-10-19T08:00:00.000Z',
        confirmationEvidenceRef: 'TICKET-9',
        status: 'ACTIVE',
        createdBy: admin.id,
        createdAt: '2026-10-19T08:00:00.000Z',
        bindingEvidence: 'OPERATOR_RECORDED_NOT_CRYPTOGRAPHIC',
      },
    ],
  });
  vi.mocked(lic.limitProfiles).mockResolvedValue({
    customerId,
    activeProfile: null,
    items: [],
  });
});

describe('customer licensing sections', () => {
  it('shows the registered installation and states that the binding is a claim', async () => {
    mount();
    expect(await screen.findByText(installationId)).toBeInTheDocument();
    expect(screen.getByText(o.installations.help)).toBeInTheDocument();
    // The binding is described as an operator claim, not proof; the sentence
    // appears both in the section help and on the row.
    expect(
      screen.getAllByText((_content, node) =>
        (node?.textContent ?? '').includes(o.installations.evidenceClaim),
      ).length,
    ).toBeGreaterThan(0);
    // No ceiling recorded is described as “no ceiling”, never as forbidden.
    expect(
      (await screen.findAllByText(o.limitProfiles.emptyHelp)).length,
    ).toBeGreaterThan(0);
  });

  it('refuses a registration whose re-entered identifier differs, without calling the API', async () => {
    mount();
    await screen.findByText(installationId);
    await userEvent.click(
      screen.getByText(o.installations.register, { selector: 'summary' }),
    );
    await userEvent.type(
      screen.getByLabelText(o.installations.installationId),
      installationId,
    );
    await userEvent.type(
      screen.getByLabelText(o.installations.confirmation),
      '01K770CDMRGZP7RTERFB7A5A4X',
    );
    await userEvent.click(screen.getByLabelText(o.installations.checklist));
    const buttons = screen.getAllByRole('button', {
      name: o.installations.register,
    });
    await userEvent.click(buttons[buttons.length - 1]!);
    expect(
      await screen.findByText(o.installations.confirmationMismatch),
    ).toBeInTheDocument();
    expect(lic.registerInstallationIdentity).not.toHaveBeenCalled();
  });

  it('registers an installation identity from a re-entered, acknowledged identifier', async () => {
    vi.mocked(lic.registerInstallationIdentity).mockResolvedValue({
      customerId,
      items: [],
    });
    mount();
    await screen.findByText(installationId);
    await userEvent.click(
      screen.getByText(o.installations.register, { selector: 'summary' }),
    );
    await userEvent.type(
      screen.getByLabelText(o.installations.installationId),
      installationId,
    );
    await userEvent.type(
      screen.getByLabelText(o.installations.confirmation),
      installationId,
    );
    await userEvent.type(
      screen.getByLabelText(o.installations.evidence),
      'TICKET-10',
    );
    await userEvent.click(screen.getByLabelText(o.installations.checklist));
    const buttons = screen.getAllByRole('button', {
      name: o.installations.register,
    });
    await userEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() =>
      expect(lic.registerInstallationIdentity).toHaveBeenCalledWith({
        customerId,
        installationId,
        source: 'CUSTOMER_VARDENA_SCREEN',
        confirmationInstallationId: installationId,
        confirmationEvidenceRef: 'TICKET-10',
        confirmed: true,
      }),
    );
  });

  it('creates a limit profile with ceilings, modules and perpetual policy', async () => {
    vi.mocked(lic.createLimitProfile).mockResolvedValue({
      id: '01K7PROFILE000000000000000A',
      customerId,
      organizationLimit: 2,
      userLimit: 10,
      allowedModules: ['accounting'],
      perpetualAllowed: false,
      status: 'ACTIVE',
      createdBy: admin.id,
      createdAt: '2026-10-21T08:00:00.000Z',
      updatedBy: admin.id,
      updatedAt: '2026-10-21T08:00:00.000Z',
    });
    mount();
    await screen.findAllByText(o.limitProfiles.emptyHelp);
    await userEvent.click(
      screen.getByText(o.limitProfiles.create, { selector: 'summary' }),
    );
    await userEvent.type(
      screen.getByLabelText(o.limitProfiles.organizationLimit),
      '2',
    );
    await userEvent.type(
      screen.getByLabelText(o.limitProfiles.userLimit),
      '10',
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /accounting/ }));
    const buttons = screen.getAllByRole('button', {
      name: o.limitProfiles.create,
    });
    await userEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() =>
      expect(lic.createLimitProfile).toHaveBeenCalledWith(customerId, {
        organizationLimit: 2,
        userLimit: 10,
        allowedModules: ['accounting'],
        perpetualAllowed: false,
      }),
    );
  });

  it('refuses a profile without modules before calling the API', async () => {
    mount();
    await screen.findAllByText(o.limitProfiles.emptyHelp);
    await userEvent.click(
      screen.getByText(o.limitProfiles.create, { selector: 'summary' }),
    );
    const buttons = screen.getAllByRole('button', {
      name: o.limitProfiles.create,
    });
    await userEvent.click(buttons[buttons.length - 1]!);
    expect(
      await screen.findByText(o.limitProfiles.modulesRequired),
    ).toBeInTheDocument();
    expect(lic.createLimitProfile).not.toHaveBeenCalled();
  });
});
