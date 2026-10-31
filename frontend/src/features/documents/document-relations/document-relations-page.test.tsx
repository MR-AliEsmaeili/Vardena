import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listDocumentRelations } from '@/api/documents.api';
import type { DocumentRelation, Paginated } from '@/api/contracts';
import { ApiError } from '@/api/errors';
import { useOrganizationId } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import { testOrganization } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { DocumentRelationsPage } from './document-relations-page';

vi.mock('@/api/documents.api', () => ({
  listDocumentRelations: vi.fn(),
  getDocumentRelation: vi.fn(),
  createDocumentRelation: vi.fn(),
  deleteDocumentRelation: vi.fn(),
}));
vi.mock('@/features/organization/use-organization', () => ({
  useOrganizationId: vi.fn(),
}));

const relation: DocumentRelation = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  organizationId: testOrganization.id,
  source: {
    module: 'sales',
    documentType: 'sales_invoice',
    documentId: '01ARZ3NDEKTSV4RRFFQ69G5FB1',
    lineId: null,
  },
  target: {
    module: 'accounting',
    documentType: 'accounting_journal',
    documentId: '01ARZ3NDEKTSV4RRFFQ69G5FC2',
    lineId: null,
  },
  relationKind: 'reference',
  quantity: null,
  createdByProcess: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function page(items: DocumentRelation[]): Paginated<DocumentRelation> {
  return { items, total: items.length, page: 1, pageSize: 50 };
}

beforeEach(() => {
  vi.mocked(useOrganizationId).mockReturnValue(testOrganization.id);
  vi.mocked(listDocumentRelations).mockResolvedValue(page([relation]));
});

describe('DocumentRelationsPage', () => {
  it('renders relations from the server', async () => {
    renderWithProviders(<DocumentRelationsPage />, {
      initialEntries: ['/app/documents/relations'],
    });
    const table = await screen.findByRole('table');
    expect(
      within(table).getByText(t.documentRelations.kinds.reference),
    ).toBeInTheDocument();
    expect(listDocumentRelations).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: testOrganization.id }),
      expect.anything(),
    );
  });

  it('shows empty state when no relations', async () => {
    vi.mocked(listDocumentRelations).mockResolvedValue(page([]));
    renderWithProviders(<DocumentRelationsPage />, {
      initialEntries: ['/app/documents/relations'],
    });
    expect(
      await screen.findByText(t.documentRelations.emptyTitle),
    ).toBeInTheDocument();
  });

  it('shows error state when load fails', async () => {
    vi.mocked(listDocumentRelations).mockRejectedValue(
      new ApiError({ code: 'InternalError', message: 'boom' }),
    );
    renderWithProviders(<DocumentRelationsPage />, {
      initialEntries: ['/app/documents/relations'],
    });
    expect(
      await screen.findByText(t.documentRelations.loadFailed),
    ).toBeInTheDocument();
  });
});
