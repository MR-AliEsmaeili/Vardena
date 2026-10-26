import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentType, Paginated } from '@/api/contracts';
import { queryKeys } from '@/api/query-keys';
import { createTestQueryClient } from '@/test/test-utils';
import {
  useConfigureDocumentTypeMutation,
  useDocumentTypes,
  type DocumentTypeListState,
} from './use-document-types';

vi.mock('@/api/documents.api', () => ({
  listDocumentTypes: vi.fn(),
  getDocumentType: vi.fn(),
  configureDocumentType: vi.fn(),
}));
const api = await import('@/api/documents.api');

const org = 'org-1';
const code = 'inventory_receipt';
const type: DocumentType = {
  code,
  module: 'inventory',
  name: 'Inventory receipt',
  description: 'Goods received into stock.',
  draftCapable: true,
  entryStates: ['temporary', 'final'],
  deletablePhases: ['draft', 'temporary'],
  draftRequired: false,
  configured: false,
};
const state: DocumentTypeListState = { page: 1, pageSize: 50, search: '' };

function setup() {
  const client = createTestQueryClient();
  const invalidated = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, invalidated, wrapper };
}

describe('document-type queries and configuration mutation', () => {
  it('invalidates the detail AND the list, and caches the server response', async () => {
    const { client, invalidated, wrapper } = setup();
    const listKey = queryKeys.documents.documentTypes(org, { ...state });
    const detailKey = queryKeys.documents.documentType(org, code);
    const list: Paginated<DocumentType> = {
      items: [type],
      total: 1,
      page: 1,
      pageSize: 50,
    };
    client.setQueryData(listKey, list);
    client.setQueryData(detailKey, type);

    const saved: DocumentType = {
      ...type,
      draftRequired: true,
      configured: true,
    };
    vi.mocked(api.configureDocumentType).mockResolvedValue(saved);

    const { result } = renderHook(
      () => useConfigureDocumentTypeMutation(org, code),
      { wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync({ draftRequired: true });
    });

    expect(api.configureDocumentType).toHaveBeenCalledWith(org, code, {
      draftRequired: true,
    });
    expect(invalidated).toHaveBeenCalledWith({
      queryKey: queryKeys.documents.documentTypesPrefix(org),
    });
    expect(client.getQueryData(detailKey)).toEqual(saved);
    // The single prefix invalidation covers BOTH cached surfaces.
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(detailKey)?.isInvalidated).toBe(true);
  });

  it('never sends a sort parameter for the registry list', async () => {
    const { wrapper } = setup();
    vi.mocked(api.listDocumentTypes).mockResolvedValue({
      items: [type],
      total: 1,
      page: 1,
      pageSize: 50,
    });

    const { result } = renderHook(
      () => useDocumentTypes(org, { ...state, search: 'receipt' }),
      { wrapper },
    );
    await act(async () => {
      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    expect(api.listDocumentTypes).toHaveBeenCalledWith(
      {
        organizationId: org,
        page: 1,
        pageSize: 50,
        search: 'receipt',
      },
      expect.anything(),
    );
    expect(
      vi.mocked(api.listDocumentTypes).mock.calls[0]?.[0],
    ).not.toHaveProperty('sort');
  });
});
