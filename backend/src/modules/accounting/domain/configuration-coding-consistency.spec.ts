import { describe, expect, it } from 'vitest';
import {
  MAX_LEVEL_KIND_LENGTH,
  planAccountingConfiguration,
} from './accounting-configuration.js';
import { planCodingStructure } from './coding-structure.js';

/**
 * Defect 2 — Configuration/Coding Definition consistency (Task 11).
 *
 * Task 11's invariant, as enforced after the remediation and per the
 * 2026-09-22 governance choice to keep OQ-62 OPEN, is:
 *
 *   Each definition is internally consistent on its own; the two pins
 *   (accounting_configuration_id D1 and coding_structure_version_id D2) are
 *   assigned together and inherited, but no cross-pin shape equality is
 *   enforced (OQ-62). The rehearsal's org-superseded-only fixture demonstrates
 *   the divergence: a 2+2 coding version vs a 2+3 LEGACY configuration.
 *
 * This spec proves that an INCOMPATIBLE (internally inconsistent) definition
 * cannot be created: the domain boundary refuses it, and the persistence
 * width (VARCHAR(20) for level_kind) would also refuse an overlong label
 * rather than truncating it. The test is mutation-oriented: removing the
 * domain check would make the test fail (the plan would return problem:null
 * and the levelKind would be accepted).
 */

function accountingLevels(
  levels: Array<{
    levelIndex: number;
    title: string;
    digitLength: number;
    levelKind?: string | null;
  }>,
) {
  return levels.map((l) => ({
    levelIndex: l.levelIndex,
    title: l.title,
    digitLength: l.digitLength,
    defaultIsPostable: false,
    levelKind: l.levelKind ?? null,
  }));
}

function codingLevels(
  levels: Array<{
    levelIndex: number;
    title: string;
    digitLength: number;
    levelKind?: string | null;
  }>,
) {
  return levels.map((l) => ({
    levelIndex: l.levelIndex,
    title: l.title,
    digitLength: l.digitLength,
    defaultIsPostable: false,
    levelKind: l.levelKind ?? null,
  }));
}

describe('Defect 2 — independent definitions cannot become internally inconsistent', () => {
  it('accounting configuration: refuses gap in level ordinals', () => {
    const plan = planAccountingConfiguration({
      code: 'DEFAULT',
      name: 'Main',
      effectiveFrom: null,
      maxDepth: 3,
      levels: accountingLevels([
        { levelIndex: 1, title: 'A', digitLength: 2 },
        { levelIndex: 3, title: 'C', digitLength: 2 },
      ]),
    });
    expect(plan.problem).toBe('level_index_gap');
    expect(plan.subject).toBe('2');
  });

  it('accounting configuration: refuses duplicate levelIndex', () => {
    const plan = planAccountingConfiguration({
      code: 'DEFAULT',
      name: 'Main',
      effectiveFrom: null,
      maxDepth: 2,
      levels: accountingLevels([
        { levelIndex: 1, title: 'A', digitLength: 2 },
        { levelIndex: 1, title: 'B', digitLength: 2 },
      ]),
    });
    expect(plan.problem).toBe('level_index_duplicate');
  });

  it('accounting configuration: refuses digit_length_invalid', () => {
    const plan = planAccountingConfiguration({
      code: 'DEFAULT',
      name: 'Main',
      effectiveFrom: null,
      maxDepth: 1,
      levels: accountingLevels([{ levelIndex: 1, title: 'A', digitLength: 0 }]),
    });
    expect(plan.problem).toBe('digit_length_invalid');
  });

  it('accounting configuration: refuses total code length over cap', () => {
    const levels = Array.from({ length: 8 }, (_, i) => ({
      levelIndex: i + 1,
      title: `L${i + 1}`,
      digitLength: 5,
      defaultIsPostable: false,
      levelKind: null as string | null,
    }));
    const plan = planAccountingConfiguration({
      code: 'DEFAULT',
      name: 'Main',
      effectiveFrom: null,
      maxDepth: 8,
      levels,
    });
    expect(plan.problem).toBe('code_length_too_large');
  });

  it('accounting configuration: refuses levelKind blank and too_long (20/21 boundary)', () => {
    const planBlank = planAccountingConfiguration({
      code: 'DEFAULT',
      name: 'Main',
      effectiveFrom: null,
      maxDepth: 1,
      levels: accountingLevels([
        { levelIndex: 1, title: 'A', digitLength: 2, levelKind: '   ' },
      ]),
    });
    expect(planBlank.problem).toBe('level_kind_invalid');

    const twenty = 'k'.repeat(MAX_LEVEL_KIND_LENGTH);
    const twentyOne = 'k'.repeat(MAX_LEVEL_KIND_LENGTH + 1);
    expect(
      planAccountingConfiguration({
        code: 'DEFAULT',
        name: 'Main',
        effectiveFrom: null,
        maxDepth: 1,
        levels: accountingLevels([
          { levelIndex: 1, title: 'A', digitLength: 2, levelKind: twenty },
        ]),
      }).problem,
    ).toBeNull();
    expect(
      planAccountingConfiguration({
        code: 'DEFAULT',
        name: 'Main',
        effectiveFrom: null,
        maxDepth: 1,
        levels: accountingLevels([
          { levelIndex: 1, title: 'A', digitLength: 2, levelKind: twentyOne },
        ]),
      }).problem,
    ).toBe('level_kind_too_long');
  });

  it('coding structure: refuses gap and duplicate independently', () => {
    expect(
      planCodingStructure({
        code: 'DEFAULT',
        maxDepth: 2,
        separator: '',
        levels: codingLevels([{ levelIndex: 1, title: 'A', digitLength: 2 }]),
      }).problem,
    ).toBe('level_index_gap');

    expect(
      planCodingStructure({
        code: 'DEFAULT',
        maxDepth: 2,
        separator: '',
        levels: codingLevels([
          { levelIndex: 1, title: 'A', digitLength: 2 },
          { levelIndex: 1, title: 'B', digitLength: 2 },
        ]),
      }).problem,
    ).toBe('level_index_duplicate');
  });

  it('coding structure: refuses level_kind outside closed list (independent vocabulary)', () => {
    // Accounting configurations accept any non-blank levelKind up to 20 chars
    // (informational), while coding structures only accept the closed
    // vocabulary group/general/subsidiary/detail. An incompatible coding
    // definition must be refused at the domain boundary, never silently
    // stored.
    const plan = planCodingStructure({
      code: 'DEFAULT',
      maxDepth: 1,
      separator: '',
      levels: codingLevels([
        {
          levelIndex: 1,
          title: 'A',
          digitLength: 2,
          levelKind: 'my_custom_kind',
        },
      ]),
    });
    expect(plan.problem).toBe('level_kind_invalid');
    expect(
      planCodingStructure({
        code: 'DEFAULT',
        maxDepth: 1,
        separator: '',
        levels: codingLevels([
          { levelIndex: 1, title: 'A', digitLength: 2, levelKind: 'detail' },
        ]),
      }).problem,
    ).toBeNull();
  });

  it('documents that cross-pin shape equality is NOT enforced (OQ-62 remains open)', () => {
    // Two level sets that describe different code shapes (2+2 vs 2+3) are
    // each internally consistent and therefore each accepted on its own.
    // An account pinning one of each would be internally inconsistent across
    // pins, but Task 11 deliberately does NOT enforce that today — it is
    // observable via the rehearsal's org-superseded-only fixture (2+2 version
    // vs 2+3 LEGACY configuration).
    const codingPlan = planCodingStructure({
      code: 'LEGACY',
      maxDepth: 2,
      separator: '',
      levels: codingLevels([
        { levelIndex: 1, title: 'Group', digitLength: 2, levelKind: 'group' },
        { levelIndex: 2, title: 'Detail', digitLength: 2, levelKind: 'detail' },
      ]),
    });
    const configPlan = planAccountingConfiguration({
      code: 'LEGACY',
      name: 'Legacy Accounting Configuration',
      effectiveFrom: null,
      maxDepth: 2,
      levels: accountingLevels([
        { levelIndex: 1, title: 'Group', digitLength: 2, levelKind: 'group' },
        { levelIndex: 2, title: 'Detail', digitLength: 3, levelKind: 'detail' },
      ]),
    });
    expect(codingPlan.problem).toBeNull();
    expect(configPlan.problem).toBeNull();
    // The fact that they differ is the OQ-62 divergence — no cross-check
    // refuses it here. A future task that resolves OQ-62 will add that check.
  });
});
