import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDateTimeSettings, setDateTimeSettings } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { renderWithProviders } from '@/test/test-utils';
import { FiscalYearCreateForm } from './fiscal-year-create-form';

vi.mock('@/api/accounting.api', () => ({ createFiscalYear: vi.fn() }));

const accountingApi = await import('@/api/accounting.api');

beforeEach(() => {
  resetDateTimeSettings();
});

describe('FiscalYearCreateForm', () => {
  it('sends Jalali dates as declared BusinessDate inputs', async () => {
    vi.mocked(accountingApi.createFiscalYear).mockResolvedValue({} as never);
    const user = userEvent.setup();
    setDateTimeSettings({ timeZone: 'Asia/Tehran' });

    renderWithProviders(
      <FiscalYearCreateForm organizationId="org-1" financialAreaId="area-1" />,
      { withProviders: false },
    );

    const startDate = screen.getByLabelText(t.financialContext.startDate);
    const endDate = screen.getByLabelText(t.financialContext.endDate);
    expect(startDate).toHaveAttribute('data-calendar', 'JALALI');
    expect(endDate).toHaveAttribute('data-calendar', 'JALALI');

    await user.type(screen.getByLabelText(t.financialContext.code), 'FY-1405');
    await user.type(
      screen.getByLabelText(t.financialContext.title),
      'Fiscal year 1405',
    );
    await user.type(startDate, '1405/01/01');
    await user.type(endDate, '1405/12/29');
    await user.click(
      screen.getByRole('button', {
        name: t.financialContext.createFiscalYear,
      }),
    );

    await waitFor(() => {
      expect(accountingApi.createFiscalYear).toHaveBeenCalledWith({
        organizationId: 'org-1',
        financialAreaId: 'area-1',
        code: 'FY-1405',
        title: 'Fiscal year 1405',
        startDate: { calendar: 'JALALI', value: '1405-01-01' },
        endDate: { calendar: 'JALALI', value: '1405-12-29' },
      });
    });
  });
});
