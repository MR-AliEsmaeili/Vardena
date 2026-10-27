import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/app/router';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { navigationSections } from '@/app/navigation';
import { t } from '@/lib/i18n';
import {
  paginated,
  testActiveLicenseState,
  testFinancialArea,
  testFiscalYear,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';

/**
 * Route-level permission gating of the Document Foundation (DOC-01).
 *
 * The real router is rendered so the gate under test is the shipped one, not
 * a copy in the test. Both routes require exactly
 * `Document.DocumentType.View`; the backend re-authorizes every request.
 */

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
  fetchChartTreePages: vi.fn().mockResolvedValue({
    nodes: [],
    total: 0,
    truncated: false,
  }),
  listFinancialAreasPage: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 }),
  listFiscalYearsPage: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 }),
  listAccountingPeriodsPage: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 }),
  listAccounts: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 }),
  getAccount: vi.fn(),
  listFinancialAreas: vi.fn(),
  getFinancialArea: vi.fn(),
  listFiscalYears: vi.fn(),
  listAccountingPeriods: vi.fn(),
  listPostableAccounts: vi.fn(),
  listGeneralLedger: vi.fn(),
  listTrialBalance: vi.fn(),
  getAccountStatement: vi.fn(),
  MAX_PAGE_SIZE: 500,
  CHART_TREE_MAX_PAGES: 10,
}));

vi.mock('@/api/licensing.api', () => ({
  getLicenseState: vi.fn(),
  importLicenseDocument: vi.fn(),
  getClientDeviceInventory: vi.fn(),
  getClientDeviceHistory: vi.fn(),
  createDeviceEnrollmentChallenge: vi.fn(),
  activateDeviceEnrollment: vi.fn(),
  deactivateClientDevice: vi.fn(),
  createDeviceReplacementChallenge: vi.fn(),
  proveDeviceReplacement: vi.fn(),
  exportDeviceReplacementRequest: vi.fn(),
  importDeviceReplacementResponse: vi.fn(),
  cancelDeviceReplacement: vi.fn(),
}));

vi.mock('@/api/documents.api', () => ({
  listDocumentTypes: vi.fn(),
  getDocumentType: vi.fn(),
  configureDocumentType: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');
const licensingApi = await import('@/api/licensing.api');
const documentsApi = await import('@/api/documents.api');

function session(permissions: string[]) {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions,
  });
}

beforeEach(() => {
  vi.mocked(licensingApi.getLicenseState).mockResolvedValue(
    testActiveLicenseState,
  );
  vi.mocked(licensingApi.getClientDeviceInventory).mockResolvedValue({
    installationId: testActiveLicenseState.installationId!,
    licenseActive: true,
    deviceLimitSpecified: true,
    deviceLimit: 2,
    activeDeviceCount: 0,
    availableDeviceSlots: 2,
    devices: [],
    replacements: [],
  });
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(accountingApi.listFinancialAreas).mockResolvedValue(
    paginated([testFinancialArea]),
  );
  vi.mocked(accountingApi.getFinancialArea).mockResolvedValue(
    testFinancialArea,
  );
  vi.mocked(accountingApi.listFiscalYears).mockResolvedValue(
    paginated([testFiscalYear]),
  );
  vi.mocked(documentsApi.listDocumentTypes).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
  });
  vi.mocked(documentsApi.getDocumentType).mockResolvedValue({
    code: 'inventory_receipt',
    module: 'inventory',
    name: 'Inventory receipt',
    description: null,
    draftCapable: true,
    entryStates: ['temporary', 'final'],
    deletablePhases: ['draft'],
    draftRequired: false,
    configured: false,
  });
});

describe('document-type routes', () => {
  it('opens the registry list with only its exact View permission', async () => {
    session([
      PERMISSIONS.organization.view,
      PERMISSIONS.documents.documentTypeView,
    ]);

    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/documents/types'],
    });

    expect(
      await screen.findByRole('heading', { name: t.documentTypes.title }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(t.permissions.forbiddenTitle),
    ).not.toBeInTheDocument();
    // The windowed shell mounts this page only after its async gates settle,
    // so the query effect can fire just AFTER findBy* observed the commit —
    // poll instead of asserting synchronously.
    await waitFor(() =>
      expect(documentsApi.listDocumentTypes).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: testOrganization.id }),
        expect.anything(),
      ),
    );
  });

  it('blocks both routes without Document.DocumentType.View', async () => {
    session([PERMISSIONS.organization.view]);

    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/documents/types'],
    });

    expect(
      await screen.findByText(t.permissions.forbiddenTitle),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.documentTypes.title }),
    ).not.toBeInTheDocument();
    expect(documentsApi.listDocumentTypes).not.toHaveBeenCalled();
  });

  it('opens the detail route under the same View gate', async () => {
    session([
      PERMISSIONS.organization.view,
      PERMISSIONS.documents.documentTypeView,
    ]);

    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/documents/types/inventory_receipt'],
    });

    expect(
      await screen.findByText(
        `${t.documentTypes.detailTitle} — inventory_receipt`,
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(documentsApi.getDocumentType).toHaveBeenCalledWith(
        testOrganization.id,
        'inventory_receipt',
        expect.anything(),
      ),
    );
  });

  it('redirects the bare documents path to the registry list', async () => {
    session([
      PERMISSIONS.organization.view,
      PERMISSIONS.documents.documentTypeView,
    ]);

    renderWithProviders(<AppRoutes />, {
      initialEntries: ['/app/documents'],
    });

    expect(
      await screen.findByRole('heading', { name: t.documentTypes.title }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(documentsApi.listDocumentTypes).toHaveBeenCalled(),
    );
  });

  it('registers no create/delete destination for document types', () => {
    const paths = navigationSections
      .flatMap((section) => section.items)
      .map((item) => item.to);
    expect(paths).toContain('/app/documents/types');
    expect(
      paths.some((path) => /documents\/types\/(new|.*\/delete)/.test(path)),
    ).toBe(false);
    expect(
      navigationSections
        .flatMap((section) => section.items)
        .find((item) => item.to === '/app/documents/types')?.permissions,
    ).toEqual([PERMISSIONS.documents.documentTypeView]);
  });
});
