/**
 * Master-data conventions shared by the Organization module entities
 * (docs/architecture/domain/master-data-strategy.md §7).
 *
 * Lifecycle: `is_active` is the ONLY lifecycle mechanism implemented here.
 * Disabling is reversible, blocks *new* usage, and keeps history readable
 * (§7.4). There is no `deleted_at`: Task 6 implements no delete operation,
 * and §7 forbids running two competing lifecycle mechanisms. Deletion
 * semantics are OQ-36.
 *
 * Codes: the repository does not define a business-code format anywhere
 * (docs/database-strategy.md §4 explicitly refuses to invent numbering —
 * OQ-12). So the only rules applied are "non-blank after trimming" and the
 * column's length limit. Codes are compared case-sensitively; whether
 * `ABC` and `abc` must be the same code is an open product question
 * (OQ-36). No format regex is invented here.
 *
 * Framework-free (AR-05): pure constants and functions, no Nest imports.
 */

/** `organization.*.code` / `inventory.*.code` column width. */
export const MAX_CODE_LENGTH = 64;
/** Employee code column width (same as other codes). */
export const MAX_EMPLOYEE_CODE_LENGTH = 64;
/** `*.name` column width for organization-structure entities. */
export const MAX_NAME_LENGTH = 200;
/** `employees.first_name` / `employees.last_name` column width. */
export const MAX_PERSON_NAME_LENGTH = 120;
/** `parties.display_name` / `parties.legal_name` column width. */
export const MAX_PARTY_NAME_LENGTH = 200;

/** Business codes are stored trimmed; nothing else is normalised. */
export function normalizeCode(value: string): string {
  return value.trim();
}

/** Names are stored trimmed with internal whitespace runs collapsed. */
export function normalizeName(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** True when a trimmed value has content (the "name cannot be blank" rule). */
export function isNonBlank(value: string): boolean {
  return value.trim().length > 0;
}
