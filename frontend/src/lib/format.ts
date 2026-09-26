import dayjs from 'dayjs';

/**
 * Display formatters.
 *
 * **Money and balances are never parsed into a JavaScript number.** The
 * Accounting API returns exact decimal STRINGS on purpose
 * (`docs/accounting/domain-contract.md`; every amount DTO field is typed
 * `string`), and `Number()` would silently round them. Every helper here is a
 * pure string transformation that adds grouping separators for readability
 * and preserves the returned value digit for digit.
 *
 * Dates are handled with Day.js (ADR-0002). Date-only API values
 * (`YYYY-MM-DD`) are displayed verbatim — the backend date contract is not
 * reinterpreted here, and no Gregorian/Jalali conversion is performed
 * (calendar display is OQ-02, still open).
 */

const DECIMAL_PATTERN = /^[+-]?\d+(\.\d+)?$/;

/**
 * Group the integer part of an exact decimal string in threes.
 * Returns the input unchanged when it is not a plain decimal literal, so an
 * unexpected server value is shown as-is instead of being mangled.
 */
export function formatAmount(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const raw = value.trim();
  if (!DECIMAL_PATTERN.test(raw)) return raw;

  const sign = raw.startsWith('-') ? '-' : '';
  const unsigned = raw.replace(/^[+-]/, '');
  const [integerPart = '', fractionPart] = unsigned.split('.');
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fractionPart === undefined
    ? `${sign}${grouped}`
    : `${sign}${grouped}.${fractionPart}`;
}

/** True when an exact decimal string represents a negative amount. */
export function isNegativeAmount(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const raw = value.trim();
  if (!DECIMAL_PATTERN.test(raw)) return false;
  if (!raw.startsWith('-')) return false;
  // `-0`, `-0.00` are not negative values.
  return /[1-9]/.test(raw);
}

/**
 * Date-only API values (`YYYY-MM-DD`) are displayed exactly as returned:
 * the backend owns the date contract and no calendar conversion happens in
 * the UI (OQ-02).
 */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '';
  return value;
}

/** ISO timestamps are rendered with Day.js in a fixed, unambiguous shape. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm') : value;
}

/** Plain integer display (counts, page numbers) — never money. */
export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}
