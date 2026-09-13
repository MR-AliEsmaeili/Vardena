import { WorkflowVersionLockedError } from './workflow-errors.js';
import type { WorkflowTxClient } from './workflow-rows.js';

/**
 * Row locking for the Workflow Foundation (Task 9 §12/§21, ADR-0024).
 *
 * Three locked paths, one rule each:
 *
 * - EXECUTION locks the INSTANCE row (`SELECT … FOR UPDATE`) and applies
 *   the state change + history insert in the same transaction. Two
 *   concurrent transitions for one instance serialize here: the loser
 *   re-reads the winner's state and fails cleanly (`not_in_source_state`).
 *   The `(instance_id, sequence)` unique index is the backstop.
 * - PUBLISH locks the DEFINITION row first, then the VERSION row, then
 *   validates and flips statuses — so two concurrent publishes for one
 *   definition cannot both go active, and no configuration write can slip
 *   in mid-publish.
 * - DRAFT CONFIGURATION writes lock the VERSION row, re-check `draft`,
 *   then write — so a publish racing a state/transition edit fails one of
 *   them instead of mutating an active version.
 *
 * Lock ORDER is fixed (definition → version → instance) and no path ever
 * acquires them out of order, so no deadlock cycle exists. Approvals lock
 * the instance row too (they read the history length), which keeps the
 * request/decide/execute triple consistent.
 *
 * Prisma cannot express `SELECT … FOR UPDATE`, hence the parameterized raw
 * statements below — the documented concurrency-critical path
 * (docs/database-strategy.md §13, AR-11).
 */

/** An instance row as locked by the execution/approval paths. */
export interface LockedInstanceRow {
  id: string;
  organizationId: string;
  definitionId: string;
  versionId: string;
  currentStateId: string;
  createdBy: string | null;
}

interface LockedInstanceColumns {
  id: string;
  organizationId: string;
  definitionId: string;
  versionId: string;
  currentStateId: string;
  createdBy: string | null;
}

/**
 * Lock an instance row and return the fields the execution path needs. The
 * lock is held until commit/rollback, so check-then-act (current state →
 * validate → new state + history) is atomic per instance.
 *
 * @returns null when the instance does not exist (the service maps it to 404).
 */
export async function lockInstanceRow(
  tx: WorkflowTxClient,
  instanceId: string,
): Promise<LockedInstanceRow | null> {
  const rows = await tx.$queryRaw<LockedInstanceColumns>`
    SELECT "id",
           "organization_id" AS "organizationId",
           "definition_id" AS "definitionId",
           "version_id" AS "versionId",
           "current_state_id" AS "currentStateId",
           "created_by" AS "createdBy"
      FROM "workflow"."workflow_instances"
     WHERE "id" = ${instanceId}
     FOR UPDATE`;
  const [row] = rows;
  if (row === undefined) return null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    definitionId: row.definitionId,
    versionId: row.versionId,
    currentStateId: row.currentStateId,
    createdBy: row.createdBy,
  };
}

/** A version row as locked by the publish/configuration paths. */
export interface LockedVersionRow {
  id: string;
  organizationId: string;
  definitionId: string;
  versionNumber: number;
  status: string;
}

interface LockedVersionColumns {
  id: string;
  organizationId: string;
  definitionId: string;
  versionNumber: number;
  status: string;
}

/**
 * Lock a version row and return its identity + status. Configuration writes
 * re-check `draft` on this snapshot; publish validates against it.
 *
 * @returns null when the version does not exist.
 */
export async function lockVersionRow(
  tx: WorkflowTxClient,
  versionId: string,
): Promise<LockedVersionRow | null> {
  const rows = await tx.$queryRaw<LockedVersionColumns>`
    SELECT "id",
           "organization_id" AS "organizationId",
           "definition_id" AS "definitionId",
           "version_number" AS "versionNumber",
           "status" AS "status"
      FROM "workflow"."workflow_versions"
     WHERE "id" = ${versionId}
     FOR UPDATE`;
  const [row] = rows;
  if (row === undefined) return null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    definitionId: row.definitionId,
    versionNumber: row.versionNumber,
    status: row.status,
  };
}

/**
 * Lock a version row and require it to still be a draft. Draft-configuration
 * writes call this before writing: the service pre-checks `draft` outside
 * the transaction for a fast 422, and this re-check under the lock turns a
 * lost race with publishing into `WorkflowVersionLockedError` (409).
 *
 * @throws Error when the version row no longer exists.
 * @throws WorkflowVersionLockedError when the version is no longer a draft.
 */
export async function requireDraftVersion(
  tx: WorkflowTxClient,
  versionId: string,
): Promise<LockedVersionRow> {
  const locked = await lockVersionRow(tx, versionId);
  if (locked === null) {
    throw new Error(`Workflow version "${versionId}" no longer exists.`);
  }
  if (locked.status !== 'draft') {
    throw new WorkflowVersionLockedError(versionId);
  }
  return locked;
}

/**
 * Lock a definition row (the publish serialization point). Two concurrent
 * publishes for one definition serialize here, so exactly one version can
 * become active.
 *
 * @returns false when the definition does not exist.
 */
export async function lockDefinitionRow(
  tx: WorkflowTxClient,
  definitionId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }>`
    SELECT "id" AS "id"
      FROM "workflow"."workflow_definitions"
     WHERE "id" = ${definitionId}
     FOR UPDATE`;
  return rows.length > 0;
}
