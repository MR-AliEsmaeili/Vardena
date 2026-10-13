import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import type { InventoryDocument } from '@/api/contracts';
import { ApiError } from '@/api/errors';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { paginated, testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { InventoryDocumentDetailPage } from './inventory-document-detail-page';
import { InventoryDocumentFormPage } from './inventory-document-form-page';
import { InventoryDocumentsPage } from './inventory-documents-page';

/**
 * Integration coverage for the C-58 business-document UI.
 *
 * The rules under test are the ones a reviewer cannot verify by reading the
 * component: the lifecycle actions follow the SERVER's `canX` flags, a
 * material edit is only resubmitted after both explicit answers, cancellation
 * demands a written reason, and a draft shows no fabricated document number.
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
  listInventoryDocuments: vi.fn(),
  readInventoryDocument: vi.fn(),
  createInventoryDocument: vi.fn(),
  updateInventoryDocument: vi.fn(),
  deleteInventoryDocument: vi.fn(),
  finalizeInventoryDocument: vi.fn(),
  accountingPostInventoryDocument: vi.fn(),
  sealInventoryDocument: vi.fn(),
  cancelInventoryDocument: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const inventoryApi = await import('@/api/inventory.api');

const basePermissions = [
  PERMISSIONS.organization.view,
  PERMISSIONS.inventory.warehouseView,
  PERMISSIONS.inventory.itemView,
  PERMISSIONS.inventory.unitView,
  PERMISSIONS.inventory.documentView,
  PERMISSIONS.inventory.documentCreate,
  PERMISSIONS.inventory.documentEdit,
  PERMISSIONS.inventory.documentFinalize,
  PERMISSIONS.inventory.documentCancel,
  PERMISSIONS.inventory.documentDelete,
];

const warehouses = [
  {
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
  },
  {
    id: 'wh-2',
    organizationId: 'org-1',
    branchId: 'br-1',
    code: 'WH-02',
    name: 'انبار فرعی',
    allowNegativeStock: false,
    reservationsReduceAvailable: false,
    accountingPostingMode: 'direct_final' as const,
    isActive: true,
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
  },
];

const item = {
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

const unit = {
  id: 'unit-1',
  organizationId: 'org-1',
  code: 'عدد',
  name: 'عدد',
  symbol: null,
  isActive: true,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
};

function documentFixture(
  overrides: Partial<InventoryDocument> = {},
): InventoryDocument {
  return {
    id: 'doc-1',
    organizationId: 'org-1',
    kind: 'receipt',
    valuationState: 'unpriced',
    accountingEligible: false,
    number: null,
    businessDate: '2026-05-10',
    businessDateCalendar: { gregorian: '2026-05-10', jalali: '1405-02-20' },
    warehouseId: 'wh-1',
    sourceWarehouseId: null,
    destinationWarehouseId: null,
    status: 'draft',
    description: null,
    reference: null,
    operationKey: null,
    valuationStale: false,
    canEdit: true,
    canFinalize: true,
    canAccountingPost: false,
    canSeal: false,
    canCancel: false,
    canDelete: true,
    finalizedAt: null,
    finalizedBy: null,
    accountingPostedAt: null,
    accountingPostedBy: null,
    accountingPostingState: 'not_posted',
    sealedAt: null,
    sealedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    createdAt: '2026-05-10T08:00:00.000Z',
    updatedAt: '2026-05-10T08:00:00.000Z',
    createdAtCalendar: {
      instant: '2026-05-10T08:00:00.000Z',
      timeZone: 'UTC',
      gregorian: '2026-05-10 08:00:00',
      jalali: '1405-02-20 08:00:00',
    },
    updatedAtCalendar: {
      instant: '2026-05-10T08:00:00.000Z',
      timeZone: 'UTC',
      gregorian: '2026-05-10 08:00:00',
      jalali: '1405-02-20 08:00:00',
    },
    lines: [
      {
        id: 'line-1',
        lineNumber: 1,
        itemId: 'item-1',
        quantity: '10',
        unitId: 'unit-1',
        baseQuantity: '10',
        baseUnitId: 'unit-1',
        conversionFactor: '1',
        movementId: null,
        outMovementId: null,
        inMovementId: null,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: basePermissions,
  });
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(inventoryApi.listInventoryWarehouses).mockResolvedValue(
    paginated(warehouses),
  );
  vi.mocked(inventoryApi.listInventoryItems).mockResolvedValue(
    paginated([item]),
  );
  vi.mocked(inventoryApi.listInventoryUnits).mockResolvedValue(
    paginated([unit]),
  );
});

function renderDetail(documentId = 'doc-1') {
  return renderWithProviders(
    <Routes>
      <Route
        path="/app/inventory/documents/:documentId"
        element={<InventoryDocumentDetailPage />}
      />
    </Routes>,
    { initialEntries: [`/app/inventory/documents/${documentId}`] },
  );
}

function renderCreateForm(kind: InventoryDocument['kind']) {
  return renderWithProviders(
    <Routes>
      <Route
        path="/app/inventory/documents/new"
        element={<InventoryDocumentFormPage />}
      />
      <Route
        path="/app/inventory/documents/:documentId"
        element={<InventoryDocumentDetailPage />}
      />
    </Routes>,
    { initialEntries: [`/app/inventory/documents/new?kind=${kind}`] },
  );
}

function renderEditForm(documentId = 'doc-1') {
  return renderWithProviders(
    <Routes>
      <Route
        path="/app/inventory/documents/:documentId/edit"
        element={<InventoryDocumentFormPage />}
      />
      <Route
        path="/app/inventory/documents/:documentId"
        element={<InventoryDocumentDetailPage />}
      />
    </Routes>,
    { initialEntries: [`/app/inventory/documents/${documentId}/edit`] },
  );
}

describe('Inventory documents list', () => {
  it('states that a draft has no number yet instead of inventing one', async () => {
    vi.mocked(inventoryApi.listInventoryDocuments).mockResolvedValue(
      paginated([documentFixture()]),
    );
    renderWithProviders(<InventoryDocumentsPage />, {
      initialEntries: ['/app/inventory/documents'],
    });

    const table = await screen.findByRole('table');
    expect(
      within(table).getByText(t.inventoryDocuments.numberNotAllocated),
    ).toBeInTheDocument();
    expect(
      within(table).getByText(t.inventoryDocuments.statuses.draft),
    ).toBeInTheDocument();
  });

  it('puts the chosen kind filter in the URL and sends it to the endpoint', async () => {
    const user = userEvent.setup();
    vi.mocked(inventoryApi.listInventoryDocuments).mockResolvedValue(
      paginated([documentFixture()]),
    );
    renderWithProviders(<InventoryDocumentsPage />, {
      initialEntries: ['/app/inventory/documents'],
    });
    await screen.findByRole('table');

    await user.selectOptions(
      screen.getByTestId('documents-kind-filter'),
      'transfer',
    );

    await waitFor(() => {
      const calls = vi.mocked(inventoryApi.listInventoryDocuments).mock.calls;
      expect(calls[calls.length - 1]?.[0]).toMatchObject({ kind: 'transfer' });
    });
  });
});

describe('Inventory document detail — lifecycle', () => {
  it('offers only the commands the server marked possible', async () => {
    vi.mocked(inventoryApi.readInventoryDocument).mockResolvedValue(
      documentFixture({
        status: 'operational',
        number: 'RCV-0001',
        canEdit: true,
        canFinalize: false,
        canAccountingPost: true,
        canSeal: false,
        canCancel: true,
        canDelete: false,
      }),
    );
    renderDetail();

    expect(await screen.findByTestId('accounting-post-document')).toBeEnabled();
    expect(screen.getByTestId('cancel-document')).toBeEnabled();
    expect(screen.queryByTestId('finalize-document')).not.toBeInTheDocument();
    expect(screen.queryByTestId('delete-document')).not.toBeInTheDocument();
    expect(screen.queryByTestId('seal-document')).not.toBeInTheDocument();
  });

  it('finalizes only after the consequence dialog is confirmed', async () => {
    const user = userEvent.setup();
    vi.mocked(inventoryApi.readInventoryDocument).mockResolvedValue(
      documentFixture(),
    );
    vi.mocked(inventoryApi.finalizeInventoryDocument).mockResolvedValue(
      documentFixture({ status: 'operational', number: 'RCV-0001' }),
    );
    renderDetail();

    await user.click(await screen.findByTestId('finalize-document'));
    expect(
      await screen.findByText(t.inventoryDocuments.finalizeDescription),
    ).toBeInTheDocument();
    expect(inventoryApi.finalizeInventoryDocument).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', {
        name: t.inventoryDocuments.finalize,
      }),
    );

    await waitFor(() => {
      expect(inventoryApi.finalizeInventoryDocument).toHaveBeenCalledWith(
        'doc-1',
        'org-1',
        {},
      );
    });
  });

  it('refuses to cancel until a reason is written', async () => {
    const user = userEvent.setup();
    vi.mocked(inventoryApi.readInventoryDocument).mockResolvedValue(
      documentFixture({
        status: 'operational',
        number: 'RCV-0001',
        canFinalize: false,
        canCancel: true,
        canDelete: false,
      }),
    );
    vi.mocked(inventoryApi.cancelInventoryDocument).mockResolvedValue(
      documentFixture({ status: 'cancelled', number: 'RCV-0001' }),
    );
    renderDetail();

    await user.click(await screen.findByTestId('cancel-document'));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', {
      name: t.inventoryDocuments.cancel,
    });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByTestId('cancel-reason'), 'ثبت اشتباه');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => {
      expect(inventoryApi.cancelInventoryDocument).toHaveBeenCalledWith(
        'doc-1',
        'org-1',
        { reason: 'ثبت اشتباه' },
      );
    });
  });

  it('shows the stale-valuation notice when the server says the valuation is stale', async () => {
    vi.mocked(inventoryApi.readInventoryDocument).mockResolvedValue(
      documentFixture({
        status: 'operational',
        number: 'RCV-0002',
        valuationStale: true,
        canFinalize: false,
      }),
    );
    renderDetail();

    expect(
      await screen.findByTestId('valuation-stale-notice'),
    ).toBeInTheDocument();
  });
});

describe('Inventory document form', () => {
  it('creates a receipt draft with the entered line', async () => {
    const user = userEvent.setup();
    vi.mocked(inventoryApi.createInventoryDocument).mockResolvedValue(
      documentFixture(),
    );
    renderCreateForm('receipt');

    await user.selectOptions(
      await screen.findByLabelText(t.inventoryDocuments.warehouse),
      'wh-1',
    );
    await user.selectOptions(
      screen.getByLabelText(t.inventoryDocuments.lineItem),
      'item-1',
    );
    await user.type(
      screen.getByLabelText(t.inventoryDocuments.lineQuantity),
      '10',
    );
    await user.click(screen.getByTestId('submit-document'));

    await waitFor(() => {
      expect(inventoryApi.createInventoryDocument).toHaveBeenCalled();
    });
    const body = vi.mocked(inventoryApi.createInventoryDocument).mock
      .calls[0]?.[0];
    expect(body).toMatchObject({
      organizationId: 'org-1',
      kind: 'receipt',
      warehouseId: 'wh-1',
      lines: [{ itemId: 'item-1', quantity: '10', unitId: 'unit-1' }],
    });
  });

  it('rejects a transfer whose source and destination are the same, without calling the API', async () => {
    const user = userEvent.setup();
    renderCreateForm('transfer');

    await user.selectOptions(
      await screen.findByLabelText(t.inventoryDocuments.sourceWarehouse),
      'wh-1',
    );
    await user.selectOptions(
      screen.getByLabelText(t.inventoryDocuments.destinationWarehouse),
      'wh-1',
    );
    await user.selectOptions(
      screen.getByLabelText(t.inventoryDocuments.lineItem),
      'item-1',
    );
    await user.type(
      screen.getByLabelText(t.inventoryDocuments.lineQuantity),
      '4',
    );
    await user.click(screen.getByTestId('submit-document'));

    expect(
      await screen.findByText(t.inventoryDocuments.sameWarehouse),
    ).toBeInTheDocument();
    expect(inventoryApi.createInventoryDocument).not.toHaveBeenCalled();
  });

  it('shows the unsupported boundary instead of editing return documents in this form', async () => {
    vi.mocked(inventoryApi.readInventoryDocument).mockResolvedValue(
      documentFixture({ kind: 'purchase_return' }),
    );
    renderEditForm();

    expect(
      await screen.findByText(t.inventoryDocuments.unsupportedEditKind),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(t.inventoryDocuments.lineQuantity),
    ).not.toBeInTheDocument();
  });

  it('resubmits a material edit only with the acknowledgement AND an explicit repricing choice', async () => {
    const user = userEvent.setup();
    const existing = documentFixture({
      status: 'operational',
      number: 'RCV-0001',
      canFinalize: false,
    });
    vi.mocked(inventoryApi.readInventoryDocument).mockResolvedValue(existing);
    vi.mocked(inventoryApi.updateInventoryDocument)
      .mockRejectedValueOnce(
        new ApiError({
          code: 'BusinessRuleViolation',
          message: 'This edit changes a posted inventory effect.',
          status: 422,
          details: {
            code: 'inventory.document.side_effect_acknowledgement_required',
          },
        }),
      )
      .mockResolvedValueOnce(existing);

    renderEditForm();

    const quantity = await screen.findByLabelText(
      t.inventoryDocuments.lineQuantity,
    );
    await user.clear(quantity);
    await user.type(quantity, '12');
    await user.click(screen.getByTestId('submit-document'));

    // Step 1: the refusal becomes a decision, not an error banner.
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', {
      name: t.inventoryDocuments.saveChanges,
    });
    expect(confirm).toBeDisabled();
    expect(inventoryApi.updateInventoryDocument).toHaveBeenCalledTimes(1);

    // Step 2: the repricing answer has no default and must be chosen.
    await user.click(screen.getByTestId('repricing-skip'));
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => {
      expect(inventoryApi.updateInventoryDocument).toHaveBeenCalledTimes(2);
    });
    const second = vi.mocked(inventoryApi.updateInventoryDocument).mock
      .calls[1];
    expect(second?.[2]).toMatchObject({
      acknowledgeSideEffects: true,
      repricing: 'skip',
      lines: [{ itemId: 'item-1', quantity: '12', unitId: 'unit-1' }],
    });
  });
});
