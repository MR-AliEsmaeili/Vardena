import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { MaterialRequestDetailPage } from './material-request-detail-page';
import {
  materialRequestDetail,
  materialRequestEvent,
  materialRequestItem,
  materialRequestLine,
  materialRequestUnit,
  materialRequestWarehouse,
} from './material-request-test-fixtures';

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
  listMaterialRequests: vi.fn(),
  getMaterialRequest: vi.fn(),
  listMaterialRequestEvents: vi.fn(),
  createMaterialRequest: vi.fn(),
  updateMaterialRequest: vi.fn(),
  deleteMaterialRequest: vi.fn(),
  submitMaterialRequest: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const inventoryApi = await import('@/api/inventory.api');

const viewPermissions = [
  PERMISSIONS.organization.view,
  PERMISSIONS.inventory.materialRequestView,
];

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route
        path="/app/inventory/material-requests"
        element={<div>list</div>}
      />
      <Route
        path="/app/inventory/material-requests/:requestId"
        element={<MaterialRequestDetailPage />}
      />
    </Routes>,
    { initialEntries: ['/app/inventory/material-requests/request-1'] },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: viewPermissions,
  });
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(inventoryApi.listInventoryWarehouses).mockResolvedValue({
    items: [materialRequestWarehouse],
    total: 1,
    page: 1,
    pageSize: 500,
  });
  vi.mocked(inventoryApi.listInventoryItems).mockResolvedValue({
    items: [materialRequestItem],
    total: 1,
    page: 1,
    pageSize: 500,
  });
  vi.mocked(inventoryApi.listInventoryUnits).mockResolvedValue({
    items: [materialRequestUnit],
    total: 1,
    page: 1,
    pageSize: 500,
  });
  vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
    materialRequestDetail(),
  );
  vi.mocked(inventoryApi.listMaterialRequestEvents).mockResolvedValue([
    materialRequestEvent(),
  ]);
});

describe('material request detail', () => {
  it('renders status, lines and the ordered event narrative', async () => {
    renderDetail();

    expect(
      await screen.findByTestId('material-request-detail-page'),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(t.materialRequests.statuses.draft).length,
    ).toBeGreaterThan(0);
    const linesTable = screen.getByTestId('material-request-lines-table');
    expect(
      within(linesTable).getByText('KAL-01 — کالای نمونه'),
    ).toBeInTheDocument();
    expect(within(linesTable).getByText('WH-01 — انبار مرکزی')).toBeVisible();
    expect(
      within(linesTable).getByText(t.materialRequests.reservationYes),
    ).toBeInTheDocument();

    const events = await screen.findByTestId('material-request-events');
    expect(
      within(events).getByText(t.materialRequests.eventTypes.created),
    ).toBeInTheDocument();
    expect(inventoryApi.listMaterialRequestEvents).toHaveBeenCalledWith(
      'org-1',
      'request-1',
      expect.anything(),
    );
  });

  it('offers submit only with the permission and only for a draft/returned request', async () => {
    const first = renderDetail();
    await screen.findByTestId('material-request-detail-page');
    expect(
      screen.queryByTestId('material-request-submit'),
    ).not.toBeInTheDocument();
    first.unmount();

    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        ...viewPermissions,
        PERMISSIONS.inventory.materialRequestSubmit,
      ],
    });
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      materialRequestDetail({ status: 'returned' }),
    );
    renderDetail();

    expect(
      await screen.findByTestId('material-request-submit'),
    ).toBeInTheDocument();
  });

  it('submits only after confirmation and shows the allocated number', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        ...viewPermissions,
        PERMISSIONS.inventory.materialRequestSubmit,
      ],
    });
    vi.mocked(inventoryApi.submitMaterialRequest).mockResolvedValue(
      materialRequestDetail({ status: 'submitted', number: 'MR-1404-0009' }),
    );
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByTestId('material-request-submit'));
    expect(
      screen.getByText(t.materialRequests.submitConfirmTitle),
    ).toBeInTheDocument();
    expect(inventoryApi.submitMaterialRequest).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: t.materialRequests.submit }),
    );
    await waitFor(() =>
      expect(inventoryApi.submitMaterialRequest).toHaveBeenCalledWith(
        'org-1',
        'request-1',
      ),
    );
    expect(
      await screen.findByText(
        t.materialRequests.submittedNumber.replace('{number}', 'MR-1404-0009'),
      ),
    ).toBeInTheDocument();
  });

  it('offers delete only for a draft and only with the delete permission', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        ...viewPermissions,
        PERMISSIONS.inventory.materialRequestDelete,
      ],
    });
    const first = renderDetail();
    expect(
      await screen.findByTestId('material-request-delete'),
    ).toBeInTheDocument();
    first.unmount();

    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      materialRequestDetail({ status: 'submitted', number: 'MR-1404-0012' }),
    );
    renderDetail();
    expect(
      await screen.findByTestId('material-request-readonly-banner'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('material-request-delete'),
    ).not.toBeInTheDocument();
  });

  it('never renders approval, cancellation or line-invocation commands', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: [
        ...viewPermissions,
        PERMISSIONS.inventory.materialRequestSubmit,
        PERMISSIONS.inventory.materialRequestDelete,
        PERMISSIONS.inventory.materialRequestEdit,
      ],
    });
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      materialRequestDetail({ status: 'submitted', number: 'MR-1404-0010' }),
    );
    renderDetail();

    await screen.findByTestId('material-request-detail-page');
    for (const label of [
      'Approve',
      'Reject',
      'Cancel',
      'ReturnForCorrection',
      'Invoke',
    ]) {
      expect(
        screen.queryByRole('button', { name: new RegExp(label, 'i') }),
      ).not.toBeInTheDocument();
    }
  });

  it('renders an invoked line with its consumed and remaining base quantity', async () => {
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      materialRequestDetail({
        status: 'approved',
        number: 'MR-1404-0011',
        lines: [
          materialRequestLine({
            invocationCount: 1,
            invokedBaseQuantity: '2.0000',
            remainingBaseQuantity: '3.0000',
          }),
        ],
      }),
    );
    renderDetail();

    const linesTable = await screen.findByTestId(
      'material-request-lines-table',
    );
    expect(within(linesTable).getByText('2.0000')).toBeInTheDocument();
    expect(within(linesTable).getByText('3.0000')).toBeInTheDocument();
  });
});
