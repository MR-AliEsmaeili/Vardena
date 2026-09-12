import type { PermissionDefinition } from '../../rbac/domain/permission-definition.js';

/**
 * The Workflow Foundation's permissions (AR-22, ADR-0006, docs/security.md §3).
 *
 * Codes follow the established `Module.Entity.Action` form. They cover ONLY
 * the workflow mechanics this module owns — definitions, versions (including
 * draft state/transition/automation configuration), and runtime bindings.
 * Per-transition authorization additionally requires the transition's OWN
 * `required_permission` (any registered RBAC code, e.g. a future
 * `Inventory.Receipt.Approve`): the guard checks the workflow permission,
 * the service re-checks BOTH (Task 9 §9, AR-04/AR-21).
 *
 * What is intentionally absent:
 * - a wildcard/superuser code (OQ-21);
 * - a "bypass workflow rules" code — there is no legal way around a valid
 *   transition check, and no code may invent one;
 * - per-state or per-transition codes — transitions name their permission in
 *   configuration, they are not separate RBAC entities.
 */

export const WORKFLOW_DEFINITION_PERMISSIONS = {
  VIEW: 'Workflow.Definition.View',
  CREATE: 'Workflow.Definition.Create',
  EDIT: 'Workflow.Definition.Edit',
} as const;

export const WORKFLOW_VERSION_PERMISSIONS = {
  VIEW: 'Workflow.Version.View',
  CREATE: 'Workflow.Version.Create',
  EDIT: 'Workflow.Version.Edit',
  PUBLISH: 'Workflow.Version.Publish',
} as const;

export const WORKFLOW_INSTANCE_PERMISSIONS = {
  VIEW: 'Workflow.Instance.View',
  BIND: 'Workflow.Instance.Bind',
  EXECUTE: 'Workflow.Instance.Execute',
} as const;

function def(code: string, description: string): PermissionDefinition {
  return { code, description };
}

export const WORKFLOW_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] =
  [
    def(
      WORKFLOW_DEFINITION_PERMISSIONS.VIEW,
      'View workflow definitions of an organization.',
    ),
    def(
      WORKFLOW_DEFINITION_PERMISSIONS.CREATE,
      'Create a workflow definition in an organization.',
    ),
    def(
      WORKFLOW_DEFINITION_PERMISSIONS.EDIT,
      'Edit a workflow definition (name, description, active state). Codes and versions are never edited through the definition.',
    ),
    def(
      WORKFLOW_VERSION_PERMISSIONS.VIEW,
      'View workflow versions, their states, transitions and automation bindings.',
    ),
    def(
      WORKFLOW_VERSION_PERMISSIONS.CREATE,
      'Create a draft workflow version for a definition.',
    ),
    def(
      WORKFLOW_VERSION_PERMISSIONS.EDIT,
      'Configure a draft workflow version: its states, transitions and automation bindings. Active and superseded versions are immutable.',
    ),
    def(
      WORKFLOW_VERSION_PERMISSIONS.PUBLISH,
      'Publish a draft workflow version after validation, superseding the previously active version.',
    ),
    def(
      WORKFLOW_INSTANCE_PERMISSIONS.VIEW,
      'View workflow bindings, current states, available transitions and transition history.',
    ),
    def(
      WORKFLOW_INSTANCE_PERMISSIONS.BIND,
      'Bind a business entity to a workflow version.',
    ),
    def(
      WORKFLOW_INSTANCE_PERMISSIONS.EXECUTE,
      'Execute a workflow transition (and request or decide approvals) — in addition to the transition\u2019s own required permission.',
    ),
  ];
