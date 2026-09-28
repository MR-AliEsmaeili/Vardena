import { describe, expect, it } from 'vitest';
import {
  planDetailPlacement,
  planDetailPostabilityChange,
  isDetailInGroup,
  detailPlacementProblemMessage,
} from './detail.js';

describe('Detail domain placement and validation (Task 30, OD-29-03)', () => {
  const levels = [
    { levelIndex: 1, digitLength: 2 },
    { levelIndex: 2, digitLength: 2 },
    { levelIndex: 3, digitLength: 2 },
  ];

  it('places a valid root detail at level 1', () => {
    const plan = planDetailPlacement({
      id: 'd-1',
      organizationId: 'org-1',
      parentId: null,
      code: '10',
      parent: null,
      descendantIds: [],
      levels,
      maxDepth: 3,
    });
    expect(plan.problem).toBeNull();
    expect(plan.level).toBe(1);
  });

  it('refuses root code not matching level 1 length', () => {
    const plan = planDetailPlacement({
      id: 'd-1',
      organizationId: 'org-1',
      parentId: null,
      code: '100', // length 3 instead of 2
      parent: null,
      descendantIds: [],
      levels,
      maxDepth: 3,
    });
    expect(plan.problem).toBe('code_length_mismatch');
  });

  it('places a valid child detail inheriting parent code prefix', () => {
    const plan = planDetailPlacement({
      id: 'd-2',
      organizationId: 'org-1',
      parentId: 'parent-1',
      code: '1020',
      parent: {
        id: 'parent-1',
        organizationId: 'org-1',
        code: '10',
        level: 1,
        isPostable: false,
        isActive: true,
        detailStructureVersionId: 'ver-1',
      },
      descendantIds: [],
      levels,
      maxDepth: 3,
    });
    expect(plan.problem).toBeNull();
    expect(plan.level).toBe(2);
  });

  it('refuses child code not matching parent prefix', () => {
    const plan = planDetailPlacement({
      id: 'd-2',
      organizationId: 'org-1',
      parentId: 'parent-1',
      code: '9920', // prefix mismatch
      parent: {
        id: 'parent-1',
        organizationId: 'org-1',
        code: '10',
        level: 1,
        isPostable: false,
        isActive: true,
        detailStructureVersionId: 'ver-1',
      },
      descendantIds: [],
      levels,
      maxDepth: 3,
    });
    expect(plan.problem).toBe('code_prefix_mismatch');
  });

  it('refuses child under postable parent', () => {
    const plan = planDetailPlacement({
      id: 'd-2',
      organizationId: 'org-1',
      parentId: 'parent-1',
      code: '1020',
      parent: {
        id: 'parent-1',
        organizationId: 'org-1',
        code: '10',
        level: 1,
        isPostable: true,
        isActive: true,
        detailStructureVersionId: 'ver-1',
      },
      descendantIds: [],
      levels,
      maxDepth: 3,
    });
    expect(plan.problem).toBe('parent_postable');
  });

  it('refuses child under disabled parent', () => {
    const plan = planDetailPlacement({
      id: 'd-2',
      organizationId: 'org-1',
      parentId: 'parent-1',
      code: '1020',
      parent: {
        id: 'parent-1',
        organizationId: 'org-1',
        code: '10',
        level: 1,
        isPostable: false,
        isActive: false,
        detailStructureVersionId: 'ver-1',
      },
      descendantIds: [],
      levels,
      maxDepth: 3,
    });
    expect(plan.problem).toBe('parent_disabled');
  });

  it('refuses moving a node to create cycle', () => {
    const plan = planDetailPlacement({
      id: 'd-1',
      organizationId: 'org-1',
      parentId: 'child-1',
      code: '1020',
      parent: {
        id: 'child-1',
        organizationId: 'org-1',
        code: '10',
        level: 2,
        isPostable: false,
        isActive: true,
        detailStructureVersionId: 'ver-1',
      },
      descendantIds: ['child-1', 'grandchild-1'],
      levels,
      maxDepth: 3,
    });
    expect(plan.problem).toBe('cycle');
  });

  it('refuses making a detail postable if it has child records', () => {
    const problem = planDetailPostabilityChange({
      hasChildren: true,
      isPostable: true,
    });
    expect(problem).toBe('parent_postable');
  });

  it('allows making a leaf detail postable', () => {
    const problem = planDetailPostabilityChange({
      hasChildren: false,
      isPostable: true,
    });
    expect(problem).toBeNull();
  });

  it('validates detail group membership with isDetailInGroup', () => {
    const detailMap = new Map([
      ['grp-1', { id: 'grp-1', parentId: null, level: 1 }],
      ['sub-1', { id: 'sub-1', parentId: 'grp-1', level: 2 }],
      ['item-1', { id: 'item-1', parentId: 'sub-1', level: 3 }],
      ['grp-2', { id: 'grp-2', parentId: null, level: 1 }],
      ['item-2', { id: 'item-2', parentId: 'grp-2', level: 2 }],
    ]);

    const lookup = (id: string) => detailMap.get(id) ?? null;

    expect(
      isDetailInGroup({
        detailId: 'item-1',
        groupId: 'grp-1',
        detailLookup: lookup,
      }),
    ).toBe(true);
    expect(
      isDetailInGroup({
        detailId: 'sub-1',
        groupId: 'grp-1',
        detailLookup: lookup,
      }),
    ).toBe(true);
    expect(
      isDetailInGroup({
        detailId: 'grp-1',
        groupId: 'grp-1',
        detailLookup: lookup,
      }),
    ).toBe(true);
    expect(
      isDetailInGroup({
        detailId: 'item-2',
        groupId: 'grp-1',
        detailLookup: lookup,
      }),
    ).toBe(false);
  });

  it('formats friendly error messages', () => {
    expect(detailPlacementProblemMessage('parent_postable')).toContain(
      'cannot be postable',
    );
    expect(detailPlacementProblemMessage('cycle')).toContain('own descendants');
  });
});
