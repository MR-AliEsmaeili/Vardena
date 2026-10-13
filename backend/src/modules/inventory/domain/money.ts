/**
 * Exact decimal MONEY for inventory valuation (PDR-05, ADR-0039).
 *
 * The money counterpart of `quantities.ts`. Values travel as decimal STRINGS
 * end to end — API, domain, database — and are never held in a binary float.
 * `numeric(18,2)` is the storage type for value (docs/database-strategy.md §6,
 * OQ-03's interim precision); all arithmetic here is exact, on BigInt
 * mantissas with explicit scales.
 *
 * ROUNDING — the one place it exists, and why.
 *
 * Quantities never round (OQ-29: an inexact conversion is REJECTED). Value
 * cannot follow that rule: a Moving Weighted Average issue is
 * `total_value × issued ÷ valued_quantity`, and that division almost never
 * lands on two decimals. Refusing to round would make the only approved MVP
 * method unusable, and rounding silently in several places would make
 * `SUM(total_cost)` drift away from the stored state. So:
 *
 *   * `roundToMoneyScale` is the SINGLE rounding primitive (half-up on the
 *     absolute value, sign preserved — the ordinary commercial rule);
 *   * it is applied ONLY when an issue value is derived from an average
 *     (`moving-weighted-average.ts`), never to an amount a human entered —
 *     an entered amount that does not fit `numeric(18,2)` exactly is
 *     REJECTED, exactly like an inexact quantity conversion;
 *   * the rounding residual stays in the state: the state's `total_value` is
 *     reduced by precisely the rounded amount that was assigned to the
 *     movement, so `SUM(total_cost)` and the state can never disagree;
 *   * when a key's valued quantity reaches exactly zero, the closing issue
 *     absorbs the whole remaining value, so zero quantity always means zero
 *     value — no residual value can survive with no stock behind it.
 *
 * `divideToScale` exists only for PRESENTATION (a per-unit figure derived
 * from an authoritative value). Nothing derived by it is ever stored.
 *
 * Framework-free (AR-05).
 */

/** `numeric(18,2)`: 18 digits total, 2 after the point → 16 before it. */
export const MONEY_INTEGER_DIGITS = 16;
export const MONEY_FRACTION_DIGITS = 2;

/** Scale used for a DERIVED per-unit figure (presentation only). */
export const UNIT_COST_DISPLAY_DIGITS = 6;

/** Largest magnitude storable in `numeric(18,2)`. */
const MAX_MONEY_SCALED =
  10n ** BigInt(MONEY_INTEGER_DIGITS + MONEY_FRACTION_DIGITS) - 1n;

/**
 * An entered amount as the API accepts it: 1–16 integer digits, optional
 * fraction of 1–2 digits, no sign, no exponent, no whitespace.
 */
const ENTERED_AMOUNT_PATTERN = /^\d{1,16}(\.\d{1,2})?$/;

export type MoneyProblem = 'malformed' | 'not_positive' | 'exceeds_precision';

/** Parsed exact decimal: signed mantissa + count of fractional digits. */
interface ScaledDecimal {
  mantissa: bigint;
  scale: number;
}

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

function requireParsed(value: string, operation: string): ScaledDecimal {
  const parsed = parseDecimal(value);
  if (parsed === null) {
    throw new Error(`Cannot ${operation} malformed decimal "${value}".`);
  }
  return parsed;
}

/** True when `value` is a well-formed entered amount (shape only). */
export function isAmountString(value: string): boolean {
  return ENTERED_AMOUNT_PATTERN.test(value);
}

/**
 * True when `value` fits `numeric(18,2)` EXACTLY: at most two fractional
 * digits once trailing zeros are trimmed, and a magnitude below 10^16.
 */
export function fitsMoney(value: string): boolean {
  const parsed = parseDecimal(value);
  if (parsed === null) return false;
  const canonical = renderDecimal(parsed.mantissa, parsed.scale);
  const fraction = canonical.includes('.')
    ? (canonical.split('.')[1] ?? '')
    : '';
  if (fraction.length > MONEY_FRACTION_DIGITS) return false;
  const magnitude = parsed.mantissa < 0n ? -parsed.mantissa : parsed.mantissa;
  const scaledTo2 =
    parsed.scale <= MONEY_FRACTION_DIGITS
      ? magnitude * 10n ** BigInt(MONEY_FRACTION_DIGITS - parsed.scale)
      : magnitude / 10n ** BigInt(parsed.scale - MONEY_FRACTION_DIGITS);
  return scaledTo2 <= MAX_MONEY_SCALED;
}

/**
 * Validate an amount a USER entered (a cost supplied with an inbound
 * document). Fail-closed on precision: an entered amount is never rounded.
 */
export function validateEnteredAmount(value: string): MoneyProblem | null {
  if (!isAmountString(value)) return 'malformed';
  if (compareMoney(value, '0') <= 0) return 'not_positive';
  if (!fitsMoney(value)) return 'exceeds_precision';
  return null;
}

export function moneyProblemMessage(problem: MoneyProblem): string {
  switch (problem) {
    case 'malformed':
      return 'Cost must be a positive decimal with at most 16 integer digits and 2 decimal places.';
    case 'not_positive':
      return 'Cost must be greater than zero.';
    case 'exceeds_precision':
      return (
        'The cost needs more than 2 decimal places or exceeds the supported magnitude. ' +
        'Entered amounts are never rounded, so the value is rejected instead.'
      );
  }
}

/** Canonical form of any well-formed decimal (`3.50` → `3.5`, `-0` → `0`). */
export function canonicalizeMoney(value: string): string {
  const parsed = requireParsed(value, 'canonicalize');
  return renderDecimal(parsed.mantissa, parsed.scale);
}

/** Exact three-way comparison of two well-formed decimals. */
export function compareMoney(left: string, right: string): -1 | 0 | 1 {
  const a = requireParsed(left, 'compare');
  const b = requireParsed(right, 'compare');
  const scale = Math.max(a.scale, b.scale);
  const scaledA = a.mantissa * 10n ** BigInt(scale - a.scale);
  const scaledB = b.mantissa * 10n ** BigInt(scale - b.scale);
  if (scaledA < scaledB) return -1;
  if (scaledA > scaledB) return 1;
  return 0;
}

/** Exact signed addition, canonical result. */
export function addMoney(left: string, right: string): string {
  const a = requireParsed(left, 'add');
  const b = requireParsed(right, 'add');
  const scale = Math.max(a.scale, b.scale);
  const sum =
    a.mantissa * 10n ** BigInt(scale - a.scale) +
    b.mantissa * 10n ** BigInt(scale - b.scale);
  return renderDecimal(sum, scale);
}

/** Exact signed subtraction (`left − right`), canonical result. */
export function subtractMoney(left: string, right: string): string {
  const b = requireParsed(right, 'subtract');
  return addMoney(left, renderDecimal(-b.mantissa, b.scale));
}

/** Exact signed multiplication; the product keeps its full scale. */
export function multiplyMoney(left: string, right: string): string {
  const a = requireParsed(left, 'multiply');
  const b = requireParsed(right, 'multiply');
  return renderDecimal(a.mantissa * b.mantissa, a.scale + b.scale);
}

/** `|value|` as a canonical decimal string. */
export function absMoney(value: string): string {
  const parsed = requireParsed(value, 'negate');
  return renderDecimal(
    parsed.mantissa < 0n ? -parsed.mantissa : parsed.mantissa,
    parsed.scale,
  );
}

/** `−value` as a canonical decimal string (`-0` renders as `0`). */
export function negateMoney(value: string): string {
  const parsed = requireParsed(value, 'negate');
  return renderDecimal(-parsed.mantissa, parsed.scale);
}

/**
 * Half-up rounding of `value` to `scale` fractional digits, on the ABSOLUTE
 * value with the sign preserved (`-2.345` → `-2.35` at scale 2). Exported
 * for the valuation strategy and the presentation helpers only; see the file
 * header for where rounding is and is not allowed.
 */
export function roundHalfUp(value: string, scale: number): string {
  const parsed = requireParsed(value, 'round');
  if (parsed.scale <= scale) {
    return renderDecimal(
      parsed.mantissa * 10n ** BigInt(scale - parsed.scale),
      scale,
    );
  }
  const divisor = 10n ** BigInt(parsed.scale - scale);
  const negative = parsed.mantissa < 0n;
  const magnitude = negative ? -parsed.mantissa : parsed.mantissa;
  const quotient = magnitude / divisor;
  const remainder = magnitude % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  return renderDecimal(negative ? -rounded : rounded, scale);
}

/** Half-up rounding to the money scale (`numeric(18,2)`). */
export function roundToMoneyScale(value: string): string {
  return roundHalfUp(value, MONEY_FRACTION_DIGITS);
}

/**
 * `numerator ÷ denominator`, half-up at `scale`. PRESENTATION ONLY — nothing
 * produced here is ever stored or fed back into the valuation state.
 *
 * Returns `null` for a zero denominator (no average exists for zero
 * quantity), never a thrown error or a fabricated zero.
 */
export function divideToScale(
  numerator: string,
  denominator: string,
  scale: number,
): string | null {
  const a = requireParsed(numerator, 'divide');
  const b = requireParsed(denominator, 'divide');
  if (b.mantissa === 0n) return null;
  // Scale the numerator so the integer division already carries `scale + 1`
  // digits; the extra digit decides the half-up rounding.
  const shift = BigInt(scale + 1 + b.scale - a.scale);
  const scaledNumerator =
    shift >= 0n ? a.mantissa * 10n ** shift : a.mantissa / 10n ** (shift * -1n);
  const quotient = scaledNumerator / b.mantissa;
  return roundHalfUp(renderDecimal(quotient, scale + 1), scale);
}
