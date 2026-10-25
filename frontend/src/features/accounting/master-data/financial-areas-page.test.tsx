import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import {
  allAccountingPermissions,
  paginated,
  testFinancialArea,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { FinancialAreasPage } from './financial-areas-page';

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
  listFinancialAreasPage: vi.fn(),
  listFinancialAreas: vi.fn(),
  listFiscalYears: vi.fn(),
  getFinancialArea: vi.fn(),
  createFinancialArea: vi.fn(),
  updateFinancialArea: vi.fn(),
  enableFinancialArea: vi.fn(),
  disableFinancialArea: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');

const secondArea = {
  ...testFinancialArea,
  id: 'area-2',
  code: 'ALT',
  title: 'حوزه مالی دوم',
  isDefault: false,
};
const inactiveArea = {
  ...testFinancialArea,
  id: 'area-3',
  code: 'OLD',
  title: 'حوزه مالی قدیمی',
  isDefault: false,
  isActive: false,
};

function setPermissions(permissions: readonly string[]) {
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: [...permissions],
  });
}

const without = (code: string) =>
  allAccountingPermissions.filter((permission) => permission !== code);

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  setPermissions(allAccountingPermissions);
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(accountingApi.listFinancialAreas).mockResolvedValue(
    paginated([testFinancialArea]),
  );
  vi.mocked(accountingApi.listFiscalYears).mockResolvedValue(paginated([]));
});

describe('Financial areas administration list (ACC-01)', () => {
  it('shows two organization-scoped areas with their row actions', async () => {
    vi.mocked(accountingApi.listFinancialAreasPage).mockResolvedValue(
      paginated([testFinancialArea, secondArea]),
    );
    renderWithProviders(<FinancialAreasPage />);

    expect(
      await screen.findByText(testFinancialArea.title),
    ).toBeInTheDocument();
    expect(screen.getByText(secondArea.title)).toBeInTheDocument();
    expect(accountingApi.listFinancialAreasPage).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: testOrganization.id }),
      expect.any(AbortSignal),
    );

    // Create (header) + edit/set-default/disable (rows) are all offered.
    expect(
      screen.getByRole('link', { name: t.financialArea.new }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('link', { name: t.financialArea.edit }),
    ).toHaveLength(2);
    // "Set default" is offered only for the area that is not already default.
    expect(
      screen.getAllByRole('button', { name: t.financialArea.setDefault }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole('button', { name: t.financialArea.disable }),
    ).toHaveLength(2);
  });

  it('renders the explicit empty state', async () => {
    vi.mocked(accountingApi.listFinancialAreasPage).mockResolvedValue(
      paginated([]),
    );
    renderWithProviders(<FinancialAreasPage />);

    expect(
      await screen.findByText(t.masterData.noFinancialAreas),
    ).toBeInTheDocument();
  });

  it('shows a normalized error with retry, and recovers on retry', async () => {
    vi.mocked(accountingApi.listFinancialAreasPage)
      .mockRejectedValueOnce(
        new ApiError({
          code: 'InternalError',
          status: 500,
          message: 'Prisma exploded',
        }),
      )
      .mockResolvedValue(paginated([testFinancialArea]));
    const user = userEvent.setup();
    renderWithProviders(<FinancialAreasPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByText('Prisma exploded')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t.app.retry }));

    expect(
      await screen.findByText(testFinancialArea.title),
    ).toBeInTheDocument();
  });

  it('hides the create action without Accounting.FinancialArea.Create', async () => {
    setPermissions(without(PERMISSIONS.accounting.financialAreaCreate));
    vi.mocked(accountingApi.listFinancialAreasPage).mockResolvedValue(
      paginated([testFinancialArea, secondArea]),
    );
    renderWithProviders(<FinancialAreasPage />);

    expect(
      await screen.findByText(testFinancialArea.title),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: t.financialArea.new }),
    ).not.toBeInTheDocument();
  });

  it('hides the disable action without Accounting.FinancialArea.Disable', async () => {
    setPermissions(without(PERMISSIONS.accounting.financialAreaDisable));
    vi.mocked(accountingApi.listFinancialAreasPage).mockResolvedValue(
      paginated([testFinancialArea, inactiveArea]),
    );
    renderWithProviders(<FinancialAreasPage />);

    expect(
      await screen.findByText(testFinancialArea.title),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.financialArea.disable }),
    ).not.toBeInTheDocument();
    // The inactive area still offers enable — each action follows only its
    // own exact permission.
    expect(
      screen.getByRole('button', { name: t.financialArea.enable }),
    ).toBeInTheDocument();
  });

  it('sets the default only after confirmation, sending exactly { isDefault: true }', async () => {
    vi.mocked(accountingApi.listFinancialAreasPage).mockResolvedValue(
      paginated([testFinancialArea, secondArea]),
    );
    vi.mocked(accountingApi.updateFinancialArea).mockResolvedValue({
      ...secondArea,
      isDefault: true,
    });
    const user = userEvent.setup();
    renderWithProviders(<FinancialAreasPage />);

    await screen.findByText(secondArea.title);
    await user.click(
      screen.getByRole('button', { name: t.financialArea.setDefault }),
    );

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(t.financialArea.setDefaultBody),
    ).toBeInTheDocument();
    expect(accountingApi.updateFinancialArea).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole('button', {
        name: t.financialArea.setDefault,
      }),
    );

    await waitFor(() => {
      expect(accountingApi.updateFinancialArea).toHaveBeenCalledWith(
        testOrganization.id,
        secondArea.id,
        { isDefault: true },
      );
    });
  });

  it('disables an area only after confirmation', async () => {
    vi.mocked(accountingApi.listFinancialAreasPage).mockResolvedValue(
      paginated([testFinancialArea, secondArea]),
    );
    vi.mocked(accountingApi.disableFinancialArea).mockResolvedValue({
      ...secondArea,
      isActive: false,
    });
    const user = userEvent.setup();
    renderWithProviders(<FinancialAreasPage />);

    await screen.findByText(secondArea.title);
    await user.click(
      screen.getByTestId(`financial-area-disable-${secondArea.id}`),
    );

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(t.financialArea.disableBody),
    ).toBeInTheDocument();
    expect(accountingApi.disableFinancialArea).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole('button', { name: t.financialArea.disable }),
    );

    await waitFor(() => {
      expect(accountingApi.disableFinancialArea).toHaveBeenCalledWith(
        testOrganization.id,
        secondArea.id,
      );
    });
  });
});
