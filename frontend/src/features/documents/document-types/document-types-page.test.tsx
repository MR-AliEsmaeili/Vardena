import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listDocumentTypes } from '@/api/documents.api';
import type { DocumentType, Paginated } from '@/api/contracts';
import { ApiError } from '@/api/errors';
import { useOrganizationId } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import { testOrganization } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import {
  DocumentTypesPage,
  documentTypeDetailPath,
} from './document-types-page';

vi.mock('@/api/documents.api', () => ({
  listDocumentTypes: vi.fn(),
  getDocumentType: vi.fn(),
  configureDocumentType: vi.fn(),
}));
vi.mock('@/features/organization/use-organization', () => ({
  useOrganizationId: vi.fn(),
}));

/** Registry views — the codes come from the SERVER, never from a UI list. */
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
const voucher: DocumentType = {
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

function page(items: DocumentType[]): Paginated<DocumentType> {
  return { items, total: items.length, page: 1, pageSize: 50 };
}

/** Exposes the MemoryRouter location so URL-owned filters can be asserted. */
function LocationProbe() {
  const location = useLocation();
  return (
    <span data-testid="location">{`${location.pathname}${location.search}`}</span>
  );
}

function renderPage(entry = '/app/documents/types') {
  return renderWithProviders(
    <>
      <DocumentTypesPage />
      <LocationProbe />
    </>,
    { initialEntries: [entry] },
  );
}

beforeEach(() => {
  vi.mocked(useOrganizationId).mockReturnValue(testOrganization.id);
  vi.mocked(listDocumentTypes).mockResolvedValue(page([receipt, voucher]));
});

describe('DocumentTypesPage', () => {
  it('renders the registry from the server with the exact query (no sort)', async () => {
    renderPage();

    const table = await screen.findByRole('table');
    const grid = within(table);
    expect(grid.getByText(receipt.code)).toBeInTheDocument();
    expect(grid.getByText(voucher.code)).toBeInTheDocument();
    expect(
      grid.getAllByRole('link', { name: t.documentTypes.view }),
    ).toHaveLength(2);
    // No create/delete surface: the backend has no POST/DELETE endpoint.
    expect(screen.getByTestId('document-type-registry-note')).toHaveTextContent(
      t.documentTypes.registryNote,
    );
    expect(
      screen.queryByRole('link', { name: /جدید|حذف/ }),
    ).not.toBeInTheDocument();

    expect(listDocumentTypes).toHaveBeenCalledWith(
      {
        organizationId: testOrganization.id,
        page: 1,
        pageSize: 50,
      },
      expect.anything(),
    );
    const [query] = vi.mocked(listDocumentTypes).mock.calls[0]!;
    expect(query).not.toHaveProperty('sort');
  });

  it('links each row to the encoded detail route', async () => {
    renderPage();
    const links = await screen.findAllByRole('link', {
      name: t.documentTypes.view,
    });
    expect(links[0]).toHaveAttribute(
      'href',
      documentTypeDetailPath(receipt.code),
    );
  });

  it('renders the first-run empty state without a create action', async () => {
    vi.mocked(listDocumentTypes).mockResolvedValue(page([]));
    renderPage();

    expect(
      await screen.findByText(t.documentTypes.emptyBody),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /جدید|ایجاد/ }),
    ).not.toBeInTheDocument();
  });

  it('shows the failure with a working retry', async () => {
    const user = userEvent.setup();
    vi.mocked(listDocumentTypes)
      .mockRejectedValueOnce(
        new ApiError({ code: 'InternalError', message: 'boom' }),
      )
      .mockResolvedValueOnce(page([receipt]));
    renderPage();

    expect(
      await screen.findByText(t.documentTypes.loadFailed),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.app.retry }));

    await waitFor(() =>
      expect(screen.getByText(receipt.code)).toBeInTheDocument(),
    );
    expect(listDocumentTypes).toHaveBeenCalledTimes(2);
  });

  it('reads search/page/pageSize from the URL and applies a new search to it', async () => {
    const user = userEvent.setup();
    renderPage('/app/documents/types?search=receipt&page=2&pageSize=25');

    expect(await screen.findByTestId('location')).toHaveTextContent(
      '?search=receipt&page=2&pageSize=25',
    );
    await waitFor(() =>
      expect(listDocumentTypes).toHaveBeenCalledWith(
        {
          organizationId: testOrganization.id,
          page: 2,
          pageSize: 25,
          search: 'receipt',
        },
        expect.anything(),
      ),
    );
    expect(vi.mocked(listDocumentTypes).mock.calls[0]?.[0]).not.toHaveProperty(
      'sort',
    );

    const search = screen.getByRole('textbox', {
      name: t.documentTypes.searchLabel,
    });
    await user.clear(search);
    await user.type(search, 'accounting');
    await user.click(screen.getByRole('button', { name: t.app.apply }));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        /search=accounting/,
      ),
    );
    await waitFor(() =>
      expect(listDocumentTypes).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'accounting', page: 1 }),
        expect.anything(),
      ),
    );
  });
});
