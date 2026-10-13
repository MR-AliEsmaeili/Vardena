/**
 * Numeral (digit) conversion — deliberately SEPARATE from calendar conversion
 * (C-63 §17, ADR-0042 §D7).
 *
 * A Jalali date written with Latin digits is still a Jalali date, and a
 * Gregorian date written with Persian digits is still a Gregorian date: the
 * two concerns must never be wired together, or "show Jalali" would silently
 * also mean "show Persian numerals" for screens that do not want that.
 *
 * Which numerals the UI RENDERS is a presentation preference that does not
 * exist yet (OQ-02: the user-preference store is still open), so this module
 * intentionally exposes only the INPUT direction — tolerating the digits a
 * Persian user actually types — and documents the rendering decision as
 * pending. When that preference lands, its `toPersianDigits` belongs here,
 * next to its inverse, and its consumer is the display layer — never the date
 * field's parser or the calendar module.
 */

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/**
 * Rewrite Persian (۰-۹) and Arabic-Indic (٠-٩) digits as their Latin
 * equivalents, leaving every other character untouched. Used by the date
 * field's parser so `۱۴۰۵/۰۷/۱۶` is accepted as `1405/07/16`.
 */
export function toLatinDigits(value: string): string {
  let result = '';
  for (const character of value) {
    const persian = PERSIAN_DIGITS.indexOf(character);
    if (persian !== -1) {
      result += String(persian);
      continue;
    }
    const arabic = ARABIC_INDIC_DIGITS.indexOf(character);
    result += arabic === -1 ? character : String(arabic);
  }
  return result;
}

/** True when the text contains at least one non-Latin digit. */
export function containsNonLatinDigits(value: string): boolean {
  return toLatinDigits(value) !== value;
}
