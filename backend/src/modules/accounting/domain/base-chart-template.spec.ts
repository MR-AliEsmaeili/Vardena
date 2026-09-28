import { describe, expect, it } from 'vitest';
import {
  baseChartContentProblemMessage,
  planBaseChartVersionContent,
  planBaseChartVersionTransition,
  isVersionAdoptable,
  isVersionContentEditable,
  BASE_CHART_VERSION_STATUSES,
  type BaseChartLevelInput,
  type BaseChartNodeInput,
  type BaseChartVersionStatus,
  type BaseChartVersionTransition,
} from './base-chart-template.js';

/**
 * Task 23 — Base Chart template lifecycle + content rules (OD-20-1, Task 21
 * §7/§8). The transition table is the ONLY lifecycle authority (one-way,
 * draft the only mutable state, published the only adoptable state), and
 * `planBaseChartVersionContent` is the ONLY shape authority — it runs at
 * authoring, at the publish gate and inside the write transactions.
 */

const LEVELS: BaseChartLevelInput[] = [
  { levelIndex: 1, digitLength: 2, defaultIsPostable: false },
  { levelIndex: 2, digitLength: 3, defaultIsPostable: true },
];

function node(partial: Partial<BaseChartNodeInput>): BaseChartNodeInput {
  return {
    nodeKey: 'N1',
    parentNodeKey: null,
    code: '10',
    title: 'Node',
    accountNature: 'DEBIT',
    isMandatory: false,
    defaultIsActive: true,
    ...partial,
  };
}

describe('Base Chart template lifecycle (Task 21 §8)', () => {
  it('declares the closed status list in lifecycle order', () => {
    expect(BASE_CHART_VERSION_STATUSES).toEqual([
      'draft',
      'approved',
      'published',
      'superseded',
    ]);
  });

  const LEGAL: Array<
    [BaseChartVersionStatus, BaseChartVersionTransition, BaseChartVersionStatus]
  > = [
    ['draft', 'approve', 'approved'],
    ['approved', 'publish', 'published'],
    ['published', 'supersede', 'superseded'],
  ];
  it.each(LEGAL)('allows %s --%s--> %s', (from, transition, to) => {
    expect(planBaseChartVersionTransition(from, transition)).toBe(to);
  });

  it('rejects every illegal edge explicitly (one-way lifecycle)', () => {
    // Status × transition matrix beyond the three legal edges.
    const statuses = BASE_CHART_VERSION_STATUSES;
    const transitions: BaseChartVersionTransition[] = [
      'approve',
      'publish',
      'supersede',
    ];
    const legal = new Set(LEGAL.map(([f, t]) => `${f}:${t}`));
    for (const status of statuses) {
      for (const transition of transitions) {
        if (legal.has(`${status}:${transition}`)) continue;
        expect(
          planBaseChartVersionTransition(status, transition),
          `${status} --${transition}--> must be refused`,
        ).toBeNull();
      }
    }
  });

  it('makes draft the ONLY mutable state', () => {
    expect(isVersionContentEditable('draft')).toBe(true);
    expect(isVersionContentEditable('approved')).toBe(false);
    expect(isVersionContentEditable('published')).toBe(false);
    expect(isVersionContentEditable('superseded')).toBe(false);
  });

  it('makes published the ONLY adoptable state', () => {
    expect(isVersionAdoptable('draft')).toBe(false);
    expect(isVersionAdoptable('approved')).toBe(false);
    expect(isVersionAdoptable('published')).toBe(true);
    expect(isVersionAdoptable('superseded')).toBe(false);
  });
});

describe('planBaseChartVersionContent — level shape', () => {
  const oneNode = [node({})];

  it('accepts a minimal valid shape and derives the node set', () => {
    const result = planBaseChartVersionContent({
      maxDepth: 1,
      levels: [{ levelIndex: 1, digitLength: 2, defaultIsPostable: false }],
      nodes: oneNode,
    });
    expect(result.plan.problem).toBeNull();
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.level).toBe(1);
  });

  it('accepts a deep configurable shape (8 levels — never a 4-level hardcode)', () => {
    const levels: BaseChartLevelInput[] = [
      { levelIndex: 1, digitLength: 1, defaultIsPostable: false },
      { levelIndex: 2, digitLength: 1, defaultIsPostable: false },
      { levelIndex: 3, digitLength: 1, defaultIsPostable: false },
      { levelIndex: 4, digitLength: 1, defaultIsPostable: false },
      { levelIndex: 5, digitLength: 1, defaultIsPostable: false },
      { levelIndex: 6, digitLength: 1, defaultIsPostable: false },
      { levelIndex: 7, digitLength: 1, defaultIsPostable: false },
      { levelIndex: 8, digitLength: 1, defaultIsPostable: true },
    ];
    const nodes: BaseChartNodeInput[] = [];
    let parent: string | null = null;
    let code = '';
    for (let index = 1; index <= 8; index += 1) {
      code = `${code}1`;
      nodes.push(
        node({
          nodeKey: `N${index}`,
          parentNodeKey: parent,
          code,
          isPostable: false,
        }),
      );
      parent = `N${index}`;
    }
    const result = planBaseChartVersionContent({ maxDepth: 8, levels, nodes });
    expect(result.plan.problem).toBeNull();
    expect(result.nodes.map((n) => n.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('refuses maxDepth outside 1..8', () => {
    expect(
      planBaseChartVersionContent({
        maxDepth: 0,
        levels: LEVELS,
        nodes: oneNode,
      }).plan.problem,
    ).toBe('max_depth_invalid');
    expect(
      planBaseChartVersionContent({
        maxDepth: 9,
        levels: LEVELS,
        nodes: oneNode,
      }).plan.problem,
    ).toBe('max_depth_invalid');
  });

  it('refuses an empty level list and an over-long one', () => {
    expect(
      planBaseChartVersionContent({ maxDepth: 2, levels: [], nodes: oneNode })
        .plan.problem,
    ).toBe('levels_missing');
    expect(
      planBaseChartVersionContent({
        maxDepth: 1,
        levels: LEVELS,
        nodes: oneNode,
      }).plan.problem,
    ).toBe('levels_exceed_depth');
  });

  it('refuses ordinals out of range, duplicated, gapped and zero digits', () => {
    const base = { maxDepth: 2, nodes: oneNode };
    expect(
      planBaseChartVersionContent({
        ...base,
        levels: [
          { levelIndex: 0, digitLength: 2, defaultIsPostable: false },
          { levelIndex: 2, digitLength: 3, defaultIsPostable: true },
        ],
      }).plan,
    ).toMatchObject({ problem: 'level_index_out_of_range', subject: '0' });
    expect(
      planBaseChartVersionContent({
        ...base,
        levels: [
          { levelIndex: 1, digitLength: 2, defaultIsPostable: false },
          { levelIndex: 1, digitLength: 3, defaultIsPostable: true },
        ],
      }).plan,
    ).toMatchObject({ problem: 'level_index_duplicate', subject: '1' });
    expect(
      planBaseChartVersionContent({
        ...base,
        levels: [
          { levelIndex: 1, digitLength: 2, defaultIsPostable: false },
          { levelIndex: 3, digitLength: 3, defaultIsPostable: true },
        ],
      }).plan.problem,
    ).toBe('level_index_out_of_range');
    expect(
      planBaseChartVersionContent({
        maxDepth: 2,
        nodes: oneNode,
        levels: [{ levelIndex: 2, digitLength: 3, defaultIsPostable: true }],
      }).plan,
    ).toMatchObject({ problem: 'level_index_gap', subject: '1' });
    expect(
      planBaseChartVersionContent({
        maxDepth: 1,
        nodes: oneNode,
        levels: [{ levelIndex: 1, digitLength: 0, defaultIsPostable: false }],
      }).plan,
    ).toMatchObject({ problem: 'digit_length_invalid', subject: '1' });
  });

  it('refuses a shape whose digit lengths exceed the code length cap', () => {
    const levels: BaseChartLevelInput[] = [
      { levelIndex: 1, digitLength: 16, defaultIsPostable: false },
      { levelIndex: 2, digitLength: 17, defaultIsPostable: true },
    ];
    expect(
      planBaseChartVersionContent({ maxDepth: 2, levels, nodes: oneNode }).plan
        .problem,
    ).toBe('code_length_too_large');
  });
});

describe('planBaseChartVersionContent — node tree', () => {
  it('refuses an empty node list', () => {
    expect(
      planBaseChartVersionContent({ maxDepth: 2, levels: LEVELS, nodes: [] })
        .plan.problem,
    ).toBe('nodes_missing');
  });

  it('refuses blank and duplicated node keys', () => {
    expect(
      planBaseChartVersionContent({
        maxDepth: 2,
        levels: LEVELS,
        nodes: [node({ nodeKey: ' ' })],
      }).plan.problem,
    ).toBe('node_key_invalid');
    expect(
      planBaseChartVersionContent({
        maxDepth: 2,
        levels: LEVELS,
        nodes: [node({}), node({ nodeKey: 'N1', code: '11' })],
      }).plan,
    ).toMatchObject({ problem: 'node_key_duplicate', subject: 'N1' });
  });

  it('refuses unknown parents, self-parents and cycles', () => {
    expect(
      planBaseChartVersionContent({
        maxDepth: 2,
        levels: LEVELS,
        nodes: [node({ parentNodeKey: 'MISSING' })],
      }).plan,
    ).toMatchObject({ problem: 'node_parent_unknown', subject: 'N1' });
    expect(
      planBaseChartVersionContent({
        maxDepth: 2,
        levels: LEVELS,
        nodes: [node({ parentNodeKey: 'N1' })],
      }).plan,
    ).toMatchObject({ problem: 'node_parent_unknown', subject: 'N1' });
    expect(
      planBaseChartVersionContent({
        maxDepth: 2,
        levels: LEVELS,
        nodes: [
          node({ nodeKey: 'A', parentNodeKey: 'B', code: '10' }),
          node({ nodeKey: 'B', parentNodeKey: 'A', code: '20' }),
        ],
      }).plan,
    ).toMatchObject({ problem: 'node_cycle', subject: 'A' });
  });

  it('refuses duplicated codes and invalid code shapes (detail carried)', () => {
    expect(
      planBaseChartVersionContent({
        maxDepth: 2,
        levels: LEVELS,
        nodes: [node({ nodeKey: 'A' }), node({ nodeKey: 'B', code: '10' })],
      }).plan,
    ).toMatchObject({ problem: 'node_code_duplicate', subject: '10' });
    expect(
      planBaseChartVersionContent({
        maxDepth: 2,
        levels: LEVELS,
        nodes: [node({ code: '10A' })],
      }).plan,
    ).toMatchObject({
      problem: 'node_code_invalid',
      subject: 'N1',
      accountCodeProblem: 'not_digits_only',
    });
    expect(
      planBaseChartVersionContent({
        maxDepth: 2,
        levels: LEVELS,
        nodes: [node({ code: '100' })],
      }).plan,
    ).toMatchObject({
      problem: 'node_code_invalid',
      subject: 'N1',
      accountCodeProblem: 'level_length_mismatch',
    });
  });

  it('refuses a child code that does not extend its parent code (§9.3)', () => {
    expect(
      planBaseChartVersionContent({
        maxDepth: 2,
        levels: LEVELS,
        nodes: [
          node({ nodeKey: 'P', code: '10' }),
          node({ nodeKey: 'C', parentNodeKey: 'P', code: '99001' }),
        ],
      }).plan,
    ).toMatchObject({
      problem: 'node_code_invalid',
      subject: 'C',
      accountCodeProblem: 'parent_prefix_mismatch',
    });
  });

  it('refuses blank titles and unknown natures', () => {
    expect(
      planBaseChartVersionContent({
        maxDepth: 2,
        levels: LEVELS,
        nodes: [node({ title: ' ' })],
      }).plan.problem,
    ).toBe('node_title_invalid');
    expect(
      planBaseChartVersionContent({
        maxDepth: 2,
        levels: LEVELS,
        nodes: [node({ accountNature: 'mixed' })],
      }).plan,
    ).toMatchObject({ problem: 'node_nature_invalid', subject: 'N1' });
  });

  it('refuses an authored postable parent (OD-20-5 gate at authoring)', () => {
    expect(
      planBaseChartVersionContent({
        maxDepth: 2,
        levels: LEVELS,
        nodes: [
          node({ nodeKey: 'P', code: '10', isPostable: true }),
          node({ nodeKey: 'C', parentNodeKey: 'P', code: '10001' }),
        ],
      }).plan,
    ).toMatchObject({ problem: 'node_parent_postable', subject: 'P' });
  });

  it('derives levels from the parent chain (never client input)', () => {
    const result = planBaseChartVersionContent({
      maxDepth: 2,
      levels: LEVELS,
      nodes: [
        // Deliberately out of order: derivation must not depend on input order.
        node({ nodeKey: 'C', parentNodeKey: 'P', code: '10001' }),
        node({ nodeKey: 'P', code: '10' }),
      ],
    });
    expect(result.plan.problem).toBeNull();
    expect(result.nodes.find((n) => n.nodeKey === 'P')?.level).toBe(1);
    expect(result.nodes.find((n) => n.nodeKey === 'C')?.level).toBe(2);
  });

  it('seeds omitted isPostable from the level default (Task 21 §7)', () => {
    const result = planBaseChartVersionContent({
      maxDepth: 2,
      levels: LEVELS,
      nodes: [
        node({ nodeKey: 'P', code: '10', isPostable: false }),
        node({ nodeKey: 'C', parentNodeKey: 'P', code: '10001' }),
      ],
    });
    expect(result.plan.problem).toBeNull();
    // Level 2 defaults to postable → the omitted leaf inherits it.
    expect(result.nodes.find((n) => n.nodeKey === 'C')?.isPostable).toBe(true);
    // An explicit override wins over the default.
    expect(result.nodes.find((n) => n.nodeKey === 'P')?.isPostable).toBe(false);
  });

  it('carries mandatory and activation flags through derivation untouched', () => {
    const result = planBaseChartVersionContent({
      maxDepth: 1,
      levels: [{ levelIndex: 1, digitLength: 2, defaultIsPostable: false }],
      nodes: [
        node({ isMandatory: true, defaultIsActive: false, isPostable: true }),
      ],
    });
    expect(result.nodes[0]?.isMandatory).toBe(true);
    expect(result.nodes[0]?.defaultIsActive).toBe(false);
    expect(result.nodes[0]?.isPostable).toBe(true);
  });
});

describe('baseChartContentProblemMessage', () => {
  it('has an author-readable message for every problem', () => {
    const problems = [
      'max_depth_invalid',
      'levels_missing',
      'levels_exceed_depth',
      'level_index_out_of_range',
      'level_index_duplicate',
      'level_index_gap',
      'digit_length_invalid',
      'code_length_too_large',
      'nodes_missing',
      'node_key_invalid',
      'node_key_duplicate',
      'node_parent_unknown',
      'node_cycle',
      'node_code_invalid',
      'node_code_duplicate',
      'node_title_invalid',
      'node_nature_invalid',
      'node_parent_postable',
    ] as const;
    for (const problem of problems) {
      expect(
        baseChartContentProblemMessage(problem).length,
        problem,
      ).toBeGreaterThan(0);
    }
  });
});
