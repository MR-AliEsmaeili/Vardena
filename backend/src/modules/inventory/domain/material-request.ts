/**
 * Material Request (C-50) — an Inventory-owned business aggregate recording
 * DEMAND for stock.
 *
 * Owner decisions (docs/tasks/c-50-material-request-investigation.md §1 and
 * §19, and the later confirmed lifecycle/reservation/approval-authority
 * decisions recorded there — see OQ-66 for the reservation-shape
 * ratification):
 *   - NOT a movement, receipt, issue, Purchase Request or accounting
 *     document. No status ever touches `on_hand`.
 *   - Reservation is OPTIONAL per line (never implied by the request
 *     existing); approval creates, AT MOST, a reservation per flagged line
 *     (a soft claim on `reserved`, never `on_hand`) — see
 *     `material-request-line.ts`.
 *   - Explicit approval stage; rejection requires a reason; content is
 *     immutable once approved except for an approver-only reversal, and the
 *     whole request is immutable once cancelled or rejected.
 *   - Any user holding `Inventory.MaterialRequest.Approve` may approve or
 *     reject within their authorized organization scope — there is no
 *     separately assigned approver, and the requester MAY approve their own
 *     request (role/permission is the only authority boundary; no
 *     requester/approver separation is enforced).
 *   - A submitted request may be returned to its requester for correction
 *     (status `returned`); the requester edits and must resubmit (back to
 *     `submitted`) before it can be approved or rejected.
 *   - An approved request may be CANCELLED, but only while no part of it has
 *     entered a downstream process (no line has been invoked, not even
 *     partially) — cancellation and approval reversal are distinct,
 *     separately permissioned, separately audited operations.
 *
 * Status is a closed, code-defined list — same convention as
 * `inventory_reservations.status` / `items.item_kind` — stored as plain
 * text, never a database enum (extending it later is an ordinary
 * application change, never a migration).
 *
 * Framework-free (AR-05).
 */

export const MATERIAL_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'returned',
  'approved',
  'rejected',
  'cancelled',
] as const;

export type MaterialRequestStatus = (typeof MATERIAL_REQUEST_STATUSES)[number];

export function isMaterialRequestStatus(
  value: string,
): value is MaterialRequestStatus {
  return (MATERIAL_REQUEST_STATUSES as readonly string[]).includes(value);
}

export type MaterialRequestTransitionProblem =
  'not_editable' | 'not_submitted' | 'not_approved' | 'already_terminal';

export function materialRequestTransitionMessage(
  problem: MaterialRequestTransitionProblem,
): string {
  switch (problem) {
    case 'not_editable':
      return (
        'The request can only be edited, submitted or deleted while it is ' +
        'a draft or has been returned for correction.'
      );
    case 'not_submitted':
      return 'The request must be submitted (awaiting approval) for this action.';
    case 'not_approved':
      return 'The request is not approved.';
    case 'already_terminal':
      return 'The request is already in a terminal state.';
  }
}

/** The statuses in which the requester may still change the request's
 *  content and either submit it for the first time or resubmit it after a
 *  return for correction. */
export const EDITABLE_MATERIAL_REQUEST_STATUSES: readonly MaterialRequestStatus[] =
  ['draft', 'returned'];

/** Only a draft, or a request returned for correction, may be edited or
 *  (re)submitted. Deletion stays narrower (draft-only) — see
 *  `MaterialRequestsRepository.deleteDraft`, unchanged by this decision. */
export function planEdit(status: string): {
  problem: MaterialRequestTransitionProblem | null;
} {
  return (EDITABLE_MATERIAL_REQUEST_STATUSES as readonly string[]).includes(
    status,
  )
    ? { problem: null }
    : { problem: 'not_editable' };
}

/** A submitted request may be approved, rejected, or returned for
 *  correction — all three are outcomes of the same approval review, so they
 *  share this one precondition. */
export function planDecision(status: string): {
  problem: MaterialRequestTransitionProblem | null;
} {
  return status === 'submitted'
    ? { problem: null }
    : { problem: 'not_submitted' };
}

/** An approved request may have its approval reversed, or be cancelled —
 *  both require the SAME precondition (status = approved); the service
 *  layer enforces the rest of each operation's own rules (original-approver
 *  only for reversal; no invoked line for either). */
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
  returnedAt: Date | null;
  returnedBy: string | null;
  returnReason: string | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  rejectedAt: Date | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  approvalReversedAt: Date | null;
  approvalReversedBy: string | null;
  approvalReversalReason: string | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
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
  returnedAt: string | null;
  returnedBy: string | null;
  returnReason: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  approvalReversedAt: string | null;
  approvalReversedBy: string | null;
  approvalReversalReason: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
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
    returnedAt: request.returnedAt?.toISOString() ?? null,
    returnedBy: request.returnedBy,
    returnReason: request.returnReason,
    approvedAt: request.approvedAt?.toISOString() ?? null,
    approvedBy: request.approvedBy,
    rejectedAt: request.rejectedAt?.toISOString() ?? null,
    rejectedBy: request.rejectedBy,
    rejectionReason: request.rejectionReason,
    approvalReversedAt: request.approvalReversedAt?.toISOString() ?? null,
    approvalReversedBy: request.approvalReversedBy,
    approvalReversalReason: request.approvalReversalReason,
    cancelledAt: request.cancelledAt?.toISOString() ?? null,
    cancelledBy: request.cancelledBy,
    cancellationReason: request.cancellationReason,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}

export const MAX_DESCRIPTION_LENGTH = 1000;
export const MAX_REASON_LENGTH = 1000;
