import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { DashboardPage } from './dashboard-page';
import { t } from '@/lib/i18n';
import {
  allAccountingPermissions,
  paginated,
  testAccountBalances,
  testAccountingDocument,
  testAccountingPeriod,
  testFinancialArea,
  testFiscalYear,
  testInventoryBalance,
  testOrganization,
  testUser,
  testWorkflowInstance,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';

/**
 * The dashboard integration suite.
 *
 * API modules are stubbed exactly like the other page suites; everything
 * between the API boundary and the DOM (providers, permission gating, query
 * orchestration, widgets) runs for real.
 */

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
  listFinancialAreas: vi.fn(),
  listFiscalYears: vi.fn(),
  listAccountingPeriods: vi.fn(),
  listPostableAccounts: vi.fn(),
  listGeneralLedger: vi.fn(),
  listTrialBalance: vi.fn(),
  getAccountStatement: vi.fn(),
  fetchChartTreePages: vi.fn(),
  MAX_PAGE_SIZE: 500,
  CHART_TREE_MAX_PAGES: 10,
}));

vi.mock('@/api/dashboard.api', () => ({
  listAccountingDocuments: vi.fn(),
  listAccountBalances: vi.fn(),
  listInventoryBalances: vi.fn(),
  listWorkflowInstances: vi.fn(),
  MAX_PAGE_SIZE: 500,
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');
const dashboardApi = await import('@/api/dashboard.api');

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: allAccountingPermissions,
  });
  vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
    paginated([testOrganization]),
  );
  vi.mocked(accountingApi.listFinancialAreas).mockResolvedValue(
    paginated([testFinancialArea]),
  );
  vi.mocked(accountingApi.listFiscalYears).mockResolvedValue(
    paginated([testFiscalYear]),
  );
  vi.mocked(accountingApi.listAccountingPeriods).mockResolvedValue(
    paginated([testAccountingPeriod]),
  );
  vi.mocked(dashboardApi.listAccountingDocuments).mockResolvedValue(
    paginated([testAccountingDocument]),
  );
  vi.mocked(dashboardApi.listAccountBalances).mockResolvedValue(
    paginated(testAccountBalances),
  );
  vi.mocked(dashboardApi.listInventoryBalances).mockResolvedValue(
    paginated([testInventoryBalance]),
  );
  vi.mocked(dashboardApi.listWorkflowInstances).mockResolvedValue(
    paginated([testWorkflowInstance]),
  );
});

function renderDashboard(initialEntry = '/app') {
  return renderWithProviders(<DashboardPage />, {
    initialEntries: [initialEntry],
  });
}

// The permission/session/organization reference chain resolves sequentially
// before the dashboard queries fire; the default 1s finder timeout is too
// tight under parallel test files.
const WAIT = { timeout: 4000 } as const;

describe('dashboard page — states', () => {
  it('renders the exact KPI values in the success state', async () => {
    renderDashboard();

    expect(
      await screen.findByRole(
        'heading',
        {
          level: 1,
          name: t.dashboard.title,
        },
        WAIT,
      ),
    ).toBeInTheDocument();
    // Exact decimal strings with grouping only — never recomputed.
    expect(
      await screen.findByText('12,000.00', {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('3,000.50').length).toBeGreaterThan(0);
    expect(screen.getAllByText('8,999.50').length).toBeGreaterThan(0);
    // The scoped fiscal period status comes from the real periods endpoint.
    expect(screen.getByText(t.dashboard.periodOpen)).toBeInTheDocument();
  });

  it('renders skeleton placeholders first instead of a full-page spinner', async () => {
    vi.mocked(dashboardApi.listAccountBalances).mockReturnValue(
      new Promise(() => undefined),
    );
    renderDashboard();

    const kpiSection = await screen.findByRole(
      'region',
      { name: t.dashboard.kpiSectionLabel },
      WAIT,
    );
    expect(kpiSection.getAttribute('aria-busy')).toBe('true');
  });

  it('renders an error alert with a retry action when the balances call fails', async () => {
    vi.mocked(dashboardApi.listAccountBalances).mockRejectedValue(
      new ApiError({
        code: 'InternalError',
        message: 'boom',
        status: 500,
        correlationId: 'corr-dashboard',
      }),
    );
    renderDashboard();

    expect(
      (await screen.findAllByRole('alert', {}, WAIT)).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/corr-dashboard/).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('button', { name: t.app.retry }).length,
    ).toBeGreaterThan(0);
  });

  it('renders the empty presentation when the scope carries no balances', async () => {
    vi.mocked(dashboardApi.listAccountBalances).mockResolvedValue(
      paginated([]),
    );
    vi.mocked(dashboardApi.listAccountingDocuments).mockResolvedValue(
      paginated([]),
    );
    renderDashboard();

    expect(
      await screen.findByText(t.dashboard.documentsEmptyTitle, {}, WAIT),
    ).toBeInTheDocument();
    expect(
      (await screen.findAllByText(t.dashboard.chartEmpty, {}, WAIT)).length,
    ).toBeGreaterThan(0);
  });

  it('renders the honest no-permission presentation when the capability is missing', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [],
    });
    renderDashboard();

    // Every capability-gated section carries the same honest note.
    const notes = await screen.findAllByText(t.dashboard.noPermission, {}, WAIT);
    expect(notes.length).toBeGreaterThan(0);
  });
});

describe('dashboard page — documents table interactions', () => {
  it('requests the next page from the backend instead of slicing local data', async () => {
    // A realistic server window: one rendered row of twenty total, so the
    // next-page control is genuinely enabled.
    vi.mocked(dashboardApi.listAccountingDocuments).mockResolvedValue({
      items: [testAccountingDocument],
      total: 20,
      page: 1,
      pageSize: 9,
    });
    renderDashboard('/app?page=1&pageSize=9');

    // The table must have rendered its first server page before paging on.
    await screen.findByText('1001', {}, WAIT);
    fireEvent.click(screen.getByRole('button', { name: t.table.next }));

    await waitFor(
      () => {
        expect(dashboardApi.listAccountingDocuments).toHaveBeenCalledWith(
          expect.objectContaining({ page: 2 }),
          expect.anything(),
        );
      },
      { timeout: 4000 },
    );
  });

  it('never sends a request whose capability the session lacks', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [],
    });
    renderDashboard();

    await waitFor(() => {
      expect(identityApi.getEffectivePermissions).toHaveBeenCalled();
    });
    expect(dashboardApi.listAccountBalances).not.toHaveBeenCalled();
    expect(dashboardApi.listAccountingDocuments).not.toHaveBeenCalled();
    expect(dashboardApi.listInventoryBalances).not.toHaveBeenCalled();
    expect(dashboardApi.listWorkflowInstances).not.toHaveBeenCalled();
  });
});
