import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { MaterialRequestsPage } from './material-requests-page';
import {
  materialRequest,
  materialRequestItem,
  materialRequestsResponse,
  materialRequestUnit,
  materialRequestWarehouse,
} from './material-request-test-fixtures';

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
vi.mock('@/api/inventory.api', () => ({
  INVENTORY_MAX_PAGE_SIZE: 500,
  listInventoryWarehouses: vi.fn(),
  listInventoryItems: vi.fn(),
  listInventoryUnits: vi.fn(),
  listMaterialRequests: vi.fn(),
  getMaterialRequest: vi.fn(),
  listMaterialRequestEvents: vi.fn(),
  createMaterialRequest: vi.fn(),
  updateMaterialRequest: vi.fn(),
  deleteMaterialRequest: vi.fn(),
  submitMaterialRequest: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const inventoryApi = await import('@/api/inventory.api');

function renderPage(initialEntry = '/app/inventory/material-requests') {
  return renderWithProviders(<MaterialRequestsPage />, {
    initialEntries: [initialEntry],
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: [
      PERMISSIONS.organization.view,
      PERMISSIONS.inventory.materialRequestView,
      PERMISSIONS.inventory.materialRequestCreate,
    ],
  });
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(inventoryApi.listInventoryWarehouses).mockResolvedValue({
    items: [materialRequestWarehouse],
    total: 1,
    page: 1,
    pageSize: 500,
  });
  vi.mocked(inventoryApi.listInventoryItems).mockResolvedValue({
    items: [materialRequestItem],
    total: 1,
    page: 1,
    pageSize: 500,
  });
  vi.mocked(inventoryApi.listInventoryUnits).mockResolvedValue({
    items: [materialRequestUnit],
    total: 1,
    page: 1,
    pageSize: 500,
  });
  vi.mocked(inventoryApi.listMaterialRequests).mockResolvedValue(
    materialRequestsResponse(),
  );
});

describe('material requests list', () => {
  it('renders a draft without a number as a draft, never as an error', async () => {
    renderPage();

    const table = await screen.findByRole('table', {
      name: t.materialRequests.title,
    });
    // A draft shows «پیش‌نویس» twice on purpose: once in the number column
    // (no number yet) and once as the status label.
    expect(
      await within(table).findAllByText(t.materialRequests.draftNumber),
    ).toHaveLength(2);
    expect(
      screen.getByRole('link', { name: t.materialRequests.openDetails }),
    ).toHaveAttribute('href', '/app/inventory/material-requests/request-1');
    expect(inventoryApi.listMaterialRequests).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1' }),
      expect.anything(),
    );
  });

  it('shows the server number for a submitted request', async () => {
    vi.mocked(inventoryApi.listMaterialRequests).mockResolvedValueOnce(
      materialRequestsResponse([
        materialRequest({ number: 'MR-1404-0001', status: 'submitted' }),
      ]),
    );
    renderPage();

    const table = await screen.findByRole('table', {
      name: t.materialRequests.title,
    });
    expect(within(table).getByText('MR-1404-0001')).toBeInTheDocument();
    expect(
      within(table).getByText(t.materialRequests.statuses.submitted),
    ).toBeInTheDocument();
  });

  it('renders an empty-state recovery path', async () => {
    vi.mocked(inventoryApi.listMaterialRequests).mockResolvedValueOnce(
      materialRequestsResponse([]),
    );
    renderPage();

    expect(
      await screen.findByText(t.materialRequests.emptyTitle),
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByRole('link', { name: t.materialRequests.newRequest })
        .every(
          (link) =>
            link.getAttribute('href') ===
            '/app/inventory/material-requests/new',
        ),
    ).toBe(true);
  });

  it('shows a localized query error and retries', async () => {
    vi.mocked(inventoryApi.listMaterialRequests)
      .mockRejectedValueOnce(
        new ApiError({ code: 'NetworkError', message: t.errors.network }),
      )
      .mockResolvedValueOnce(materialRequestsResponse([]));
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByText(t.materialRequests.loadFailed),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.app.retry }));
    expect(
      await screen.findByText(t.materialRequests.emptyTitle),
    ).toBeInTheDocument();
  });

  it('hides create when the session has only MaterialRequest View', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        PERMISSIONS.organization.view,
        PERMISSIONS.inventory.materialRequestView,
      ],
    });
    renderPage();

    expect(
      await screen.findByRole('table', { name: t.materialRequests.title }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: t.materialRequests.newRequest }),
    ).not.toBeInTheDocument();
  });

  it('keeps the status filter in the URL and normalizes an invalid requester id away', async () => {
    const user = userEvent.setup();
    renderPage(
      '/app/inventory/material-requests?requestedBy=not-a-ulid&sort=description:asc',
    );

    await waitFor(() =>
      expect(inventoryApi.listMaterialRequests).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          sort: 'createdAt:desc',
        }),
        expect.anything(),
      ),
    );
    const firstCall = vi.mocked(inventoryApi.listMaterialRequests).mock
      .calls[0];
    expect(firstCall?.[0]).not.toHaveProperty('requestedBy');
    expect(firstCall?.[0]).not.toHaveProperty('status');

    await user.selectOptions(
      screen.getByLabelText(t.materialRequests.status),
      'submitted',
    );
    await user.click(screen.getByRole('button', { name: t.app.apply }));

    await waitFor(() =>
      expect(inventoryApi.listMaterialRequests).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'submitted' }),
        expect.anything(),
      ),
    );
    // The applied value lives in the URL: the bar is remounted from it.
    await waitFor(() =>
      expect(screen.getByLabelText(t.materialRequests.status)).toHaveValue(
        'submitted',
      ),
    );
  });
});
