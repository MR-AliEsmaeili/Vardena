/**
 * Material Request (C-50) — an Inventory-owned business aggregate recording
 * DEMAND for stock.
 *
 * Owner decisions (docs/tasks/c-50-material-request-investigation.md §1,
 * reconciled with the Owner's C-50 confirmations):
 *   - NOT a movement, receipt, issue, Purchase Request or accounting
 *     document. Draft/submitted/rejected/approved never touch `on_hand`.
 *   - Approval creates, AT MOST, a reservation per line (a soft claim), never
 *     a posted ledger effect — reservation ≠ physical movement.
 *   - Explicit approval stage; rejection requires a reason; immutable after
 *     approval except for an approver-only reversal.
 *
 * Status is a closed, code-defined list — same convention as
 * `inventory_reservations.status` / `items.item_kind` — stored as plain text,
 * never a database enum (extending it later is an ordinary application
 * change, never a migration).
 *
 * There is deliberately NO `cancelled` status: no governance-confirmed rule
 * exists for what cancelling an approved (and possibly reserved) request
 * must do, so inventing one here would be exactly the kind of undocumented
 * business rule the investigation process forbids. See
 * `planMaterialRequestReversal` for the one reversal rule that IS resolved.
 *
 * Framework-free (AR-05).
 */

export const MATERIAL_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
] as const;

export type MaterialRequestStatus = (typeof MATERIAL_REQUEST_STATUSES)[number];

export function isMaterialRequestStatus(
  value: string,
): value is MaterialRequestStatus {
  return (MATERIAL_REQUEST_STATUSES as readonly string[]).includes(value);
}

export type MaterialRequestTransitionProblem =
  | 'not_draft'
  | 'not_submitted'
  | 'not_approved'
  | 'already_terminal';

export function materialRequestTransitionMessage(
  problem: MaterialRequestTransitionProblem,
): string {
  switch (problem) {
    case 'not_draft':
      return 'The request is not a draft and can no longer be edited, submitted or deleted.';
    case 'not_submitted':
      return 'The request must be submitted before it can be approved or rejected.';
    case 'not_approved':
      return 'The request is not approved.';
    case 'already_terminal':
      return 'The request is already in a terminal state.';
  }
}

/** Only a draft may be edited, submitted, or deleted. */
export function planEdit(status: string): {
  problem: MaterialRequestTransitionProblem | null;
} {
  return status === 'draft' ? { problem: null } : { problem: 'not_draft' };
}

/** Only a submitted request may be approved or rejected. */
export function planDecision(status: string): {
  problem: MaterialRequestTransitionProblem | null;
} {
  return status === 'submitted'
    ? { problem: null }
    : { problem: 'not_submitted' };
}

/** Only an approved request may have its approval reversed. */
export function planReversal(status: string): {
  problem: MaterialRequestTransitionProblem | null;
} {
  return status === 'approved'
    ? { problem: null }
    : { problem: 'not_approved' };
}

export interface MaterialRequest {
  id: string;
  organizationId: string;
  number: string | null;
  status: MaterialRequestStatus;
  description: string | null;
  requestedBy: string;
  submittedAt: Date | null;
  submittedBy: string | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  rejectedAt: Date | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  approvalReversedAt: Date | null;
  approvalReversedBy: string | null;
  approvalReversalReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MaterialRequestDto {
  id: string;
  organizationId: string;
  number: string | null;
  status: MaterialRequestStatus;
  description: string | null;
  requestedBy: string;
  submittedAt: string | null;
  submittedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  approvalReversedAt: string | null;
  approvalReversedBy: string | null;
  approvalReversalReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toMaterialRequestDto(
  request: MaterialRequest,
): MaterialRequestDto {
  return {
    id: request.id,
    organizationId: request.organizationId,
    number: request.number,
    status: request.status,
    description: request.description,
    requestedBy: request.requestedBy,
    submittedAt: request.submittedAt?.toISOString() ?? null,
    submittedBy: request.submittedBy,
    approvedAt: request.approvedAt?.toISOString() ?? null,
    approvedBy: request.approvedBy,
    rejectedAt: request.rejectedAt?.toISOString() ?? null,
    rejectedBy: request.rejectedBy,
    rejectionReason: request.rejectionReason,
    approvalReversedAt: request.approvalReversedAt?.toISOString() ?? null,
    approvalReversedBy: request.approvalReversedBy,
    approvalReversalReason: request.approvalReversalReason,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}

export const MAX_DESCRIPTION_LENGTH = 1000;
export const MAX_REASON_LENGTH = 1000;
