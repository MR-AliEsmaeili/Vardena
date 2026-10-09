import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import type { InventoryMovement } from '@/api/contracts';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { paginated, testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { MovementFormPage } from './movement-form-page';

/**
 * FE-UX-02 §8–§9 regression coverage for the receipt/issue posting form.
 *
 * Covers the slice's core posting contract: a receipt posts WITHOUT any
 * cost (OD-VAL-05), the cost input exists only for sessions holding
 * `Inventory.Valuation.AssignCost`, an issue never offers cost (OD-VAL-07),
 * an insufficient-stock refusal renders its canonical Persian copy with the
 * measured quantities, and backdating is the two-step explicit decision
 * (OD-VAL-10/11) ending in `backdateConfirmed` + the chosen `repricing` —
 * including the honest stale notice after «انجام نشود».
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
];

const costAssignerPermissions = [
  ...posterPermissions,
  PERMISSIONS.inventory.valuationAssignCost,
];

const valuationPermissions = [
  ...costAssignerPermissions,
  PERMISSIONS.inventory.valuationView,
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

async function mockReferences() {
  vi.mocked(inventoryApi.listInventoryWarehouses).mockResolvedValue(
    paginated([testWarehouse]),
  );
  vi.mocked(inventoryApi.listInventoryItems).mockResolvedValue(
    paginated([testItem]),
  );
  vi.mocked(inventoryApi.listInventoryUnits).mockResolvedValue(
    paginated([testUnit]),
  );
  vi.mocked(inventoryApi.checkInventoryBackdate).mockResolvedValue({
    backdated: false,
    movementDate: '2026-04-05',
    latestMovementDate: null,
    affectedMovements: 0,
    affectedValuedMovements: 0,
    alreadyStale: false,
    confirmationRequired: false,
    repricingChoiceRequired: false,
    code: null,
  });
}

function renderForm(type: 'receipt' | 'issue') {
  return renderWithProviders(<MovementFormPage />, {
    initialEntries: [`/app/inventory/movements/new?type=${type}`],
  });
}

/** Fill the shared fields of the posting form with valid values. */
async function fillMovement(
  user: ReturnType<typeof userEvent.setup>,
  overrides: { movementDate?: string } = {},
) {
  await user.selectOptions(
    await screen.findByLabelText(t.inventory.item),
    'item-1',
  );
  await user.selectOptions(
    screen.getByLabelText(t.inventory.warehouse),
    'wh-1',
  );
  await user.type(screen.getByLabelText(t.inventory.quantity), '5');
  await user.selectOptions(screen.getByLabelText(t.inventory.unit), 'unit-1');
  const dateInput = screen.getByLabelText(t.inventory.movementDate);
  await user.clear(dateInput);
  await user.type(dateInput, overrides.movementDate ?? '2026-04-05');
}
beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
});

describe('Movement form — cost is permission-gated and never required', () => {
  it('posts a receipt WITHOUT any cost when the session cannot assign one', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: posterPermissions,
    });
    await mockReferences();
    vi.mocked(inventoryApi.postInventoryMovement).mockResolvedValue(
      movementFixture(),
    );
    const user = userEvent.setup();
    renderForm('receipt');

    // No cost input at all without Inventory.Valuation.AssignCost.
    expect(
      screen.queryByLabelText(t.inventory.totalCost),
    ).not.toBeInTheDocument();

    await fillMovement(user);
    await user.click(
      screen.getByRole('button', { name: t.inventory.submitReceipt }),
    );

    await waitFor(() =>
      expect(inventoryApi.postInventoryMovement).toHaveBeenCalledTimes(1),
    );
    const [body] =
      vi.mocked(inventoryApi.postInventoryMovement).mock.calls[0] ?? [];
    expect(body).toMatchObject({
      organizationId: 'org-1',
      warehouseId: 'wh-1',
      itemId: 'item-1',
      movementType: 'inbound',
      quantity: '5',
      unitId: 'unit-1',
      movementDate: '2026-04-05',
    });
    expect('totalCost' in (body ?? {})).toBe(false);
    expect('backdateConfirmed' in (body ?? {})).toBe(false);
    expect(screen.getByText(t.inventory.receiptCreated)).toBeInTheDocument();
  });

  it('shows the optional cost input only for sessions with Inventory.Valuation.AssignCost', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: costAssignerPermissions,
    });
    await mockReferences();
    vi.mocked(inventoryApi.postInventoryMovement).mockResolvedValue(
      movementFixture({ totalCost: '1,250.00' }),
    );
    const user = userEvent.setup();
    renderForm('receipt');

    const costInput = await screen.findByLabelText(t.inventory.totalCost);
    // The receipt still posts with the field left EMPTY — cost is optional.
    await fillMovement(user);
    await user.click(
      screen.getByRole('button', { name: t.inventory.submitReceipt }),
    );

    await waitFor(() =>
      expect(inventoryApi.postInventoryMovement).toHaveBeenCalledTimes(1),
    );
    const [body] =
      vi.mocked(inventoryApi.postInventoryMovement).mock.calls[0] ?? [];
    expect('totalCost' in (body ?? {})).toBe(false);
    expect(costInput).toBeInTheDocument();
  });

  it('never renders a cost input on an issue — even for a cost assigner', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: valuationPermissions,
    });
    await mockReferences();
    vi.mocked(inventoryApi.postInventoryMovement).mockResolvedValue(
      movementFixture({ movementType: 'outbound' }),
    );
    const user = userEvent.setup();
    renderForm('issue');

    await fillMovement(user);
    expect(
      screen.queryByLabelText(t.inventory.totalCost),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: t.inventory.submitIssue }),
    );

    await waitFor(() =>
      expect(inventoryApi.postInventoryMovement).toHaveBeenCalledTimes(1),
    );
    const [body] =
      vi.mocked(inventoryApi.postInventoryMovement).mock.calls[0] ?? [];
    expect(body).toMatchObject({ movementType: 'outbound' });
    expect('totalCost' in (body ?? {})).toBe(false);
    expect(screen.getByText(t.inventory.issueCreated)).toBeInTheDocument();
  });
});

describe('Movement form — business refusals', () => {
  it('renders the canonical insufficient-stock copy with the measured quantities, never the raw backend message', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: posterPermissions,
    });
    await mockReferences();
    vi.mocked(inventoryApi.postInventoryMovement).mockRejectedValue(
      new ApiError({
        code: 'BusinessRuleViolation',
        message: 'Insufficient stock in warehouse "WH-01" (raw, never shown)',
        status: 422,
        details: {
          code: 'inventory.insufficient_stock',
          onHand: '2.0000',
          requested: '5.0000',
        },
      }),
    );
    const user = userEvent.setup();
    renderForm('issue');

    await fillMovement(user);
    await user.click(
      screen.getByRole('button', { name: t.inventory.submitIssue }),
    );

    expect(
      await screen.findByText(
        `${t.inventory.errors.insufficientStock} ${t.inventory.errors.insufficientStockNumbers
          .replace('{onHand}', '2.0000')
          .replace('{requested}', '5.0000')}`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/raw, never shown/)).not.toBeInTheDocument();
  });
});

describe('Movement form — the two-step backdate decision (OD-VAL-10/11)', () => {
  beforeEach(async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: valuationPermissions,
    });
    await mockReferences();
  });

  it('warns before posting, takes an explicit choice with no default, and resubmits with backdateConfirmed + repricing', async () => {
    vi.mocked(inventoryApi.checkInventoryBackdate).mockResolvedValue({
      backdated: true,
      movementDate: '2026-03-01',
      latestMovementDate: '2026-04-01',
      affectedMovements: 3,
      affectedValuedMovements: 2,
      alreadyStale: false,
      confirmationRequired: true,
      repricingChoiceRequired: true,
      code: null,
    });
    vi.mocked(inventoryApi.postInventoryMovement).mockResolvedValue(
      movementFixture(),
    );
    const user = userEvent.setup();
    renderForm('receipt');

    await fillMovement(user, { movementDate: '2026-03-01' });
    await user.click(
      screen.getByRole('button', { name: t.inventory.submitReceipt }),
    );

    // Step 1: the measured consequence, before anything is posted.
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(t.inventory.backdateStep1Title),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        t.inventory.backdateStep1Body
          .replace('{affectedMovements}', '3')
          .replace('{affectedValuedMovements}', '2'),
      ),
    ).toBeInTheDocument();
    expect(inventoryApi.postInventoryMovement).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole('button', {
        name: t.inventory.backdateStep1Continue,
      }),
    );

    // Step 2: no default — submit stays disabled until an explicit choice.
    const step2 = screen.getByRole('dialog');
    const submit = within(step2).getByRole('button', {
      name: t.inventory.backdateStep2Submit,
    });
    expect(submit).toBeDisabled();
    await user.click(
      within(step2).getByRole('radio', {
        name: t.inventory.backdateStep2Recalculate,
      }),
    );
    expect(submit).toBeEnabled();
    await user.click(submit);

    // The resubmission carries the explicit decisions.
    await waitFor(() =>
      expect(inventoryApi.postInventoryMovement).toHaveBeenCalledTimes(1),
    );
    const [body] =
      vi.mocked(inventoryApi.postInventoryMovement).mock.calls[0] ?? [];
    expect(body).toMatchObject({
      movementDate: '2026-03-01',
      backdateConfirmed: true,
      repricing: 'recalculate',
    });
    expect(screen.getByText(t.inventory.receiptCreated)).toBeInTheDocument();
  });

  it('keeps an honest stale notice after «انجام نشود» and lets a permitted session recalculate later', async () => {
    vi.mocked(inventoryApi.checkInventoryBackdate).mockResolvedValue({
      backdated: true,
      movementDate: '2026-03-01',
      latestMovementDate: '2026-04-01',
      affectedMovements: 3,
      affectedValuedMovements: 2,
      alreadyStale: false,
      confirmationRequired: true,
      repricingChoiceRequired: true,
      code: null,
    });
    vi.mocked(inventoryApi.postInventoryMovement).mockResolvedValue(
      movementFixture(),
    );
    vi.mocked(inventoryApi.recalculateInventoryValuation).mockResolvedValue({
      run: {
        id: 'run-1',
        organizationId: 'org-1',
        branchId: 'br-1',
        warehouseId: 'wh-1',
        itemId: 'item-1',
        method: 'moving_weighted_average',
        trigger: 'manual',
        fromDate: null,
        movementsExamined: 4,
        movementsRevalued: 3,
        resultingValuedQuantity: '10',
        resultingUncostedQuantity: '0',
        resultingTotalValue: '2,500.00',
        resultingStatus: 'valued',
        operationKey: 'op-run',
        reason: null,
        executedAt: '2026-04-05T09:00:00.000Z',
        createdAt: '2026-04-05T09:00:00.000Z',
        updatedAt: '2026-04-05T09:00:00.000Z',
      },
      state: {
        id: 'vs-1',
        organizationId: 'org-1',
        branchId: 'br-1',
        warehouseId: 'wh-1',
        itemId: 'item-1',
        method: 'moving_weighted_average',
        valuedQuantity: '10',
        uncostedQuantity: '0',
        totalValue: '2,500.00',
        totalQuantity: '10',
        averageUnitCost: '250',
        status: 'valued',
        staleSince: null,
        lastValuedAt: null,
        lastRecalculationId: null,
        createdAt: '2026-01-01T08:00:00.000Z',
        updatedAt: '2026-04-05T09:00:00.000Z',
      },
    });
    const user = userEvent.setup();
    renderForm('receipt');

    await fillMovement(user, { movementDate: '2026-03-01' });
    await user.click(
      screen.getByRole('button', { name: t.inventory.submitReceipt }),
    );

    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', {
        name: t.inventory.backdateStep1Continue,
      }),
    );
    const step2 = screen.getByRole('dialog');
    await user.click(
      within(step2).getByRole('radio', { name: t.inventory.backdateStep2Skip }),
    );
    await user.click(
      within(step2).getByRole('button', {
        name: t.inventory.backdateStep2Submit,
      }),
    );

    // Posted with the skip decision, and the stale notice is honest.
    await waitFor(() =>
      expect(inventoryApi.postInventoryMovement).toHaveBeenCalledWith(
        expect.objectContaining({
          backdateConfirmed: true,
          repricing: 'skip',
        }),
      ),
    );
    expect(
      await screen.findByText(t.inventory.staleNoticeTitle),
    ).toBeInTheDocument();
    expect(screen.getByText(t.inventory.staleNoticeBody)).toBeInTheDocument();

    // The notice's قیمت‌گذاری مجدد opens the confirm dialog and the command
    // is bounded to this one item and warehouse.
    await user.click(
      screen.getByRole('button', { name: t.inventory.staleNoticeRecalculate }),
    );
    const confirm = await screen.findByRole('dialog');
    await user.click(
      within(confirm).getByRole('button', {
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
    // Success feedback counts the revalued movements and clears the notice.
    expect(
      await screen.findByText(
        `${t.inventory.recalculationDone} 3 ${t.inventory.recalculationDoneCount}`,
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByText(t.inventory.staleNoticeTitle),
      ).not.toBeInTheDocument(),
    );
  });

  it('disables the notice recalculate action for a session without Inventory.Valuation.Recalculate', async () => {
    // A poster who can assign cost but NOT recalculate (permission denial).
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: costAssignerPermissions,
    });
    vi.mocked(inventoryApi.checkInventoryBackdate).mockResolvedValue({
      backdated: true,
      movementDate: '2026-03-01',
      latestMovementDate: '2026-04-01',
      affectedMovements: 3,
      affectedValuedMovements: 2,
      alreadyStale: false,
      confirmationRequired: true,
      repricingChoiceRequired: true,
      code: null,
    });
    vi.mocked(inventoryApi.postInventoryMovement).mockResolvedValue(
      movementFixture(),
    );
    const user = userEvent.setup();
    renderForm('receipt');

    await fillMovement(user, { movementDate: '2026-03-01' });
    await user.click(
      screen.getByRole('button', { name: t.inventory.submitReceipt }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', {
        name: t.inventory.backdateStep1Continue,
      }),
    );
    const step2 = screen.getByRole('dialog');
    await user.click(
      within(step2).getByRole('radio', { name: t.inventory.backdateStep2Skip }),
    );
    await user.click(
      within(step2).getByRole('button', {
        name: t.inventory.backdateStep2Submit,
      }),
    );

    const recalculateButton = await screen.findByRole('button', {
      name: t.inventory.staleNoticeRecalculate,
    });
    expect(recalculateButton).toBeDisabled();
    expect(recalculateButton).toHaveAttribute(
      'title',
      t.inventory.errors.recalculatePermission,
    );
    expect(inventoryApi.recalculateInventoryValuation).not.toHaveBeenCalled();
  });

  it('re-opens the dialogs (not a raw error) when the POST itself refuses backdating after a benign check', async () => {
    // The check says "not backdated" (e.g. a concurrent posting raced it),
    // but the transactional POST gate catches it — the refusal is handled
    // by the same two-step flow, never rendered raw.
    vi.mocked(inventoryApi.postInventoryMovement).mockRejectedValueOnce(
      new ApiError({
        code: 'BusinessRuleViolation',
        message: 'Backdated document refused (contract text, never shown)',
        status: 422,
        details: {
          code: 'inventory.backdated_document',
          movementDate: '2026-03-01',
          latestMovementDate: '2026-04-01',
          affectedMovements: 3,
          affectedValuedMovements: 2,
          alreadyStale: false,
          repricingChoices: ['recalculate', 'skip'],
        },
      }),
    );
    vi.mocked(inventoryApi.postInventoryMovement).mockResolvedValueOnce(
      movementFixture(),
    );
    const user = userEvent.setup();
    renderForm('receipt');

    await fillMovement(user, { movementDate: '2026-03-01' });
    await user.click(
      screen.getByRole('button', { name: t.inventory.submitReceipt }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(t.inventory.backdateStep1Title),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/contract text, never shown/),
    ).not.toBeInTheDocument();
  });
});

describe('Movement form — cache invalidation after a posting', () => {
  it('invalidates the inventory reads of this organization after a successful post', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: posterPermissions,
    });
    await mockReferences();
    vi.mocked(inventoryApi.postInventoryMovement).mockResolvedValue(
      movementFixture(),
    );
    const user = userEvent.setup();
    const { queryClient } = renderForm('receipt');

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    await fillMovement(user);
    await user.click(
      screen.getByRole('button', { name: t.inventory.submitReceipt }),
    );

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (call) => call[0]?.queryKey,
    );
    // The movement ledger (and the other inventory reads) of THIS org are
    // refreshed — targeted invalidation, nothing global.
    expect(
      invalidatedKeys.some(
        (key) =>
          Array.isArray(key) &&
          key[0] === 'inventory' &&
          key[1] === 'org-1' &&
          key[2] === 'movements',
      ),
    ).toBe(true);
  });
});
