/**
 * Exact decimal quantities for the inventory core (Task 7, ADR-0022).
 *
 * Quantities travel as decimal STRINGS end to end — API, domain, database —
 * and are never held in a binary float. `numeric(18,4)` is the storage type
 * (docs/database-strategy.md §6, AR-12); conversion factors are
 * `numeric(18,6)` and carried as strings since Task 6. All arithmetic here is
 * exact, implemented on BigInt mantissas with explicit scales.
 *
 * Rounding policy (OQ-29): there is none. A conversion whose exact product
 * does not fit `numeric(18,4)` is REJECTED, not rounded — inventing a rounding
 * rule is exactly what OQ-29 forbids. `fitsQuantity` is the fail-closed gate.
 *
 * Framework-free (AR-05).
 */

/** `numeric(18,4)`: 18 digits total, 4 after the point → 14 before it. */
export const QUANTITY_INTEGER_DIGITS = 14;
export const QUANTITY_FRACTION_DIGITS = 4;
export const QUANTITY_SCALE = 10n ** BigInt(QUANTITY_FRACTION_DIGITS);

/** Largest magnitude storable in `numeric(18,4)`: 99999999999999.9999. */
const MAX_QUANTITY_SCALED =
  10n ** BigInt(QUANTITY_INTEGER_DIGITS + QUANTITY_FRACTION_DIGITS) - 1n;

/**
 * An entered quantity as the API accepts it: 1–14 integer digits, optional
 * fraction of 1–4 digits, no sign, no exponent, no whitespace.
 */
const ENTERED_QUANTITY_PATTERN = /^\d{1,14}(\.\d{1,4})?$/;

/** True when `value` is a well-formed entered quantity (shape only). */
export function isQuantityString(value: string): boolean {
  return ENTERED_QUANTITY_PATTERN.test(value);
}

/** True when `value` is a well-formed quantity with a POSITIVE value. */
export function isPositiveQuantityString(value: string): boolean {
  return isQuantityString(value) && compareDecimalStrings(value, '0') > 0;
}

export type QuantityProblem =
  'malformed' | 'not_positive' | 'exceeds_precision';

/**
 * Validate an entered quantity (API shape + domain value in one place so the
 * message is stable for every caller).
 */
export function validateEnteredQuantity(value: string): QuantityProblem | null {
  if (!isQuantityString(value)) return 'malformed';
  if (compareDecimalStrings(value, '0') <= 0) return 'not_positive';
  return null;
}

export function quantityProblemMessage(problem: QuantityProblem): string {
  switch (problem) {
    case 'malformed':
      return 'Quantity must be a positive decimal with at most 14 integer digits and 4 decimal places.';
    case 'not_positive':
      return 'Quantity must be greater than zero.';
    case 'exceeds_precision':
      return (
        'The converted base quantity needs more than 4 decimal places. ' +
        'Rounding rules are undecided (OQ-29), so the quantity is rejected instead of rounded.'
      );
  }
}

/** Parsed exact decimal: signed mantissa + count of fractional digits. */
interface ScaledDecimal {
  mantissa: bigint;
  scale: number;
}

/**
 * Parse a plain decimal literal (`-12.50`, `3`, `0.0001`). Returns null for
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

/** Render a scaled decimal in canonical form: no trailing zeros, `-0` → `0`. */
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
 * Canonical form of any well-formed decimal: `3.50` → `3.5`, `0.0000` → `0`,
 * `-0` → `0`. Used for idempotency hashing and drift-proof comparisons, so
 * that two spellings of one value never count as different.
 */
export function canonicalizeDecimal(value: string): string {
  const parsed = parseDecimal(value);
  if (parsed === null) {
    throw new Error(`Cannot canonicalize malformed decimal "${value}".`);
  }
  return renderDecimal(parsed.mantissa, parsed.scale);
}

/**
 * Exact three-way comparison of two well-formed decimals. Throws on malformed
 * input (programmer error — validated values reach this point).
 */
export function compareDecimalStrings(left: string, right: string): -1 | 0 | 1 {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  if (a === null || b === null) {
    throw new Error('Cannot compare malformed decimals.');
  }
  const scale = Math.max(a.scale, b.scale);
  const scaledA = a.mantissa * 10n ** BigInt(scale - a.scale);
  const scaledB = b.mantissa * 10n ** BigInt(scale - b.scale);
  if (scaledA < scaledB) return -1;
  if (scaledA > scaledB) return 1;
  return 0;
}

/** Exact signed addition of two well-formed decimals, canonical result. */
export function addDecimalStrings(left: string, right: string): string {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  if (a === null || b === null) {
    throw new Error('Cannot add malformed decimals.');
  }
  const scale = Math.max(a.scale, b.scale);
  const sum =
    a.mantissa * 10n ** BigInt(scale - a.scale) +
    b.mantissa * 10n ** BigInt(scale - b.scale);
  return renderDecimal(sum, scale);
}

/** Exact signed subtraction (`left − right`), canonical result. */
export function subtractDecimalStrings(left: string, right: string): string {
  const b = parseDecimal(right);
  if (b === null) throw new Error('Cannot subtract malformed decimals.');
  const negated = renderDecimal(-b.mantissa, b.scale);
  return addDecimalStrings(left, negated);
}

/**
 * Exact signed multiplication of two well-formed decimals, canonical result.
 * The product keeps its full scale here — fitting it into `numeric(18,4)` is
 * the caller's explicit `fitsQuantity` check, never silent rounding.
 */
export function multiplyDecimalStrings(left: string, right: string): string {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  if (a === null || b === null) {
    throw new Error('Cannot multiply malformed decimals.');
  }
  return renderDecimal(a.mantissa * b.mantissa, a.scale + b.scale);
}

/**
 * True when `value` fits `numeric(18,4)` exactly: at most 4 fractional digits
 * (after trailing-zero trimming) and a magnitude below 10^14.
 */
export function fitsQuantity(value: string): boolean {
  const parsed = parseDecimal(value);
  if (parsed === null) return false;
  const canonical = renderDecimal(parsed.mantissa, parsed.scale);
  const fraction = canonical.includes('.')
    ? (canonical.split('.')[1] ?? '')
    : '';
  if (fraction.length > QUANTITY_FRACTION_DIGITS) return false;
  const scaled = parsed.mantissa >= 0n ? parsed.mantissa : -parsed.mantissa;
  const scaledTo4 =
    parsed.scale <= QUANTITY_FRACTION_DIGITS
      ? scaled * 10n ** BigInt(QUANTITY_FRACTION_DIGITS - parsed.scale)
      : scaled / 10n ** BigInt(parsed.scale - QUANTITY_FRACTION_DIGITS);
  return scaledTo4 <= MAX_QUANTITY_SCALED;
}
