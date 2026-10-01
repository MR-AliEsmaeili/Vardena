import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import {
  allOrganizationAdminPermissions,
  paginated,
  testBranch,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { createTestQueryClient, renderWithProviders } from '@/test/test-utils';
import { BranchDetailPage } from './branches/branch-detail-page';
import { OrganizationProfilePage } from './organization-profile-page';

/**
 * Lifecycle (enable / disable) and the organization profile.
 *
 * The organization module exposes NO delete endpoint — `POST /:id/enable` and
 * `POST /:id/disable` are the whole lifecycle — so these screens must offer
 * exactly those two transitions, behind a confirmation that states the
 * consequence, with the server's own record written back on success.
 */

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));

vi.mock('@/api/organization.api', () => ({
  MAX_PAGE_SIZE: 500,
  listOrganizations: vi.fn(),
  getOrganization: vi.fn(),
  updateOrganization: vi.fn(),
  enableOrganization: vi.fn(),
  disableOrganization: vi.fn(),
  getBranch: vi.fn(),
  enableBranch: vi.fn(),
  disableBranch: vi.fn(),
  updateBranch: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');

function renderBranchDetail() {
  return renderWithProviders(
    <Routes>
      <Route
        path="/app/organization/branches/:branchId"
        element={<BranchDetailPage />}
      />
    </Routes>,
    { initialEntries: ['/app/organization/branches/brn-1'] },
  );
}

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: allOrganizationAdminPermissions,
  });
  vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
    paginated([testOrganization]),
  );
  vi.mocked(organizationApi.getOrganization).mockResolvedValue(
    testOrganization,
  );
  vi.mocked(organizationApi.getBranch).mockResolvedValue(testBranch);
});

describe('branch lifecycle', () => {
  it('offers disable (not delete) and states the consequence before calling the endpoint', async () => {
    const disabled = { ...testBranch, isActive: false };
    // The endpoint answers with the new record, and a later read sees it too:
    // nothing is applied optimistically, the screen follows the server.
    vi.mocked(organizationApi.disableBranch).mockImplementation(() => {
      vi.mocked(organizationApi.getBranch).mockResolvedValue(disabled);
      return Promise.resolve(disabled);
    });
    const user = userEvent.setup();
    renderBranchDetail();

    await screen.findByTestId('branch-detail-page');
    expect(
      screen.queryByRole('button', { name: /حذف/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(t.orgAdmin.noDeleteHint)).toBeInTheDocument();

    await user.click(screen.getByTestId('org-admin-disable'));
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      t.orgAdmin.disableBody,
    );
    expect(organizationApi.disableBranch).not.toHaveBeenCalled();

    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: t.orgAdmin.disable,
      }),
    );

    await waitFor(() =>
      expect(organizationApi.disableBranch).toHaveBeenCalledWith(
        testOrganization.id,
        testBranch.id,
      ),
    );
    // The server's own record is what the screen shows afterwards.
    expect(await screen.findByText(t.orgAdmin.disabled)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByRole('button', { name: t.orgAdmin.enable }),
    ).toBeInTheDocument();
  });

  it('keeps the dialog open with mapped Persian copy when the transition fails', async () => {
    vi.mocked(organizationApi.disableBranch).mockRejectedValue(
      new ApiError({
        code: 'BusinessRuleViolation',
        status: 422,
        message: 'branch still referenced',
      }),
    );
    const user = userEvent.setup();
    renderBranchDetail();

    await screen.findByTestId('branch-detail-page');
    await user.click(screen.getByTestId('org-admin-disable'));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: t.orgAdmin.disable,
      }),
    );

    expect(
      await screen.findByText(t.orgAdmin.errors.businessRule),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.queryByText('branch still referenced'),
    ).not.toBeInTheDocument();
  });

  it('hides the transition the session may not perform', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        PERMISSIONS.organization.view,
        PERMISSIONS.organization.branchView,
      ],
    });
    renderBranchDetail();

    await screen.findByTestId('branch-detail-page');
    expect(screen.queryByTestId('org-admin-disable')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: t.orgAdmin.edit }),
    ).not.toBeInTheDocument();
  });
});

describe('organization profile', () => {
  it('reads and writes only the organization of the active context', async () => {
    vi.mocked(organizationApi.updateOrganization).mockResolvedValue({
      ...testOrganization,
      name: 'سازمان نمونه ویرایش‌شده',
    });
    const user = userEvent.setup();
    const { queryClient } = renderWithProviders(<OrganizationProfilePage />, {
      initialEntries: ['/app/organization/profile'],
      queryClient: createTestQueryClient(),
    });

    await screen.findByTestId('organization-profile-page');
    expect(organizationApi.getOrganization).toHaveBeenCalledWith(
      testOrganization.id,
      expect.any(AbortSignal),
    );

    const name = screen.getByLabelText(t.orgAdmin.organizationName);
    await user.clear(name);
    await user.type(name, 'سازمان نمونه ویرایش‌شده');
    await user.click(screen.getByTestId('organization-profile-submit'));

    await waitFor(() =>
      expect(organizationApi.updateOrganization).toHaveBeenCalledWith(
        testOrganization.id,
        { code: testOrganization.code, name: 'سازمان نمونه ویرایش‌شده' },
      ),
    );
    expect(
      await screen.findByText(t.orgAdmin.organizationUpdated),
    ).toBeInTheDocument();
    // The switcher reads the global list, so the write must refresh it too.
    expect(
      queryClient.getQueryData(
        queryKeys.organizations.detail(testOrganization.id),
      ),
    ).toMatchObject({ name: 'سازمان نمونه ویرایش‌شده' });
    expect(
      queryClient.getQueryState(queryKeys.organizations.list({ page: 1 })),
    ).toBeUndefined();
  });

  it('uses organization-specific confirmation copy for the lifecycle', async () => {
    vi.mocked(organizationApi.disableOrganization).mockResolvedValue({
      ...testOrganization,
      isActive: false,
    });
    const user = userEvent.setup();
    renderWithProviders(<OrganizationProfilePage />, {
      initialEntries: ['/app/organization/profile'],
    });

    await screen.findByTestId('organization-profile-page');
    await user.click(screen.getByTestId('org-admin-disable'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(t.orgAdmin.organizationDisableTitle);
    expect(dialog).toHaveTextContent(t.orgAdmin.organizationDisableBody);
  });

  it('shows the profile read-only when the session cannot edit the organization', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [PERMISSIONS.organization.view],
    });
    renderWithProviders(<OrganizationProfilePage />, {
      initialEntries: ['/app/organization/profile'],
    });

    await screen.findByTestId('organization-profile-page');
    expect(screen.getByText(testOrganization.code)).toBeInTheDocument();
    expect(
      screen.queryByTestId('organization-profile-form'),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('org-admin-disable')).not.toBeInTheDocument();
  });

  it('warns while the organization itself is inactive', async () => {
    vi.mocked(organizationApi.getOrganization).mockResolvedValue({
      ...testOrganization,
      isActive: false,
    });
    renderWithProviders(<OrganizationProfilePage />, {
      initialEntries: ['/app/organization/profile'],
    });

    await screen.findByTestId('organization-profile-page');
    expect(
      screen.getAllByText(t.orgAdmin.organizationDisableBody).length,
    ).toBeGreaterThan(0);
    expect(screen.getByTestId('org-admin-enable')).toBeInTheDocument();
  });
});
