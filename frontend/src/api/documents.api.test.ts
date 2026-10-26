import type { AxiosResponse } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './client';
import {
  configureDocumentType,
  getDocumentType,
  listDocumentTypes,
} from './documents.api';

/**
 * Wire-level contract of DOC-01: exactly the three controller operations,
 * exactly the declared parameters, and NO `sort` on the registry list (the
 * service ignores it). The transport is spied at the single Axios instance so
 * no network and no database is involved.
 */
const org = 'org-1';

function reply(data: unknown = {}) {
  return Promise.resolve({ data } as AxiosResponse);
}

beforeEach(() => {
  vi.spyOn(apiClient, 'get').mockImplementation(reply);
  vi.spyOn(apiClient, 'put').mockImplementation(reply);
  vi.spyOn(apiClient, 'post').mockImplementation(reply);
  vi.spyOn(apiClient, 'delete').mockImplementation(reply);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('documents.api — DocumentTypesController contract', () => {
  it('lists registry entries with only organizationId/page/pageSize/search', async () => {
    await listDocumentTypes({
      organizationId: org,
      page: 2,
      pageSize: 25,
      search: 'receipt',
    });

    expect(apiClient.get).toHaveBeenCalledWith(
      '/documents/types',
      expect.objectContaining({
        params: {
          organizationId: org,
          page: 2,
          pageSize: 25,
          search: 'receipt',
        },
      }),
    );
    const config = vi.mocked(apiClient.get).mock.calls[0]?.[1];
    expect(config?.params).not.toHaveProperty('sort');
  });

  it('omits an empty search instead of sending an empty filter', async () => {
    await listDocumentTypes({
      organizationId: org,
      page: 1,
      pageSize: 50,
      search: '',
    });

    expect(vi.mocked(apiClient.get).mock.calls[0]?.[1]?.params).toEqual({
      organizationId: org,
      page: 1,
      pageSize: 50,
    });
  });

  it('reads one type by its registry code, scoped by organization query', async () => {
    await getDocumentType(org, 'inventory_receipt');

    expect(apiClient.get).toHaveBeenCalledWith(
      '/documents/types/inventory_receipt',
      expect.objectContaining({ params: { organizationId: org } }),
    );
  });

  it('configures through PUT with the single writable field', async () => {
    await configureDocumentType(org, 'inventory_receipt', {
      draftRequired: true,
    });

    expect(apiClient.put).toHaveBeenCalledWith(
      '/documents/types/inventory_receipt/configuration',
      { draftRequired: true },
      expect.objectContaining({ params: { organizationId: org } }),
    );
    // No create/delete helper exists in this module: the controller has none.
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(apiClient.delete).not.toHaveBeenCalled();
  });

  it('encodes a registry code before placing it in the path', async () => {
    await configureDocumentType(org, 'type/with slash', {
      draftRequired: false,
    });

    expect(vi.mocked(apiClient.put).mock.calls[0]?.[0]).toBe(
      '/documents/types/type%2Fwith%20slash/configuration',
    );
  });
});
