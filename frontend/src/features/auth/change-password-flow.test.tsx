import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { AppRoutes } from '@/app/router';
import { t } from '@/lib/i18n';
import {
  allAccountingPermissions,
  paginated,
  testActiveLicenseState,
  testFinancialArea,
  testFiscalYear,
  testForcedPasswordChangeUser,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));

vi.mock('@/api/organization.api', () => ({
  listMyOrganizations: vi.fn(),
  MAX_PAGE_SIZE: 500,
}));

vi.mock('@/api/dashboard.api', () => ({
  listAccountingDocuments: vi.fn().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 9,
  }),
  listAccountBalances: vi.fn().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 500,
  }),
  listInventoryBalances: vi.fn().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 10,
  }),
  listWorkflowInstances: vi.fn().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 10,
  }),
  MAX_PAGE_SIZE: 500,
}));

vi.mock('@/api/accounting.api', () => ({
  listFinancialAreas: vi.fn().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 500,
  }),
  listFiscalYears: vi.fn().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 500,
  }),
  listAccountingPeriods: vi.fn().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 500,
  }),
  listPostableAccounts: vi.fn(),
  listGeneralLedger: vi.fn(),
  listTrialBalance: vi.fn(),
  getAccountStatement: vi.fn(),
  listChartTree: vi.fn(),
  fetchChartTreePages: vi
    .fn()
    .mockResolvedValue({ nodes: [], total: 0, truncated: false }),
  MAX_PAGE_SIZE: 500,
  CHART_TREE_MAX_PAGES: 10,
}));

vi.mock('@/api/licensing.api', () => ({
  getLicenseState: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const licensingApi = await import('@/api/licensing.api');
const accountingApi = await import('@/api/accounting.api');

const unauthorized = new ApiError({
  code: 'Unauthorized',
  message: t.errors.unauthorized,
  status: 401,
  correlationId: 'corr-change-password',
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(licensingApi.getLicenseState).mockResolvedValue(
    testActiveLicenseState,
  );
  vi.mocked(identityApi.getCurrentUser).mockRejectedValue(unauthorized);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testForcedPasswordChangeUser.id,
    permissions: allAccountingPermissions,
  });
  vi.mocked(identityApi.logout).mockResolvedValue(undefined);
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(accountingApi.listFinancialAreas).mockResolvedValue(
    paginated([testFinancialArea]),
  );
  vi.mocked(accountingApi.listFiscalYears).mockResolvedValue(
    paginated([testFiscalYear]),
  );
});

describe('Forced first-login password change flow', () => {
  it('redirects a newly logged-in user with mustChangePassword=true to /change-password and blocks normal app queries until changed', async () => {
    vi.mocked(identityApi.login).mockResolvedValue(
      testForcedPasswordChangeUser,
    );

    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { initialEntries: ['/login'] });

    const usernameInput = await screen.findByLabelText(t.auth.username);
    await user.type(usernameInput, 'مدیر');
    await user.type(
      screen.getByLabelText(t.auth.password),
      'initial-bootstrap-secret',
    );
    await user.click(screen.getByRole('button', { name: t.auth.submit }));

    expect(
      await screen.findByRole('heading', { name: t.auth.changePasswordTitle }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(testForcedPasswordChangeUser.username),
    ).toBeInTheDocument();

    // Protected shell queries must not fire while mustChangePassword is true.
    expect(identityApi.getEffectivePermissions).not.toHaveBeenCalled();
    expect(organizationApi.listMyOrganizations).not.toHaveBeenCalled();
  });

  it('redirects a restored session with mustChangePassword=true away from /app routes and preserves the deep link after password change', async () => {
    vi.mocked(identityApi.getCurrentUser).mockResolvedValue(
      testForcedPasswordChangeUser,
    );
    vi.mocked(identityApi.changePassword).mockResolvedValue({
      ...testForcedPasswordChangeUser,
      mustChangePassword: false,
    });

    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/accounting/chart'],
    });

    expect(
      await screen.findByRole('heading', { name: t.auth.changePasswordTitle }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.chartTree.title }),
    ).not.toBeInTheDocument();

    await user.type(
      screen.getByLabelText(t.auth.currentPassword),
      'initial-bootstrap-secret',
    );
    await user.type(
      screen.getByLabelText(t.auth.newPassword),
      'rotated-strong-secret-99',
    );
    await user.type(
      screen.getByLabelText(t.auth.confirmPassword),
      'rotated-strong-secret-99',
    );
    await user.click(
      screen.getByRole('button', { name: t.auth.submitChangePassword }),
    );

    expect(identityApi.changePassword).toHaveBeenCalledWith({
      currentPassword: 'initial-bootstrap-secret',
      newPassword: 'rotated-strong-secret-99',
    });

    // Navigates straight into the originally requested route without a second login.
    expect(
      await screen.findByRole('heading', { name: t.chartTree.title }),
    ).toBeInTheDocument();
  });

  it('enforces client-side validation for required fields, minimum length, identical passwords, and confirmation mismatch', async () => {
    vi.mocked(identityApi.getCurrentUser).mockResolvedValue(
      testForcedPasswordChangeUser,
    );

    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/change-password'],
    });

    await screen.findByRole('heading', { name: t.auth.changePasswordTitle });

    // 1. Submit empty form
    await user.click(
      screen.getByRole('button', { name: t.auth.submitChangePassword }),
    );
    expect(
      await screen.findByText(t.auth.currentPasswordRequired),
    ).toBeInTheDocument();
    expect(screen.getByText(t.auth.newPasswordRequired)).toBeInTheDocument();
    expect(
      screen.getByText(t.auth.confirmPasswordRequired),
    ).toBeInTheDocument();
    expect(identityApi.changePassword).not.toHaveBeenCalled();

    // 2. Short newPassword (< 8 chars)
    await user.type(
      screen.getByLabelText(t.auth.currentPassword),
      'old-secret',
    );
    await user.type(screen.getByLabelText(t.auth.newPassword), 'short');
    await user.type(screen.getByLabelText(t.auth.confirmPassword), 'short');
    await user.click(
      screen.getByRole('button', { name: t.auth.submitChangePassword }),
    );
    expect(
      await screen.findByText(t.auth.newPasswordMinLength),
    ).toBeInTheDocument();
    expect(identityApi.changePassword).not.toHaveBeenCalled();

    // 3. New password identical to current password
    await user.clear(screen.getByLabelText(t.auth.newPassword));
    await user.clear(screen.getByLabelText(t.auth.confirmPassword));
    await user.type(screen.getByLabelText(t.auth.newPassword), 'old-secret');
    await user.type(
      screen.getByLabelText(t.auth.confirmPassword),
      'old-secret',
    );
    await user.click(
      screen.getByRole('button', { name: t.auth.submitChangePassword }),
    );
    expect(
      await screen.findByText(t.auth.newPasswordMustDiffer),
    ).toBeInTheDocument();
    expect(identityApi.changePassword).not.toHaveBeenCalled();

    // 4. Confirmation mismatch
    await user.clear(screen.getByLabelText(t.auth.newPassword));
    await user.clear(screen.getByLabelText(t.auth.confirmPassword));
    await user.type(
      screen.getByLabelText(t.auth.newPassword),
      'new-valid-secret-123',
    );
    await user.type(
      screen.getByLabelText(t.auth.confirmPassword),
      'different-secret-123',
    );
    await user.click(
      screen.getByRole('button', { name: t.auth.submitChangePassword }),
    );
    expect(
      await screen.findByText(t.auth.passwordConfirmationMismatch),
    ).toBeInTheDocument();
    expect(identityApi.changePassword).not.toHaveBeenCalled();
  });

  it('surfaces backend current-password validation errors in Persian and clears password inputs', async () => {
    vi.mocked(identityApi.getCurrentUser).mockResolvedValue(
      testForcedPasswordChangeUser,
    );
    vi.mocked(identityApi.changePassword).mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'ValidationFailed',
        message: t.errors.validation,
        correlationId: 'corr-change-pw-400',
        details: [
          {
            field: 'currentPassword',
            code: 'invalidCurrentPassword',
            message: 'Current password is incorrect.',
          },
        ],
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/change-password'],
    });

    const currentInput = await screen.findByLabelText(t.auth.currentPassword);
    const newInput = screen.getByLabelText(t.auth.newPassword);
    const confirmInput = screen.getByLabelText(t.auth.confirmPassword);

    await user.type(currentInput, 'wrong-current-password');
    await user.type(newInput, 'rotated-strong-secret-99');
    await user.type(confirmInput, 'rotated-strong-secret-99');
    await user.click(
      screen.getByRole('button', { name: t.auth.submitChangePassword }),
    );

    expect(
      await screen.findByText(t.auth.changePasswordFailedTitle),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(t.auth.currentPasswordInvalid).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('corr-change-pw-400')).toBeInTheDocument();
    expect(currentInput).toHaveValue('');
    expect(newInput).toHaveValue('');
    expect(confirmInput).toHaveValue('');
  });

  it('allows a restricted user to log out from the forced password change screen', async () => {
    vi.mocked(identityApi.getCurrentUser).mockResolvedValue(
      testForcedPasswordChangeUser,
    );

    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/change-password'],
    });

    await screen.findByRole('heading', { name: t.auth.changePasswordTitle });
    await user.click(screen.getByRole('button', { name: t.auth.logout }));

    await waitFor(() => {
      expect(identityApi.logout).toHaveBeenCalledOnce();
    });
    expect(
      await screen.findByRole('heading', { name: t.auth.loginTitle }),
    ).toBeInTheDocument();
  });

  it('prevents redirect loops when unauthenticated or already-unlocked users visit /change-password', async () => {
    // 1. Unauthenticated -> /login
    vi.mocked(identityApi.getCurrentUser).mockRejectedValue(unauthorized);
    const { unmount } = renderWithProviders(<AppRoutes />, {
      initialEntries: ['/change-password'],
    });
    expect(
      await screen.findByRole('heading', { name: t.auth.loginTitle }),
    ).toBeInTheDocument();
    unmount();

    // 2. Authenticated with mustChangePassword=false -> /app
    vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
    renderWithProviders(<AppRoutes />, {
      initialEntries: [
        { pathname: '/change-password', state: { from: '/change-password' } },
      ],
    });
    expect(
      await screen.findByRole('heading', { name: t.dashboard.title }),
    ).toBeInTheDocument();
  });
});
