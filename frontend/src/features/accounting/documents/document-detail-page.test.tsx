import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import type { Account, AccountingDocument } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import {
  allAccountingPermissions,
  paginated,
  testFinancialArea,
  testFiscalYear,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { DocumentDetailPage } from './document-detail-page';

/**
 * FE-UX-08 §7 regression coverage: the document detail view — rendering,
 * loading, error/not-found, state rendering and permission-aware lifecycle
 * action visibility (the exhaustive `computeDocumentActions` switch,
 * FE-UX-02 §8.2 forbidden-but-discoverable actions).
 */

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));
vi.mock('@/api/organization.api', () => ({
  listMyOrganizations: vi.fn(),
  getBranch: vi.fn(),
  MAX_PAGE_SIZE: 500,
}));
vi.mock('@/api/accounting.api', () => ({
  getAccountingDocument: vi.fn(),
  listFinancialAreas: vi.fn(),
  listFiscalYears: vi.fn(),
  listAccountingPeriods: vi.fn(),
  getAccount: vi.fn(),
  getDetailRecord: vi.fn(),
  listPostableDetails: vi.fn(),
}));

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
    documentNumber: '1001',
    documentDate: '2026-04-05',
    description: 'خرید نرم‌افزار',
    state: 'final',
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
        debitAmount: '1250000.00',
        creditAmount: '0.00',
        description: 'ردیف اول',
      },
      {
        id: 'line-2',
        lineNo: 2,
        accountId: 'acc-3',
        detailId: null,
        debitAmount: '0.00',
        creditAmount: '1250000.00',
        description: 'ردیف دوم',
      },
    ],
    totalDebit: '1250000.00',
    totalCredit: '1250000.00',
    createdAt: '2026-04-05T09:00:00.000Z',
    updatedAt: '2026-04-05T09:30:00.000Z',
    ...overrides,
  } as unknown as AccountingDocument;
}

function mockPermissions(permissions: string[]) {
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions,
  });
}

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  mockPermissions(allAccountingPermissions);
  vi.mocked(organizationApi.listMyOrganizations).mockResolvedValue([
    testOrganization,
  ]);
  vi.mocked(accountingApi.listFinancialAreas).mockResolvedValue(
    paginated([testFinancialArea]),
  );
  vi.mocked(accountingApi.listFiscalYears).mockResolvedValue(
    paginated([testFiscalYear]),
  );
  vi.mocked(accountingApi.listAccountingPeriods).mockResolvedValue(
    paginated([]),
  );
  vi.mocked(accountingApi.getAccount).mockImplementation((_org, accountId) =>
    Promise.resolve(accountId === 'acc-3' ? account2 : account1),
  );
});

function renderDetail(documentId = 'doc-1') {
  return renderWithProviders(
    <Routes>
      <Route
        path="/app/accounting/documents/:documentId"
        element={<DocumentDetailPage />}
      />
    </Routes>,
    { initialEntries: [`/app/accounting/documents/${documentId}`] },
  );
}

describe('Document detail — rendering, loading and errors', () => {
  it('shows a loading state before the document answers', async () => {
    let resolve!: (value: AccountingDocument) => void;
    vi.mocked(accountingApi.getAccountingDocument).mockReturnValue(
      new Promise((res) => {
        resolve = res;
      }),
    );
    renderDetail();

    expect(await screen.findByText(t.app.loading)).toBeInTheDocument();
    resolve(documentFixture());
    await waitFor(() =>
      expect(screen.queryByText(t.app.loading)).not.toBeInTheDocument(),
    );
  });

  it('renders the header facts and the lines table from the response', async () => {
    vi.mocked(accountingApi.getAccountingDocument).mockResolvedValue(
      documentFixture(),
    );
    renderDetail();

    expect(await screen.findByText('1001')).toBeInTheDocument();
    expect(screen.getAllByText(t.documents.stateFinal).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText('1405/01/16 (2026-04-05)')).toBeInTheDocument();
    expect(await screen.findByText(/FIN/)).toBeInTheDocument();

    const table = screen.getByRole('table');
    expect((await within(table).findAllByText('1010')).length).toBeGreaterThan(
      0,
    );
    expect(within(table).getAllByText('2010').length).toBeGreaterThan(0);
    expect(within(table).getByText(/موجودی نقد/)).toBeInTheDocument();
    expect(within(table).getByText(/حساب‌های پرداختنی/)).toBeInTheDocument();
    expect(within(table).getAllByText('1,250,000.00').length).toBeGreaterThan(
      0,
    );
  });

  it('shows the not-found state for a 404 with a link back to the list', async () => {
    vi.mocked(accountingApi.getAccountingDocument).mockRejectedValue(
      new ApiError({ code: 'EntityNotFound', message: 'gone', status: 404 }),
    );
    renderDetail();

    expect(
      await screen.findByText(t.documents.notFoundTitle),
    ).toBeInTheDocument();
    expect(screen.getByText(t.documents.notFoundBody)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: t.documents.backToList });
    expect(link).toHaveAttribute('href', '/app/accounting/documents');
  });

  it('surfaces a generic server error with a retry action', async () => {
    vi.mocked(accountingApi.getAccountingDocument).mockRejectedValue(
      new ApiError({
        code: 'InternalError',
        message: 'boom',
        status: 500,
        correlationId: 'corr-detail-1',
      }),
    );
    renderDetail();

    expect(
      await screen.findByText(t.documents.loadDocumentFailed),
    ).toBeInTheDocument();
    expect(screen.getByText(/corr-detail-1/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t.app.retry }),
    ).toBeInTheDocument();
  });
});

describe('Document detail — state rendering', () => {
  it.each([
    ['draft', t.documents.stateDraft],
    ['temporary', t.documents.stateTemporary],
    ['final', t.documents.stateFinal],
  ] as const)(
    'renders the %s state with its own badge',
    async (state, label) => {
      vi.mocked(accountingApi.getAccountingDocument).mockResolvedValue(
        documentFixture({
          state,
          documentNumber: state === 'draft' ? null : '1001',
        }),
      );
      renderDetail();

      expect(await screen.findAllByText(label)).not.toHaveLength(0);
    },
  );
});

describe('Document detail — permission-aware lifecycle actions', () => {
  it('draft + Edit permission: Edit and Issue available, Finalize/Reverse hidden', async () => {
    mockPermissions([
      PERMISSIONS.organization.view,
      PERMISSIONS.accounting.documentView,
      PERMISSIONS.accounting.documentEdit,
    ]);
    vi.mocked(accountingApi.getAccountingDocument).mockResolvedValue(
      documentFixture({ state: 'draft', documentNumber: null }),
    );
    renderDetail();

    await screen.findAllByText(t.documents.stateDraft);
    expect(
      screen.getByRole('link', { name: t.documents.edit }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t.documents.issue }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.documents.finalize }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.documents.reverse }),
    ).not.toBeInTheDocument();
  });

  it('draft without Edit permission: Edit/Issue render disabled with an explanation', async () => {
    mockPermissions([
      PERMISSIONS.organization.view,
      PERMISSIONS.accounting.documentView,
    ]);
    vi.mocked(accountingApi.getAccountingDocument).mockResolvedValue(
      documentFixture({ state: 'draft', documentNumber: null }),
    );
    renderDetail();

    await screen.findAllByText(t.documents.stateDraft);
    const issueButton = screen.getByRole('button', {
      name: t.documents.issue,
    });
    expect(issueButton).toBeDisabled();
    expect(issueButton).toHaveAttribute('title', t.documents.noPermissionIssue);
    // Not a real link when forbidden — the edit affordance is a disabled button too.
    expect(
      screen.queryByRole('link', { name: t.documents.edit }),
    ).not.toBeInTheDocument();
    const editButton = screen.getByRole('button', { name: t.documents.edit });
    expect(editButton).toBeDisabled();
    expect(editButton).toHaveAttribute('title', t.documents.noPermissionEdit);
  });

  it('temporary + Finalize permission: Finalize available, Issue hidden (already issued)', async () => {
    mockPermissions([
      PERMISSIONS.organization.view,
      PERMISSIONS.accounting.documentView,
      PERMISSIONS.accounting.documentEdit,
      PERMISSIONS.accounting.documentFinalize,
    ]);
    vi.mocked(accountingApi.getAccountingDocument).mockResolvedValue(
      documentFixture({ state: 'temporary' }),
    );
    renderDetail();

    await screen.findAllByText(t.documents.stateTemporary);
    expect(
      screen.getByRole('button', { name: t.documents.finalize }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.documents.issue }),
    ).not.toBeInTheDocument();
  });

  it('temporary without Finalize permission: Finalize renders disabled with an explanation', async () => {
    mockPermissions([
      PERMISSIONS.organization.view,
      PERMISSIONS.accounting.documentView,
      PERMISSIONS.accounting.documentEdit,
    ]);
    vi.mocked(accountingApi.getAccountingDocument).mockResolvedValue(
      documentFixture({ state: 'temporary' }),
    );
    renderDetail();

    await screen.findAllByText(t.documents.stateTemporary);
    const finalizeButton = screen.getByRole('button', {
      name: t.documents.finalize,
    });
    expect(finalizeButton).toBeDisabled();
    expect(finalizeButton).toHaveAttribute(
      'title',
      t.documents.noPermissionFinalize,
    );
  });

  it('final + Reverse permission (not yet reversed): Reverse available, Edit/Finalize/Delete hidden', async () => {
    mockPermissions([
      PERMISSIONS.organization.view,
      PERMISSIONS.accounting.documentView,
      PERMISSIONS.accounting.documentReverse,
    ]);
    vi.mocked(accountingApi.getAccountingDocument).mockResolvedValue(
      documentFixture({ state: 'final', reversedByDocumentId: null }),
    );
    renderDetail();

    await screen.findAllByText(t.documents.stateFinal);
    expect(
      screen.getByRole('button', { name: t.documents.reverse }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: t.documents.edit }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.documents.finalize }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.documents.delete }),
    ).not.toBeInTheDocument();
  });

  it('final + already reversed: Reverse is hidden entirely (not even disabled)', async () => {
    mockPermissions([
      PERMISSIONS.organization.view,
      PERMISSIONS.accounting.documentView,
      PERMISSIONS.accounting.documentReverse,
    ]);
    vi.mocked(accountingApi.getAccountingDocument).mockResolvedValue(
      documentFixture({ state: 'final', reversedByDocumentId: 'doc-2' }),
    );
    renderDetail();

    await screen.findAllByText(t.documents.stateFinal);
    expect(
      screen.queryByRole('button', { name: t.documents.reverse }),
    ).not.toBeInTheDocument();
    // The relation is rendered as a real navigable reference, not invented text.
    const reversedLink = screen.getByRole('link', { name: /doc-2/ });
    expect(reversedLink).toHaveAttribute(
      'href',
      '/app/accounting/documents/doc-2',
    );
  });

  it('final without Reverse permission: Reverse renders disabled with an explanation', async () => {
    mockPermissions([
      PERMISSIONS.organization.view,
      PERMISSIONS.accounting.documentView,
    ]);
    vi.mocked(accountingApi.getAccountingDocument).mockResolvedValue(
      documentFixture({ state: 'final', reversedByDocumentId: null }),
    );
    renderDetail();

    await screen.findAllByText(t.documents.stateFinal);
    const reverseButton = screen.getByRole('button', {
      name: t.documents.reverse,
    });
    expect(reverseButton).toBeDisabled();
    expect(reverseButton).toHaveAttribute(
      'title',
      t.documents.noPermissionReverse,
    );
  });

  it('draft + Delete permission: Delete is available', async () => {
    mockPermissions([
      PERMISSIONS.organization.view,
      PERMISSIONS.accounting.documentView,
      PERMISSIONS.accounting.documentDelete,
    ]);
    vi.mocked(accountingApi.getAccountingDocument).mockResolvedValue(
      documentFixture({ state: 'draft', documentNumber: null }),
    );
    renderDetail();

    await screen.findAllByText(t.documents.stateDraft);
    expect(
      screen.getByRole('button', { name: t.documents.delete }),
    ).toBeInTheDocument();
  });
});
