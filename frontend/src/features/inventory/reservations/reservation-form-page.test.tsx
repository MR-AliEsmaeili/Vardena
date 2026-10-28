import { ApiError } from '@/api/errors';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { t } from '@/lib/i18n';
import { paginated, testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { useOrganizationId } from '@/features/organization/use-organization';
import { ReservationFormPage } from './reservation-form-page';

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
  createReservation: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const inventoryApi = await import('@/api/inventory.api');

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

function renderForm() {
  return renderWithProviders(<ReservationFormPage />, {
    initialEntries: ['/app/inventory/reservations/new'],
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
  vi.mocked(inventoryApi.createReservation).mockResolvedValue({
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
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(
    await screen.findByLabelText(t.inventory.warehouse),
    'wh-1',
  );
  await user.selectOptions(
    await screen.findByLabelText(t.inventory.item),
    'item-1',
  );
  await user.type(await screen.findByLabelText(t.reservations.quantity), '5');
  await user.selectOptions(
    await screen.findByLabelText(t.reservations.unit),
    'unit-1',
  );
}

describe('Reservation form — submission', () => {
  it('sends the exact body with string quantity and an operationKey', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillValidForm(user);
    await user.click(
      screen.getByRole('button', { name: t.inventoryMaster.create }),
    );

    await waitFor(() => {
      expect(inventoryApi.createReservation).toHaveBeenCalledWith({
        organizationId: 'org-1',
        warehouseId: 'wh-1',
        itemId: 'item-1',
        quantity: '5',
        unitId: 'unit-1',
        operationKey: expect.any(String),
      });
    });
    await screen.findByText(t.reservations.created);
  });

  it('keeps the same operationKey across a manual retry after a failure', async () => {
    const user = userEvent.setup();
    vi.mocked(inventoryApi.createReservation).mockRejectedValueOnce(
      new ApiError({
        code: 'BusinessRuleViolation',
        message:
          'Insufficient available stock in warehouse "WH-01": available 5, requested 10.',
        status: 422,
      }),
    );
    renderForm();
    await fillValidForm(user);
    await user.click(
      screen.getByRole('button', { name: t.inventoryMaster.create }),
    );
    await waitFor(() => {
      expect(
        screen.getByText(
          'Insufficient available stock in warehouse "WH-01": available 5, requested 10.',
        ),
      ).toBeInTheDocument();
    });
    // Second attempt with the same intent reuses the key.
    await user.click(
      screen.getByRole('button', { name: t.inventoryMaster.create }),
    );
    await waitFor(() => {
      expect(inventoryApi.createReservation).toHaveBeenCalledTimes(2);
    });
    const calls = vi.mocked(inventoryApi.createReservation).mock.calls;
    expect(calls[0]![0]!.operationKey).toBe(calls[1]![0]!.operationKey);
  });

  it('rejects referenceType without referenceId without calling the API', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillValidForm(user);
    await user.type(
      screen.getByLabelText(t.reservations.referenceTypeLabel),
      'material_request_line',
    );
    await user.click(
      screen.getByRole('button', { name: t.inventoryMaster.create }),
    );
    expect(inventoryApi.createReservation).not.toHaveBeenCalled();
    expect(
      screen.getAllByText(t.reservations.errors.referencePairHint).length,
    ).toBeGreaterThan(0);
  });

  it('renders no date field', () => {
    renderForm();
    expect(
      screen.queryByLabelText(t.inventory.movementDate),
    ).not.toBeInTheDocument();
  });

  it('shows the verbatim server message for insufficient stock (422)', async () => {
    const user = userEvent.setup();
    vi.mocked(inventoryApi.createReservation).mockRejectedValueOnce(
      new ApiError({
        code: 'BusinessRuleViolation',
        message:
          'Insufficient available stock in warehouse "WH-01": available 5, requested 10.',
        status: 422,
      }),
    );
    renderForm();
    await fillValidForm(user);
    await user.click(
      screen.getByRole('button', { name: t.inventoryMaster.create }),
    );
    await waitFor(() => {
      expect(
        screen.getByText(
          'Insufficient available stock in warehouse "WH-01": available 5, requested 10.',
        ),
      ).toBeInTheDocument();
    });
  });

  it('shows the operationKey-reuse message for conflict (409)', async () => {
    const user = userEvent.setup();
    vi.mocked(inventoryApi.createReservation).mockRejectedValueOnce(
      new ApiError({
        code: 'Conflict',
        message:
          'This operationKey was already used with a different request. Retry with the original request, or use a new key.',
        status: 409,
      }),
    );
    renderForm();
    await fillValidForm(user);
    await user.click(
      screen.getByRole('button', { name: t.inventoryMaster.create }),
    );
    await waitFor(() => {
      expect(
        screen.getByText(t.reservations.errors.operationKeyReused),
      ).toBeInTheDocument();
    });
  });
});
