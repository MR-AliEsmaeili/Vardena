/**
 * Workflow instance — the binding of ONE business entity to one workflow
 * version, plus its current state (Task 9 §11/§12).
 *
 * The entity is a LOGICAL reference (module + type + id): there is no
 * universal document table (Task 8 rejected it), no FK to the owning
 * module's tables, and Workflow never reads the referenced row (AR-07/08).
 * `version_id` is pinned at bind time and never changes; `current_state_id`
 * changes only through a valid transition inside the locked transaction.
 *
 * Framework-free (AR-05).
 */

import { isUlid } from '../../../kernel/ids/ulid.js';
import {
  isValidWorkflowEntityType,
  isValidWorkflowModuleName,
  MAX_WORKFLOW_ENTITY_ID_LENGTH,
} from './workflow-codes.js';

export interface WorkflowInstance {
  id: string;
  organizationId: string;
  definitionId: string;
  versionId: string;
  entityModule: string;
  entityType: string;
  entityId: string;
  currentStateId: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface WorkflowInstanceDto {
  id: string;
  organizationId: string;
  definitionId: string;
  versionId: string;
  entityModule: string;
  entityType: string;
  entityId: string;
  currentStateId: string;
  createdAt: string;
  updatedAt: string;
}

export function toWorkflowInstanceDto(
  instance: WorkflowInstance,
): WorkflowInstanceDto {
  return {
    id: instance.id,
    organizationId: instance.organizationId,
    definitionId: instance.definitionId,
    versionId: instance.versionId,
    entityModule: instance.entityModule,
    entityType: instance.entityType,
    entityId: instance.entityId,
    currentStateId: instance.currentStateId,
    createdAt: instance.createdAt.toISOString(),
    updatedAt: instance.updatedAt.toISOString(),
  };
}

export type EntityReferenceProblem =
  'invalid_module' | 'invalid_entity_type' | 'invalid_entity_id';

export function entityReferenceProblemMessage(
  problem: EntityReferenceProblem,
): string {
  switch (problem) {
    case 'invalid_module':
      return 'Entity module must be lowercase snake_case (e.g. "inventory").';
    case 'invalid_entity_type':
      return 'Entity type must be lowercase snake_case (e.g. "inventory_receipt").';
    case 'invalid_entity_id':
      return `Entity id must be a valid ULID of at most ${MAX_WORKFLOW_ENTITY_ID_LENGTH} characters.`;
  }
}

/**
 * Validate a logical entity reference. The MODULE/TYPE formats mirror the
 * Document Foundation's conventions (self-contained here, AR-07); the ID
 * must be a ULID — Workflow binds Vardena entities, and Vardena identity is
 * a ULID (ADR-0008).
 */
export function planEntityReference(input: {
  entityModule: string;
  entityType: string;
  entityId: string;
}): { problem: EntityReferenceProblem | null } {
  if (!isValidWorkflowModuleName(input.entityModule)) {
    return { problem: 'invalid_module' };
  }
  if (!isValidWorkflowEntityType(input.entityType)) {
    return { problem: 'invalid_entity_type' };
  }
  if (
    input.entityId.length > MAX_WORKFLOW_ENTITY_ID_LENGTH ||
    !isUlid(input.entityId)
  ) {
    return { problem: 'invalid_entity_id' };
  }
  return { problem: null };
}
