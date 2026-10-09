/**
 * Time zones (C-63 §5, ADR-0042 §D4).
 *
 * An organization's zone is an IANA id (`Asia/Tehran` by default) — never a
 * numeric offset. Offsets are not constants: `Asia/Tehran` observed daylight
 * saving until 1401 (2022) and stopped, so a stored `+03:30` would be wrong
 * for half of the product's history. Every offset is therefore resolved from
 * the RUNTIME's tz database for the instant in question (see `./instant`).
 *
 * This module mirrors the backend kernel (`kernel/datetime/time-zone.ts`)
 * exactly — same vocabulary, same rejections — so a value the backend accepts
 * is a value the frontend accepts, and vice versa.
 */

/** Product default, mirrored from the backend kernel (`DEFAULT_TIME_ZONE`). */
export const DEFAULT_TIME_ZONE = 'Asia/Tehran';

/** The zone Vardena always has, whatever the organization configures. */
export const UTC_TIME_ZONE = 'UTC';

/** A bare numeric offset (`+03:30`, `+0330`, `-04`) — never a zone id. */
const NUMERIC_OFFSET_PATTERN = /^[+-]\d{2}(?::?\d{2})?$/;

let cachedSupported: Set<string> | undefined;

function supportedTimeZones(): Set<string> {
  cachedSupported ??= new Set(
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [],
  );
  return cachedSupported;
}

/**
 * True when `value` is an IANA time zone this runtime can resolve.
 *
 * The canonical list is the fast, closed path; `Intl.DateTimeFormat` is the
 * fallback (it also accepts long-standing aliases such as `Asia/Calcutta`).
 * `UTC` is accepted explicitly because the canonical list omits it, and
 * numeric offsets are rejected explicitly because the probe accepts them.
 */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  if (NUMERIC_OFFSET_PATTERN.test(value)) return false;
  if (value === UTC_TIME_ZONE) return true;
  if (supportedTimeZones().has(value)) return true;
  try {
    // Constructing the formatter is the probe; `void` states that explicitly.
    void new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
