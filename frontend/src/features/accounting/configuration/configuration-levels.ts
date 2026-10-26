import type {
  AccountingConfigurationLevel,
  AccountingConfigurationLevelInput,
} from '@/api/contracts';

/**
 * The level set of one accounting configuration version — pure derivations.
 *
 * Everything here mirrors the BACKEND contract (never redefines it):
 * `backend/src/modules/accounting/domain/accounting-configuration.ts`
 * (`MAX_ACCOUNTING_CONFIGURATION_DEPTH = 8`,
 * `MAX_ACCOUNTING_CONFIGURATION_CODE_LENGTH = 32`,
 * `MIN_CONFIGURATION_LEVEL_DIGIT_LENGTH = 1`,
 * `MAX_LEVEL_KIND_LENGTH = 20`, ordinals must cover `1..maxDepth` without
 * gaps) and `describeConfigurationPattern()` (`digits joined with ' + '`).
 *
 * The server stays authoritative: these helpers only prevent a request that
 * is ALREADY invalid from being sent. Nothing here is stored, and the
 * `pattern` the list/detail pages display always comes from the API response —
 * `suggestPattern()` is a form PREVIEW with the same rule, never a truth.
 */

/** Mirror of the backend depth cap (levels, not `maxDepth` — this module has none). */
export const MAX_CONFIGURATION_DEPTH = 8;
/** Mirror of the backend account-code width; also the cap of the digit sum. */
export const MAX_ACCOUNT_CODE_LENGTH = 32;
export const MIN_LEVEL_DIGIT_LENGTH = 1;
/** Mirror of `MAX_LEVEL_KIND_LENGTH` (declared column width of `level_kind`). */
export const MAX_LEVEL_KIND_LENGTH = 20;

/**
 * The four kinds the coding structure contract enumerates
 * (`ACCOUNT_LEVEL_KINDS`). The configuration column itself is a free
 * ≤20-character label, so the editor offers these as the vocabulary the rest
 * of the product understands while the field stays optional.
 */
export const CONFIGURATION_LEVEL_KINDS = [
  'group',
  'general',
  'subsidiary',
  'detail',
] as const;
export type ConfigurationLevelKind = (typeof CONFIGURATION_LEVEL_KINDS)[number];

/** One editable level row (form state, not a wire shape). */
export interface ConfigurationLevelDraft {
  levelIndex: number;
  title: string;
  digitLength: number;
  defaultIsPostable: boolean;
  levelKind: string;
}

export type LevelFieldProblem = 'titleRequired' | 'digitsRange' | 'kindTooLong';

export interface LevelProblems {
  title?: LevelFieldProblem;
  digitLength?: LevelFieldProblem;
  levelKind?: LevelFieldProblem;
}

export interface LevelsValidation {
  /** Problems per `levelIndex`; absent = this row is acceptable. */
  rows: Record<number, LevelProblems>;
  /** `levelIndex` is not exactly `1..n` (a gap or duplicate ordinal). */
  continuity: boolean;
  /** The digit lengths add up to more than the account-code width. */
  totalLength: boolean;
  valid: boolean;
}

/** A fresh row for the next ordinal, with the product's common default width. */
export function createLevelDraft(levelIndex: number): ConfigurationLevelDraft {
  return {
    levelIndex,
    title: '',
    digitLength: 2,
    defaultIsPostable: levelIndex > 1,
    levelKind: '',
  };
}

/** Append one row — ordinals stay contiguous because only the tail grows. */
export function appendLevel(
  levels: readonly ConfigurationLevelDraft[],
): ConfigurationLevelDraft[] {
  return [...levels, createLevelDraft(levels.length + 1)];
}

/**
 * Remove the LAST row only. Removing from the middle would leave a gap in
 * `levelIndex`, which the backend refuses; the editor therefore never offers
 * it (the task contract: continuity is preserved by construction).
 */
export function removeLastLevel(
  levels: readonly ConfigurationLevelDraft[],
): ConfigurationLevelDraft[] {
  return levels.length <= 1 ? [...levels] : levels.slice(0, -1);
}

/** Renumber `levelIndex` to `1..n` after any structural edit. */
export function renumberLevels(
  levels: readonly ConfigurationLevelDraft[],
): ConfigurationLevelDraft[] {
  return levels.map((level, index) => ({ ...level, levelIndex: index + 1 }));
}

/** Replace one row immutably (the editor's single write path). */
export function updateLevel(
  levels: readonly ConfigurationLevelDraft[],
  index: number,
  patch: Partial<ConfigurationLevelDraft>,
): ConfigurationLevelDraft[] {
  return levels.map((level, position) =>
    position === index ? { ...level, ...patch } : level,
  );
}

/** Ordered drafts for an edit form, loaded from the API response. */
export function levelsFromConfiguration(
  levels: readonly AccountingConfigurationLevel[] | undefined,
): ConfigurationLevelDraft[] {
  return [...(levels ?? [])]
    .sort((a, b) => a.levelIndex - b.levelIndex)
    .map((level) => ({
      levelIndex: level.levelIndex,
      title: level.title,
      digitLength: level.digitLength,
      defaultIsPostable: level.defaultIsPostable,
      levelKind: level.levelKind ?? '',
    }));
}

/**
 * The exact body the endpoint accepts: trimmed title, `levelKind` as `null`
 * when the operator left it empty (the DTO's nullable field — never `''`).
 */
export function toLevelInputs(
  levels: readonly ConfigurationLevelDraft[],
): AccountingConfigurationLevelInput[] {
  return renumberLevels(levels).map((level) => {
    const kind = level.levelKind.trim();
    return {
      levelIndex: level.levelIndex,
      title: level.title.trim(),
      digitLength: level.digitLength,
      defaultIsPostable: level.defaultIsPostable,
      levelKind: kind === '' ? null : kind,
    };
  });
}

/**
 * Form PREVIEW of the server's `pattern` summary. Same rule as
 * `describeConfigurationPattern()`: ordered digit lengths joined with ' + '.
 * The displayed value on read surfaces is always the API's own `pattern`.
 */
export function suggestPattern(
  levels: readonly { digitLength: number }[],
): string {
  return levels.map((level) => String(level.digitLength)).join(' + ');
}

function isContiguous(levels: readonly ConfigurationLevelDraft[]): boolean {
  return levels.every((level, index) => level.levelIndex === index + 1);
}

/** Client-side mirror of the server's plan validation (submit is still 422-gated). */
export function validateLevels(
  levels: readonly ConfigurationLevelDraft[],
): LevelsValidation {
  const rows: Record<number, LevelProblems> = {};
  let total = 0;

  for (const level of levels) {
    const problems: LevelProblems = {};
    if (level.title.trim() === '') problems.title = 'titleRequired';
    if (
      !Number.isInteger(level.digitLength) ||
      level.digitLength < MIN_LEVEL_DIGIT_LENGTH ||
      level.digitLength > MAX_ACCOUNT_CODE_LENGTH
    ) {
      problems.digitLength = 'digitsRange';
    } else {
      total += level.digitLength;
    }
    if (level.levelKind.trim().length > MAX_LEVEL_KIND_LENGTH) {
      problems.levelKind = 'kindTooLong';
    }
    if (Object.keys(problems).length > 0) rows[level.levelIndex] = problems;
  }

  const continuity = isContiguous(levels);
  const totalLength = total > MAX_ACCOUNT_CODE_LENGTH;
  return {
    rows,
    continuity,
    totalLength,
    valid:
      continuity &&
      !totalLength &&
      Object.keys(rows).length === 0 &&
      levels.length > 0 &&
      levels.length <= MAX_CONFIGURATION_DEPTH,
  };
}
