/**
 * Calendar vocabulary and conversion policy (C-63, ADR-0044).
 *
 * A calendar names a calendar day; it is not a timestamp or a numeral style.
 * Vardena stores canonical Gregorian BusinessDates (`date`) and UTC Instants
 * (`timestamptz`), deriving Jalali presentation only at explicit boundaries.
 *
 * Both Gregorian and Jalali remain in the closed API vocabulary: existing
 * Gregorian clients and explicitly declared Jalali inputs are supported. The
 * MVP user interface has a fixed Jalali-first policy; `DEFAULT_CALENDAR_SYSTEM`
 * is that rendering default, not an organization/user setting.
 *
 * Framework-free (AR-05/AR-06): pure data + predicates, no Nest, no Prisma.
 */

/** Every calendar system the API/kernel can explicitly name a day in. */
export const CALENDAR_SYSTEMS = ['GREGORIAN', 'JALALI'] as const;

export type CalendarSystem = (typeof CALENDAR_SYSTEMS)[number];

/** Fixed Jalali-first display policy for the MVP. */
export const DEFAULT_CALENDAR_SYSTEM: CalendarSystem = 'JALALI';

/** True when `value` is one of the closed, code-defined calendar systems. */
export function isCalendarSystem(value: unknown): value is CalendarSystem {
  return (
    typeof value === 'string' &&
    (CALENDAR_SYSTEMS as readonly string[]).includes(value)
  );
}
