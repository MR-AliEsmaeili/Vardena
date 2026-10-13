import type { DomainEvent } from '../../../kernel/events/domain-event-bus.js';

/**
 * Workflow Foundation domain events (Task 9 §19).
 *
 * Published on the repository's existing in-memory `DomainEventBus` with the
 * `Entity.PastTenseVerb` convention (docs/architecture.md §5) — the same
 * mechanism the Identity/Organization/Inventory/Document modules use. The
 * headline contract is `WorkflowTransition.Completed` (the task's
 * `WorkflowTransitionCompleted` semantics in repository naming): future
 * modules react to it without direct database coupling, and it carries the
 * bound automation actions so a future automation dispatcher knows what a
 * transition asked for.
 *
 * Deliberately NOT introduced here: a second event architecture, a generic
 * `core.domain_events` table, or an outbox writer. Durable cross-module
 * dispatch (`local transaction → Outbox → worker → consumer`) does not exist
 * yet anywhere in the repository — it is a documented architecture gap
 * (ADR-0024), not a Task 9 rewrite. Like every other module today, Workflow
 * publishes post-commit on the in-memory bus.
 */

// ---------------------------------------------------------------------------
// Payload shapes
// ---------------------------------------------------------------------------

/** A logical (module + type + id) entity reference — never a DB FK. */
export interface WorkflowEntityRefPayload {
  module: string;
  entityType: string;
  entityId: string;
}

/** One automation action bound to the executed transition (v1: reported, not run). */
export interface WorkflowAutomationPayload {
  action: string;
  parameters: Record<string, string | number | boolean | null> | null;
}

export interface WorkflowVersionPublishedPayload {
  definitionId: string;
  versionId: string;
  organizationId: string;
  versionNumber: number;
  supersededVersionId: string | null;
}

export interface WorkflowInstanceBoundPayload {
  instanceId: string;
  organizationId: string;
  definitionId: string;
  versionId: string;
  entity: WorkflowEntityRefPayload;
  initialStateId: string;
}

export interface WorkflowTransitionCompletedPayload {
  instanceId: string;
  organizationId: string;
  definitionId: string;
  versionId: string;
  entity: WorkflowEntityRefPayload;
  transitionId: string;
  transitionCode: string;
  fromStateId: string;
  toStateId: string;
  sequence: number;
  actorId: string | null;
  approvalId: string | null;
  automations: WorkflowAutomationPayload[];
}

export interface WorkflowApprovalDecidedPayload {
  approvalId: string;
  instanceId: string;
  organizationId: string;
  transitionId: string;
  decision: 'approved' | 'rejected';
  decidedBy: string | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const WORKFLOW_VERSION_PUBLISHED_EVENT =
  'WorkflowVersion.Published' as const;
export const WORKFLOW_INSTANCE_BOUND_EVENT = 'WorkflowInstance.Bound' as const;
export const WORKFLOW_TRANSITION_COMPLETED_EVENT =
  'WorkflowTransition.Completed' as const;
export const WORKFLOW_APPROVAL_DECIDED_EVENT =
  'WorkflowApproval.Decided' as const;

export type WorkflowVersionPublishedEvent = DomainEvent & {
  type: typeof WORKFLOW_VERSION_PUBLISHED_EVENT;
  aggregateType: 'WorkflowVersion';
  aggregateId: string;
  payload: WorkflowVersionPublishedPayload;
};

export type WorkflowInstanceBoundEvent = DomainEvent & {
  type: typeof WORKFLOW_INSTANCE_BOUND_EVENT;
  aggregateType: 'WorkflowInstance';
  aggregateId: string;
  payload: WorkflowInstanceBoundPayload;
};

export type WorkflowTransitionCompletedEvent = DomainEvent & {
  type: typeof WORKFLOW_TRANSITION_COMPLETED_EVENT;
  aggregateType: 'WorkflowInstance';
  aggregateId: string;
  payload: WorkflowTransitionCompletedPayload;
};

export type WorkflowApprovalDecidedEvent = DomainEvent & {
  type: typeof WORKFLOW_APPROVAL_DECIDED_EVENT;
  aggregateType: 'WorkflowApproval';
  aggregateId: string;
  payload: WorkflowApprovalDecidedPayload;
};

/** The events the Workflow Foundation publishes (used by tests). */
export const WORKFLOW_EVENT_TYPES = [
  WORKFLOW_VERSION_PUBLISHED_EVENT,
  WORKFLOW_INSTANCE_BOUND_EVENT,
  WORKFLOW_TRANSITION_COMPLETED_EVENT,
  WORKFLOW_APPROVAL_DECIDED_EVENT,
] as const;
