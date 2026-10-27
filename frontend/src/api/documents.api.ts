import { apiGet, apiPut, cleanParams } from './client';
import type {
  ConfigureDocumentTypeRequest,
  DocumentType,
  DocumentTypeListQuery,
  Paginated,
} from './contracts';

/**
 * Document Foundation — registered document types (DOC-01).
 *
 * `backend/src/modules/documents/api/document-types.controller.ts` exposes
 * exactly three operations: list, get one by code, and PUT the organization's
 * configuration. The registry of type codes lives in backend CODE and is NOT
 * a creatable table: there is deliberately no POST and no DELETE here, and the
 * UI must never hardcode a document-type code.
 *
 * The list query is built field by field (not spread) so `sort` can never be
 * sent: `ListDocumentTypesQueryDto` inherits it from `PageQueryDto`, but the
 * service filters an in-memory registry and ignores it.
 */

const BASE_PATH = '/documents/types';

export function listDocumentTypes(
  query: DocumentTypeListQuery,
  signal?: AbortSignal,
): Promise<Paginated<DocumentType>> {
  return apiGet<Paginated<DocumentType>>(BASE_PATH, {
    params: cleanParams({
      organizationId: query.organizationId,
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
    }),
    ...(signal ? { signal } : {}),
  });
}

export function getDocumentType(
  organizationId: string,
  code: string,
  signal?: AbortSignal,
): Promise<DocumentType> {
  return apiGet<DocumentType>(`${BASE_PATH}/${encodeURIComponent(code)}`, {
    params: { organizationId },
    ...(signal ? { signal } : {}),
  });
}

/** Idempotent upsert: returns the merged registry + configuration view. */
export function configureDocumentType(
  organizationId: string,
  code: string,
  body: ConfigureDocumentTypeRequest,
): Promise<DocumentType> {
  return apiPut<DocumentType, ConfigureDocumentTypeRequest>(
    `${BASE_PATH}/${encodeURIComponent(code)}/configuration`,
    body,
    { params: { organizationId } },
  );
}
