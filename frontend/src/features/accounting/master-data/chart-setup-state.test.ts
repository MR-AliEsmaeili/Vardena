import { describe, expect, it } from 'vitest';
import { classifyChartSetup, shapesCompatible } from './chart-setup-state';

const lvl = (digitLength: number, i = 0) => ({
  levelIndex: i + 1,
  title: `L${i + 1}`,
  digitLength,
  defaultIsPostable: i > 0,
});
const agg = (id: string, digits: number[]) =>
  ({ id, levels: digits.map((d, i) => lvl(d, i)) }) as never;

describe('classifyChartSetup initial-state matrix', () => {
  const cases: [string, Parameters<typeof classifyChartSetup>[0], string][] = [
    [
      'neither exists',
      {
        codingActive: null,
        configActive: null,
        codingDrafts: [],
        configDrafts: [],
      },
      'actionable',
    ],
    [
      'both active compatible',
      {
        codingActive: agg('c', [2, 3]),
        configActive: agg('k', [2, 3]),
        codingDrafts: [],
        configDrafts: [],
      },
      'ready',
    ],
    [
      'both active incompatible',
      {
        codingActive: agg('c', [2, 3]),
        configActive: agg('k', [4]),
        codingDrafts: [],
        configDrafts: [],
      },
      'blocked-incompatible',
    ],
    [
      'coding draft only → publish it, create config with its shape',
      {
        codingActive: null,
        configActive: null,
        codingDrafts: [agg('cd', [2, 3])],
        configDrafts: [],
      },
      'actionable',
    ],
    [
      'config draft only → publish it, create coding with its shape',
      {
        codingActive: null,
        configActive: null,
        codingDrafts: [],
        configDrafts: [agg('kd', [2, 3])],
      },
      'actionable',
    ],
    [
      'coding active only → create config, no coding action',
      {
        codingActive: agg('c', [2, 3]),
        configActive: null,
        codingDrafts: [],
        configDrafts: [],
      },
      'actionable',
    ],
    [
      'config active only → create coding, no config action',
      {
        codingActive: null,
        configActive: agg('k', [2, 3]),
        codingDrafts: [],
        configDrafts: [],
      },
      'actionable',
    ],
  ];
  it.each(cases)('%s', (_name, input, kind) => {
    expect(classifyChartSetup(input).kind).toBe(kind);
  });

  it('coding-active-only locks levels and requires no coding action', () => {
    const s = classifyChartSetup({
      codingActive: agg('c', [2, 3]),
      configActive: null,
      codingDrafts: [],
      configDrafts: [],
    });
    expect(s).toMatchObject({
      codingAction: 'none',
      configAction: 'create-and-publish',
    });
    expect(s.kind).toBe('actionable');
    const locked = s.kind === 'actionable' ? s.lockedLevels : null;
    expect(locked?.map((l) => l.digitLength)).toEqual([2, 3]);
  });

  it('reuses a matching draft and rejects a mismatched draft under a locked shape', () => {
    const s = classifyChartSetup({
      codingActive: agg('c', [2, 3]),
      configActive: null,
      codingDrafts: [],
      configDrafts: [agg('bad', [9]), agg('good', [2, 3])],
    });
    expect(s).toMatchObject({
      configAction: 'publish-draft',
      configDraftId: 'good',
    });
  });

  it('shapesCompatible follows backend digit-shape coherence only', () => {
    expect(shapesCompatible([lvl(2), lvl(3, 1)], [lvl(2), lvl(3, 1)])).toBe(
      true,
    );
    expect(shapesCompatible([lvl(2)], [lvl(2), lvl(3, 1)])).toBe(false);
    expect(shapesCompatible([lvl(4)], [lvl(2)])).toBe(false);
  });

  it('shapesCompatible matches planPinCoherence index semantics: an index gap is a mismatch even with equal positional digits', () => {
    // coding indices {1,3}, configuration indices {1,2} — same count and the
    // same sorted digit sequence, but the backend returns
    // 'coding_level_count_mismatch' because index 2 is absent from coding.
    const coding = [
      { levelIndex: 1, title: 'a', digitLength: 2, defaultIsPostable: false },
      { levelIndex: 3, title: 'b', digitLength: 3, defaultIsPostable: true },
    ];
    const config = [
      { levelIndex: 1, title: 'a', digitLength: 2, defaultIsPostable: false },
      { levelIndex: 2, title: 'b', digitLength: 3, defaultIsPostable: true },
    ];
    expect(shapesCompatible(coding, config)).toBe(false);
    expect(shapesCompatible(config, coding)).toBe(false);
  });
});
