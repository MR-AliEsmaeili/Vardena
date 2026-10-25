import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFiscalYear,
  getFiscalYear,
  listFinancialAreas,
  listFiscalYearsPage,
  updateFiscalYear,
} from '@/api/accounting.api';
import { useOrganization } from '@/features/organization/use-organization';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import {
  paginated,
  testFinancialArea,
  testFiscalYear,
  testOrganization,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { ToastProvider } from '@/ui/patterns/toast';
import { FiscalYearFormPage } from './fiscal-year-form-page';

vi.mock('@/api/accounting.api', () => ({
  createFiscalYear: vi.fn(),
  getFiscalYear: vi.fn(),
  listFiscalYearsPage: vi.fn(),
  updateFiscalYear: vi.fn(),
  listFinancialAreas: vi.fn(),
}));
vi.mock('@/features/organization/use-organization', () => ({
  useOrganization: vi.fn(),
}));
vi.mock('@/features/permissions/use-permissions', () => ({
  usePermissions: vi.fn(),
}));

const baseOrganization = {
  organizationId: testOrganization.id,
  financialArea: testFinancialArea,
};

function renderForm(entry: string) {
  const routes: ReactElement = (
    <Routes>
      <Route
        path="/app/accounting/fiscal-years/new"
        element={<FiscalYearFormPage mode="create" />}
      />
      <Route
        path="/app/accounting/fiscal-years/:fiscalYearId/edit"
        element={<FiscalYearFormPage mode="edit" />}
      />
      <Route
        path="/app/accounting/fiscal-years"
        element={<p>{t.masterData.fiscalYears}</p>}
      />
    </Routes>
  );
  renderWithProviders(<ToastProvider>{routes}</ToastProvider>, {
    initialEntries: [entry],
    withProviders: false,
  });
}

async function fillCreateForm(
  user: ReturnType<typeof userEvent.setup>,
  start: string,
  end: string,
) {
  await user.type(await screen.findByLabelText(t.fiscalYear.code), 'FY-1405');
  await user.type(screen.getByLabelText(t.fiscalYear.name), 'سال مالی نمونه');
  await user.type(screen.getByLabelText(t.fiscalYear.startDate), start);
  await user.type(screen.getByLabelText(t.fiscalYear.endDate), end);
}

beforeEach(() => {
  vi.mocked(useOrganization).mockReturnValue(
    baseOrganization as ReturnType<typeof useOrganization>,
  );
  vi.mocked(usePermissions).mockReturnValue({
    codes: [],
    loaded: true,
    has: () => true,
    hasAll: () => true,
    hasAny: () => true,
  });
  vi.mocked(listFiscalYearsPage).mockResolvedValue(paginated([]));
  vi.mocked(listFinancialAreas).mockResolvedValue(
    paginated([testFinancialArea]),
  );
});

describe('FiscalYearFormPage', () => {
  it('creates with valid Jalali inputs converted to canonical ASCII BusinessDates', async () => {
    vi.mocked(createFiscalYear).mockResolvedValue(testFiscalYear);
    const user = userEvent.setup();
    renderForm('/app/accounting/fiscal-years/new');
    await fillCreateForm(user, '1405/01/01', '1405/01/02');
    await user.click(screen.getByRole('button', { name: t.fiscalYear.save }));

    await waitFor(() =>
      expect(createFiscalYear).toHaveBeenCalledWith({
        organizationId: testOrganization.id,
        financialAreaId: testFinancialArea.id,
        code: 'FY-1405',
        title: 'سال مالی نمونه',
        startDate: '2026-03-21',
        endDate: '2026-03-22',
      }),
    );
  });

  it('rejects invalid dates and a start date later than the end date', async () => {
    const user = userEvent.setup();
    renderForm('/app/accounting/fiscal-years/new');
    await fillCreateForm(user, '1405/13/01', '1405/01/02');
    await user.click(screen.getByRole('button', { name: t.fiscalYear.save }));
    expect(
      await screen.findByText(t.masterData.startDateRequired),
    ).toBeInTheDocument();
    expect(createFiscalYear).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(t.fiscalYear.startDate));
    await user.type(
      screen.getByLabelText(t.fiscalYear.startDate),
      '1405/01/02',
    );
    await user.clear(screen.getByLabelText(t.fiscalYear.endDate));
    await user.type(screen.getByLabelText(t.fiscalYear.endDate), '1405/01/01');
    await user.click(screen.getByRole('button', { name: t.fiscalYear.save }));
    expect(await screen.findByText(t.fiscalYear.dateRange)).toBeInTheDocument();
    expect(createFiscalYear).not.toHaveBeenCalled();
  });

  it('edits an existing year through PATCH', async () => {
    vi.mocked(getFiscalYear).mockResolvedValue(testFiscalYear);
    vi.mocked(updateFiscalYear).mockResolvedValue({
      ...testFiscalYear,
      title: 'نام تازه',
    });
    const user = userEvent.setup();
    renderForm(`/app/accounting/fiscal-years/${testFiscalYear.id}/edit`);
    const title = await screen.findByLabelText(t.fiscalYear.name);
    await user.clear(title);
    await user.type(title, 'نام تازه');
    await user.click(screen.getByRole('button', { name: t.fiscalYear.save }));

    await waitFor(() =>
      expect(updateFiscalYear).toHaveBeenCalledWith(
        testOrganization.id,
        testFiscalYear.id,
        {
          code: testFiscalYear.code,
          title: 'نام تازه',
          startDate: testFiscalYear.startDate,
          endDate: testFiscalYear.endDate,
          priorYearId: null,
        },
      ),
    );
  });
});
