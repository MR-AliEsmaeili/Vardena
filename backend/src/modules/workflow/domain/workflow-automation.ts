/**
 * Workflow automation binding — transition → registered-action link (Task 9 §18).
 *
 * The binding is the v1 CONTRACT: which catalogue action fires for a
 * transition, with typed parameters. Actions come from the code-defined
 * `AutomationActionRegistry` — no user scripts, no stored code, no generic
 * expressions. Parameters are a FLAT JSON object (string keys, primitive
 * values, bounded size): enough for "recipients + template" style bindings,
 * too small to smuggle a program. Per-action parameter schemas are the
 * documented extension point (a catalogue action may declare one later);
 * v1 validates the envelope only.
 *
 * v1 RECORDS the binding and reports it on the transition event so future
 * consumers can react; executing external effects through the outbox/worker
 * is a future automation module, not this task.
 *
 * Framework-free (AR-05).
 */

import {
  isValidWorkflowCode,
  MAX_WORKFLOW_CODE_LENGTH,
  MAX_WORKFLOW_SORT_ORDER,
} from './workflow-codes.js';

/** Action codes use the stable workflow-code format (`notify`, `post_journal`). */
export function isValidAutomationAction(action: string): boolean {
  return isValidWorkflowCode(action);
}

/** v1 parameter envelope bounds (the "typed/validated" contract). */
export const MAX_AUTOMATION_PARAMETER_KEYS = 50;
export const MAX_AUTOMATION_PARAMETER_KEY_LENGTH = 64;
export const MAX_AUTOMATION_PARAMETER_STRING_LENGTH = 500;

const AUTOMATION_PARAMETER_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

export type AutomationParameters = Record<
  string,
  string | number | boolean | null
>;

export function isValidAutomationParameterKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= MAX_AUTOMATION_PARAMETER_KEY_LENGTH &&
    AUTOMATION_PARAMETER_KEY_PATTERN.test(key)
  );
}

/**
 * Validate the v1 parameter envelope: a flat object (or null/undefined for
 * "no parameters") with bounded keys and primitive values. Nested objects,
 * arrays and over-long strings are rejected — a binding that needs richer
 * input needs a new catalogue action with its own schema, not a bigger blob.
 */
export function isValidAutomationParameters(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_AUTOMATION_PARAMETER_KEYS) return false;
  for (const [key, entry] of entries) {
    if (!isValidAutomationParameterKey(key)) return false;
    switch (typeof entry) {
      case 'string':
        if (entry.length > MAX_AUTOMATION_PARAMETER_STRING_LENGTH) return false;
        break;
      case 'number':
        if (!Number.isFinite(entry)) return false;
        break;
      case 'boolean':
        break;
      default:
        // Only null survives here (objects/arrays/undefined rejected).
        if (entry !== null) return false;
        break;
    }
  }
  return true;
}

export interface WorkflowAutomationBinding {
  id: string;
  organizationId: string;
  versionId: string;
  transitionId: string;
  action: string;
  parameters: AutomationParameters | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface WorkflowAutomationBindingDto {
  id: string;
  organizationId: string;
  versionId: string;
  transitionId: string;
  action: string;
  parameters: AutomationParameters | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toWorkflowAutomationBindingDto(
  binding: WorkflowAutomationBinding,
): WorkflowAutomationBindingDto {
  return {
    id: binding.id,
    organizationId: binding.organizationId,
    versionId: binding.versionId,
    transitionId: binding.transitionId,
    action: binding.action,
    parameters: binding.parameters,
    sortOrder: binding.sortOrder,
    isActive: binding.isActive,
    createdAt: binding.createdAt.toISOString(),
    updatedAt: binding.updatedAt.toISOString(),
  };
}

export type WorkflowAutomationProblem =
  'invalid_action' | 'invalid_parameters' | 'invalid_sort_order';

export function workflowAutomationProblemMessage(
  problem: WorkflowAutomationProblem,
): string {
  switch (problem) {
    case 'invalid_action':
      return `Action must be a registered automation action (lowercase snake_case, 1–${MAX_WORKFLOW_CODE_LENGTH} characters).`;
    case 'invalid_parameters':
      return `Parameters must be a flat JSON object (at most ${MAX_AUTOMATION_PARAMETER_KEYS} keys) with string, number, boolean or null values.`;
    case 'invalid_sort_order':
      return `Sort order must be an integer between 0 and ${MAX_WORKFLOW_SORT_ORDER}.`;
  }
}

/**
 * Validate binding shape. Whether the ACTION is registered is the service's
 * job (it owns the registry); the envelope rule lives here.
 */
export function planWorkflowAutomation(input: {
  action: string;
  parameters: unknown;
  sortOrder: number;
}): { problem: WorkflowAutomationProblem | null } {
  if (!isValidAutomationAction(input.action)) {
    return { problem: 'invalid_action' };
  }
  if (!isValidAutomationParameters(input.parameters)) {
    return { problem: 'invalid_parameters' };
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

/**
 * Normalize validated parameters for storage: null/undefined become null,
 * otherwise the flat object passes through unchanged.
 */
export function normalizeAutomationParameters(
  value: unknown,
): AutomationParameters | null {
  if (value === null || value === undefined) return null;
  return { ...(value as AutomationParameters) };
}
