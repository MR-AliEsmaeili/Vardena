import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import {
  allAccountingPermissions,
  generalLedgerRow,
  paginated,
  testFinancialArea,
  testFiscalYear,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { GeneralLedgerPage } from './general-ledger-page';

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
  listGeneralLedger: vi.fn(),
  listTrialBalance: vi.fn(),
  getAccountStatement: vi.fn(),
  listChartTree: vi.fn(),
  fetchChartTreePages: vi.fn(),
  MAX_PAGE_SIZE: 500,
  CHART_TREE_MAX_PAGES: 10,
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');

beforeEach(() => {
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
    paginated([]),
  );
});

async function applyFilters(user: ReturnType<typeof userEvent.setup>) {
  // The single available financial area and fiscal year are preselected.
  await waitFor(() => {
    expect(
      screen.getByLabelText<HTMLSelectElement>(t.filters.fiscalYear).value,
    ).toBe('year-1');
  });
  await user.click(screen.getByRole('button', { name: t.filters.submit }));
}

describe('General Ledger page', () => {
  it('asks for the report only after the filters are applied', async () => {
    vi.mocked(accountingApi.listGeneralLedger).mockResolvedValue(
      paginated([generalLedgerRow]),
    );
    const user = userEvent.setup();
    renderWithProviders(<GeneralLedgerPage />);

    expect(await screen.findByText(t.filters.missingScope)).toBeInTheDocument();
    expect(accountingApi.listGeneralLedger).not.toHaveBeenCalled();

    await applyFilters(user);

    await waitFor(() => {
      expect(accountingApi.listGeneralLedger).toHaveBeenCalledTimes(1);
    });
    const [query] =
      vi.mocked(accountingApi.listGeneralLedger).mock.calls[0] ?? [];
    expect(query).toMatchObject({
      organizationId: 'org-1',
      financialAreaId: 'area-1',
      fiscalYearId: 'year-1',
      page: 1,
      pageSize: 50,
      sort: 'documentDate:asc',
    });
  });

  it('renders the exact decimal amounts returned by the API', async () => {
    vi.mocked(accountingApi.listGeneralLedger).mockResolvedValue(
      paginated([generalLedgerRow]),
    );
    const user = userEvent.setup();
    renderWithProviders(<GeneralLedgerPage />);
    await applyFilters(user);

    const table = await screen.findByRole('table');
    // The row carries the same exact value in `debit` and `net`.
    expect(within(table).getAllByText('1,500,000.00')).toHaveLength(2);
    expect(within(table).getByText('1010')).toBeInTheDocument();
    expect(within(table).getByText('2026-04-01')).toBeInTheDocument();
  });

  it('shows the empty state when the server returns no rows', async () => {
    vi.mocked(accountingApi.listGeneralLedger).mockResolvedValue(paginated([]));
    const user = userEvent.setup();
    renderWithProviders(<GeneralLedgerPage />);
    await applyFilters(user);

    expect(await screen.findByText(t.table.emptyTitle)).toBeInTheDocument();
  });

  it('surfaces a server rejection with its correlation id', async () => {
    vi.mocked(accountingApi.listGeneralLedger).mockRejectedValue(
      new ApiError({
        code: 'BusinessRuleViolation',
        message: 'Fiscal year does not belong to the financial area.',
        status: 422,
        correlationId: 'corr-gl',
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<GeneralLedgerPage />);
    await applyFilters(user);

    expect(await screen.findByText(t.table.errorTitle)).toBeInTheDocument();
    expect(screen.getByText(/corr-gl/)).toBeInTheDocument();
  });

  it('requests a new server page instead of slicing the cached one', async () => {
    vi.mocked(accountingApi.listGeneralLedger).mockResolvedValue({
      items: [generalLedgerRow],
      total: 120,
      page: 1,
      pageSize: 50,
    });
    const user = userEvent.setup();
    renderWithProviders(<GeneralLedgerPage />);
    await applyFilters(user);

    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: t.table.next }));

    await waitFor(() => {
      expect(accountingApi.listGeneralLedger).toHaveBeenCalledTimes(2);
    });
    const secondCall = vi.mocked(accountingApi.listGeneralLedger).mock.calls[1];
    expect(secondCall?.[0]).toMatchObject({ page: 2 });
  });

  it('delegates sorting to the backend using its allow-listed field names', async () => {
    vi.mocked(accountingApi.listGeneralLedger).mockResolvedValue(
      paginated([generalLedgerRow]),
    );
    const user = userEvent.setup();
    renderWithProviders(<GeneralLedgerPage />);
    await applyFilters(user);

    await screen.findByRole('table');
    await user.click(
      screen.getByRole('button', {
        name: new RegExp(t.generalLedger.accountName),
      }),
    );

    await waitFor(() => {
      expect(accountingApi.listGeneralLedger).toHaveBeenCalledTimes(2);
    });
    const secondCall = vi.mocked(accountingApi.listGeneralLedger).mock.calls[1];
    expect(secondCall?.[0]).toMatchObject({ sort: 'accountName:asc' });
  });
});
