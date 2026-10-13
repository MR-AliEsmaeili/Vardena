/**
 * Workflow transition history — the append-only audit trail (Task 9 §13).
 *
 * One row per successful transition, written in the SAME transaction as the
 * state change. `sequence` (1-based per instance) orders an instance's rows;
 * `approval_id` links the consumed approval when the transition required
 * one; `correlation_id` carries the ambient request correlation when
 * present. Failed transitions write nothing. There is no update or delete
 * path — history answers "who moved what, from where to where, under which
 * version and approval" forever.
 *
 * Framework-free (AR-05).
 */

export interface WorkflowTransitionHistory {
  id: string;
  organizationId: string;
  instanceId: string;
  versionId: string;
  transitionId: string;
  fromStateId: string;
  toStateId: string;
  sequence: number;
  actorId: string | null;
  comment: string | null;
  approvalId: string | null;
  correlationId: string | null;
  occurredAt: Date;
  createdAt: Date;
}

export interface WorkflowTransitionHistoryDto {
  id: string;
  organizationId: string;
  instanceId: string;
  versionId: string;
  transitionId: string;
  fromStateId: string;
  toStateId: string;
  sequence: number;
  actorId: string | null;
  comment: string | null;
  approvalId: string | null;
  correlationId: string | null;
  occurredAt: string;
  createdAt: string;
}

export function toWorkflowTransitionHistoryDto(
  entry: WorkflowTransitionHistory,
): WorkflowTransitionHistoryDto {
  return {
    id: entry.id,
    organizationId: entry.organizationId,
    instanceId: entry.instanceId,
    versionId: entry.versionId,
    transitionId: entry.transitionId,
    fromStateId: entry.fromStateId,
    toStateId: entry.toStateId,
    sequence: entry.sequence,
    actorId: entry.actorId,
    comment: entry.comment,
    approvalId: entry.approvalId,
    correlationId: entry.correlationId,
    occurredAt: entry.occurredAt.toISOString(),
    createdAt: entry.createdAt.toISOString(),
  };
}

/** The next sequence number for an instance with `currentLength` rows. */
export function nextHistorySequence(currentLength: number): number {
  return currentLength + 1;
}
