import {
  parseBusinessDateInput,
  type BusinessDateInput,
} from '../../../kernel/datetime/business-date-input.js';
import {
  toBusinessDate,
  type BusinessDate,
} from '../../../kernel/datetime/business-date.js';
import { AppException } from '../../../kernel/errors/app-exception.js';

/**
 * Resolve Accounting's date inputs at the application boundary through the
 * shared kernel parser. Bare ISO days remain Gregorian; declared Jalali days
 * are converted once; legacy instants use their UTC calendar day. The returned
 * value is a BusinessDate string, never a JS Date carrier.
 */
export function parseAccountingBusinessDateInput(
  value: BusinessDateInput,
  field: string,
): BusinessDate {
  const normalized = typeof value === 'string' ? value.trim() : value;
  const result = parseBusinessDateInput(normalized);
  if (!result.ok) {
    throw AppException.badRequest(
      `${field} must be a valid business date (Gregorian YYYY-MM-DD, a declared Jalali day, or a legacy ISO instant).`,
    );
  }
  return result.gregorian;
}

/**
 * Parse canonical Gregorian day fields used by URL/query filters. Query strings
 * remain scalar `YYYY-MM-DD` values; the frontend's shared DateInput converts
 * a Jalali day to its canonical Gregorian day before building those URLs.
 */
export function parseAccountingBusinessDayFilter(
  value: string,
  field: string,
): BusinessDate {
  const day = toBusinessDate(value.trim());
  if (day === null) {
    throw AppException.badRequest(
      `${field} must be a valid Gregorian business date (YYYY-MM-DD).`,
    );
  }
  return day;
}
