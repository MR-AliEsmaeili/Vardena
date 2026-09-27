import { describe, expect, it } from 'vitest';
import {
  baseChartCompatibilityProblemMessage,
  baseChartSelectionProblemMessage,
  planAdoptionSelection,
  planTemplateCompatibility,
} from './base-chart-adoption.js';
import type { BaseChartTemplateNode } from './base-chart-template.js';

/**
 * Task 23 — Base Chart adoption planners (OD-20-1/OD-20-5, Task 21
 * §3/§4.3/§5/§7): template ↔ configuration compatibility, the final adoption
 * set (requested ∪ ancestor closure ∪ mandatory), the leaf-only postability
 * derivation and the deterministic topological insert order.
 */

const TEMPLATE_LEVELS = [
  { levelIndex: 1, digitLength: 2 },
  { levelIndex: 2, digitLength: 3 },
  { levelIndex: 3, digitLength: 2 },
];

function node(
  nodeKey: string,
  parentNodeKey: string | null,
  code: string,
  level: number,
  flags: Partial<{
    isPostable: boolean;
    isMandatory: boolean;
    defaultIsActive: boolean;
    accountNature: string;
  }> = {},
): BaseChartTemplateNode {
  return {
    id: `id-${nodeKey}`,
    versionId: 'version-1',
    nodeKey,
    parentNodeKey,
    parentId: parentNodeKey === null ? null : `id-${parentNodeKey}`,
    code,
    title: `Node ${nodeKey}`,
    accountNature: flags.accountNature ?? 'debit',
    isPostable: flags.isPostable ?? false,
    isMandatory: flags.isMandatory ?? false,
    defaultIsActive: flags.defaultIsActive ?? true,
    level,
  };
}

/**
 * 10 ── 10001 ── 1000101
 *  └─ 10002           └─ 1000102
 * 11 ── 11001
 */
const TREE: BaseChartTemplateNode[] = [
  node('R1', null, '10', 1),
  node('R1C1', 'R1', '10001', 2),
  node('R1C1L1', 'R1C1', '1000101', 3),
  node('R1C1L2', 'R1C1', '1000102', 3),
  node('R1C2', 'R1', '10002', 2),
  node('R2', null, '11', 1),
  node('R2C1', 'R2', '11001', 2),
];

describe('planTemplateCompatibility', () => {
  it('accepts a template whose shape equals the organization shape', () => {
    const plan = planTemplateCompatibility({
      templateMaxDepth: 3,
      templateLevels: TEMPLATE_LEVELS,
      nodes: TREE,
      configurationLevels: TEMPLATE_LEVELS,
    });
    expect(plan.problem).toBeNull();
  });

  it('accepts a shallower template inside a deeper organization shape', () => {
    const plan = planTemplateCompatibility({
      templateMaxDepth: 3,
      templateLevels: TEMPLATE_LEVELS,
      nodes: TREE,
      configurationLevels: [
        ...TEMPLATE_LEVELS,
        { levelIndex: 4, digitLength: 4 },
      ],
    });
    expect(plan.problem).toBeNull();
  });

  it('refuses a template deeper than the organization shape', () => {
    const plan = planTemplateCompatibility({
      templateMaxDepth: 3,
      templateLevels: TEMPLATE_LEVELS,
      nodes: TREE,
      configurationLevels: TEMPLATE_LEVELS.slice(0, 2),
    });
    expect(plan).toMatchObject({
      problem: 'template_depth_exceeded',
      subject: '3',
    });
  });

  it('refuses per-level digit length mismatches and names the level', () => {
    const plan = planTemplateCompatibility({
      templateMaxDepth: 3,
      templateLevels: TEMPLATE_LEVELS,
      nodes: TREE,
      configurationLevels: [
        { levelIndex: 1, digitLength: 2 },
        { levelIndex: 2, digitLength: 4 },
        { levelIndex: 3, digitLength: 2 },
      ],
    });
    expect(plan).toMatchObject({
      problem: 'digit_length_mismatch',
      subject: '2',
    });
  });

  it('re-proves every node code against the organization shape', () => {
    // A structurally-impossible published version (its declared depth is 2
    // yet it carries a level-3 node) still fails the adoption boundary
    // instead of being trusted, even though the declared levels match.
    const plan = planTemplateCompatibility({
      templateMaxDepth: 2,
      templateLevels: TEMPLATE_LEVELS.slice(0, 2),
      nodes: TREE,
      configurationLevels: TEMPLATE_LEVELS.slice(0, 2),
    });
    expect(plan.problem).toBe('code_incompatible');
    expect(plan.accountCodeProblem).toBe('level_unknown');
  });
});

describe('planAdoptionSelection — full version', () => {
  it('adopts the whole version in topological order when no selection is given', () => {
    const plan = planAdoptionSelection({ nodes: TREE, selectedNodeKeys: null });
    expect(plan.problem).toBeNull();
    expect(plan.nodes.map((n) => n.nodeKey)).toEqual([
      'R1',
      'R2',
      'R1C1',
      'R1C2',
      'R2C1',
      'R1C1L1',
      'R1C1L2',
    ]);
    expect(plan.nodes).toHaveLength(TREE.length);
  });

  it('proves ancestor closure and mandatory inclusion are tautologies of a full set', () => {
    const plan = planAdoptionSelection({ nodes: TREE, selectedNodeKeys: null });
    const keys = new Set(plan.nodes.map((n) => n.nodeKey));
    for (const planned of plan.nodes) {
      if (planned.parentNodeKey !== null) {
        expect(keys.has(planned.parentNodeKey)).toBe(true);
      }
    }
  });
});

describe('planAdoptionSelection — partial adoption (bounded, Task 21 §4.3)', () => {
  it('adds the ancestor closure of a selected leaf, not the whole chart', () => {
    const plan = planAdoptionSelection({
      nodes: TREE,
      selectedNodeKeys: ['R1C1L1'],
    });
    expect(plan.problem).toBeNull();
    expect(plan.nodes.map((n) => n.nodeKey).sort()).toEqual([
      'R1',
      'R1C1',
      'R1C1L1',
    ]);
  });

  it('includes every mandatory node (with its ancestors) even when not selected', () => {
    const withMandatory = TREE.map((entry) =>
      entry.nodeKey === 'R2C1' ? { ...entry, isMandatory: true } : entry,
    );
    const plan = planAdoptionSelection({
      nodes: withMandatory,
      selectedNodeKeys: ['R1C1L1'],
    });
    expect(plan.nodes.map((n) => n.nodeKey).sort()).toEqual([
      'R1',
      'R1C1',
      'R1C1L1',
      'R2',
      'R2C1',
    ]);
    expect(plan.nodes.find((n) => n.nodeKey === 'R2C1')?.isMandatory).toBe(
      true,
    );
  });

  it('deduplicates repeated keys and tolerates ancestor+picked descendants', () => {
    const plan = planAdoptionSelection({
      nodes: TREE,
      selectedNodeKeys: ['R1C1', 'R1C1L1', 'R1C1'],
    });
    expect(plan.problem).toBeNull();
    expect(plan.nodes.map((n) => n.nodeKey).sort()).toEqual([
      'R1',
      'R1C1',
      'R1C1L1',
    ]);
  });

  it('rejects a selection naming an unknown node key', () => {
    const plan = planAdoptionSelection({
      nodes: TREE,
      selectedNodeKeys: ['R1C1L1', 'GHOST'],
    });
    expect(plan).toMatchObject({
      problem: 'unknown_node_key',
      subject: 'GHOST',
    });
    expect(plan.nodes).toEqual([]);
  });

  it('guards template integrity (a dangling parent is corruption, not a shape)', () => {
    const broken = [node('ORPHAN', 'GHOST-PARENT', '99', 1), ...TREE];
    const plan = planAdoptionSelection({
      nodes: broken,
      selectedNodeKeys: null,
    });
    expect(plan).toMatchObject({
      problem: 'ancestor_missing',
      subject: 'ORPHAN',
    });
  });
});

describe('planAdoptionSelection — leaf-only postability derivation (OD-20-5)', () => {
  it('forces every non-leaf false even when the authored default says true', () => {
    // Defensive derivation: even a version whose contents somehow carry a
    // postable parent can never yield a postable non-leaf in the chart.
    const corruptValues = TREE.map((entry) => ({ ...entry, isPostable: true }));
    const plan = planAdoptionSelection({
      nodes: corruptValues,
      selectedNodeKeys: null,
    });
    expect(plan.problem).toBeNull();
    for (const planned of plan.nodes) {
      const hasChild = plan.nodes.some(
        (candidate) => candidate.parentNodeKey === planned.nodeKey,
      );
      if (hasChild) {
        expect(planned.isPostable, planned.nodeKey).toBe(false);
      } else {
        expect(planned.isPostable, planned.nodeKey).toBe(true);
      }
    }
  });

  it('treats non-adopted descendants as no children (partial adoption)', () => {
    // Selecting only 'R1C1' makes it a leaf of the ADOPTED set: its template
    // children stay outside the chart, so the authored postable default is
    // allowed to stand (the existing create path refuses children under a
    // postable parent ever afterwards — the invariant is closed both ways).
    const plan = planAdoptionSelection({
      nodes: TREE.map((entry) =>
        entry.nodeKey === 'R1C1' ? { ...entry, isPostable: true } : entry,
      ),
      selectedNodeKeys: ['R1C1'],
    });
    expect(plan.nodes.find((n) => n.nodeKey === 'R1C1')?.isPostable).toBe(true);
  });

  it('keeps a configured level default on a leaf and never on a parent', () => {
    const plan = planAdoptionSelection({
      nodes: TREE.map((entry) => ({ ...entry, isPostable: true })),
      selectedNodeKeys: ['R1C1L1', 'R1C1L2'],
    });
    const byKey = new Map(plan.nodes.map((n) => [n.nodeKey, n]));
    expect(byKey.get('R1')?.isPostable).toBe(false);
    expect(byKey.get('R1C1')?.isPostable).toBe(false);
    expect(byKey.get('R1C1L1')?.isPostable).toBe(true);
    expect(byKey.get('R1C1L2')?.isPostable).toBe(true);
  });

  it('orders parents strictly before children (deterministic insert order)', () => {
    const shuffled = [...TREE].reverse();
    const plan = planAdoptionSelection({
      nodes: shuffled,
      selectedNodeKeys: null,
    });
    const keys = plan.nodes.map((n) => n.nodeKey);
    const positionOf = new Map(keys.map((key, index) => [key, index]));
    for (const planned of plan.nodes) {
      if (planned.parentNodeKey !== null) {
        expect(positionOf.get(planned.parentNodeKey) as number).toBeLessThan(
          positionOf.get(planned.nodeKey) as number,
        );
      }
    }
    // Level ascending, then code ascending — fully deterministic.
    expect(keys).toEqual(
      [...keys].sort((a, b) => {
        const left = plan.nodes.find((n) => n.nodeKey === a)!;
        const right = plan.nodes.find((n) => n.nodeKey === b)!;
        if (left.level !== right.level) return left.level - right.level;
        return left.code.localeCompare(right.code, 'en');
      }),
    );
  });

  it('carries mandatory and activation flags into the planned rows', () => {
    const flagged = TREE.map((entry) =>
      entry.nodeKey === 'R1C1'
        ? { ...entry, isMandatory: true, defaultIsActive: false }
        : entry,
    );
    const plan = planAdoptionSelection({
      nodes: flagged,
      selectedNodeKeys: ['R1C1L1'],
    });
    expect(plan.nodes.find((n) => n.nodeKey === 'R1C1')).toMatchObject({
      isMandatory: true,
      defaultIsActive: false,
    });
  });
});

describe('adoption problem messages', () => {
  it('has a message for every compatibility problem', () => {
    for (const problem of [
      'template_depth_exceeded',
      'digit_length_mismatch',
      'code_incompatible',
    ] as const) {
      expect(
        baseChartCompatibilityProblemMessage(problem).length,
      ).toBeGreaterThan(0);
    }
  });

  it('has a message for every selection problem', () => {
    for (const problem of ['unknown_node_key', 'ancestor_missing'] as const) {
      expect(baseChartSelectionProblemMessage(problem).length).toBeGreaterThan(
        0,
      );
    }
  });
});
