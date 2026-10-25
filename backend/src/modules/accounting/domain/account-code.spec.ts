import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_CODE_PATTERN,
  accountCodeProblemMessage,
  checkAccountCode,
  checkLocalCodeSegment,
  composeAccountCode,
  localCodeProblemMessage,
  localSegmentOfAccountCode,
} from './account-code.js';
import { normalizeCode } from './master-data.js';

/**
 * Canonical account codes (§9.2/§9.3, AC-I-10/AC-I-11).
 *
 * Three things are under test, and each maps to a defect class the contract
 * names: a code that is not digits only (`02-003` and `02003` becoming two
 * accounts), a code whose length does not match the configured segments, and a
 * child code that does not extend its parent. Normalization is asserted too —
 * trim ONLY, because the repository forbids inventing a normalization rule.
 */

const LEVELS = [
  { levelIndex: 1, digitLength: 2 },
  { levelIndex: 2, digitLength: 3 },
  { levelIndex: 3, digitLength: 3 },
];

function check(input: {
  code: string;
  level: number;
  parentCode?: string | null;
  levels?: typeof LEVELS;
}) {
  return checkAccountCode({
    code: input.code,
    level: input.level,
    parentCode: input.parentCode ?? null,
    levels: input.levels ?? LEVELS,
  });
}

describe('the digits-only rule', () => {
  it('accepts plain digit strings of any configured width', () => {
    expect(ACCOUNT_CODE_PATTERN.test('02')).toBe(true);
    expect(ACCOUNT_CODE_PATTERN.test('02003')).toBe(true);
    expect(check({ code: '02', level: 1 }).problem).toBeNull();
  });

  it('rejects separators, letters, spaces and Persian digits', () => {
    for (const code of [
      '2-01-003',
      '02.003',
      '020A3',
      ' 02003',
      '',
      '02003 ',
    ]) {
      expect(check({ code, level: 2 }).problem).toBe('not_digits_only');
    }
    // Persian/Arabic-Indic digits are a rendering concern, never storage.
    expect(check({ code: '۰۲۰۰۳', level: 2 }).problem).toBe('not_digits_only');
  });

  it('explains the rejection without leaking the structure', () => {
    expect(accountCodeProblemMessage('not_digits_only')).toMatch(/digits only/);
    expect(accountCodeProblemMessage('code_too_long')).toMatch(/32/);
  });
});

describe('length against the configured level segments', () => {
  it('requires the cumulative length of the levels the account spans', () => {
    expect(check({ code: '02', level: 1 }).problem).toBeNull();
    expect(check({ code: '02003', level: 2 }).problem).toBeNull();
    expect(check({ code: '02003004', level: 3 }).problem).toBeNull();

    expect(check({ code: '0200', level: 1 }).problem).toBe(
      'level_length_mismatch',
    );
    expect(check({ code: '020', level: 2 }).problem).toBe(
      'level_length_mismatch',
    );
  });

  it('refuses a level the structure does not define', () => {
    const result = check({ code: '0200300400500', level: 4 });
    expect(result.problem).toBe('level_unknown');
    expect(result.field).toBe('parentId');
  });

  it('follows a DIFFERENT configuration without any code change', () => {
    // 1 + 4 + 6: `2` then `20001` then `20001000001` would be valid here.
    const wide = [
      { levelIndex: 1, digitLength: 1 },
      { levelIndex: 2, digitLength: 4 },
      { levelIndex: 3, digitLength: 6 },
    ];
    expect(check({ code: '2', level: 1, levels: wide }).problem).toBeNull();
    expect(
      check({ code: '20001', level: 2, parentCode: '2', levels: wide }).problem,
    ).toBeNull();
    expect(
      check({ code: '020001', level: 2, parentCode: '02', levels: wide })
        .problem,
    ).toBe('level_length_mismatch');
  });

  it('refuses the architecture length cap even when the levels would allow it', () => {
    const huge = [{ levelIndex: 1, digitLength: 33 }];
    expect(
      check({
        code: '1'.repeat(33),
        level: 1,
        levels: huge,
      }).problem,
    ).toBe('code_too_long');
  });
});

describe('the parent-prefix rule (§9.3)', () => {
  it('requires the parent code extended by exactly this level segment', () => {
    expect(
      check({ code: '02003', level: 2, parentCode: '02' }).problem,
    ).toBeNull();
    expect(
      check({ code: '02003004', level: 3, parentCode: '02003' }).problem,
    ).toBeNull();
  });

  it('rejects a sibling that is not a prefix', () => {
    expect(
      check({ code: '02004', level: 2, parentCode: '02003' }).problem,
    ).toBe('parent_prefix_mismatch');
  });

  it('rejects a prefix that is right but the wrong width', () => {
    expect(check({ code: '0203', level: 2, parentCode: '02' }).problem).toBe(
      'level_length_mismatch',
    );
    expect(
      check({ code: '02300004', level: 3, parentCode: '02300' }).problem,
    ).toBeNull();
    expect(
      check({ code: '02003004', level: 2, parentCode: '02' }).problem,
    ).toBe('level_length_mismatch');
  });

  it('rejects a longer-than-segment extension (a skipped level in disguise)', () => {
    expect(
      check({ code: '02000300', level: 2, parentCode: '02' }).problem,
    ).toBe('level_length_mismatch');
  });
});

describe('normalization is trim ONLY (master-data convention)', () => {
  it('trims surrounding whitespace and changes nothing else', () => {
    expect(normalizeCode('  02003  ')).toBe('02003');
    // No stripping of separators, no re-padding, no case folding.
    expect(normalizeCode(' 02-003 ')).toBe('02-003');
    expect(normalizeCode('0002003')).toBe('0002003');
  });

  it('still rejects a code that only becomes valid after rewriting', () => {
    // `02-003` trimmed is `02-003`, which is not digits: the request fails
    // rather than being silently rewritten into `02003`.
    const trimmed = normalizeCode(' 02-003 ');
    expect(check({ code: trimmed, level: 2, parentCode: '02' }).problem).toBe(
      'not_digits_only',
    );
  });
});

describe('local code segments (operator input ⇄ stored full code)', () => {
  // The acceptance structure: گروه 1 digit, کل 2 digits, معین 3 digits.
  const IR_LEVELS = [
    { levelIndex: 1, digitLength: 1 },
    { levelIndex: 2, digitLength: 2 },
    { levelIndex: 3, digitLength: 3 },
  ];

  it('composes the acceptance codes: 1, then 101, then 101003 / 101004', () => {
    const group = composeAccountCode({ parentCode: null, localCode: '1' });
    const general = composeAccountCode({ parentCode: group, localCode: '01' });
    const subA = composeAccountCode({ parentCode: general, localCode: '003' });
    const subB = composeAccountCode({ parentCode: general, localCode: '004' });
    expect(group).toBe('1');
    expect(general).toBe('101');
    expect(subA).toBe('101003');
    expect(subB).toBe('101004');
    expect(
      checkAccountCode({
        code: subA,
        level: 3,
        parentCode: general,
        levels: IR_LEVELS,
      }).problem,
    ).toBeNull();
    expect(
      checkAccountCode({
        code: subB,
        level: 3,
        parentCode: general,
        levels: IR_LEVELS,
      }).problem,
    ).toBeNull();
  });

  it('keeps leading zeros significant: 003 and 004 and 030 are distinct segments', () => {
    expect(
      checkLocalCodeSegment({ localCode: '003', level: 3, levels: IR_LEVELS }),
    ).toBeNull();
    expect(composeAccountCode({ parentCode: '101', localCode: '030' })).toBe(
      '101030',
    );
  });

  it('refuses a segment of the wrong width for its level (no silent padding)', () => {
    expect(
      checkLocalCodeSegment({ localCode: '03', level: 3, levels: IR_LEVELS }),
    ).toBe('local_code_length_mismatch');
    expect(
      checkLocalCodeSegment({ localCode: '0003', level: 3, levels: IR_LEVELS }),
    ).toBe('local_code_length_mismatch');
    expect(
      checkLocalCodeSegment({ localCode: '1', level: 2, levels: IR_LEVELS }),
    ).toBe('local_code_length_mismatch');
    expect(localCodeProblemMessage('local_code_length_mismatch')).toMatch(
      /exactly as many digits/,
    );
  });

  it('refuses non-digit segments and unknown levels', () => {
    expect(
      checkLocalCodeSegment({ localCode: '0-3', level: 3, levels: IR_LEVELS }),
    ).toBe('local_code_not_digits');
    expect(
      checkLocalCodeSegment({ localCode: '۰۰۳', level: 3, levels: IR_LEVELS }),
    ).toBe('local_code_not_digits');
    expect(
      checkLocalCodeSegment({ localCode: '', level: 3, levels: IR_LEVELS }),
    ).toBe('local_code_not_digits');
    expect(
      checkLocalCodeSegment({ localCode: '001', level: 4, levels: IR_LEVELS }),
    ).toBe('level_unknown');
  });

  it('follows a different configured structure without any code change', () => {
    const wide = [
      { levelIndex: 1, digitLength: 2 },
      { levelIndex: 2, digitLength: 4 },
    ];
    expect(
      checkLocalCodeSegment({ localCode: '02', level: 1, levels: wide }),
    ).toBeNull();
    expect(
      checkLocalCodeSegment({ localCode: '0003', level: 2, levels: wide }),
    ).toBeNull();
    expect(composeAccountCode({ parentCode: '02', localCode: '0003' })).toBe(
      '020003',
    );
  });

  it('recovers the local segment from a stored full code via the parent code', () => {
    expect(
      localSegmentOfAccountCode({ code: '101003', parentCode: '101' }),
    ).toBe('003');
    expect(localSegmentOfAccountCode({ code: '101', parentCode: '1' })).toBe(
      '01',
    );
    expect(localSegmentOfAccountCode({ code: '1', parentCode: null })).toBe(
      '1',
    );
  });

  it('is read-total: a legacy code that does not extend its parent presents its full code', () => {
    // Reads are never blocked by divergent legacy rows (ODR-1 posture); the
    // row stays a §9.3 data bug for write validation/reconciliation, but no
    // segment boundary is invented for it here.
    expect(
      localSegmentOfAccountCode({ code: '201003', parentCode: '101' }),
    ).toBe('201003');
    expect(localSegmentOfAccountCode({ code: '101', parentCode: '101' })).toBe(
      '101',
    );
    expect(localSegmentOfAccountCode({ code: '20', parentCode: '10' })).toBe(
      '20',
    );
  });
});
