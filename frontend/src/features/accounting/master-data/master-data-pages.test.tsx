import { screen, waitFor } from '@testing-library/react';
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
import { FinancialAreasPage } from './financial-areas-page';

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));
vi.mock('@/api/organization.api', () => ({
  listOrganizations: vi.fn(),
  MAX_PAGE_SIZE: 500,
}));
vi.mock('@/api/accounting.api', () => ({
  listFinancialAreasPage: vi.fn(),
  listFiscalYearsPage: vi.fn(),
  listAccountingPeriodsPage: vi.fn(),
  listAccounts: vi.fn(),
  getAccount: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: allAccountingPermissions,
  });
  vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
    paginated([testOrganization]),
  );
});

describe('Financial areas master data', () => {
  it('shows loading then organization-scoped results', async () => {
    vi.mocked(accountingApi.listFinancialAreasPage).mockResolvedValue(
      paginated([testFinancialArea]),
    );
    renderWithProviders(<FinancialAreasPage />);

    expect(
      await screen.findByText(testFinancialArea.title),
    ).toBeInTheDocument();
    expect(accountingApi.listFinancialAreasPage).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: testOrganization.id }),
      expect.any(AbortSignal),
    );
    expect(
      screen.getByText(testOrganization.name, { exact: false }),
    ).toBeInTheDocument();
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

  it('normalizes server failures and never exposes the raw backend message', async () => {
    vi.mocked(accountingApi.listFinancialAreasPage).mockRejectedValue(
      new ApiError({
        code: 'InternalError',
        status: 500,
        message: 'Prisma exploded',
      }),
    );
    renderWithProviders(<FinancialAreasPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByText('Prisma exploded')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t.app.retry }),
    ).toBeInTheDocument();
  });
});
