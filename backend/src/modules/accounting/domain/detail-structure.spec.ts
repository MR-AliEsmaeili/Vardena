import { describe, expect, it } from 'vitest';
import {
  planDetailStructure,
  checkDetailCode,
  detailStructureProblemMessage,
  detailCodeProblemMessage,
  DETAIL_STRUCTURE_VERSION_STATUSES,
} from './detail-structure.js';

describe('DetailStructure domain (Task 30, OD-29-03)', () => {
  it('validates a correct detail structure draft', () => {
    const plan = planDetailStructure({
      maxDepth: 2,
      levels: [
        { levelIndex: 1, title: 'Detail Group', digitLength: 2 },
        { levelIndex: 2, title: 'Detail Item', digitLength: 4 },
      ],
    });
    expect(plan.problem).toBeNull();
  });

  it('rejects level sequence with gaps or non-1 start', () => {
    const plan = planDetailStructure({
      maxDepth: 2,
      levels: [
        { levelIndex: 2, title: 'Detail Item', digitLength: 4 },
        { levelIndex: 3, title: 'Detail Subitem', digitLength: 2 },
      ],
    });
    expect(plan.problem).toBe('level_index_out_of_range');
  });

  it('rejects level with empty title or invalid digit length', () => {
    const plan1 = planDetailStructure({
      maxDepth: 2,
      levels: [
        { levelIndex: 1, title: '', digitLength: 2 },
        { levelIndex: 2, title: 'Detail', digitLength: 4 },
      ],
    });
    expect(plan1.problem).toBe('level_title_invalid');

    const plan2 = planDetailStructure({
      maxDepth: 2,
      levels: [
        { levelIndex: 1, title: 'Group', digitLength: 0 },
        { levelIndex: 2, title: 'Detail', digitLength: 4 },
      ],
    });
    expect(plan2.problem).toBe('digit_length_invalid');
  });

  it('checks detail codes with prefix and length validation', () => {
    const levels = [
      { levelIndex: 1, digitLength: 2 },
      { levelIndex: 2, digitLength: 3 },
    ];

    // Level 1: length 2
    expect(
      checkDetailCode({ code: '10', level: 1, parentCode: null, levels })
        .problem,
    ).toBeNull();
    expect(
      checkDetailCode({ code: '100', level: 1, parentCode: null, levels })
        .problem,
    ).toBe('code_length_mismatch');

    // Level 2: cumulative length 2 + 3 = 5, must start with parent '10'
    expect(
      checkDetailCode({ code: '10001', level: 2, parentCode: '10', levels })
        .problem,
    ).toBeNull();
    expect(
      checkDetailCode({ code: '99001', level: 2, parentCode: '10', levels })
        .problem,
    ).toBe('code_prefix_mismatch');
  });

  it('knows draft, active, and superseded statuses', () => {
    expect(DETAIL_STRUCTURE_VERSION_STATUSES).toEqual([
      'draft',
      'active',
      'superseded',
    ]);
  });

  it('provides friendly problem messages', () => {
    expect(detailStructureProblemMessage('max_depth_invalid')).toContain(
      'maxDepth must be an integer',
    );
    expect(detailCodeProblemMessage('code_non_digit')).toContain(
      'must contain digits only',
    );
  });
});
