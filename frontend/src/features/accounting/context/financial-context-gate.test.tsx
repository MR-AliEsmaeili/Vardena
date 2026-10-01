import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { AppRoutes } from '@/app/router';
import { t } from '@/lib/i18n';
import {
  allAccountingPermissions,
  paginated,
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
vi.mock('@/api/licensing.api', () => ({ getLicenseState: vi.fn() }));
vi.mock('@/api/accounting.api', () => ({
  listFinancialAreas: vi.fn(),
  listFiscalYears: vi.fn(),
  createFinancialArea: vi.fn(),
  createFiscalYear: vi.fn(),
  listAccountingPeriods: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 500 }),
  listPostableAccounts: vi.fn(),
  listGeneralLedger: vi.fn(),
  listTrialBalance: vi.fn(),
  getAccountStatement: vi.fn(),
  fetchChartTreePages: vi
    .fn()
    .mockResolvedValue({ nodes: [], total: 0, truncated: false }),
  MAX_PAGE_SIZE: 500,
  CHART_TREE_MAX_PAGES: 10,
}));
vi.mock('@/api/dashboard.api', () => ({
  listAccountingDocuments: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 9 }),
  listAccountBalances: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 500 }),
  listInventoryBalances: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 }),
  listWorkflowInstances: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 }),
  MAX_PAGE_SIZE: 500,
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const licensingApi = await import('@/api/licensing.api');
const accountingApi = await import('@/api/accounting.api');

const secondArea = {
  ...testFinancialArea,
  id: 'area-2',
  code: 'ALT',
  title: 'حوزه مالی دوم',
};
const secondYear = {
  ...testFiscalYear,
  id: 'year-2',
  financialAreaId: 'area-2',
  code: '1406',
  title: 'سال مالی ۱۴۰۶',
  startDate: '2027-03-21',
  endDate: '2028-03-19',
};
const thirdYear = {
  ...secondYear,
  id: 'year-3',
  code: '1407',
  title: 'سال مالی ۱۴۰۷',
  startDate: '2028-03-20',
  endDate: '2029-03-19',
};

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: allAccountingPermissions,
  });
  vi.mocked(identityApi.logout).mockResolvedValue(undefined);
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(licensingApi.getLicenseState).mockResolvedValue(
    testActiveLicenseState,
  );
  vi.mocked(accountingApi.listFinancialAreas).mockResolvedValue(
    paginated([testFinancialArea]),
  );
  vi.mocked(accountingApi.listFiscalYears).mockResolvedValue(
    paginated([testFiscalYear]),
  );
});

describe('financial workspace context gate', () => {
  it('does not request fiscal years before the user explicitly selects one of several areas', async () => {
    vi.mocked(accountingApi.listFinancialAreas).mockResolvedValue(
      paginated([testFinancialArea, secondArea]),
    );

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    expect(
      await screen.findByRole('heading', {
        name: t.financialContext.areaTitle,
      }),
    ).toBeInTheDocument();
    expect(accountingApi.listFiscalYears).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('heading', { name: t.dashboard.title }),
    ).not.toBeInTheDocument();
  });

  it('requires explicit area and fiscal-year selection when multiple choices exist', async () => {
    vi.mocked(accountingApi.listFinancialAreas).mockResolvedValue(
      paginated([testFinancialArea, secondArea]),
    );
    vi.mocked(accountingApi.listFiscalYears).mockResolvedValue(
      paginated([
        testFiscalYear,
        { ...secondYear, financialAreaId: testFinancialArea.id },
      ]),
    );
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    await user.click(
      await screen.findByRole('radio', {
        name: new RegExp(testFinancialArea.title),
      }),
    );
    await user.click(
      screen.getByRole('button', { name: t.financialContext.continue }),
    );

    expect(
      await screen.findByRole('heading', {
        name: t.financialContext.fiscalYearTitle,
      }),
    ).toBeInTheDocument();
    expect(accountingApi.listFiscalYears).toHaveBeenLastCalledWith(
      {
        organizationId: testOrganization.id,
        financialAreaId: testFinancialArea.id,
        isActive: true,
        status: 'open',
      },
      expect.any(AbortSignal),
    );

    await user.click(
      screen.getByRole('radio', { name: new RegExp(testFiscalYear.title) }),
    );
    await user.click(
      screen.getByRole('button', { name: t.financialContext.continue }),
    );

    expect(
      await screen.findByRole('heading', { name: t.dashboard.title }),
    ).toBeInTheDocument();
  });

  it('renders a retryable area error and recovers without entering a stale workspace', async () => {
    vi.mocked(accountingApi.listFinancialAreas)
      .mockRejectedValueOnce(
        new ApiError({
          code: 'InternalError',
          message: 'x',
          status: 500,
          correlationId: 'context-error',
        }),
      )
      .mockResolvedValue(paginated([testFinancialArea]));
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    expect(
      await screen.findByText(t.financialContext.areaLoadFailed),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.dashboard.title }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t.app.retry }));

    expect(
      await screen.findByRole('heading', { name: t.dashboard.title }),
    ).toBeInTheDocument();
  });

  it('shows the authorized first-area creation form rather than fabricating an area', async () => {
    vi.mocked(accountingApi.listFinancialAreas).mockResolvedValue(
      paginated([]),
    );

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    expect(
      await screen.findByText(t.financialContext.areaEmptyTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: t.financialContext.createAreaTitle }),
    ).toBeInTheDocument();
    expect(accountingApi.createFinancialArea).not.toHaveBeenCalled();
  });

  it('creates the first area only from explicit input, then re-enters through the server list', async () => {
    vi.mocked(accountingApi.listFinancialAreas)
      .mockResolvedValueOnce(paginated([]))
      .mockResolvedValueOnce(paginated([testFinancialArea]));
    vi.mocked(accountingApi.createFinancialArea).mockResolvedValue(
      testFinancialArea,
    );
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    await user.type(
      await screen.findByLabelText(t.financialContext.code),
      testFinancialArea.code,
    );
    await user.type(
      screen.getByLabelText(t.financialContext.title),
      testFinancialArea.title,
    );
    await user.click(
      screen.getByRole('button', { name: t.financialContext.createArea }),
    );

    await waitFor(() => {
      expect(accountingApi.createFinancialArea).toHaveBeenCalledWith({
        organizationId: testOrganization.id,
        code: testFinancialArea.code,
        title: testFinancialArea.title,
      });
    });
    expect(
      await screen.findByRole('heading', { name: t.dashboard.title }),
    ).toBeInTheDocument();
  });

  it('creates the first open fiscal year under the selected area, then re-enters through the server list', async () => {
    vi.mocked(accountingApi.listFiscalYears)
      .mockResolvedValueOnce(paginated([]))
      .mockResolvedValueOnce(paginated([testFiscalYear]));
    vi.mocked(accountingApi.createFiscalYear).mockResolvedValue(testFiscalYear);
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    await user.type(
      await screen.findByLabelText(t.financialContext.code),
      testFiscalYear.code,
    );
    await user.type(
      screen.getByLabelText(t.financialContext.title),
      testFiscalYear.title,
    );
    await user.type(
      screen.getByLabelText(t.financialContext.startDate),
      testFiscalYear.startDate,
    );
    await user.type(
      screen.getByLabelText(t.financialContext.endDate),
      testFiscalYear.endDate,
    );
    await user.click(
      screen.getByRole('button', { name: t.financialContext.createFiscalYear }),
    );

    await waitFor(() => {
      expect(accountingApi.createFiscalYear).toHaveBeenCalledWith({
        organizationId: testOrganization.id,
        financialAreaId: testFinancialArea.id,
        code: testFiscalYear.code,
        title: testFiscalYear.title,
        startDate: testFiscalYear.startDate,
        endDate: testFiscalYear.endDate,
      });
    });
    expect(
      await screen.findByRole('heading', { name: t.dashboard.title }),
    ).toBeInTheDocument();
  });

  it('clears a stale fiscal-year selection when the active area changes', async () => {
    vi.mocked(accountingApi.listFinancialAreas).mockResolvedValue(
      paginated([testFinancialArea, secondArea]),
    );
    vi.mocked(accountingApi.listFiscalYears).mockImplementation((query) =>
      Promise.resolve(
        paginated(
          query.financialAreaId === secondArea.id
            ? [secondYear, thirdYear]
            : [testFiscalYear],
        ),
      ),
    );
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    await user.click(
      await screen.findByRole('radio', {
        name: new RegExp(testFinancialArea.title),
      }),
    );
    await user.click(
      screen.getByRole('button', { name: t.financialContext.continue }),
    );
    expect(
      await screen.findByRole('heading', { name: t.dashboard.title }),
    ).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole('combobox', { name: t.financialContext.areaSwitcher }),
      secondArea.id,
    );

    expect(
      screen.getByRole('combobox', { name: t.financialContext.areaSwitcher }),
    ).toHaveValue(secondArea.id);
    await waitFor(() => {
      expect(accountingApi.listFiscalYears).toHaveBeenLastCalledWith(
        expect.objectContaining({ financialAreaId: secondArea.id }),
        expect.any(AbortSignal),
      );
    });
    expect(
      await screen.findByRole('heading', {
        name: t.financialContext.fiscalYearTitle,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.dashboard.title }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(secondYear.title)).toBeInTheDocument();
  });
});
