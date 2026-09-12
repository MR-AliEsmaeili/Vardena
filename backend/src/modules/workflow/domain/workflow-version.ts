/**
 * Workflow version — one behaviour revision of a definition (Task 9 §6/§23).
 *
 * Lifecycle is one-way: `draft → active → superseded`.
 * - `draft`: the configuration workspace. States, transitions and automation
 *   bindings may be created/edited/deleted here — and ONLY here.
 * - `active`: the one version per definition that new bindings resolve to.
 *   Immutable.
 * - `superseded`: a previously active version kept for pinned in-flight
 *   instances and truthful history. Immutable, never selected for new
 *   bindings.
 *
 * Publishing validates the version deterministically: exactly one initial
 * state, no outgoing transition from a terminal state, every transition
 * referencing states of the same version. Anything else is rejected and the
 * version stays a draft.
 *
 * Framework-free (AR-05).
 */

export const WORKFLOW_VERSION_STATUSES = [
  'draft',
  'active',
  'superseded',
] as const;

export type WorkflowVersionStatus = (typeof WORKFLOW_VERSION_STATUSES)[number];

export function isWorkflowVersionStatus(
  value: string,
): value is WorkflowVersionStatus {
  return (WORKFLOW_VERSION_STATUSES as readonly string[]).includes(value);
}

export interface WorkflowVersion {
  id: string;
  organizationId: string;
  definitionId: string;
  versionNumber: number;
  status: WorkflowVersionStatus;
  effectiveFrom: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface WorkflowVersionDto {
  id: string;
  organizationId: string;
  definitionId: string;
  versionNumber: number;
  status: WorkflowVersionStatus;
  effectiveFrom: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toWorkflowVersionDto(
  version: WorkflowVersion,
): WorkflowVersionDto {
  return {
    id: version.id,
    organizationId: version.organizationId,
    definitionId: version.definitionId,
    versionNumber: version.versionNumber,
    status: version.status,
    effectiveFrom: version.effectiveFrom?.toISOString() ?? null,
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
  };
}

/** A version is mutable only while it is a draft. */
export function isVersionEditable(status: WorkflowVersionStatus): boolean {
  return status === 'draft';
}

/** Only active versions may be selected for new bindings. */
export function isVersionBindable(status: WorkflowVersionStatus): boolean {
  return status === 'active';
}

// ---------------------------------------------------------------------------
// Publish validation (Task 9 §14/§15/§28)
// ---------------------------------------------------------------------------

/** The minimal state shape publish validation needs. */
export interface PublishStateInput {
  id: string;
  code: string;
  isInitial: boolean;
  isTerminal: boolean;
  isActive: boolean;
}

/** The minimal transition shape publish validation needs. */
export interface PublishTransitionInput {
  id: string;
  code: string;
  sourceStateId: string;
  targetStateId: string;
  isActive: boolean;
}

export type PublishProblem =
  | 'no_states'
  | 'missing_initial_state'
  | 'multiple_initial_states'
  | 'initial_state_disabled'
  | 'unknown_transition_state'
  | 'terminal_state_has_outgoing_transition'
  | 'self_transition';

export function publishProblemMessage(problem: PublishProblem): string {
  switch (problem) {
    case 'no_states':
      return 'A workflow version needs at least one state before it can be published.';
    case 'missing_initial_state':
      return 'A workflow version needs exactly one initial state before it can be published.';
    case 'multiple_initial_states':
      return 'A workflow version must have exactly one initial state; several are marked initial.';
    case 'initial_state_disabled':
      return 'The initial state is disabled. Enable it or choose another initial state before publishing.';
    case 'unknown_transition_state':
      return 'A transition references a state that does not belong to this workflow version.';
    case 'terminal_state_has_outgoing_transition':
      return 'A terminal state must not have outgoing transitions. Remove the transition or unmark the state as terminal.';
    case 'self_transition':
      return 'A transition must move the workflow to a different state; self-transitions are not supported.';
  }
}

export interface PublishPlan {
  problem: PublishProblem | null;
  /** The offending transition/state code when the problem names one. */
  subject?: string | undefined;
}

/**
 * Validate a draft version for publishing. Deterministic and total: every
 * invalid configuration is rejected with a problem code, and only a
 * problem-free version may become active.
 *
 * Disabled transitions are ignored (they are configuration leftovers, not
 * behaviour); disabled STATES still count for the initial-state rule, because
 * binding to a disabled state must be impossible — hence the explicit
 * `initial_state_disabled` problem instead of silently skipping them.
 */
export function planPublish(input: {
  states: readonly PublishStateInput[];
  transitions: readonly PublishTransitionInput[];
}): PublishPlan {
  if (input.states.length === 0) return { problem: 'no_states' };

  const byId = new Map(input.states.map((state) => [state.id, state]));
  const initials = input.states.filter((state) => state.isInitial);
  if (initials.length === 0) return { problem: 'missing_initial_state' };
  if (initials.length > 1) return { problem: 'multiple_initial_states' };
  const initial = initials[0] as PublishStateInput;
  if (!initial.isActive) return { problem: 'initial_state_disabled' };

  const enabled = input.transitions.filter((transition) => transition.isActive);
  for (const transition of enabled) {
    const source = byId.get(transition.sourceStateId);
    const target = byId.get(transition.targetStateId);
    if (source === undefined || target === undefined) {
      return {
        problem: 'unknown_transition_state',
        subject: transition.code,
      };
    }
    if (transition.sourceStateId === transition.targetStateId) {
      return { problem: 'self_transition', subject: transition.code };
    }
    if (source.isTerminal) {
      return {
        problem: 'terminal_state_has_outgoing_transition',
        subject: transition.code,
      };
    }
  }
  return { problem: null };
}
