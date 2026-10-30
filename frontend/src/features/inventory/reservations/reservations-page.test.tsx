import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { ReservationsPage } from './reservations-page';
import {
  reservationItem,
  reservationUnit,
  reservationWarehouse,
  reservationsResponse,
} from './reservation-test-fixtures';

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
  listReservations: vi.fn(),
  getReservation: vi.fn(),
  createReservation: vi.fn(),
  releaseReservation: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const inventoryApi = await import('@/api/inventory.api');

function renderPage(initialEntry = '/app/inventory/reservations') {
  return renderWithProviders(<ReservationsPage />, {
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
      PERMISSIONS.inventory.reservationView,
      PERMISSIONS.inventory.reservationCreate,
    ],
  });
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(inventoryApi.listInventoryWarehouses).mockResolvedValue({
    items: [reservationWarehouse],
    total: 1,
    page: 1,
    pageSize: 500,
  });
  vi.mocked(inventoryApi.listInventoryItems).mockResolvedValue({
    items: [reservationItem],
    total: 1,
    page: 1,
    pageSize: 500,
  });
  vi.mocked(inventoryApi.listInventoryUnits).mockResolvedValue({
    items: [reservationUnit],
    total: 1,
    page: 1,
    pageSize: 500,
  });
  vi.mocked(inventoryApi.listReservations).mockResolvedValue(
    reservationsResponse(),
  );
});

describe('reservations list', () => {
  it('renders a semantic server table and opens the reservation detail', async () => {
    renderPage();

    expect(await screen.findAllByText('KAL-01 — کالای نمونه')).toHaveLength(2);
    expect(
      screen.getByRole('table', { name: t.reservations.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: t.reservations.openDetails }),
    ).toHaveAttribute('href', '/app/inventory/reservations/res-1');
    expect(inventoryApi.listReservations).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1' }),
      expect.anything(),
    );
  });

  it('renders an empty-state recovery path', async () => {
    vi.mocked(inventoryApi.listReservations).mockResolvedValueOnce(
      reservationsResponse([]),
    );
    renderPage();

    expect(
      await screen.findByText(t.reservations.emptyTitle),
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByRole('link', { name: t.reservations.newReservation })
        .every(
          (link) =>
            link.getAttribute('href') === '/app/inventory/reservations/new',
        ),
    ).toBe(true);
  });

  it('shows a localized query error and retries', async () => {
    vi.mocked(inventoryApi.listReservations)
      .mockRejectedValueOnce(
        new ApiError({ code: 'NetworkError', message: t.errors.network }),
      )
      .mockResolvedValueOnce(reservationsResponse([]));
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByText(t.reservations.loadFailed),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.app.retry }));
    expect(
      await screen.findByText(t.reservations.emptyTitle),
    ).toBeInTheDocument();
  });

  it('normalizes unsupported sort input and applies status/warehouse filters from the URL', async () => {
    renderPage(
      '/app/inventory/reservations?status=active&warehouseId=wh-1&sort=quantity:asc',
    );

    await waitFor(() =>
      expect(inventoryApi.listReservations).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          status: 'active',
          warehouseId: 'wh-1',
          sort: 'createdAt:desc',
        }),
        expect.anything(),
      ),
    );

    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByLabelText(t.reservations.status),
      'released',
    );
    await user.click(screen.getByRole('button', { name: t.app.apply }));
    await waitFor(() =>
      expect(inventoryApi.listReservations).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: 'released',
          warehouseId: 'wh-1',
          sort: 'createdAt:desc',
        }),
        expect.anything(),
      ),
    );
  });

  it('hides create when the session has only reservation View', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        PERMISSIONS.organization.view,
        PERMISSIONS.inventory.reservationView,
      ],
    });
    renderPage();

    expect(await screen.findAllByText('KAL-01 — کالای نمونه')).toHaveLength(2);
    expect(
      screen.queryByRole('link', { name: t.reservations.newReservation }),
    ).not.toBeInTheDocument();
  });

  it('falls back to IDs and reports unavailable master-data references', async () => {
    vi.mocked(inventoryApi.listInventoryItems).mockRejectedValueOnce(
      new ApiError({ code: 'PermissionDenied', message: t.errors.forbidden }),
    );
    renderPage();

    expect(
      await screen.findByTestId('reservation-references-unavailable'),
    ).toBeInTheDocument();
    expect(await screen.findByText('item-1')).toBeInTheDocument();
  });
});
