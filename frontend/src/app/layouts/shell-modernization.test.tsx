import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/app/router';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { APPEARANCE_STORAGE_KEY } from '@/lib/appearance';
import { t } from '@/lib/i18n';
import { SIDEBAR_STORAGE_KEY } from '@/lib/sidebar-state';
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
  changePassword: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));
vi.mock('@/api/admin.api', () => ({
  updateUser: vi.fn(),
}));
vi.mock('@/api/organization.api', () => ({
  listMyOrganizations: vi.fn(),
  MAX_PAGE_SIZE: 500,
}));
vi.mock('@/api/licensing.api', () => ({
  getLicenseState: vi.fn(),
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
const adminApi = await import('@/api/admin.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');
const licensingApi = await import('@/api/licensing.api');

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
  vi.mocked(accountingApi.listFinancialAreas).mockResolvedValue(
    paginated([testFinancialArea]),
  );
  vi.mocked(accountingApi.listFiscalYears).mockResolvedValue(
    paginated([testFiscalYear]),
  );
  vi.mocked(licensingApi.getLicenseState).mockResolvedValue(
    testActiveLicenseState,
  );
});

describe('Header RTL order, Appearance Settings, Collapsible Sidebar & Global Search', () => {
  it('renders header slots in exact RTL DOM order: logo → search → date → organization → settings → profile', async () => {
    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });
    await screen.findByRole('heading', { level: 1, name: t.dashboard.title });

    const header = screen.getByTestId('app-header');
    const slotIds = Array.from(
      header.querySelectorAll('[data-testid^="header-slot-"]'),
    ).map((el) => el.getAttribute('data-testid'));

    expect(slotIds).toEqual([
      'header-slot-logo',
      'header-slot-search',
      'header-slot-date',
      'header-slot-organization',
      'header-slot-settings',
      'header-slot-profile',
    ]);
  });

  it('switches between Light/Dark theme and 3 font scales via Header Settings and persists to localStorage', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });
    await screen.findByRole('heading', { level: 1, name: t.dashboard.title });

    await user.click(screen.getByTestId('settings-toggle'));
    expect(screen.getByTestId('settings-panel')).toBeInTheDocument();

    await user.click(screen.getByTestId('theme-dark'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    await user.click(screen.getByTestId('font-scale-comfortable'));
    expect(document.documentElement.getAttribute('data-font-scale')).toBe(
      'comfortable',
    );

    await user.click(screen.getByTestId('font-scale-compact'));
    expect(document.documentElement.getAttribute('data-font-scale')).toBe(
      'compact',
    );

    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe(
      JSON.stringify({ theme: 'dark', fontScale: 'compact' }),
    );
  });

  it('collapses/expands sidebar with icon tooltips and collapses/expands domain groups persistently', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });
    await waitFor(() => {
      expect(accountingApi.listFiscalYears).toHaveBeenCalled();
    });
    const sidebar = await screen.findByTestId('app-sidebar');
    expect(sidebar).toHaveAttribute('data-collapsed', 'false');

    // Collapse accounting group while expanded
    const groupBtn = screen.getByTestId('sidebar-group-accounting');
    await user.click(groupBtn);
    expect(groupBtn).toHaveAttribute('aria-expanded', 'false');
    expect(
      within(sidebar).queryByRole('link', { name: t.nav.chartTree }),
    ).not.toBeInTheDocument();

    // Re-expand group
    await user.click(groupBtn);
    expect(
      within(sidebar).getByRole('link', { name: t.nav.chartTree }),
    ).toBeInTheDocument();

    // Collapse desktop sidebar -> icon-only mode with hover/focus tooltip
    await user.click(screen.getByTestId('sidebar-toggle'));
    expect(sidebar).toHaveAttribute('data-collapsed', 'true');
    expect(
      JSON.parse(localStorage.getItem(SIDEBAR_STORAGE_KEY) ?? '{}'),
    ).toMatchObject({
      collapsed: true,
    });

    const chartLink = within(sidebar).getByRole('link', {
      name: t.nav.chartTree,
    });
    await user.hover(chartLink);
    expect(screen.getByRole('tooltip')).toHaveTextContent(t.nav.chartTree);
  });

  it('keeps the collapse handle inside the sidebar — edge grip when open, above the workbench when folded', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });
    await screen.findByRole('heading', { level: 1, name: t.dashboard.title });

    const sidebar = await screen.findByTestId('app-sidebar');
    const header = screen.getByTestId('app-header');

    // The Header owns Search/Date/Context/Settings/Profile only.
    expect(
      within(header).queryByTestId('sidebar-toggle'),
    ).not.toBeInTheDocument();
    const handle = within(sidebar).getByTestId('sidebar-toggle');
    expect(handle).toHaveAttribute('aria-expanded', 'true');

    // Collapsed rail: the handle moves to the top row, above «میزکار», and the
    // handle stays reachable.
    await user.click(handle);
    expect(sidebar).toHaveAttribute('data-collapsed', 'true');
    expect(within(sidebar).getByTestId('sidebar-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    // Category markers survive icon-only mode: every permitted domain keeps a
    // labelled marker even though the rows themselves are icon-only.
    const markers = within(sidebar).getAllByTestId(/^sidebar-group-/);
    expect(markers.length).toBeGreaterThan(0);
    for (const marker of markers) {
      expect(marker).toHaveAttribute('aria-label');
    }
  });

  it('expands the rail to a category when its collapsed marker is chosen', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });
    await screen.findByRole('heading', { level: 1, name: t.dashboard.title });

    const sidebar = await screen.findByTestId('app-sidebar');
    await user.click(within(sidebar).getByTestId('sidebar-toggle'));
    expect(sidebar).toHaveAttribute('data-collapsed', 'true');

    // Collapse the accounting group first so the marker has something to reveal.
    await user.click(within(sidebar).getByTestId('sidebar-toggle'));
    await user.click(screen.getByTestId('sidebar-group-accounting'));
    await user.click(within(sidebar).getByTestId('sidebar-toggle'));

    await user.click(screen.getByTestId('sidebar-group-accounting'));

    expect(sidebar).toHaveAttribute('data-collapsed', 'false');
    expect(screen.getByTestId('sidebar-group-accounting')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(
      within(sidebar).getByRole('link', { name: t.nav.chartTree }),
    ).toBeInTheDocument();
  });

  it('folds the rail after a menu selection so the opened surface gets the full width', async () => {
    const user = userEvent.setup();
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });

    try {
      renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });
      await screen.findByRole('heading', { level: 1, name: t.dashboard.title });
      const sidebar = await screen.findByTestId('app-sidebar');
      expect(sidebar).toHaveAttribute('data-collapsed', 'false');

      await user.click(
        within(sidebar).getByRole('link', { name: t.nav.chartTree }),
      );

      expect(sidebar).toHaveAttribute('data-collapsed', 'true');
      expect(
        JSON.parse(localStorage.getItem(SIDEBAR_STORAGE_KEY) ?? '{}'),
      ).toMatchObject({ collapsed: true });
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      });
    }
  });

  it('focuses Global Search on Ctrl+K, filters strictly by permitted routes, and navigates on Enter', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        PERMISSIONS.organization.view,
        PERMISSIONS.accounting.accountView,
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });
    await screen.findByRole('heading', { level: 1, name: t.dashboard.title });

    await user.keyboard('{Control>}k{/Control}');
    const searchInput = screen.getByTestId('global-search-input');
    expect(searchInput).toHaveFocus();

    // Trial balance is unpermitted -> must not appear
    await user.type(searchInput, 'تراز');
    expect(screen.getByTestId('global-search-results')).toHaveTextContent(
      t.nav.globalSearchEmpty,
    );

    // Chart tree IS permitted -> appears and navigates on Enter
    await user.clear(searchInput);
    await user.type(searchInput, 'درخت');
    expect(screen.getByTestId('global-search-results')).toHaveTextContent(
      t.nav.chartTree,
    );
    await user.keyboard('{Enter}');

    expect(
      await screen.findByRole('heading', { name: t.chartTree.title }),
    ).toBeInTheDocument();
  });
});

describe('Profile menu & /app/profile page', () => {
  it('opens /app/profile from Profile Menu, updates username when holding Users.User.Edit, and changes password via real API', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [...allAccountingPermissions, PERMISSIONS.users.edit],
    });
    vi.mocked(adminApi.updateUser).mockResolvedValue({
      ...testUser,
      username: 'senior_accountant',
    });
    vi.mocked(identityApi.changePassword).mockResolvedValue({
      ...testUser,
      username: 'senior_accountant',
      mustChangePassword: false,
    });

    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { initialEntries: ['/app'] });
    await screen.findByRole('heading', { level: 1, name: t.dashboard.title });

    // Open profile dropdown and navigate to /app/profile
    await user.click(screen.getByTestId('profile-toggle'));
    await user.click(screen.getByTestId('profile-menu-open-profile'));

    expect(
      await screen.findByRole('heading', { level: 1, name: t.profile.title }),
    ).toBeInTheDocument();

    // Update username
    const usernameInput = screen.getByLabelText(t.profile.usernameLabel);
    await user.clear(usernameInput);
    await user.type(usernameInput, 'senior_accountant');
    await user.click(screen.getByTestId('profile-save-username'));

    await waitFor(() => {
      expect(adminApi.updateUser).toHaveBeenCalledWith(testUser.id, {
        username: 'senior_accountant',
      });
    });

    // Change password
    await user.type(
      screen.getByLabelText(t.auth.currentPassword),
      'old-pass-123',
    );
    await user.type(screen.getByLabelText(t.auth.newPassword), 'new-pass-456');
    await user.type(
      screen.getByLabelText(t.auth.confirmPassword),
      'new-pass-456',
    );
    await user.click(screen.getByTestId('profile-change-password-submit'));

    await waitFor(() => {
      expect(identityApi.changePassword).toHaveBeenCalledWith({
        currentPassword: 'old-pass-123',
        newPassword: 'new-pass-456',
      });
    });
  });
});
