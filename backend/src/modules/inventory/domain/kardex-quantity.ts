import { canonicalizeDecimal, fitsQuantity } from './quantities.js';

/** Render a quantity at the fixed C-47 four-place API scale. */
export function formatQuantity(value: string): string {
  const canonical = canonicalizeDecimal(value);
  const negative = canonical.startsWith('-');
  const unsigned = negative ? canonical.slice(1) : canonical;
  const [integer = '0', fraction = ''] = unsigned.split('.');
  return `${negative ? '-' : ''}${integer}.${fraction.padEnd(4, '0')}`;
}

/**
 * Convert authoritative base quantity to a selected display unit where
 * `factor` means one display unit equals factor base units. Exact or reject.
 */
export function baseToDisplayExact(
  base: string,
  factor: string,
): string | null {
  const a = scaled(base);
  const b = scaled(factor);
  if (a === null || b === null || b.mantissa <= 0n) return null;
  const numerator = a.mantissa * 10n ** BigInt(b.scale) * 10n ** 4n;
  const denominator = b.mantissa * 10n ** BigInt(a.scale);
  if (numerator % denominator !== 0n) return null;
  const result = renderFour(numerator / denominator);
  return fitsQuantity(result) ? result : null;
}

function scaled(value: string): { mantissa: bigint; scale: number } | null {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value);
  if (match === null) return null;
  const fraction = match[3] ?? '';
  const magnitude = BigInt(`${match[2]}${fraction}`);
  return {
    mantissa: match[1] === '-' ? -magnitude : magnitude,
    scale: fraction.length,
  };
}

function renderFour(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(5, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -4)}.${digits.slice(-4)}`;
}
