import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { MaterialRequestFormPage } from './material-request-form-page';
import {
  materialRequestDetail,
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

const permissions = [
  PERMISSIONS.organization.view,
  PERMISSIONS.inventory.materialRequestView,
  PERMISSIONS.inventory.materialRequestCreate,
  PERMISSIONS.inventory.materialRequestEdit,
  PERMISSIONS.inventory.warehouseView,
  PERMISSIONS.inventory.itemView,
  PERMISSIONS.inventory.unitView,
];

function renderCreate() {
  return renderWithProviders(
    <Routes>
      <Route
        path="/app/inventory/material-requests"
        element={<div>list</div>}
      />
      <Route
        path="/app/inventory/material-requests/:requestId"
        element={<div>detail</div>}
      />
      <Route
        path="/app/inventory/material-requests/new"
        element={<MaterialRequestFormPage mode="create" />}
      />
    </Routes>,
    { initialEntries: ['/app/inventory/material-requests/new'] },
  );
}

function renderEdit(requestId = 'request-1') {
  return renderWithProviders(
    <Routes>
      <Route
        path="/app/inventory/material-requests"
        element={<div>list</div>}
      />
      <Route
        path="/app/inventory/material-requests/:requestId"
        element={<div>detail</div>}
      />
      <Route
        path="/app/inventory/material-requests/:requestId/edit"
        element={<MaterialRequestFormPage mode="edit" />}
      />
    </Routes>,
    { initialEntries: [`/app/inventory/material-requests/${requestId}/edit`] },
  );
}

async function fillFirstLine(user: ReturnType<typeof userEvent.setup>) {
  const line = await screen.findByTestId('material-request-line-0');
  await user.selectOptions(
    within(line).getByLabelText(t.materialRequests.item),
    'item-1',
  );
  await user.selectOptions(
    within(line).getByLabelText(t.materialRequests.warehouse),
    'wh-1',
  );
  await user.type(
    within(line).getByLabelText(t.materialRequests.quantity),
    '5.0000',
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions,
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
});

describe('material request create form', () => {
  it('posts the exact decimal quantity string and lines without any status field', async () => {
    vi.mocked(inventoryApi.createMaterialRequest).mockResolvedValue(
      materialRequestDetail({ id: 'mr-created' }),
    );
    const user = userEvent.setup();
    renderCreate();
    await user.type(
      await screen.findByLabelText(t.materialRequests.description),
      'خط تولید',
    );
    await fillFirstLine(user);
    await user.click(
      screen.getByRole('button', { name: t.materialRequests.createTitle }),
    );

    await waitFor(() =>
      expect(inventoryApi.createMaterialRequest).toHaveBeenCalledTimes(1),
    );
    const [body] =
      vi.mocked(inventoryApi.createMaterialRequest).mock.calls[0] ?? [];
    expect(body).toEqual({
      organizationId: 'org-1',
      description: 'خط تولید',
      lines: [
        {
          itemId: 'item-1',
          warehouseId: 'wh-1',
          quantity: '5.0000',
          unitId: 'unit-1',
          reservationRequested: false,
        },
      ],
    });
    expect(body).not.toHaveProperty('status');
    expect(typeof body?.lines[0]?.quantity).toBe('string');
    expect(
      await screen.findByText(t.materialRequests.createdSuccess),
    ).toBeInTheDocument();
  });

  it('adds and removes a second line but never leaves the form without one', async () => {
    const user = userEvent.setup();
    renderCreate();

    const removeButtons = await screen.findAllByRole('button', {
      name: t.materialRequests.removeLine,
    });
    expect(removeButtons).toHaveLength(1);
    expect(removeButtons[0]).toBeDisabled();

    await user.click(
      screen.getByRole('button', { name: t.materialRequests.addLine }),
    );
    expect(await screen.findByTestId('material-request-line-1')).toBeVisible();

    const afterAdd = screen.getAllByRole('button', {
      name: t.materialRequests.removeLine,
    });
    expect(afterAdd[0]).toBeEnabled();
    await user.click(afterAdd[1]!);
    await waitFor(() =>
      expect(
        screen.queryByTestId('material-request-line-1'),
      ).not.toBeInTheDocument(),
    );
  });

  it('rejects an empty quantity and an empty line before sending a request', async () => {
    const user = userEvent.setup();
    renderCreate();
    await screen.findByTestId('material-request-line-0');

    await user.click(
      screen.getByRole('button', { name: t.materialRequests.createTitle }),
    );

    expect(
      await screen.findByTestId('material-request-error-summary'),
    ).toHaveTextContent(t.materialRequests.itemRequired);
    expect(inventoryApi.createMaterialRequest).not.toHaveBeenCalled();
  });

  it('localizes a missing unit conversion from the server', async () => {
    vi.mocked(inventoryApi.createMaterialRequest).mockRejectedValueOnce(
      new ApiError({
        code: 'BusinessRuleViolation',
        message:
          'No unit conversion from the entered unit to the base unit covers 2026-10-28. Configure the conversion (in the entered → base direction) before posting.',
      }),
    );
    const user = userEvent.setup();
    renderCreate();
    await fillFirstLine(user);
    await user.click(
      screen.getByRole('button', { name: t.materialRequests.createTitle }),
    );

    expect(
      await screen.findByText(t.materialRequests.errors.conversionUnavailable),
    ).toBeInTheDocument();
  });
});

describe('material request edit form', () => {
  it('replaces the whole line array through PATCH and keeps the exact strings', async () => {
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      materialRequestDetail({
        lines: [
          materialRequestLine({ id: 'line-1' }),
          materialRequestLine({ id: 'line-2', lineNumber: 2 }),
        ],
      }),
    );
    vi.mocked(inventoryApi.updateMaterialRequest).mockResolvedValue(
      materialRequestDetail(),
    );
    const user = userEvent.setup();
    renderEdit();

    const firstLine = await screen.findByTestId('material-request-line-0');
    const quantity = within(firstLine).getByLabelText(
      t.materialRequests.quantity,
    );
    expect(quantity).toHaveValue('5.0000');
    await user.clear(quantity);
    await user.type(quantity, '7.5000');
    await user.click(
      screen.getByRole('button', { name: t.materialRequests.editTitle }),
    );

    await waitFor(() =>
      expect(inventoryApi.updateMaterialRequest).toHaveBeenCalledTimes(1),
    );
    const call = vi.mocked(inventoryApi.updateMaterialRequest).mock.calls[0];
    expect(call?.[0]).toBe('org-1');
    expect(call?.[1]).toBe('request-1');
    expect(call?.[2].lines).toEqual([
      {
        itemId: 'item-1',
        warehouseId: 'wh-1',
        quantity: '7.5000',
        unitId: 'unit-1',
        reservationRequested: true,
      },
      {
        itemId: 'item-1',
        warehouseId: 'wh-1',
        quantity: '5.0000',
        unitId: 'unit-1',
        reservationRequested: true,
      },
    ]);
    expect(call?.[2]).not.toHaveProperty('status');
    expect(
      await screen.findByText(t.materialRequests.updatedSuccess),
    ).toBeInTheDocument();
  });

  it('locks an invoked line: it cannot be removed or edited', async () => {
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      materialRequestDetail({
        lines: [
          materialRequestLine({
            id: 'line-invoked',
            invocationCount: 2,
            invokedBaseQuantity: '2.0000',
            remainingBaseQuantity: '3.0000',
          }),
          materialRequestLine({ id: 'line-2', lineNumber: 2 }),
        ],
      }),
    );
    renderEdit();

    const locked = await screen.findByTestId('material-request-line-0');
    expect(locked).toBeDisabled();
    expect(
      within(locked).getByText(t.materialRequests.invocationLocked),
    ).toBeInTheDocument();
    const removeInLocked = within(locked).getByRole('button', {
      name: t.materialRequests.removeLine,
    });
    expect(removeInLocked).toBeDisabled();
  });

  it('renders read-only copy instead of the form when the status is not editable', async () => {
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      materialRequestDetail({ status: 'submitted', number: 'MR-1404-0007' }),
    );
    renderEdit();

    expect(
      await screen.findByTestId('material-request-not-editable'),
    ).toHaveTextContent(t.materialRequests.notEditable);
    expect(
      screen.queryByRole('button', { name: t.materialRequests.addLine }),
    ).not.toBeInTheDocument();
  });

  it('shows the precise server refusal for an edit that raced the status', async () => {
    vi.mocked(inventoryApi.getMaterialRequest).mockResolvedValue(
      materialRequestDetail(),
    );
    vi.mocked(inventoryApi.updateMaterialRequest).mockRejectedValueOnce(
      new ApiError({
        code: 'BusinessRuleViolation',
        message:
          'The request can only be edited, submitted or deleted while it is a draft or has been returned for correction.',
      }),
    );
    const user = userEvent.setup();
    renderEdit();
    await screen.findByTestId('material-request-line-0');
    await user.click(
      screen.getByRole('button', { name: t.materialRequests.editTitle }),
    );

    expect(
      await screen.findByText(t.materialRequests.errors.notEditable),
    ).toBeInTheDocument();
  });
});
