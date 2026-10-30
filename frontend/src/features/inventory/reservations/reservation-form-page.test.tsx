import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { ReservationFormPage } from './reservation-form-page';
import {
  reservation,
  reservationAlternateUnit,
  reservationItem,
  reservationUnit,
  reservationWarehouse,
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
vi.mock('@/api/inventory-master.api', () => ({
  resolveUnitConversion: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const inventoryApi = await import('@/api/inventory.api');
const inventoryMasterApi = await import('@/api/inventory-master.api');

const createPermissions = [
  PERMISSIONS.organization.view,
  PERMISSIONS.inventory.reservationCreate,
  PERMISSIONS.inventory.warehouseView,
  PERMISSIONS.inventory.itemView,
  PERMISSIONS.inventory.unitView,
  PERMISSIONS.inventory.unitConversionView,
];

function renderForm() {
  return renderWithProviders(<ReservationFormPage />, {
    initialEntries: ['/app/inventory/reservations/new'],
  });
}

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(
    await screen.findByLabelText(t.reservations.warehouse),
    'wh-1',
  );
  await user.selectOptions(
    screen.getByLabelText(t.reservations.item),
    'item-1',
  );
  await user.clear(screen.getByLabelText(t.reservations.quantity));
  await user.type(screen.getByLabelText(t.reservations.quantity), '2.5000');
  await user.selectOptions(
    screen.getByLabelText(t.reservations.unit),
    'unit-1',
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: createPermissions,
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
});

describe('reservation create form', () => {
  it('posts the exact string quantity and operation key in the body, without a date field', async () => {
    vi.mocked(inventoryApi.createReservation).mockResolvedValue(
      reservation({ id: 'res-created' }),
    );
    const user = userEvent.setup();
    renderForm();
    await fillForm(user);
    await user.type(
      screen.getByLabelText(t.reservations.reason),
      '  برنامهٔ سفارش  ',
    );
    await user.type(
      screen.getByLabelText(t.reservations.referenceType),
      'external_order',
    );
    await user.type(screen.getByLabelText(t.reservations.referenceId), 'ORD-7');

    expect(
      screen.queryByLabelText(t.inventory.movementDate),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: t.reservations.newReservation }),
    );

    await waitFor(() =>
      expect(inventoryApi.createReservation).toHaveBeenCalledTimes(1),
    );
    const [body] =
      vi.mocked(inventoryApi.createReservation).mock.calls[0] ?? [];
    expect(body).toMatchObject({
      organizationId: 'org-1',
      warehouseId: 'wh-1',
      itemId: 'item-1',
      quantity: '2.5000',
      unitId: 'unit-1',
      reason: 'برنامهٔ سفارش',
      referenceType: 'external_order',
      referenceId: 'ORD-7',
      operationKey: expect.any(String),
    });
    expect(body).not.toHaveProperty('businessDate');
    expect(typeof body?.quantity).toBe('string');
    expect(
      await screen.findByText(t.reservations.createdSuccess),
    ).toBeInTheDocument();
  });

  it('reuses the same operation key on a manual retry with unchanged intent', async () => {
    vi.mocked(inventoryApi.createReservation)
      .mockRejectedValueOnce(
        new ApiError({ code: 'NetworkError', message: t.errors.network }),
      )
      .mockResolvedValueOnce(reservation({ id: 'res-retried' }));
    const user = userEvent.setup();
    renderForm();
    await fillForm(user);

    const submit = screen.getByRole('button', {
      name: t.reservations.newReservation,
    });
    await user.click(submit);
    expect(await screen.findByText(t.errors.network)).toBeInTheDocument();
    await user.click(submit);

    await waitFor(() =>
      expect(inventoryApi.createReservation).toHaveBeenCalledTimes(2),
    );
    const calls = vi.mocked(inventoryApi.createReservation).mock.calls;
    expect(calls[0]?.[0].operationKey).toBe(calls[1]?.[0].operationKey);
  });

  it('rejects a lone reference type before sending a request', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillForm(user);
    await user.type(
      screen.getByLabelText(t.reservations.referenceType),
      'external_order',
    );
    await user.click(
      screen.getByRole('button', { name: t.reservations.newReservation }),
    );

    expect(
      await screen.findByTestId('reservation-error-summary'),
    ).toHaveTextContent(t.reservations.referencePairHint);
    expect(inventoryApi.createReservation).not.toHaveBeenCalled();
  });

  it('reserves the Material Request owner discriminator for its lifecycle instead of creating an un-releasable generic claim', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillForm(user);
    await user.type(
      screen.getByLabelText(t.reservations.referenceType),
      'material_request_line',
    );
    await user.type(
      screen.getByLabelText(t.reservations.referenceId),
      'line-1',
    );
    await user.click(
      screen.getByRole('button', { name: t.reservations.newReservation }),
    );

    expect(
      await screen.findByTestId('reservation-error-summary'),
    ).toHaveTextContent(t.reservations.materialRequestReferenceReserved);
    expect(inventoryApi.createReservation).not.toHaveBeenCalled();
  });

  it('localizes insufficient availability and preserves the exact server decimals', async () => {
    vi.mocked(inventoryApi.createReservation).mockRejectedValueOnce(
      new ApiError({
        code: 'BusinessRuleViolation',
        message:
          'Insufficient available stock in warehouse "WH-01": available 1.2500, requested 2.5000.',
      }),
    );
    const user = userEvent.setup();
    renderForm();
    await fillForm(user);
    await user.click(
      screen.getByRole('button', { name: t.reservations.newReservation }),
    );

    expect(
      await screen.findByText(
        t.reservations.errors.insufficientStock
          .replace('{warehouse}', 'WH-01')
          .replace('{available}', '1.2500')
          .replace('{requested}', '2.5000'),
      ),
    ).toBeInTheDocument();
  });

  it('lets the backend decide a non-base unit conversion for its current business day', async () => {
    vi.mocked(inventoryApi.listInventoryUnits).mockResolvedValue({
      items: [reservationUnit, reservationAlternateUnit],
      total: 2,
      page: 1,
      pageSize: 500,
    });
    vi.mocked(inventoryApi.createReservation).mockRejectedValueOnce(
      new ApiError({
        code: 'BusinessRuleViolation',
        message:
          'No unit conversion from the entered unit to the base unit covers 2026-10-26. Configure the conversion (in the entered → base direction) before posting.',
      }),
    );
    const user = userEvent.setup();
    renderForm();
    await fillForm(user);
    await user.selectOptions(
      screen.getByLabelText(t.reservations.unit),
      'unit-2',
    );
    await user.click(
      screen.getByRole('button', { name: t.reservations.newReservation }),
    );

    expect(
      await screen.findByText(t.reservations.conversionUnavailable),
    ).toBeInTheDocument();
    expect(inventoryApi.createReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        unitId: 'unit-2',
        quantity: '2.5000',
      }),
    );
    expect(inventoryMasterApi.resolveUnitConversion).not.toHaveBeenCalled();
  });

  it('shows the localized operation-key conflict', async () => {
    vi.mocked(inventoryApi.createReservation).mockRejectedValueOnce(
      new ApiError({
        code: 'Conflict',
        message:
          'This operationKey was already used with a different request. Retry with the original request, or use a new key.',
      }),
    );
    const user = userEvent.setup();
    renderForm();
    await fillForm(user);
    await user.click(
      screen.getByRole('button', { name: t.reservations.newReservation }),
    );

    expect(
      await screen.findByText(t.reservations.errors.operationKeyReused),
    ).toBeInTheDocument();
  });
});
