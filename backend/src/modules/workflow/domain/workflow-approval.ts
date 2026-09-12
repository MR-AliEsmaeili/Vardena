/**
 * Workflow approval — single-level approval evidence (Task 9 §16).
 *
 * v1 is single-level ONLY: one request, one decision, recorded — never a
 * boolean on the instance (that would lose who/when/under-what-rule).
 * Multi-level chains, delegation, escalation and approval scripting are
 * explicitly out of scope (OQ-26 tracks the policy questions); the model
 * stays extensible by ADDING tables/columns later, not by overloading this
 * one now.
 *
 * Staleness is structural: `baseSequence` pins the request to the history
 * length it was requested in. A decision or an execution is STALE — and
 * rejected — when any transition landed since, so an approval can never
 * authorize a state it was not requested in.
 *
 * Framework-free (AR-05).
 */

import {
  MAX_WORKFLOW_COMMENT_LENGTH,
  normalizeWorkflowText,
} from './workflow-codes.js';

export const WORKFLOW_APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
] as const;

export type WorkflowApprovalStatus =
  (typeof WORKFLOW_APPROVAL_STATUSES)[number];

export function isWorkflowApprovalStatus(
  value: string,
): value is WorkflowApprovalStatus {
  return (WORKFLOW_APPROVAL_STATUSES as readonly string[]).includes(value);
}

/** The decisions a pending approval accepts (closed — approve or reject). */
export const WORKFLOW_APPROVAL_DECISIONS = ['approved', 'rejected'] as const;

export type WorkflowApprovalDecision =
  (typeof WORKFLOW_APPROVAL_DECISIONS)[number];

export function isWorkflowApprovalDecision(
  value: string,
): value is WorkflowApprovalDecision {
  return (WORKFLOW_APPROVAL_DECISIONS as readonly string[]).includes(value);
}

export interface WorkflowApproval {
  id: string;
  organizationId: string;
  instanceId: string;
  versionId: string;
  transitionId: string;
  status: WorkflowApprovalStatus;
  requestedBy: string | null;
  requestedAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  comment: string | null;
  baseSequence: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface WorkflowApprovalDto {
  id: string;
  organizationId: string;
  instanceId: string;
  versionId: string;
  transitionId: string;
  status: WorkflowApprovalStatus;
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string | null;
  baseSequence: number;
  createdAt: string;
  updatedAt: string;
}

export function toWorkflowApprovalDto(
  approval: WorkflowApproval,
): WorkflowApprovalDto {
  return {
    id: approval.id,
    organizationId: approval.organizationId,
    instanceId: approval.instanceId,
    versionId: approval.versionId,
    transitionId: approval.transitionId,
    status: approval.status,
    requestedBy: approval.requestedBy,
    requestedAt: approval.requestedAt.toISOString(),
    decidedBy: approval.decidedBy,
    decidedAt: approval.decidedAt?.toISOString() ?? null,
    comment: approval.comment,
    baseSequence: approval.baseSequence,
    createdAt: approval.createdAt.toISOString(),
    updatedAt: approval.updatedAt.toISOString(),
  };
}

/** Only pending approvals accept a decision; decided ones are evidence. */
export function isApprovalDecidable(status: WorkflowApprovalStatus): boolean {
  return status === 'pending';
}

/**
 * True when the approval is stale: the instance moved since the request, so
 * the approval no longer describes the state it was requested in. Stale
 * approvals can neither be decided nor consumed.
 */
export function isApprovalStale(
  approval: Pick<WorkflowApproval, 'baseSequence'>,
  currentHistoryLength: number,
): boolean {
  return approval.baseSequence !== currentHistoryLength;
}

/**
 * True when the approval authorizes an execution NOW: approved, for this
 * (instance, transition), and fresh. Decided-then-stale approvals fail here
 * even though they read "approved" — the status is evidence, freshness is
 * the authorization.
 */
export function isApprovalConsumable(
  approval: Pick<
    WorkflowApproval,
    'instanceId' | 'transitionId' | 'status' | 'baseSequence'
  >,
  input: {
    instanceId: string;
    transitionId: string;
    currentHistoryLength: number;
  },
): boolean {
  return (
    approval.instanceId === input.instanceId &&
    approval.transitionId === input.transitionId &&
    approval.status === 'approved' &&
    !isApprovalStale(approval, input.currentHistoryLength)
  );
}

export type WorkflowApprovalProblem =
  | 'invalid_decision'
  | 'comment_too_long'
  | 'already_decided'
  | 'stale_approval';

export function workflowApprovalProblemMessage(
  problem: WorkflowApprovalProblem,
): string {
  switch (problem) {
    case 'invalid_decision':
      return 'Decision must be "approved" or "rejected".';
    case 'comment_too_long':
      return `Comment must be at most ${MAX_WORKFLOW_COMMENT_LENGTH} characters.`;
    case 'already_decided':
      return 'The approval has already been decided and cannot be changed.';
    case 'stale_approval':
      return 'The approval is stale: the workflow moved since it was requested, so it can no longer be used.';
  }
}

/** Validate a decision comment (length only — content is free text). */
export function planApprovalComment(comment: string | null): {
  problem: WorkflowApprovalProblem | null;
} {
  const normalized = normalizeWorkflowText(comment);
  if (normalized !== null && normalized.length > MAX_WORKFLOW_COMMENT_LENGTH) {
    return { problem: 'comment_too_long' };
  }
  return { problem: null };
}
