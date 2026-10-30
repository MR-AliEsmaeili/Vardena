import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { ReservationDetailPage } from './reservation-detail-page';
import {
  reservation,
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

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const inventoryApi = await import('@/api/inventory.api');

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route
        path="/app/inventory/reservations/:reservationId"
        element={<ReservationDetailPage />}
      />
    </Routes>,
    { initialEntries: ['/app/inventory/reservations/res-1'] },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: [
      PERMISSIONS.organization.view,
      PERMISSIONS.inventory.reservationView,
      PERMISSIONS.inventory.reservationRelease,
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
  vi.mocked(inventoryApi.getReservation).mockResolvedValue(reservation());
});

describe('reservation detail and lifecycle', () => {
  it('renders exact response quantities, conversion, reference and technical operation key', async () => {
    renderDetail();

    expect(await screen.findByText('KAL-01 — کالای نمونه')).toBeInTheDocument();
    expect(screen.getByText('2.5000 عدد')).toBeInTheDocument();
    expect(screen.getByText('30.0000 عدد')).toBeInTheDocument();
    expect(screen.getByText('12.0000')).toBeInTheDocument();
    expect(screen.getByText('op-create-1')).toHaveClass('select-all');
    expect(
      screen.getByRole('button', { name: t.reservations.release }),
    ).toBeInTheDocument();
  });

  it('offers generic release only with permission and only for active generic reservations', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValueOnce({
      userId: testUser.id,
      permissions: [
        PERMISSIONS.organization.view,
        PERMISSIONS.inventory.reservationView,
      ],
    });
    renderDetail();
    await screen.findByText('KAL-01 — کالای نمونه');
    expect(
      screen.queryByRole('button', { name: t.reservations.release }),
    ).not.toBeInTheDocument();
  });

  it('does not release a Material Request line reservation and explains its owner lifecycle without a broken link', async () => {
    vi.mocked(inventoryApi.getReservation).mockResolvedValueOnce(
      reservation({
        referenceType: 'material_request_line',
        referenceId: 'line-1',
      }),
    );
    renderDetail();

    expect(
      await screen.findByTestId('material-request-owned-reservation'),
    ).toHaveTextContent(t.reservations.materialRequestOwnedBody);
    expect(
      screen.queryByRole('button', { name: t.reservations.release }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('line-1')).toHaveLength(2);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows a terminal released banner and no release action', async () => {
    vi.mocked(inventoryApi.getReservation).mockResolvedValueOnce(
      reservation({
        status: 'released',
        releasedAt: '2026-10-26T09:00:00.000Z',
        releasedBy: 'usr-2',
        releaseOperationKey: 'op-release-1',
      }),
    );
    renderDetail();

    expect(
      await screen.findByTestId('reservation-released-banner'),
    ).toHaveTextContent('usr-2');
    expect(
      screen.queryByRole('button', { name: t.reservations.release }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('op-release-1')).toBeInTheDocument();
  });

  it('shows the specific repeated-release refusal and reuses the dialog key on retry', async () => {
    vi.mocked(inventoryApi.releaseReservation)
      .mockRejectedValueOnce(
        new ApiError({ code: 'NetworkError', message: t.errors.network }),
      )
      .mockRejectedValueOnce(
        new ApiError({
          code: 'BusinessRuleViolation',
          message:
            'The reservation is already released. A release is terminal and cannot be applied twice.',
        }),
      );
    const user = userEvent.setup();
    renderDetail();

    await user.click(
      await screen.findByRole('button', { name: t.reservations.release }),
    );
    const confirm = screen.getByRole('button', {
      name: t.reservations.releaseConfirm,
    });
    await user.click(confirm);
    expect(await screen.findByText(t.errors.network)).toBeInTheDocument();
    await user.click(confirm);

    expect(
      await screen.findByText(t.reservations.releasedAlready),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(inventoryApi.releaseReservation).toHaveBeenCalledTimes(2),
    );
    const calls = vi.mocked(inventoryApi.releaseReservation).mock.calls;
    expect(calls[0]?.[2].operationKey).toBe(calls[1]?.[2].operationKey);
  });
});
