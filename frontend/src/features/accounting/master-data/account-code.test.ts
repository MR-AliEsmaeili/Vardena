import { describe, expect, it } from 'vitest';
import type { Account, AccountingConfiguration } from '@/api/contracts';
import {
  checkLocalCodeForm,
  derivedLevel,
  levelDefinition,
  orderedLevels,
  previewFullCode,
} from './account-code';

type Level = AccountingConfiguration['levels'][number];

function level(
  levelIndex: number,
  digitLength: number,
  defaultIsPostable = false,
): Level {
  return {
    id: `lvl-${levelIndex}`,
    levelIndex,
    title: `L${levelIndex}`,
    digitLength,
    defaultIsPostable,
    levelKind: null,
  } as Level;
}

/** The acceptance structure: گروه 1, کل 2, معین 3 — read from config, never hardcoded. */
const LEVELS = [level(1, 1), level(2, 2), level(3, 3, true)];

function account(code: string, lvl: number): Account {
  return { id: `acc-${code}`, code, level: lvl } as Account;
}

describe('previewFullCode (live preview of the backend composition)', () => {
  it('composes the acceptance chain 1 → 101 → 101003 / 101004', () => {
    expect(previewFullCode(null, '1')).toBe('1');
    expect(previewFullCode(account('1', 1), '01')).toBe('101');
    expect(previewFullCode(account('101', 2), '003')).toBe('101003');
    expect(previewFullCode(account('101', 2), '004')).toBe('101004');
  });

  it('updates with the parent and keeps leading zeros significant', () => {
    expect(previewFullCode(account('201', 2), '003')).toBe('201003');
    expect(previewFullCode(account('101', 2), '030')).toBe('101030');
  });

  it('is null while the segment is empty (no half-code presented as final)', () => {
    expect(previewFullCode(account('101', 2), '')).toBeNull();
    expect(previewFullCode(null, '   ')).toBeNull();
  });
});

describe('derivedLevel / levelDefinition', () => {
  it('derives root=1 and child=parent+1', () => {
    expect(derivedLevel(null)).toBe(1);
    expect(derivedLevel(account('101', 2))).toBe(3);
  });

  it('resolves definitions from the configured levels and orders defensively', () => {
    const shuffled = [
      LEVELS[2] as Level,
      LEVELS[0] as Level,
      LEVELS[1] as Level,
    ];
    expect(orderedLevels(shuffled).map((l) => l.levelIndex)).toEqual([1, 2, 3]);
    expect(levelDefinition(LEVELS, 3)?.digitLength).toBe(3);
    expect(levelDefinition(LEVELS, 4)).toBeUndefined();
    expect(orderedLevels(undefined)).toEqual([]);
  });

  it('follows a different configuration (2+4) without any code change', () => {
    const wide = [level(1, 2), level(2, 4, true)];
    expect(previewFullCode(account('02', 1), '0003')).toBe('020003');
    expect(checkLocalCodeForm('0003', levelDefinition(wide, 2))).toBeNull();
    expect(checkLocalCodeForm('003', levelDefinition(wide, 2))).toBe(
      'wrong_length',
    );
  });
});

describe('checkLocalCodeForm (mirrors the backend segment rule)', () => {
  const sub = levelDefinition(LEVELS, 3);

  it('accepts an exact-width digit segment, leading zeros included', () => {
    expect(checkLocalCodeForm('003', sub)).toBeNull();
    expect(checkLocalCodeForm('004', sub)).toBeNull();
  });

  it('refuses empty, non-digit and wrong-width segments distinctly', () => {
    expect(checkLocalCodeForm('', sub)).toBe('required');
    expect(checkLocalCodeForm('0-3', sub)).toBe('not_digits');
    expect(checkLocalCodeForm('۰۰۳', sub)).toBe('not_digits');
    expect(checkLocalCodeForm('03', sub)).toBe('wrong_length');
    expect(checkLocalCodeForm('0003', sub)).toBe('wrong_length');
  });

  it('reports an undefined level instead of guessing a width', () => {
    expect(checkLocalCodeForm('001', undefined)).toBe('level_unknown');
  });
});
