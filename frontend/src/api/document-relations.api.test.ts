import type { AxiosResponse } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './client';
import {
  createDocumentRelation,
  deleteDocumentRelation,
  getDocumentRelation,
  listDocumentRelations,
} from './documents.api';

const org = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

function reply(data: unknown = {}) {
  return Promise.resolve({ data } as AxiosResponse);
}

beforeEach(() => {
  vi.spyOn(apiClient, 'get').mockImplementation(reply);
  vi.spyOn(apiClient, 'post').mockImplementation(reply);
  vi.spyOn(apiClient, 'delete').mockImplementation(reply);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('documents.api — DocumentRelationsController contract', () => {
  it('lists relations with organizationId and all 7 filters + sort', async () => {
    await listDocumentRelations({
      organizationId: org,
      page: 2,
      pageSize: 25,
      relationKind: 'fulfill',
      sourceModule: 'sales',
      sourceDocumentType: 'sales_invoice',
      sourceDocumentId: org,
      targetModule: 'accounting',
      targetDocumentType: 'accounting_journal',
      targetDocumentId: org,
      sort: 'createdAt:asc',
    });

    expect(apiClient.get).toHaveBeenCalledWith(
      '/documents/relations',
      expect.objectContaining({
        params: {
          organizationId: org,
          page: 2,
          pageSize: 25,
          relationKind: 'fulfill',
          sourceModule: 'sales',
          sourceDocumentType: 'sales_invoice',
          sourceDocumentId: org,
          targetModule: 'accounting',
          targetDocumentType: 'accounting_journal',
          targetDocumentId: org,
          sort: 'createdAt:asc',
        },
      }),
    );
  });

  it('omits empty filters from the list request', async () => {
    await listDocumentRelations({
      organizationId: org,
      page: 1,
      pageSize: 50,
    });

    expect(vi.mocked(apiClient.get).mock.calls[0]?.[1]?.params).toEqual({
      organizationId: org,
      page: 1,
      pageSize: 50,
    });
  });

  it('gets one relation by id scoped by organization', async () => {
    await getDocumentRelation(org, '01ARZ3NDEKTSV4RRFFQ69G5FB1');

    expect(apiClient.get).toHaveBeenCalledWith(
      '/documents/relations/01ARZ3NDEKTSV4RRFFQ69G5FB1',
      expect.objectContaining({ params: { organizationId: org } }),
    );
  });

  it('creates with organizationId + source/target + relationKind + quantity', async () => {
    await createDocumentRelation({
      organizationId: org,
      source: {
        module: 'sales',
        documentType: 'sales_invoice',
        documentId: org,
      },
      target: {
        module: 'accounting',
        documentType: 'accounting_journal',
        documentId: org,
      },
      relationKind: 'fulfill',
      quantity: '12.5',
    });

    expect(apiClient.post).toHaveBeenCalledWith('/documents/relations', {
      organizationId: org,
      source: {
        module: 'sales',
        documentType: 'sales_invoice',
        documentId: org,
      },
      target: {
        module: 'accounting',
        documentType: 'accounting_journal',
        documentId: org,
      },
      relationKind: 'fulfill',
      quantity: '12.5',
    });
  });

  it('deletes by id with organizationId query', async () => {
    await deleteDocumentRelation(org, '01ARZ3NDEKTSV4RRFFQ69G5FB1');

    expect(apiClient.delete).toHaveBeenCalledWith(
      '/documents/relations/01ARZ3NDEKTSV4RRFFQ69G5FB1',
      expect.objectContaining({ params: { organizationId: org } }),
    );
  });

  it('encodes relation id in detail and delete paths', async () => {
    await getDocumentRelation(org, 'id/with slash');
    expect(vi.mocked(apiClient.get).mock.calls[0]?.[0]).toBe(
      '/documents/relations/id%2Fwith%20slash',
    );
  });
});
