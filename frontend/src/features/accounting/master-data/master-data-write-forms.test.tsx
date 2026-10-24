import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDateTimeSettings, setDateTimeSettings } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { testFiscalYear } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { AccountCreateForm } from './account-create-form';
import { ChartSetupForm } from './chart-setup-form';
import { PeriodCreateForm } from './period-create-form';

vi.mock('@/api/accounting.api', () => ({
  createAccountingPeriod: vi.fn(),
  createAccount: vi.fn(),
  createCodingStructureVersion: vi.fn(),
  publishCodingStructureVersion: vi.fn(),
  createAccountingConfiguration: vi.fn(),
  publishAccountingConfiguration: vi.fn(),
  getActiveCodingStructure: vi.fn(),
  getActiveAccountingConfiguration: vi.fn(),
}));

const api = await import('@/api/accounting.api');

beforeEach(() => {
  vi.clearAllMocks();
  resetDateTimeSettings();
  setDateTimeSettings({ timeZone: 'Asia/Tehran' });
});

describe('PeriodCreateForm', () => {
  it('opens a period with Jalali dates sent as declared BusinessDate inputs', async () => {
    vi.mocked(api.createAccountingPeriod).mockResolvedValue({} as never);
    const user = userEvent.setup();
    renderWithProviders(
      <PeriodCreateForm
        organizationId="org-1"
        fiscalYears={[testFiscalYear]}
      />,
      { withProviders: false },
    );
    await user.selectOptions(
      screen.getByLabelText(t.masterData.fiscalYear),
      testFiscalYear.id,
    );
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
        fiscalYearId: testFiscalYear.id,
        sequence: 1,
        title: 'فروردین',
        startDate: { calendar: 'JALALI', value: '1405-01-01' },
        endDate: { calendar: 'JALALI', value: '1405-01-31' },
      }),
    );
  });
});

describe('ChartSetupForm', () => {
  it('creates and publishes coding structure and configuration from the same user levels', async () => {
    vi.mocked(api.getActiveCodingStructure).mockResolvedValue(null);
    vi.mocked(api.getActiveAccountingConfiguration).mockResolvedValue(null);
    vi.mocked(api.createCodingStructureVersion).mockResolvedValue({
      id: 'cs-1',
    } as never);
    vi.mocked(api.publishCodingStructureVersion).mockResolvedValue({
      id: 'cs-1',
    } as never);
    vi.mocked(api.createAccountingConfiguration).mockResolvedValue({
      id: 'cfg-1',
    } as never);
    vi.mocked(api.publishAccountingConfiguration).mockResolvedValue({
      id: 'cfg-1',
    } as never);
    const user = userEvent.setup();
    renderWithProviders(<ChartSetupForm organizationId="org-1" />, {
      withProviders: false,
    });

    await user.type(
      await screen.findByLabelText(t.masterData.structureName),
      'پیکربندی اصلی',
    );
    const titles = screen.getAllByLabelText(
      new RegExp(t.masterData.levelTitle),
    );
    await user.type(titles[0]!, 'گروه');
    await user.type(titles[1]!, 'معین');
    await user.click(
      screen.getByRole('button', { name: t.masterData.activateChart }),
    );

    const expectedLevels = [
      {
        levelIndex: 1,
        title: 'گروه',
        digitLength: 2,
        defaultIsPostable: false,
      },
      { levelIndex: 2, title: 'معین', digitLength: 3, defaultIsPostable: true },
    ];
    await waitFor(() => {
      expect(api.createCodingStructureVersion).toHaveBeenCalledWith({
        organizationId: 'org-1',
        code: 'DEFAULT',
        maxDepth: 2,
        separator: '',
        levels: expectedLevels,
      });
      expect(api.publishCodingStructureVersion).toHaveBeenCalledWith(
        'org-1',
        'cs-1',
      );
      expect(api.createAccountingConfiguration).toHaveBeenCalledWith({
        organizationId: 'org-1',
        code: 'DEFAULT',
        name: 'پیکربندی اصلی',
        levels: expectedLevels,
      });
      expect(api.publishAccountingConfiguration).toHaveBeenCalledWith(
        'org-1',
        'cfg-1',
      );
    });
  });

  it('shows the ready state and creates nothing when both are already active', async () => {
    vi.mocked(api.getActiveCodingStructure).mockResolvedValue({
      id: 'cs-1',
    } as never);
    vi.mocked(api.getActiveAccountingConfiguration).mockResolvedValue({
      id: 'cfg-1',
    } as never);
    renderWithProviders(<ChartSetupForm organizationId="org-1" />, {
      withProviders: false,
    });
    expect(
      await screen.findByText(t.masterData.chartReady),
    ).toBeInTheDocument();
    expect(api.createCodingStructureVersion).not.toHaveBeenCalled();
    expect(api.createAccountingConfiguration).not.toHaveBeenCalled();
  });
});

describe('AccountCreateForm', () => {
  it('creates a root postable account with the exact backend payload', async () => {
    vi.mocked(api.createAccount).mockResolvedValue({} as never);
    const user = userEvent.setup();
    renderWithProviders(
      <AccountCreateForm organizationId="org-1" accounts={[]} />,
      { withProviders: false },
    );
    await user.type(screen.getByLabelText(t.masterData.accountCode), '10');
    await user.type(screen.getByLabelText(t.masterData.accountTitle), 'نقد');
    await user.click(screen.getByLabelText(t.masterData.postableAccount));
    await user.click(
      screen.getByRole('button', { name: t.masterData.createAccount }),
    );
    await waitFor(() =>
      expect(api.createAccount).toHaveBeenCalledWith({
        organizationId: 'org-1',
        code: '10',
        title: 'نقد',
        parentId: null,
        accountNature: 'DUAL',
        accountType: 'BALANCE_SHEET',
        isPostable: true,
      }),
    );
  });
});
