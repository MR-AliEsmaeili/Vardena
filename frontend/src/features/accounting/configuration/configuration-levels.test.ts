import { describe, expect, it } from 'vitest';
import type { AccountingConfigurationLevel } from '@/api/contracts';
import {
  MAX_ACCOUNT_CODE_LENGTH,
  MAX_CONFIGURATION_DEPTH,
  appendLevel,
  createLevelDraft,
  levelsFromConfiguration,
  removeLastLevel,
  renumberLevels,
  suggestPattern,
  toLevelInputs,
  updateLevel,
  validateLevels,
  type ConfigurationLevelDraft,
} from './configuration-levels';

function level(
  levelIndex: number,
  patch: Partial<ConfigurationLevelDraft> = {},
): ConfigurationLevelDraft {
  return {
    levelIndex,
    title: `سطح ${levelIndex}`,
    digitLength: 2,
    defaultIsPostable: false,
    levelKind: '',
    ...patch,
  };
}

describe('configuration level set (pure)', () => {
  it('keeps ordinals contiguous when rows are added or removed from the tail', () => {
    let levels = [createLevelDraft(1)];
    expect(levels[0]?.levelIndex).toBe(1);

    levels = appendLevel(levels);
    levels = appendLevel(levels);
    expect(levels.map((item) => item.levelIndex)).toEqual([1, 2, 3]);

    levels = removeLastLevel(levels);
    expect(levels.map((item) => item.levelIndex)).toEqual([1, 2]);

    // The last remaining row is never removable: a version needs at least one.
    expect(removeLastLevel(removeLastLevel(levels))).toHaveLength(1);
    expect(removeLastLevel([createLevelDraft(1)])).toHaveLength(1);
  });

  it('renumbers after any structural edit and patches a single row immutably', () => {
    const levels = [level(1), level(3), level(7)];
    expect(renumberLevels(levels).map((item) => item.levelIndex)).toEqual([
      1, 2, 3,
    ]);

    const patched = updateLevel(levels, 1, { title: 'تازه' });
    expect(patched[1]?.title).toBe('تازه');
    expect(levels[1]?.title).toBe('سطح 3');
  });

  it('mirrors the server pattern rule (digits joined with " + ")', () => {
    expect(
      suggestPattern([
        { digitLength: 2 },
        { digitLength: 2 },
        { digitLength: 4 },
      ]),
    ).toBe('2 + 2 + 4');
  });

  it('builds the exact request body: trimmed titles, empty kind becomes null', () => {
    const inputs = toLevelInputs([
      level(1, { title: '  گروه  ', levelKind: 'group' }),
      level(2, { levelKind: '   ' }),
    ]);

    expect(inputs).toEqual([
      {
        levelIndex: 1,
        title: 'گروه',
        digitLength: 2,
        defaultIsPostable: false,
        levelKind: 'group',
      },
      {
        levelIndex: 2,
        title: 'سطح 2',
        digitLength: 2,
        defaultIsPostable: false,
        levelKind: null,
      },
    ]);
  });

  it('orders stored levels by their ordinal for the edit form', () => {
    const stored: AccountingConfigurationLevel[] = [
      {
        id: 'l2',
        levelIndex: 2,
        title: 'کل',
        digitLength: 2,
        defaultIsPostable: false,
        levelKind: null,
      },
      {
        id: 'l1',
        levelIndex: 1,
        title: 'گروه',
        digitLength: 2,
        defaultIsPostable: false,
        levelKind: 'group',
      },
    ];

    expect(
      levelsFromConfiguration(stored).map((item) => item.levelIndex),
    ).toEqual([1, 2]);
    expect(levelsFromConfiguration(undefined)).toEqual([]);
  });

  it('rejects empty titles, out-of-range digit lengths and gaps in the ordinals', () => {
    const emptyTitle = validateLevels([level(1, { title: '   ' })]);
    expect(emptyTitle.rows[1]?.title).toBe('titleRequired');
    expect(emptyTitle.valid).toBe(false);

    for (const digitLength of [0, -1, 1.5, MAX_ACCOUNT_CODE_LENGTH + 1]) {
      const invalid = validateLevels([level(1, { digitLength })]);
      expect(invalid.rows[1]?.digitLength).toBe('digitsRange');
      expect(invalid.valid).toBe(false);
    }

    const gapped = validateLevels([level(1), level(3)]);
    expect(gapped.continuity).toBe(false);
    expect(gapped.valid).toBe(false);
  });

  it('rejects a digit sum wider than the account-code column and too many levels', () => {
    const wide = validateLevels([
      level(1, { digitLength: 20 }),
      level(2, { digitLength: 20 }),
    ]);
    expect(wide.totalLength).toBe(true);
    expect(wide.valid).toBe(false);

    const tooDeep = validateLevels(
      Array.from({ length: MAX_CONFIGURATION_DEPTH + 1 }, (_unused, index) =>
        level(index + 1, { digitLength: 1 }),
      ),
    );
    expect(tooDeep.valid).toBe(false);
  });

  it('accepts a continuous, in-bounds level set', () => {
    const result = validateLevels([
      level(1, { levelKind: 'group' }),
      level(2, { digitLength: 4, defaultIsPostable: true }),
    ]);
    expect(result).toEqual({
      rows: {},
      continuity: true,
      totalLength: false,
      valid: true,
    });
  });
});
