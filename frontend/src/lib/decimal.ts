/**
 * Digit-exact decimal string arithmetic for UI summaries (standards.md §7).
 *
 * Financial amounts (`numeric(18,2)`) and inventory quantities (`numeric(18,4)`)
 * are NEVER parsed into IEEE-754 JavaScript `number` values. Every calculation
 * here operates on scaled `BigInt` integers and returns an exact decimal
 * string, preserving precision digit-for-digit.
 *
 * The backend remains the sole authority for balance and valuation rules;
 * these helpers serve strictly as live entry guidance in operational summaries.
 */

const VALID_DECIMAL = /^[+-]?\d+(\.\d+)?$/;

interface ParsedDecimal {
  negative: boolean;
  integer: string;
  fraction: string;
}

function parseDecimal(raw: string): ParsedDecimal | null {
  const trimmed = raw.trim();
  if (!VALID_DECIMAL.test(trimmed)) return null;
  const negative = trimmed.startsWith('-');
  const unsigned = trimmed.replace(/^[+-]/, '');
  const [integer = '0', fraction = ''] = unsigned.split('.');
  return {
    negative,
    integer: integer.replace(/^0+(?=\d)/, '') || '0',
    fraction,
  };
}

function toScaledBigInt(parsed: ParsedDecimal, scale: number): bigint {
  const digits = parsed.integer + parsed.fraction.padEnd(scale, '0');
  const magnitude = BigInt(digits || '0');
  return parsed.negative && magnitude !== 0n ? -magnitude : magnitude;
}

function fromScaledBigInt(scaled: bigint, scale: number): string {
  if (scaled === 0n) {
    return scale > 0 ? `0.${'0'.repeat(scale)}` : '0';
  }
  const negative = scaled < 0n;
  const magnitude = (negative ? -scaled : scaled)
    .toString()
    .padStart(scale + 1, '0');
  if (scale === 0) {
    return `${negative ? '-' : ''}${magnitude}`;
  }
  const integer = magnitude.slice(0, -scale) || '0';
  const fraction = magnitude.slice(-scale);
  return `${negative ? '-' : ''}${integer}.${fraction}`;
}

/** True when `value` is a syntactically valid decimal literal. */
export function isValidDecimalString(value: string): boolean {
  return parseDecimal(value) !== null;
}

/**
 * Sum an array of decimal strings digit-exactly.
 * Blank or malformed entries (while the user is still typing) are ignored.
 * `minScale` keeps trailing decimals consistent when desired (default `0`).
 */
export function sumExactDecimals(
  values: readonly (string | null | undefined)[],
  minScale = 0,
): string {
  const parsedList: ParsedDecimal[] = [];
  let scale = minScale;

  for (const candidate of values) {
    if (candidate === null || candidate === undefined) continue;
    const parsed = parseDecimal(candidate);
    if (parsed === null) continue;
    if (parsed.fraction.length > scale) {
      scale = parsed.fraction.length;
    }
    parsedList.push(parsed);
  }

  let total = 0n;
  for (const item of parsedList) {
    total += toScaledBigInt(item, scale);
  }
  return fromScaledBigInt(total, scale);
}

/**
 * Compare two decimal strings digit-exactly, returning whether they are equal,
 * whether both are zero, and their absolute difference `|a - b|`.
 */
export function compareExactDecimals(
  left: string,
  right: string,
): { equal: boolean; bothZero: boolean; absoluteDifference: string } {
  const parsedLeft = parseDecimal(left) ?? {
    negative: false,
    integer: '0',
    fraction: '',
  };
  const parsedRight = parseDecimal(right) ?? {
    negative: false,
    integer: '0',
    fraction: '',
  };
  const scale = Math.max(
    parsedLeft.fraction.length,
    parsedRight.fraction.length,
  );
  const a = toScaledBigInt(parsedLeft, scale);
  const b = toScaledBigInt(parsedRight, scale);
  const diff = a >= b ? a - b : b - a;

  return {
    equal: a === b,
    bothZero: a === 0n && b === 0n,
    absoluteDifference: fromScaledBigInt(diff, scale),
  };
}
