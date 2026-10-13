/**
 * Coding Structure — the organization's configurable account coding (§9.1,
 * AC-D-10, contract §8.1; ADR-0026 §1/§3).
 *
 * A coding structure is DATA, not a constant: the number of levels, their
 * titles and their digit lengths come from the organization's active version.
 * `2 + 3 + 3` is one configuration among many and appears nowhere in this
 * file. What IS code-defined here are the two architecture caps the contract
 * names explicitly (§9.1) — depth 8 and total code length 32 — because they
 * bound validation and index widths rather than business policy; raising them
 * is a code change with an ADR note, never per-customer configuration.
 *
 * Versioning (§9.4, D-21): the lifecycle is `draft → active → superseded`
 * (one-way) with exactly ONE active version per organization — the same shape
 * the Workflow Foundation established (ADR-0024 §3), which §9.4 names as the
 * pattern. A `draft` is a configuration workspace and the only mutable state;
 * `active` and `superseded` versions are immutable so that an account's code
 * stays interpretable under the version it was created under (AC-I-14), and a
 * later structure change never reinterprets an existing code.
 *
 * Level semantics (§8.1): `level_kind` labels (`group`/`general`/
 * `subsidiary`/`detail`) are INFORMATIONAL. Nothing in Vardena derives
 * behaviour from a level name — postability is a per-level DEFAULT that the
 * account overrides (§14 rule 4), and the Iranian four-level vocabulary is
 * neither four tables nor a code constant.
 *
 * Framework-free (AR-05): pure constants and functions, unit-tested.
 */

import {
  isNonBlank,
  MAX_CODE_LENGTH,
  MAX_TITLE_LENGTH,
} from './master-data.js';

/** Closed code-defined list (the ADR-0024 version lifecycle, §9.4). */
export const CODING_STRUCTURE_STATUSES = [
  'draft',
  'active',
  'superseded',
] as const;

export type CodingStructureStatus = (typeof CODING_STRUCTURE_STATUSES)[number];

export function isCodingStructureStatus(
  value: string,
): value is CodingStructureStatus {
  return (CODING_STRUCTURE_STATUSES as readonly string[]).includes(value);
}

/**
 * Display separators (§9.1/§9.2). `''` means "none". A separator renders a
 * code; it is NEVER stored inside a code and never part of uniqueness —
 * presentation belongs to frontend formatters and print templates (OQ-02).
 */
export const CODING_STRUCTURE_SEPARATORS = ['-', '/', '.', ''] as const;

export type CodingStructureSeparator =
  (typeof CODING_STRUCTURE_SEPARATORS)[number];

export function isCodingStructureSeparator(
  value: string,
): value is CodingStructureSeparator {
  return (CODING_STRUCTURE_SEPARATORS as readonly string[]).includes(value);
}

/**
 * The common Iranian level vocabulary (§8.1, Class B). Stored for display and
 * reporting grouping only: no rule keys off it, which is why several levels may
 * share a kind and why a 6-level structure is legal even though the list has
 * four entries.
 */
export const ACCOUNT_LEVEL_KINDS = [
  'group',
  'general',
  'subsidiary',
  'detail',
] as const;

export type AccountLevelKind = (typeof ACCOUNT_LEVEL_KINDS)[number];

export function isAccountLevelKind(value: string): value is AccountLevelKind {
  return (ACCOUNT_LEVEL_KINDS as readonly string[]).includes(value);
}

/**
 * Architecture constants (§9.1) — bounds on configuration, not business rules.
 * The depth cap matches the deepest structure reported in §2.2; the length cap
 * matches the numbering foundation's `MAX_SERIAL_LENGTH` reasoning and is the
 * declared width of `accounting.accounts.code`, so it cannot be bypassed.
 */
export const MAX_CODING_STRUCTURE_DEPTH = 8;
export const MAX_ACCOUNT_CODE_LENGTH = 32;
/** A level must contribute at least one digit, or it cannot be addressed. */
export const MIN_LEVEL_DIGIT_LENGTH = 1;

/** One level of one coding-structure version (`accounting.coding_structure_levels`). */
export interface CodingStructureLevel {
  id: string;
  versionId: string;
  /** 1-based ordinal inside the version. */
  levelIndex: number;
  title: string;
  digitLength: number;
  defaultIsPostable: boolean;
  levelKind: AccountLevelKind | null;
}

/** One version of an organization's coding structure. */
export interface CodingStructureVersion {
  id: string;
  organizationId: string;
  code: string;
  versionNumber: number;
  status: CodingStructureStatus;
  maxDepth: number;
  separator: CodingStructureSeparator;
  levels: readonly CodingStructureLevel[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CodingStructureLevelDto {
  id: string;
  levelIndex: number;
  title: string;
  digitLength: number;
  defaultIsPostable: boolean;
  levelKind: AccountLevelKind | null;
}

export interface CodingStructureVersionDto {
  id: string;
  organizationId: string;
  code: string;
  versionNumber: number;
  status: CodingStructureStatus;
  maxDepth: number;
  separator: CodingStructureSeparator;
  /** Human-readable rendering of the shape, e.g. `2 + 3 + 3`. */
  pattern: string;
  levels: CodingStructureLevelDto[];
  createdAt: string;
  updatedAt: string;
}

export function toCodingStructureLevelDto(
  level: CodingStructureLevel,
): CodingStructureLevelDto {
  return {
    id: level.id,
    levelIndex: level.levelIndex,
    title: level.title,
    digitLength: level.digitLength,
    defaultIsPostable: level.defaultIsPostable,
    levelKind: level.levelKind,
  };
}

export function toCodingStructureVersionDto(
  version: CodingStructureVersion,
): CodingStructureVersionDto {
  return {
    id: version.id,
    organizationId: version.organizationId,
    code: version.code,
    versionNumber: version.versionNumber,
    status: version.status,
    maxDepth: version.maxDepth,
    separator: version.separator,
    pattern: describePattern(version.levels),
    levels: version.levels.map(toCodingStructureLevelDto),
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
  };
}

/**
 * `"2 + 3 + 3"` for the example configuration — a DERIVED, read-only summary
 * of the stored levels (never a second source of truth, and never a format
 * the API accepts: callers submit level rows, not a pattern string).
 */
export function describePattern(
  levels: readonly Pick<CodingStructureLevel, 'levelIndex' | 'digitLength'>[],
): string {
  return orderedLevels(levels)
    .map((level) => String(level.digitLength))
    .join(' + ');
}

/** Levels ordered by ordinal, defensively (the DB order is not assumed). */
export function orderedLevels<
  TLevel extends Pick<CodingStructureLevel, 'levelIndex'>,
>(levels: readonly TLevel[]): TLevel[] {
  return [...levels].sort((a, b) => a.levelIndex - b.levelIndex);
}

/** A version is mutable (levels, depth, separator) only while it is a draft. */
export function isVersionConfigurable(status: CodingStructureStatus): boolean {
  return status === 'draft';
}

/** Only the active version anchors NEW root accounts (§9.4). */
export function isVersionActive(status: CodingStructureStatus): boolean {
  return status === 'active';
}

/** Digit count a code of `level` must have: the sum of the segments 1..level. */
export function codeLengthForLevel(
  levels: readonly Pick<CodingStructureLevel, 'levelIndex' | 'digitLength'>[],
  level: number,
): number | null {
  let total = 0;
  for (const entry of orderedLevels(levels)) {
    total += entry.digitLength;
    if (entry.levelIndex === level) return total;
  }
  return null;
}

/** Digit count ONE level contributes. `null` when the level does not exist. */
export function segmentLengthForLevel(
  levels: readonly Pick<CodingStructureLevel, 'levelIndex' | 'digitLength'>[],
  level: number,
): number | null {
  for (const entry of levels) {
    if (entry.levelIndex === level) return entry.digitLength;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Structural validation (shared by draft writes and the publish gate)
// ---------------------------------------------------------------------------

/** The minimal input the shape validator needs (domain entity or DTO body). */
export interface CodingStructureLevelInput {
  levelIndex: number;
  title: string;
  digitLength: number;
  defaultIsPostable: boolean;
  levelKind: string | null;
}

export type CodingStructureProblem =
  /** Structure code missing/too long (the shape rule, not the DB key). */
  | 'code_invalid'
  /** `max_depth` outside 1..MAX_CODING_STRUCTURE_DEPTH. */
  | 'max_depth_invalid'
  /** Separator outside the closed display list. */
  | 'separator_invalid'
  /** No level rows at all — a structure with no levels cannot code anything. */
  | 'levels_missing'
  /** More level rows than `max_depth` allows. */
  | 'levels_exceed_depth'
  /** A level ordinal below 1 or above `max_depth`. */
  | 'level_index_out_of_range'
  /** Two rows claiming the same ordinal. */
  | 'level_index_duplicate'
  /** Ordinals do not cover exactly 1..max_depth (AC-I-10 skips a level). */
  | 'level_index_gap'
  /** A segment shorter than one digit. */
  | 'digit_length_invalid'
  /** The configured code would exceed the architecture length cap. */
  | 'code_length_too_large'
  /** Blank level title. */
  | 'level_title_invalid'
  /** `level_kind` outside the closed informational list. */
  | 'level_kind_invalid';

export interface CodingStructurePlan {
  problem: CodingStructureProblem | null;
  /** The offending level ordinal, when the problem names one. */
  subject?: string | undefined;
}

/**
 * Validate one coding structure version (its depth, separator and level set).
 *
 * Total and deterministic: the same function runs on the draft write (fast
 * feedback), on the publish gate, and again INSIDE the publish transaction, so
 * a configuration that is representable is a configuration that can code
 * accounts. There is no "closest match" or partial acceptance.
 */
export function planCodingStructure(input: {
  code: string;
  maxDepth: number;
  separator: string;
  levels: readonly CodingStructureLevelInput[];
}): CodingStructurePlan {
  if (!isNonBlank(input.code) || input.code.length > MAX_CODE_LENGTH) {
    return { problem: 'code_invalid' };
  }
  if (
    !Number.isInteger(input.maxDepth) ||
    input.maxDepth < 1 ||
    input.maxDepth > MAX_CODING_STRUCTURE_DEPTH
  ) {
    return { problem: 'max_depth_invalid' };
  }
  if (!isCodingStructureSeparator(input.separator)) {
    return { problem: 'separator_invalid' };
  }
  if (input.levels.length === 0) {
    return { problem: 'levels_missing' };
  }
  if (input.levels.length > input.maxDepth) {
    return { problem: 'levels_exceed_depth' };
  }

  const seen = new Set<number>();
  let totalLength = 0;
  for (const level of input.levels) {
    if (
      !Number.isInteger(level.levelIndex) ||
      level.levelIndex < 1 ||
      level.levelIndex > input.maxDepth
    ) {
      return {
        problem: 'level_index_out_of_range',
        subject: String(level.levelIndex),
      };
    }
    if (seen.has(level.levelIndex)) {
      return {
        problem: 'level_index_duplicate',
        subject: String(level.levelIndex),
      };
    }
    seen.add(level.levelIndex);

    if (
      !Number.isInteger(level.digitLength) ||
      level.digitLength < MIN_LEVEL_DIGIT_LENGTH
    ) {
      return {
        problem: 'digit_length_invalid',
        subject: String(level.levelIndex),
      };
    }
    totalLength += level.digitLength;

    if (
      !isNonBlank(level.title) ||
      level.title.length > MAX_TITLE_LENGTH ||
      level.title.trim().length === 0
    ) {
      return {
        problem: 'level_title_invalid',
        subject: String(level.levelIndex),
      };
    }
    if (level.levelKind !== null && !isAccountLevelKind(level.levelKind)) {
      return {
        problem: 'level_kind_invalid',
        subject: String(level.levelIndex),
      };
    }
  }
  // Ordinals must cover exactly 1..maxDepth: a hole would let an account exist
  // at a level with no digit rule, which no code could satisfy (§8.4 rule 1).
  for (let index = 1; index <= input.maxDepth; index += 1) {
    if (!seen.has(index)) {
      return { problem: 'level_index_gap', subject: String(index) };
    }
  }
  if (totalLength > MAX_ACCOUNT_CODE_LENGTH) {
    return { problem: 'code_length_too_large' };
  }
  return { problem: null };
}

/** Human-readable message per problem (the API never leaks internals). */
export function codingStructureProblemMessage(
  problem: CodingStructureProblem,
): string {
  switch (problem) {
    case 'code_invalid':
      return `Structure code is required and must be at most ${MAX_CODE_LENGTH} characters.`;
    case 'max_depth_invalid':
      return `maxDepth must be an integer between 1 and ${MAX_CODING_STRUCTURE_DEPTH} (the architecture depth cap).`;
    case 'separator_invalid':
      return 'separator must be one of: "-", "/", ".", "" (display only).';
    case 'levels_missing':
      return 'A coding structure needs one level definition per level (maxDepth rows).';
    case 'levels_exceed_depth':
      return 'The level list is longer than maxDepth.';
    case 'level_index_out_of_range':
      return 'Every levelIndex must be an integer between 1 and maxDepth.';
    case 'level_index_duplicate':
      return 'Two levels claim the same levelIndex; ordinals are 1..maxDepth with no duplicates.';
    case 'level_index_gap':
      return 'The level ordinals must cover 1..maxDepth with no gap.';
    case 'digit_length_invalid':
      return `Every level must contribute at least ${MIN_LEVEL_DIGIT_LENGTH} digit(s).`;
    case 'code_length_too_large':
      return `The configured levels add up to more than the maximum account code length (${MAX_ACCOUNT_CODE_LENGTH} characters).`;
    case 'level_title_invalid':
      return 'Every level needs a non-blank title.';
    case 'level_kind_invalid':
      return `levelKind must be one of: ${ACCOUNT_LEVEL_KINDS.join(', ')}, or null.`;
  }
}
