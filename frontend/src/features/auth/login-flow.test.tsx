import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { AppRoutes } from '@/app/router';
import { t } from '@/lib/i18n';
import {
  allAccountingPermissions,
  paginated,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));

vi.mock('@/api/organization.api', () => ({
  listOrganizations: vi.fn(),
  MAX_PAGE_SIZE: 500,
}));

vi.mock('@/api/dashboard.api', () => ({
  listAccountingDocuments: vi.fn().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 9,
  }),
  listAccountBalances: vi.fn().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 500,
  }),
  listInventoryBalances: vi.fn().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 10,
  }),
  listWorkflowInstances: vi.fn().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 10,
  }),
  MAX_PAGE_SIZE: 500,
}));

vi.mock('@/api/accounting.api', () => ({
  listFinancialAreas: vi.fn().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 500,
  }),
  listFiscalYears: vi.fn().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 500,
  }),
  listAccountingPeriods: vi.fn().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 500,
  }),
  listPostableAccounts: vi.fn(),
  listGeneralLedger: vi.fn(),
  listTrialBalance: vi.fn(),
  getAccountStatement: vi.fn(),
  listChartTree: vi.fn(),
  fetchChartTreePages: vi.fn(),
  MAX_PAGE_SIZE: 500,
  CHART_TREE_MAX_PAGES: 10,
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');

const unauthorized = new ApiError({
  code: 'Unauthorized',
  message: t.errors.unauthorized,
  status: 401,
  correlationId: 'corr-login',
});

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockRejectedValue(unauthorized);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: allAccountingPermissions,
  });
  vi.mocked(identityApi.logout).mockResolvedValue(undefined);
  vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
    paginated([testOrganization]),
  );
});

describe('login flow', () => {
  it('rejects an empty form client-side before calling the API', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { initialEntries: ['/login'] });

    await user.click(
      await screen.findByRole('button', { name: t.auth.submit }),
    );

    expect(
      await screen.findByText(t.auth.usernameRequired),
    ).toBeInTheDocument();
    expect(screen.getByText(t.auth.passwordRequired)).toBeInTheDocument();
    expect(identityApi.login).not.toHaveBeenCalled();
  });

  it('shows the generic server rejection without guessing the reason', async () => {
    vi.mocked(identityApi.login).mockRejectedValue(unauthorized);
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { initialEntries: ['/login'] });

    await user.type(
      await screen.findByLabelText(t.auth.username),
      'accountant',
    );
    await user.type(screen.getByLabelText(t.auth.password), 'wrong-password');
    await user.click(screen.getByRole('button', { name: t.auth.submit }));

    expect(
      await screen.findByText(t.auth.invalidCredentials),
    ).toBeInTheDocument();
    expect(screen.getByText(/corr-login/)).toBeInTheDocument();
  });

  it('enters the application shell after a successful login', async () => {
    vi.mocked(identityApi.login).mockResolvedValue(testUser);
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { initialEntries: ['/login'] });

    await user.type(
      await screen.findByLabelText(t.auth.username),
      'accountant',
    );
    await user.type(screen.getByLabelText(t.auth.password), 'correct-password');
    await user.click(screen.getByRole('button', { name: t.auth.submit }));

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: t.dashboard.title,
      }),
    ).toBeInTheDocument();
    expect(identityApi.login).toHaveBeenCalledWith({
      username: 'accountant',
      password: 'correct-password',
    });
    expect(
      await screen.findByRole('button', { name: new RegExp(t.auth.logout) }),
    ).toBeInTheDocument();
  });

  it('ends the session and returns to the login page on logout', async () => {
    vi.mocked(identityApi.login).mockResolvedValue(testUser);
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { initialEntries: ['/login'] });

    await user.type(
      await screen.findByLabelText(t.auth.username),
      'accountant',
    );
    await user.type(screen.getByLabelText(t.auth.password), 'correct-password');
    await user.click(screen.getByRole('button', { name: t.auth.submit }));

    await user.click(
      await screen.findByRole('button', { name: new RegExp(t.auth.logout) }),
    );

    await waitFor(() => {
      expect(identityApi.logout).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(t.auth.loginTitle)).toBeInTheDocument();
  });
});
