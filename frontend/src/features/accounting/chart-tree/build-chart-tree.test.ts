import { describe, expect, it } from 'vitest';
import type { ChartTreeNode } from '@/api/contracts';
import { buildChartTree, collectExpandableIds } from './build-chart-tree';

function node(
  id: string,
  code: string,
  parentId: string | null,
  level: number,
): ChartTreeNode {
  return {
    id,
    organizationId: 'org-1',
    code,
    title: `حساب ${code}`,
    parentId,
    level,
    codingStructureVersionId: null,
    accountingConfigurationId: null,
    accountNature: 'debit',
    isPostable: parentId !== null,
    isActive: true,
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
  } as ChartTreeNode;
}

describe('buildChartTree', () => {
  it('nests children under their parent, preserving the API order', () => {
    const roots = buildChartTree([
      node('a', '10', null, 1),
      node('a1', '1010', 'a', 2),
      node('a2', '1020', 'a', 2),
      node('b', '20', null, 1),
    ]);

    expect(roots.map((item) => item.node.code)).toEqual(['10', '20']);
    expect(roots[0]?.children.map((item) => item.node.code)).toEqual([
      '1010',
      '1020',
    ]);
    expect(roots[1]?.children).toHaveLength(0);
  });

  it('keeps a node whose parent is outside the loaded window as a root', () => {
    const roots = buildChartTree([node('orphan', '1010', 'missing-parent', 2)]);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.node.code).toBe('1010');
  });

  it('does not invent, drop or reorder nodes', () => {
    const nodes = [
      node('a', '10', null, 1),
      node('a1', '1010', 'a', 2),
      node('a1x', '101010', 'a1', 3),
    ];
    const roots = buildChartTree(nodes);

    const flattened: string[] = [];
    const walk = (items: ReturnType<typeof buildChartTree>): void => {
      for (const item of items) {
        flattened.push(item.node.id);
        walk(item.children);
      }
    };
    walk(roots);

    expect(flattened).toEqual(['a', 'a1', 'a1x']);
  });

  it('returns an empty tree for an empty page', () => {
    expect(buildChartTree([])).toEqual([]);
  });
});

describe('collectExpandableIds', () => {
  it('lists every node that has children', () => {
    const roots = buildChartTree([
      node('a', '10', null, 1),
      node('a1', '1010', 'a', 2),
      node('a1x', '101010', 'a1', 3),
      node('b', '20', null, 1),
    ]);

    expect(collectExpandableIds(roots)).toEqual(['a', 'a1']);
  });
});
