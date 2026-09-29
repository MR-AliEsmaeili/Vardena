import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import type { AccountingDocument } from '@/api/contracts';
import { t } from '@/lib/i18n';
import {
  allAccountingPermissions,
  paginated,
  testOrganization,
  testUser,
} from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import {
  DocumentActionDialog,
  type DialogKind,
} from './document-action-dialogs';

/**
 * FE-UX-08 §10/§11 regression coverage: the lifecycle action dialogs
 * (issue / finalize / reverse / delete) driven directly through
 * `DocumentActionDialog`, mirroring exactly how `DocumentDetailPage` opens
 * them. Permission-aware VISIBILITY of the triggering buttons (per document
 * state) is covered separately in `document-detail-page.test.tsx`; this file
 * covers each dialog's own confirmation / success / error / duplicate-submit
 * behavior once it is open.
 */

vi.mock('@/api/identity.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));
vi.mock('@/api/organization.api', () => ({
  listOrganizations: vi.fn(),
  MAX_PAGE_SIZE: 500,
}));
vi.mock('@/api/accounting.api', async () => {
  const actual = await vi.importActual<typeof import('@/api/accounting.api')>(
    '@/api/accounting.api',
  );
  return {
    ACCOUNTING_DOCUMENT_SORT_FIELDS: actual.ACCOUNTING_DOCUMENT_SORT_FIELDS,
    issueAccountingDocument: vi.fn(),
    finalizeAccountingDocument: vi.fn(),
    reverseAccountingDocument: vi.fn(),
    deleteAccountingDocument: vi.fn(),
  };
});

const identityApi = await import('@/api/identity.api');
const organizationApi = await import('@/api/organization.api');
const accountingApi = await import('@/api/accounting.api');

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
    lines: [],
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

function Harness({ initialKind }: { initialKind: DialogKind }) {
  const [kind, setKind] = useState<DialogKind | null>(initialKind);
  return (
    <>
      <DocumentActionDialog
        kind={kind}
        onClose={() => setKind(null)}
        organizationId="org-1"
        documentId="doc-1"
        documentNumber="1001"
      />
      <Loc />
    </>
  );
}

function renderDialog(kind: DialogKind) {
  return renderWithProviders(
    <Routes>
      <Route path="*" element={<Harness initialKind={kind} />} />
    </Routes>,
    { initialEntries: ['/start'] },
  );
}

beforeEach(() => {
  vi.mocked(identityApi.getCurrentUser).mockResolvedValue(testUser);
  vi.mocked(identityApi.getEffectivePermissions).mockResolvedValue({
    userId: testUser.id,
    permissions: allAccountingPermissions,
  });
  vi.mocked(organizationApi.listOrganizations).mockResolvedValue(
    paginated([testOrganization]),
  );
});

describe('Issue dialog', () => {
  it('shows a confirmation with the document number, and confirming issues it once with a success toast', async () => {
    vi.mocked(accountingApi.issueAccountingDocument).mockResolvedValue(
      documentFixture({ state: 'temporary' }),
    );
    const user = userEvent.setup();
    renderDialog('issue');

    expect(
      await screen.findByRole('heading', { name: t.documents.issueTitle }),
    ).toBeInTheDocument();
    expect(screen.getByText('1001')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: t.documents.issueConfirm }),
    );

    await waitFor(() =>
      expect(accountingApi.issueAccountingDocument).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByText(t.documents.issued)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: t.documents.issueTitle }),
    ).not.toBeInTheDocument();
  });

  it('keeps the dialog open and shows the mapped error when the mutation fails', async () => {
    vi.mocked(accountingApi.issueAccountingDocument).mockRejectedValue(
      new ApiError({
        code: 'BusinessRuleViolation',
        message: 'raw backend text — must never be shown',
        status: 422,
        details: { problem: 'account_disabled' },
      }),
    );
    const user = userEvent.setup();
    renderDialog('issue');

    await screen.findByRole('heading', { name: t.documents.issueTitle });
    await user.click(
      screen.getByRole('button', { name: t.documents.issueConfirm }),
    );

    expect(
      await screen.findByText(t.documents.business.accountDisabled),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: t.documents.issueTitle }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/raw backend text/)).not.toBeInTheDocument();
  });

  it('does not issue twice for a rapid double-click (duplicate-submit protection)', async () => {
    let resolveIssue!: (value: AccountingDocument) => void;
    vi.mocked(accountingApi.issueAccountingDocument).mockReturnValue(
      new Promise((resolve) => {
        resolveIssue = resolve;
      }),
    );
    const user = userEvent.setup();
    renderDialog('issue');

    await screen.findByRole('heading', { name: t.documents.issueTitle });
    await user.click(
      screen.getByRole('button', { name: t.documents.issueConfirm }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: t.documents.issueLoading }),
      ).toBeDisabled(),
    );
    await user.click(
      screen.getByRole('button', { name: t.documents.issueLoading }),
    );

    expect(accountingApi.issueAccountingDocument).toHaveBeenCalledTimes(1);
    resolveIssue(documentFixture({ state: 'temporary' }));
    await screen.findByText(t.documents.issued);
  });
});

describe('Finalize dialog', () => {
  it('confirms and finalizes with a success toast', async () => {
    vi.mocked(accountingApi.finalizeAccountingDocument).mockResolvedValue(
      documentFixture({ state: 'final' }),
    );
    const user = userEvent.setup();
    renderDialog('finalize');

    expect(
      await screen.findByText(t.documents.finalizeTitle),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: t.documents.finalizeConfirm }),
    );

    await waitFor(() =>
      expect(accountingApi.finalizeAccountingDocument).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByText(t.documents.finalized)).toBeInTheDocument();
  });

  it('keeps the dialog open on a mutation error', async () => {
    vi.mocked(accountingApi.finalizeAccountingDocument).mockRejectedValue(
      new ApiError({
        code: 'BusinessRuleViolation',
        message: 'raw',
        status: 422,
        details: { problem: 'account_not_postable' },
      }),
    );
    const user = userEvent.setup();
    renderDialog('finalize');

    await screen.findByText(t.documents.finalizeTitle);
    await user.click(
      screen.getByRole('button', { name: t.documents.finalizeConfirm }),
    );

    expect(
      await screen.findByText(t.documents.business.accountNotPostable),
    ).toBeInTheDocument();
    expect(screen.getByText(t.documents.finalizeTitle)).toBeInTheDocument();
  });
});

describe('Reverse dialog', () => {
  it('requires a non-empty reason before confirming', async () => {
    const user = userEvent.setup();
    renderDialog('reverse');

    await screen.findByText(t.documents.reverseTitle);
    await user.click(
      screen.getByRole('button', { name: t.documents.reverseConfirm }),
    );

    expect(
      await screen.findByText(t.documents.reverseReasonRequired),
    ).toBeInTheDocument();
    expect(accountingApi.reverseAccountingDocument).not.toHaveBeenCalled();
  });

  it('reverses with the typed reason, shows a success toast whose action navigates to the resulting document', async () => {
    vi.mocked(accountingApi.reverseAccountingDocument).mockResolvedValue(
      documentFixture({ id: 'doc-rev', state: 'final' }),
    );
    const user = userEvent.setup();
    renderDialog('reverse');

    await screen.findByText(t.documents.reverseTitle);
    await user.type(
      screen.getByLabelText(t.documents.reverseReason),
      'اشتباه ثبت شده بود',
    );
    await user.click(
      screen.getByRole('button', { name: t.documents.reverseConfirm }),
    );

    await waitFor(() =>
      expect(accountingApi.reverseAccountingDocument).toHaveBeenCalledWith(
        'org-1',
        'doc-1',
        expect.objectContaining({ reason: 'اشتباه ثبت شده بود' }),
      ),
    );
    expect(await screen.findByText(t.documents.reversed)).toBeInTheDocument();

    const actionButton = screen.getByRole('button', {
      name: t.documents.viewReversal,
    });
    await user.click(actionButton);

    await waitFor(() =>
      expect(screen.getByLabelText('loc-pathname')).toHaveTextContent(
        '/app/accounting/documents/doc-rev',
      ),
    );
  });

  it('keeps the dialog open with the mapped error on a mutation failure, preserving the typed reason', async () => {
    vi.mocked(accountingApi.reverseAccountingDocument).mockRejectedValue(
      new ApiError({
        code: 'BusinessRuleViolation',
        message: 'raw',
        status: 422,
        details: { problem: 'already_reversed' },
      }),
    );
    const user = userEvent.setup();
    renderDialog('reverse');

    await screen.findByText(t.documents.reverseTitle);
    await user.type(
      screen.getByLabelText(t.documents.reverseReason),
      'دلیل برگشت',
    );
    await user.click(
      screen.getByRole('button', { name: t.documents.reverseConfirm }),
    );

    expect(
      await screen.findByText(t.documents.business.alreadyReversed),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(t.documents.reverseReason)).toHaveValue(
      'دلیل برگشت',
    );
  });

  it('does not reverse twice for a rapid double-click (duplicate-submit protection)', async () => {
    let resolveReverse!: (value: AccountingDocument) => void;
    vi.mocked(accountingApi.reverseAccountingDocument).mockReturnValue(
      new Promise((resolve) => {
        resolveReverse = resolve;
      }),
    );
    const user = userEvent.setup();
    renderDialog('reverse');

    await screen.findByText(t.documents.reverseTitle);
    await user.type(
      screen.getByLabelText(t.documents.reverseReason),
      'دلیل برگشت',
    );
    await user.click(
      screen.getByRole('button', { name: t.documents.reverseConfirm }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: t.documents.reverseLoading }),
      ).toBeDisabled(),
    );
    await user.click(
      screen.getByRole('button', { name: t.documents.reverseLoading }),
    );

    expect(accountingApi.reverseAccountingDocument).toHaveBeenCalledTimes(1);
    resolveReverse(documentFixture({ id: 'doc-rev', state: 'final' }));
    await screen.findByText(t.documents.reversed);
  });
});

describe('Delete dialog', () => {
  it('confirms, deletes, shows a success toast and navigates to the list', async () => {
    vi.mocked(accountingApi.deleteAccountingDocument).mockResolvedValue(
      documentFixture({ id: 'doc-1' }),
    );
    const user = userEvent.setup();
    renderDialog('delete');

    expect(
      await screen.findByRole('heading', { name: t.documents.deleteTitle }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: t.documents.deleteConfirm }),
    );

    await waitFor(() =>
      expect(accountingApi.deleteAccountingDocument).toHaveBeenCalledWith(
        'org-1',
        'doc-1',
      ),
    );
    expect(await screen.findByText(t.documents.deleted)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('loc-pathname')).toHaveTextContent(
        '/app/accounting/documents',
      ),
    );
  });

  it('keeps the dialog open on a mutation error', async () => {
    vi.mocked(accountingApi.deleteAccountingDocument).mockRejectedValue(
      new ApiError({
        code: 'BusinessRuleViolation',
        message: 'raw',
        status: 422,
        details: { problem: 'not_deletable' },
      }),
    );
    const user = userEvent.setup();
    renderDialog('delete');

    await screen.findByRole('heading', { name: t.documents.deleteTitle });
    await user.click(
      screen.getByRole('button', { name: t.documents.deleteConfirm }),
    );

    // Unmapped `details.problem` falls back to the generic business-rule copy.
    expect(
      await screen.findByText(t.documents.business.generic),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: t.documents.deleteTitle }),
    ).toBeInTheDocument();
    expect(accountingApi.deleteAccountingDocument).toHaveBeenCalledTimes(1);
  });
});
