import type { PermissionDefinition } from '../../rbac/domain/permission-definition.js';

/**
 * Material Request permissions (C-50, AR-22, ADR-0006).
 *
 * Codes follow `Module.Entity.Action`, same vocabulary as every other
 * Inventory permission set. Each lifecycle authority is its OWN code —
 * mirroring `Accounting.Document.{Edit,Delete,Finalize,Reverse}` — because
 * the Owner's decisions require them to be grantable independently:
 *
 * - `View/Create/Edit/Delete` — ordinary draft authoring. `Edit`/`Delete`
 *   only ever succeed while the request is still a draft (enforced in the
 *   service, not by the permission).
 * - `Submit` — moves a draft into the approval queue; allocates its number.
 * - `Approve`/`Reject`/`ReturnForCorrection` — the explicit approval stage,
 *   three independently grantable outcomes of reviewing a SUBMITTED
 *   request. **Owner decision:** any user holding `Approve` may approve or
 *   reject within their authorized organization scope — there is no
 *   separately assigned approver, and holding `Approve` never requires NOT
 *   being the requester (self-approval is explicitly allowed; this module
 *   enforces no requester/approver separation). `ReturnForCorrection` sends
 *   a submitted request back to the requester (status `returned`) with a
 *   required reason instead of approving or rejecting it outright.
 * - `ReverseApproval` — holding this permission is NECESSARY but not
 *   SUFFICIENT: the service also enforces that only the ORIGINAL approver
 *   (`approvedBy`) may use it (Owner decision 3.4), and refuses it outright
 *   once any line has been invoked (see `material-requests.service.ts`).
 * - `Cancel` — a DISTINCT operation from `ReverseApproval` (Owner decision:
 *   "cancellation and reversal of approval are distinct operations... with
 *   explicit, auditable state transitions"): cancels an APPROVED request
 *   outright (terminal `cancelled` status, never returns to `submitted`),
 *   releasing any reservations it holds, but — like reversal — is refused
 *   outright once any line has been invoked, even partially. Unlike
 *   `ReverseApproval`, holding this permission is sufficient on its own;
 *   there is no original-approver restriction (no Owner decision imposes
 *   one for cancellation).
 * - `Invoke` — record that an approved line has been carried into a
 *   subsequent process (C-50 §3.8), via a Document Relation.
 *
 * No `*.Enable`/`*.Disable`: Material Request is a transactional document,
 * not master data — there is no is_active lifecycle to toggle.
 */

export const MATERIAL_REQUEST_PERMISSIONS = {
  VIEW: 'Inventory.MaterialRequest.View',
  CREATE: 'Inventory.MaterialRequest.Create',
  EDIT: 'Inventory.MaterialRequest.Edit',
  DELETE: 'Inventory.MaterialRequest.Delete',
  SUBMIT: 'Inventory.MaterialRequest.Submit',
  APPROVE: 'Inventory.MaterialRequest.Approve',
  REJECT: 'Inventory.MaterialRequest.Reject',
  RETURN_FOR_CORRECTION: 'Inventory.MaterialRequest.ReturnForCorrection',
  REVERSE_APPROVAL: 'Inventory.MaterialRequest.ReverseApproval',
  CANCEL: 'Inventory.MaterialRequest.Cancel',
  INVOKE: 'Inventory.MaterialRequest.Invoke',
} as const;

function def(code: string, description: string): PermissionDefinition {
  return { code, description };
}

export const MATERIAL_REQUEST_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] =
  [
    def(
      MATERIAL_REQUEST_PERMISSIONS.VIEW,
      'View Material Requests and their lines.',
    ),
    def(
      MATERIAL_REQUEST_PERMISSIONS.CREATE,
      'Create a draft Material Request.',
    ),
    def(
      MATERIAL_REQUEST_PERMISSIONS.EDIT,
      'Edit a draft Material Request (header and lines). Only drafts can be edited.',
    ),
    def(
      MATERIAL_REQUEST_PERMISSIONS.DELETE,
      'Delete a draft Material Request. Only drafts can be deleted.',
    ),
    def(
      MATERIAL_REQUEST_PERMISSIONS.SUBMIT,
      'Submit a draft Material Request for approval, allocating its number.',
    ),
    def(
      MATERIAL_REQUEST_PERMISSIONS.APPROVE,
      'Approve a submitted Material Request, reserving stock for lines that request it. A separate authority from Create/Edit.',
    ),
    def(
      MATERIAL_REQUEST_PERMISSIONS.REJECT,
      'Reject a submitted Material Request with a reason. A separate authority from Create/Edit.',
    ),
    def(
      MATERIAL_REQUEST_PERMISSIONS.RETURN_FOR_CORRECTION,
      'Return a submitted Material Request to its requester for correction, with a required reason. The requester must edit and resubmit it.',
    ),
    def(
      MATERIAL_REQUEST_PERMISSIONS.REVERSE_APPROVAL,
      'Reverse the approval of a Material Request. Necessary but not sufficient — only the original approver may use it, and it is refused once any line has been invoked.',
    ),
    def(
      MATERIAL_REQUEST_PERMISSIONS.CANCEL,
      'Cancel an approved Material Request, releasing any reservations it holds. Refused once any line has been invoked, even partially. Distinct from reversing approval.',
    ),
    def(
      MATERIAL_REQUEST_PERMISSIONS.INVOKE,
      'Record that an approved Material Request line has been carried into a subsequent process (e.g. a warehouse issue or purchase request) via a Document Relation.',
    ),
  ];
