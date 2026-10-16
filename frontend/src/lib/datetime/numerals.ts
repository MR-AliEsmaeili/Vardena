/**
 * Central numeral boundary. Ordinary Iranian date/time presentation uses Persian
 * digits (PO confirmation, 2026-10-16); canonical/API values stay ASCII. Numerals
 * and calendar conversion remain separate. Broader numeric preferences are OQ-02.
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

/** Presentation only: never apply to identifiers, canonical days or signed bytes. */
export function toPersianDigits(value: string): string {
  return toLatinDigits(value).replace(
    /[0-9]/g,
    (digit) => PERSIAN_DIGITS[Number(digit)]!,
  );
}
