/**
 * Shared workflow code/name/description primitives (Task 9).
 *
 * Workflow identifiers are STABLE technical keys: states, transitions,
 * definitions and automation actions are referenced by code in history,
 * bindings and future configuration exports, so codes are lowercase
 * snake_case (`^[a-z][a-z0-9_]{1,63}$`) — the same convention the Document
 * Foundation uses for document type codes and module names. Names are
 * human-readable labels (non-blank, bounded); descriptions are optional
 * free text (bounded, never machine-relevant).
 *
 * This file is intentionally self-contained (AR-07): the patterns duplicate
 * the documents module's rather than importing them, so the Workflow module
 * never depends on another module's domain.
 *
 * Framework-free (AR-05).
 */

/** Stable workflow codes: `submit_for_approval`, `approved`, `post_journal`. */
export const WORKFLOW_CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export const MAX_WORKFLOW_CODE_LENGTH = 64;

export function isValidWorkflowCode(code: string): boolean {
  return WORKFLOW_CODE_PATTERN.test(code);
}

/** Owning-module names in logical entity references (`inventory`, `sales`). */
export const WORKFLOW_MODULE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export const MAX_WORKFLOW_MODULE_LENGTH = 64;

export function isValidWorkflowModuleName(module: string): boolean {
  return WORKFLOW_MODULE_PATTERN.test(module);
}

/** Entity-type codes in logical entity references (`inventory_receipt`). */
export const WORKFLOW_ENTITY_TYPE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export const MAX_WORKFLOW_ENTITY_TYPE_LENGTH = 64;

export function isValidWorkflowEntityType(entityType: string): boolean {
  return WORKFLOW_ENTITY_TYPE_PATTERN.test(entityType);
}

/** Entity ids are ULIDs today; the column stays TEXT for future external ids. */
export const MAX_WORKFLOW_ENTITY_ID_LENGTH = 128;

export const MAX_WORKFLOW_NAME_LENGTH = 200;

export const MAX_WORKFLOW_DESCRIPTION_LENGTH = 2000;

export const MAX_WORKFLOW_COMMENT_LENGTH = 2000;

/** `sort_order` stays a small, sane integer (deterministic ordering). */
export const MAX_WORKFLOW_SORT_ORDER = 1_000_000;

export function isNonBlank(value: string): boolean {
  return value.trim().length > 0;
}

/** Normalize a code-like input (trim; codes are case-sensitive, never lowered). */
export function normalizeWorkflowCode(value: string): string {
  return value.trim();
}

export function normalizeWorkflowName(value: string): string {
  return value.trim();
}

/**
 * Normalize an optional description/comment: blank becomes null. Never
 * truncates — over-long input stays over-long so the validator rejects it
 * instead of silently changing its meaning.
 */
export function normalizeWorkflowText(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
