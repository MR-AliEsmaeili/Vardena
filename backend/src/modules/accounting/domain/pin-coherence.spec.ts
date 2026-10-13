import { describe, expect, it } from 'vitest';
import {
  pinCoherenceProblemMessage,
  planPinCoherence,
  type PinCoherenceProblem,
} from './account.js';

/**
 * ODR-1 (Task 19) — the Explicit Coherence Rule decision table.
 *
 * The rule compares ONLY the code-shape projection of the two pinned roots
 * (level count + per-level digit length). Titles, level kinds and postability
 * defaults are deliberately outside the comparison: they belong to the
 * accounting configuration root and are not part of the "defined shape" the
 * pins must agree on. Repair of existing divergent rows is OQ-62/OQ-63 —
 * this table never decides repairs, only whether a WRITE may proceed.
 */

const coding = (...widths: number[]) =>
  widths.map((digitLength, i) => ({ levelIndex: i + 1, digitLength }));
const configuration = coding;

describe('planPinCoherence — ODR-1 Explicit Coherence Rule', () => {
  it('accepts two roots that describe the same code shape', () => {
    expect(
      planPinCoherence({
        codingLevels: coding(2, 3),
        configurationLevels: configuration(2, 3),
      }),
    ).toBeNull();
  });

  it('accepts both empty level sets (nothing pinned to disagree about)', () => {
    expect(
      planPinCoherence({ codingLevels: [], configurationLevels: [] }),
    ).toBeNull();
  });

  it('accepts deep shapes up to the shared maximum depth (8)', () => {
    const widths = [1, 2, 2, 2, 2, 2, 2, 2];
    expect(
      planPinCoherence({
        codingLevels: coding(...widths),
        configurationLevels: configuration(...widths),
      }),
    ).toBeNull();
  });

  it('accepts equal shapes regardless of order the levels are stored in', () => {
    expect(
      planPinCoherence({
        codingLevels: [
          { levelIndex: 2, digitLength: 3 },
          { levelIndex: 1, digitLength: 2 },
        ],
        configurationLevels: configuration(2, 3),
      }),
    ).toBeNull();
  });

  it('rejects a different number of levels (coding_level_count_mismatch)', () => {
    expect(
      planPinCoherence({
        codingLevels: coding(2, 3),
        configurationLevels: configuration(2, 3, 2),
      }),
    ).toBe('coding_level_count_mismatch');
    expect(
      planPinCoherence({
        codingLevels: coding(2),
        configurationLevels: configuration(2, 3),
      }),
    ).toBe('coding_level_count_mismatch');
  });

  it('rejects the same count with different level indices (coding_level_count_mismatch)', () => {
    expect(
      planPinCoherence({
        codingLevels: [
          { levelIndex: 1, digitLength: 2 },
          { levelIndex: 3, digitLength: 3 },
        ],
        configurationLevels: configuration(2, 3),
      }),
    ).toBe('coding_level_count_mismatch');
  });

  it('rejects a per-level digit-length disagreement (coding_digit_length_mismatch)', () => {
    expect(
      planPinCoherence({
        codingLevels: coding(2, 2),
        configurationLevels: configuration(2, 3),
      }),
    ).toBe('coding_digit_length_mismatch');
  });

  it('reports the first disagreeing level as a digit-length problem, not a count problem', () => {
    // Counts agree; index sets agree; only the width of level 2 differs.
    expect(
      planPinCoherence({
        codingLevels: coding(2, 2, 4),
        configurationLevels: configuration(2, 3, 4),
      }),
    ).toBe('coding_digit_length_mismatch');
  });

  it('fails closed: an empty coding half against a non-empty configuration half is a mismatch', () => {
    expect(
      planPinCoherence({
        codingLevels: [],
        configurationLevels: configuration(2, 3),
      }),
    ).toBe('coding_level_count_mismatch');
  });
});

describe('pinCoherenceProblemMessage — AR-24 messages', () => {
  const problems: PinCoherenceProblem[] = [
    'coding_level_count_mismatch',
    'coding_digit_length_mismatch',
  ];

  it('returns a non-empty, distinct, actionable message per problem', () => {
    const messages = problems.map((problem) =>
      pinCoherenceProblemMessage(problem),
    );
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
      expect(message).toMatch(/\./);
    }
    expect(new Set(messages).size).toBe(problems.length);
  });

  it('names the remedy (publish a coherent pair), never a silent pin choice', () => {
    for (const problem of problems) {
      expect(pinCoherenceProblemMessage(problem)).toMatch(/coherent pair/i);
    }
  });
});
