import type { PermissionDefinition } from '../../rbac/domain/permission-definition.js';

/**
 * Inventory Business Document permissions (C-58, AR-22, ADR-0006).
 *
 * Operation-level, one code per implemented command — the same discipline as
 * `inventory-core-permissions.ts`: nothing here advertises a capability that
 * does not exist.
 *
 * These codes authorize the DOCUMENT operation. They never replace the ledger
 * authority: `finalize`/`cancel` additionally require the matching
 * `Inventory.Movement.*` / `Inventory.Transfer.Create` code, because those
 * commands write real ledger facts, and assigning a cost on a receipt still
 * requires `Inventory.Valuation.AssignCost` exactly as a direct posting does.
 *
 * There is deliberately no approval/maker-checker code: the C-58 Owner
 * decision allows self-finalization (OQ-13/OQ-26 stay globally open).
 */

function def(code: string, description: string): PermissionDefinition {
  return { code, description };
}

export const INVENTORY_DOCUMENT_PERMISSIONS = {
  VIEW: 'Inventory.Document.View',
  CREATE: 'Inventory.Document.Create',
  EDIT: 'Inventory.Document.Edit',
  DELETE: 'Inventory.Document.Delete',
  FINALIZE: 'Inventory.Document.Finalize',
  ACCOUNTING_POST: 'Inventory.Document.AccountingPost',
  SEAL: 'Inventory.Document.Seal',
  CANCEL: 'Inventory.Document.Cancel',
} as const;

export const INVENTORY_DOCUMENT_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] =
  [
    def(
      INVENTORY_DOCUMENT_PERMISSIONS.VIEW,
      'View Inventory business documents (receipt, issue, transfer) and their lines.',
    ),
    def(
      INVENTORY_DOCUMENT_PERMISSIONS.CREATE,
      'Create draft Inventory business documents. A draft has no stock effect.',
    ),
    def(
      INVENTORY_DOCUMENT_PERMISSIONS.EDIT,
      'Edit an Inventory business document before Accounting Post. An edit to an operational document reconciles its ledger effect atomically.',
    ),
    def(
      INVENTORY_DOCUMENT_PERMISSIONS.DELETE,
      'Delete a DRAFT Inventory business document. Documents with business history are cancelled, never deleted.',
    ),
    def(
      INVENTORY_DOCUMENT_PERMISSIONS.FINALIZE,
      'Finalize an Inventory business document, posting its operational movement effect atomically. Self-finalization is allowed (C-58): no approval workflow exists.',
    ),
    def(
      INVENTORY_DOCUMENT_PERMISSIONS.ACCOUNTING_POST,
      'Mark an operational Inventory business document as Accounting Posted. After this boundary the document is immutable to direct edit and delete.',
    ),
    def(
      INVENTORY_DOCUMENT_PERMISSIONS.SEAL,
      'Seal an accounting-posted Inventory business document as permanently immutable (terminal; no further correction is accepted).',
    ),
    def(
      INVENTORY_DOCUMENT_PERMISSIONS.CANCEL,
      'Cancel an Inventory business document before Accounting Post, reversing its ledger effect when one exists. The number is never reused and the document stays visible.',
    ),
  ];
