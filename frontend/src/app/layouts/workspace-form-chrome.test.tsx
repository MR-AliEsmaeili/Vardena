/**
 * Workspace form chrome — the shell contract of the compact header
 * (design-system.md §4–§5, ADR-0054).
 *
 * Rendered through the REAL shell: session → license → organization →
 * financial context → workspace dock → window host → route. Only `src/api/*`
 * is stubbed. What is asserted:
 *
 *  - the Open Windows bar is present and the routed content starts directly
 *    under it (no breadcrumb landmark, no second page-title block);
 *  - a record page carries the one shared compact header with a Back control;
 *  - a direct entry (refresh / pasted link) still has a safe Back target: the
 *    record's own list, never `history.back()` into nowhere.
 */

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

/* Hoisted so the `vi.mock` factory (hoisted above imports) can see it. */
const accountFixture = vi.hoisted(() => ({
  id: 'acc-1',
  organizationId: 'org-1',
  code: '1010',
  title: 'نقد',
  parentId: null,
  level: 2,
  codingStructureVersionId: null,
  accountingConfigurationId: null,
  accountNature: 'DEBIT',
  accountType: 'BALANCE_SHEET',
  detailGroupId: null,
  isPostable: false,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
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
  getAccount: vi.fn().mockResolvedValue(accountFixture),
  listFinancialAreas: vi.fn(),
  getFinancialArea: vi.fn(),
  listFiscalYears: vi.fn(),
  listAccountingPeriods: vi.fn(),
  listPostableAccounts: vi.fn(),
  listGeneralLedger: vi.fn(),
  listTrialBalance: vi.fn(),
  getAccountStatement: vi.fn(),
  MAX_PAGE_SIZE: 500,
  CHART_TREE_MAX_PAGES: 10,
}));

vi.mock('@/api/licensing.api', () => ({
  getLicenseState: vi.fn(),
  importLicenseDocument: vi.fn(),
  getClientDeviceInventory: vi.fn(),
  getClientDeviceHistory: vi.fn(),
  createDeviceEnrollmentChallenge: vi.fn(),
  activateDeviceEnrollment: vi.fn(),
  deactivateClientDevice: vi.fn(),
  createDeviceReplacementChallenge: vi.fn(),
  proveDeviceReplacement: vi.fn(),
  exportDeviceReplacementRequest: vi.fn(),
  importDeviceReplacementResponse: vi.fn(),
  cancelDeviceReplacement: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');
const licensingApi = await import('@/api/licensing.api');

beforeEach(() => {
  vi.mocked(licensingApi.getLicenseState).mockResolvedValue(
    testActiveLicenseState,
  );
  vi.mocked(licensingApi.getClientDeviceInventory).mockResolvedValue({
    installationId: testActiveLicenseState.installationId ?? 'install-1',
    licenseActive: true,
    deviceLimitSpecified: false,
    deviceLimit: null,
    activeDeviceCount: 0,
    availableDeviceSlots: 0,
    devices: [],
    replacements: [],
  });
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(accountingApi.listFinancialAreas).mockResolvedValue(
    paginated([testFinancialArea]),
  );
  vi.mocked(accountingApi.listFiscalYears).mockResolvedValue(
    paginated([testFiscalYear]),
  );
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: allAccountingPermissions,
  });
});

describe('workspace form chrome', () => {
  it('starts the form directly under the Open Windows bar with one compact header', async () => {
    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/accounting/accounts/acc-1'],
    });

    const header = await screen.findByTestId('form-page-header');
    expect(screen.getByTestId('workspace-dock')).toBeInTheDocument();

    // One heading for the page — no duplicate title block above the form.
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(
      within(header).getByRole('heading', {
        level: 1,
        name: t.masterData.accountDetail,
      }),
    ).toBeInTheDocument();

    // The removed page-level breadcrumb is really gone.
    expect(
      screen.queryByRole('navigation', { name: t.breadcrumb.label }),
    ).not.toBeInTheDocument();

    // The record identity survived the compaction.
    expect(
      within(header).getByText(
        `${accountFixture.code} — ${accountFixture.title}`,
      ),
    ).toBeInTheDocument();
  });

  it('sends Back from a directly opened record to its list window', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/accounting/accounts/acc-1'],
    });

    await screen.findByTestId('form-page-header');
    await user.click(screen.getByTestId('form-page-header-back'));

    // A real screen opens: the accounts list, as its own workspace window.
    expect(
      await screen.findByRole('heading', { name: t.masterData.accounts }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByTestId('workspace-window')).toHaveLength(2);
    });
    // Nothing was invented: no 404, no dead route.
    expect(screen.queryByText(t.app.notFoundTitle)).not.toBeInTheDocument();
  });
});
