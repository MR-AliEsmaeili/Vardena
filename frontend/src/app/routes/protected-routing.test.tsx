import { screen } from '@testing-library/react';
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

vi.mock('@/api/accounting.api', () => ({
  fetchChartTreePages: vi.fn().mockResolvedValue({
    nodes: [],
    total: 0,
    truncated: false,
  }),
  listFinancialAreas: vi.fn(),
  listFiscalYears: vi.fn(),
  listAccountingPeriods: vi.fn(),
  listPostableAccounts: vi.fn(),
  listGeneralLedger: vi.fn(),
  listTrialBalance: vi.fn(),
  getAccountStatement: vi.fn(),
  MAX_PAGE_SIZE: 500,
  CHART_TREE_MAX_PAGES: 10,
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');

beforeEach(() => {
  vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
    paginated([testOrganization]),
  );
});

describe('protected routing', () => {
  it('redirects an unauthenticated visitor from a private route to the login page', async () => {
    vi.mocked(identityApi.getCurrentUser).mockRejectedValue(
      new ApiError({ code: 'Unauthorized', message: 'x', status: 401 }),
    );

    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/accounting/general-ledger'],
    });

    expect(await screen.findByText(t.auth.loginTitle)).toBeInTheDocument();
  });

  it('renders the requested private route for an authenticated session', async () => {
    vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: allAccountingPermissions,
    });

    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/accounting/chart'],
    });

    expect(
      await screen.findByRole('heading', { name: t.chartTree.title }),
    ).toBeInTheDocument();
  });

  it('explains the missing permission instead of rendering the report', async () => {
    vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: ['Organization.Organization.View'],
    });

    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/accounting/trial-balance'],
    });

    expect(
      await screen.findByText(t.permissions.forbiddenTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Accounting\.TrialBalance\.View/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.trialBalance.title }),
    ).not.toBeInTheDocument();
  });

  it('shows the 404 page for an unknown path inside the application', async () => {
    vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: allAccountingPermissions,
    });

    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/does-not-exist'],
    });

    expect(await screen.findByText(t.app.notFoundTitle)).toBeInTheDocument();
  });

  it('hides navigation entries the session has no permission for', async () => {
    vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        'Organization.Organization.View',
        'Accounting.GeneralLedger.View',
      ],
    });

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    expect(
      await screen.findByRole('link', { name: t.nav.generalLedger }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: t.nav.trialBalance }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: t.nav.chartTree }),
    ).not.toBeInTheDocument();
  });
});
