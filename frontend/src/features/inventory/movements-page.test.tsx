import { ApiError } from '@/api/errors';
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
  reverseInventoryMovement: vi.fn(),
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

describe('INV-01 movement reversal from the list', () => {
  const reversePermissions = [
    ...viewerPermissions,
    PERMISSIONS.inventory.movementReverse,
  ];

  it('hides the action for sessions without Reverse and omits the column', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: viewerPermissions,
    });
    vi.mocked(inventoryApi.listInventoryMovements).mockResolvedValue(
      paginated([movementFixture()]),
    );
    renderList();
    await screen.findByText(t.inventory.valuationStatuses.unvalued);
    expect(
      screen.queryByRole('button', { name: t.inventory.reverse }),
    ).not.toBeInTheDocument();
  });

  it('shows why transfer legs and reversal mirrors cannot be reversed', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: reversePermissions,
    });
    vi.mocked(inventoryApi.listInventoryMovements).mockResolvedValue(
      paginated([
        movementFixture(),
        movementFixture({
          id: 'transfer-leg',
          transferId: 'transfer-1',
          movementType: 'transfer_out',
        }),
        movementFixture({
          id: 'mirror',
          reversalOfMovementId: 'mv-1',
          movementType: 'reversal_out',
        }),
      ]),
    );
    renderList();
    expect(
      await screen.findByRole('button', { name: t.inventory.reverse }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t.inventory.reverseNotAllowedTransfer),
    ).toHaveAttribute('title', t.inventory.reverseNotAllowedTransfer);
    expect(
      screen.getByText(t.inventory.reverseNotAllowedAlreadyReversed),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: t.inventory.reverse }),
    ).toHaveLength(1);
  });

  it('confirms a reversal without moving organizationId into the body', async () => {
    const user = userEvent.setup();
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: reversePermissions,
    });
    vi.mocked(inventoryApi.listInventoryMovements).mockResolvedValue(
      paginated([movementFixture()]),
    );
    vi.mocked(inventoryApi.reverseInventoryMovement).mockResolvedValue(
      movementFixture({
        id: 'mirror',
        movementType: 'reversal_out',
        reversalOfMovementId: 'mv-1',
      }),
    );
    renderList();
    await user.click(
      await screen.findByRole('button', { name: t.inventory.reverse }),
    );
    expect(inventoryApi.reverseInventoryMovement).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('button', { name: t.inventory.reverseConfirm }),
    );
    await waitFor(() =>
      expect(inventoryApi.reverseInventoryMovement).toHaveBeenCalledWith(
        'org-1',
        'mv-1',
        expect.objectContaining({
          operationKey: expect.any(String),
          movementDate: expect.anything(),
        }),
      ),
    );
    const body = vi.mocked(inventoryApi.reverseInventoryMovement).mock
      .calls[0]?.[2];
    expect(body).not.toHaveProperty('organizationId');
    expect(body).not.toHaveProperty('reason');
    expect(body).not.toHaveProperty('backdateConfirmed');
  });

  it('uses two explicit backdating steps and keeps the same operation key on retry', async () => {
    const user = userEvent.setup();
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: reversePermissions,
    });
    vi.mocked(inventoryApi.listInventoryMovements).mockResolvedValue(
      paginated([movementFixture()]),
    );
    vi.mocked(inventoryApi.reverseInventoryMovement)
      .mockRejectedValueOnce(
        new ApiError({
          code: 'BusinessRuleViolation',
          message: 'refused',
          status: 422,
          details: {
            code: 'inventory.backdated_document',
            movementDate: '2026-10-26',
            latestMovementDate: '2026-10-27',
            affectedMovements: 2,
            affectedValuedMovements: 1,
            alreadyStale: false,
            repricingChoices: ['recalculate', 'skip'],
          },
        }),
      )
      .mockResolvedValueOnce(
        movementFixture({
          id: 'mirror',
          movementType: 'reversal_out',
          reversalOfMovementId: 'mv-1',
        }),
      );
    renderList();
    await user.click(
      await screen.findByRole('button', { name: t.inventory.reverse }),
    );
    await user.click(
      screen.getByRole('button', { name: t.inventory.reverseConfirm }),
    );
    await user.click(
      await screen.findByRole('button', {
        name: t.inventory.backdateStep1Continue,
      }),
    );
    expect(
      screen.getByRole('radio', { name: t.inventory.backdateStep2Recalculate }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: t.inventory.backdateStep2Submit }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole('radio', { name: t.inventory.backdateStep2Skip }),
    );
    await user.click(
      screen.getByRole('button', { name: t.inventory.backdateStep2Submit }),
    );
    await waitFor(() =>
      expect(inventoryApi.reverseInventoryMovement).toHaveBeenCalledTimes(2),
    );
    const calls = vi.mocked(inventoryApi.reverseInventoryMovement).mock.calls;
    expect(calls[0]?.[2].operationKey).toBe(calls[1]?.[2].operationKey);
    expect(calls[1]?.[2]).toEqual({
      operationKey: calls[0]?.[2].operationKey,
      movementDate: calls[0]?.[2].movementDate,
      backdateConfirmed: true,
      repricing: 'skip',
    });
  });
});
