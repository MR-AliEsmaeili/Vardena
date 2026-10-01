import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiError } from '@/api/errors';
import { FinancialContextProvider } from '@/features/accounting/context/financial-context';
import { FinancialContextGate } from '@/features/accounting/context/financial-context-gate';
import { FinancialContextSelection } from '@/features/accounting/context/financial-context-selection';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import {
  allAccountingPermissions,
  paginated,
  testAccountingPeriod,
  testFinancialArea,
  testFiscalYear,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';

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
  listFinancialAreas: vi.fn(),
  listFiscalYears: vi.fn(),
  listAccountingPeriods: vi.fn(),
  createFinancialArea: vi.fn(),
  createFiscalYear: vi.fn(),
  createAccountingPeriod: vi.fn(),
  MAX_PAGE_SIZE: 500,
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');

function FinancialHarness({ selection = false }: { selection?: boolean }) {
  return (
    <FinancialContextProvider>
      {selection ? (
        <FinancialContextSelection full />
      ) : (
        <FinancialContextGate>
          <p>{t.masterData.financialContext.current}</p>
        </FinancialContextGate>
      )}
    </FinancialContextProvider>
  );
}

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: allAccountingPermissions,
  });
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(accountingApi.listFinancialAreas).mockResolvedValue(
    paginated([testFinancialArea]),
  );
  vi.mocked(accountingApi.listFiscalYears).mockResolvedValue(
    paginated([testFiscalYear]),
  );
  vi.mocked(accountingApi.listAccountingPeriods).mockResolvedValue(
    paginated([testAccountingPeriod]),
  );
});

describe('financial workspace context', () => {
  it('uses the sole active area, open year and open period only after each server result is available', async () => {
    // The API is the authority, but a malformed or stale response must never
    // turn an inactive or foreign root row into a dependent request.
    vi.mocked(accountingApi.listFinancialAreas).mockResolvedValue(
      paginated([
        testFinancialArea,
        {
          ...testFinancialArea,
          id: 'area-foreign',
          organizationId: 'organization-foreign',
        },
        { ...testFinancialArea, id: 'area-inactive', isActive: false },
      ]),
    );

    renderWithProviders(<FinancialHarness />);

    expect(
      await screen.findByText(t.masterData.financialContext.current),
    ).toBeInTheDocument();
    expect(accountingApi.listFinancialAreas).toHaveBeenCalledWith(
      { organizationId: testOrganization.id, isActive: true },
      expect.any(AbortSignal),
    );
    expect(accountingApi.listFiscalYears).toHaveBeenCalledWith(
      {
        organizationId: testOrganization.id,
        financialAreaId: testFinancialArea.id,
      },
      expect.any(AbortSignal),
    );
    expect(accountingApi.listAccountingPeriods).toHaveBeenCalledWith(
      { organizationId: testOrganization.id, fiscalYearId: testFiscalYear.id },
      expect.any(AbortSignal),
    );
  });

  it('requires an explicit financial-area selection when several active areas are available', async () => {
    const secondArea = {
      ...testFinancialArea,
      id: 'area-2',
      code: 'ALT',
      title: 'حوزه مالی دوم',
    };
    vi.mocked(accountingApi.listFinancialAreas).mockResolvedValue(
      paginated([testFinancialArea, secondArea]),
    );
    vi.mocked(accountingApi.listFiscalYears).mockResolvedValue(
      paginated([
        { ...testFiscalYear, financialAreaId: secondArea.id, id: 'year-2' },
        {
          ...testFiscalYear,
          financialAreaId: secondArea.id,
          id: 'year-3',
          code: '1406',
        },
      ]),
    );
    const user = userEvent.setup();

    renderWithProviders(<FinancialHarness />);

    expect(
      await screen.findByRole('heading', {
        name: t.masterData.financialContext.selectFinancialArea,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(t.masterData.financialContext.current),
    ).not.toBeInTheDocument();
    expect(accountingApi.listFiscalYears).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', {
        name: new RegExp(secondArea.title),
      }),
    );

    await waitFor(() =>
      expect(accountingApi.listFiscalYears).toHaveBeenCalledWith(
        {
          organizationId: testOrganization.id,
          financialAreaId: secondArea.id,
        },
        expect.any(AbortSignal),
      ),
    );
    expect(
      await screen.findByRole('heading', {
        name: t.masterData.financialContext.selectFiscalYear,
      }),
    ).toBeInTheDocument();
    expect(accountingApi.listAccountingPeriods).not.toHaveBeenCalled();
  });

  it('renders closed periods as unavailable and never lets them become the current writable context', async () => {
    const closedPeriod = {
      ...testAccountingPeriod,
      id: 'period-closed',
      title: 'دوره بسته',
      status: 'closed' as const,
    };
    vi.mocked(accountingApi.listAccountingPeriods).mockResolvedValue(
      paginated([testAccountingPeriod, closedPeriod]),
    );

    renderWithProviders(<FinancialHarness selection />);

    const closedButton = await screen.findByRole('button', {
      name: new RegExp(closedPeriod.title),
    });
    expect(closedButton).toBeDisabled();
    expect(
      screen.getByText(t.masterData.financialContext.unavailablePeriod),
    ).toBeInTheDocument();
  });

  it('shows a retryable error rather than entering the workspace when context loading fails', async () => {
    vi.mocked(accountingApi.listFinancialAreas)
      .mockRejectedValueOnce(
        new ApiError({
          code: 'InternalError',
          message: 'x',
          status: 500,
          correlationId: 'corr-financial-context',
        }),
      )
      .mockResolvedValue(paginated([testFinancialArea]));
    const user = userEvent.setup();

    renderWithProviders(<FinancialHarness />);

    expect(
      await screen.findByText(t.masterData.financialContext.loadFailed),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(t.masterData.financialContext.current),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t.app.retry }));

    expect(
      await screen.findByText(t.masterData.financialContext.current),
    ).toBeInTheDocument();
  });

  it('adds and explicitly selects a server-created area without fabricating a year or period', async () => {
    const createdArea = {
      ...testFinancialArea,
      id: 'area-created',
      code: 'NEW',
      title: 'حوزه مالی تازه',
    };
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        ...allAccountingPermissions,
        PERMISSIONS.accounting.financialAreaCreate,
      ],
    });
    vi.mocked(accountingApi.listFinancialAreas)
      .mockResolvedValueOnce(paginated([]))
      .mockResolvedValue(paginated([createdArea]));
    vi.mocked(accountingApi.createFinancialArea).mockResolvedValue(createdArea);
    const user = userEvent.setup();

    renderWithProviders(<FinancialHarness />);

    expect(
      await screen.findByText(
        t.masterData.financialContext.emptyFinancialAreaTitle,
      ),
    ).toBeInTheDocument();
    await user.type(
      screen.getByLabelText(t.masterData.financialContext.code),
      createdArea.code,
    );
    await user.type(
      screen.getByLabelText(t.masterData.financialContext.titleField),
      createdArea.title,
    );
    await user.click(
      screen.getByRole('button', {
        name: t.masterData.financialContext.create,
      }),
    );

    expect(
      await screen.findByText(
        t.masterData.financialContext.emptyFiscalYearTitle,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(t.masterData.financialContext.current),
    ).not.toBeInTheDocument();
    expect(accountingApi.createFinancialArea).toHaveBeenCalledWith({
      organizationId: testOrganization.id,
      code: createdArea.code,
      title: createdArea.title,
    });
    expect(accountingApi.listFiscalYears).toHaveBeenCalledWith(
      {
        organizationId: testOrganization.id,
        financialAreaId: createdArea.id,
      },
      expect.any(AbortSignal),
    );
  });
});
