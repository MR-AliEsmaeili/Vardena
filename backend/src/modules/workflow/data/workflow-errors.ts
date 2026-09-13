/**
 * Data-layer failures for the workflow transactions (Task 9).
 *
 * Like the inventory posting path (`inventory-posting-errors.ts`), the
 * locked transactions throw PLAIN problem-coded errors — never HTTP-aware
 * exceptions — and the application service maps them onto `AppException`.
 * The problem codes come from the domain decision tables so the transaction
 * path and its tests share one vocabulary.
 */

import type { TransitionExecutionProblem } from '../domain/workflow-transition.js';
import { transitionExecutionProblemMessage } from '../domain/workflow-transition.js';

/**
 * A transition execution rejected INSIDE the locked transaction (stale
 * state, disabled row, missing approval, …). The service maps
 * `not_in_source_state` to 409 (the concurrency loser's signal — the
 * workflow moved under the caller) and every other problem to 422.
 */
export class WorkflowExecutionError extends Error {
  readonly problem: TransitionExecutionProblem;

  constructor(problem: TransitionExecutionProblem) {
    super(transitionExecutionProblemMessage(problem));
    this.name = 'WorkflowExecutionError';
    this.problem = problem;
  }
}

/**
 * A draft-configuration write that lost a race with publishing: the version
 * row was still a draft when the service checked, but no longer is under
 * the lock. The service maps this to 409 — the client must re-read the
 * version and, if behaviour must change, create a NEW version.
 */
export class WorkflowVersionLockedError extends Error {
  constructor(readonly versionId: string) {
    super(
      `Workflow version "${versionId}" is no longer a draft and cannot be changed. Create a new version instead.`,
    );
    this.name = 'WorkflowVersionLockedError';
  }
}

/**
 * An approval decision or execution that found its approval stale: a
 * transition landed after the request, so the approval no longer describes
 * the state it was requested in. The service maps this to 422.
 */
export class WorkflowApprovalStaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowApprovalStaleError';
  }
}

/**
 * An approval request for an (instance, transition) that already has a
 * pending approval. The service maps this to 409 — decide or supersede the
 * live request instead of stacking another.
 */
export class WorkflowApprovalPendingError extends Error {
  constructor(
    readonly instanceId: string,
    readonly transitionId: string,
  ) {
    super(
      'A pending approval already exists for this workflow transition. Decide it before requesting another.',
    );
    this.name = 'WorkflowApprovalPendingError';
  }
}
