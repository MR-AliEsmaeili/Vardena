/**
 * Workflow transition — one explicit (source → target) edge (Task 9 §8/§17).
 *
 * A transition is valid only when ALL of these hold:
 * 1. the instance is bound to the transition's version,
 * 2. the instance's current state is the transition's source state,
 * 3. the transition and both states are enabled,
 * 4. the caller holds the transition's `required_permission` (an RBAC code
 *    from the EXISTING registry — Task 9 §9, no second authorization system),
 * 5. the bounded conditions hold (approval completed, comment present,
 *    separation of duties) — no expression language, no user scripting.
 *
 * This file holds the entity, the shape validation and the pure planning
 * helpers. Enforcement lives in the application service + the locked
 * transaction; the service re-checks the permission (AR-04/AR-21) and never
 * trusts the controller guard alone.
 *
 * Framework-free (AR-05).
 */

import {
  isValidWorkflowCode,
  MAX_WORKFLOW_CODE_LENGTH,
  MAX_WORKFLOW_DESCRIPTION_LENGTH,
  MAX_WORKFLOW_NAME_LENGTH,
  MAX_WORKFLOW_SORT_ORDER,
} from './workflow-codes.js';

/**
 * RBAC code shape, mirrored locally so this module never imports another
 * module's domain (AR-07). Identical rule to
 * `rbac/domain/permission-code.ts`: `Module.Entity.Action`, at most 160
 * characters. Whether the code is REGISTERED is checked by the service
 * against the permission registry at configuration time.
 */
export const MAX_TRANSITION_PERMISSION_LENGTH = 160;

const TRANSITION_PERMISSION_PATTERN =
  /^[A-Z][A-Za-z0-9]*\.[A-Z][A-Za-z0-9]*\.[A-Z][A-Za-z0-9]*$/;

export function isValidTransitionPermission(code: string): boolean {
  return (
    code.length > 0 &&
    code.length <= MAX_TRANSITION_PERMISSION_LENGTH &&
    TRANSITION_PERMISSION_PATTERN.test(code)
  );
}

export interface WorkflowTransition {
  id: string;
  organizationId: string;
  versionId: string;
  code: string;
  name: string;
  description: string | null;
  sourceStateId: string;
  targetStateId: string;
  requiredPermission: string;
  requiresApproval: boolean;
  approvalPermission: string | null;
  requiresComment: boolean;
  requireDifferentActor: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface WorkflowTransitionDto {
  id: string;
  organizationId: string;
  versionId: string;
  code: string;
  name: string;
  description: string | null;
  sourceStateId: string;
  targetStateId: string;
  requiredPermission: string;
  requiresApproval: boolean;
  approvalPermission: string | null;
  effectiveApprovalPermission: string;
  requiresComment: boolean;
  requireDifferentActor: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export function toWorkflowTransitionDto(
  transition: WorkflowTransition,
): WorkflowTransitionDto {
  return {
    id: transition.id,
    organizationId: transition.organizationId,
    versionId: transition.versionId,
    code: transition.code,
    name: transition.name,
    description: transition.description,
    sourceStateId: transition.sourceStateId,
    targetStateId: transition.targetStateId,
    requiredPermission: transition.requiredPermission,
    requiresApproval: transition.requiresApproval,
    approvalPermission: transition.approvalPermission,
    effectiveApprovalPermission: effectiveApprovalPermission(transition),
    requiresComment: transition.requiresComment,
    requireDifferentActor: transition.requireDifferentActor,
    isActive: transition.isActive,
    sortOrder: transition.sortOrder,
    createdAt: transition.createdAt.toISOString(),
    updatedAt: transition.updatedAt.toISOString(),
  };
}

/**
 * The permission an approver must hold: the explicit approval permission
 * when the configuration sets one, otherwise the transition permission
 * itself (the actor who may execute may also approve, unless the
 * configuration says otherwise).
 */
export function effectiveApprovalPermission(
  transition: Pick<
    WorkflowTransition,
    'requiredPermission' | 'approvalPermission'
  >,
): string {
  return transition.approvalPermission ?? transition.requiredPermission;
}

/**
 * Pure authorization-decision helper: does the caller's effective code set
 * permit this transition? The SERVICE enforces via `AuthorizationService`
 * (the registry-backed evaluator); this helper computes the `permitted`
 * flag on "available transitions" so the UI only renders what the caller
 * may actually execute.
 */
export function isTransitionPermitted(
  transition: Pick<WorkflowTransition, 'requiredPermission'>,
  effectiveCodes: ReadonlySet<string>,
): boolean {
  return effectiveCodes.has(transition.requiredPermission);
}

// ---------------------------------------------------------------------------
// Shape validation (Task 9 §28)
// ---------------------------------------------------------------------------

export type WorkflowTransitionProblem =
  | 'invalid_code'
  | 'blank_name'
  | 'name_too_long'
  | 'description_too_long'
  | 'invalid_sort_order'
  | 'invalid_required_permission'
  | 'invalid_approval_permission'
  | 'self_transition';

export function workflowTransitionProblemMessage(
  problem: WorkflowTransitionProblem,
): string {
  switch (problem) {
    case 'invalid_code':
      return `Transition code must be lowercase snake_case (1–${MAX_WORKFLOW_CODE_LENGTH} characters, e.g. "submit_for_approval").`;
    case 'blank_name':
      return 'Transition name is required.';
    case 'name_too_long':
      return `Transition name must be at most ${MAX_WORKFLOW_NAME_LENGTH} characters.`;
    case 'description_too_long':
      return `Transition description must be at most ${MAX_WORKFLOW_DESCRIPTION_LENGTH} characters.`;
    case 'invalid_sort_order':
      return `Sort order must be an integer between 0 and ${MAX_WORKFLOW_SORT_ORDER}.`;
    case 'invalid_required_permission':
      return 'Required permission must use the "Module.Entity.Action" form (for example "Inventory.Receipt.Approve").';
    case 'invalid_approval_permission':
      return 'Approval permission must use the "Module.Entity.Action" form (for example "Inventory.Receipt.Approve").';
    case 'self_transition':
      return 'A transition must move the workflow to a different state; self-transitions are not supported.';
  }
}

/**
 * Validate transition shape. State EXISTENCE and same-version membership are
 * the service's job (they need the database); the self-edge rule lives here
 * because it needs no I/O and must hold everywhere.
 */
export function planWorkflowTransition(input: {
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  sourceStateId: string;
  targetStateId: string;
  requiredPermission: string;
  approvalPermission: string | null;
}): { problem: WorkflowTransitionProblem | null } {
  if (!isValidWorkflowCode(input.code)) return { problem: 'invalid_code' };
  if (input.name.trim() === '') return { problem: 'blank_name' };
  if (input.name.length > MAX_WORKFLOW_NAME_LENGTH) {
    return { problem: 'name_too_long' };
  }
  if (
    input.description !== null &&
    input.description.length > MAX_WORKFLOW_DESCRIPTION_LENGTH
  ) {
    return { problem: 'description_too_long' };
  }
  if (
    !Number.isInteger(input.sortOrder) ||
    input.sortOrder < 0 ||
    input.sortOrder > MAX_WORKFLOW_SORT_ORDER
  ) {
    return { problem: 'invalid_sort_order' };
  }
  if (!isValidTransitionPermission(input.requiredPermission)) {
    return { problem: 'invalid_required_permission' };
  }
  if (
    input.approvalPermission !== null &&
    !isValidTransitionPermission(input.approvalPermission)
  ) {
    return { problem: 'invalid_approval_permission' };
  }
  if (input.sourceStateId === input.targetStateId) {
    return { problem: 'self_transition' };
  }
  return { problem: null };
}

// ---------------------------------------------------------------------------
// Execution planning (pure part — Task 9 §8/§20)
// ---------------------------------------------------------------------------

/**
 * The execution-time decision inputs the service assembles (partly outside,
 * partly inside the locked transaction). Every field is a fact; the plan
 * below turns facts into a problem code so the transaction path and its
 * tests share one decision table.
 */
export interface TransitionExecutionFacts {
  /** The instance's version is the transition's version. */
  versionMatches: boolean;
  /** The instance's current state is the transition's source state. */
  sourceIsCurrent: boolean;
  /** The transition row is enabled. */
  transitionEnabled: boolean;
  /** Both endpoint states are enabled. */
  statesEnabled: boolean;
  /** The source state is terminal (defense in depth — configuration forbids it). */
  sourceIsTerminal: boolean;
  /** The caller holds `required_permission` (checked by the service). */
  actorPermitted: boolean;
  /** The transition requires a comment and one was supplied. */
  commentSatisfied: boolean;
  /** The transition requires separation of duties and the actor differs. */
  actorDiffersSatisfied: boolean;
  /** The transition requires approval and a live approved approval was found. */
  approvalSatisfied: boolean;
}

export type TransitionExecutionProblem =
  | 'version_mismatch'
  | 'not_in_source_state'
  | 'transition_disabled'
  | 'state_disabled'
  | 'terminal_state'
  | 'permission_denied'
  | 'comment_required'
  | 'same_actor'
  | 'approval_required';

export function transitionExecutionProblemMessage(
  problem: TransitionExecutionProblem,
): string {
  switch (problem) {
    case 'version_mismatch':
      return 'The transition does not belong to the workflow version this entity is bound to.';
    case 'not_in_source_state':
      return 'The workflow is no longer in the transition\u2019s source state, so the transition is not available.';
    case 'transition_disabled':
      return 'The transition is disabled.';
    case 'state_disabled':
      return 'The transition\u2019s source or target state is disabled.';
    case 'terminal_state':
      return 'The workflow is in a terminal state, which has no outgoing transitions.';
    case 'permission_denied':
      return 'The caller does not hold the permission this transition requires.';
    case 'comment_required':
      return 'This transition requires a comment.';
    case 'same_actor':
      return 'This transition requires separation of duties: the actor must differ from the user who bound the entity.';
    case 'approval_required':
      return 'This transition requires a completed approval before it can be executed.';
  }
}

/**
 * The single execution decision table (Task 9 §8, ordered checks). Returns
 * the first problem found, or null when the transition may proceed. The
 * ORDER is part of the contract: version before state (a cross-version call
 * is a client bug, not a race), state before permission (a stale caller
 * learns "moved on" rather than "denied"), permission before conditions.
 */
export function planTransitionExecution(facts: TransitionExecutionFacts): {
  problem: TransitionExecutionProblem | null;
} {
  if (!facts.versionMatches) return { problem: 'version_mismatch' };
  if (!facts.sourceIsCurrent) return { problem: 'not_in_source_state' };
  if (!facts.transitionEnabled) return { problem: 'transition_disabled' };
  if (!facts.statesEnabled) return { problem: 'state_disabled' };
  if (facts.sourceIsTerminal) return { problem: 'terminal_state' };
  if (!facts.actorPermitted) return { problem: 'permission_denied' };
  if (!facts.commentSatisfied) return { problem: 'comment_required' };
  if (!facts.actorDiffersSatisfied) return { problem: 'same_actor' };
  if (!facts.approvalSatisfied) return { problem: 'approval_required' };
  return { problem: null };
}
