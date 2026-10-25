import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { testAccountingPeriod, testFiscalYear } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { AccountingPeriodRowActions } from './accounting-period-transition-dialog';

const permissions = vi.hoisted(() => ({ codes: [] as string[] }));
vi.mock('@/features/permissions/use-permissions', () => ({
  usePermissions: () => ({
    has: (code: string) => permissions.codes.includes(code),
    loaded: true,
  }),
}));
vi.mock('@/api/accounting.api', () => ({
  transitionAccountingPeriod: vi.fn(),
}));
const api = await import('@/api/accounting.api');
const codes = [
  PERMISSIONS.accounting.accountingPeriodClose,
  PERMISSIONS.accounting.accountingPeriodReopen,
  PERMISSIONS.accounting.accountingPeriodSeal,
];

beforeEach(() => {
  vi.clearAllMocks();
  permissions.codes = [...codes];
});

function show(status: 'open' | 'closed' | 'sealed', year = testFiscalYear) {
  renderWithProviders(
    <AccountingPeriodRowActions
      period={{ ...testAccountingPeriod, status }}
      year={year}
      organizationId="org-1"
    />,
    { withProviders: false },
  );
}

describe('period lifecycle availability and mandatory reason', () => {
  it('open permits only close, and sends the scoped action with a trimmed reason', async () => {
    const user = userEvent.setup();
    vi.mocked(api.transitionAccountingPeriod).mockResolvedValue({
      ...testAccountingPeriod,
      status: 'closed',
    });
    show('open');
    expect(
      screen.getByRole('button', {
        name: t.accountingPeriod.transitions.close,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: t.accountingPeriod.transitions.reopen,
      }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: t.accountingPeriod.transitions.close,
      }),
    );
    const buttons = screen.getAllByRole('button', {
      name: t.accountingPeriod.transitions.close,
    });
    expect(buttons[buttons.length - 1]).toBeDisabled();
    await user.type(
      screen.getByLabelText(t.accountingPeriod.reason),
      '  اصلاح وضعیت  ',
    );
    await user.click(buttons[buttons.length - 1]!);
    await waitFor(() =>
      expect(api.transitionAccountingPeriod).toHaveBeenCalledWith(
        'org-1',
        testAccountingPeriod.id,
        'close',
        { reason: 'اصلاح وضعیت' },
      ),
    );
  });

  it('closed offers reopen and seal, but sealed has no period action', () => {
    const { unmount } = renderWithProviders(
      <AccountingPeriodRowActions
        period={{ ...testAccountingPeriod, status: 'closed' }}
        year={testFiscalYear}
        organizationId="org-1"
      />,
      { withProviders: false },
    );
    expect(
      screen.getByRole('button', {
        name: t.accountingPeriod.transitions.reopen,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t.accountingPeriod.transitions.seal }),
    ).toBeInTheDocument();
    unmount();
    show('sealed');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('hides forbidden operations and every operation for a closed year', () => {
    permissions.codes = [];
    const { unmount } = renderWithProviders(
      <AccountingPeriodRowActions
        period={testAccountingPeriod}
        year={testFiscalYear}
        organizationId="org-1"
      />,
      { withProviders: false },
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    unmount();
    permissions.codes = codes;
    show('open', { ...testFiscalYear, status: 'closed' });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(
      screen.getByText(t.accountingPeriod.yearNotOpen),
    ).toBeInTheDocument();
  });
});
