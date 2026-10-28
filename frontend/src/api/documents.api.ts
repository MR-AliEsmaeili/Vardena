import { apiGet, apiPatch, apiPost, apiPut, cleanParams } from './client';
import type {
  ConfigureDocumentTypeRequest,
  CreateNumberingSeriesRequest,
  DocumentType,
  DocumentTypeListQuery,
  NumberingAllocation,
  NumberingAllocationListQuery,
  NumberingSeries,
  NumberingSeriesListQuery,
  Paginated,
  UpdateNumberingSeriesRequest,
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

// ---------------------------------------------------------------------------
// Numbering series & allocations (DOC-02)
// ---------------------------------------------------------------------------

const NUMBERING_SERIES_PATH = '/documents/numbering-series';

export function listNumberingSeries(
  query: NumberingSeriesListQuery,
  signal?: AbortSignal,
): Promise<Paginated<NumberingSeries>> {
  return apiGet<Paginated<NumberingSeries>>(NUMBERING_SERIES_PATH, {
    params: cleanParams({ ...query }),
    ...(signal ? { signal } : {}),
  });
}

export function createNumberingSeries(
  body: CreateNumberingSeriesRequest,
): Promise<NumberingSeries> {
  return apiPost<NumberingSeries, CreateNumberingSeriesRequest>(
    NUMBERING_SERIES_PATH,
    body,
  );
}

export function getNumberingSeries(
  organizationId: string,
  seriesId: string,
  signal?: AbortSignal,
): Promise<NumberingSeries> {
  return apiGet<NumberingSeries>(
    `${NUMBERING_SERIES_PATH}/${encodeURIComponent(seriesId)}`,
    {
      params: { organizationId },
      ...(signal ? { signal } : {}),
    },
  );
}

export function updateNumberingSeries(
  organizationId: string,
  seriesId: string,
  body: UpdateNumberingSeriesRequest,
): Promise<NumberingSeries> {
  return apiPatch<NumberingSeries, UpdateNumberingSeriesRequest>(
    `${NUMBERING_SERIES_PATH}/${encodeURIComponent(seriesId)}`,
    body,
    { params: { organizationId } },
  );
}

/**
 * Read-only ledger of numbers allocated from one series (DOC-02 §3).
 *
 * `seriesId` is the path param; `organizationId` is the required scope.
 * Remaining filters (`documentType`, `referenceModule`, …) are the ledger's
 * own narrow query — allocation is append-only and has no write endpoint.
 */
export function listNumberingAllocations(
  organizationId: string,
  seriesId: string,
  query: NumberingAllocationListQuery,
  signal?: AbortSignal,
): Promise<Paginated<NumberingAllocation>> {
  void organizationId;
  return apiGet<Paginated<NumberingAllocation>>(
    `${NUMBERING_SERIES_PATH}/${encodeURIComponent(seriesId)}/allocations`,
    {
      params: cleanParams({ ...query }),
      ...(signal ? { signal } : {}),
    },
  );
}
