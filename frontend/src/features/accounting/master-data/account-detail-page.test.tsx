import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { AccountDetailPage } from './account-detail-page';

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
  getAccount: vi.fn(),
  getDetailRecord: vi.fn(),
  unlinkAccountDetailGroup: vi.fn(),
  enableAccount: vi.fn(),
  disableAccount: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');

const postableAccount = {
  id: 'acc-1',
  organizationId: 'org-1',
  code: '1010',
  localCode: '1010',
  title: 'بانک',
  parentId: null,
  level: 2,
  codingStructureVersionId: null,
  accountingConfigurationId: null,
  accountNature: 'DEBIT',
  accountType: 'BALANCE_SHEET',
  detailGroupId: null,
  isPostable: true,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as Account;

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route
        path="/app/accounting/accounts/:accountId"
        element={<AccountDetailPage />}
      />
    </Routes>,
    { initialEntries: ['/app/accounting/accounts/acc-1'] },
  );
}

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(accountingApi.getAccount).mockResolvedValue(postableAccount);
});

describe('Account Detail statement action', () => {
  it('shows the action for a postable account with statement permission', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        'Organization.Organization.View',
        PERMISSIONS.accounting.accountView,
        PERMISSIONS.accounting.accountStatementView,
      ],
    });
    renderDetail();
    expect(
      await screen.findByRole('link', { name: t.masterData.viewStatement }),
    ).toBeInTheDocument();
  });

  it('hides the action without statement permission', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        'Organization.Organization.View',
        PERMISSIONS.accounting.accountView,
      ],
    });
    renderDetail();
    expect(
      await screen.findByRole('heading', { name: t.masterData.accountDetail }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: t.masterData.viewStatement }),
    ).not.toBeInTheDocument();
  });

  it('hides the action for a non-postable account', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        'Organization.Organization.View',
        PERMISSIONS.accounting.accountView,
        PERMISSIONS.accounting.accountStatementView,
      ],
    });
    vi.mocked(accountingApi.getAccount).mockResolvedValue({
      ...postableAccount,
      isPostable: false,
    });
    renderDetail();
    expect(
      await screen.findByRole('heading', { name: t.masterData.accountDetail }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: t.masterData.viewStatement }),
    ).not.toBeInTheDocument();
  });
});

describe('Account Detail full/local code + parent resolution', () => {
  it('shows full code, local segment, and the parent by code/title (never a raw ULID)', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        'Organization.Organization.View',
        PERMISSIONS.accounting.accountView,
      ],
    });
    const child = {
      ...postableAccount,
      id: 'acc-1',
      code: '101003',
      localCode: '003',
      title: 'تاسیسات',
      parentId: 'acc-parent',
      level: 3,
    } as Account;
    const parent = {
      ...postableAccount,
      id: 'acc-parent',
      code: '101',
      localCode: '01',
      title: 'دارایی ثابت',
      parentId: null,
      level: 2,
      isPostable: false,
    } as Account;
    vi.mocked(accountingApi.getAccount).mockImplementation(
      async (_organizationId: string, id: string) =>
        (id === 'acc-parent' ? parent : child) as never,
    );
    renderDetail();

    expect(await screen.findByText('101003')).toBeInTheDocument();
    expect(screen.getByText('003')).toBeInTheDocument();
    const parentLink = await screen.findByRole('link', { name: /101/ });
    expect(parentLink).toHaveTextContent('دارایی ثابت');
    expect(screen.queryByText('acc-parent')).not.toBeInTheDocument();
  });
});

describe('Account administration and destructive unlink', () => {
  function grant(...codes: string[]) {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        'Organization.Organization.View',
        PERMISSIONS.accounting.accountView,
        ...codes,
      ],
    });
  }

  it('does not offer unlink on an unlinked account even with permission', async () => {
    grant(PERMISSIONS.accounting.accountUnlinkDetailGroup);
    renderDetail();
    await screen.findByRole('heading', { name: t.masterData.accountDetail });
    expect(
      screen.queryByRole('button', { name: t.accountAdmin.unlink }),
    ).not.toBeInTheDocument();
  });

  it('does not offer unlink on a linked account without permission', async () => {
    grant();
    vi.mocked(accountingApi.getAccount).mockResolvedValue({
      ...postableAccount,
      detailGroupId: 'group-1',
    });
    renderDetail();
    await screen.findByRole('heading', { name: t.masterData.accountDetail });
    expect(
      screen.queryByRole('button', { name: t.accountAdmin.unlink }),
    ).not.toBeInTheDocument();
    expect(accountingApi.getDetailRecord).not.toHaveBeenCalled();
  });

  it('requires the acknowledgement and sends exactly confirmUnlink true', async () => {
    const user = userEvent.setup();
    grant(
      PERMISSIONS.accounting.accountUnlinkDetailGroup,
      PERMISSIONS.accounting.detailView,
    );
    vi.mocked(accountingApi.getAccount).mockResolvedValue({
      ...postableAccount,
      detailGroupId: 'group-1',
    });
    vi.mocked(accountingApi.getDetailRecord).mockResolvedValue({
      id: 'group-1',
      title: 'گروه بانک',
    } as never);
    vi.mocked(accountingApi.unlinkAccountDetailGroup).mockResolvedValue({
      ...postableAccount,
      detailGroupId: null,
    });
    renderDetail();
    await screen.findByRole('button', { name: t.accountAdmin.unlink });
    await screen.findByText('گروه بانک');
    await user.click(
      screen.getByRole('button', { name: t.accountAdmin.unlink }),
    );
    expect(screen.getByText(t.accountAdmin.unlinkWarning)).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // There are two identically labelled controls; the dialog submit is the last one.
    const submits = screen.getAllByRole('button', {
      name: t.accountAdmin.unlink,
    });
    expect(submits.at(-1)).toBeDisabled();
    expect(accountingApi.unlinkAccountDetailGroup).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('checkbox', { name: t.accountAdmin.unlinkAcknowledge }),
    );
    await user.click(submits.at(-1)!);
    await waitFor(() =>
      expect(accountingApi.unlinkAccountDetailGroup).toHaveBeenCalledWith(
        'org-1',
        'acc-1',
        { confirmUnlink: true },
      ),
    );
  });

  it('refreshes the detail to the unlinked server state after success', async () => {
    const user = userEvent.setup();
    grant(PERMISSIONS.accounting.accountUnlinkDetailGroup);
    vi.mocked(accountingApi.getAccount)
      .mockResolvedValueOnce({ ...postableAccount, detailGroupId: 'group-1' })
      .mockResolvedValue({ ...postableAccount, detailGroupId: null });
    vi.mocked(accountingApi.unlinkAccountDetailGroup).mockResolvedValue({
      ...postableAccount,
      detailGroupId: null,
    });
    renderDetail();
    await user.click(
      await screen.findByRole('button', { name: t.accountAdmin.unlink }),
    );
    await user.click(
      screen.getByRole('checkbox', { name: t.accountAdmin.unlinkAcknowledge }),
    );
    await user.click(
      screen.getAllByRole('button', { name: t.accountAdmin.unlink }).at(-1)!,
    );
    await screen.findByText(t.accountAdmin.unlinkSuccess);
    await waitFor(() =>
      expect(screen.getByText(t.accountAdmin.groupNone)).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', { name: t.accountAdmin.unlink }),
    ).not.toBeInTheDocument();
  });

  it('keeps the destructive dialog open after a backend refusal', async () => {
    const user = userEvent.setup();
    grant(PERMISSIONS.accounting.accountUnlinkDetailGroup);
    vi.mocked(accountingApi.getAccount).mockResolvedValue({
      ...postableAccount,
      detailGroupId: 'group-1',
    });
    vi.mocked(accountingApi.unlinkAccountDetailGroup).mockRejectedValue(
      new Error('backend refused'),
    );
    renderDetail();
    await user.click(
      await screen.findByRole('button', { name: t.accountAdmin.unlink }),
    );
    await user.click(
      screen.getByRole('checkbox', { name: t.accountAdmin.unlinkAcknowledge }),
    );
    await user.click(
      screen.getAllByRole('button', { name: t.accountAdmin.unlink }).at(-1)!,
    );
    expect(
      await screen.findByText(t.accountAdmin.unlinkFailed),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('offers edit only with Edit and confirms disable before sending', async () => {
    const user = userEvent.setup();
    grant(
      PERMISSIONS.accounting.accountEdit,
      PERMISSIONS.accounting.accountDisable,
    );
    vi.mocked(accountingApi.disableAccount).mockResolvedValue({
      ...postableAccount,
      isActive: false,
    });
    renderDetail();
    expect(
      await screen.findByRole('link', { name: t.accountAdmin.edit }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: t.accountAdmin.disable }),
    );
    expect(accountingApi.disableAccount).not.toHaveBeenCalled();
    await user.click(
      screen.getAllByRole('button', { name: t.accountAdmin.disable }).at(-1)!,
    );
    await waitFor(() =>
      expect(accountingApi.disableAccount).toHaveBeenCalledWith(
        'org-1',
        'acc-1',
      ),
    );
  });
});
