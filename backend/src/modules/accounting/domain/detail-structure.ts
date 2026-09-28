/**
 * Detail Structure — the organization's configurable detail coding structure
 * (Task 30 — OD-29-03).
 *
 * An organization can define Detail hierarchy levels with configurable:
 * - level count (depth, 1..MAX_DETAIL_STRUCTURE_DEPTH)
 * - level names/titles
 * - digit/code lengths per level
 * - parent/child relationships
 *
 * Versioned lifecycle: `draft → active → superseded` with exactly ONE active
 * version per organization.
 *
 * Framework-free (AR-05): pure rules, unit-tested.
 */

export const MAX_DETAIL_STRUCTURE_DEPTH = 8;
export const MIN_DETAIL_LEVEL_DIGIT_LENGTH = 1;
export const MAX_DETAIL_CODE_LENGTH = 32;
export const MAX_DETAIL_TITLE_LENGTH = 200;

export const DETAIL_STRUCTURE_VERSION_STATUSES = [
  'draft',
  'active',
  'superseded',
] as const;

export const DETAIL_STRUCTURE_STATUSES = DETAIL_STRUCTURE_VERSION_STATUSES;

export type DetailStructureVersionStatus =
  (typeof DETAIL_STRUCTURE_VERSION_STATUSES)[number];

export function isDetailStructureVersionStatus(
  value: string,
): value is DetailStructureVersionStatus {
  return (DETAIL_STRUCTURE_VERSION_STATUSES as readonly string[]).includes(
    value,
  );
}

export const isDetailStructureStatus = isDetailStructureVersionStatus;

export interface DetailStructureLevel {
  id: string;
  organizationId: string;
  versionId: string;
  levelIndex: number;
  title: string;
  digitLength: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DetailStructureLevelDto {
  id: string;
  levelIndex: number;
  title: string;
  digitLength: number;
}

export interface DetailStructureVersion {
  id: string;
  organizationId: string;
  versionNumber: number;
  status: DetailStructureVersionStatus;
  title: string | null;
  maxDepth: number;
  levels: DetailStructureLevel[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DetailStructureVersionDto {
  id: string;
  organizationId: string;
  versionNumber: number;
  status: DetailStructureVersionStatus;
  title: string | null;
  maxDepth: number;
  pattern: string;
  levels: DetailStructureLevelDto[];
  createdAt: string;
  updatedAt: string;
}

export function toDetailStructureLevelDto(
  level: DetailStructureLevel,
): DetailStructureLevelDto {
  return {
    id: level.id,
    levelIndex: level.levelIndex,
    title: level.title,
    digitLength: level.digitLength,
  };
}

export function toDetailStructureVersionDto(
  version: DetailStructureVersion,
): DetailStructureVersionDto {
  const levels = (version.levels ?? [])
    .map(toDetailStructureLevelDto)
    .sort((a, b) => a.levelIndex - b.levelIndex);
  const pattern = levels.map((l) => l.digitLength).join(' + ');
  return {
    id: version.id,
    organizationId: version.organizationId,
    versionNumber: version.versionNumber,
    status: version.status,
    title: version.title ?? null,
    maxDepth: version.maxDepth,
    pattern: pattern || '0',
    levels,
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
  };
}

export interface DetailStructureLevelInput {
  levelIndex: number;
  title: string;
  digitLength: number;
}

export type DetailStructureProblem =
  | 'max_depth_invalid'
  | 'levels_missing'
  | 'levels_exceed_depth'
  | 'level_index_out_of_range'
  | 'level_index_duplicate'
  | 'level_index_gap'
  | 'digit_length_invalid'
  | 'code_length_too_large'
  | 'level_title_invalid'
  | 'separator_invalid';

export interface DetailStructurePlan {
  problem: DetailStructureProblem | null;
}

export function planDetailStructure(input: {
  maxDepth: number;
  levels: readonly DetailStructureLevelInput[];
  separator?: string | undefined;
}): DetailStructurePlan {
  if (
    !Number.isInteger(input.maxDepth) ||
    input.maxDepth < 1 ||
    input.maxDepth > MAX_DETAIL_STRUCTURE_DEPTH
  ) {
    return { problem: 'max_depth_invalid' };
  }
  if (input.levels.length === 0) {
    return { problem: 'levels_missing' };
  }
  if (input.levels.length > input.maxDepth) {
    return { problem: 'levels_exceed_depth' };
  }
  if (input.levels.length < input.maxDepth) {
    return { problem: 'levels_missing' };
  }
  if (
    input.separator !== undefined &&
    input.separator !== '' &&
    !['- ', '-', '/', '.', ' '].includes(input.separator) &&
    input.separator.length > 1
  ) {
    return { problem: 'separator_invalid' };
  }

  const seenIndices = new Set<number>();
  let totalDigitLength = 0;
  for (const level of input.levels) {
    if (
      !Number.isInteger(level.levelIndex) ||
      level.levelIndex < 1 ||
      level.levelIndex > input.maxDepth
    ) {
      return { problem: 'level_index_out_of_range' };
    }
    if (seenIndices.has(level.levelIndex)) {
      return { problem: 'level_index_duplicate' };
    }
    seenIndices.add(level.levelIndex);

    if (
      !Number.isInteger(level.digitLength) ||
      level.digitLength < MIN_DETAIL_LEVEL_DIGIT_LENGTH
    ) {
      return { problem: 'digit_length_invalid' };
    }
    if (
      typeof level.title !== 'string' ||
      level.title.trim().length === 0 ||
      level.title.length > MAX_DETAIL_TITLE_LENGTH
    ) {
      return { problem: 'level_title_invalid' };
    }
    totalDigitLength += level.digitLength;
  }

  for (let i = 1; i <= input.maxDepth; i++) {
    if (!seenIndices.has(i)) {
      return { problem: 'level_index_gap' };
    }
  }

  if (totalDigitLength > MAX_DETAIL_CODE_LENGTH) {
    return { problem: 'code_length_too_large' };
  }

  return { problem: null };
}

export function detailStructureProblemMessage(
  problem: DetailStructureProblem,
): string {
  switch (problem) {
    case 'max_depth_invalid':
      return `maxDepth must be an integer between 1 and ${MAX_DETAIL_STRUCTURE_DEPTH}.`;
    case 'levels_missing':
      return 'Detail structure requires one level definition per level (maxDepth rows).';
    case 'levels_exceed_depth':
      return 'The level list is longer than maxDepth.';
    case 'level_index_out_of_range':
      return 'Every levelIndex must be an integer between 1 and maxDepth.';
    case 'level_index_duplicate':
      return 'Two levels claim the same levelIndex; ordinals are 1..maxDepth with no duplicates.';
    case 'level_index_gap':
      return 'The level ordinals must cover 1..maxDepth with no gap.';
    case 'digit_length_invalid':
      return `Every level must contribute at least ${MIN_DETAIL_LEVEL_DIGIT_LENGTH} digit(s).`;
    case 'code_length_too_large':
      return `The configured levels add up to more than the maximum detail code length (${MAX_DETAIL_CODE_LENGTH} characters).`;
    case 'level_title_invalid':
      return `Level title must be non-empty and at most ${MAX_DETAIL_TITLE_LENGTH} characters.`;
    case 'separator_invalid':
      return 'Separator must be empty or at most 1 character.';
  }
}

// ---------------------------------------------------------------------------
// Detail code checking
// ---------------------------------------------------------------------------

export type DetailCodeProblem =
  | 'code_empty'
  | 'code_non_digit'
  | 'code_length_mismatch'
  | 'code_prefix_mismatch';

export interface DetailCodeCheck {
  problem: DetailCodeProblem | null;
  expectedLength?: number;
}

export function checkDetailCode(input: {
  code: string;
  level: number;
  parentCode: string | null;
  levels: readonly { levelIndex: number; digitLength: number }[];
}): DetailCodeCheck {
  if (!input.code || input.code.trim().length === 0) {
    return { problem: 'code_empty' };
  }
  if (!/^\d+$/.test(input.code)) {
    return { problem: 'code_non_digit' };
  }

  // Calculate cumulative expected length up to this level
  const levelsSorted = [...input.levels].sort(
    (a, b) => a.levelIndex - b.levelIndex,
  );
  let cumulative = 0;
  for (const l of levelsSorted) {
    if (l.levelIndex <= input.level) {
      cumulative += l.digitLength;
    }
  }

  if (input.code.length !== cumulative) {
    return {
      problem: 'code_length_mismatch',
      expectedLength: cumulative,
    };
  }

  if (input.parentCode !== null && input.parentCode !== '') {
    if (!input.code.startsWith(input.parentCode)) {
      return { problem: 'code_prefix_mismatch' };
    }
  }

  return { problem: null };
}

export function detailCodeProblemMessage(problem: DetailCodeProblem): string {
  switch (problem) {
    case 'code_empty':
      return 'Detail code cannot be empty.';
    case 'code_non_digit':
      return 'Detail code must contain digits only.';
    case 'code_length_mismatch':
      return 'Detail code length does not match the configured level digit length.';
    case 'code_prefix_mismatch':
      return 'Detail child code must extend its parent code prefix.';
  }
}
