import { ApiError } from '@/api/errors';
import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { InventoryReservation } from '@/api/inventory.api';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { paginated, testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { useOrganizationId } from '@/features/organization/use-organization';
import { ReservationDetailPage } from './reservation-detail-page';

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
  getReservation: vi.fn(),
  releaseReservation: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const inventoryApi = await import('@/api/inventory.api');

const basePermissions = [
  PERMISSIONS.organization.view,
  PERMISSIONS.inventory.warehouseView,
  PERMISSIONS.inventory.itemView,
  PERMISSIONS.inventory.unitView,
  PERMISSIONS.inventory.reservationView,
];

const releaserPermissions = [
  ...basePermissions,
  PERMISSIONS.inventory.reservationRelease,
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

function renderDetail(
  perms: string[],
  entry = '/app/inventory/reservations/res-1',
) {
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: perms,
  });
  return renderWithProviders(<ReservationDetailPage />, {
    initialEntries: [entry],
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

describe('Reservation detail — rendering', () => {
  it('renders item, warehouse, quantities, status and instants', async () => {
    vi.mocked(inventoryApi.getReservation).mockResolvedValue(
      reservationFixture(),
    );
    renderDetail(basePermissions);

    await screen.findByText('KAL-01 — کالای نمونه');
    expect(screen.getByText('WH-01 — انبار مرکزی')).toBeInTheDocument();
    expect(screen.getAllByText('5 عدد')).toHaveLength(2);
    expect(
      screen.getByText(t.reservations.statuses.active),
    ).toBeInTheDocument();
    expect(screen.getByText('op-1')).toBeInTheDocument();
    expect(document.querySelectorAll('time')).toHaveLength(2);
  });

  it('shows the released banner and no release action for a released reservation', async () => {
    vi.mocked(inventoryApi.getReservation).mockResolvedValue(
      reservationFixture({
        status: 'released',
        releasedAt: '2026-01-02T09:00:00.000Z',
        releasedBy: 'usr-1',
      }),
    );
    renderDetail(releaserPermissions);

    await screen.findByText(t.reservations.releasedAlready);
    expect(
      screen.queryByRole('button', { name: t.reservations.release }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/usr-1/)).toBeInTheDocument();
    expect(document.querySelectorAll('time')).toHaveLength(3);
  });
});

describe('Reservation detail — release action', () => {
  it('shows release only for active reservations with Inventory.Reservation.Release', async () => {
    vi.mocked(inventoryApi.getReservation).mockResolvedValue(
      reservationFixture(),
    );
    renderDetail(basePermissions);
    await screen.findByText('KAL-01 — کالای نمونه');
    expect(
      screen.queryByRole('button', { name: t.reservations.release }),
    ).not.toBeInTheDocument();

    renderDetail(releaserPermissions);
    await screen.findByText('KAL-01 — کالای نمونه');
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: t.reservations.release }),
      ).toBeInTheDocument();
    });
  });

  it('does not offer direct release for a Material Request line — message + link', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: releaserPermissions,
    });
    vi.mocked(inventoryApi.getReservation).mockResolvedValue(
      reservationFixture({
        referenceType: 'material_request_line',
        referenceId: 'mrl-1',
      }),
    );
    renderWithProviders(<ReservationDetailPage />, {
      initialEntries: ['/app/inventory/reservations/res-1'],
    });

    await screen.findByText(t.reservations.materialRequestOwnedTitle);
    expect(
      screen.getByText(t.reservations.materialRequestOwnedBody),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.reservations.release }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: t.reservations.openMaterialRequest }),
    ).toBeInTheDocument();
  });

  it('shows the material-request link without any material-request permission', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        ...basePermissions,
        PERMISSIONS.inventory.reservationRelease,
      ],
    });
    vi.mocked(inventoryApi.getReservation).mockResolvedValue(
      reservationFixture({
        referenceType: 'material_request_line',
        referenceId: 'mrl-1',
      }),
    );
    renderWithProviders(<ReservationDetailPage />, {
      initialEntries: ['/app/inventory/reservations/res-1'],
    });

    await screen.findByText(t.reservations.materialRequestOwnedBody);
    expect(
      screen.getByRole('link', { name: t.reservations.openMaterialRequest }),
    ).toBeInTheDocument();
  });

  it('shows the verbatim already-released message on double release', async () => {
    vi.mocked(inventoryApi.getReservation).mockResolvedValue(
      reservationFixture(),
    );
    vi.mocked(inventoryApi.releaseReservation).mockRejectedValue(
      new ApiError({
        code: 'BusinessRuleViolation',
        message:
          'The reservation is already released. A release is terminal and cannot be applied twice.',
        status: 422,
      }),
    );
    const user = userEvent.setup();
    renderDetail(releaserPermissions);
    await screen.findByText('KAL-01 — کالای نمونه');
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: t.reservations.release }),
      ).toBeInTheDocument();
    });
    await user.click(
      screen.getByRole('button', { name: t.reservations.release }),
    );
    // Confirm the release in the dialog.
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: t.reservations.release,
      }),
    );
    const releasedAgain = await screen.findAllByText(
      /آزادسازی دوباره امکان‌پذیر نیست/,
      { exact: false },
    );
    expect(releasedAgain.length).toBeGreaterThan(0);
  });
});
