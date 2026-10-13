import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/app/router';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import {
  allOrganizationAdminPermissions,
  paginated,
  testActiveLicenseState,
  testBranch,
  testDepartment,
  testEmployee,
  testOrganization,
  testParty,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';

/**
 * Route-level permission gating of the organization administration area.
 *
 * Each assertion states the backend rule it mirrors
 * (`backend/src/modules/organization/api/*.controller.ts`):
 * a list/detail route needs exactly the resource's `*.View`, a create route
 * needs exactly `*.Create` (NOT `View`, because `POST` enforces only
 * `Create`), and an edit route needs `View` + `Edit` because it reads the
 * record before it can submit the change.
 */

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));

vi.mock('@/api/accounting.api', () => ({
  fetchChartTreePages: vi.fn(),
  listFinancialAreasPage: vi.fn(),
  listFiscalYearsPage: vi.fn(),
  listAccountingPeriodsPage: vi.fn(),
  listAccounts: vi.fn(),
  getAccount: vi.fn(),
  listFinancialAreas: vi.fn(),
  listFiscalYears: vi.fn(),
  listAccountingPeriods: vi.fn(),
  listPostableAccounts: vi.fn(),
  listGeneralLedger: vi.fn(),
  listTrialBalance: vi.fn(),
  getAccountStatement: vi.fn(),
  MAX_PAGE_SIZE: 500,
  CHART_TREE_MAX_PAGES: 10,
}));

vi.mock('@/api/organization.api', () => ({
  MAX_PAGE_SIZE: 500,
  ORGANIZATION_SORT_FIELDS: ['code', 'name', 'createdAt', 'updatedAt'],
  BRANCH_SORT_FIELDS: ['code', 'name', 'createdAt', 'updatedAt'],
  DEPARTMENT_SORT_FIELDS: ['code', 'name', 'createdAt', 'updatedAt'],
  EMPLOYEE_SORT_FIELDS: [
    'employeeCode',
    'firstName',
    'lastName',
    'createdAt',
    'updatedAt',
  ],
  PARTY_SORT_FIELDS: ['code', 'displayName', 'createdAt', 'updatedAt'],
  listMyOrganizations: vi.fn(),
  createOrganization: vi.fn(),
  grantMembership: vi.fn(),
  getOrganization: vi.fn(),
  updateOrganization: vi.fn(),
  enableOrganization: vi.fn(),
  disableOrganization: vi.fn(),
  listBranches: vi.fn(),
  getBranch: vi.fn(),
  createBranch: vi.fn(),
  updateBranch: vi.fn(),
  enableBranch: vi.fn(),
  disableBranch: vi.fn(),
  listDepartments: vi.fn(),
  getDepartment: vi.fn(),
  createDepartment: vi.fn(),
  updateDepartment: vi.fn(),
  enableDepartment: vi.fn(),
  disableDepartment: vi.fn(),
  listEmployees: vi.fn(),
  getEmployee: vi.fn(),
  createEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  enableEmployee: vi.fn(),
  disableEmployee: vi.fn(),
  listParties: vi.fn(),
  getParty: vi.fn(),
  createParty: vi.fn(),
  updateParty: vi.fn(),
  enableParty: vi.fn(),
  disableParty: vi.fn(),
}));

vi.mock('@/api/licensing.api', () => ({
  getLicenseState: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const licensingApi = await import('@/api/licensing.api');

function session(permissions: string[]): void {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions,
  });
}

beforeEach(() => {
  // The shell resolves the installation license before the organization
  // stage (ADR-0030); these scenarios run behind the local provider's
  // default active license.
  vi.mocked(licensingApi.getLicenseState).mockResolvedValue(
    testActiveLicenseState,
  );
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(organizationApi.getOrganization).mockResolvedValue(
    testOrganization,
  );
  vi.mocked(organizationApi.listBranches).mockResolvedValue(
    paginated([testBranch]),
  );
  vi.mocked(organizationApi.getBranch).mockResolvedValue(testBranch);
  vi.mocked(organizationApi.listDepartments).mockResolvedValue(
    paginated([testDepartment]),
  );
  vi.mocked(organizationApi.getDepartment).mockResolvedValue(testDepartment);
  vi.mocked(organizationApi.listEmployees).mockResolvedValue(
    paginated([testEmployee]),
  );
  vi.mocked(organizationApi.getEmployee).mockResolvedValue(testEmployee);
  vi.mocked(organizationApi.listParties).mockResolvedValue(
    paginated([testParty]),
  );
  vi.mocked(organizationApi.getParty).mockResolvedValue(testParty);
});

describe('organization administration routing', () => {
  it.each([
    [
      '/app/organization/profile',
      PERMISSIONS.organization.view,
      t.orgAdmin.profile,
    ],
    [
      '/app/organization/branches',
      PERMISSIONS.organization.branchView,
      t.orgAdmin.branches,
    ],
    [
      '/app/organization/branches/brn-1',
      PERMISSIONS.organization.branchView,
      t.orgAdmin.branchDetail,
    ],
    [
      '/app/organization/departments',
      PERMISSIONS.organization.departmentView,
      t.orgAdmin.departments,
    ],
    [
      '/app/organization/departments/dep-1',
      PERMISSIONS.organization.departmentView,
      t.orgAdmin.departmentDetail,
    ],
    [
      '/app/organization/employees',
      PERMISSIONS.organization.employeeView,
      t.orgAdmin.employees,
    ],
    [
      '/app/organization/employees/emp-1',
      PERMISSIONS.organization.employeeView,
      t.orgAdmin.employeeDetail,
    ],
    [
      '/app/organization/parties',
      PERMISSIONS.organization.partyView,
      t.orgAdmin.parties,
    ],
    [
      '/app/organization/parties/par-1',
      PERMISSIONS.organization.partyView,
      t.orgAdmin.partyDetail,
    ],
  ])(
    'opens %s with only its endpoint permission',
    async (path, permission, heading) => {
      session([PERMISSIONS.organization.view, permission]);

      renderWithProviders(<AppRoutes />, { initialEntries: [path] });

      expect(
        await screen.findByRole('heading', { name: heading }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(t.permissions.forbiddenTitle),
      ).not.toBeInTheDocument();
    },
  );

  it.each([
    [
      '/app/organization/branches/new',
      PERMISSIONS.organization.branchCreate,
      t.orgAdmin.branchCreateTitle,
    ],
    [
      '/app/organization/departments/new',
      PERMISSIONS.organization.departmentCreate,
      t.orgAdmin.departmentCreateTitle,
    ],
    [
      '/app/organization/employees/new',
      PERMISSIONS.organization.employeeCreate,
      t.orgAdmin.employeeCreateTitle,
    ],
    [
      '/app/organization/parties/new',
      PERMISSIONS.organization.partyCreate,
      t.orgAdmin.partyCreateTitle,
    ],
  ])(
    'opens %s with only *.Create — the POST endpoint requires no View (backend permission alignment)',
    async (path, permission, heading) => {
      session([PERMISSIONS.organization.view, permission]);

      renderWithProviders(<AppRoutes />, { initialEntries: [path] });

      expect(
        await screen.findByRole('heading', { name: heading }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(t.permissions.forbiddenTitle),
      ).not.toBeInTheDocument();
    },
  );

  it('refuses the create route to a session that only holds View', async () => {
    session([
      PERMISSIONS.organization.view,
      PERMISSIONS.organization.branchView,
    ]);

    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/organization/branches/new'],
    });

    expect(
      await screen.findByText(t.permissions.forbiddenTitle),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.orgAdmin.branchCreateTitle }),
    ).not.toBeInTheDocument();
    expect(organizationApi.createBranch).not.toHaveBeenCalled();
  });

  it('refuses the edit route to a session that only holds View', async () => {
    session([
      PERMISSIONS.organization.view,
      PERMISSIONS.organization.branchView,
    ]);

    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/organization/branches/brn-1/edit'],
    });

    expect(
      await screen.findByText(t.permissions.forbiddenTitle),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.orgAdmin.branchEditTitle }),
    ).not.toBeInTheDocument();
  });

  it('opens the edit route for a session holding View and Edit', async () => {
    session([
      PERMISSIONS.organization.view,
      PERMISSIONS.organization.branchView,
      PERMISSIONS.organization.branchEdit,
    ]);

    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/organization/branches/brn-1/edit'],
    });

    expect(
      await screen.findByRole('heading', { name: t.orgAdmin.branchEditTitle }),
    ).toBeInTheDocument();
    expect(
      await screen.findByDisplayValue(testBranch.code),
    ).toBeInTheDocument();
  });

  it('shows the area index to any signed-in session and lists only the permitted surfaces', async () => {
    session([
      PERMISSIONS.organization.view,
      PERMISSIONS.organization.partyView,
    ]);

    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/organization'],
    });

    expect(
      await screen.findByTestId('organization-admin-home'),
    ).toBeInTheDocument();
    const home = screen.getByTestId('organization-admin-home');
    // Exactly the two surfaces this session can open: the profile
    // (`Organization.Organization.View`) and parties (`Organization.Party.View`).
    const openLinks = within(home).getAllByRole('link', {
      name: new RegExp(t.home.openSection),
    });
    expect(openLinks).toHaveLength(2);
    expect(openLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/app/organization/profile',
      '/app/organization/parties',
    ]);
    expect(
      within(home).getByRole('heading', { name: t.orgAdmin.parties }),
    ).toBeInTheDocument();
    for (const hidden of [
      t.orgAdmin.branches,
      t.orgAdmin.departments,
      t.orgAdmin.employees,
    ]) {
      expect(
        within(home).queryByRole('heading', { name: hidden }),
      ).not.toBeInTheDocument();
    }
  });

  it('keeps an unknown route under the area on the not-found page (no catch-all change)', async () => {
    session(allOrganizationAdminPermissions);

    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/organization/does-not-exist'],
    });

    expect(await screen.findByText(t.app.notFoundTitle)).toBeInTheDocument();
  });
});
