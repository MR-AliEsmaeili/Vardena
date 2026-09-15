/**
 * Exact money for accounting documents (Task 10.4, contract §13,
 * AC-D-18/AC-I-07/08; AR-12, docs/database-strategy.md §6).
 *
 * Money travels as decimal STRINGS end to end — API, domain, database — and is
 * never held in a binary float. `numeric(18,2)` is the storage type; all
 * arithmetic here is exact, implemented on BigInt mantissas with explicit
 * scales (the same shape `inventory/domain/quantities.ts` established for
 * quantities — a per-module copy, never a cross-module import: money and
 * quantity are different value objects with different scales and rules).
 *
 * Rounding policy (contract §13.5): there is NONE on this side of the ledger.
 * A client-supplied amount with more than two fractional digits is REJECTED
 * rather than silently rounded ("any rounding happens before the document is
 * composed … Accounting never rounds to force balance"), and the balance test
 * is exact with zero tolerance — no epsilon, no residual distribution.
 *
 * Sign policy (§13.2): amounts are non-negative. A "negative debit" is a
 * credit and must be written as one; corrections are counter-documents, never
 * sign flips. `validateEnteredAmount` therefore rejects a sign outright, and
 * `sumAmounts`/`compareAmounts` still work on signed values so a future
 * difference report can use them.
 *
 * Framework-free (AR-05): pure functions, unit-tested.
 */

/** `numeric(18,2)`: 18 digits total, 2 after the point → 16 before it. */
export const MONEY_INTEGER_DIGITS = 16;
export const MONEY_FRACTION_DIGITS = 2;
export const MONEY_SCALE = 10n ** BigInt(MONEY_FRACTION_DIGITS);

/**
 * The SHAPE of a client-supplied amount, as an HTTP-layer pattern: digits with
 * an optional `.` and at most two decimals, at most 16 integer digits —
 * exactly what `numeric(18,2)` stores. The API uses it for a 400 on an
 * unusable shape; the domain still decides meaning (non-negativity, precision,
 * the balance), because a pattern cannot tell a client what a line IS.
 */
export const MONEY_INPUT_PATTERN = /^\d{1,16}(\.\d{1,2})?$/;

/** Largest magnitude storable in `numeric(18,2)`: 9999999999999999.99. */
const MAX_AMOUNT_SCALED =
  10n ** BigInt(MONEY_INTEGER_DIGITS + MONEY_FRACTION_DIGITS) - 1n;

/**
 * An entered amount as the API accepts it: 1–16 integer digits, optional
 * fraction of 1–2 digits, no sign, no exponent, no whitespace.
 */
const ENTERED_AMOUNT_PATTERN = /^\d{1,16}(\.\d{1,2})?$/;

/** True when `value` is a well-formed entered amount (shape only). */
export function isAmountString(value: string): boolean {
  return ENTERED_AMOUNT_PATTERN.test(value);
}

export type MoneyProblem = 'malformed' | 'exceeds_precision';

/**
 * Validate an entered amount (API shape + storage precision in one place, so
 * every caller produces the same message).
 *
 * A negative amount is `malformed` on purpose — the shape carries the rule
 * (§13.2: the side comes from the column, never from a sign).
 */
export function validateEnteredAmount(value: string): MoneyProblem | null {
  if (!isAmountString(value)) return 'malformed';
  // The regex already caps integer digits; the scaled magnitude check is the
  // belt-and-braces proof that the value fits `numeric(18,2)` exactly.
  const parsed = parseDecimal(value);
  if (parsed === null) return 'malformed';
  const scaled =
    parsed.mantissa * 10n ** BigInt(MONEY_FRACTION_DIGITS - parsed.scale);
  if (scaled > MAX_AMOUNT_SCALED) return 'exceeds_precision';
  return null;
}

export function moneyProblemMessage(problem: MoneyProblem): string {
  switch (problem) {
    case 'malformed':
      return (
        'Amounts must be non-negative decimals with at most 16 integer digits ' +
        'and 2 decimal places (a negative amount is stored as the opposite side, ' +
        'never as a sign).'
      );
    case 'exceeds_precision':
      return 'The amount does not fit numeric(18,2).';
  }
}

/** Parsed exact decimal: signed mantissa + count of fractional digits. */
interface ScaledDecimal {
  mantissa: bigint;
  scale: number;
}

/**
 * Parse a plain decimal literal (`-12.50`, `3`, `0.01`). Returns null for
 * anything else — no exponents, no whitespace, no plus sign.
 */
function parseDecimal(value: string): ScaledDecimal | null {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value);
  if (match === null) return null;
  const [, sign, integer = '', fraction = ''] = match;
  const digits = `${integer}${fraction}`.replace(/^0+(?=\d)/, '');
  const mantissa = BigInt(digits === '' ? '0' : digits);
  return {
    mantissa: sign === '-' ? -mantissa : mantissa,
    scale: fraction.length,
  };
}

/** Render a scaled decimal canonically: no trailing zeros, `-0` → `0`. */
function renderDecimal(mantissa: bigint, scale: number): string {
  if (mantissa === 0n) return '0';
  const negative = mantissa < 0n;
  let digits = (negative ? -mantissa : mantissa).toString();
  let rendered: string;
  if (scale === 0) {
    rendered = digits;
  } else {
    digits = digits.padStart(scale + 1, '0');
    const head = digits.slice(0, digits.length - scale);
    const tail = digits.slice(digits.length - scale).replace(/0+$/, '');
    rendered = tail === '' ? head : `${head}.${tail}`;
  }
  return negative ? `-${rendered}` : rendered;
}

/**
 * Canonical form of any well-formed decimal: `12.50` → `12.5`, `0.00` → `0`.
 * Used for idempotency hashing and drift-proof comparisons, so two spellings
 * of one value never count as different. Throws on malformed input
 * (programmer error — validated values reach this point).
 */
export function canonicalizeAmount(value: string): string {
  const parsed = parseDecimal(value);
  if (parsed === null) {
    throw new Error(`Cannot canonicalize malformed amount "${value}".`);
  }
  return renderDecimal(parsed.mantissa, parsed.scale);
}

/** True when the amount is exactly zero (`0`, `0.0`, `0.00`). */
export function isZeroAmount(value: string): boolean {
  const parsed = parseDecimal(value);
  if (parsed === null) {
    throw new Error(`Cannot test malformed amount "${value}".`);
  }
  return parsed.mantissa === 0n;
}

/** Exact three-way comparison of two well-formed amounts. */
export function compareAmounts(left: string, right: string): -1 | 0 | 1 {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  if (a === null || b === null) {
    throw new Error('Cannot compare malformed amounts.');
  }
  const scale = Math.max(a.scale, b.scale);
  const scaledA = a.mantissa * 10n ** BigInt(scale - a.scale);
  const scaledB = b.mantissa * 10n ** BigInt(scale - b.scale);
  if (scaledA < scaledB) return -1;
  if (scaledA > scaledB) return 1;
  return 0;
}

/** True when both amounts are the same exact value (any spelling). */
export function amountsEqual(left: string, right: string): boolean {
  return compareAmounts(left, right) === 0;
}

/**
 * Exact sum of amounts, canonical result. An empty list sums to `'0'` — the
 * neutral value the balance check compares against.
 */
export function sumAmounts(values: readonly string[]): string {
  const parsedValues = values.map((value) => {
    const parsed = parseDecimal(value);
    if (parsed === null) {
      throw new Error('Cannot sum malformed amounts.');
    }
    return parsed;
  });
  // One common scale for every term, so no digit is ever dropped.
  const scale = parsedValues.reduce(
    (widest, parsed) => Math.max(widest, parsed.scale),
    0,
  );
  let total = 0n;
  for (const parsed of parsedValues) {
    total += parsed.mantissa * 10n ** BigInt(scale - parsed.scale);
  }
  return renderDecimal(total, scale);
}
