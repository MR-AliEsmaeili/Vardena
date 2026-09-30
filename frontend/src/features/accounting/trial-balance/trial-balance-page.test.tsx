import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/lib/i18n';
import {
  allAccountingPermissions,
  paginated,
  testFinancialArea,
  testFiscalYear,
  testOrganization,
  testUser,
  trialBalanceRow,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { TrialBalancePage } from './trial-balance-page';

vi.mock('@/api/identity.api', () => ({
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
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
  listTrialBalance: vi.fn(),
  getAccountStatement: vi.fn(),
  listGeneralLedger: vi.fn(),
  listChartTree: vi.fn(),
  fetchChartTreePages: vi.fn(),
  MAX_PAGE_SIZE: 500,
  CHART_TREE_MAX_PAGES: 10,
}));
const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');
const listTrialBalanceMock = vi.mocked(accountingApi.listTrialBalance);

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
    paginated([]),
  );
  vi.mocked(accountingApi.listPostableAccounts).mockResolvedValue(
    paginated([]),
  );
});

describe('Trial Balance URL-owned report state', () => {
  it('does not execute until the required scope is applied, then sends the server query', async () => {
    vi.mocked(accountingApi.listTrialBalance).mockResolvedValue(
      paginated([trialBalanceRow]),
    );
    const user = userEvent.setup();
    renderWithProviders(<TrialBalancePage />);
    expect(await screen.findByText(t.filters.missingScope)).toBeInTheDocument();
    expect(accountingApi.listTrialBalance).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLSelectElement>(t.filters.fiscalYear).value,
      ).toBe('year-1'),
    );
    await user.click(screen.getByRole('button', { name: t.filters.submit }));
    await waitFor(() =>
      expect(accountingApi.listTrialBalance).toHaveBeenCalledTimes(1),
    );
    expect(listTrialBalanceMock.mock.calls[0]?.[0]).toMatchObject({
      organizationId: 'org-1',
      financialAreaId: 'area-1',
      fiscalYearId: 'year-1',
      page: 1,
      pageSize: 50,
      sort: 'accountCode:asc',
    });
  });
});
