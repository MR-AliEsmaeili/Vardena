/**
 * Workflow definition — the named, organization-scoped template (Task 9 §5).
 *
 * A definition is a stable container; the behaviour lives in its versions.
 * `code` is the organization's business key for the template: unique per
 * organization, immutable after creation. Disabling a definition blocks NEW
 * bindings and NEW version activations; in-flight instances keep
 * transitioning under their pinned version (Task 9 §23).
 *
 * Framework-free (AR-05).
 */

import {
  isValidWorkflowCode,
  MAX_WORKFLOW_CODE_LENGTH,
  MAX_WORKFLOW_DESCRIPTION_LENGTH,
  MAX_WORKFLOW_NAME_LENGTH,
} from './workflow-codes.js';

export interface WorkflowDefinition {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface WorkflowDefinitionDto {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toWorkflowDefinitionDto(
  definition: WorkflowDefinition,
): WorkflowDefinitionDto {
  return {
    id: definition.id,
    organizationId: definition.organizationId,
    code: definition.code,
    name: definition.name,
    description: definition.description,
    isActive: definition.isActive,
    createdAt: definition.createdAt.toISOString(),
    updatedAt: definition.updatedAt.toISOString(),
  };
}

export type WorkflowDefinitionProblem =
  'invalid_code' | 'blank_name' | 'name_too_long' | 'description_too_long';

export function workflowDefinitionProblemMessage(
  problem: WorkflowDefinitionProblem,
): string {
  switch (problem) {
    case 'invalid_code':
      return `Code must be lowercase snake_case (1–${MAX_WORKFLOW_CODE_LENGTH} characters, e.g. "inventory_receipt").`;
    case 'blank_name':
      return 'Name is required.';
    case 'name_too_long':
      return `Name must be at most ${MAX_WORKFLOW_NAME_LENGTH} characters.`;
    case 'description_too_long':
      return `Description must be at most ${MAX_WORKFLOW_DESCRIPTION_LENGTH} characters.`;
  }
}

/** Validate definition shape (uniqueness is the database's job). */
export function planWorkflowDefinition(input: {
  code: string;
  name: string;
  description: string | null;
}): { problem: WorkflowDefinitionProblem | null } {
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
  return { problem: null };
}
