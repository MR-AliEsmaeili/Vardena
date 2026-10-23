import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Account,
  AccountingDocument,
  InventoryDocument,
} from '@/api/contracts';
import { ApiError } from '@/api/errors';
import { InventoryDocumentLinesPage } from '@/features/inventory/documents/inventory-document-lines-page';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { resetDateTimeSettings, setDateTimeSettings } from '@/lib/datetime';
import { t } from '@/lib/i18n';
import {
  allAccountingPermissions,
  paginated,
  testFinancialArea,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { DocumentCreatePage, DocumentEditPage } from './document-form-page';
import { AccountingDocumentLinesPage } from './document-lines-page';

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
vi.mock('@/api/accounting.api', async () => {
  const actual = await vi.importActual<typeof import('@/api/accounting.api')>(
    '@/api/accounting.api',
  );
  return {
    ACCOUNTING_DOCUMENT_SORT_FIELDS: actual.ACCOUNTING_DOCUMENT_SORT_FIELDS,
    toDocumentLineInputs: actual.toDocumentLineInputs,
    listFinancialAreas: vi.fn(),
    listFiscalYears: vi.fn(),
    listAccountingPeriods: vi.fn(),
    getAccount: vi.fn(),
    listPostableAccounts: vi.fn(),
    listPostableDetails: vi.fn(),
    getDetailRecord: vi.fn(),
    listAccountingDocuments: vi.fn(),
    getAccountingDocument: vi.fn(),
    createAccountingDocument: vi.fn(),
    updateAccountingDocument: vi.fn(),
  };
});
vi.mock('@/api/inventory.api', () => ({
  INVENTORY_MAX_PAGE_SIZE: 500,
  listInventoryWarehouses: vi.fn(),
  listInventoryItems: vi.fn(),
  listInventoryUnits: vi.fn(),
  listInventoryDocuments: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');
const inventoryApi = await import('@/api/inventory.api');

const acc1: Account = {
  id: 'acc-1',
  organizationId: 'org-1',
  code: '1010',
  title: 'بانک',
  parentId: null,
  level: 2,
  codingStructureVersionId: null,
  accountingConfigurationId: null,
  accountNature: 'DEBIT',
  accountType: 'BALANCE_SHEET',
  detailGroupId: null,
  isPostable: true,
  isActive: true,
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
} as Account;

const acc2: Account = {
  ...acc1,
  id: 'acc-2',
  code: '3010',
  title: 'درآمد فروش',
  accountNature: 'CREDIT',
};

function makeAccountingDoc(
  overrides: Partial<AccountingDocument> = {},
): AccountingDocument {
  return {
    id: 'doc-1',
    organizationId: 'org-1',
    financialAreaId: 'area-1',
    fiscalYearId: 'year-1',
    accountingPeriodId: 'period-1',
    documentType: 'accounting_voucher',
    documentNumber: '1001',
    documentDate: '2026-05-10',
    description: 'سند آزمایشی اول',
    state: 'draft',
    origin: 'manual',
    branchId: null,
    reversesDocumentId: null,
    reversedByDocumentId: null,
    lines: [
      {
        id: 'ln-1',
        lineNo: 1,
        accountId: 'acc-1',
        detailId: null,
        debitAmount: '250000.00',
        creditAmount: '0.00',
        description: 'دریافت وجه',
      },
      {
        id: 'ln-2',
        lineNo: 2,
        accountId: 'acc-2',
        detailId: null,
        debitAmount: '0.00',
        creditAmount: '250000.00',
        description: 'ثبت درآمد',
      },
    ],
    totalDebit: '250000.00',
    totalCredit: '250000.00',
    createdAt: '2026-05-10T09:00:00.000Z',
    updatedAt: '2026-05-10T09:30:00.000Z',
    ...overrides,
  } as unknown as AccountingDocument;
}

function LocationProbe() {
  const loc = useLocation();
  return <output aria-label="current-path">{loc.pathname}</output>;
}

beforeEach(() => {
  resetDateTimeSettings();
  setDateTimeSettings({ timeZone: testOrganization.timeZone });
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: [
      ...allAccountingPermissions,
      PERMISSIONS.accounting.documentCreate,
      PERMISSIONS.accounting.documentEdit,
      PERMISSIONS.inventory.documentView,
      PERMISSIONS.inventory.warehouseView,
      PERMISSIONS.inventory.itemView,
      PERMISSIONS.inventory.unitView,
    ],
  });
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(accountingApi.listFinancialAreas).mockResolvedValue(
    paginated([testFinancialArea]),
  );
  vi.mocked(accountingApi.listFiscalYears).mockResolvedValue(paginated([]));
  vi.mocked(accountingApi.listAccountingPeriods).mockResolvedValue(
    paginated([]),
  );
  vi.mocked(accountingApi.listPostableAccounts).mockResolvedValue(
    paginated([acc1, acc2]),
  );
  vi.mocked(accountingApi.getAccount).mockImplementation((_org, id) =>
    Promise.resolve(id === 'acc-2' ? acc2 : acc1),
  );
  vi.mocked(accountingApi.listPostableDetails).mockResolvedValue(paginated([]));
});

describe('Operational Form full user journey — Collapsible Header, Detail Grid, Summary & Dirty Pagination', () => {
  it('blocks collapsing an incomplete header, collapses after filling required fields, updates exact Summary live, and saves', async () => {
    vi.mocked(accountingApi.createAccountingDocument).mockResolvedValue(
      makeAccountingDoc({ id: 'doc-saved' }),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <DocumentCreatePage />
        <LocationProbe />
      </>,
      { initialEntries: ['/app/accounting/documents/new'] },
    );

    const areaSelect = await screen.findByLabelText(t.documents.fieldArea);
    await waitFor(() =>
      expect(within(areaSelect).getAllByRole('option').length).toBeGreaterThan(
        1,
      ),
    );

    // 1. Try collapsing before filling required fields -> blocked + validation shown
    await user.click(screen.getByTestId('collapsible-header-toggle'));
    expect(
      screen.getByTestId('collapsible-header-blocked-hint'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(t.documents.validation.areaRequired),
    ).toBeInTheDocument();

    // 2. Fill header & collapse -> summary chips appear, fields hide
    await user.selectOptions(areaSelect, 'area-1');
    await user.type(
      screen.getByLabelText(t.documents.fieldDescription),
      'سند فروش روزانه',
    );
    await user.click(screen.getByTestId('collapsible-header-toggle'));
    expect(screen.getByTestId('header-summary')).toHaveTextContent(
      testFinancialArea.title,
    );
    expect(
      screen.queryByLabelText(t.documents.fieldDescription),
    ).not.toBeInTheDocument();

    // 3. Enter lines and observe live Summary transitions (unbalanced -> balanced)
    const row0 = screen.getByTestId('detail-grid-row-0');
    const row1 = screen.getByTestId('detail-grid-row-1');
    await user.selectOptions(within(row0).getByRole('combobox'), 'acc-1');
    const [debit0] = within(row0).getAllByRole('textbox');
    await user.type(debit0!, '500000.25');

    const summary = screen.getByTestId('operational-summary');
    expect(summary).toHaveTextContent('500,000.25');
    expect(summary).toHaveTextContent('اختلاف: 500,000.25');

    await user.selectOptions(within(row1).getByRole('combobox'), 'acc-2');
    const [, credit1] = within(row1).getAllByRole('textbox');
    await user.type(credit1!, '500000.25');
    expect(summary).toHaveTextContent(t.operationalForm.balanced);

    // 4. Save
    await user.click(screen.getByRole('button', { name: t.documents.save }));
    await waitFor(() =>
      expect(accountingApi.createAccountingDocument).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('current-path')).toHaveTextContent(
        '/app/accounting/documents/doc-saved',
      ),
    );
  });

  it('guards unsaved changes before navigating between documents via Footer pagination', async () => {
    const doc1 = makeAccountingDoc({ id: 'doc-1', description: 'سند اول' });
    const doc2 = makeAccountingDoc({ id: 'doc-2', description: 'سند دوم' });
    vi.mocked(accountingApi.listAccountingDocuments).mockResolvedValue(
      paginated([doc1, doc2]),
    );
    vi.mocked(accountingApi.getAccountingDocument).mockImplementation(
      (_org, id) => Promise.resolve(id === 'doc-2' ? doc2 : doc1),
    );

    const user = userEvent.setup();
    renderWithProviders(
      <>
        <Routes>
          <Route
            path="/app/accounting/documents/:documentId/edit"
            element={<DocumentEditPage />}
          />
        </Routes>
        <LocationProbe />
      </>,
      { initialEntries: ['/app/accounting/documents/doc-1/edit'] },
    );

    const desc = await screen.findByLabelText(t.documents.fieldDescription);
    expect(desc).toHaveValue('سند اول');

    // Wait for neighbor pagination to resolve
    const nextBtn = await screen.findByTestId('document-pagination-next');
    expect(screen.getByTestId('document-pagination-label')).toHaveTextContent(
      'سند 1 از 2',
    );

    // Modify field to make form dirty
    await user.type(desc, ' ویرایش');
    await user.click(nextBtn);

    // Must not navigate immediately; ConfirmDialog appears
    expect(screen.getByLabelText('current-path')).toHaveTextContent(
      '/app/accounting/documents/doc-1/edit',
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', {
        name: t.documents.dirtyLeaveConfirm,
      }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText('current-path')).toHaveTextContent(
        '/app/accounting/documents/doc-2/edit',
      ),
    );
    expect(
      await screen.findByLabelText(t.documents.fieldDescription),
    ).toHaveValue('سند دوم');
  });
});

describe('Accounting & Inventory Document Lines Explorers', () => {
  it('renders Accounting Document Lines with parent header info, supports search/error/empty states, and opens parent document', async () => {
    vi.mocked(accountingApi.listAccountingDocuments)
      .mockRejectedValueOnce(
        new ApiError({ code: 'InternalError', message: 'err', status: 500 }),
      )
      .mockResolvedValue(paginated([makeAccountingDoc()]));

    const user = userEvent.setup();
    renderWithProviders(
      <>
        <Routes>
          <Route
            path="/app/accounting/document-lines"
            element={<AccountingDocumentLinesPage />}
          />
          <Route
            path="/app/accounting/documents/:documentId"
            element={<div>صفحه سند مقصد</div>}
          />
        </Routes>
        <LocationProbe />
      </>,
      { initialEntries: ['/app/accounting/document-lines'] },
    );

    // Error state + retry
    expect(await screen.findByText(t.table.errorTitle)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.app.retry }));

    // Success state: both lines rendered with parent doc number 1001
    expect(await screen.findByText('دریافت وجه')).toBeInTheDocument();
    expect(screen.getByText('ثبت درآمد')).toBeInTheDocument();
    expect(screen.getAllByText('1001').length).toBeGreaterThanOrEqual(2);

    // Search filters down to matching line
    const search = screen.getByTestId('toolbar-search');
    await user.type(search, 'درآمد');
    expect(screen.queryByText('دریافت وجه')).not.toBeInTheDocument();
    expect(screen.getByText('ثبت درآمد')).toBeInTheDocument();

    // Open parent document
    await user.click(screen.getByTestId('open-parent-doc-doc-1'));
    expect(await screen.findByText('صفحه سند مقصد')).toBeInTheDocument();
  });

  it('renders Inventory Document Lines with parent header facts and opens parent inventory document', async () => {
    vi.mocked(inventoryApi.listInventoryWarehouses).mockResolvedValue(
      paginated([
        {
          id: 'wh-1',
          organizationId: 'org-1',
          branchId: 'br-1',
          code: 'WH-01',
          name: 'انبار مرکزی',
          allowNegativeStock: false,
          reservationsReduceAvailable: false,
          accountingPostingMode: 'direct_final',
          isActive: true,
          createdAt: '2026-01-01T08:00:00.000Z',
          updatedAt: '2026-01-01T08:00:00.000Z',
        },
      ]),
    );
    vi.mocked(inventoryApi.listInventoryItems).mockResolvedValue(
      paginated([
        {
          id: 'item-1',
          organizationId: 'org-1',
          code: 'IT-10',
          name: 'ورق فولادی',
          description: null,
          itemKind: 'goods',
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
        },
      ]),
    );
    vi.mocked(inventoryApi.listInventoryUnits).mockResolvedValue(
      paginated([
        {
          id: 'unit-1',
          organizationId: 'org-1',
          code: 'KG',
          name: 'کیلوگرم',
          symbol: 'kg',
          isActive: true,
          createdAt: '2026-01-01T08:00:00.000Z',
          updatedAt: '2026-01-01T08:00:00.000Z',
        },
      ]),
    );
    vi.mocked(inventoryApi.listInventoryDocuments).mockResolvedValue(
      paginated([
        {
          id: 'inv-doc-1',
          organizationId: 'org-1',
          kind: 'receipt',
          valuationState: 'priced',
          accountingEligible: true,
          number: 'RCV-202',
          businessDate: '2026-05-10',
          businessDateCalendar: {
            gregorian: '2026-05-10',
            jalali: '1405-02-20',
          },
          warehouseId: 'wh-1',
          sourceWarehouseId: null,
          destinationWarehouseId: null,
          status: 'operational',
          description: 'رسید خرید',
          reference: null,
          operationKey: null,
          valuationStale: false,
          canEdit: true,
          canFinalize: false,
          canAccountingPost: true,
          canSeal: false,
          canCancel: true,
          canDelete: false,
          finalizedAt: '2026-05-10T09:00:00.000Z',
          finalizedBy: 'usr-1',
          accountingPostedAt: null,
          accountingPostedBy: null,
          accountingPostingState: 'not_posted',
          sealedAt: null,
          sealedBy: null,
          cancelledAt: null,
          cancelledBy: null,
          cancellationReason: null,
          createdAt: '2026-05-10T08:00:00.000Z',
          updatedAt: '2026-05-10T09:00:00.000Z',
          createdAtCalendar: {
            instant: '2026-05-10T08:00:00.000Z',
            timeZone: 'UTC',
            gregorian: '2026-05-10 08:00:00',
            jalali: '1405-02-20 08:00:00',
          },
          updatedAtCalendar: {
            instant: '2026-05-10T09:00:00.000Z',
            timeZone: 'UTC',
            gregorian: '2026-05-10 09:00:00',
            jalali: '1405-02-20 09:00:00',
          },
          lines: [
            {
              id: 'inv-ln-1',
              lineNumber: 1,
              itemId: 'item-1',
              quantity: '150.5',
              unitId: 'unit-1',
              baseQuantity: '150.5',
              baseUnitId: 'unit-1',
              conversionFactor: '1',
              movementId: 'mov-1',
              outMovementId: null,
              inMovementId: null,
            },
          ],
        } as unknown as InventoryDocument,
      ]),
    );

    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route
          path="/app/inventory/document-lines"
          element={<InventoryDocumentLinesPage />}
        />
        <Route
          path="/app/inventory/documents/:documentId"
          element={<div>جزئیات سند انبار</div>}
        />
      </Routes>,
      { initialEntries: ['/app/inventory/document-lines'] },
    );

    expect(await screen.findByText(/ورق فولادی/)).toBeInTheDocument();
    expect(screen.getByText('RCV-202')).toBeInTheDocument();
    expect(screen.getByText('انبار مرکزی')).toBeInTheDocument();

    await user.click(screen.getByTestId('open-inv-parent-doc-inv-doc-1'));
    expect(await screen.findByText('جزئیات سند انبار')).toBeInTheDocument();
  });
});
