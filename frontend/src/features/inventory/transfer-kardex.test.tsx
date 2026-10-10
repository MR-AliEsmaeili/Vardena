import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import type {
  InventoryKardexResponse,
  InventoryKardexRow,
} from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { paginated, testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { KardexPage } from './kardex-page';
import { TransferFormPage } from './transfer-form-page';

/**
 * FE-UX-02 §8–§9 regression coverage for the transfer form and the Kardex.
 *
 * Transfer contract: NO cost anywhere and NO backdate pre-check — a
 * backdated transfer is answered with the shared backdating refusal
 * (`inventory.backdated_document`, C-59C) until it is confirmed, and the form
 * renders the transfer-specific explanation inline (this surface has no
 * confirmation dialog yet — recorded UI follow-up).
 *
 * Kardex contract: quantity-only, and page 2+ replays the opaque snapshot
 * of the page-1 response unchanged (snapshot paging).
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
vi.mock('@/api/inventory.api', () => ({
  INVENTORY_MAX_PAGE_SIZE: 500,
  listInventoryWarehouses: vi.fn(),
  listInventoryItems: vi.fn(),
  listInventoryUnits: vi.fn(),
  listInventoryMovements: vi.fn(),
  postInventoryMovement: vi.fn(),
  postInventoryTransfer: vi.fn(),
  readInventoryKardex: vi.fn(),
  listInventoryValuationStates: vi.fn(),
  checkInventoryBackdate: vi.fn(),
  recalculateInventoryValuation: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const inventoryApi = await import('@/api/inventory.api');

const posterPermissions = [
  PERMISSIONS.organization.view,
  PERMISSIONS.inventory.warehouseView,
  PERMISSIONS.inventory.itemView,
  PERMISSIONS.inventory.unitView,
  PERMISSIONS.inventory.movementView,
  PERMISSIONS.inventory.movementCreate,
  PERMISSIONS.inventory.transferCreate,
];

const testWarehouseA = {
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

const testWarehouseB = {
  ...testWarehouseA,
  id: 'wh-2',
  code: 'WH-02',
  name: 'انبار فرعی',
};

const testItem = {
  id: 'item-1',
  organizationId: 'org-1',
  code: 'KAL-01',
  name: 'کالای نمونه',
  description: null,
  itemKind: 'goods' as const,
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

function kardexRow(
  overrides: Partial<InventoryKardexRow> = {},
): InventoryKardexRow {
  return {
    movementId: 'mv-1',
    movementDate: '2026-04-05',
    createdAt: '2026-04-05T08:00:00.000Z',
    movementType: 'inbound',
    signedQuantity: '5',
    displayUnitId: 'unit-1',
    runningQuantity: '5',
    transferId: null,
    reversalOfMovementId: null,
    referenceType: null,
    referenceId: null,
    ...overrides,
  };
}

function kardexResponse(
  overrides: Partial<InventoryKardexResponse> = {},
): InventoryKardexResponse {
  return {
    items: [kardexRow()],
    total: 60,
    page: 1,
    pageSize: 50,
    scope: {
      organizationId: 'org-1',
      itemId: 'item-1',
      warehouseId: 'wh-1',
      dateFrom: null,
      dateTo: null,
      baseUnitId: 'unit-1',
      displayUnitId: 'unit-1',
    },
    opening: '0',
    closing: '5',
    openingBasis: 'zero_before_all_recorded_movements',
    snapshot: 'snap-1',
    ...overrides,
  };
}
beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(inventoryApi.listInventoryWarehouses).mockResolvedValue(
    paginated([testWarehouseA, testWarehouseB]),
  );
  vi.mocked(inventoryApi.listInventoryItems).mockResolvedValue(
    paginated([testItem]),
  );
  vi.mocked(inventoryApi.listInventoryUnits).mockResolvedValue(
    paginated([testUnit]),
  );
});

// ---------------------------------------------------------------------------
// Transfer form
// ---------------------------------------------------------------------------

async function fillTransfer(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(
    await screen.findByLabelText(t.inventory.sourceWarehouse),
    'wh-1',
  );
  await user.selectOptions(
    screen.getByLabelText(t.inventory.destinationWarehouse),
    'wh-2',
  );
  await user.selectOptions(screen.getByLabelText(t.inventory.item), 'item-1');
  await user.type(screen.getByLabelText(t.inventory.quantity), '5');
  await user.selectOptions(screen.getByLabelText(t.inventory.unit), 'unit-1');
  const dateInput = screen.getByLabelText(t.inventory.movementDate);
  await user.clear(dateInput);
  await user.type(dateInput, '1404-12-10');
}

describe('Transfer form — no cost, no pre-check, honest refusal', () => {
  beforeEach(() => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: posterPermissions,
    });
  });

  it('posts the atomic transfer without any cost field and without a backdate pre-check', async () => {
    vi.mocked(inventoryApi.postInventoryTransfer).mockResolvedValue({
      transferId: 'tr-1',
      movements: [],
    } as unknown as Awaited<
      ReturnType<typeof inventoryApi.postInventoryTransfer>
    >);
    const user = userEvent.setup();
    renderWithProviders(<TransferFormPage />, {
      initialEntries: ['/app/inventory/transfers/new'],
    });

    // Neither leg has a cost input — valuation is never typed here.
    expect(
      screen.queryByLabelText(t.inventory.totalCost),
    ).not.toBeInTheDocument();

    await fillTransfer(user);
    await user.click(
      screen.getByRole('button', { name: t.inventory.submitTransfer }),
    );

    await waitFor(() =>
      expect(inventoryApi.postInventoryTransfer).toHaveBeenCalledTimes(1),
    );
    const [body] =
      vi.mocked(inventoryApi.postInventoryTransfer).mock.calls[0] ?? [];
    expect(body).toMatchObject({
      organizationId: 'org-1',
      sourceWarehouseId: 'wh-1',
      destinationWarehouseId: 'wh-2',
      itemId: 'item-1',
      quantity: '5',
      movementDate: { calendar: 'JALALI', value: '1404-12-10' },
    });
    expect('totalCost' in (body ?? {})).toBe(false);
    expect('backdateConfirmed' in (body ?? {})).toBe(false);
    // The transfer API has no backdate parameters — no pre-check either.
    expect(inventoryApi.checkInventoryBackdate).not.toHaveBeenCalled();
    expect(screen.getByText(t.inventory.transferCreated)).toBeInTheDocument();
  });

  it('rejects equal source and destination warehouses client-side', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TransferFormPage />, {
      initialEntries: ['/app/inventory/transfers/new'],
    });

    await user.selectOptions(
      await screen.findByLabelText(t.inventory.sourceWarehouse),
      'wh-1',
    );
    await user.selectOptions(
      screen.getByLabelText(t.inventory.destinationWarehouse),
      'wh-1',
    );
    await user.selectOptions(screen.getByLabelText(t.inventory.item), 'item-1');
    await user.type(screen.getByLabelText(t.inventory.quantity), '5');
    await user.selectOptions(screen.getByLabelText(t.inventory.unit), 'unit-1');
    await user.click(
      screen.getByRole('button', { name: t.inventory.submitTransfer }),
    );

    expect(
      await screen.findByText(t.inventory.destinationMustDiffer),
    ).toBeInTheDocument();
    expect(inventoryApi.postInventoryTransfer).not.toHaveBeenCalled();
  });

  it('renders the backdating refusal inline and offers no bypass (C-59C)', async () => {
    vi.mocked(inventoryApi.postInventoryTransfer).mockRejectedValue(
      new ApiError({
        code: 'BusinessRuleViolation',
        message: 'Backdated transfer not confirmed (never shown)',
        status: 422,
        details: {
          code: 'inventory.backdated_document',
          movementDate: '2020-01-01',
          keys: [
            {
              warehouseId: 'wh-1',
              latestMovementDate: '2026-01-20',
            },
            {
              warehouseId: 'wh-2',
              latestMovementDate: '2026-02-01',
            },
          ],
        },
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<TransferFormPage />, {
      initialEntries: ['/app/inventory/transfers/new'],
    });

    await fillTransfer(user);
    await user.click(
      screen.getByRole('button', { name: t.inventory.submitTransfer }),
    );

    expect(
      await screen.findByText(t.inventory.errors.backdatedTransferUnresolved),
    ).toBeInTheDocument();
    expect(screen.queryByText(/never shown/)).not.toBeInTheDocument();
    // No confirmation dialog of any kind exists on this surface.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Kardex
// ---------------------------------------------------------------------------

describe('Kardex — quantity-only ledger with snapshot paging', () => {
  beforeEach(() => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: posterPermissions,
    });
  });

  it('asks for a scope before anything loads, then shows the running balance', async () => {
    const user = userEvent.setup();
    renderWithProviders(<KardexPage />, {
      initialEntries: ['/app/inventory/kardex'],
    });

    expect(
      await screen.findByText(t.inventory.kardexMissingScope),
    ).toBeInTheDocument();
    expect(inventoryApi.readInventoryKardex).not.toHaveBeenCalled();

    vi.mocked(inventoryApi.readInventoryKardex).mockResolvedValue(
      kardexResponse(),
    );
    await user.selectOptions(screen.getByLabelText(t.inventory.item), 'item-1');
    await user.selectOptions(
      screen.getByLabelText(t.inventory.warehouse),
      'wh-1',
    );

    const table = await screen.findByRole('table');
    // The signed quantity and the running balance are both 5 — quantity-only.
    expect(within(table).getAllByText('5')).not.toHaveLength(0);
    expect(inventoryApi.readInventoryKardex).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        itemId: 'item-1',
        warehouseId: 'wh-1',
        page: 1,
        pageSize: 50,
      }),
      expect.anything(),
    );
  });

  it('replays the page-1 snapshot unchanged on page 2', async () => {
    const user = userEvent.setup();
    vi.mocked(inventoryApi.readInventoryKardex).mockImplementation((query) => {
      const page = query.page ?? 1;
      expect(query.snapshot).toBe(page > 1 ? 'snap-1' : undefined);
      return Promise.resolve(
        kardexResponse({
          page,
          snapshot: page > 1 ? 'snap-2' : 'snap-1',
          items: [kardexRow({ movementId: `mv-${page}` })],
        }),
      );
    });
    renderWithProviders(<KardexPage />, {
      initialEntries: ['/app/inventory/kardex'],
    });

    const itemSelect = await screen.findByLabelText(t.inventory.item);
    await waitFor(() =>
      expect(within(itemSelect).getAllByRole('option').length).toBeGreaterThan(
        1,
      ),
    );
    await user.selectOptions(itemSelect, 'item-1');
    await user.selectOptions(
      screen.getByLabelText(t.inventory.warehouse),
      'wh-1',
    );

    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: t.table.next }));

    await waitFor(() =>
      expect(inventoryApi.readInventoryKardex).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2, snapshot: 'snap-1' }),
        expect.anything(),
      ),
    );
  });
});
