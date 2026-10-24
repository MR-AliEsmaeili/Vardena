import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import type { Account, AccountingDocument } from '@/api/contracts';
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

/**
 * FE-UX-08 §8–§9 regression coverage: the compose (create) / edit form.
 *
 * Covers: required-field validation, invalid line (one-side-per-line)
 * validation, successful create, server validation error, duplicate-submit
 * protection and post-success navigation for Create; draft/temporary
 * editability, the non-editable (final) block, successful update, and a
 * mapped server business-rule error for Edit. Permission-aware ROUTE access
 * to `/app/accounting/documents/new` is covered by the dedicated route
 * regression tests in `src/app/routes/protected-routing.test.tsx` (Issue #3).
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
vi.mock('@/api/accounting.api', async () => {
  const actual = await vi.importActual<typeof import('@/api/accounting.api')>(
    '@/api/accounting.api',
  );
  return {
    ACCOUNTING_DOCUMENT_SORT_FIELDS: actual.ACCOUNTING_DOCUMENT_SORT_FIELDS,
    toDocumentLineInputs: actual.toDocumentLineInputs,
    listFinancialAreas: vi.fn(),
    getAccount: vi.fn(),
    listPostableAccounts: vi.fn(),
    listActiveAccounts: vi.fn(),
    listPostableDetails: vi.fn(),
    getDetailRecord: vi.fn(),
    getAccountingDocument: vi.fn(),
    createAccountingDocument: vi.fn(),
    updateAccountingDocument: vi.fn(),
  };
});

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');

const account1: Account = {
  id: 'acc-2',
  organizationId: 'org-1',
  code: '1010',
  title: 'موجودی نقد',
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

const account2: Account = {
  ...account1,
  id: 'acc-3',
  code: '2010',
  title: 'حساب‌های پرداختنی',
};

function documentFixture(
  overrides: Partial<AccountingDocument> = {},
): AccountingDocument {
  return {
    id: 'doc-1',
    organizationId: 'org-1',
    financialAreaId: 'area-1',
    fiscalYearId: 'year-1',
    accountingPeriodId: 'period-1',
    documentType: 'accounting_voucher',
    documentNumber: null,
    documentDate: '2026-04-05',
    description: 'خرید نرم‌افزار',
    state: 'draft',
    origin: 'manual',
    branchId: null,
    reversesDocumentId: null,
    reversedByDocumentId: null,
    lines: [
      {
        id: 'line-1',
        lineNo: 1,
        accountId: 'acc-2',
        detailId: null,
        debitAmount: '1000.00',
        creditAmount: '0.00',
        description: null,
      },
      {
        id: 'line-2',
        lineNo: 2,
        accountId: 'acc-3',
        detailId: null,
        debitAmount: '0.00',
        creditAmount: '1000.00',
        description: null,
      },
    ],
    totalDebit: '1000.00',
    totalCredit: '1000.00',
    createdAt: '2026-04-05T09:00:00.000Z',
    updatedAt: '2026-04-05T09:30:00.000Z',
    ...overrides,
  } as unknown as AccountingDocument;
}

function Loc() {
  const location = useLocation();
  return <output aria-label="loc-pathname">{location.pathname}</output>;
}

function renderCreate() {
  return renderWithProviders(
    <>
      <DocumentCreatePage />
      <Loc />
    </>,
    { initialEntries: ['/app/accounting/documents/new'] },
  );
}

function renderEdit(documentId = 'doc-1') {
  return renderWithProviders(
    <>
      <Routes>
        <Route
          path="/app/accounting/documents/:documentId/edit"
          element={<DocumentEditPage />}
        />
      </Routes>
      <Loc />
    </>,
    { initialEntries: [`/app/accounting/documents/${documentId}/edit`] },
  );
}

beforeEach(() => {
  resetDateTimeSettings();
  setDateTimeSettings({ timeZone: testOrganization.timeZone });
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: allAccountingPermissions,
  });
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(accountingApi.listFinancialAreas).mockResolvedValue(
    paginated([testFinancialArea]),
  );
  vi.mocked(accountingApi.listPostableAccounts).mockResolvedValue(
    paginated([account1, account2]),
  );
  vi.mocked(accountingApi.listActiveAccounts).mockResolvedValue(
    paginated([account1, account2]),
  );
  vi.mocked(accountingApi.getAccount).mockImplementation((_org, accountId) =>
    Promise.resolve(accountId === 'acc-3' ? account2 : account1),
  );
  vi.mocked(accountingApi.listPostableDetails).mockResolvedValue(paginated([]));
});

async function selectFinancialArea(
  user: ReturnType<typeof userEvent.setup>,
  areaId = 'area-1',
) {
  const select = await screen.findByLabelText(t.documents.fieldArea);
  await waitFor(() =>
    expect(within(select).getAllByRole('option').length).toBeGreaterThan(1),
  );
  await user.selectOptions(select, areaId);
}

function lineRows() {
  return screen.getAllByTestId(/^detail-grid-row-/);
}

/** Code + title shown by the linked account cell for a fixture account. */
const accountByFixtureId: Record<string, { code: string; title: string }> = {
  'acc-2': { code: '1010', title: 'موجودی نقد' },
  'acc-3': { code: '2010', title: 'حساب‌های پرداختنی' },
};

/**
 * Fill the ONE linked account cell: typing the code resolves the real title
 * and sets the account, exactly as an operator would (no hidden select).
 */
async function chooseAccount(
  user: ReturnType<typeof userEvent.setup>,
  row: HTMLElement,
  accountId: string,
) {
  const expected = accountByFixtureId[accountId];
  if (expected === undefined) throw new Error(`unknown fixture ${accountId}`);
  await user.type(
    within(row).getByLabelText(t.documents.accountCode),
    expected.code,
  );
  await waitFor(() =>
    expect(within(row).getByLabelText(t.documents.accountName)).toHaveValue(
      expected.title,
    ),
  );
}

async function fillLine(
  user: ReturnType<typeof userEvent.setup>,
  rowIndex: number,
  accountId: string,
  side: 'debit' | 'credit',
  amount: string,
) {
  const row = lineRows()[rowIndex] as HTMLElement;
  await chooseAccount(user, row, accountId);
  const input = within(row).getByLabelText(
    side === 'debit' ? t.documents.debit : t.documents.credit,
  );
  await user.clear(input);
  await user.type(input, amount);
}

describe('Document create — validation', () => {
  it('requires description before submit (area/date are pre-filled)', async () => {
    const user = userEvent.setup();
    renderCreate();

    await screen.findByLabelText(t.documents.fieldArea);
    await user.click(screen.getByRole('button', { name: t.documents.save }));

    expect(
      await screen.findByText(t.documents.validation.descriptionRequired),
    ).toBeInTheDocument();
    expect(accountingApi.createAccountingDocument).not.toHaveBeenCalled();
  });

  it('rejects a line with both debit and credit filled (one side per line)', async () => {
    const user = userEvent.setup();
    renderCreate();

    const documentDate = await screen.findByLabelText(t.documents.fieldDate);
    fireEvent.change(documentDate, {
      target: { value: '1405-01-16' },
    });
    await selectFinancialArea(user);
    await user.type(
      screen.getByLabelText(t.documents.fieldDescription),
      'شرح سند آزمایشی',
    );

    const row = lineRows()[0] as HTMLElement;
    await chooseAccount(user, row, 'acc-2');
    await user.type(within(row).getByLabelText(t.documents.debit), '100');
    await user.type(within(row).getByLabelText(t.documents.credit), '50');

    await user.click(screen.getByRole('button', { name: t.documents.save }));

    expect(
      await screen.findAllByText(t.documents.validation.amountSides),
    ).not.toHaveLength(0);
    expect(accountingApi.createAccountingDocument).not.toHaveBeenCalled();
  });
});

describe('Document create — submission', () => {
  it('creates the document with the exact filled-in payload and navigates to its detail page', async () => {
    vi.mocked(accountingApi.createAccountingDocument).mockResolvedValue(
      documentFixture({ id: 'doc-new', state: 'draft' }),
    );
    const user = userEvent.setup();
    renderCreate();

    const documentDate = await screen.findByLabelText(t.documents.fieldDate);
    fireEvent.change(documentDate, {
      target: { value: '1405-01-16' },
    });
    await selectFinancialArea(user);
    await user.type(
      screen.getByLabelText(t.documents.fieldDescription),
      'شرح سند آزمایشی',
    );
    await fillLine(user, 0, 'acc-2', 'debit', '1000');
    await fillLine(user, 1, 'acc-3', 'credit', '1000');

    await user.click(screen.getByRole('button', { name: t.documents.save }));

    await waitFor(() =>
      expect(accountingApi.createAccountingDocument).toHaveBeenCalledTimes(1),
    );
    const [body] =
      vi.mocked(accountingApi.createAccountingDocument).mock.calls[0] ?? [];
    expect(body).toMatchObject({
      organizationId: 'org-1',
      financialAreaId: 'area-1',
      documentDate: { calendar: 'JALALI', value: '1405-01-16' },
      description: 'شرح سند آزمایشی',
      lines: [
        expect.objectContaining({
          accountId: 'acc-2',
          debitAmount: '1000',
          creditAmount: '0',
        }),
        expect.objectContaining({
          accountId: 'acc-3',
          debitAmount: '0',
          creditAmount: '1000',
        }),
      ],
    });
    expect(typeof (body as { operationKey: string }).operationKey).toBe(
      'string',
    );

    await waitFor(() =>
      expect(screen.getByLabelText('loc-pathname')).toHaveTextContent(
        '/app/accounting/documents/doc-new',
      ),
    );
  });

  it('sends a Jalali document date as a declared BusinessDate input', async () => {
    vi.mocked(accountingApi.createAccountingDocument).mockResolvedValue(
      documentFixture({ id: 'doc-jalali', state: 'draft' }),
    );
    const user = userEvent.setup();
    renderCreate();

    await screen.findByLabelText(t.documents.fieldArea);
    act(() => {
      setDateTimeSettings({ timeZone: 'Asia/Tehran' });
    });
    const dateField = screen.getByLabelText(t.documents.fieldDate);
    expect(dateField).toHaveAttribute('data-calendar', 'JALALI');
    await user.clear(dateField);
    await user.type(dateField, '1405/01/01');

    await selectFinancialArea(user);
    await user.type(
      screen.getByLabelText(t.documents.fieldDescription),
      'شرح سند جلالی',
    );
    await fillLine(user, 0, 'acc-2', 'debit', '1000');
    await fillLine(user, 1, 'acc-3', 'credit', '1000');
    await user.click(screen.getByRole('button', { name: t.documents.save }));

    await waitFor(() => {
      expect(accountingApi.createAccountingDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          documentDate: { calendar: 'JALALI', value: '1405-01-01' },
        }),
      );
    });
  });

  it('maps a server validation failure onto the form banner (never the raw backend message)', async () => {
    vi.mocked(accountingApi.createAccountingDocument).mockRejectedValue(
      new ApiError({
        code: 'ValidationFailed',
        message: 'internal validation blob, never shown',
        status: 400,
        details: [
          { field: 'description', message: 'irrelevant', code: 'required' },
        ],
      }),
    );
    const user = userEvent.setup();
    renderCreate();

    await selectFinancialArea(user);
    await user.type(
      screen.getByLabelText(t.documents.fieldDescription),
      'شرح سند آزمایشی',
    );
    await fillLine(user, 0, 'acc-2', 'debit', '1000');
    await fillLine(user, 1, 'acc-3', 'credit', '1000');
    await user.click(screen.getByRole('button', { name: t.documents.save }));

    expect(
      await screen.findByText(t.documents.validation.serverSummary),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/internal validation blob/),
    ).not.toBeInTheDocument();
  });

  it('does not submit twice for a rapid double-click (duplicate-submit protection)', async () => {
    let resolveCreate!: (value: AccountingDocument) => void;
    vi.mocked(accountingApi.createAccountingDocument).mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const user = userEvent.setup();
    renderCreate();

    await selectFinancialArea(user);
    await user.type(
      screen.getByLabelText(t.documents.fieldDescription),
      'شرح سند آزمایشی',
    );
    await fillLine(user, 0, 'acc-2', 'debit', '1000');
    await fillLine(user, 1, 'acc-3', 'credit', '1000');

    const submitButton = screen.getByRole('button', {
      name: t.documents.save,
    });
    await user.click(submitButton);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: t.documents.saving }),
      ).toBeDisabled(),
    );
    // The button is disabled while in flight — a second click cannot reach it.
    await user.click(screen.getByRole('button', { name: t.documents.saving }));

    expect(accountingApi.createAccountingDocument).toHaveBeenCalledTimes(1);
    resolveCreate(documentFixture({ id: 'doc-new' }));
    await waitFor(() =>
      expect(screen.getByLabelText('loc-pathname')).toHaveTextContent(
        '/app/accounting/documents/doc-new',
      ),
    );
  });
});

describe('Document edit — editability by state', () => {
  it('loads a draft document editable, prefilled with its values', async () => {
    vi.mocked(accountingApi.getAccountingDocument).mockResolvedValue(
      documentFixture({ state: 'draft' }),
    );
    vi.mocked(accountingApi.updateAccountingDocument).mockResolvedValue(
      documentFixture({ state: 'draft' }),
    );
    const user = userEvent.setup();
    renderEdit();

    expect(
      await screen.findByLabelText(t.documents.fieldDescription),
    ).toHaveValue('خرید نرم‌افزار');
    expect(lineRows()).toHaveLength(2);

    // KNOWN LIMITATION (pre-existing, out of the three approved issues): the
    // financial-area <select> is registered uncontrolled via RHF, and on a
    // cold `useFinancialAreas` cache its matching <option> is not yet in the
    // DOM at mount, so the browser leaves the visible control on the blank
    // placeholder even after the option loads. This is purely cosmetic —
    // RHF's own field value is unaffected — proven below: saving without
    // touching the area still submits the document's original
    // `financialAreaId`, so no data is silently lost.
    await user.click(screen.getByRole('button', { name: t.documents.update }));
    await waitFor(() =>
      expect(accountingApi.updateAccountingDocument).toHaveBeenCalledWith(
        'org-1',
        'doc-1',
        expect.objectContaining({ financialAreaId: 'area-1' }),
      ),
    );
  });

  it('loads a temporary document editable too', async () => {
    vi.mocked(accountingApi.getAccountingDocument).mockResolvedValue(
      documentFixture({ state: 'temporary', documentNumber: '1001' }),
    );
    renderEdit();

    expect(
      await screen.findByLabelText(t.documents.fieldDescription),
    ).toHaveValue('خرید نرم‌افزار');
    expect(
      screen.getByRole('button', { name: t.documents.update }),
    ).toBeInTheDocument();
  });

  it('blocks editing a final document and offers a link back to its view', async () => {
    vi.mocked(accountingApi.getAccountingDocument).mockResolvedValue(
      documentFixture({ state: 'final', documentNumber: '1001' }),
    );
    renderEdit();

    expect(
      await screen.findByText(t.documents.notEditableTitle),
    ).toBeInTheDocument();
    expect(screen.getByText(t.documents.notEditableBody)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: t.documents.view });
    expect(link).toHaveAttribute('href', '/app/accounting/documents/doc-1');
    expect(
      screen.queryByLabelText(t.documents.fieldDescription),
    ).not.toBeInTheDocument();
  });
});

describe('Document edit — submission', () => {
  it('updates the document with the edited fields and navigates to its detail page', async () => {
    vi.mocked(accountingApi.getAccountingDocument).mockResolvedValue(
      documentFixture({ state: 'draft' }),
    );
    vi.mocked(accountingApi.updateAccountingDocument).mockResolvedValue(
      documentFixture({ state: 'draft', description: 'شرح ویرایش‌شده' }),
    );
    const user = userEvent.setup();
    renderEdit();

    const description = await screen.findByLabelText(
      t.documents.fieldDescription,
    );
    await user.clear(description);
    await user.type(description, 'شرح ویرایش‌شده');
    await user.click(screen.getByRole('button', { name: t.documents.update }));

    await waitFor(() =>
      expect(accountingApi.updateAccountingDocument).toHaveBeenCalledWith(
        'org-1',
        'doc-1',
        expect.objectContaining({ description: 'شرح ویرایش‌شده' }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('loc-pathname')).toHaveTextContent(
        '/app/accounting/documents/doc-1',
      ),
    );
  });

  it('requires a non-blank description on save', async () => {
    vi.mocked(accountingApi.getAccountingDocument).mockResolvedValue(
      documentFixture({ state: 'draft' }),
    );
    const user = userEvent.setup();
    renderEdit();

    const description = await screen.findByLabelText(
      t.documents.fieldDescription,
    );
    await user.clear(description);
    await user.click(screen.getByRole('button', { name: t.documents.update }));

    expect(
      await screen.findByText(t.documents.validation.descriptionRequired),
    ).toBeInTheDocument();
    expect(accountingApi.updateAccountingDocument).not.toHaveBeenCalled();
  });

  it('maps a server business-rule rejection to its mapped Persian message', async () => {
    vi.mocked(accountingApi.getAccountingDocument).mockResolvedValue(
      documentFixture({ state: 'draft' }),
    );
    vi.mocked(accountingApi.updateAccountingDocument).mockRejectedValue(
      new ApiError({
        code: 'BusinessRuleViolation',
        message: 'raw backend text — must never be shown',
        status: 422,
        details: { problem: 'account_not_postable' },
      }),
    );
    const user = userEvent.setup();
    renderEdit();

    const description = await screen.findByLabelText(
      t.documents.fieldDescription,
    );
    await user.type(description, ' اضافه');
    await user.click(screen.getByRole('button', { name: t.documents.update }));

    expect(
      await screen.findByText(t.documents.business.accountNotPostable),
    ).toBeInTheDocument();
    expect(screen.queryByText(/raw backend text/)).not.toBeInTheDocument();
  });

  it('does not submit twice for a rapid double-click (duplicate-submit protection)', async () => {
    vi.mocked(accountingApi.getAccountingDocument).mockResolvedValue(
      documentFixture({ state: 'draft' }),
    );
    let resolveUpdate!: (value: AccountingDocument) => void;
    vi.mocked(accountingApi.updateAccountingDocument).mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    const user = userEvent.setup();
    renderEdit();

    const description = await screen.findByLabelText(
      t.documents.fieldDescription,
    );
    await user.type(description, ' اضافه');
    const submitButton = screen.getByRole('button', {
      name: t.documents.update,
    });
    await user.click(submitButton);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: t.documents.updating }),
      ).toBeDisabled(),
    );
    await user.click(
      screen.getByRole('button', { name: t.documents.updating }),
    );

    expect(accountingApi.updateAccountingDocument).toHaveBeenCalledTimes(1);
    resolveUpdate(documentFixture({ state: 'draft' }));
    await waitFor(() =>
      expect(screen.getByLabelText('loc-pathname')).toHaveTextContent(
        '/app/accounting/documents/doc-1',
      ),
    );
  });
});
