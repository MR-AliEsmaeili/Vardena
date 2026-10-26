import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import {
  allAccountingPermissions,
  paginated,
  testAccountingPeriod,
  testFiscalYear,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { AccountingPeriodsPage } from './accounting-periods-page';
import { AccountingPeriodFormPage } from './accounting-period-form-page';

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
  listAccountingPeriodsPage: vi.fn(),
  createAccountingPeriod: vi.fn(),
  transitionAccountingPeriod: vi.fn(),
}));
const identity = await import('@/api/identity.api');
const organization = await import('@/api/organization.api');
const accounting = await import('@/api/accounting.api');
const lifecycle = [
  PERMISSIONS.accounting.accountingPeriodClose,
  PERMISSIONS.accounting.accountingPeriodReopen,
  PERMISSIONS.accounting.accountingPeriodSeal,
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(identity.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: [...allAccountingPermissions, ...lifecycle],
  });
  vi.mocked(organization.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(accounting.listFinancialAreas).mockResolvedValue(paginated([]));
  vi.mocked(accounting.listFiscalYears).mockResolvedValue(
    paginated([testFiscalYear]),
  );
  vi.mocked(accounting.listAccountingPeriodsPage).mockResolvedValue(
    paginated([
      testAccountingPeriod,
      {
        ...testAccountingPeriod,
        id: 'period-2',
        title: 'اردیبهشت',
        status: 'closed',
      },
      {
        ...testAccountingPeriod,
        id: 'period-3',
        title: 'خرداد',
        status: 'sealed',
      },
    ]),
  );
});

describe('accounting periods list (ACC-03)', () => {
  it('shows the manual year-id form to Open-only users, without requesting FiscalYear.View', async () => {
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [PERMISSIONS.accounting.accountingPeriodOpen],
    });
    renderWithProviders(<AccountingPeriodFormPage />);
    expect(
      await screen.findByText(t.accountingPeriod.yearViewRequired),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(t.masterData.fiscalYear)).toHaveAttribute(
      'dir',
      'ltr',
    );
    expect(accounting.listFiscalYears).not.toHaveBeenCalled();
  });
  it('shows only the allowed actions of each status plus the new route', async () => {
    renderWithProviders(<AccountingPeriodsPage />);
    const first = await screen.findByText(testAccountingPeriod.title);
    const row = first.closest('tr');
    expect(row).not.toBeNull();
    await waitFor(() =>
      expect(
        within(row!).getByRole('button', {
          name: t.accountingPeriod.transitions.close,
        }),
      ).toBeInTheDocument(),
    );
    expect(
      within(row!).queryByRole('button', {
        name: t.accountingPeriod.transitions.reopen,
      }),
    ).not.toBeInTheDocument();
    const closed = screen.getByText('اردیبهشت').closest('tr');
    expect(
      within(closed!).getByRole('button', {
        name: t.accountingPeriod.transitions.reopen,
      }),
    ).toBeInTheDocument();
    expect(
      within(closed!).getByRole('button', {
        name: t.accountingPeriod.transitions.seal,
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByText('خرداد').closest('tr')!).getByRole('button', {
        name: t.accountingPeriod.transitions.reopen,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: t.accountingPeriod.new }),
    ).toHaveAttribute('href', '/app/accounting/periods/new');
  });

  it('handles empty and error states with retry', async () => {
    vi.mocked(accounting.listAccountingPeriodsPage).mockResolvedValueOnce(
      paginated([]),
    );
    const { unmount } = renderWithProviders(<AccountingPeriodsPage />);
    expect(await screen.findByText(t.masterData.noPeriods)).toBeInTheDocument();
    unmount();
    vi.mocked(accounting.listAccountingPeriodsPage).mockRejectedValue(
      new Error('server broke'),
    );
    renderWithProviders(<AccountingPeriodsPage />);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: t.app.retry }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText('server broke')).not.toBeInTheDocument();
  });

  it('does not offer operations without their exact permission', async () => {
    vi.mocked(identity.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: allAccountingPermissions.filter(
        (code) => code !== PERMISSIONS.accounting.accountingPeriodOpen,
      ),
    });
    renderWithProviders(<AccountingPeriodsPage />);
    await screen.findByText(testAccountingPeriod.title);
    expect(
      screen.queryByRole('link', { name: t.accountingPeriod.new }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: t.accountingPeriod.transitions.close,
      }),
    ).not.toBeInTheDocument();
  });
});
