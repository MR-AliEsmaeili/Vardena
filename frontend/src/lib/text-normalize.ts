/**
 * Text normalization for search and filter matching.
 *
 * Persian data in a real installation is not typographically uniform: the
 * same word arrives with Arabic `ي`/`ك` (U+064A/U+0643) instead of Persian
 * `ی`/`ک` (U+06CC/U+06A9), with or without ZWNJ (`\u200c`), with harakat, or
 * with Persian/Arabic-Indic digits. A plain `String.includes` therefore misses
 * rows a user can plainly see, which reads as a broken search.
 *
 * These helpers are deliberate plain-text transforms (no locale API, no
 * `Intl.Collator` surprises): both the query and the row value go through the
 * same function, so equality is stable across environments. Digits are folded
 * to ASCII so `۱۴۰۵` and `1405` match each other — canonical API values stay
 * ASCII and display digits remain Persian (AR-32).
 */

const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED_ARABIC_INDIC_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ASCII_DIGITS = '0123456789';

/** Harakat/tatweel and the invisible bidi marks that break substring search. */
const DIACRITICS = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g;
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\u00ad]/g;
const WHITESPACE = /\s+/g;

/** Fold Persian/Arabic-Indic digits to ASCII digits. */
export function toAsciiDigits(value: string): string {
  let result = '';
  for (const character of value) {
    const extended = EXTENDED_ARABIC_INDIC_DIGITS.indexOf(character);
    if (extended !== -1) {
      result += ASCII_DIGITS[extended];
      continue;
    }
    const arabic = ARABIC_INDIC_DIGITS.indexOf(character);
    result += arabic === -1 ? character : ASCII_DIGITS[arabic];
  }
  return result;
}

/**
 * Normalize text for case-insensitive, script-tolerant substring matching.
 *
 * - Persian/Arabic letter variants are unified (`ي`→`ی`, `ك`→`ک`, `ۀ`→`ه`,
 *   `أ/إ/آ`→`ا`);
 * - harakat, tatweel and invisible bidi marks are removed;
 * - ZWNJ becomes a space, then whitespace runs collapse and are trimmed;
 * - digits are ASCII;
 * - Latin letters are lowercased (non-Latin scripts are unaffected).
 */
export function normalizeSearchText(value: string): string {
  return toAsciiDigits(value)
    .replace(/[\u064a\u0649]/g, '\u06cc')
    .replace(/\u0643/g, '\u06a9')
    .replace(/\u06c0/g, '\u0647')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(DIACRITICS, '')
    .replace(INVISIBLE, '')
    .replace(/\u200c/g, ' ')
    .replace(WHITESPACE, ' ')
    .trim()
    .toLowerCase();
}

/** Normalized substring test: `includes` that understands Persian typography. */
export function includesNormalized(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalizeSearchText(needle);
  if (normalizedNeedle === '') return true;
  return normalizeSearchText(haystack).includes(normalizedNeedle);
}

/** Normalized strict equality (used by single/multi-select filters). */
export function equalsNormalized(left: string, right: string): boolean {
  return normalizeSearchText(left) === normalizeSearchText(right);
}
