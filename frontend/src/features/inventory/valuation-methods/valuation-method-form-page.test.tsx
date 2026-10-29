import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { t } from '@/lib/i18n';
import { paginated, testOrganization, testUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import {
  buildValuationMethodFormSchema,
  ValuationMethodFormPage,
} from './valuation-method-form-page';

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

const ITEM_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

const configurePermissionsWithItemView = [
  PERMISSIONS.organization.view,
  PERMISSIONS.inventory.itemView,
  PERMISSIONS.inventory.valuationConfigure,
];

const configureOnlyPermissions = [
  PERMISSIONS.organization.view,
  PERMISSIONS.inventory.valuationConfigure,
];

const sampleItem = {
  id: ITEM_ULID,
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

function renderFormRoute(
  initialEntry = '/app/inventory/valuation-methods/new',
) {
  return renderWithProviders(
    <Routes>
      <Route
        path="/app/inventory/valuation-methods/new"
        element={<ValuationMethodFormPage />}
      />
      <Route
        path="/app/inventory/valuation-methods"
        element={<div data-testid="methods-list-destination">LIST</div>}
      />
    </Routes>,
    { initialEntries: [initialEntry] },
  );
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
});

describe('buildValuationMethodFormSchema — half-open window & implemented method rules', () => {
  const schema = buildValuationMethodFormSchema({ manualItemUlid: true });

  it('accepts moving_weighted_average with open-ended validTo or validTo > validFrom', () => {
    expect(
      schema.safeParse({
        itemId: ITEM_ULID,
        method: 'moving_weighted_average',
        validFrom: '2026-10-29',
        validTo: '',
        note: '',
      }).success,
    ).toBe(true);

    expect(
      schema.safeParse({
        itemId: ITEM_ULID,
        method: 'moving_weighted_average',
        validFrom: '2026-10-29',
        validTo: '2026-11-01',
        note: 'یادداشت مجاز',
      }).success,
    ).toBe(true);
  });

  it('rejects unimplemented valuation methods (fifo, lifo, specific_identification)', () => {
    for (const method of ['fifo', 'lifo', 'specific_identification'] as const) {
      const result = schema.safeParse({
        itemId: ITEM_ULID,
        method,
        validFrom: '2026-10-29',
        validTo: '',
        note: '',
      });
      expect(result.success).toBe(false);
    }
  });

  it('rejects validTo <= validFrom (both equal and earlier) and note > 500 chars', () => {
    const equalResult = schema.safeParse({
      itemId: ITEM_ULID,
      method: 'moving_weighted_average',
      validFrom: '2026-10-29',
      validTo: '2026-10-29',
      note: '',
    });
    expect(equalResult.success).toBe(false);

    const earlierResult = schema.safeParse({
      itemId: ITEM_ULID,
      method: 'moving_weighted_average',
      validFrom: '2026-10-29',
      validTo: '2026-10-01',
      note: '',
    });
    expect(earlierResult.success).toBe(false);

    const longNoteResult = schema.safeParse({
      itemId: ITEM_ULID,
      method: 'moving_weighted_average',
      validFrom: '2026-10-29',
      validTo: '',
      note: 'آ'.repeat(501),
    });
    expect(longNoteResult.success).toBe(false);
  });

  it('rejects malformed ULID when manualItemUlid is enabled', () => {
    const badUlid = schema.safeParse({
      itemId: 'not-a-ulid',
      method: 'moving_weighted_average',
      validFrom: '2026-10-29',
      validTo: '',
      note: '',
    });
    expect(badUlid.success).toBe(false);
  });
});

describe('ValuationMethodFormPage — UI options, submission, invalidation, errors & dirty guard', () => {
  it('renders all 4 valuation methods with fifo/lifo/specific_identification disabled and annotated', async () => {
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: configurePermissionsWithItemView,
    });

    renderFormRoute();

    const methodSelect = await screen.findByLabelText(
      new RegExp(t.inventoryValuationMethods.method),
    );
    const options = within(methodSelect).getAllByRole(
      'option',
    ) as HTMLOptionElement[];

    expect(options.map((opt) => opt.value)).toEqual([
      'moving_weighted_average',
      'fifo',
      'lifo',
      'specific_identification',
    ]);
    expect(options[0]?.disabled).toBe(false);
    expect(options[1]?.disabled).toBe(true);
    expect(options[2]?.disabled).toBe(true);
    expect(options[3]?.disabled).toBe(true);
    expect(options[1]?.textContent).toContain(
      t.inventoryValuationMethods.methodNotImplemented,
    );
  });

  it('submits an open-ended version, invalidates both valuation-methods and valuation-states prefixes, and navigates back', async () => {
    const user = userEvent.setup();
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: configurePermissionsWithItemView,
    });
    vi.mocked(inventoryApi.configureInventoryValuationMethod).mockResolvedValue(
      {
        id: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
        organizationId: testOrganization.id,
        itemId: ITEM_ULID,
        method: 'moving_weighted_average',
        validFrom: '2026-10-29',
        validTo: null,
        note: 'ثبت اولیه',
        createdAt: '2026-10-29T10:00:00.000Z',
        updatedAt: '2026-10-29T10:00:00.000Z',
      },
    );

    const { queryClient } = renderFormRoute();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const itemSelect = await screen.findByLabelText(
      new RegExp(t.inventoryValuationMethods.item),
    );
    await waitFor(() => {
      expect(within(itemSelect).getByText('KAL-01 — ورق فولادی')).toBeTruthy();
    });
    await user.selectOptions(itemSelect, ITEM_ULID);

    const noteInput = screen.getByLabelText(t.inventoryValuationMethods.note);
    await user.type(noteInput, '  ثبت اولیه  ');

    await user.click(
      screen.getByRole('button', {
        name: t.inventoryValuationMethods.submitCreate,
      }),
    );

    await waitFor(() => {
      expect(
        inventoryApi.configureInventoryValuationMethod,
      ).toHaveBeenCalledTimes(1);
    });

    const submittedPayload = vi.mocked(
      inventoryApi.configureInventoryValuationMethod,
    ).mock.calls[0]?.[0];
    expect(submittedPayload).toMatchObject({
      organizationId: testOrganization.id,
      itemId: ITEM_ULID,
      method: 'moving_weighted_average',
      note: 'ثبت اولیه',
    });
    expect(submittedPayload?.validFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect('validTo' in (submittedPayload ?? {})).toBe(false);

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.inventory.valuationMethodsPrefix(testOrganization.id),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.inventory.valuationStatesPrefix(testOrganization.id),
    });

    expect(
      await screen.findByTestId('methods-list-destination'),
    ).toBeInTheDocument();
  });

  it('surfaces 409 Conflict and 422 overlapping_version as persistent Persian alerts while keeping user input', async () => {
    const user = userEvent.setup();
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: configurePermissionsWithItemView,
    });
    vi.mocked(inventoryApi.configureInventoryValuationMethod)
      .mockRejectedValueOnce(
        new ApiError({
          status: 409,
          code: 'Conflict',
          message: 'Duplicate validFrom for item',
          correlationId: 'corr-dup-409',
        }),
      )
      .mockRejectedValueOnce(
        new ApiError({
          status: 422,
          code: 'BusinessRuleViolation',
          message: 'Window overlaps existing version',
          details: { code: 'inventory.valuation_method_overlapping_version' },
          correlationId: 'corr-ovl-422',
        }),
      );

    renderFormRoute(`/app/inventory/valuation-methods/new?itemId=${ITEM_ULID}`);

    const noteInput = await screen.findByLabelText(
      t.inventoryValuationMethods.note,
    );
    await user.type(noteInput, 'توضیح مهم کاربر');

    await user.click(
      screen.getByRole('button', {
        name: t.inventoryValuationMethods.submitCreate,
      }),
    );

    const conflictAlert = await screen.findByRole('alert');
    expect(conflictAlert).toHaveTextContent(
      t.inventoryValuationMethods.errors.duplicateStartDate,
    );
    expect(conflictAlert).toHaveTextContent('corr-dup-409');
    expect(conflictAlert).not.toHaveTextContent('Duplicate validFrom');
    expect(noteInput).toHaveValue('توضیح مهم کاربر');

    await user.click(
      screen.getByRole('button', {
        name: t.inventoryValuationMethods.submitCreate,
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        t.inventoryValuationMethods.errors.windowOverlap,
      );
    });
    expect(screen.getByRole('alert')).toHaveTextContent('corr-ovl-422');
    expect(noteInput).toHaveValue('توضیح مهم کاربر');
  });

  it('prompts confirmation before discarding a dirty form on cancel', async () => {
    const user = userEvent.setup();
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: configurePermissionsWithItemView,
    });

    renderFormRoute();

    const noteInput = await screen.findByLabelText(
      t.inventoryValuationMethods.note,
    );
    await user.type(noteInput, 'پیش‌نویس ذخیره‌نشده');

    await user.click(screen.getByRole('button', { name: t.app.cancel }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      t.inventoryValuationMethods.leaveConfirmTitle,
    );

    await user.click(
      within(dialog).getByRole('button', {
        name: t.inventoryValuationMethods.leaveConfirmAction,
      }),
    );

    expect(
      await screen.findByTestId('methods-list-destination'),
    ).toBeInTheDocument();
  });

  it('supports Configure-only principals without Inventory.Item.View via manual ULID input', async () => {
    const user = userEvent.setup();
    vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
      userId: testUser.id,
      permissions: configureOnlyPermissions,
    });
    vi.mocked(inventoryApi.configureInventoryValuationMethod).mockResolvedValue(
      {
        id: '01ARZ3NDEKTSV4RRFFQ69G5FB1',
        organizationId: testOrganization.id,
        itemId: ITEM_ULID,
        method: 'moving_weighted_average',
        validFrom: '2026-10-29',
        validTo: null,
        note: null,
        createdAt: '2026-10-29T10:00:00.000Z',
        updatedAt: '2026-10-29T10:00:00.000Z',
      },
    );

    renderFormRoute();

    const ulidInput = await screen.findByPlaceholderText(
      t.inventoryValuationMethods.itemIdPlaceholder,
    );
    expect(inventoryMasterApi.listItemsAdmin).not.toHaveBeenCalled();

    await user.type(ulidInput, ITEM_ULID.toLowerCase());
    await user.click(
      screen.getByRole('button', {
        name: t.inventoryValuationMethods.submitCreate,
      }),
    );

    await waitFor(() => {
      expect(
        inventoryApi.configureInventoryValuationMethod,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: testOrganization.id,
          itemId: ITEM_ULID,
          method: 'moving_weighted_average',
        }),
      );
    });
  });
});
