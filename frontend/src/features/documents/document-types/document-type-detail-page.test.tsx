import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentType } from '@/api/contracts';
import { configureDocumentType, getDocumentType } from '@/api/documents.api';
import { ApiError } from '@/api/errors';
import { useOrganizationId } from '@/features/organization/use-organization';
import { PERMISSIONS } from '@/features/permissions/permission-codes';
import { usePermissions } from '@/features/permissions/use-permissions';
import { t } from '@/lib/i18n';
import { testOrganization } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { ToastProvider } from '@/ui/patterns/toast';
import { DocumentTypeDetailPage } from './document-type-detail-page';

vi.mock('@/api/documents.api', () => ({
  listDocumentTypes: vi.fn(),
  getDocumentType: vi.fn(),
  configureDocumentType: vi.fn(),
}));
vi.mock('@/features/organization/use-organization', () => ({
  useOrganizationId: vi.fn(),
}));
vi.mock('@/features/permissions/use-permissions', () => ({
  usePermissions: vi.fn(),
}));

const receipt: DocumentType = {
  code: 'inventory_receipt',
  module: 'inventory',
  name: 'Inventory receipt',
  description: 'Goods received into stock.',
  draftCapable: true,
  entryStates: ['temporary', 'final'],
  deletablePhases: ['draft', 'temporary'],
  draftRequired: false,
  configured: false,
};
const notDraftCapable: DocumentType = {
  code: 'accounting_voucher',
  module: 'accounting',
  name: 'Accounting voucher',
  description: null,
  draftCapable: false,
  entryStates: ['final'],
  deletablePhases: [],
  draftRequired: false,
  configured: true,
};

function grantPermissions(codes: string[]) {
  vi.mocked(usePermissions).mockReturnValue({
    codes,
    loaded: true,
    has: (code) => codes.includes(code),
    hasAll: (list) => list.every((code) => codes.includes(code)),
    hasAny: (list) => list.some((code) => codes.includes(code)),
  });
}

function renderDetail(code = receipt.code, type?: DocumentType) {
  // Only override the default resolved value when a test needs a different
  // registry entry; a test that pre-seeds a rejection keeps its own mock.
  if (type !== undefined) {
    vi.mocked(getDocumentType).mockResolvedValue(type);
  }
  const routes = (
    <Routes>
      <Route
        path="/app/documents/types/:code"
        element={<DocumentTypeDetailPage />}
      />
      <Route path="/app/documents/types" element={<p>list</p>} />
    </Routes>
  );
  renderWithProviders(<ToastProvider>{routes}</ToastProvider>, {
    initialEntries: [`/app/documents/types/${code}`],
    withProviders: false,
  });
}

beforeEach(() => {
  vi.mocked(useOrganizationId).mockReturnValue(testOrganization.id);
  grantPermissions([
    PERMISSIONS.documents.documentTypeView,
    PERMISSIONS.documents.documentTypeConfigure,
  ]);
  vi.mocked(getDocumentType).mockResolvedValue(receipt);
  vi.mocked(configureDocumentType).mockResolvedValue({
    ...receipt,
    draftRequired: true,
    configured: true,
  });
});

describe('DocumentTypeDetailPage', () => {
  it('renders every field of the backend contract', async () => {
    renderDetail();

    expect(
      await screen.findByText(
        `${t.documentTypes.detailTitle} — ${receipt.code}`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('document-type-code')).toHaveTextContent(
      receipt.code,
    );
    expect(screen.getByText(receipt.module)).toBeInTheDocument();
    expect(screen.getByText(receipt.name)).toBeInTheDocument();
    expect(screen.getByText(receipt.description ?? '')).toBeInTheDocument();
    expect(
      screen.getByText(
        `${t.documentTypes.stateNames.temporary}${t.documentTypes.listSeparator}${t.documentTypes.stateNames.final}`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `${t.documentTypes.phaseNames.draft}${t.documentTypes.listSeparator}${t.documentTypes.phaseNames.temporary}`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(t.documentTypes.notConfigured)).toBeInTheDocument();
    expect(
      screen.getByTestId('document-type-draft-required-value'),
    ).toHaveTextContent(t.app.no);
  });

  it('saves only draftRequired and displays the server response, not the form value', async () => {
    const user = userEvent.setup();
    // The server is authoritative: even if it returns a different value, the
    // checkbox must follow the response rather than the optimistic form state.
    vi.mocked(configureDocumentType).mockResolvedValue({
      ...receipt,
      draftRequired: false,
      configured: true,
    });
    renderDetail();

    const checkbox = await screen.findByTestId('document-type-draft-required');
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    await user.click(
      screen.getByRole('button', { name: t.documentTypes.save }),
    );

    await waitFor(() =>
      expect(configureDocumentType).toHaveBeenCalledWith(
        testOrganization.id,
        receipt.code,
        { draftRequired: true },
      ),
    );
    const saved = await screen.findByTestId('document-type-saved-value');
    expect(saved).toHaveTextContent(t.documentTypes.savedValue);
    expect(saved).toHaveTextContent(t.app.no);
    await waitFor(() => expect(checkbox).not.toBeChecked());
  });

  it('does not allow changes without the exact Configure permission', async () => {
    grantPermissions([PERMISSIONS.documents.documentTypeView]);
    renderDetail();

    expect(
      await screen.findByTestId('document-type-draft-required'),
    ).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: t.documentTypes.save }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(t.documentTypes.noConfigurePermission),
    ).toBeInTheDocument();
  });

  it('disables the control for a type that has no draft phase', async () => {
    renderDetail(notDraftCapable.code, notDraftCapable);

    expect(
      await screen.findByTestId('document-type-draft-required'),
    ).toBeDisabled();
    expect(
      screen.getByText(t.documentTypes.draftNotCapableHint),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t.documentTypes.save }),
    ).not.toBeInTheDocument();
    expect(configureDocumentType).not.toHaveBeenCalled();
  });

  it('maps a 422 business rule to domain copy, never the raw backend message', async () => {
    const user = userEvent.setup();
    vi.mocked(configureDocumentType).mockRejectedValue(
      new ApiError({
        code: 'BusinessRuleViolation',
        message:
          'Document type "inventory_receipt" does not support the draft phase, so draft cannot be required.',
      }),
    );
    renderDetail();

    const checkbox = await screen.findByTestId('document-type-draft-required');
    await user.click(checkbox);
    await user.click(
      screen.getByRole('button', { name: t.documentTypes.save }),
    );

    expect(
      await screen.findByText(t.documentTypes.errors.draftNotSupported),
    ).toBeInTheDocument();
    expect(screen.queryByText(/does not support the draft phase/)).toBeNull();
  });

  it('shows the load failure with a working retry', async () => {
    const user = userEvent.setup();
    vi.mocked(getDocumentType)
      .mockRejectedValueOnce(
        new ApiError({ code: 'InternalError', message: 'boom' }),
      )
      .mockResolvedValueOnce(receipt);
    renderDetail();

    expect(
      await screen.findByText(t.documentTypes.loadFailed),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.app.retry }));
    expect(await screen.findByTestId('document-type-code')).toHaveTextContent(
      receipt.code,
    );
    expect(getDocumentType).toHaveBeenCalledTimes(2);
  });

  it('explains an unregistered code with the not-found domain copy', async () => {
    vi.mocked(getDocumentType).mockRejectedValue(
      new ApiError({
        code: 'EntityNotFound',
        message: 'Document type was not found.',
      }),
    );
    renderDetail('unknown_code');

    expect(
      await screen.findByText(t.documentTypes.errors.notFound),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Document type was not found/)).toBeNull();
  });
});
