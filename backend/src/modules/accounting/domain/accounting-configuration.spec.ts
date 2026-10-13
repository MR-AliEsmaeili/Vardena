import { describe, expect, it } from 'vitest';
import {
  canDeleteConfiguration,
  canDestructivelyMutate,
  MAX_LEVEL_KIND_LENGTH,
  planAccountingConfiguration,
  planConfigurationTransition,
} from './accounting-configuration.js';
import {
  resolveFreezeState,
  isConfigurationFrozen,
} from './accounting-configuration-freeze.js';

describe('Accounting Configuration Foundation — Task 11 invariants', () => {
  it('validates a correct configuration shape', () => {
    const plan = planAccountingConfiguration({
      code: 'DEFAULT',
      name: 'Main Config',
      effectiveFrom: null,
      maxDepth: 2,
      levels: [
        {
          levelIndex: 1,
          title: 'Group',
          digitLength: 2,
          defaultIsPostable: false,
          levelKind: null,
        },
        {
          levelIndex: 2,
          title: 'Detail',
          digitLength: 3,
          defaultIsPostable: true,
          levelKind: null,
        },
      ],
    });
    expect(plan.problem).toBeNull();
  });

  it('refuses blank code or name', () => {
    expect(
      planAccountingConfiguration({
        code: '',
        name: 'Main',
        effectiveFrom: null,
        maxDepth: 1,
        levels: [
          {
            levelIndex: 1,
            title: 'A',
            digitLength: 1,
            defaultIsPostable: false,
            levelKind: null,
          },
        ],
      }).problem,
    ).toBe('code_invalid');
    expect(
      planAccountingConfiguration({
        code: 'DEFAULT',
        name: '',
        effectiveFrom: null,
        maxDepth: 1,
        levels: [
          {
            levelIndex: 1,
            title: 'A',
            digitLength: 1,
            defaultIsPostable: false,
            levelKind: null,
          },
        ],
      }).problem,
    ).toBe('name_invalid');
  });

  it('refuses missing levels', () => {
    expect(
      planAccountingConfiguration({
        code: 'DEFAULT',
        name: 'Main',
        effectiveFrom: null,
        maxDepth: 0,
        levels: [],
      }).problem,
    ).toBe('levels_missing');
  });

  it('refuses gap or duplicate levelIndex', () => {
    expect(
      planAccountingConfiguration({
        code: 'DEFAULT',
        name: 'Main',
        effectiveFrom: null,
        maxDepth: 3,
        levels: [
          {
            levelIndex: 1,
            title: 'A',
            digitLength: 1,
            defaultIsPostable: false,
            levelKind: null,
          },
          {
            levelIndex: 3,
            title: 'C',
            digitLength: 1,
            defaultIsPostable: false,
            levelKind: null,
          },
        ],
      }).problem,
    ).toBe('level_index_gap');

    expect(
      planAccountingConfiguration({
        code: 'DEFAULT',
        name: 'Main',
        effectiveFrom: null,
        maxDepth: 2,
        levels: [
          {
            levelIndex: 1,
            title: 'A',
            digitLength: 1,
            defaultIsPostable: false,
            levelKind: null,
          },
          {
            levelIndex: 1,
            title: 'B',
            digitLength: 1,
            defaultIsPostable: false,
            levelKind: null,
          },
        ],
      }).problem,
    ).toBe('level_index_duplicate');
  });

  it('refuses invalid digitLength', () => {
    expect(
      planAccountingConfiguration({
        code: 'DEFAULT',
        name: 'Main',
        effectiveFrom: null,
        maxDepth: 1,
        levels: [
          {
            levelIndex: 1,
            title: 'A',
            digitLength: 0,
            defaultIsPostable: false,
            levelKind: null,
          },
        ],
      }).problem,
    ).toBe('digit_length_invalid');
  });

  it('refuses total code length over architecture cap', () => {
    const levels = Array.from({ length: 8 }, (_, i) => ({
      levelIndex: i + 1,
      title: `L${i + 1}`,
      digitLength: 5,
      defaultIsPostable: false,
      levelKind: null as string | null,
    }));
    expect(
      planAccountingConfiguration({
        code: 'DEFAULT',
        name: 'Main',
        effectiveFrom: null,
        maxDepth: 8,
        levels,
      }).problem,
    ).toBe('code_length_too_large');
  });

  it('allows any levelKind (configurable, not hardcoded)', () => {
    const plan = planAccountingConfiguration({
      code: 'DEFAULT',
      name: 'Main',
      effectiveFrom: null,
      maxDepth: 2,
      levels: [
        {
          levelIndex: 1,
          title: 'MyCustomGroup',
          digitLength: 2,
          defaultIsPostable: false,
          levelKind: 'my_custom_kind',
        },
        {
          levelIndex: 2,
          title: 'MyCustomDetail',
          digitLength: 3,
          defaultIsPostable: true,
          levelKind: 'another_kind',
        },
      ],
    });
    expect(plan.problem).toBeNull();
  });

  it('bounds levelKind by the stored column width — 20 accepted, 21 and 64 refused', () => {
    // The boundary is `MAX_LEVEL_KIND_LENGTH` = the declared width of
    // `accounting_configuration_levels.level_kind` (see the migration and the
    // Prisma schema). A longer value is REFUSED, never truncated.
    expect(MAX_LEVEL_KIND_LENGTH).toBe(20);

    const plan = (levelKind: string | null) =>
      planAccountingConfiguration({
        code: 'DEFAULT',
        name: 'Main',
        effectiveFrom: null,
        maxDepth: 1,
        levels: [
          {
            levelIndex: 1,
            title: 'Group',
            digitLength: 2,
            defaultIsPostable: false,
            levelKind,
          },
        ],
      });

    const twenty = 'k'.repeat(20);
    const twentyOne = 'k'.repeat(21);
    const sixtyFour = 'k'.repeat(64);

    expect(plan(twenty).problem).toBeNull();
    expect(plan(twentyOne).problem).toBe('level_kind_too_long');
    expect(plan(sixtyFour).problem).toBe('level_kind_too_long');
    // The refusal carries the offending level, so a caller can point at it.
    expect(plan(twentyOne).subject).toBe('1');
    // Blank (but not null) kinds are still refused as invalid, not as long.
    expect(plan('   ').problem).toBe('level_kind_invalid');
    expect(plan(null).problem).toBeNull();
  });

  it('enforces status transition rules', () => {
    expect(
      planConfigurationTransition({
        from: 'DRAFT',
        to: 'ACTIVE',
        isOperationallyUsed: false,
      }).problem,
    ).toBeNull();
    expect(
      planConfigurationTransition({
        from: 'ACTIVE',
        to: 'SUPERSEDED',
        isOperationallyUsed: false,
      }).problem,
    ).toBeNull();
    expect(
      planConfigurationTransition({
        from: 'ACTIVE',
        to: 'SUPERSEDED',
        isOperationallyUsed: true,
      }).problem,
    ).toBeNull();
    expect(
      planConfigurationTransition({
        from: 'DRAFT',
        to: 'SUPERSEDED',
        isOperationallyUsed: false,
      }).problem,
    ).toBe('invalid_transition');
    expect(
      planConfigurationTransition({
        from: 'ACTIVE',
        to: 'DRAFT',
        isOperationallyUsed: false,
      }).problem,
    ).toBe('invalid_transition');
    expect(
      planConfigurationTransition({
        from: 'SUPERSEDED',
        to: 'ACTIVE',
        isOperationallyUsed: false,
      }).problem,
    ).toBe('invalid_transition');
  });

  it('enforces delete and mutate guards', () => {
    // Only DRAFT not used can be deleted
    expect(
      canDeleteConfiguration({ status: 'DRAFT', isOperationallyUsed: false }),
    ).toBe(true);
    expect(
      canDeleteConfiguration({ status: 'DRAFT', isOperationallyUsed: true }),
    ).toBe(false);
    expect(
      canDeleteConfiguration({ status: 'ACTIVE', isOperationallyUsed: false }),
    ).toBe(false);
    expect(
      canDeleteConfiguration({
        status: 'SUPERSEDED',
        isOperationallyUsed: false,
      }),
    ).toBe(false);

    // Only DRAFT not used can be destructively mutated
    expect(
      canDestructivelyMutate({ status: 'DRAFT', isOperationallyUsed: false }),
    ).toBe(true);
    expect(
      canDestructivelyMutate({ status: 'DRAFT', isOperationallyUsed: true }),
    ).toBe(false);
    expect(
      canDestructivelyMutate({ status: 'ACTIVE', isOperationallyUsed: false }),
    ).toBe(false);
    expect(
      canDestructivelyMutate({
        status: 'SUPERSEDED',
        isOperationallyUsed: false,
      }),
    ).toBe(false);
  });

  it('resolves freeze state', () => {
    expect(
      resolveFreezeState({ status: 'DRAFT', operationallyUsedAt: null }),
    ).toBe('mutable');
    expect(
      resolveFreezeState({ status: 'ACTIVE', operationallyUsedAt: null }),
    ).toBe('frozen_active');
    expect(
      resolveFreezeState({ status: 'DRAFT', operationallyUsedAt: new Date() }),
    ).toBe('frozen_used');
    expect(
      resolveFreezeState({ status: 'ACTIVE', operationallyUsedAt: new Date() }),
    ).toBe('frozen_used');
    expect(
      resolveFreezeState({ status: 'SUPERSEDED', operationallyUsedAt: null }),
    ).toBe('superseded');
    expect(
      resolveFreezeState({
        status: 'SUPERSEDED',
        operationallyUsedAt: new Date(),
      }),
    ).toBe('superseded');
  });

  it('isConfigurationFrozen', () => {
    expect(
      isConfigurationFrozen({ status: 'DRAFT', operationallyUsedAt: null }),
    ).toBe(false);
    expect(
      isConfigurationFrozen({ status: 'ACTIVE', operationallyUsedAt: null }),
    ).toBe(true);
    expect(
      isConfigurationFrozen({
        status: 'DRAFT',
        operationallyUsedAt: new Date(),
      }),
    ).toBe(true);
  });

  it('accepts effectiveFrom as Date or null', () => {
    expect(
      planAccountingConfiguration({
        code: 'DEFAULT',
        name: 'Main',
        effectiveFrom: new Date(),
        maxDepth: 1,
        levels: [
          {
            levelIndex: 1,
            title: 'A',
            digitLength: 2,
            defaultIsPostable: false,
            levelKind: null,
          },
        ],
      }).problem,
    ).toBeNull();
    expect(
      planAccountingConfiguration({
        code: 'DEFAULT',
        name: 'Main',
        effectiveFrom: null,
        maxDepth: 1,
        levels: [
          {
            levelIndex: 1,
            title: 'A',
            digitLength: 2,
            defaultIsPostable: false,
            levelKind: null,
          },
        ],
      }).problem,
    ).toBeNull();
  });

  it('refuses blank level title', () => {
    expect(
      planAccountingConfiguration({
        code: 'DEFAULT',
        name: 'Main',
        effectiveFrom: null,
        maxDepth: 1,
        levels: [
          {
            levelIndex: 1,
            title: '   ',
            digitLength: 2,
            defaultIsPostable: false,
            levelKind: null,
          },
        ],
      }).problem,
    ).toBe('level_title_invalid');
  });

  it('pattern description is configurable, not hardcoded 1=Assets etc', () => {
    // The pattern is derived from digitLengths, not from level semantics
    const plan = planAccountingConfiguration({
      code: 'CUSTOM',
      name: 'Custom',
      effectiveFrom: null,
      maxDepth: 3,
      levels: [
        {
          levelIndex: 1,
          title: 'My Group',
          digitLength: 1,
          defaultIsPostable: false,
          levelKind: 'custom_group',
        },
        {
          levelIndex: 2,
          title: 'My Subgroup',
          digitLength: 2,
          defaultIsPostable: false,
          levelKind: 'custom_subgroup',
        },
        {
          levelIndex: 3,
          title: 'My Detail',
          digitLength: 4,
          defaultIsPostable: true,
          levelKind: 'custom_detail',
        },
      ],
    });
    expect(plan.problem).toBeNull();
  });
});
