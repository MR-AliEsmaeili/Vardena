import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ItemValuationMethod,
  ResolvedValuationMethod,
} from '@/api/contracts';
import { ApiError } from '@/api/errors';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { formatBusinessDay } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import { paginated, testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { ValuationMethodsPage } from './valuation-methods-page';

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
vi.mock('@/api/inventory-master.api', () => ({
  listItemsAdmin: vi.fn(),
  listItemGroupsAdmin: vi.fn(),
  listUnitsAdmin: vi.fn(),
  listWarehousesAdmin: vi.fn(),
}));
vi.mock('@/api/inventory.api', () => ({
  listInventoryValuationMethods: vi.fn(),
  resolveInventoryValuationMethod: vi.fn(),
  configureInventoryValuationMethod: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const inventoryMasterApi = await import('@/api/inventory-master.api');
const inventoryApi = await import('@/api/inventory.api');

const ITEM_ULID_1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ITEM_ULID_2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';

const viewOnlyPermissions = [
  PERMISSIONS.organization.view,
  PERMISSIONS.inventory.itemView,
  PERMISSIONS.inventory.valuationView,
];

const configurePermissions = [
  ...viewOnlyPermissions,
  PERMISSIONS.inventory.valuationConfigure,
];

const viewWithoutItemPermission = [
  PERMISSIONS.organization.view,
  PERMISSIONS.inventory.valuationView,
];

const sampleItem = {
  id: ITEM_ULID_1,
  organizationId: testOrganization.id,
  code: 'KAL-01',
  name: 'ورق فولادی',
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

function versionFixture(
  overrides: Partial<ItemValuationMethod> = {},
): ItemValuationMethod {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
    organizationId: testOrganization.id,
    itemId: ITEM_ULID_1,
    method: 'moving_weighted_average',
    validFrom: '2026-03-21',
    validTo: null,
    note: 'نسخه آغاز سال مالی',
    createdAt: '2026-03-21T08:30:00.000Z',
    updatedAt: '2026-03-21T08:30:00.000Z',
    ...overrides,
  };
}

function resolvedFixture(
  overrides: Partial<ResolvedValuationMethod> = {},
): ResolvedValuationMethod {
  return {
    organizationId: testOrganization.id,
    itemId: ITEM_ULID_1,
    asOf: '2026-10-29',
    method: 'moving_weighted_average',
    source: 'configured',
    configurationId: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
    validFrom: '2026-03-21',
    validTo: null,
    active: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(inventoryMasterApi.listItemsAdmin).mockResolvedValue(
    paginated([sampleItem]),
  );
  vi.mocked(inventoryApi.listInventoryValuationMethods).mockResolvedValue(
    paginated([]),
  );
});

describe('ValuationMethodsPage — list, immutability, sorting & permissions', () => {
  it('renders empty state explaining default method behavior and hides «نسخهٔ تازه» without Configure permission', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: viewOnlyPermissions,
    });

    renderWithProviders(<ValuationMethodsPage />, {
      initialEntries: ['/app/inventory/valuation-methods'],
    });

    expect(
      await screen.findByText(t.inventoryValuationMethods.emptyTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t.inventoryValuationMethods.emptyBody),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', {
        name: t.inventoryValuationMethods.newVersion,
      }),
    ).not.toBeInTheDocument();
  });

  it('shows «نسخهٔ تازه» when session holds Inventory.Valuation.Configure and renders immutable version rows with zero edit/delete actions', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: configurePermissions,
    });
    vi.mocked(inventoryApi.listInventoryValuationMethods).mockResolvedValue(
      paginated([
        versionFixture({
          id: 'ver-open',
          validFrom: '2026-06-01',
          validTo: null,
          note: 'نسخه فعلی',
        }),
        versionFixture({
          id: 'ver-closed',
          validFrom: '2026-01-01',
          validTo: '2026-06-01',
          note: null,
        }),
      ]),
    );

    renderWithProviders(<ValuationMethodsPage />, {
      initialEntries: ['/app/inventory/valuation-methods'],
    });

    const newLink = await screen.findByRole('link', {
      name: t.inventoryValuationMethods.newVersion,
    });
    expect(newLink).toHaveAttribute(
      'href',
      '/app/inventory/valuation-methods/new',
    );

    const table = await screen.findByRole('table');
    expect(
      await within(table).findAllByText('KAL-01 — ورق فولادی'),
    ).toHaveLength(2);
    expect(
      within(table).getAllByText(
        t.inventoryValuationMethods.methods.moving_weighted_average,
      ),
    ).toHaveLength(2);
    expect(
      within(table).getByText(t.inventoryValuationMethods.openEnded),
    ).toBeInTheDocument();
    expect(
      within(table).getAllByText(formatBusinessDay('2026-06-01')).length,
    ).toBeGreaterThanOrEqual(2);
    expect(within(table).getByText('نسخه فعلی')).toBeInTheDocument();

    // Append-only invariant: no edit or delete buttons/links exist anywhere in the table.
    expect(
      within(table).queryByRole('button', { name: /ویرایش|حذف/i }),
    ).not.toBeInTheDocument();
    expect(
      within(table).queryByRole('link', { name: /ویرایش|حذف/i }),
    ).not.toBeInTheDocument();

    // Only backend-allowlisted columns (`validFrom`, `createdAt`) are sortable;
    // `validTo` header has NO sort button.
    const validToHeader = within(table).getByRole('columnheader', {
      name: t.inventoryValuationMethods.validTo,
    });
    expect(within(validToHeader).queryByRole('button')).not.toBeInTheDocument();

    const validFromHeader = within(table).getByRole('columnheader', {
      name: new RegExp(t.inventoryValuationMethods.validFrom),
    });
    expect(within(validFromHeader).getByRole('button')).toBeInTheDocument();
  });

  it('rejects malformed ?activeAt= query parameter explicitly without firing listInventoryValuationMethods', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: viewOnlyPermissions,
    });

    renderWithProviders(<ValuationMethodsPage />, {
      initialEntries: ['/app/inventory/valuation-methods?activeAt=2026-99-99'],
    });

    expect(
      await screen.findByText(t.inventoryValuationMethods.activeAtInvalid),
    ).toBeInTheDocument();
    expect(inventoryApi.listInventoryValuationMethods).not.toHaveBeenCalled();
  });

  it('renders Persian ApiErrorAlert with correlationId on list failure and retries cleanly', async () => {
    const user = userEvent.setup();
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: viewOnlyPermissions,
    });
    vi.mocked(inventoryApi.listInventoryValuationMethods)
      .mockRejectedValueOnce(
        new ApiError({
          status: 500,
          code: 'InternalError',
          message: 'RAW ENGLISH SQL ERROR SHOULD NEVER RENDER',
          correlationId: 'corr-list-500',
        }),
      )
      .mockResolvedValueOnce(paginated([versionFixture()]));

    renderWithProviders(<ValuationMethodsPage />, {
      initialEntries: ['/app/inventory/valuation-methods'],
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      t.inventoryValuationMethods.errors.loadFailed,
    );
    expect(alert).toHaveTextContent('corr-list-500');
    expect(alert).not.toHaveTextContent('RAW ENGLISH SQL ERROR');

    await user.click(within(alert).getByRole('button', { name: t.app.retry }));
    expect(await screen.findByText('نسخه آغاز سال مالی')).toBeInTheDocument();
  });

  it('falls back to manual ULID input when session lacks Inventory.Item.View without calling listItemsAdmin', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: viewWithoutItemPermission,
    });

    renderWithProviders(<ValuationMethodsPage />, {
      initialEntries: ['/app/inventory/valuation-methods'],
    });

    expect(
      await screen.findByText(
        t.inventoryValuationMethods.itemPickerUnavailableHint,
      ),
    ).toBeInTheDocument();
    expect(inventoryMasterApi.listItemsAdmin).not.toHaveBeenCalled();
    expect(
      screen.getAllByPlaceholderText(
        t.inventoryValuationMethods.itemIdPlaceholder,
      ),
    ).toHaveLength(2);
  });
});

describe('ValuationMethodsPage — effective valuation method resolve panel', () => {
  it('resolves a configured version and renders «تنظیم‌شده» with configurationId and window', async () => {
    const user = userEvent.setup();
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: viewOnlyPermissions,
    });
    vi.mocked(inventoryApi.resolveInventoryValuationMethod).mockResolvedValue(
      resolvedFixture({
        source: 'configured',
        configurationId: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
        validFrom: '2026-03-21',
        validTo: '2026-12-31',
      }),
    );

    renderWithProviders(<ValuationMethodsPage />, {
      initialEntries: ['/app/inventory/valuation-methods'],
    });

    const resolveCard = await screen.findByTestId(
      'valuation-method-resolve-card',
    );
    const itemSelect = await within(resolveCard).findByLabelText(
      new RegExp(t.inventoryValuationMethods.item),
    );
    await waitFor(() => {
      expect(within(itemSelect).getByText('KAL-01 — ورق فولادی')).toBeTruthy();
    });
    await user.selectOptions(itemSelect, ITEM_ULID_1);

    await user.click(
      within(resolveCard).getByRole('button', {
        name: t.inventoryValuationMethods.resolveAction,
      }),
    );

    const summary = await screen.findByTestId(
      'valuation-method-resolve-summary',
    );
    expect(
      within(summary).getByText(t.inventoryValuationMethods.sourceConfigured),
    ).toBeInTheDocument();
    expect(
      within(summary).getByText('01ARZ3NDEKTSV4RRFFQ69G5FB0'),
    ).toBeInTheDocument();
    expect(
      within(summary).getByText(formatBusinessDay('2026-12-31')),
    ).toBeInTheDocument();
    expect(inventoryApi.resolveInventoryValuationMethod).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: testOrganization.id,
        itemId: ITEM_ULID_1,
      }),
      expect.anything(),
    );
  });

  it('renders source === "default" with configurationId: null as a normal success («پیش‌فرض»), NEVER as an error', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: viewOnlyPermissions,
    });
    vi.mocked(inventoryApi.resolveInventoryValuationMethod).mockResolvedValue(
      resolvedFixture({
        itemId: ITEM_ULID_2,
        asOf: '2026-10-29',
        source: 'default',
        configurationId: null,
        validFrom: null,
        validTo: null,
        active: true,
      }),
    );

    renderWithProviders(<ValuationMethodsPage />, {
      initialEntries: [
        `/app/inventory/valuation-methods?resolveItemId=${ITEM_ULID_2}&resolveAsOf=2026-10-29`,
      ],
    });

    const summary = await screen.findByTestId(
      'valuation-method-resolve-summary',
    );
    expect(
      within(summary).getByText(t.inventoryValuationMethods.sourceDefault),
    ).toBeInTheDocument();
    expect(
      within(summary).getByText(t.inventoryValuationMethods.noConfigurationRow),
    ).toBeInTheDocument();
    expect(
      within(summary).getByText(t.inventoryValuationMethods.sourceDefaultHint),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders Persian itemNotFound alert when resolve returns 404 EntityNotFound', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: viewOnlyPermissions,
    });
    vi.mocked(inventoryApi.resolveInventoryValuationMethod).mockRejectedValue(
      new ApiError({
        status: 404,
        code: 'EntityNotFound',
        message: 'Item does not belong to organization',
      }),
    );

    renderWithProviders(<ValuationMethodsPage />, {
      initialEntries: [
        `/app/inventory/valuation-methods?resolveItemId=${ITEM_ULID_2}&resolveAsOf=2026-10-29`,
      ],
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      t.inventoryValuationMethods.errors.itemNotFound,
    );
    expect(alert).not.toHaveTextContent('Item does not belong');
  });
});
