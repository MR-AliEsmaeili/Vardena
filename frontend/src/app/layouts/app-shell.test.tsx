import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import type { AccountingDocument } from '@/api/contracts';
import { AppRoutes } from '@/app/router';
import { t } from '@/lib/i18n';
import {
  allAccountingPermissions,
  paginated,
  secondOrganization,
  testAccountingDocument,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';

/**
 * Application-shell / organization-resolution integration suite
 * (FE-UX-04/05).
 *
 * Everything between the API boundary and the DOM runs for real: the session
 * and organization providers, the permission gates, the query cache and the
 * shell's organization gate. Only `src/api/*` modules are stubbed.
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
  listFinancialAreas: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 500 }),
  listFiscalYears: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 500 }),
  listAccountingPeriods: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 500 }),
  listPostableAccounts: vi.fn(),
  listGeneralLedger: vi.fn(),
  listTrialBalance: vi.fn(),
  getAccountStatement: vi.fn(),
  listChartTree: vi.fn(),
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
const dashboardApi = await import('@/api/dashboard.api');

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: allAccountingPermissions,
  });
  vi.mocked(identityApi.logout).mockResolvedValue(undefined);
  vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
    paginated([testOrganization]),
  );
});

describe('organization resolution in the shell', () => {
  it('shows the Persian resolving state and no workspace while the scope is unknown', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockImplementation(
      () => new Promise(() => {}),
    );

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    expect(
      await screen.findByText(t.organization.resolving),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: t.nav.dashboard }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.dashboard.title }),
    ).not.toBeInTheDocument();
    expect(organizationApi.listOrganizations).not.toHaveBeenCalled();
  });

  it('enters the workspace directly for a single organization, without a selection step', async () => {
    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    expect(
      await screen.findByRole('heading', { level: 1, name: t.dashboard.title }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.organization.selectingSubmit }),
    ).not.toBeInTheDocument();
    // The single organization is displayed as a static indicator.
    expect(screen.getByText(testOrganization.name)).toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: t.organization.switcher }),
    ).not.toBeInTheDocument();
  });

  it('requires an explicit organization selection before the workspace loads', async () => {
    vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
      paginated([testOrganization, secondOrganization]),
    );
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    const dialog = await screen.findByRole('group', {
      name: t.organization.selectingTitle,
    });
    const firstRadio = within(dialog).getByRole('radio', {
      name: new RegExp(testOrganization.name),
    });
    const secondRadio = within(dialog).getByRole('radio', {
      name: new RegExp(secondOrganization.name),
    });
    const continueButton = screen.getByRole('button', {
      name: t.organization.selectingSubmit,
    });

    // The workspace is not entered and no organization is visually selected
    // before the user makes an explicit choice.
    expect(
      screen.queryByRole('heading', { name: t.dashboard.title }),
    ).not.toBeInTheDocument();
    expect(firstRadio).not.toBeChecked();
    expect(secondRadio).not.toBeChecked();
    expect(continueButton).toBeDisabled();

    expect(dashboardApi.listAccountingDocuments).not.toHaveBeenCalled();
    expect(dashboardApi.listAccountBalances).not.toHaveBeenCalled();
    expect(dashboardApi.listInventoryBalances).not.toHaveBeenCalled();
    expect(dashboardApi.listWorkflowInstances).not.toHaveBeenCalled();

    await user.click(secondRadio);
    expect(firstRadio).not.toBeChecked();
    expect(secondRadio).toBeChecked();
    expect(continueButton).toBeEnabled();
    // Choosing a radio is local UI state; scoped requests wait for Continue.
    expect(dashboardApi.listAccountingDocuments).not.toHaveBeenCalled();
    await user.click(continueButton);

    expect(
      await screen.findByRole('heading', { level: 1, name: t.dashboard.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: t.organization.switcher }),
    ).toHaveValue(secondOrganization.id);
  });

  it('preserves the requested route across the organization selection step', async () => {
    vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
      paginated([testOrganization, secondOrganization]),
    );
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/accounting/chart'],
    });

    const selection = await screen.findByRole('group', {
      name: t.organization.selectingTitle,
    });
    expect(
      screen.queryByRole('heading', { name: t.chartTree.title }),
    ).not.toBeInTheDocument();

    await user.click(
      within(selection).getByRole('radio', {
        name: new RegExp(testOrganization.name),
      }),
    );
    await user.click(
      screen.getByRole('button', { name: t.organization.selectingSubmit }),
    );

    expect(
      await screen.findByRole('heading', { name: t.chartTree.title }),
    ).toBeInTheDocument();
  });

  it('blocks the workspace with a Persian explainer and logout when no organization exists', async () => {
    vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
      paginated([]),
    );

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    const blocked = await screen.findByRole('main');
    expect(
      await within(blocked).findByText(t.organization.emptyTitle),
    ).toBeInTheDocument();
    expect(
      within(blocked).getByText(t.organization.emptyBody),
    ).toBeInTheDocument();
    // The blocked state itself offers the recovery action (the topbar keeps
    // its own logout affordance).
    expect(
      within(blocked).getByRole('button', { name: new RegExp(t.auth.logout) }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.dashboard.title }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.organization.selectingSubmit }),
    ).not.toBeInTheDocument();
  });

  it('blocks the workspace when the session cannot read the organization list', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: ['Accounting.GeneralLedger.View'],
    });

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    const blocked = await screen.findByRole('main');
    expect(
      await within(blocked).findByText(t.organization.errorTitle),
    ).toBeInTheDocument();
    expect(
      within(blocked).getByText(/Organization\.Organization\.View/),
    ).toBeInTheDocument();
    expect(
      within(blocked).getByRole('button', { name: new RegExp(t.auth.logout) }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.dashboard.title }),
    ).not.toBeInTheDocument();
  });

  it('surfaces an organization fetch failure with retry instead of degrading silently', async () => {
    vi.mocked(organizationApi.listOrganizations)
      .mockRejectedValueOnce(
        new ApiError({
          code: 'InternalError',
          message: 'x',
          status: 500,
          correlationId: 'corr-org-list',
        }),
      )
      .mockResolvedValue(paginated([testOrganization]));
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    expect(
      await screen.findByText(t.organization.errorTitle),
    ).toBeInTheDocument();
    expect(screen.getByText(/corr-org-list/)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.dashboard.title }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t.app.retry }));

    expect(
      await screen.findByRole('heading', { level: 1, name: t.dashboard.title }),
    ).toBeInTheDocument();
  });
});

describe('organization switch cache isolation (security)', () => {
  it('never renders organization A data while organization B loads, and evicts A cache', async () => {
    vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
      paginated([testOrganization, secondOrganization]),
    );
    // Organization 1 answers immediately with its own document; organization
    // 2 stays in flight so the test can observe exactly what is rendered
    // for B while its data has not arrived.
    const orgOneDocument: AccountingDocument = {
      ...testAccountingDocument,
      description: 'سند آزمایشی سازمان یک',
    };
    vi.mocked(dashboardApi.listAccountingDocuments).mockImplementation(
      (params: { organizationId: string }) =>
        params.organizationId === 'org-2'
          ? new Promise(() => {})
          : Promise.resolve({
              items: [orgOneDocument],
              total: 1,
              page: 1,
              pageSize: 9,
            }),
    );
    const user = userEvent.setup();
    const { queryClient } = renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app'],
    });

    // Explicitly choose and then confirm organization A on the selection screen.
    await user.click(
      await screen.findByRole('radio', {
        name: new RegExp(testOrganization.name),
      }),
    );
    await user.click(
      screen.getByRole('button', {
        name: t.organization.selectingSubmit,
      }),
    );
    expect(
      await screen.findByText('سند آزمایشی سازمان یک'),
    ).toBeInTheDocument();

    // A's scoped cache entries exist before the switch…
    const orgOneEntriesBefore = queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.queryKey[1] === 'org-1');
    expect(orgOneEntriesBefore.length).toBeGreaterThan(0);

    // …then switch to organization B through the topbar switcher.
    await user.selectOptions(
      await screen.findByRole('combobox', { name: t.organization.switcher }),
      'org-2',
    );

    // While B is loading, A's document rows must be gone — the old
    // organization's cached data is never displayed as B's data.
    await waitFor(() => {
      expect(dashboardApi.listAccountingDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-2' }),
        expect.anything(),
      );
    });
    expect(screen.queryByText('سند آزمایشی سازمان یک')).not.toBeInTheDocument();

    // A's scoped cache entries were evicted on the switch.
    const staleOrgOneEntries = queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.queryKey[1] === 'org-1')
      .map((query) => query.queryKey);
    expect(staleOrgOneEntries).toEqual([]);
  });
});

describe('shell navigation and breadcrumb', () => {
  it('marks the active route and renders the real breadcrumb hierarchy', async () => {
    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/accounting/chart'],
    });

    expect(
      await screen.findByRole('heading', { name: t.chartTree.title }),
    ).toBeInTheDocument();

    const activeLink = screen.getByRole('link', { name: t.nav.chartTree });
    expect(activeLink).toHaveAttribute('aria-current', 'page');

    const breadcrumb = screen.getByRole('navigation', {
      name: t.breadcrumb.label,
    });
    expect(
      within(breadcrumb).getByRole('link', { name: t.nav.dashboard }),
    ).toHaveAttribute('href', '/app');
    expect(
      within(breadcrumb).getByRole('link', { name: t.accounting.title }),
    ).toHaveAttribute('href', '/app/accounting');
    expect(within(breadcrumb).getByText(t.nav.chartTree)).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('does not render a breadcrumb for a single-level route', async () => {
    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });

    expect(
      await screen.findByRole('heading', { level: 1, name: t.dashboard.title }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: t.breadcrumb.label }),
    ).not.toBeInTheDocument();
  });

  it('hides navigation entries the session has no permission for', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        'Organization.Organization.View',
        'Accounting.Document.View',
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
