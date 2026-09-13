import { describe, expect, it } from 'vitest';
import {
  planNewVersion,
  resolveVersionAt,
  windowsOverlap,
  type ConversionWindow,
} from './unit-conversion.js';

/**
 * Unit conversion versioning (D-26, master-data-strategy.md §3.4, OQ-29).
 *
 * The rule under test is "used configuration is never edited in place": a
 * change is a NEW effective-dated version, and the only rewrite allowed is
 * closing an open-ended version at the moment the next one starts.
 */

const D = (iso: string): Date => new Date(iso);
const JAN = D('2026-01-01T00:00:00Z');
const FEB = D('2026-02-01T00:00:00Z');
const MAR = D('2026-03-01T00:00:00Z');
const APR = D('2026-04-01T00:00:00Z');

function window(
  validFrom: Date,
  validTo: Date | null = null,
): ConversionWindow {
  return { validFrom, validTo };
}

describe('windowsOverlap', () => {
  it('treats the window as half-open, so touching edges do not overlap', () => {
    // [JAN, FEB) and [FEB, MAR) are adjacent, not overlapping — this is what
    // makes "close the old at the new validFrom" produce a gapless history.
    expect(windowsOverlap(window(JAN, FEB), window(FEB, MAR))).toBe(false);
    expect(windowsOverlap(window(FEB, MAR), window(JAN, FEB))).toBe(false);
  });

  it('detects a genuine intersection', () => {
    expect(windowsOverlap(window(JAN, MAR), window(FEB, APR))).toBe(true);
    expect(windowsOverlap(window(FEB, APR), window(JAN, MAR))).toBe(true);
  });

  it('treats an open-ended version as extending forever', () => {
    expect(windowsOverlap(window(JAN, null), window(APR, null))).toBe(true);
  });

  it('detects containment in either direction', () => {
    expect(windowsOverlap(window(JAN, APR), window(FEB, MAR))).toBe(true);
    expect(windowsOverlap(window(FEB, MAR), window(JAN, APR))).toBe(true);
  });

  it('reports no overlap for a zero-length candidate window', () => {
    expect(windowsOverlap(window(JAN, JAN), window(JAN, APR))).toBe(false);
  });
});

describe('planNewVersion', () => {
  it('inserts freely when no version exists for the pair', () => {
    expect(planNewVersion({ candidate: window(JAN), existing: [] })).toEqual({
      problem: null,
      supersededId: null,
    });
  });

  it('rejects a window that ends at or before it starts', () => {
    expect(
      planNewVersion({
        candidate: window(FEB, JAN),
        existing: [],
      }).problem,
    ).toBe('invalid_window');
    expect(
      planNewVersion({
        candidate: window(FEB, FEB),
        existing: [],
      }).problem,
    ).toBe('invalid_window');
  });

  it('supersedes the open-ended version when a later open-ended one arrives', () => {
    const plan = planNewVersion({
      candidate: window(FEB),
      existing: [{ id: 'v1', validFrom: JAN, validTo: null }],
    });
    expect(plan).toEqual({ problem: null, supersededId: 'v1' });
  });

  it('does not supersede when the new version starts earlier than the existing one', () => {
    // Back-dating into an existing open-ended version would silently rewrite
    // history that documents may already have resolved against.
    expect(
      planNewVersion({
        candidate: window(JAN),
        existing: [{ id: 'v1', validFrom: FEB, validTo: null }],
      }),
    ).toEqual({ problem: 'overlapping_version', supersededId: null });
  });

  it('does not supersede when the new version is bounded', () => {
    // Splitting the old version and "reverting after validTo" is an invented
    // business rule, so a bounded version inside an open-ended one is rejected.
    expect(
      planNewVersion({
        candidate: window(FEB, MAR),
        existing: [{ id: 'v1', validFrom: JAN, validTo: null }],
      }),
    ).toEqual({ problem: 'overlapping_version', supersededId: null });
  });

  it('rejects an overlap against an already-closed version', () => {
    expect(
      planNewVersion({
        candidate: window(JAN, MAR),
        existing: [{ id: 'v1', validFrom: JAN, validTo: FEB }],
      }),
    ).toEqual({ problem: 'overlapping_version', supersededId: null });
  });

  it('rejects when more than one version overlaps', () => {
    // Two overlapping versions means the history is already ambiguous; the
    // service must not pick one to close.
    expect(
      planNewVersion({
        candidate: window(FEB),
        existing: [
          { id: 'v1', validFrom: JAN, validTo: MAR },
          { id: 'v2', validFrom: FEB, validTo: APR },
        ],
      }).problem,
    ).toBe('overlapping_version');
  });

  it('accepts a version placed entirely after a closed history', () => {
    expect(
      planNewVersion({
        candidate: window(APR),
        existing: [{ id: 'v1', validFrom: JAN, validTo: FEB }],
      }),
    ).toEqual({ problem: null, supersededId: null });
  });

  it('accepts a bounded version that exactly fills a gap', () => {
    expect(
      planNewVersion({
        candidate: window(FEB, MAR),
        existing: [
          { id: 'v1', validFrom: JAN, validTo: FEB },
          { id: 'v3', validFrom: MAR, validTo: APR },
        ],
      }),
    ).toEqual({ problem: null, supersededId: null });
  });
});

describe('resolveVersionAt', () => {
  const versions = [
    { id: 'v1', validFrom: JAN, validTo: FEB },
    { id: 'v2', validFrom: FEB, validTo: MAR },
    { id: 'v3', validFrom: MAR, validTo: null },
  ];

  it('returns the version in force at the instant', () => {
    expect(resolveVersionAt(versions, D('2026-02-15T00:00:00Z'))?.id).toBe(
      'v2',
    );
    expect(resolveVersionAt(versions, D('2027-01-01T00:00:00Z'))?.id).toBe(
      'v3',
    );
  });

  it('treats validFrom as inclusive', () => {
    expect(resolveVersionAt(versions, FEB)?.id).toBe('v2');
  });

  it('treats validTo as exclusive', () => {
    // At exactly FEB the old version is already closed.
    expect(resolveVersionAt(versions, FEB)?.id).not.toBe('v1');
  });

  it('returns the historical version for a past date, not the current one', () => {
    // This is the whole point of effective dating: a document dated in January
    // must resolve January's factor.
    expect(resolveVersionAt(versions, D('2026-01-20T00:00:00Z'))?.id).toBe(
      'v1',
    );
  });

  it('returns null when no version covers the instant', () => {
    // Never a silent 1:1 — that would be an invented conversion rule.
    expect(resolveVersionAt(versions, D('2025-01-01T00:00:00Z'))).toBe(null);
  });

  it('returns null for an empty history', () => {
    expect(resolveVersionAt([], JAN)).toBe(null);
  });

  it('is deterministic when given overlapping data it should never receive', () => {
    // Overlaps are rejected on write; if corrupt data ever appears, the latest
    // validFrom wins rather than the answer depending on row order.
    const ambiguous = [
      { id: 'older', validFrom: JAN, validTo: null },
      { id: 'newer', validFrom: FEB, validTo: null },
    ];
    expect(resolveVersionAt(ambiguous, MAR)?.id).toBe('newer');
    expect(resolveVersionAt([...ambiguous].reverse(), MAR)?.id).toBe('newer');
  });

  it('preserves the version object it returns', () => {
    const resolved = resolveVersionAt(versions, MAR);
    expect(resolved).toBe(versions[2]);
  });
});
