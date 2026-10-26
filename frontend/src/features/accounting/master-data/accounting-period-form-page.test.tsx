import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDateTimeSettings, setDateTimeSettings } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import {
  paginated,
  testAccountingPeriod,
  testFiscalYear,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { PeriodCreateForm } from './period-create-form';

const permissionCodes = vi.hoisted(() => ({ codes: [] as string[] }));
vi.mock('@/features/permissions/use-permissions', () => ({
  usePermissions: () => ({
    has: (code: string) => permissionCodes.codes.includes(code),
    loaded: true,
  }),
}));
vi.mock('@/api/accounting.api', () => ({
  listAccountingPeriodsPage: vi.fn(),
  createAccountingPeriod: vi.fn(),
}));
const api = await import('@/api/accounting.api');

beforeEach(() => {
  vi.clearAllMocks();
  permissionCodes.codes = [PERMISSIONS.accounting.accountingPeriodView];
  resetDateTimeSettings();
  setDateTimeSettings({ timeZone: 'Asia/Tehran' });
  vi.mocked(api.listAccountingPeriodsPage).mockResolvedValue(paginated([]));
});

describe('period creation validates year scope and operator input', () => {
  it('lets an Open-only principal enter a year ULID without a FiscalYear.View fetch', async () => {
    const user = userEvent.setup();
    const yearId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    permissionCodes.codes = [PERMISSIONS.accounting.accountingPeriodOpen];
    vi.mocked(api.createAccountingPeriod).mockResolvedValue(
      testAccountingPeriod,
    );
    renderWithProviders(
      <PeriodCreateForm
        organizationId="org-1"
        fiscalYears={[]}
        allowYearIdEntry
      />,
      { withProviders: false },
    );
    expect(
      screen.getByRole('button', { name: t.masterData.openPeriod }),
    ).toBeDisabled();
    await user.type(screen.getByLabelText(t.masterData.fiscalYear), yearId);
    await user.type(screen.getByLabelText(t.masterData.periodTitle), 'فروردین');
    await user.type(
      screen.getByLabelText(t.masterData.startDate),
      '1405/01/01',
    );
    await user.type(screen.getByLabelText(t.masterData.endDate), '1405/01/31');
    await user.click(
      screen.getByRole('button', { name: t.masterData.openPeriod }),
    );
    await waitFor(() =>
      expect(api.createAccountingPeriod).toHaveBeenCalledWith({
        organizationId: 'org-1',
        fiscalYearId: yearId,
        sequence: 1,
        title: 'فروردین',
        startDate: { calendar: 'JALALI', value: '1405-01-01' },
        endDate: { calendar: 'JALALI', value: '1405-01-31' },
      }),
    );
    // The backend alone knows whether this in-scope year is actually open.
    expect(api.listAccountingPeriodsPage).not.toHaveBeenCalled();
  });
  it('disables create when the selected year is closed', async () => {
    renderWithProviders(
      <PeriodCreateForm
        organizationId="org-1"
        fiscalYears={[{ ...testFiscalYear, status: 'closed' }]}
        initialFiscalYearId={testFiscalYear.id}
      />,
      { withProviders: false },
    );
    expect(
      screen.getByText(t.accountingPeriod.yearNotOpen),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t.masterData.openPeriod }),
    ).toBeDisabled();
    expect(api.listAccountingPeriodsPage).not.toHaveBeenCalled();
  });

  it('rejects invalid sequence and dates outside the selected fiscal year before POST', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PeriodCreateForm
        organizationId="org-1"
        fiscalYears={[testFiscalYear]}
        initialFiscalYearId={testFiscalYear.id}
      />,
      { withProviders: false },
    );
    await user.clear(screen.getByLabelText(t.masterData.sequence));
    await user.type(screen.getByLabelText(t.masterData.sequence), '0');
    await user.type(screen.getByLabelText(t.masterData.periodTitle), 'دوره');
    await user.type(
      screen.getByLabelText(t.masterData.startDate),
      '1404/12/01',
    );
    await user.type(screen.getByLabelText(t.masterData.endDate), '1405/01/01');
    await user.click(
      screen.getByRole('button', { name: t.masterData.openPeriod }),
    );
    expect(
      await screen.findByText(t.masterData.sequenceRequired),
    ).toBeInTheDocument();
    expect(api.createAccountingPeriod).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText(t.masterData.sequence));
    await user.type(screen.getByLabelText(t.masterData.sequence), '1');
    await user.click(
      screen.getByRole('button', { name: t.masterData.openPeriod }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(t.accountingPeriod.outsideYear),
      ).toBeInTheDocument(),
    );
    expect(api.createAccountingPeriod).not.toHaveBeenCalled();
  });
});
