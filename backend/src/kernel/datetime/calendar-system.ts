/**
 * Calendar systems (C-63, ADR-0042).
 *
 * A *calendar system* is how a calendar day is NAMED. It is not a point in
 * time and it is not a numeral style:
 *
 *   instant (UTC)  →  timezone  →  local day  →  calendar representation
 *
 * The technical truth of every moment stays the UTC instant; a calendar only
 * changes how a day is written down. Vardena therefore stores Gregorian days
 * (PostgreSQL `date`) and UTC instants (PostgreSQL `timestamptz`) only, and
 * derives the Jalali rendering where it is shown.
 *
 * The closed list is code-defined: a stored or requested calendar outside it
 * is a defect, never a silent default (the same fail-closed rule the inventory
 * module applies to its stored vocabularies).
 *
 * Framework-free (AR-05/AR-06): pure data + predicates, no Nest, no Prisma.
 */

/** Every calendar system Vardena can name a day in. */
export const CALENDAR_SYSTEMS = ['GREGORIAN', 'JALALI'] as const;

export type CalendarSystem = (typeof CALENDAR_SYSTEMS)[number];

/**
 * The calendar a Persian business user reads by default (C-63 §4).
 *
 * It is a DEFAULT, never an assumption: the organization owns the setting
 * (`organization.organizations.calendar_system`) and every rendering path
 * receives it explicitly. Code must not branch on "we are a Jalali product".
 */
export const DEFAULT_CALENDAR_SYSTEM: CalendarSystem = 'JALALI';

/** True when `value` is one of the closed, code-defined calendar systems. */
export function isCalendarSystem(value: unknown): value is CalendarSystem {
  return (
    typeof value === 'string' &&
    (CALENDAR_SYSTEMS as readonly string[]).includes(value)
  );
}
