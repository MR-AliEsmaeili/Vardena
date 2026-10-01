import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { AppRoutes } from '@/app/router';
import { t } from '@/lib/i18n';
import {
  allAccountingPermissions,
  paginated,
  testAccountingPeriod,
  testActiveLicenseState,
  testFinancialArea,
  testFiscalYear,
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
  listMyOrganizations: vi.fn(),
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
  listChartTree: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 500 }),
  fetchChartTreePages: vi
    .fn()
    .mockResolvedValue({ nodes: [], total: 0, truncated: false }),
  MAX_PAGE_SIZE: 500,
  CHART_TREE_MAX_PAGES: 10,
}));

vi.mock('@/api/licensing.api', () => ({
  getLicenseState: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');
const licensingApi = await import('@/api/licensing.api');

const unauthorized = new ApiError({
  code: 'Unauthorized',
  message: t.errors.unauthorized,
  status: 401,
  correlationId: 'corr-login',
});

beforeEach(() => {
  // The shell resolves the installation license before the organization
  // stage (ADR-0030); these scenarios run behind the local provider's
  // default active license.
  vi.mocked(licensingApi.getLicenseState).mockResolvedValue(
    testActiveLicenseState,
  );
  vi.mocked(identityApi.getCurrentUser).mockRejectedValue(unauthorized);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: allAccountingPermissions,
  });
  vi.mocked(identityApi.logout).mockResolvedValue(undefined);
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(accountingApi.listFinancialAreas).mockResolvedValue(
    paginated([testFinancialArea]),
  );
  vi.mocked(accountingApi.listFiscalYears).mockResolvedValue(
    paginated([testFiscalYear]),
  );
  vi.mocked(accountingApi.listAccountingPeriods).mockResolvedValue(
    paginated([testAccountingPeriod]),
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

  it('clears the password but keeps the username after a rejected login', async () => {
    vi.mocked(identityApi.login).mockRejectedValue(unauthorized);
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { initialEntries: ['/login'] });

    const usernameInput = await screen.findByLabelText(t.auth.username);
    const passwordInput = screen.getByLabelText(t.auth.password);
    await user.type(usernameInput, 'accountant');
    await user.type(passwordInput, 'wrong-password');
    await user.click(screen.getByRole('button', { name: t.auth.submit }));

    expect(
      await screen.findByText(t.auth.invalidCredentials),
    ).toBeInTheDocument();
    // The rejected secret must not be left in the field; the username stays so
    // the user only re-enters the password (FE-UX-02 §9).
    expect(passwordInput).toHaveValue('');
    expect(usernameInput).toHaveValue('accountant');
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

  it('returns to the deep-linked route after logging in', async () => {
    vi.mocked(identityApi.login).mockResolvedValue(testUser);
    const user = userEvent.setup();
    // Direct entry to a private deep link while unauthenticated: the guard
    // remembers the attempted route and the login restores it.
    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/accounting/chart'],
    });

    await user.type(
      await screen.findByLabelText(t.auth.username),
      'accountant',
    );
    await user.type(screen.getByLabelText(t.auth.password), 'correct-password');
    await user.click(screen.getByRole('button', { name: t.auth.submit }));

    expect(
      await screen.findByRole('heading', { name: t.chartTree.title }),
    ).toBeInTheDocument();
  });

  it('never honors a non-internal post-login destination (open-redirect guard)', async () => {
    vi.mocked(identityApi.login).mockResolvedValue(testUser);
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, {
      initialEntries: [
        { pathname: '/login', state: { from: 'https://evil.example/' } },
      ],
    });

    await user.type(
      await screen.findByLabelText(t.auth.username),
      'accountant',
    );
    await user.type(screen.getByLabelText(t.auth.password), 'correct-password');
    await user.click(screen.getByRole('button', { name: t.auth.submit }));

    // The application falls back to its own index, never to an external URL.
    expect(
      await screen.findByRole('heading', { level: 1, name: t.dashboard.title }),
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
