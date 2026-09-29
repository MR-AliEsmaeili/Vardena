import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { paginated, testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { AccountDetailPage } from './account-detail-page';

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));
vi.mock('@/api/organization.api', () => ({
  listOrganizations: vi.fn(),
  MAX_PAGE_SIZE: 500,
}));
vi.mock('@/api/accounting.api', () => ({ getAccount: vi.fn() }));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');

const postableAccount = {
  id: 'acc-1',
  organizationId: 'org-1',
  code: '1010',
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
  vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
    paginated([testOrganization]),
  );
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
