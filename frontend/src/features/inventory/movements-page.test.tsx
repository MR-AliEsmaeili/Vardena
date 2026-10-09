import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryMovement } from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { paginated, testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { MovementsPage } from './movements-page';

/**
 * FE-UX-02 §8–§9 regression coverage for the movements workspace.
 *
 * Covers the valuation-vocabulary rules of the ledger table: the valuation
 * STATUS is always visible (a stale/provisional movement is never presented
 * as priced), an unvalued movement's value reads «—» and NEVER «۰», the
 * money column exists only for sessions holding
 * `Inventory.Valuation.View`, and the posting CTAs exist only for sessions
 * holding `Inventory.Movement.Create`.
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

const viewerPermissions = [
  PERMISSIONS.organization.view,
  PERMISSIONS.inventory.warehouseView,
  PERMISSIONS.inventory.itemView,
  PERMISSIONS.inventory.unitView,
  PERMISSIONS.inventory.movementView,
];

const valuerPermissions = [
  ...viewerPermissions,
  PERMISSIONS.inventory.valuationView,
];

const testWarehouse = {
  id: 'wh-1',
  organizationId: 'org-1',
  branchId: 'br-1',
  code: 'WH-01',
  name: 'انبار مرکزی',
  allowNegativeStock: false,
  reservationsReduceAvailable: false,
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

function movementFixture(
  overrides: Partial<InventoryMovement> = {},
): InventoryMovement {
  return {
    id: 'mv-1',
    organizationId: 'org-1',
    branchId: 'br-1',
    warehouseId: 'wh-1',
    itemId: 'item-1',
    movementType: 'inbound',
    quantity: '5',
    enteredUnitId: 'unit-1',
    baseQuantity: '5',
    baseUnitId: 'unit-1',
    conversionFactor: '1',
    movementDate: '2026-04-05',
    transferId: null,
    reversalOfMovementId: null,
    referenceType: null,
    referenceId: null,
    reason: null,
    operationKey: 'op-1',
    totalCost: null,
    valuationStatus: 'unvalued',
    valuationSource: null,
    valuedAt: null,
    valuationRunId: null,
    createdAt: '2026-04-05T08:00:00.000Z',
    updatedAt: '2026-04-05T08:00:00.000Z',
    ...overrides,
  };
}

function renderList() {
  return renderWithProviders(<MovementsPage />, {
    initialEntries: ['/app/inventory/movements'],
  });
}

beforeEach(() => {
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

describe('Movements list — valuation vocabulary', () => {
  it('shows an unvalued movement as «—» (never «۰») and keeps the status visible without the money permission', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: valuerPermissions,
    });
    vi.mocked(inventoryApi.listInventoryMovements).mockResolvedValue(
      paginated([
        movementFixture({ valuationStatus: 'unvalued', totalCost: null }),
        movementFixture({
          id: 'mv-2',
          movementType: 'outbound',
          valuationStatus: 'valued',
          totalCost: '1,250.00',
        }),
      ]),
    );
    renderList();

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    // Row of the unvalued receipt: «—» in the value column, and the
    // valuation STATUS is labeled honestly.
    expect(
      within(rows[1] as HTMLElement).getByText(
        t.inventory.valuationStatuses.unvalued,
      ),
    ).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByText(t.inventory.noValue),
    ).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).queryByText('0'),
    ).not.toBeInTheDocument();

    // Row of the valued issue: the backend's own amount, digit-for-digit.
    expect(
      within(rows[2] as HTMLElement).getByText('1,250.00'),
    ).toBeInTheDocument();
    expect(
      within(rows[2] as HTMLElement).getByText(
        t.inventory.valuationStatuses.valued,
      ),
    ).toBeInTheDocument();
  });

  it('renders a stale movement with its warning badge (status is never hidden)', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: valuerPermissions,
    });
    vi.mocked(inventoryApi.listInventoryMovements).mockResolvedValue(
      paginated([
        movementFixture({ valuationStatus: 'provisional', totalCost: '900' }),
      ]),
    );
    renderList();

    const table = await screen.findByRole('table');
    expect(
      within(table).getByText(t.inventory.valuationStatuses.provisional),
    ).toBeInTheDocument();
  });

  it('hides the money column entirely for sessions without Inventory.Valuation.View', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: viewerPermissions,
    });
    vi.mocked(inventoryApi.listInventoryMovements).mockResolvedValue(
      paginated([movementFixture()]),
    );
    renderList();

    const table = await screen.findByRole('table');
    expect(
      within(table).queryByText(t.inventory.columnTotalCost),
    ).not.toBeInTheDocument();
    // The status column stays — it is not money.
    expect(
      within(table).getByText(t.inventory.columnValuationStatus),
    ).toBeInTheDocument();
    expect(
      within(table).getByText(t.inventory.valuationStatuses.unvalued),
    ).toBeInTheDocument();
  });
});

describe('Movements list — permission-gated actions and first-use state', () => {
  it('offers posting CTAs only to sessions with Inventory.Movement.Create', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [...viewerPermissions, PERMISSIONS.inventory.movementCreate],
    });
    vi.mocked(inventoryApi.listInventoryMovements).mockResolvedValue(
      paginated([]),
    );
    renderList();

    expect(
      await screen.findByRole('link', {
        name: new RegExp(t.inventory.newReceipt),
      }),
    ).toHaveAttribute('href', '/app/inventory/movements/new?type=receipt');
    expect(
      screen.getByRole('link', { name: new RegExp(t.inventory.newIssue) }),
    ).toHaveAttribute('href', '/app/inventory/movements/new?type=issue');
  });

  it('renders the first-use empty state without posting CTAs for a view-only session', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: viewerPermissions,
    });
    vi.mocked(inventoryApi.listInventoryMovements).mockResolvedValue(
      paginated([]),
    );
    renderList();

    // Empty title AND description both carry the first-use copy.
    expect(
      await screen.findAllByText(t.inventory.movementsEmptyFirstUse),
    ).not.toHaveLength(0);
    expect(
      screen.queryByRole('link', { name: new RegExp(t.inventory.newReceipt) }),
    ).not.toBeInTheDocument();
  });

  it('loads with the endpoint defaults (page size 50, newest movement first)', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: viewerPermissions,
    });
    vi.mocked(inventoryApi.listInventoryMovements).mockResolvedValue(
      paginated([]),
    );
    renderList();

    await screen.findAllByText(t.inventory.movementsEmptyFirstUse);
    expect(inventoryApi.listInventoryMovements).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        page: 1,
        pageSize: 50,
        sort: 'movementDate:desc',
      }),
      expect.anything(),
    );
  });
});

describe('Movements list — user event sanity', () => {
  it('applies the movement-type filter and restarts at page 1', async () => {
    const user = userEvent.setup();
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: viewerPermissions,
    });
    vi.mocked(inventoryApi.listInventoryMovements).mockResolvedValue(
      paginated([]),
    );
    renderList();

    const typeSelect = await screen.findByLabelText(
      t.inventory.movementTypeFilter,
    );
    await user.selectOptions(typeSelect, 'outbound');
    await user.click(screen.getByRole('button', { name: t.app.apply }));

    await waitFor(() =>
      expect(inventoryApi.listInventoryMovements).toHaveBeenLastCalledWith(
        expect.objectContaining({
          movementType: 'outbound',
          page: 1,
        }),
        expect.anything(),
      ),
    );
  });
});
