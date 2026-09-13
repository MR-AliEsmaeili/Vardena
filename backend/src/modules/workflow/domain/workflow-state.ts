/**
 * Workflow state — one state in a version's bounded state set (Task 9 §7).
 *
 * A state is data, but the concepts are code-controlled: codes are stable
 * snake_case, exactly one state per publishable version is initial (the
 * deterministic bind target), and terminal states accept no outgoing
 * transitions. A state that is BOTH initial and terminal is a valid
 * degenerate version (bind → immediately complete, no transitions).
 *
 * This is orthogonal to the Document Foundation's draft/temporary/final
 * lifecycle (Task 8 §7/§8): `draft` is a separate pre-issuance phase, never
 * a workflow state, and workflow stays usable by entities without any draft
 * concept. Nothing here redefines or depends on that lifecycle.
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

export interface WorkflowState {
  id: string;
  organizationId: string;
  versionId: string;
  code: string;
  name: string;
  description: string | null;
  isInitial: boolean;
  isTerminal: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface WorkflowStateDto {
  id: string;
  organizationId: string;
  versionId: string;
  code: string;
  name: string;
  description: string | null;
  isInitial: boolean;
  isTerminal: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export function toWorkflowStateDto(state: WorkflowState): WorkflowStateDto {
  return {
    id: state.id,
    organizationId: state.organizationId,
    versionId: state.versionId,
    code: state.code,
    name: state.name,
    description: state.description,
    isInitial: state.isInitial,
    isTerminal: state.isTerminal,
    isActive: state.isActive,
    sortOrder: state.sortOrder,
    createdAt: state.createdAt.toISOString(),
    updatedAt: state.updatedAt.toISOString(),
  };
}

export type WorkflowStateProblem =
  | 'invalid_code'
  | 'blank_name'
  | 'name_too_long'
  | 'description_too_long'
  | 'invalid_sort_order';

export function workflowStateProblemMessage(
  problem: WorkflowStateProblem,
): string {
  switch (problem) {
    case 'invalid_code':
      return `State code must be lowercase snake_case (1–${MAX_WORKFLOW_CODE_LENGTH} characters, e.g. "pending_approval").`;
    case 'blank_name':
      return 'State name is required.';
    case 'name_too_long':
      return `State name must be at most ${MAX_WORKFLOW_NAME_LENGTH} characters.`;
    case 'description_too_long':
      return `State description must be at most ${MAX_WORKFLOW_DESCRIPTION_LENGTH} characters.`;
    case 'invalid_sort_order':
      return `Sort order must be an integer between 0 and ${MAX_WORKFLOW_SORT_ORDER}.`;
  }
}

/** Validate state shape (uniqueness and lifecycle are the service's job). */
export function planWorkflowState(input: {
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
}): { problem: WorkflowStateProblem | null } {
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
  return { problem: null };
}
