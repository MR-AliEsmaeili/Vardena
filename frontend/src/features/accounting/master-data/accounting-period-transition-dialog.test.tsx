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

  it.each([
    ['open', 'open', ['close']],
    ['closed', 'open', ['reopen', 'seal']],
    ['sealed', 'open', ['reopen']],
    ['open', 'closed', ['close']],
    ['closed', 'closed', ['reopen', 'seal']],
    ['sealed', 'closed', ['reopen']],
    ['open', 'sealed', []],
    ['closed', 'sealed', ['seal']],
    ['sealed', 'sealed', []],
  ] as const)(
    'backend matrix: %s period in %s year offers %s',
    (status, yearStatus, expected) => {
      show(status, { ...testFiscalYear, status: yearStatus });
      for (const action of ['close', 'reopen', 'seal'] as const) {
        const control = screen.queryByRole('button', {
          name: t.accountingPeriod.transitions[action],
        });
        expect(control !== null).toBe(
          expected.some((value) => value === action),
        );
      }
    },
  );

  it('reopens a sealed period in an unsealed year with an audit reason', async () => {
    const user = userEvent.setup();
    vi.mocked(api.transitionAccountingPeriod).mockResolvedValue({
      ...testAccountingPeriod,
      status: 'open',
    });
    show('sealed', { ...testFiscalYear, status: 'closed' });
    await user.click(
      screen.getByRole('button', {
        name: t.accountingPeriod.transitions.reopen,
      }),
    );
    const confirm = screen
      .getAllByRole('button', { name: t.accountingPeriod.transitions.reopen })
      .at(-1)!;
    expect(confirm).toBeDisabled();
    await user.type(
      screen.getByLabelText(t.accountingPeriod.reason),
      '  رفع مهر سال  ',
    );
    await user.click(confirm);
    await waitFor(() =>
      expect(api.transitionAccountingPeriod).toHaveBeenCalledWith(
        'org-1',
        testAccountingPeriod.id,
        'reopen',
        { reason: 'رفع مهر سال' },
      ),
    );
  });

  it('does not gate period operations on the year active flag or an unavailable year reference', () => {
    const { unmount } = renderWithProviders(
      <AccountingPeriodRowActions
        period={testAccountingPeriod}
        year={{ ...testFiscalYear, isActive: false }}
        organizationId="org-1"
      />,
      { withProviders: false },
    );
    expect(
      screen.getByRole('button', {
        name: t.accountingPeriod.transitions.close,
      }),
    ).toBeInTheDocument();
    unmount();
    renderWithProviders(
      <AccountingPeriodRowActions
        period={{ ...testAccountingPeriod, status: 'sealed' }}
        year={undefined}
        organizationId="org-1"
      />,
      { withProviders: false },
    );
    expect(
      screen.getByRole('button', {
        name: t.accountingPeriod.transitions.reopen,
      }),
    ).toBeInTheDocument();
  });

  it('hides only operations denied by their exact backend permission', () => {
    permissions.codes = [PERMISSIONS.accounting.accountingPeriodSeal];
    show('closed');
    expect(
      screen.getByRole('button', { name: t.accountingPeriod.transitions.seal }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: t.accountingPeriod.transitions.reopen,
      }),
    ).not.toBeInTheDocument();
  });
});
