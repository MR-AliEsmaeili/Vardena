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
