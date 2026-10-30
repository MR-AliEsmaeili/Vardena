import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocumentRelation } from '@/api/documents.api';
import type { DocumentRelation } from '@/api/contracts';
import { ApiError } from '@/api/errors';
import { useOrganizationId } from '@/features/organization/use-organization';
import { t } from '@/lib/i18n';
import { testOrganization } from '@/test/fixtures';
import { renderWithProviders } from '@/test/test-utils';
import { DocumentRelationDetailPage } from './document-relation-detail-page';

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
  source: { module: 'sales', documentType: 'sales_invoice', documentId: '01ARZ3NDEKTSV4RRFFQ69G5FB1', lineId: null },
  target: { module: 'accounting', documentType: 'accounting_journal', documentId: '01ARZ3NDEKTSV4RRFFQ69G5FC2', lineId: '01ARZ3NDEKTSV4RRFFQ69G5FD3' },
  relationKind: 'fulfill',
  quantity: '10.5000',
  createdByProcess: true,
  createdAt: '2026-01-02T00:00:00.000Z',
};

beforeEach(() => {
  vi.mocked(useOrganizationId).mockReturnValue(testOrganization.id);
  vi.mocked(getDocumentRelation).mockResolvedValue(relation);
});

function renderDetail(id = relation.id) {
  const routes = (
    <Routes>
      <Route path="/app/documents/relations/:relationId" element={<DocumentRelationDetailPage />} />
    </Routes>
  );
  renderWithProviders(routes, {
    initialEntries: [`/app/documents/relations/${id}`],
  });
}

describe('DocumentRelationDetailPage', () => {
  it('renders source/target and quantity from server', async () => {
    renderDetail();
    expect(await screen.findByText(relation.source.module)).toBeInTheDocument();
    expect(screen.getByText(relation.target.module)).toBeInTheDocument();
    expect(screen.getByText('10.5000')).toBeInTheDocument();
  });

  it('shows load error with retry description', async () => {
    vi.mocked(getDocumentRelation).mockRejectedValue(new ApiError({ code: 'EntityNotFound', message: 'not found' }));
    renderDetail('missing');
    expect(await screen.findByText(t.documentRelations.errors.notFound)).toBeInTheDocument();
  });
});
