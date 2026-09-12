import type { PermissionDefinition } from '../../rbac/domain/permission-definition.js';

/**
 * The Document Foundation's permissions (AR-22, ADR-0006, docs/security.md §3).
 *
 * Codes follow the established `Module.Entity.Action` form. There is
 * deliberately NO `Document.Create` / `Document.*` generic-document
 * permission: the Foundation owns no business documents and exposes no
 * `POST /documents` endpoint (Task 8 §20). Its permissions cover only the
 * mechanics it owns — the document-type registry metadata, numbering series
 * configuration, the numbering ledger (inspection) and the relation links.
 *
 * What is intentionally absent:
 * - an `Allocate` permission: number allocation is a module-internal service
 *   call made inside the owning module's own transaction (its own document
 *   permission governs the action), never a standalone HTTP operation;
 * - a wildcard/superuser code (OQ-21).
 */

export const DOCUMENT_TYPE_PERMISSIONS = {
  VIEW: 'Document.DocumentType.View',
  CONFIGURE: 'Document.DocumentType.Configure',
} as const;

export const NUMBERING_SERIES_PERMISSIONS = {
  VIEW: 'Document.NumberingSeries.View',
  CREATE: 'Document.NumberingSeries.Create',
  EDIT: 'Document.NumberingSeries.Edit',
} as const;

export const NUMBERING_PERMISSIONS = {
  VIEW: 'Document.Numbering.View',
} as const;

export const RELATION_PERMISSIONS = {
  VIEW: 'Document.Relation.View',
  CREATE: 'Document.Relation.Create',
  DELETE: 'Document.Relation.Delete',
} as const;

function def(code: string, description: string): PermissionDefinition {
  return { code, description };
}

export const DOCUMENT_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] =
  [
    def(
      DOCUMENT_TYPE_PERMISSIONS.VIEW,
      'View the registered document types and their per-organization configuration.',
    ),
    def(
      DOCUMENT_TYPE_PERMISSIONS.CONFIGURE,
      'Configure a registered document type for an organization (e.g. whether draft is required before issuance).',
    ),
    def(
      NUMBERING_SERIES_PERMISSIONS.VIEW,
      'View numbering series configuration for an organization.',
    ),
    def(
      NUMBERING_SERIES_PERMISSIONS.CREATE,
      'Create a numbering series for a registered document type in an organization.',
    ),
    def(
      NUMBERING_SERIES_PERMISSIONS.EDIT,
      'Edit a numbering series (name, width, strategy, reuse policy, active state).',
    ),
    def(
      NUMBERING_PERMISSIONS.VIEW,
      'View the numbering ledger: which serial was allocated to which logical document.',
    ),
    def(
      RELATION_PERMISSIONS.VIEW,
      'View document relations (typed links between logical documents).',
    ),
    def(
      RELATION_PERMISSIONS.CREATE,
      'Create a document relation between two logical documents.',
    ),
    def(
      RELATION_PERMISSIONS.DELETE,
      'Delete a document relation link. Relations are links, not business facts: removing a stale link does not touch the documents.',
    ),
  ];
