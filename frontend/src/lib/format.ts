import {
  formatBusinessDay,
  formatBusinessDayWithCanonical,
} from '@/lib/datetime/business-date';
import {
  formatInstant,
  formatInstantWithSeconds,
  instantTimeZoneLabel,
  isInstant,
} from '@/lib/datetime/instant';
import { getDateTimeSettings } from '@/lib/datetime/settings';

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
 * Dates go through the centralized date/time layer (C-63, ADR-0042):
 * `src/lib/datetime/` owns the calendar and the time zone, and the helpers
 * below merely apply the active organization settings. A component never
 * formats a date itself and never converts a calendar — it calls these (or the
 * layer directly, for the API-shaped values in §3 of `docs/datetime.md`).
 *
 * The settings are read from the module store rather than a hook, so a table
 * cell, a helper and a test all render the same value in the same way. The
 * store is updated once per selected organization by `OrganizationProvider`.
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
 * A canonical business day (`YYYY-MM-DD`), rendered in the organization's
 * calendar — Jalali by default (`1405/07/16`), unchanged for a Gregorian
 * organization. A value that is not a canonical day is returned as-is, so an
 * unexpected server value stays visible instead of being mangled.
 */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '';
  return formatBusinessDay(value, getDateTimeSettings().calendarSystem);
}

/**
 * The canonical Gregorian value of a business day, for reconciliation: panels
 * that show a Jalali day carry this in the element's `title`, and detail views
 * show both (C-63 §11).
 */
export function formatDateOnlyCanonical(
  value: string | null | undefined,
): string {
  return value ?? '';
}

/**
 * A business day rendered in the organization's calendar and, for Jalali
 * displays, paired with its canonical Gregorian day for audit reconciliation.
 */
export function formatDateOnlyWithCanonical(
  value: string | null | undefined,
): string {
  if (!value) return '';
  return formatBusinessDayWithCanonical(
    value,
    getDateTimeSettings().calendarSystem,
  );
}

/**
 * An ISO timestamp, rendered in the organization's IANA zone with a fixed,
 * unambiguous shape. Reading the zone from the settings is what makes the same
 * instant render identically for every user of an organization — previously it
 * followed the browser's own zone.
 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const settings = getDateTimeSettings();
  return formatInstant(
    value,
    settings.timeZone,
    undefined,
    settings.calendarSystem,
  );
}

/**
 * Detail/audit rendering of an instant: organization-local calendar day,
 * seconds, and the resolved IANA zone/offset. The caller should retain the raw
 * ISO instant in a title or adjacent audit value when exact reconciliation is
 * needed.
 */
export function formatDateTimeWithZone(
  value: string | null | undefined,
): string {
  if (!value) return '';
  if (!isInstant(value)) return value;
  const settings = getDateTimeSettings();
  const rendered = formatInstantWithSeconds(
    value,
    settings.timeZone,
    settings.calendarSystem,
  );
  return `${rendered} ${instantTimeZoneLabel(value, settings.timeZone)}`;
}

/** Plain integer display (counts, page numbers) — never money. */
export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

/**
 * Quantity display for exact decimal strings (inventory `numeric(18,4)`).
 * Like money, quantities are never parsed into a float: grouping is a pure
 * string transformation over the exact digits the API returned.
 */
export function formatQuantity(value: string | null | undefined): string {
  return formatAmount(value);
}
