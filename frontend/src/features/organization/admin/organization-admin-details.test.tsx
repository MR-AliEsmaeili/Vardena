import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import {
  allOrganizationAdminPermissions,
  paginated,
  testBranch,
  testDepartment,
  testEmployee,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { EmployeeDetailPage } from './employees/employee-detail-page';

/**
 * Detail screens that resolve a related record.
 *
 * An employee carries `departmentId` / `branchId`; reading those names needs
 * the OTHER resource's own `*.View` permission, which the session may not
 * hold. The screen then shows the stored id rather than firing a request the
 * backend would certainly refuse.
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
  getEmployee: vi.fn(),
  enableEmployee: vi.fn(),
  disableEmployee: vi.fn(),
  getDepartment: vi.fn(),
  getBranch: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');

function renderEmployeeDetail() {
  return renderWithProviders(
    <Routes>
      <Route
        path="/app/organization/employees/:employeeId"
        element={<EmployeeDetailPage />}
      />
    </Routes>,
    { initialEntries: ['/app/organization/employees/emp-1'] },
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
  vi.mocked(organizationApi.getEmployee).mockResolvedValue(testEmployee);
  vi.mocked(organizationApi.getDepartment).mockResolvedValue(testDepartment);
  vi.mocked(organizationApi.getBranch).mockResolvedValue(testBranch);
});

describe('employee detail', () => {
  it('resolves the department and branch of the active organization', async () => {
    renderEmployeeDetail();

    expect(
      await screen.findByRole('link', {
        name: `${testDepartment.code} — ${testDepartment.name}`,
      }),
    ).toHaveAttribute('href', '/app/organization/departments/dep-1');
    expect(
      await screen.findByRole('link', {
        name: `${testBranch.code} — ${testBranch.name}`,
      }),
    ).toHaveAttribute('href', '/app/organization/branches/brn-1');
    expect(organizationApi.getDepartment).toHaveBeenCalledWith(
      testOrganization.id,
      testDepartment.id,
      expect.any(AbortSignal),
    );
  });

  it('falls back to the stored id when the session may not read the reference', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        PERMISSIONS.organization.view,
        PERMISSIONS.organization.employeeView,
      ],
    });
    renderEmployeeDetail();

    await screen.findByTestId('employee-detail-page');
    expect(screen.getByText(testDepartment.id)).toBeInTheDocument();
    expect(screen.getByText(testBranch.id)).toBeInTheDocument();
    expect(organizationApi.getDepartment).not.toHaveBeenCalled();
    expect(organizationApi.getBranch).not.toHaveBeenCalled();
  });

  it('says so explicitly when nothing is assigned, and asks for nothing', async () => {
    vi.mocked(organizationApi.getEmployee).mockResolvedValue({
      ...testEmployee,
      departmentId: null,
      branchId: null,
    });
    renderEmployeeDetail();

    await screen.findByTestId('employee-detail-page');
    expect(
      screen.getByText(t.orgAdmin.noDepartmentAssigned),
    ).toBeInTheDocument();
    expect(screen.getByText(t.orgAdmin.noBranchAssigned)).toBeInTheDocument();
    expect(organizationApi.getDepartment).not.toHaveBeenCalled();
    expect(organizationApi.getBranch).not.toHaveBeenCalled();
  });

  it('reports a record of another organization as not found (the backend answers 404, never 403)', async () => {
    vi.mocked(organizationApi.getEmployee).mockRejectedValue(
      new ApiError({
        code: 'EntityNotFound',
        status: 404,
        message: 'Employee emp-1 was not found',
      }),
    );
    renderEmployeeDetail();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(t.orgAdmin.employeeLoadFailed)).toBeInTheDocument();
    expect(
      screen.queryByText('Employee emp-1 was not found'),
    ).not.toBeInTheDocument();
  });
});
