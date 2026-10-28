import { ApiError } from '@/api/errors';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { InventoryReservation } from '@/api/inventory.api';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { paginated, testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { useOrganizationId } from '@/features/organization/use-organization';
import { ReservationsPage } from './reservations-page';

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
vi.mock('@/features/organization/use-organization', () => ({
  useOrganizationId: vi.fn(() => 'org-1'),
}));
vi.mock('@/api/inventory.api', () => ({
  INVENTORY_MAX_PAGE_SIZE: 500,
  listInventoryWarehouses: vi.fn(),
  listInventoryItems: vi.fn(),
  listInventoryUnits: vi.fn(),
  listReservations: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const inventoryApi = await import('@/api/inventory.api');

const viewerPermissions = [
  PERMISSIONS.organization.view,
  PERMISSIONS.inventory.warehouseView,
  PERMISSIONS.inventory.itemView,
  PERMISSIONS.inventory.unitView,
  PERMISSIONS.inventory.reservationView,
];

const creatorPermissions = [
  ...viewerPermissions,
  PERMISSIONS.inventory.reservationCreate,
];

const testWarehouse = {
  id: 'wh-1',
  organizationId: 'org-1',
  branchId: 'br-1',
  code: 'WH-01',
  name: 'انبار مرکزی',
  allowNegativeStock: false,
  reservationsReduceAvailable: false,
  accountingPostingMode: 'direct_final' as const,
  isActive: true,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};

const testItem = {
  id: 'item-1',
  organizationId: 'org-1',
  code: 'KAL-01',
  name: 'کالای نمونه',
  description: null,
  itemGroupId: null,
  baseUnitId: 'unit-1',
  isStockable: true,
  isPurchasable: true,
  isSellable: true,
  isValued: true,
  requiresLot: false,
  requiresSerial: false,
  requiresExpiry: false,
  allowNegativeStock: null,
  barcode: null,
  isActive: true,
  itemKind: 'goods' as const,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};

const testUnit = {
  id: 'unit-1',
  organizationId: 'org-1',
  code: 'عدد',
  name: 'عدد',
  symbol: null,
  isActive: true,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};

function reservationFixture(
  overrides: Partial<InventoryReservation> = {},
): InventoryReservation {
  return {
    id: 'res-1',
    organizationId: 'org-1',
    branchId: null,
    warehouseId: 'wh-1',
    itemId: 'item-1',
    quantity: '5',
    enteredUnitId: 'unit-1',
    baseQuantity: '5',
    baseUnitId: 'unit-1',
    conversionFactor: '1',
    status: 'active',
    referenceType: null,
    referenceId: null,
    reason: null,
    operationKey: 'op-1',
    releasedAt: null,
    releasedBy: null,
    releaseOperationKey: null,
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
    ...overrides,
  };
}

function renderList(initialEntry = '/app/inventory/reservations') {
  return renderWithProviders(<ReservationsPage />, {
    initialEntries: [initialEntry],
  });
}

beforeEach(() => {
  vi.mocked(useOrganizationId).mockReturnValue('org-1');
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(inventoryApi.listInventoryWarehouses).mockResolvedValue(
    paginated([testWarehouse]),
  );
  vi.mocked(inventoryApi.listInventoryItems).mockResolvedValue(
    paginated([testItem]),
  );
  vi.mocked(inventoryApi.listInventoryUnits).mockResolvedValue(
    paginated([testUnit]),
  );
});

describe('Reservations list — rendering', () => {
  it('renders reservations with item/warehouse/quantity/status', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: viewerPermissions,
    });
    vi.mocked(inventoryApi.listReservations).mockResolvedValue(
      paginated([reservationFixture(), reservationFixture({ id: 'res-2' })]),
    );
    renderList();

    const table = await screen.findByRole('table');
    expect(within(table).getAllByText('KAL-01 — کالای نمونه').length).toBe(2);
    expect(within(table).getAllByText('WH-01 — انبار مرکزی').length).toBe(2);
    expect(
      within(table).getAllByText(t.reservations.statuses.active).length,
    ).toBe(2);
  });

  it('shows the first-use empty state when there are no reservations', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: viewerPermissions,
    });
    vi.mocked(inventoryApi.listReservations).mockResolvedValue(paginated([]));
    renderList();

    await screen.findByText(t.reservations.emptyTitle);
    // DataTable always renders a <table>; the empty state lives inside it.
    expect(screen.getByTestId('data-table-empty')).toBeInTheDocument();
  });

  it('shows an error alert with retry when the list fails', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: viewerPermissions,
    });
    vi.mocked(inventoryApi.listReservations).mockRejectedValue(
      new ApiError({
        code: 'ServiceUnavailable',
        message: 'down',
        status: 503,
      }),
    );
    renderList();

    await screen.findByRole('alert');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: t.app.retry }));
    await waitFor(async () => {
      expect(inventoryApi.listReservations).toHaveBeenCalledTimes(2);
    });
  });
});

describe('Reservations list — permission gates', () => {
  it('hides the create button without Inventory.Reservation.Create', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: viewerPermissions,
    });
    vi.mocked(inventoryApi.listReservations).mockResolvedValue(paginated([]));
    renderList();

    await screen.findByText(t.reservations.emptyTitle);
    expect(
      screen.queryByRole('button', { name: t.reservations.newReservation }),
    ).not.toBeInTheDocument();
  });

  it('shows the create button with Inventory.Reservation.Create', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: creatorPermissions,
    });
    vi.mocked(inventoryApi.listReservations).mockResolvedValue(paginated([]));
    renderList();

    await screen.findByText(t.reservations.emptyTitle);
    await waitFor(() => {
      expect(
        screen.getByRole('link', { name: t.reservations.newReservation }),
      ).toBeInTheDocument();
    });
  });
});

describe('Reservations list — URL-owned filters and sorting', () => {
  it('forwards declared filters to the endpoint and keeps them in the URL', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: viewerPermissions,
    });
    vi.mocked(inventoryApi.listReservations).mockResolvedValue(paginated([]));
    renderList('/app/inventory/reservations?status=active&warehouseId=wh-1');

    // With active URL filters, DataTable shows t.table.emptyTitle.
    await screen.findByText(t.table.emptyTitle);
    await waitFor(() => {
      expect(inventoryApi.listReservations).toHaveBeenCalledWith(
        {
          organizationId: 'org-1',
          status: 'active',
          warehouseId: 'wh-1',
          page: 1,
          pageSize: 50,
          sort: 'createdAt:desc',
        },
        expect.anything(),
      );
    });
  });

  it('rejects a sort outside the allow-list and falls back to the default', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: viewerPermissions,
    });
    vi.mocked(inventoryApi.listReservations).mockResolvedValue(paginated([]));
    renderList('/app/inventory/reservations?sort=number:desc');

    await screen.findByText(t.reservations.emptyTitle);
    await waitFor(() => {
      expect(inventoryApi.listReservations).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'createdAt:desc' }),
        expect.anything(),
      );
    });
  });
});
