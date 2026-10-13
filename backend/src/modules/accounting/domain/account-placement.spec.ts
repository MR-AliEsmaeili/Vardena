import { describe, expect, it } from 'vitest';
import type {
  AccountPlacementCurrent,
  AccountPlacementParent,
} from './account.js';
import {
  ACCOUNT_IMMUTABLE_AFTER_USE_FIELDS,
  accountPlacementProblemMessage,
  defaultIsPostableForLevel,
  isAccountNature,
  isAccountType,
  normalizeAccountNature,
  normalizeAccountType,
  planAccountEdit,
  planAccountMovePin,
  planAccountPlacement,
  planPostabilityChange,
  planRootAccountPin,
} from './account.js';
import { collectDescendantIds } from './hierarchy.js';

/**
 * Chart-of-accounts placement rules (§8.4, §14; AC-I-09/AC-I-10/AC-I-11).
 *
 * These are the rules the future Posting module is supposed to be able to
 * rely on, so they are tested as decisions and not as SQL: level derivation,
 * the parent contract, cycles, the postable⇄leaf invariant, single-version
 * subtrees, and the after-use immutability (including the branch that today's
 * data cannot yet produce — a referenced account).
 */

const LEVELS = [
  { levelIndex: 1, digitLength: 2, defaultIsPostable: false },
  { levelIndex: 2, digitLength: 3, defaultIsPostable: false },
  { levelIndex: 3, digitLength: 3, defaultIsPostable: true },
];

function parent(
  overrides: Partial<AccountPlacementParent> = {},
): AccountPlacementParent {
  return {
    id: 'a-parent',
    organizationId: 'org-1',
    code: '02',
    level: 1,
    isPostable: false,
    isActive: true,
    codingStructureVersionId: 'v1',
    accountingConfigurationId: 'cfg1',
    ...overrides,
  };
}

function current(
  overrides: Partial<AccountPlacementCurrent> = {},
): AccountPlacementCurrent {
  return {
    level: 2,
    codingStructureVersionId: 'v1',
    accountingConfigurationId: 'cfg1',
    hasChildren: false,
    ...overrides,
  };
}

function placement(input: {
  id?: string;
  parentId?: string | null;
  code: string;
  parent?: AccountPlacementParent | null;
  descendantIds?: readonly string[];
  current?: AccountPlacementCurrent | null;
  maxDepth?: number;
  levels?: typeof LEVELS;
}) {
  return planAccountPlacement({
    id: input.id ?? '',
    organizationId: 'org-1',
    parentId: input.parentId ?? null,
    code: input.code,
    parent: input.parent === undefined ? null : input.parent,
    descendantIds: input.descendantIds ?? [],
    current: input.current === undefined ? null : input.current,
    levels: input.levels ?? LEVELS,
    maxDepth: input.maxDepth ?? 3,
  });
}

describe('level is derived, never supplied', () => {
  it('makes a root exactly level 1', () => {
    const plan = placement({ code: '02' });
    expect(plan.problem).toBeNull();
    expect(plan.level).toBe(1);
  });

  it('makes a child parent.level + 1', () => {
    const plan = placement({
      parentId: 'a-parent',
      parent: parent({ level: 1, code: '02' }),
      code: '02003',
    });
    expect(plan.problem).toBeNull();
    expect(plan.level).toBe(2);
  });

  it('refuses a placement below a level-3 parent (depth beyond the structure)', () => {
    const plan = placement({
      parentId: 'deep',
      parent: parent({ id: 'deep', level: 3, code: '02003004' }),
      code: '02003004005',
    });
    expect(plan.problem).toBe('depth_exceeded');
  });

  it('accepts deeper trees when the CONFIGURATION allows them (§8.1)', () => {
    const plan = placement({
      parentId: 'deep',
      parent: parent({ id: 'deep', level: 3, code: '02003004' }),
      code: '02003004005',
      maxDepth: 4,
      levels: [
        ...LEVELS,
        { levelIndex: 4, digitLength: 3, defaultIsPostable: true },
      ],
    });
    expect(plan.problem).toBeNull();
    expect(plan.level).toBe(4);
  });
});

describe('parent validity', () => {
  it('reports a missing parent as not-found, not as a generic failure', () => {
    expect(
      placement({ parentId: 'missing', parent: null, code: '02003' }).problem,
    ).toBe('parent_not_found');
  });

  it('refuses a parent from another organization', () => {
    expect(
      placement({
        parentId: 'other',
        parent: parent({ id: 'other', organizationId: 'org-2' }),
        code: '02003',
      }).problem,
    ).toBe('cross_organization');
  });

  it('refuses a disabled parent (§8.6 blocks new child creation)', () => {
    expect(
      placement({
        parentId: 'off',
        parent: parent({ id: 'off', isActive: false }),
        code: '02003',
      }).problem,
    ).toBe('parent_disabled');
  });

  it('allows a child under an enabled parent (only the parent is judged)', () => {
    expect(
      placement({
        parentId: 'on',
        parent: parent({ id: 'on', isActive: true }),
        code: '02003',
      }).problem,
    ).toBeNull();
  });
});

describe('cycle prevention', () => {
  it('refuses moving a node under its own child', () => {
    const plan = placement({
      id: 'A',
      parentId: 'B',
      parent: parent({ id: 'B', code: '02003', level: 2 }),
      descendantIds: ['B', 'C'],
      current: current({ level: 1 }),
      code: '02',
    });
    expect(plan.problem).toBe('cycle');
    expect(accountPlacementProblemMessage('cycle')).toMatch(/descendant/);
  });

  it('refuses a longer cycle (A → B → C → A) via the descendant set', () => {
    const edges = [
      { id: 'A', parentId: null },
      { id: 'B', parentId: 'A' },
      { id: 'C', parentId: 'B' },
    ];
    const descendants = collectDescendantIds(edges, 'A');
    expect(descendants).toEqual(['B', 'C']);
    expect(
      placement({
        id: 'A',
        parentId: 'C',
        parent: parent({ id: 'C', code: '02003004', level: 3 }),
        descendantIds: descendants,
        current: current({ level: 1 }),
        code: '02',
      }).problem,
    ).toBe('cycle');
  });

  it('refuses self-parenting', () => {
    expect(
      placement({
        id: 'A',
        parentId: 'A',
        parent: parent({ id: 'A' }),
        code: '02003',
        current: current(),
      }).problem,
    ).toBe('self_parent');
  });

  it('terminates the walk on already-corrupt data instead of looping', () => {
    const corrupt = [
      { id: 'X', parentId: 'Y' },
      { id: 'Y', parentId: 'X' },
    ];
    expect(collectDescendantIds(corrupt, 'X')).toEqual(['Y']);
  });
});

describe('postable / non-postable (§14, AC-D-19)', () => {
  it('refuses a child under a postable parent (double-count guard)', () => {
    const plan = placement({
      parentId: 'p',
      parent: parent({ id: 'p', isPostable: true }),
      code: '02003',
    });
    expect(plan.problem).toBe('parent_postable');
    expect(accountPlacementProblemMessage('parent_postable')).toMatch(
      /double-count/,
    );
  });

  it('refuses making an account with children postable', () => {
    expect(planPostabilityChange({ isPostable: true, hasChildren: true })).toBe(
      'postable_with_children',
    );
  });

  it('allows making a leaf postable and allows removing postability', () => {
    expect(
      planPostabilityChange({ isPostable: true, hasChildren: false }),
    ).toBeNull();
    expect(
      planPostabilityChange({ isPostable: false, hasChildren: true }),
    ).toBeNull();
  });

  it('keeps a leaf non-postable when the organization wants a placeholder', () => {
    // "postable ⇒ leaf" is one-way: a leaf may still be non-postable (§14.3).
    expect(
      planPostabilityChange({ isPostable: false, hasChildren: false }),
    ).toBeNull();
  });

  it('takes the default from the level definition, not from a level name', () => {
    expect(defaultIsPostableForLevel(LEVELS, 1)).toBe(false);
    expect(defaultIsPostableForLevel(LEVELS, 3)).toBe(true);
    expect(defaultIsPostableForLevel(LEVELS, 99)).toBe(false);
  });
});

describe('code ⇄ hierarchy consistency (§9.3)', () => {
  it('refuses a child code that does not extend the parent code', () => {
    expect(
      placement({
        parentId: 'p',
        parent: parent({ code: '02' }),
        code: '03001',
      }).problem,
    ).toBe('parent_prefix_mismatch');
  });

  it('refuses a root code shaped like a child code', () => {
    expect(placement({ code: '02003' }).problem).toBe('level_length_mismatch');
  });
});

describe('one subtree, one coding-structure version (§9.4) — now accounting config sole scope D1', () => {
  it('refuses moving a node under a parent pinned to another version (coding legacy)', () => {
    expect(
      placement({
        id: 'A',
        parentId: 'p2',
        parent: parent({ id: 'p2', codingStructureVersionId: 'v2' }),
        code: '02003',
        current: current(),
      }).problem,
    ).toBe('version_mismatch');
  });

  it('refuses moving a node under a parent pinned to another accounting config (D1 sole scope)', () => {
    expect(
      placement({
        id: 'A',
        parentId: 'p2',
        parent: parent({
          id: 'p2',
          accountingConfigurationId: 'cfg2',
          codingStructureVersionId: 'v1',
        }),
        code: '02003',
        current: current({
          accountingConfigurationId: 'cfg1',
          codingStructureVersionId: 'v1',
        }),
      }).problem,
    ).toBe('version_mismatch');
  });

  it('refuses a move whose snapshot names another configuration or version than the account is pinned to', () => {
    // The write boundary must validate the account against ITS OWN pair only —
    // a move validated against another configuration's levels is the
    // cross-configuration validation Task 11 remediation forbids.
    expect(
      planAccountMovePin({
        pinned: {
          accountingConfigurationId: 'cfg1',
          codingStructureVersionId: 'v1',
        },
        snapshot: {
          accountingConfigurationId: 'cfg2',
          versionId: 'v1',
        },
      }),
    ).toBe('pin_mismatch');
    expect(
      planAccountMovePin({
        pinned: {
          accountingConfigurationId: 'cfg1',
          codingStructureVersionId: 'v1',
        },
        snapshot: {
          accountingConfigurationId: 'cfg1',
          versionId: 'v2',
        },
      }),
    ).toBe('pin_mismatch');
    // An incomplete (legacy) pin can never match a complete snapshot either.
    expect(
      planAccountMovePin({
        pinned: {
          accountingConfigurationId: null,
          codingStructureVersionId: 'v1',
        },
        snapshot: {
          accountingConfigurationId: 'cfg1',
          versionId: 'v1',
        },
      }),
    ).toBe('pin_mismatch');
    // The account's own pair passes unchanged.
    expect(
      planAccountMovePin({
        pinned: {
          accountingConfigurationId: 'cfg1',
          codingStructureVersionId: 'v1',
        },
        snapshot: {
          accountingConfigurationId: 'cfg1',
          versionId: 'v1',
        },
      }),
    ).toBeNull();
  });

  it('refuses re-levelling a node that has children (OQ-25 policy)', () => {
    // Same-depth reparenting is allowed: the codes stay valid.
    expect(
      placement({
        id: 'A',
        parentId: 'p2',
        parent: parent({ id: 'p2', level: 1, code: '03' }),
        code: '03003',
        current: current({ level: 2, hasChildren: true }),
      }).problem,
    ).toBeNull();
    // Changing the depth of a subtree would rewrite descendants' codes.
    expect(
      placement({
        id: 'A',
        parentId: 'p3',
        parent: parent({ id: 'p3', level: 2, code: '03001' }),
        code: '03001002',
        current: current({ level: 2, hasChildren: true }),
      }).problem,
    ).toBe('restructure_with_children');
    // A leaf may change depth: nothing below it can go stale.
    expect(
      placement({
        id: 'A',
        parentId: 'p3',
        parent: parent({ id: 'p3', level: 2, code: '03001' }),
        code: '03001002',
        current: current({ level: 2, hasChildren: false }),
      }).problem,
    ).toBeNull();
  });
});

describe('AC-I-11 immutability after use and OD-29-02 accountType immutability', () => {
  it('allows every structural change while the account is unreferenced', () => {
    expect(
      planAccountEdit({
        referencedByDocumentLine: false,
        hasPostedLedgerEntry: false,
        changes: {
          parentId: true,
          level: true,
          accountNature: true,
          accountType: true,
          detailGroupId: true,
          isPostable: true,
        },
      }).refused,
    ).toEqual([]);
  });

  it('refuses structural fields once a document line references the account, but keeps accountType mutable until posted', () => {
    const planDraftLine = planAccountEdit({
      referencedByDocumentLine: true,
      hasPostedLedgerEntry: false,
      changes: {
        parentId: true,
        level: true,
        accountNature: true,
        accountType: true,
        detailGroupId: true,
        isPostable: true,
      },
    });
    expect(planDraftLine.refused).toEqual([
      'parentId',
      'level',
      'accountNature',
      'detailGroupId',
      'isPostable',
    ]);

    const planPosted = planAccountEdit({
      referencedByDocumentLine: true,
      hasPostedLedgerEntry: true,
      changes: {
        parentId: true,
        level: true,
        accountNature: true,
        accountType: true,
        detailGroupId: true,
        isPostable: true,
      },
    });
    expect(planPosted.refused).toEqual([...ACCOUNT_IMMUTABLE_AFTER_USE_FIELDS]);
  });

  it('never refuses a title change, and refuses nothing when no structural field moves', () => {
    expect(
      planAccountEdit({
        referencedByDocumentLine: true,
        hasPostedLedgerEntry: true,
        changes: {},
      }).refused,
    ).toEqual([]);
    expect(
      planAccountEdit({
        referencedByDocumentLine: true,
        hasPostedLedgerEntry: true,
        changes: { isPostable: false, parentId: false },
      }).refused,
    ).toEqual([]);
  });

  it('freezes accountType only when hasPostedLedgerEntry is true', () => {
    // 1. Unreferenced: accountType can change
    expect(
      planAccountEdit({
        referencedByDocumentLine: false,
        hasPostedLedgerEntry: false,
        changes: { accountType: true },
      }).refused,
    ).toEqual([]);

    // 2. Draft/temporary document line: accountType can STILL change (OD-29-02)
    expect(
      planAccountEdit({
        referencedByDocumentLine: true,
        hasPostedLedgerEntry: false,
        changes: { accountType: true },
      }).refused,
    ).toEqual([]);

    // 3. Posted ledger entry: accountType is frozen
    expect(
      planAccountEdit({
        referencedByDocumentLine: true,
        hasPostedLedgerEntry: true,
        changes: { accountType: true },
      }).refused,
    ).toEqual(['accountType']);
  });
});

describe('root pin write boundary (D1 + §9.4)', () => {
  const snapshot = {
    accountingConfigurationId: 'cfg1',
    versionId: 'v1',
  };

  it('accepts only an ACTIVE configuration and an active coding version of the same organization', () => {
    expect(
      planRootAccountPin({
        organizationId: 'org-1',
        snapshot,
        configuration: { organizationId: 'org-1', status: 'ACTIVE' },
        version: { organizationId: 'org-1', status: 'active' },
      }),
    ).toBeNull();
  });

  it('refuses a missing/foreign configuration or a non-ACTIVE one', () => {
    expect(
      planRootAccountPin({
        organizationId: 'org-1',
        snapshot,
        configuration: null,
        version: { organizationId: 'org-1', status: 'active' },
      }),
    ).toBe('configuration_missing');
    expect(
      planRootAccountPin({
        organizationId: 'org-1',
        snapshot,
        configuration: { organizationId: 'org-2', status: 'ACTIVE' },
        version: { organizationId: 'org-1', status: 'active' },
      }),
    ).toBe('configuration_missing');
    for (const status of ['DRAFT', 'SUPERSEDED']) {
      expect(
        planRootAccountPin({
          organizationId: 'org-1',
          snapshot,
          configuration: { organizationId: 'org-1', status },
          version: { organizationId: 'org-1', status: 'active' },
        }),
      ).toBe('configuration_not_active');
    }
  });

  it('refuses a missing/foreign coding version or one that is not active', () => {
    const configuration = { organizationId: 'org-1', status: 'ACTIVE' };
    expect(
      planRootAccountPin({
        organizationId: 'org-1',
        snapshot,
        configuration,
        version: null,
      }),
    ).toBe('coding_version_missing');
    expect(
      planRootAccountPin({
        organizationId: 'org-1',
        snapshot,
        configuration,
        version: { organizationId: 'org-2', status: 'active' },
      }),
    ).toBe('coding_version_missing');
    for (const status of ['draft', 'superseded']) {
      expect(
        planRootAccountPin({
          organizationId: 'org-1',
          snapshot,
          configuration,
          version: { organizationId: 'org-1', status },
        }),
      ).toBe('coding_version_not_active');
    }
  });
});

describe('account nature list', () => {
  it('is exactly DEBIT, CREDIT, DUAL and lowercase/invalid values are rejected', () => {
    expect(isAccountNature('DEBIT')).toBe(true);
    expect(isAccountNature('CREDIT')).toBe(true);
    expect(isAccountNature('DUAL')).toBe(true);
    expect(isAccountNature('debit')).toBe(false);
    expect(isAccountNature('credit')).toBe(false);
    expect(isAccountNature('dual')).toBe(false);
    // `natural`/`contra`/`asset` are not natures (type is OQ-25, not nature).
    expect(isAccountNature('asset')).toBe(false);

    expect(normalizeAccountNature('DEBIT')).toBe('DEBIT');
    expect(normalizeAccountNature(' CREDIT ')).toBe('CREDIT');
    expect(normalizeAccountNature('DUAL')).toBe('DUAL');
    expect(() => normalizeAccountNature('debit')).toThrow(
      /Invalid account nature/,
    );
    expect(() => normalizeAccountNature('credit')).toThrow(
      /Invalid account nature/,
    );
    expect(() => normalizeAccountNature('invalid')).toThrow(
      /Invalid account nature/,
    );
  });
});

describe('account type list', () => {
  it('is exactly BALANCE_SHEET, INCOME_STATEMENT, MEMORANDUM and lowercase/invalid values are rejected', () => {
    expect(isAccountType('BALANCE_SHEET')).toBe(true);
    expect(isAccountType('INCOME_STATEMENT')).toBe(true);
    expect(isAccountType('MEMORANDUM')).toBe(true);
    expect(isAccountType('balance_sheet')).toBe(false);
    expect(isAccountType('income_statement')).toBe(false);
    expect(isAccountType('memorandum')).toBe(false);
    expect(isAccountType('EQUITY')).toBe(false);

    expect(normalizeAccountType('BALANCE_SHEET')).toBe('BALANCE_SHEET');
    expect(normalizeAccountType(' INCOME_STATEMENT ')).toBe('INCOME_STATEMENT');
    expect(normalizeAccountType('MEMORANDUM')).toBe('MEMORANDUM');
    expect(() => normalizeAccountType('balance_sheet')).toThrow(
      /Invalid account type/,
    );
    expect(() => normalizeAccountType('income_statement')).toThrow(
      /Invalid account type/,
    );
    expect(() => normalizeAccountType('invalid')).toThrow(
      /Invalid account type/,
    );
  });
});
