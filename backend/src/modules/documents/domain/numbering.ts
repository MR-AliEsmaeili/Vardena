/**
 * Numbering — the numeric-only serial model (Task 8 §11/§12).
 *
 * The serial is the human-facing number, NEVER the technical identity
 * (ADR-0008: identity is a ULID). It is NUMERIC ONLY: no prefixes, suffixes,
 * separators, letters or symbols — `140500001`, never `1405-00001`,
 * `1405/00001` or `INV-140500001`.
 *
 * What is configurable is the *strategy* that produces the serial, not its
 * character set. Task 8 implements exactly one strategy — `monotonic`, a
 * locked, never-reused counter — and leaves the seam open for the expert-gated
 * concepts (fiscal-year components, series, digit lengths, reset policy) that
 * OQ-12 gates. Number reuse is a per-series policy (`never` today); recycling
 * is NOT implemented because it is tied to document deletion, which lives in
 * the owning modules (Task 8 §12).
 *
 * Framework-free (AR-05).
 */

/** Storage width of a serial (`numbering_allocations.number`). */
export const MAX_SERIAL_LENGTH = 32;

/** Storage width of an allocation idempotency key. */
export const MAX_ALLOCATION_KEY_LENGTH = 128;

/** Zero-padding width is capped so a series can never produce absurd strings. */
export const MAX_NUMBERING_WIDTH = 32;

/** A serial is one or more decimal digits — and nothing else. */
const NUMERIC_SERIAL_PATTERN = /^\d+$/;

export function isNumericSerial(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_SERIAL_LENGTH &&
    NUMERIC_SERIAL_PATTERN.test(value)
  );
}

/** Parse a numeric serial into its exact integer value (null when invalid). */
export function parseSerial(value: string): bigint | null {
  if (!isNumericSerial(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * Render the next counter value as a serial. Zero-pads up to `width` digits;
 * never truncates a value wider than the width (a long serial stays whole —
 * truncation would produce duplicates).
 */
export function formatSerial(next: bigint, width: number): string {
  let digits = next.toString();
  if (width > 0 && digits.length < width) {
    digits = digits.padStart(width, '0');
  }
  return digits;
}

/** The closed, code-defined numbering strategies (extensible by code change). */
export const NUMBERING_STRATEGIES = ['monotonic'] as const;

export type NumberingStrategy = (typeof NUMBERING_STRATEGIES)[number];

export const DEFAULT_NUMBERING_STRATEGY = 'monotonic';

export function isNumberingStrategy(value: string): value is NumberingStrategy {
  return (NUMBERING_STRATEGIES as readonly string[]).includes(value);
}

/**
 * Compute the next counter value for a strategy. `monotonic` is the only
 * implemented strategy: `last + 1`. A future strategy (fiscal-year component,
 * per-period reset) plugs in here — the contract is
 * `(lastValue) => nextValue` and the caller holds the series row lock.
 */
export function nextSerialValue(
  lastValue: bigint,
  strategy: NumberingStrategy,
): bigint {
  switch (strategy) {
    case 'monotonic':
      return lastValue + 1n;
  }
}

/**
 * Reuse policy (Task 8 §12). The policy is stored per series so nothing is
 * hard-coded globally; `never` is the implemented behaviour and the default.
 * `recycle` is the documented seam for "a deletable document's serial may
 * become reusable" — it requires a document-deletion integration (owning
 * modules) and is NOT implemented in Task 8.
 */
export const NUMBERING_REUSE_POLICIES = ['never', 'recycle'] as const;

export type NumberingReusePolicy = (typeof NUMBERING_REUSE_POLICIES)[number];

export const DEFAULT_NUMBERING_REUSE_POLICY = 'never';

export function isNumberingReusePolicy(
  value: string,
): value is NumberingReusePolicy {
  return (NUMBERING_REUSE_POLICIES as readonly string[]).includes(value);
}

/** A scope key is the empty string (default series) or a lowercase token. */
const SCOPE_KEY_PATTERN = /^[a-z0-9_-]{0,64}$/;

export const MAX_SCOPE_KEY_LENGTH = 64;

export function isValidScopeKey(value: string): boolean {
  return SCOPE_KEY_PATTERN.test(value);
}

export function normalizeScopeKey(value: string | null | undefined): string {
  return value === undefined || value === null ? '' : value.trim();
}

export function isValidWidth(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_NUMBERING_WIDTH;
}

export const MAX_SERIES_NAME_LENGTH = 200;
