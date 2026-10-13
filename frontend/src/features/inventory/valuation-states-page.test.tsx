import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryValuationState } from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { paginated, testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { ValuationStatesPage } from './valuation-states-page';

/**
 * FE-UX-02 §8–§9 regression coverage for the valuation worklist.
 *
 * Covers the slice's key-level valuation contract: a key with no costed
 * stock shows «—» as its average (missing cost is NOT zero cost), a stale
 * key stays visible with its badge and «نامعتبر از» date, the recalculate
 * action is offered ONLY on stale keys and ONLY to sessions holding
 * `Inventory.Valuation.Recalculate`, and the command is the bounded
 * one-item-one-warehouse recalculation that invalidates the inventory
 * reads when it succeeds.
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
  PERMISSIONS.inventory.valuationView,
];

const recalcPermissions = [
  ...viewerPermissions,
  PERMISSIONS.inventory.valuationRecalculate,
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

function stateFixture(
  overrides: Partial<InventoryValuationState> = {},
): InventoryValuationState {
  return {
    id: 'vs-1',
    organizationId: 'org-1',
    branchId: 'br-1',
    warehouseId: 'wh-1',
    itemId: 'item-1',
    method: 'moving_weighted_average',
    valuedQuantity: '0',
    uncostedQuantity: '10',
    totalValue: '0',
    totalQuantity: '10',
    averageUnitCost: null,
    status: 'pending_cost',
    staleSince: null,
    lastValuedAt: null,
    lastRecalculationId: null,
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
    ...overrides,
  };
}

function recalculationResult(state: InventoryValuationState) {
  return {
    run: {
      id: 'run-1',
      organizationId: 'org-1',
      branchId: 'br-1',
      warehouseId: state.warehouseId,
      itemId: state.itemId,
      method: 'moving_weighted_average' as const,
      trigger: 'manual' as const,
      fromDate: null,
      movementsExamined: 4,
      movementsRevalued: 3,
      resultingValuedQuantity: '10',
      resultingUncostedQuantity: '0',
      resultingTotalValue: '2,500.00',
      resultingStatus: 'valued' as const,
      operationKey: 'op-run',
      reason: null,
      executedAt: '2026-04-05T09:00:00.000Z',
      createdAt: '2026-04-05T09:00:00.000Z',
      updatedAt: '2026-04-05T09:00:00.000Z',
    },
    state,
  };
}

function renderWorklist() {
  return renderWithProviders(<ValuationStatesPage />, {
    initialEntries: ['/app/inventory/valuation'],
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

describe('Valuation worklist — unvalued is never zero', () => {
  it('renders a cost-less key as «—» average, not «۰»', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: viewerPermissions,
    });
    vi.mocked(inventoryApi.listInventoryValuationStates).mockResolvedValue(
      paginated([stateFixture()]),
    );
    renderWorklist();

    const table = await screen.findByRole('table');
    const row = within(table).getAllByRole('row')[1] as HTMLElement;
    // The average of a cost-less key is «—» — never a (Persian) zero digit:
    // missing cost is not zero cost.
    expect(
      within(row).getByText(t.inventory.noAverageCost),
    ).toBeInTheDocument();
    expect(within(row).queryByText('۰')).not.toBeInTheDocument();
    expect(
      within(row).getByText(t.inventory.valuationStateStatuses.pending_cost),
    ).toBeInTheDocument();
  });
});

describe('Valuation worklist — stale keys and the bounded recalculate command', () => {
  it('keeps a stale key visible with its badge and offers recalculate only to permitted sessions', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: recalcPermissions,
    });
    const stale = stateFixture({
      status: 'stale',
      staleSince: '2026-04-02T10:00:00.000Z',
      valuedQuantity: '8',
      uncostedQuantity: '2',
      totalValue: '2,000.00',
      averageUnitCost: '250',
    });
    vi.mocked(inventoryApi.listInventoryValuationStates).mockResolvedValue(
      paginated([stale, stateFixture({ id: 'vs-2', status: 'valued' })]),
    );
    renderWorklist();

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    const staleRow = rows[1] as HTMLElement;
    expect(
      within(staleRow).getByText(t.inventory.valuationStateStatuses.stale),
    ).toBeInTheDocument();
    // «نامعتبر از» + the stale-since timestamp (text split across nodes).
    expect(
      within(staleRow).getByText(new RegExp(t.inventory.staleSince)),
    ).toBeInTheDocument();

    // Only the STALE row carries an action; the valued row does not.
    expect(
      within(staleRow).getByRole('button', {
        name: t.inventory.staleNoticeRecalculate,
      }),
    ).toBeInTheDocument();
    const valuedRow = rows[2] as HTMLElement;
    expect(
      within(valuedRow).queryByRole('button', {
        name: t.inventory.staleNoticeRecalculate,
      }),
    ).not.toBeInTheDocument();
  });

  it('shows no action column at all for sessions without Inventory.Valuation.Recalculate', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: viewerPermissions,
    });
    vi.mocked(inventoryApi.listInventoryValuationStates).mockResolvedValue(
      paginated([stateFixture({ status: 'stale' })]),
    );
    renderWorklist();

    const table = await screen.findByRole('table');
    expect(
      within(table).queryByRole('button', {
        name: t.inventory.staleNoticeRecalculate,
      }),
    ).not.toBeInTheDocument();
    expect(inventoryApi.recalculateInventoryValuation).not.toHaveBeenCalled();
  });

  it('runs the one-item-one-warehouse recalculation after an explicit confirm and invalidates the inventory reads', async () => {
    const user = userEvent.setup();
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: recalcPermissions,
    });
    const stale = stateFixture({
      status: 'stale',
      staleSince: '2026-04-02T10:00:00.000Z',
    });
    vi.mocked(inventoryApi.listInventoryValuationStates).mockResolvedValue(
      paginated([stale]),
    );
    vi.mocked(inventoryApi.recalculateInventoryValuation).mockResolvedValue(
      recalculationResult(
        stateFixture({
          status: 'valued',
          averageUnitCost: '250',
          valuedQuantity: '10',
          uncostedQuantity: '0',
          totalValue: '2,500.00',
        }),
      ),
    );
    const { queryClient } = renderWorklist();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const table = await screen.findByRole('table');
    await user.click(
      within(table).getByRole('button', {
        name: t.inventory.staleNoticeRecalculate,
      }),
    );

    // The command needs an explicit confirm — nothing fires on the row click.
    const dialog = await screen.findByRole('dialog');
    expect(inventoryApi.recalculateInventoryValuation).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole('button', {
        name: t.inventory.recalculateSubmit,
      }),
    );

    await waitFor(() =>
      expect(inventoryApi.recalculateInventoryValuation).toHaveBeenCalledTimes(
        1,
      ),
    );
    expect(
      vi.mocked(inventoryApi.recalculateInventoryValuation).mock.calls[0]?.[0],
    ).toMatchObject({
      organizationId: 'org-1',
      warehouseId: 'wh-1',
      itemId: 'item-1',
      trigger: 'manual',
    });
    // Success counts the revalued movements…
    expect(
      await screen.findByText(
        `${t.inventory.recalculationDone} 3 ${t.inventory.recalculationDoneCount}`,
      ),
    ).toBeInTheDocument();
    // …and refreshes the worklist (and the other inventory reads).
    await waitFor(() =>
      expect(
        invalidateSpy.mock.calls.some(
          (call) =>
            Array.isArray(call[0]?.queryKey) &&
            call[0]?.queryKey[0] === 'inventory' &&
            call[0]?.queryKey[1] === 'org-1' &&
            call[0]?.queryKey[2] === 'valuation-states',
        ),
      ).toBe(true),
    );
  });
});
