import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountingDetail } from '@/api/contracts';
import { Route, Routes } from 'react-router-dom';
import { t } from '@/lib/i18n';
import { testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { DetailFormPage, DetailsListPage } from './details-admin-page';

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
  createDetail: vi.fn(),
  disableDetail: vi.fn(),
  enableDetail: vi.fn(),
  getActiveDetailStructure: vi.fn(),
  getDetailRecord: vi.fn(),
  listDetails: vi.fn(),
  updateDetail: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');

const detail: AccountingDetail = {
  id: 'detail-1',
  organizationId: testOrganization.id,
  code: '0102',
  title: 'Primary bank',
  parentId: null,
  level: 1,
  detailStructureVersionId: 'structure-1',
  isPostable: true,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: [
      'Organization.Organization.View',
      'Accounting.Detail.View',
      'Accounting.Detail.Create',
      'Accounting.Detail.Edit',
      'Accounting.Detail.Enable',
      'Accounting.Detail.Disable',
      'Accounting.DetailStructure.View',
    ],
  });
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(accountingApi.listDetails).mockResolvedValue({
    items: [detail],
    total: 1,
    page: 1,
    pageSize: 20,
  });
  vi.mocked(accountingApi.getDetailRecord).mockResolvedValue(detail);
  vi.mocked(accountingApi.getActiveDetailStructure).mockResolvedValue(null);
  vi.mocked(accountingApi.updateDetail).mockResolvedValue({
    ...detail,
    title: 'Updated bank',
  });
});

describe('Detail administration', () => {
  it('renders server-backed detail rows and does not invent a delete action', async () => {
    renderWithProviders(<DetailsListPage />, {
      initialEntries: ['/app/accounting/details'],
    });

    expect(
      await screen.findByRole('link', { name: detail.code }),
    ).toBeInTheDocument();
    expect(screen.getByText(detail.title)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t.details.disable }),
    ).toBeInTheDocument();
    expect(accountingApi.listDetails).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: testOrganization.id, page: 1 }),
      expect.any(AbortSignal),
    );
  });

  it('edits an existing detail without exposing or submitting its immutable code', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route
          path="/app/accounting/details/:detailId/edit"
          element={<DetailFormPage mode="edit" />}
        />
        <Route
          path="/app/accounting/details/:detailId"
          element={<div>{t.details.updated}</div>}
        />
      </Routes>,
      { initialEntries: ['/app/accounting/details/detail-1/edit'] },
    );

    const titleInput = await screen.findByLabelText(t.details.name);
    expect(screen.queryByLabelText(t.details.code)).not.toBeInTheDocument();
    await user.clear(titleInput);
    await user.type(titleInput, 'Updated bank');
    await user.click(screen.getByRole('button', { name: t.orgAdmin.save }));

    await waitFor(() =>
      expect(accountingApi.updateDetail).toHaveBeenCalledWith(
        testOrganization.id,
        detail.id,
        { title: 'Updated bank', parentId: null, isPostable: true },
      ),
    );
    expect(accountingApi.createDetail).not.toHaveBeenCalled();
  });
});
