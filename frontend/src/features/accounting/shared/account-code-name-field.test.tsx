import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { paginated } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { AccountCodeNameField } from './account-code-name-field';

/**
 * The linked «کد حساب / نام حساب» cell (FE-UX-08 §8.4).
 *
 * A user-defined account that cannot be found or chosen in a document line is
 * the reported defect; these tests pin both halves of the fix: the picker
 * searches the WHOLE active chart (not only postable leaves), and the code
 * and the title are linked in both directions.
 */

vi.mock('@/features/permissions/use-permissions', () => ({
  usePermissions: () => ({
    codes: [],
    loaded: true,
    has: () => true,
    hasAll: () => true,
    hasAny: () => true,
  }),
}));

vi.mock('@/api/accounting.api', () => ({
  getAccount: vi.fn(),
  listActiveAccounts: vi.fn(),
  listPostableAccounts: vi.fn(),
}));

const accountingApi = await import('@/api/accounting.api');

const cash: Account = {
  id: 'acc-cash',
  organizationId: 'org-1',
  code: '1010',
  title: 'موجودی نقد',
  parentId: null,
  level: 2,
  codingStructureVersionId: null,
  accountingConfigurationId: null,
  accountNature: 'DEBIT',
  accountType: 'BALANCE_SHEET',
  detailGroupId: null,
  isPostable: true,
  isActive: true,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
} as Account;

const payable: Account = {
  ...cash,
  id: 'acc-payable',
  code: '2010',
  title: 'حساب‌های پرداختنی',
  accountNature: 'CREDIT',
};

const aggregate: Account = {
  ...cash,
  id: 'acc-aggregate',
  code: '9999',
  title: 'حساب تجمیعی سازمان',
  isPostable: false,
};

const accounts = [cash, payable, aggregate];

function Harness() {
  const [value, setValue] = useState('');
  return (
    <div>
      <AccountCodeNameField
        id="line-account"
        organizationId="org-1"
        value={value}
        onChange={setValue}
      />
      <output data-testid="selected-account">{value}</output>
    </div>
  );
}

beforeEach(() => {
  vi.mocked(accountingApi.listActiveAccounts).mockResolvedValue(
    paginated(accounts),
  );
  vi.mocked(accountingApi.getAccount).mockImplementation((_org, accountId) => {
    const found = accounts.find((account) => account.id === accountId);
    return Promise.resolve(found ?? cash);
  });
});

const codeInput = () => screen.getByLabelText(t.documents.accountCode);
const titleInput = () => screen.getByLabelText(t.documents.accountName);

describe('AccountCodeNameField — linked code and name', () => {
  it('fills the real title when the code is typed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />, { withProviders: false });

    await user.type(codeInput(), '1010');

    await waitFor(() => expect(titleInput()).toHaveValue('موجودی نقد'));
    expect(screen.getByTestId('selected-account')).toHaveTextContent(
      'acc-cash',
    );
  });

  it('fills the real code when the title is typed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />, { withProviders: false });

    await user.type(titleInput(), 'حساب‌های پرداختنی');

    await waitFor(() => expect(codeInput()).toHaveValue('2010'));
    expect(screen.getByTestId('selected-account')).toHaveTextContent(
      'acc-payable',
    );
  });

  it('finds an account defined by the operator through the suggestion list', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />, { withProviders: false });

    await user.type(codeInput(), '20');

    const list = await screen.findByTestId('account-suggestions');
    expect(within(list).getByText('حساب‌های پرداختنی')).toBeInTheDocument();

    await user.click(within(list).getByText('حساب‌های پرداختنی'));

    await waitFor(() => expect(titleInput()).toHaveValue('حساب‌های پرداختنی'));
    expect(codeInput()).toHaveValue('2010');
  });

  it('shows an aggregate account but never selects it for a posting line', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />, { withProviders: false });

    await user.type(codeInput(), '9999');

    const list = await screen.findByTestId('account-suggestions');
    const option = within(list)
      .getAllByRole('option')
      .find((entry) => entry.getAttribute('data-postable') === 'false');
    expect(option).toBeDefined();
    expect(
      within(option as HTMLElement).getByText(
        t.documents.accountAggregateOption,
      ),
    ).toBeInTheDocument();

    await user.click(option as HTMLElement);

    // The list shows it (so "my account is missing" can never happen again),
    // but the selection stays empty and the title is not fabricated.
    expect(screen.getByTestId('selected-account')).toBeEmptyDOMElement();
    expect(titleInput()).toHaveValue('');
  });
});
