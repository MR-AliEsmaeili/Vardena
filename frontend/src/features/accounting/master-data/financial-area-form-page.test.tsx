import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { t } from '@/lib/i18n';
import {
  allAccountingPermissions,
  paginated,
  testFinancialArea,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { FinancialAreaFormPage } from './financial-area-form-page';

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
  getFinancialArea: vi.fn(),
  createFinancialArea: vi.fn(),
  updateFinancialArea: vi.fn(),
  enableFinancialArea: vi.fn(),
  disableFinancialArea: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');

function renderFormRoutes(entry: string): void {
  const routes: ReactElement = (
    <Routes>
      <Route
        path="/app/accounting/financial-areas/new"
        element={<FinancialAreaFormPage mode="create" />}
      />
      <Route
        path="/app/accounting/financial-areas/:financialAreaId/edit"
        element={<FinancialAreaFormPage mode="edit" />}
      />
      <Route
        path="/app/accounting/financial-areas"
        element={<p data-testid="financial-areas-list" />}
      />
    </Routes>
  );
  renderWithProviders(routes, { initialEntries: [entry] });
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
  vi.mocked(accountingApi.listFiscalYears).mockResolvedValue(paginated([]));
});

describe('FinancialAreaFormPage (ACC-01)', () => {
  it('create: submits the exact { organizationId, code, title } body, trimmed', async () => {
    const created = {
      ...testFinancialArea,
      id: 'area-new',
      code: 'ALT',
      title: 'حوزه مالی دوم',
      isDefault: false,
    };
    vi.mocked(accountingApi.createFinancialArea).mockResolvedValue(created);
    const user = userEvent.setup();
    renderFormRoutes('/app/accounting/financial-areas/new');

    await user.type(
      await screen.findByLabelText(t.financialArea.code),
      ' ALT ',
    );
    await user.type(screen.getByLabelText(t.financialArea.name), created.title);
    await user.click(screen.getByTestId('financial-area-form-submit'));

    await waitFor(() => {
      expect(accountingApi.createFinancialArea).toHaveBeenCalledWith({
        organizationId: testOrganization.id,
        code: 'ALT',
        title: created.title,
      });
    });
    expect(
      await screen.findByTestId('financial-areas-list'),
    ).toBeInTheDocument();
  });

  it('edit: loads the record into the form and submits a PATCH body', async () => {
    vi.mocked(accountingApi.getFinancialArea).mockResolvedValue(
      testFinancialArea,
    );
    vi.mocked(accountingApi.updateFinancialArea).mockResolvedValue({
      ...testFinancialArea,
      title: 'عنوان تازه',
    });
    const user = userEvent.setup();
    renderFormRoutes(
      `/app/accounting/financial-areas/${testFinancialArea.id}/edit`,
    );

    const codeInput = await screen.findByLabelText(t.financialArea.code);
    const titleInput = screen.getByLabelText(t.financialArea.name);
    expect(codeInput).toHaveValue(testFinancialArea.code);
    expect(titleInput).toHaveValue(testFinancialArea.title);
    expect(accountingApi.getFinancialArea).toHaveBeenCalledWith(
      testOrganization.id,
      testFinancialArea.id,
      expect.any(AbortSignal),
    );

    await user.clear(titleInput);
    await user.type(titleInput, 'عنوان تازه');
    await user.click(screen.getByTestId('financial-area-form-submit'));

    await waitFor(() => {
      expect(accountingApi.updateFinancialArea).toHaveBeenCalledWith(
        testOrganization.id,
        testFinancialArea.id,
        { code: testFinancialArea.code, title: 'عنوان تازه' },
      );
    });
    expect(
      await screen.findByTestId('financial-areas-list'),
    ).toBeInTheDocument();
  });

  it('shows client validation errors for empty fields and never calls the API', async () => {
    const user = userEvent.setup();
    renderFormRoutes('/app/accounting/financial-areas/new');

    await user.click(await screen.findByTestId('financial-area-form-submit'));

    expect(
      await screen.findByText(t.financialArea.codeRequired),
    ).toBeInTheDocument();
    expect(screen.getByText(t.financialArea.titleRequired)).toBeInTheDocument();
    expect(accountingApi.createFinancialArea).not.toHaveBeenCalled();
  });

  it('maps a server conflict into the alert and never exposes the raw message', async () => {
    vi.mocked(accountingApi.createFinancialArea).mockRejectedValue(
      new ApiError({
        code: 'Conflict',
        status: 409,
        message: 'A financial area with that code already exists.',
        correlationId: 'area-conflict-1',
      }),
    );
    const user = userEvent.setup();
    renderFormRoutes('/app/accounting/financial-areas/new');

    await user.type(
      await screen.findByLabelText(t.financialArea.code),
      testFinancialArea.code,
    );
    await user.type(
      screen.getByLabelText(t.financialArea.name),
      testFinancialArea.title,
    );
    await user.click(screen.getByTestId('financial-area-form-submit'));

    expect(
      await screen.findByText(t.financialArea.errorCodes.duplicateCode),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.queryByText('A financial area with that code already exists.'),
    ).not.toBeInTheDocument();
  });
});
