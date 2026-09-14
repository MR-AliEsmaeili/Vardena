/**
 * Accounting foundation conventions (Task 10.2, ADR-0026,
 * docs/accounting/domain-contract.md §4/§5/§6/§7).
 *
 * Lifecycle: `is_active` is the ONLY lifecycle mechanism (OQ-36 posture).
 * Disabling is reversible, blocks *new* usage, and keeps history readable.
 * There is no `deleted_at`: Task 10.2 implements no delete operation, and
 * deletion semantics stay open (OQ-36). Periods carry no `is_active` at
 * all — `status` is their whole lifecycle (contract §7.1).
 *
 * Codes: the repository defines no business-code format anywhere
 * (docs/database-strategy.md §4 refuses to invent numbering — OQ-12), so
 * the only rules applied are "non-blank after trimming" and the column's
 * length limit. Codes are compared case-sensitively and are never reused
 * (OQ-36 posture).
 *
 * Framework-free (AR-05): pure constants and functions, no Nest imports.
 */

/** `accounting.*.code` column width. */
export const MAX_CODE_LENGTH = 64;
/** `accounting.*.title` column width. */
export const MAX_TITLE_LENGTH = 200;
/** Transition-reason column width (mirrors `reason varchar(500)` elsewhere). */
export const MAX_REASON_LENGTH = 500;

/** Business codes are stored trimmed; nothing else is normalised. */
export function normalizeCode(value: string): string {
  return value.trim();
}

/** Titles and reasons are stored trimmed with whitespace runs collapsed. */
export function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** True when a trimmed value has content (the "cannot be blank" rule). */
export function isNonBlank(value: string): boolean {
  return value.trim().length > 0;
}
