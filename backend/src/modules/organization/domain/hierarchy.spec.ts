import { describe, expect, it } from 'vitest';
import {
  collectDescendantIds,
  findHierarchyProblem,
  type HierarchyCheckInput,
  type HierarchyEdge,
} from './hierarchy.js';

/**
 * `hierarchy.ts` is the whole of the self-referencing master-data rules —
 * one nullable parent, three rejections. Every rule that could silently
 * corrupt a department or item-group tree is covered here, because the
 * services only call this predicate before writing.
 */

const ORG = '01ORGANIZATION0000000000AA';

function input(
  overrides: Partial<HierarchyCheckInput> = {},
): HierarchyCheckInput {
  return {
    id: 'child',
    parentId: 'parent',
    organizationId: ORG,
    parent: { organizationId: ORG },
    descendantIds: [],
    ...overrides,
  };
}

describe('findHierarchyProblem', () => {
  it('accepts a root assignment (no parent at all)', () => {
    expect(findHierarchyProblem(input({ parentId: null, parent: null }))).toBe(
      null,
    );
  });

  it('accepts a valid parent in the same organization', () => {
    expect(findHierarchyProblem(input())).toBe(null);
  });

  it('rejects self-parenting', () => {
    expect(findHierarchyProblem(input({ parentId: 'child' }))).toBe(
      'self_parent',
    );
  });

  it('rejects a parent from another organization', () => {
    expect(
      findHierarchyProblem(
        input({ parent: { organizationId: '01OTHERORGANIZATION0000000BB' } }),
      ),
    ).toBe('cross_organization');
  });

  it('rejects moving a node under one of its own descendants', () => {
    expect(
      findHierarchyProblem(input({ descendantIds: ['a', 'parent'] })),
    ).toBe('cycle');
  });

  it('accepts a parent that is a sibling of a descendant but not one itself', () => {
    expect(
      findHierarchyProblem(input({ descendantIds: ['a', 'b'] })),
    ).toBe(null);
  });

  it('reports self-parenting before a cross-organization parent', () => {
    // Order matters for the message: a node that is its own parent is a
    // structural mistake, not an isolation one.
    expect(
      findHierarchyProblem(
        input({
          id: 'same',
          parentId: 'same',
          parent: { organizationId: '01OTHERORGANIZATION0000000BB' },
        }),
      ),
    ).toBe('self_parent');
  });

  it('does not consult the parent row when there is no parent', () => {
    // A root node must be creatable without resolving anything.
    expect(
      findHierarchyProblem(
        input({ parentId: null, parent: null, descendantIds: ['parent'] }),
      ),
    ).toBe(null);
  });
});

describe('collectDescendantIds', () => {
  const edges: HierarchyEdge[] = [
    { id: 'root', parentId: null },
    { id: 'a', parentId: 'root' },
    { id: 'b', parentId: 'root' },
    { id: 'a1', parentId: 'a' },
    { id: 'a2', parentId: 'a' },
    { id: 'a1x', parentId: 'a1' },
    { id: 'other', parentId: null },
  ];

  it('returns the whole subtree, excluding the root itself', () => {
    expect(collectDescendantIds(edges, 'root').sort()).toEqual([
      'a',
      'a1',
      'a1x',
      'a2',
      'b',
    ]);
  });

  it('returns only a branch when the root is an interior node', () => {
    expect(collectDescendantIds(edges, 'a').sort()).toEqual(['a1', 'a1x', 'a2']);
  });

  it('returns nothing for a leaf', () => {
    expect(collectDescendantIds(edges, 'a1x')).toEqual([]);
  });

  it('returns nothing for an unknown id', () => {
    expect(collectDescendantIds(edges, 'nope')).toEqual([]);
  });

  it('terminates on already-corrupt cyclic data instead of looping', () => {
    const cyclic: HierarchyEdge[] = [
      { id: 'x', parentId: 'y' },
      { id: 'y', parentId: 'x' },
    ];
    expect(collectDescendantIds(cyclic, 'x').sort()).toEqual(['y']);
  });

  it('ignores edges whose parent is null when building the child map', () => {
    expect(
      collectDescendantIds([{ id: 'solo', parentId: null }], 'solo'),
    ).toEqual([]);
  });
});
