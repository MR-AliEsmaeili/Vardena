import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

/**
 * The ONE Day.js configuration (C-63 §17, AR rule F, ADR-0002).
 *
 * Day.js stays the date engine (it is not replaced, and no second date
 * library is introduced); what this module adds is the configuration that was
 * missing: the plugins every timezone-aware rendering needs, registered
 * exactly once, in one file. A component never imports `dayjs` directly —
 * it imports the formatters below (`./instant`, `./business-date`), so plugin
 * registration can never depend on module load order.
 *
 * `utc` + `timezone` are the ONLY plugins required: event timestamps must be
 * rendered in the organization's IANA zone, which is exactly what they
 * provide. Calendar conversion is NOT a Day.js plugin here — it lives in the
 * framework-free `./calendar` module (ADR-0042 §D3) so the same rules run in
 * tests, in the API mapping and in the date field.
 */

dayjs.extend(utc);
dayjs.extend(timezone);

export { dayjs };

/** Date-only display shape (canonical Gregorian). */
export const DATE_DISPLAY_FORMAT = 'YYYY-MM-DD';

/** Event-timestamp display shape, as used across the existing UI. */
export const DATE_TIME_DISPLAY_FORMAT = 'YYYY-MM-DD HH:mm';

/** Event-timestamp display shape with seconds (detail views, audit surfaces). */
export const DATE_TIME_SECONDS_DISPLAY_FORMAT = 'YYYY-MM-DD HH:mm:ss';
