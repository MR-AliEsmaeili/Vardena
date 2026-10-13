import { describe, expect, it } from 'vitest';
import type { CodingStructureLevelInput } from './coding-structure.js';
import {
  codeLengthForLevel,
  describePattern,
  isAccountLevelKind,
  isCodingStructureSeparator,
  isCodingStructureStatus,
  isVersionConfigurable,
  isVersionActive,
  MAX_ACCOUNT_CODE_LENGTH,
  MAX_CODING_STRUCTURE_DEPTH,
  orderedLevels,
  planCodingStructure,
  segmentLengthForLevel,
} from './coding-structure.js';

/**
 * Coding-structure shape rules (§9.1/§9.4, AC-D-10).
 *
 * The suite's central assertion is the NEGATIVE one the task exists to
 * protect: nothing here is `2 + 3 + 3`. Any depth 1..8 and any per-level digit
 * length that fits the architecture cap is a valid configuration, and the
 * caps themselves are the only constants.
 */

function level(
  levelIndex: number,
  digitLength: number,
  overrides: Partial<CodingStructureLevelInput> = {},
): CodingStructureLevelInput {
  return {
    levelIndex,
    title: `Level ${levelIndex}`,
    digitLength,
    defaultIsPostable: false,
    levelKind: null,
    ...overrides,
  };
}

function plan(input: {
  code?: string;
  maxDepth?: number;
  separator?: string;
  levels?: readonly CodingStructureLevelInput[];
}) {
  return planCodingStructure({
    code: input.code ?? 'DEFAULT',
    maxDepth: input.maxDepth ?? 3,
    separator: input.separator ?? '',
    levels: input.levels ?? [level(1, 2), level(2, 3), level(3, 3)],
  });
}

describe('planCodingStructure — valid configurations', () => {
  it('accepts the illustrative 2 + 3 + 3 layout', () => {
    expect(plan({})).toEqual({ problem: null });
  });

  it('accepts a 1 + 1 layout (nothing is tied to three levels)', () => {
    expect(plan({ maxDepth: 2, levels: [level(1, 1), level(2, 1)] })).toEqual({
      problem: null,
    });
  });

  it('accepts a single-level structure (maxDepth 1)', () => {
    expect(plan({ maxDepth: 1, levels: [level(1, 8)] })).toEqual({
      problem: null,
    });
  });

  it('accepts the deepest configuration the cap allows (8 × 4 digits)', () => {
    const levels = Array.from({ length: MAX_CODING_STRUCTURE_DEPTH }, (_, i) =>
      level(i + 1, 4),
    );
    expect(plan({ maxDepth: MAX_CODING_STRUCTURE_DEPTH, levels })).toEqual({
      problem: null,
    });
  });

  it('accepts a level kind on any level, and repeated kinds', () => {
    expect(
      plan({
        maxDepth: 2,
        levels: [
          level(1, 2, { levelKind: 'detail' }),
          level(2, 2, { levelKind: 'detail' }),
        ],
      }),
    ).toEqual({ problem: null });
  });

  it('refuses a configuration whose total length exceeds the cap by one', () => {
    const perLevel = Math.floor(MAX_ACCOUNT_CODE_LENGTH / 4) + 1;
    expect(
      plan({
        maxDepth: 4,
        levels: [1, 2, 3, 4].map((index) => level(index, perLevel)),
      }),
    ).toEqual({ problem: 'code_length_too_large' });
  });
});

describe('planCodingStructure — invalid configurations', () => {
  it('refuses a blank or over-long structure code', () => {
    expect(plan({ code: '   ' }).problem).toBe('code_invalid');
    expect(plan({ code: 'x'.repeat(65) }).problem).toBe('code_invalid');
  });

  it('refuses depth outside the architecture cap (0, 9)', () => {
    expect(plan({ maxDepth: 0, levels: [] }).problem).toBe('max_depth_invalid');
    expect(
      plan({
        maxDepth: MAX_CODING_STRUCTURE_DEPTH + 1,
        levels: Array.from({ length: MAX_CODING_STRUCTURE_DEPTH + 1 }, (_, i) =>
          level(i + 1, 1),
        ),
      }).problem,
    ).toBe('max_depth_invalid');
  });

  it('refuses a non-display separator', () => {
    expect(plan({ separator: '_' }).problem).toBe('separator_invalid');
    expect(plan({ separator: '-' }).problem).toBe(null);
  });

  it('refuses an empty level set', () => {
    expect(plan({ levels: [] }).problem).toBe('levels_missing');
  });

  it('refuses more level rows than the depth', () => {
    expect(
      plan({ maxDepth: 2, levels: [level(1, 2), level(2, 2), level(3, 2)] })
        .problem,
    ).toBe('levels_exceed_depth');
  });

  it('refuses an ordinal outside 1..maxDepth', () => {
    const result = plan({
      maxDepth: 2,
      levels: [level(1, 2), level(4, 2)],
    });
    expect(result.problem).toBe('level_index_out_of_range');
    expect(result.subject).toBe('4');
  });

  it('refuses two rows claiming the same ordinal', () => {
    const result = plan({
      maxDepth: 3,
      levels: [level(1, 2), level(2, 3), level(2, 3)],
    });
    expect(result.problem).toBe('level_index_duplicate');
    expect(result.subject).toBe('2');
  });

  it('refuses a gap in the ordinals (a level with no digit rule)', () => {
    const result = plan({
      maxDepth: 3,
      levels: [level(1, 2), level(3, 3)],
    });
    expect(result.problem).toBe('level_index_gap');
    expect(result.subject).toBe('2');
  });

  it('refuses a zero or negative segment width', () => {
    expect(plan({ maxDepth: 1, levels: [level(1, 0)] }).problem).toBe(
      'digit_length_invalid',
    );
    expect(plan({ maxDepth: 1, levels: [level(1, -3)] }).problem).toBe(
      'digit_length_invalid',
    );
  });

  it('refuses a blank level title', () => {
    expect(
      plan({ maxDepth: 1, levels: [level(1, 2, { title: '  ' })] }).problem,
    ).toBe('level_title_invalid');
  });

  it('refuses a level kind outside the closed list', () => {
    expect(
      plan({
        maxDepth: 1,
        levels: [level(1, 2, { levelKind: 'control-account' })],
      }).problem,
    ).toBe('level_kind_invalid');
  });
});

describe('level arithmetic (the input of every code rule)', () => {
  const levels = [level(1, 2), level(2, 3), level(3, 3)];

  it('computes the cumulative code length per level', () => {
    expect(codeLengthForLevel(levels, 1)).toBe(2);
    expect(codeLengthForLevel(levels, 2)).toBe(5);
    expect(codeLengthForLevel(levels, 3)).toBe(8);
    expect(codeLengthForLevel(levels, 4)).toBeNull();
  });

  it('computes the segment width of one level', () => {
    expect(segmentLengthForLevel(levels, 2)).toBe(3);
    expect(segmentLengthForLevel(levels, 9)).toBeNull();
  });

  it('is independent of the order the rows arrive in', () => {
    const shuffled = [level(3, 3), level(1, 2), level(2, 3)];
    expect(codeLengthForLevel(shuffled, 2)).toBe(5);
    expect(orderedLevels(shuffled).map((entry) => entry.levelIndex)).toEqual([
      1, 2, 3,
    ]);
  });

  it('renders the derived pattern without storing it anywhere', () => {
    expect(describePattern(levels)).toBe('2 + 3 + 3');
    expect(describePattern([level(1, 4), level(2, 1)])).toBe('4 + 1');
  });
});

describe('closed lists and lifecycle predicates', () => {
  it('accepts exactly draft, active and superseded', () => {
    expect(isCodingStructureStatus('draft')).toBe(true);
    expect(isCodingStructureStatus('active')).toBe(true);
    expect(isCodingStructureStatus('superseded')).toBe(true);
    // No `initial`, no `retired`, no `current` — the ADR-0024 vocabulary only.
    expect(isCodingStructureStatus('current')).toBe(false);
  });

  it('allows configuration only in a draft', () => {
    expect(isVersionConfigurable('draft')).toBe(true);
    expect(isVersionConfigurable('active')).toBe(false);
    expect(isVersionConfigurable('superseded')).toBe(false);
  });

  it('selects only the active version for new placements', () => {
    expect(isVersionActive('active')).toBe(true);
    expect(isVersionActive('draft')).toBe(false);
    expect(isVersionActive('superseded')).toBe(false);
  });

  it('keeps the display-separator and level-kind lists closed', () => {
    expect(isCodingStructureSeparator('/')).toBe(true);
    expect(isCodingStructureSeparator('')).toBe(true);
    expect(isCodingStructureSeparator('.')).toBe(true);
    expect(isCodingStructureSeparator('--')).toBe(false);
    expect(isAccountLevelKind('subsidiary')).toBe(true);
    expect(isAccountLevelKind('SUBSIDIARY')).toBe(false);
    expect(isAccountLevelKind('')).toBe(false);
  });
});
