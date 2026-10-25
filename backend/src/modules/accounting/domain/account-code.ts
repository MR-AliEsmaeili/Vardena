/**
 * Account code rules (§9.2/§9.3, AC-I-10/AC-I-11).
 *
 * The canonical code is the concatenation of the level segments, DIGITS ONLY —
 * no separator, no letter, no prefix or suffix. That mirrors the numbering
 * foundation's numeric serial decision (ADR-0023) and is what stops `02-003`
 * and `02003` from becoming two accounts. Rendering (`02-003`, `02/003`) is a
 * presentation concern (frontend formatters, print templates, OQ-02); the
 * stored representation is the plain digit string and so is uniqueness.
 *
 * Normalization is TRIM ONLY — the repository-wide master-data convention
 * (`domain/master-data.ts`). Nothing else is silently rewritten: no case
 * folding (codes are compared case-sensitively and literally, §9.2), no
 * separator stripping, no zero-padding the caller did not type. A client that
 * wants padded segments gets a validation error, not a "helpful" rewrite.
 *
 * The code ⇄ hierarchy consistency is checked on BOTH sides (§9.3): a child's
 * code must extend its parent's code by exactly the child level's segment
 * width, and its total length must equal the sum of the segments of every level
 * it spans. The `parent_id` FK is the authority for the tree and the prefix is
 * the PROOF — when they disagree the placement is refused here rather than
 * stored for a reconciliation report to discover.
 *
 * Framework-free (AR-05).
 */

import type { CodingStructureLevel } from './coding-structure.js';
import {
  codeLengthForLevel,
  MAX_ACCOUNT_CODE_LENGTH,
  segmentLengthForLevel,
} from './coding-structure.js';

/** ASCII digits only — Persian-digit rendering stays a display concern. */
export const ACCOUNT_CODE_PATTERN = /^[0-9]+$/;

export type AccountCodeProblem =
  | 'not_digits_only'
  | 'code_too_long'
  | 'level_unknown'
  | 'level_length_mismatch'
  | 'parent_prefix_mismatch';

export interface AccountCodeCheck {
  problem: AccountCodeProblem | null;
  /** Field the caller should highlight in a 400/422 response. */
  field: 'code' | 'parentId';
}

/**
 * Validate one candidate code against the coding-structure version that will
 * own the account (the level definitions supply the segment widths).
 *
 * @param code        the canonical (trimmed) code as it will be stored
 * @param level       the account's level, already derived from the parent
 * @param parentCode  the parent's code, or `null` for a root placement
 * @param levels      the level rows of the pinned version
 */
export function checkAccountCode(input: {
  code: string;
  level: number;
  parentCode: string | null;
  levels: readonly Pick<CodingStructureLevel, 'levelIndex' | 'digitLength'>[];
}): AccountCodeCheck {
  const root: AccountCodeCheck = { problem: null, field: 'code' };
  if (!ACCOUNT_CODE_PATTERN.test(input.code)) {
    return { problem: 'not_digits_only', field: 'code' };
  }
  if (input.code.length > MAX_ACCOUNT_CODE_LENGTH) {
    return { problem: 'code_too_long', field: 'code' };
  }
  const expectedLength = codeLengthForLevel(input.levels, input.level);
  if (expectedLength === null) {
    return { problem: 'level_unknown', field: 'parentId' };
  }
  if (input.code.length !== expectedLength) {
    return { problem: 'level_length_mismatch', field: 'code' };
  }
  if (input.parentCode !== null) {
    const segmentLength = segmentLengthForLevel(input.levels, input.level);
    const suffixLength = input.code.length - input.parentCode.length;
    if (
      segmentLength === null ||
      !input.code.startsWith(input.parentCode) ||
      suffixLength !== segmentLength
    ) {
      return { problem: 'parent_prefix_mismatch', field: 'code' };
    }
  }
  return root;
}

// ---------------------------------------------------------------------------
// Local code segment ⇄ full code (the operator-facing composition)
// ---------------------------------------------------------------------------
//
// The STORED code stays exactly what it has always been: the full canonical
// digit string (§9.2). What an operator types when CREATING an account is
// the LOCAL segment of the account's own level — `003` for the معین under کل
// `101` — and the backend composes `parent.code + localCode` into the full
// code. The local segment is therefore an INPUT/DISPLAY derivation, never a
// second stored value and never a second source of truth: it is recovered
// from the full code by removing the parent's code (the `parent_id` FK is
// the authority and the prefix is the proof, §9.3), and its width is exactly
// the level's configured `digitLength`, leading zeros included (`003` is a
// three-digit segment, not the number 3).

export type LocalCodeProblem =
  /** The segment is not ASCII digits only. */
  | 'local_code_not_digits'
  /** The segment width differs from the level's configured digit length. */
  | 'local_code_length_mismatch'
  /** The level the segment belongs to is not defined by the structure. */
  | 'level_unknown';

/**
 * Validate one candidate LOCAL segment against the level it will occupy.
 * `level` is derived from the parent exactly as for a full code (root = 1,
 * child = parent + 1); the segment must be digits only and EXACTLY the
 * level's configured digit length — never zero-padded or trimmed into shape
 * (the same no-silent-rewrite posture as the full code).
 */
export function checkLocalCodeSegment(input: {
  localCode: string;
  level: number;
  levels: readonly Pick<CodingStructureLevel, 'levelIndex' | 'digitLength'>[];
}): LocalCodeProblem | null {
  if (!ACCOUNT_CODE_PATTERN.test(input.localCode)) {
    return 'local_code_not_digits';
  }
  const segmentLength = segmentLengthForLevel(input.levels, input.level);
  if (segmentLength === null) {
    return 'level_unknown';
  }
  if (input.localCode.length !== segmentLength) {
    return 'local_code_length_mismatch';
  }
  return null;
}

/**
 * Compose the canonical full code from a parent's full code and a local
 * segment (`'101' + '003' → '101003'`; a root composes to its own segment).
 * Composition is pure concatenation — validation lives in
 * `checkLocalCodeSegment` and the composed value is still re-validated as a
 * full code by `checkAccountCode` on every write path.
 */
export function composeAccountCode(input: {
  parentCode: string | null;
  localCode: string;
}): string {
  return input.parentCode === null
    ? input.localCode
    : input.parentCode + input.localCode;
}

/**
 * The local segment of a stored full code: everything after the parent's
 * code (`'101003'` under `'101'` → `'003'`). A root's local segment is its
 * whole code.
 *
 * This derivation is TOTAL on purpose: it serves READ surfaces, and the
 * established posture is that reads are never blocked by legacy or
 * divergent rows (the ODR-1 rule in `domain/account.ts` — existing rows
 * stay readable; their repair is explicit, never a read-time failure). A
 * stored code that does not strictly extend its parent's code has no
 * PROVEN segment boundary, so the full code is presented as its segment
 * rather than inventing a boundary — such a row is still the §9.3 data
 * bug, but it is surfaced by write-path validation and reconciliation,
 * not by breaking a list. Nothing on any write path validates through
 * this function; writes use `checkAccountCode` / `checkLocalCodeSegment`.
 */
export function localSegmentOfAccountCode(input: {
  code: string;
  parentCode: string | null;
}): string {
  if (input.parentCode === null) {
    return input.code;
  }
  if (
    !input.code.startsWith(input.parentCode) ||
    input.code.length <= input.parentCode.length
  ) {
    return input.code;
  }
  return input.code.slice(input.parentCode.length);
}

/** Human-readable message per local-segment problem (AR-24). */
export function localCodeProblemMessage(problem: LocalCodeProblem): string {
  switch (problem) {
    case 'local_code_not_digits':
      return 'The local code segment must be digits only — no separators, letters or spaces (the separator is a display concern).';
    case 'local_code_length_mismatch':
      return 'The local code segment must be exactly as many digits as the coding structure configures for this level (leading zeros count).';
    case 'level_unknown':
      return 'The account level is not defined by the applicable coding structure.';
  }
}

/** Human-readable message per problem (AR-24: never leak internals). */
export function accountCodeProblemMessage(problem: AccountCodeProblem): string {
  switch (problem) {
    case 'not_digits_only':
      return 'An account code must be digits only — no separators, letters or spaces (the separator is a display concern).';
    case 'code_too_long':
      return `An account code must be at most ${MAX_ACCOUNT_CODE_LENGTH} characters.`;
    case 'level_unknown':
      return 'The account level is not defined by the applicable coding structure.';
    case 'level_length_mismatch':
      return 'The code length must equal the sum of the digit lengths of every level it spans, as configured by the coding structure.';
    case 'parent_prefix_mismatch':
      return 'A child code must be the parent code extended by exactly the configured segment length of its level.';
  }
}
