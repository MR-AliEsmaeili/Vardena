import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { AccountCreatePage } from './account-create-page';
import { AccountEditPage } from './account-edit-page';

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
  MAX_PAGE_SIZE: 500,
  getAccount: vi.fn(),
  listAccounts: vi.fn(),
  getActiveAccountingConfiguration: vi.fn(),
  getActiveDetailStructure: vi.fn(),
  listDetailGroups: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
}));
const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');

const account = {
  id: 'acc-1',
  organizationId: testOrganization.id,
  code: '1010',
  localCode: '10',
  title: 'بانک',
  parentId: null,
  level: 1,
  codingStructureVersionId: null,
  accountingConfigurationId: null,
  accountNature: 'DEBIT',
  accountType: 'BALANCE_SHEET',
  detailGroupId: null,
  isPostable: false,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as Account;

function grant(...codes: string[]) {
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: [PERMISSIONS.organization.view, ...codes],
  });
}

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(accountingApi.getAccount).mockResolvedValue(account);
  vi.mocked(accountingApi.listAccounts).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 500,
  });
});

describe('Account create/edit (backend-owned code)', () => {
  it('Create-only can submit a root using a full code without unauthorized reference GETs', async () => {
    grant(PERMISSIONS.accounting.accountCreate);
    const user = userEvent.setup();
    vi.mocked(accountingApi.createAccount).mockResolvedValue(account);
    renderWithProviders(<AccountCreatePage />);
    await screen.findByText(t.accountAdmin.rootOnlyHint);
    await user.type(screen.getByLabelText(t.masterData.fullCode), '0010');
    await user.type(screen.getByLabelText(t.masterData.accountTitle), 'بانک');
    await user.click(
      screen.getByRole('button', { name: t.masterData.createAccount }),
    );
    await waitFor(() =>
      expect(accountingApi.createAccount).toHaveBeenCalledWith({
        organizationId: testOrganization.id,
        code: '0010',
        title: 'بانک',
        accountNature: 'DUAL',
      }),
    );
    expect(accountingApi.listAccounts).not.toHaveBeenCalled();
    expect(
      accountingApi.getActiveAccountingConfiguration,
    ).not.toHaveBeenCalled();
  });

  it('edit has no code input and PATCH omits both immutable code variants', async () => {
    grant(
      PERMISSIONS.accounting.accountView,
      PERMISSIONS.accounting.accountEdit,
    );
    const user = userEvent.setup();
    vi.mocked(accountingApi.updateAccount).mockResolvedValue(account);
    renderWithProviders(
      <Routes>
        <Route path="/app/accounting/accounts/:accountId" element={<div />} />
        <Route
          path="/app/accounting/accounts/:accountId/edit"
          element={<AccountEditPage />}
        />
      </Routes>,
      { initialEntries: ['/app/accounting/accounts/acc-1/edit'] },
    );
    expect(
      await screen.findByText(t.accountAdmin.codeImmutable),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(t.masterData.fullCode),
    ).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText(t.masterData.accountTitle));
    await user.type(
      screen.getByLabelText(t.masterData.accountTitle),
      'حساب جدید',
    );
    await user.click(screen.getByRole('button', { name: t.accountAdmin.save }));
    await waitFor(() =>
      expect(accountingApi.updateAccount).toHaveBeenCalledWith(
        testOrganization.id,
        account.id,
        {
          title: 'حساب جدید',
          accountNature: 'DEBIT',
          accountType: 'BALANCE_SHEET',
          isPostable: false,
          parentId: null,
        },
      ),
    );
  });

  it('edits a detail group only from the active detail structure', async () => {
    grant(
      PERMISSIONS.accounting.accountView,
      PERMISSIONS.accounting.accountEdit,
      PERMISSIONS.accounting.detailView,
      PERMISSIONS.accounting.detailStructureView,
    );
    const user = userEvent.setup();
    vi.mocked(accountingApi.getActiveDetailStructure).mockResolvedValue({
      id: 'detail-structure-active',
    } as never);
    vi.mocked(accountingApi.listDetailGroups).mockResolvedValue({
      items: [
        {
          id: 'group-active',
          code: '01',
          title: 'گروه بانک',
          level: 1,
          detailStructureVersionId: 'detail-structure-active',
          parentId: null,
          isPostable: false,
          isActive: true,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    } as never);
    vi.mocked(accountingApi.updateAccount).mockResolvedValue(account);
    renderWithProviders(
      <Routes>
        <Route path="/app/accounting/accounts/:accountId" element={<div />} />
        <Route
          path="/app/accounting/accounts/:accountId/edit"
          element={<AccountEditPage />}
        />
      </Routes>,
      { initialEntries: ['/app/accounting/accounts/acc-1/edit'] },
    );
    await screen.findByRole('option', { name: /گروه بانک/ });
    await user.selectOptions(
      screen.getByLabelText(t.masterData.detailGroup),
      'group-active',
    );
    await user.click(screen.getByRole('button', { name: t.accountAdmin.save }));
    await waitFor(() =>
      expect(accountingApi.updateAccount).toHaveBeenCalledWith(
        testOrganization.id,
        account.id,
        expect.objectContaining({ detailGroupId: 'group-active' }),
      ),
    );
    expect(accountingApi.updateAccount).toHaveBeenCalledWith(
      testOrganization.id,
      account.id,
      expect.not.objectContaining({ code: expect.anything() }),
    );
    expect(accountingApi.listDetailGroups).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: testOrganization.id,
        detailStructureVersionId: 'detail-structure-active',
      }),
      expect.any(AbortSignal),
    );
  });
});
