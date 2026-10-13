import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import {
  allOrganizationAdminPermissions,
  paginated,
  testBranch,
  testDepartment,
  testEmployee,
  testOrganization,
  testParty,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { DepartmentEditPage } from './departments/department-form-page';
import {
  EmployeeCreatePage,
  EmployeeEditPage,
} from './employees/employee-form-page';
import { PartyCreatePage } from './parties/party-form-page';

/**
 * Create/edit forms of the organization master data.
 *
 * What is pinned here is the REQUEST BODY: the backend runs a global
 * `whitelist` + `forbidNonWhitelisted` validation pipe, the create DTOs have
 * no `null` form for an optional reference (it is omitted instead), and
 * `UpdateEmployeeDto` / `UpdateDepartmentDto` use an explicit `null` to
 * detach. A payload that drifts from that contract is a 400 in production,
 * so each assertion below compares the whole object.
 */

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));

vi.mock('@/api/organization.api', () => ({
  MAX_PAGE_SIZE: 500,
  listMyOrganizations: vi.fn(),
  listBranches: vi.fn(),
  listDepartments: vi.fn(),
  getDepartment: vi.fn(),
  createDepartment: vi.fn(),
  updateDepartment: vi.fn(),
  getEmployee: vi.fn(),
  createEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  getParty: vi.fn(),
  createParty: vi.fn(),
  updateParty: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');

/** The edit screens read their id from the route, exactly as the app routes it. */
function renderEmployeeEdit() {
  return renderWithProviders(
    <Routes>
      <Route
        path="/app/organization/employees/:employeeId/edit"
        element={<EmployeeEditPage />}
      />
    </Routes>,
    { initialEntries: ['/app/organization/employees/emp-1/edit'] },
  );
}

function renderDepartmentEdit() {
  return renderWithProviders(
    <Routes>
      <Route
        path="/app/organization/departments/:departmentId/edit"
        element={<DepartmentEditPage />}
      />
    </Routes>,
    { initialEntries: ['/app/organization/departments/dep-1/edit'] },
  );
}

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: allOrganizationAdminPermissions,
  });
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(organizationApi.listBranches).mockResolvedValue(
    paginated([testBranch]),
  );
  vi.mocked(organizationApi.listDepartments).mockResolvedValue(
    paginated([testDepartment]),
  );
  vi.mocked(organizationApi.getDepartment).mockResolvedValue(testDepartment);
  vi.mocked(organizationApi.getEmployee).mockResolvedValue(testEmployee);
});

describe('party form', () => {
  it('refuses a party with neither capability before calling the API', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PartyCreatePage />, {
      initialEntries: ['/app/organization/parties/new'],
    });

    await user.type(await screen.findByLabelText(t.orgAdmin.code), 'PT-09');
    await user.type(screen.getByLabelText(t.orgAdmin.displayName), 'آریا');
    // The default is "customer"; clearing it leaves the record with no role.
    await user.click(screen.getByLabelText(t.orgAdmin.customerCapability));
    await user.click(screen.getByTestId('party-form-submit'));

    expect(
      await screen.findByText(t.orgAdmin.validation.capabilityRequired),
    ).toBeInTheDocument();
    expect(organizationApi.createParty).not.toHaveBeenCalled();
  });

  it('creates the party with exactly the declared fields, omitting the empty optional ones', async () => {
    vi.mocked(organizationApi.createParty).mockResolvedValue(testParty);
    const user = userEvent.setup();
    renderWithProviders(<PartyCreatePage />, {
      initialEntries: ['/app/organization/parties/new'],
    });

    await user.type(await screen.findByLabelText(t.orgAdmin.code), 'PT-09');
    await user.type(
      screen.getByLabelText(t.orgAdmin.displayName),
      'بازرگانی آریا',
    );
    await user.click(screen.getByLabelText(t.orgAdmin.supplierCapability));
    await user.click(screen.getByTestId('party-form-submit'));

    await waitFor(() =>
      expect(organizationApi.createParty).toHaveBeenCalledWith({
        organizationId: testOrganization.id,
        code: 'PT-09',
        displayName: 'بازرگانی آریا',
        partyType: 'organization',
        isCustomer: true,
        isSupplier: true,
      }),
    );
  });

  it('maps a duplicate code (409) to its own copy and never shows the backend message', async () => {
    vi.mocked(organizationApi.createParty).mockRejectedValue(
      new ApiError({
        code: 'Conflict',
        status: 409,
        message:
          'Unique constraint failed on the fields: (`organizationId`,`code`)',
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<PartyCreatePage />, {
      initialEntries: ['/app/organization/parties/new'],
    });

    await user.type(await screen.findByLabelText(t.orgAdmin.code), 'PT-01');
    await user.type(screen.getByLabelText(t.orgAdmin.displayName), 'آریا');
    await user.click(screen.getByTestId('party-form-submit'));

    expect(
      await screen.findByText(t.orgAdmin.errors.duplicateCode),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Unique constraint/)).not.toBeInTheDocument();
  });

  it('puts a server validation issue on its own control and keeps the summary', async () => {
    vi.mocked(organizationApi.createParty).mockRejectedValue(
      new ApiError({
        code: 'ValidationFailed',
        status: 400,
        message: 'Validation failed',
        details: [
          { field: 'code', message: 'code must be shorter', code: 'maxLength' },
        ],
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<PartyCreatePage />, {
      initialEntries: ['/app/organization/parties/new'],
    });

    await user.type(await screen.findByLabelText(t.orgAdmin.code), 'PT-09');
    await user.type(screen.getByLabelText(t.orgAdmin.displayName), 'آریا');
    await user.click(screen.getByTestId('party-form-submit'));

    expect(
      await screen.findByText(t.orgAdmin.validation.codeTooLong),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t.orgAdmin.validation.serverSummary),
    ).toBeInTheDocument();
    expect(screen.queryByText('code must be shorter')).not.toBeInTheDocument();
  });
});

describe('employee form', () => {
  it('omits an unassigned department and branch on create (the create DTO has no null form)', async () => {
    vi.mocked(organizationApi.createEmployee).mockResolvedValue(testEmployee);
    const user = userEvent.setup();
    renderWithProviders(<EmployeeCreatePage />, {
      initialEntries: ['/app/organization/employees/new'],
    });

    await user.type(
      await screen.findByLabelText(t.orgAdmin.employeeCode),
      'EMP-09',
    );
    await user.type(screen.getByLabelText(t.orgAdmin.firstName), 'رضا');
    await user.type(screen.getByLabelText(t.orgAdmin.lastName), 'کریمی');
    await user.click(screen.getByTestId('employee-form-submit'));

    await waitFor(() =>
      expect(organizationApi.createEmployee).toHaveBeenCalledWith({
        organizationId: testOrganization.id,
        employeeCode: 'EMP-09',
        firstName: 'رضا',
        lastName: 'کریمی',
      }),
    );
  });

  it('sends an explicit null to detach the department on update', async () => {
    vi.mocked(organizationApi.updateEmployee).mockResolvedValue(testEmployee);
    const user = userEvent.setup();
    renderEmployeeEdit();

    const department = await screen.findByLabelText(t.orgAdmin.department);
    expect(department).toHaveValue(testDepartment.id);
    await user.selectOptions(department, '');
    await user.click(screen.getByTestId('employee-form-submit'));

    await waitFor(() =>
      expect(organizationApi.updateEmployee).toHaveBeenCalledWith(
        testOrganization.id,
        testEmployee.id,
        {
          employeeCode: testEmployee.employeeCode,
          firstName: testEmployee.firstName,
          lastName: testEmployee.lastName,
          departmentId: null,
          branchId: testBranch.id,
        },
      ),
    );
  });

  it('only offers active references of this organization, and disables the picker when it may not read them', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: allOrganizationAdminPermissions.filter(
        (code) => code !== 'Organization.Branch.View',
      ),
    });
    renderWithProviders(<EmployeeCreatePage />, {
      initialEntries: ['/app/organization/employees/new'],
    });

    expect(
      await screen.findByRole('option', {
        name: `${testDepartment.code} — ${testDepartment.name}`,
      }),
    ).toBeInTheDocument();
    expect(organizationApi.listDepartments).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: testOrganization.id,
        isActive: true,
      }),
      expect.any(AbortSignal),
    );

    // No `Organization.Branch.View`: the branch list is never requested and
    // the control explains why it cannot be used.
    const branches = screen.getByLabelText(t.orgAdmin.branch);
    expect(branches).toBeDisabled();
    expect(organizationApi.listBranches).not.toHaveBeenCalled();
    expect(
      screen.getByText(t.orgAdmin.branchesUnavailable),
    ).toBeInTheDocument();
  });
});

describe('department form', () => {
  it('never offers the department itself as its own parent', async () => {
    vi.mocked(organizationApi.listDepartments).mockResolvedValue({
      items: [
        testDepartment,
        { ...testDepartment, id: 'dep-2', code: 'DP-02', name: 'فروش' },
      ],
      total: 2,
      page: 1,
      pageSize: 200,
    });
    renderDepartmentEdit();

    await screen.findByRole('option', { name: 'DP-02 — فروش' });
    const parent = screen.getByLabelText(t.orgAdmin.parentDepartment);
    expect(
      within(parent).queryByRole('option', {
        name: `${testDepartment.code} — ${testDepartment.name}`,
      }),
    ).not.toBeInTheDocument();
  });

  it('sends null for the parent when the department becomes a root', async () => {
    vi.mocked(organizationApi.getDepartment).mockResolvedValue({
      ...testDepartment,
      parentDepartmentId: 'dep-2',
    });
    vi.mocked(organizationApi.listDepartments).mockResolvedValue({
      items: [{ ...testDepartment, id: 'dep-2', code: 'DP-02', name: 'فروش' }],
      total: 1,
      page: 1,
      pageSize: 200,
    });
    vi.mocked(organizationApi.updateDepartment).mockResolvedValue(
      testDepartment,
    );
    const user = userEvent.setup();
    renderDepartmentEdit();

    await screen.findByRole('option', { name: 'DP-02 — فروش' });
    const parent = screen.getByLabelText(t.orgAdmin.parentDepartment);
    await user.selectOptions(parent, '');
    await user.click(screen.getByTestId('department-form-submit'));

    await waitFor(() =>
      expect(organizationApi.updateDepartment).toHaveBeenCalledWith(
        testOrganization.id,
        testDepartment.id,
        {
          code: testDepartment.code,
          name: testDepartment.name,
          parentDepartmentId: null,
        },
      ),
    );
  });

  it('surfaces the hierarchy rule (422) in the words of the rule, without inventing a sub-case', async () => {
    vi.mocked(organizationApi.updateDepartment).mockRejectedValue(
      new ApiError({
        code: 'BusinessRuleViolation',
        status: 422,
        message: 'Department hierarchy cycle detected',
      }),
    );
    const user = userEvent.setup();
    renderDepartmentEdit();

    await user.type(await screen.findByLabelText(t.orgAdmin.name), 'x');
    await user.click(screen.getByTestId('department-form-submit'));

    expect(
      await screen.findByText(t.orgAdmin.errors.departmentParentRejected),
    ).toBeInTheDocument();
    expect(screen.queryByText(/cycle detected/)).not.toBeInTheDocument();
  });
});
