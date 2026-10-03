import {
  DRAFT_PHASE,
  type DocumentTypeDefinition,
} from '../../documents/domain/document-type.js';

/**
 * Material Request's registration in the Documents Foundation's type
 * registry (Task 8, ADR-0023), registered SOLELY so an organization can
 * configure a `documents.numbering_series` for it
 * (`NumberingSeriesService.createNumberingSeries` requires the document type
 * to be registered) — Material Request's own lifecycle
 * (`draft/submitted/approved/rejected`, `domain/material-request.ts`) is
 * implemented independently of the Foundation's draft/temporary/final phase
 * machinery; nothing in this module calls
 * `DocumentTypesService.requireTypeSettings`/`defaultEntryState`/
 * `requiresDraft`. The `entryStates`/`deletablePhases` below exist only to
 * satisfy `assertValidDocumentTypeDefinition` and to describe the type
 * honestly to anything that inspects the registry (e.g. `GET
 * /document-types`); Material Request's actual phase transitions are
 * enforced by `material-requests.service.ts`, not by this metadata.
 *
 * Material Request is deliberately NOT used as a Document Relations
 * `sourceDocumentType`/`targetDocumentType` validation gate — relations are
 * opaque strings with no registry check (`document-relations.service.ts`),
 * so this registration has no bearing on invocation (§3.8).
 */
export const MATERIAL_REQUEST_DOCUMENT_TYPE = 'inventory_material_request';

export const MATERIAL_REQUEST_DOCUMENT_TYPE_DEFINITION: DocumentTypeDefinition =
  {
    code: MATERIAL_REQUEST_DOCUMENT_TYPE,
    module: 'inventory',
    name: 'Material Request',
    description:
      'A request for stock to be made available (demand, not a movement), owned by the Inventory module.',
    draftCapable: true,
    entryStates: ['temporary'],
    deletablePhases: [DRAFT_PHASE],
  };
