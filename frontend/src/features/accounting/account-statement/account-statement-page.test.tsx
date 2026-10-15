import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setDateTimeSettings } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import {
  accountStatement,
  allAccountingPermissions,
  paginated,
  testFinancialArea,
  testFiscalYear,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { AccountStatementPage } from './account-statement-page';

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

vi.mock('@/api/accounting.api', () => ({
  listFinancialAreas: vi.fn(),
  listFiscalYears: vi.fn(),
  listAccountingPeriods: vi.fn(),
  listPostableAccounts: vi.fn(),
  getAccountStatement: vi.fn(),
  listGeneralLedger: vi.fn(),
  listTrialBalance: vi.fn(),
  listChartTree: vi.fn(),
  fetchChartTreePages: vi.fn(),
  MAX_PAGE_SIZE: 500,
  CHART_TREE_MAX_PAGES: 10,
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');

beforeEach(() => {
  setDateTimeSettings({ timeZone: testOrganization.timeZone });
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: allAccountingPermissions,
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
  vi.mocked(accountingApi.listAccountingPeriods).mockResolvedValue(
    paginated([]),
  );
  vi.mocked(accountingApi.listPostableAccounts).mockResolvedValue(
    paginated([
      {
        id: 'acc-2',
        organizationId: 'org-1',
        code: '1010',
        title: 'موجودی نقد',
        parentId: null,
        level: 2,
        isPostable: true,
        isActive: true,
        accountNature: 'DEBIT',
        codingStructureVersionId: null,
        accountingConfigurationId: null,
        createdAt: '2026-01-01T08:00:00.000Z',
        updatedAt: '2026-01-01T08:00:00.000Z',
      },
    ] as never),
  );
});

describe('Account statement page', () => {
  it('requires an account and a fiscal year before calling the API', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccountStatementPage />);

    expect(
      await screen.findByText(t.filters.missingStatementScope),
    ).toBeInTheDocument();

    await user.click(
      await screen.findByRole('button', { name: t.filters.submit }),
    );

    await waitFor(() => {
      expect(
        screen.getAllByText(t.filters.requiredField).length,
      ).toBeGreaterThan(0);
    });
    expect(accountingApi.getAccountStatement).not.toHaveBeenCalled();
  });

  it('shows the server-computed totals and movements for the selected scope', async () => {
    vi.mocked(accountingApi.getAccountStatement).mockResolvedValue(
      accountStatement,
    );
    const user = userEvent.setup();
    renderWithProviders(<AccountStatementPage />);

    // Wait for the reference lists the API provides before choosing a scope.
    await screen.findByRole('option', { name: /1405/ });
    await user.selectOptions(
      screen.getByLabelText(t.filters.fiscalYear),
      'year-1',
    );
    await screen.findByRole('option', { name: /1010/ });
    await user.selectOptions(screen.getByLabelText(t.filters.account), 'acc-2');
    await user.click(screen.getByRole('button', { name: t.filters.submit }));

    await waitFor(() => {
      expect(accountingApi.getAccountStatement).toHaveBeenCalledTimes(1);
    });
    expect(
      vi.mocked(accountingApi.getAccountStatement).mock.calls[0]?.[0],
    ).toMatchObject({
      organizationId: 'org-1',
      accountId: 'acc-2',
      fiscalYearId: 'year-1',
      page: 1,
    });

    // Totals come straight from the response; the UI adds no arithmetic.
    expect(
      await screen.findByText(t.statement.closingBalance),
    ).toBeInTheDocument();
    const table = await screen.findByRole('table');
    // debit, net and running balance all carry the same exact value.
    expect(within(table).getAllByText('1,500,000.00')).toHaveLength(3);
    expect(
      within(table).getByText('۱۴۰۵/۰۱/۱۲ ۱۰:۱۵:۰۰ UTC (UTC+00:00)'),
    ).toHaveAttribute(
      'title',
      accountStatement.movements.items[0]!.postingTimestamp,
    );
    expect(screen.getByText('debit-positive')).toBeInTheDocument();
    expect(screen.getByText('intra-fiscal-year')).toBeInTheDocument();
  });
});
