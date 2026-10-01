import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import type { AccountingDocument } from '@/api/contracts';
import { t } from '@/lib/i18n';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import {
  allAccountingPermissions,
  paginated,
  testFinancialArea,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { DocumentsPage } from './documents-page';

/**
 * FE-UX-08 §7 regression coverage: the documents workspace list.
 *
 * Covers: initial loading, successful rendering, empty state (with and
 * without active filters), server error, permission-denied error, URL filter
 * initialization, apply/clear filters, browser Back/Forward, pagination and
 * the permission-gated «ثبت سند» action.
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
vi.mock('@/api/accounting.api', () => ({
  ACCOUNTING_DOCUMENT_SORT_FIELDS: [
    'documentDate',
    'documentNumber',
    'createdAt',
    'updatedAt',
  ],
  listAccountingDocuments: vi.fn(),
  listFinancialAreas: vi.fn(),
  listFiscalYears: vi.fn(),
  listAccountingPeriods: vi.fn(),
}));

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');

function documentRow(overrides: Partial<AccountingDocument> = {}) {
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
    lines: [],
    totalDebit: '1250000.00',
    totalCredit: '1250000.00',
    createdAt: '2026-04-05T09:00:00.000Z',
    updatedAt: '2026-04-05T09:30:00.000Z',
    ...overrides,
  } as unknown as AccountingDocument;
}

function HistoryControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="location-search">{location.search}</output>
      <button type="button" onClick={() => navigate(-1)}>
        back
      </button>
      <button type="button" onClick={() => navigate(1)}>
        forward
      </button>
    </>
  );
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
  vi.mocked(accountingApi.listFiscalYears).mockResolvedValue(paginated([]));
  vi.mocked(accountingApi.listAccountingPeriods).mockResolvedValue(
    paginated([]),
  );
});

describe('Documents list — loading, rendering, empty and error states', () => {
  it('shows a loading state while the initial page is in flight', async () => {
    let resolve!: (
      value: ReturnType<typeof paginated<AccountingDocument>>,
    ) => void;
    vi.mocked(accountingApi.listAccountingDocuments).mockReturnValue(
      new Promise((res) => {
        resolve = res;
      }),
    );
    renderWithProviders(<DocumentsPage />);

    expect(await screen.findByText(t.table.loading)).toBeInTheDocument();
    resolve(paginated([]));
    await waitFor(() =>
      expect(screen.queryByText(t.table.loading)).not.toBeInTheDocument(),
    );
  });

  it('renders the returned documents with number, date, state and area', async () => {
    vi.mocked(accountingApi.listAccountingDocuments).mockResolvedValue(
      paginated([documentRow()]),
    );
    renderWithProviders(<DocumentsPage />);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('1001')).toBeInTheDocument();
    expect(within(table).getByText('2026-04-05')).toBeInTheDocument();
    expect(within(table).getByText(t.documents.stateFinal)).toBeInTheDocument();
    // The financial area column resolves from its own query
    // (`listFinancialAreas`) — `findByText` rather than `getByText` because
    // it is not guaranteed to land in the same microtask as the document row.
    expect(await within(table).findByText(/FIN/)).toBeInTheDocument();
  });

  it('shows the plain empty state when there is no filter and no data', async () => {
    vi.mocked(accountingApi.listAccountingDocuments).mockResolvedValue(
      paginated([]),
    );
    renderWithProviders(<DocumentsPage />);

    expect(await screen.findByText(t.documents.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(t.documents.emptyBody)).toBeInTheDocument();
  });

  it('shows the filtered-empty state when a URL filter narrows to nothing', async () => {
    vi.mocked(accountingApi.listAccountingDocuments).mockResolvedValue(
      paginated([]),
    );
    renderWithProviders(<DocumentsPage />, {
      initialEntries: ['/app/accounting/documents?state=final'],
    });

    expect(
      await screen.findByText(t.documents.emptyFilteredTitle),
    ).toBeInTheDocument();
    expect(screen.getByText(t.documents.emptyFilteredBody)).toBeInTheDocument();
  });

  it('surfaces a server error with a retry action', async () => {
    vi.mocked(accountingApi.listAccountingDocuments).mockRejectedValue(
      new ApiError({
        code: 'InternalError',
        message: 'boom',
        status: 500,
        correlationId: 'corr-list-1',
      }),
    );
    renderWithProviders(<DocumentsPage />);

    expect(
      await screen.findByText(t.documents.loadListFailed),
    ).toBeInTheDocument();
    expect(screen.getByText(/corr-list-1/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t.app.retry }),
    ).toBeInTheDocument();
  });

  it('surfaces a permission-denied failure the same safe way (never a raw backend message)', async () => {
    vi.mocked(accountingApi.listAccountingDocuments).mockRejectedValue(
      new ApiError({
        code: 'PermissionDenied',
        message: 'insufficient scope xyz',
        status: 403,
      }),
    );
    renderWithProviders(<DocumentsPage />);

    expect(
      await screen.findByText(t.documents.loadListFailed),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/insufficient scope xyz/),
    ).not.toBeInTheDocument();
  });
});

describe('Documents list — URL-owned filters', () => {
  it('initializes controls and the server query from a deep-linked URL', async () => {
    vi.mocked(accountingApi.listAccountingDocuments).mockResolvedValue(
      paginated([]),
    );
    renderWithProviders(<DocumentsPage />, {
      initialEntries: [
        '/app/accounting/documents?search=hazine&state=final&documentNumber=1001',
      ],
    });

    expect(await screen.findByLabelText(t.app.search)).toHaveValue('hazine');
    expect(screen.getByLabelText(t.documents.filterState)).toHaveValue('final');
    expect(screen.getByLabelText(t.documents.filterNumber)).toHaveValue('1001');
    await waitFor(() =>
      expect(accountingApi.listAccountingDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          search: 'hazine',
          state: 'final',
          documentNumber: '1001',
        }),
        expect.any(AbortSignal),
      ),
    );
  });

  it('applies a filter through the filter bar and reflects it in the URL', async () => {
    vi.mocked(accountingApi.listAccountingDocuments).mockResolvedValue(
      paginated([]),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <DocumentsPage />
        <HistoryControls />
      </>,
      { initialEntries: ['/app/accounting/documents'] },
    );

    await user.type(await screen.findByLabelText(t.app.search), 'bank');
    await user.selectOptions(
      screen.getByLabelText(t.documents.filterState),
      'temporary',
    );
    await user.click(screen.getByRole('button', { name: t.documents.apply }));

    await waitFor(() =>
      expect(screen.getByLabelText('location-search')).toHaveTextContent(
        'search=bank',
      ),
    );
    expect(screen.getByLabelText('location-search')).toHaveTextContent(
      'state=temporary',
    );
    await waitFor(() =>
      expect(accountingApi.listAccountingDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'bank', state: 'temporary' }),
        expect.any(AbortSignal),
      ),
    );
  });

  it('clears filters back to the URL defaults and re-queries unfiltered', async () => {
    vi.mocked(accountingApi.listAccountingDocuments).mockResolvedValue(
      paginated([]),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <DocumentsPage />
        <HistoryControls />
      </>,
      { initialEntries: ['/app/accounting/documents?search=bank&state=final'] },
    );

    await waitFor(() =>
      expect(screen.getByLabelText(t.app.search)).toHaveValue('bank'),
    );
    await user.click(screen.getByRole('button', { name: t.documents.clear }));

    // The URL — the single source of truth for the server query — drops
    // every filter param, and the very next request is the unfiltered list.
    await waitFor(() =>
      expect(screen.getByLabelText('location-search')).toBeEmptyDOMElement(),
    );
    await waitFor(() => {
      const lastCall = vi
        .mocked(accountingApi.listAccountingDocuments)
        .mock.calls.at(-1);
      expect(lastCall?.[0]).not.toHaveProperty('search');
      expect(lastCall?.[0]).not.toHaveProperty('state');
    });
    // KNOWN LIMITATION (pre-existing, out of the three approved issues):
    // `DocumentsFilterBar` re-seeds its uncontrolled `react-hook-form`
    // instance only through a `key`-remount of the `<form>` DOM node: the
    // `useForm()` call itself lives in the ALWAYS-mounted parent, so its
    // internal field values are never reset, and the visible inputs keep
    // showing the just-cleared text even though the URL and the server
    // query are correctly reset (verified above). See the Final Report.
  });

  it('follows browser Back and Forward across applied filters (URL + server query)', async () => {
    vi.mocked(accountingApi.listAccountingDocuments).mockResolvedValue(
      paginated([]),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <DocumentsPage />
        <HistoryControls />
      </>,
      { initialEntries: ['/app/accounting/documents?search=first'] },
    );

    const applySearch = async (value: string) => {
      const input = await screen.findByLabelText(t.app.search);
      await user.clear(input);
      await user.type(input, value);
      await user.click(screen.getByRole('button', { name: t.documents.apply }));
      await waitFor(() =>
        expect(screen.getByLabelText('location-search')).toHaveTextContent(
          `search=${value}`,
        ),
      );
    };

    await applySearch('second');
    await applySearch('third');

    await user.click(screen.getByRole('button', { name: 'back' }));
    await waitFor(() =>
      expect(screen.getByLabelText('location-search')).toHaveTextContent(
        'search=second',
      ),
    );
    await waitFor(() => {
      const lastCall = vi
        .mocked(accountingApi.listAccountingDocuments)
        .mock.calls.at(-1);
      expect(lastCall?.[0]).toMatchObject({ search: 'second' });
    });

    await user.click(screen.getByRole('button', { name: 'forward' }));
    await waitFor(() =>
      expect(screen.getByLabelText('location-search')).toHaveTextContent(
        'search=third',
      ),
    );
    await waitFor(() => {
      const lastCall = vi
        .mocked(accountingApi.listAccountingDocuments)
        .mock.calls.at(-1);
      expect(lastCall?.[0]).toMatchObject({ search: 'third' });
    });
    // Same KNOWN LIMITATION as above: the server query correctly follows
    // Back/Forward, but the visible search input does not resync to it
    // (the `useForm()` instance is never reset on a `key`-remount of a
    // CHILD `<form>` node). See the Final Report.
  });
});

describe('Documents list — pagination', () => {
  it('requests a new server page instead of slicing the cached one', async () => {
    vi.mocked(accountingApi.listAccountingDocuments).mockResolvedValue({
      items: [documentRow()],
      total: 120,
      page: 1,
      pageSize: 50,
    });
    const user = userEvent.setup();
    renderWithProviders(<DocumentsPage />);

    await screen.findByText('1001');
    await user.click(screen.getByRole('button', { name: t.table.next }));

    await waitFor(() =>
      expect(accountingApi.listAccountingDocuments).toHaveBeenCalledTimes(2),
    );
    const secondCall = vi.mocked(accountingApi.listAccountingDocuments).mock
      .calls[1];
    expect(secondCall?.[0]).toMatchObject({ page: 2 });
  });

  it('changes the page size through the pagination control', async () => {
    vi.mocked(accountingApi.listAccountingDocuments).mockResolvedValue({
      items: [documentRow()],
      total: 300,
      page: 1,
      pageSize: 50,
    });
    const user = userEvent.setup();
    renderWithProviders(<DocumentsPage />);

    await screen.findByText('1001');
    await user.selectOptions(screen.getByLabelText(t.table.pageSize), '100');

    await waitFor(() =>
      expect(accountingApi.listAccountingDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 100, page: 1 }),
        expect.any(AbortSignal),
      ),
    );
  });
});

describe('Documents list — permission-gated create action', () => {
  it('hides «ثبت سند» without Accounting.Document.Create', async () => {
    mockPermissions([
      PERMISSIONS.organization.view,
      PERMISSIONS.accounting.documentView,
    ]);
    vi.mocked(accountingApi.listAccountingDocuments).mockResolvedValue(
      paginated([]),
    );
    renderWithProviders(<DocumentsPage />);

    await screen.findByText(t.documents.emptyTitle);
    expect(
      screen.queryByRole('link', { name: new RegExp(t.documents.create) }),
    ).not.toBeInTheDocument();
  });

  it('shows «ثبت سند» with Accounting.Document.Create', async () => {
    mockPermissions([
      PERMISSIONS.organization.view,
      PERMISSIONS.accounting.documentView,
      PERMISSIONS.accounting.documentCreate,
    ]);
    vi.mocked(accountingApi.listAccountingDocuments).mockResolvedValue(
      paginated([]),
    );
    renderWithProviders(<DocumentsPage />);

    const link = await screen.findByRole('link', {
      name: new RegExp(t.documents.create),
    });
    expect(within(link).getByText(t.documents.create)).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/app/accounting/documents/new');
  });
});
