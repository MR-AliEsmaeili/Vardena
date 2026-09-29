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
  listFinancialAreasPage: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 }),
  listFiscalYearsPage: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 }),
  listAccountingPeriodsPage: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 }),
  listAccounts: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 }),
  getAccount: vi.fn().mockResolvedValue({
    id: 'acc-1',
    organizationId: 'org-1',
    code: '10',
    title: 'دارایی‌ها',
    parentId: null,
    level: 1,
    codingStructureVersionId: null,
    accountingConfigurationId: null,
    accountNature: 'DEBIT',
    accountType: 'BALANCE_SHEET',
    detailGroupId: null,
    isPostable: false,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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

  it.each([
    [
      '/app/accounting/financial-areas',
      'Accounting.FinancialArea.View',
      t.masterData.financialAreas,
    ],
    [
      '/app/accounting/fiscal-years',
      'Accounting.FiscalYear.View',
      t.masterData.fiscalYears,
    ],
    [
      '/app/accounting/periods',
      'Accounting.AccountingPeriod.View',
      t.masterData.periods,
    ],
    ['/app/accounting/chart', 'Accounting.Account.View', t.chartTree.title],
    [
      '/app/accounting/accounts',
      'Accounting.Account.View',
      t.masterData.accounts,
    ],
    [
      '/app/accounting/accounts/acc-1',
      'Accounting.Account.View',
      t.masterData.accountDetail,
    ],
  ])(
    'allows %s with only its endpoint permission',
    async (path, permission, heading) => {
      vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
      vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
        userId: testUser.id,
        permissions: ['Organization.Organization.View', permission],
      });

      renderWithProviders(<AppRoutes />, { initialEntries: [path] });

      expect(
        await screen.findByRole('heading', { name: heading }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(t.permissions.forbiddenTitle),
      ).not.toBeInTheDocument();
    },
  );

  it('allows /app/accounting/documents/new with only Accounting.Document.Create — no Document.View prerequisite (backend permission alignment)', async () => {
    // The backend's `POST /accounting-documents` enforces exactly
    // `Accounting.Document.Create`; the create route must not additionally
    // require `Accounting.Document.View`.
    vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        'Organization.Organization.View',
        'Accounting.Document.Create',
      ],
    });

    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/accounting/documents/new'],
    });

    expect(
      await screen.findByRole('heading', { name: t.documents.createTitle }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(t.permissions.forbiddenTitle),
    ).not.toBeInTheDocument();
  });

  it('blocks /app/accounting/documents/new without Accounting.Document.Create', async () => {
    vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      // Has View (and could see the list/detail pages) but not Create.
      permissions: [
        'Organization.Organization.View',
        'Accounting.Document.View',
      ],
    });

    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/accounting/documents/new'],
    });

    expect(
      await screen.findByText(t.permissions.forbiddenTitle),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.documents.createTitle }),
    ).not.toBeInTheDocument();
  });

  it('still allows /app/accounting/documents/new for a session holding both Document.Create and Document.View (regression)', async () => {
    vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        'Organization.Organization.View',
        'Accounting.Document.View',
        'Accounting.Document.Create',
      ],
    });

    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/accounting/documents/new'],
    });

    expect(
      await screen.findByRole('heading', { name: t.documents.createTitle }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(t.permissions.forbiddenTitle),
    ).not.toBeInTheDocument();
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
