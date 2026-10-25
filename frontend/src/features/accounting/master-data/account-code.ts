import type { Account, AccountingConfiguration } from '@/api/contracts';

/**
 * Local segment ⇄ full code helpers for the account form (UX mirror only).
 *
 * The operator types the LOCAL segment of the account's own level (`003`
 * under کل `101`); the BACKEND composes and authoritatively validates the
 * stored full code (`parent.code + localCode`, digits only, exact segment
 * width). These helpers exist so the form can preview that composition
 * live and explain the level's width — they never replace the server
 * verdict, and no code is ever padded, trimmed into shape or rewritten
 * here (leading zeros are significant: `003` ≠ `3`).
 *
 * Levels always come from the organization's ACTIVE accounting
 * configuration (the same level set the backend validates accounts
 * against) — nothing about a 1+2+3 (or any) layout is hardcoded.
 */

export type ConfigurationLevel = AccountingConfiguration['levels'][number];

/** Levels ordered by their 1-based index, defensively (API order is not assumed). */
export function orderedLevels(
  levels: readonly ConfigurationLevel[] | undefined,
): ConfigurationLevel[] {
  return [...(levels ?? [])].sort((a, b) => a.levelIndex - b.levelIndex);
}

/** The level an account will occupy: root = 1, child = parent level + 1 (derived, never typed). */
export function derivedLevel(parent: Account | null): number {
  return parent === null ? 1 : parent.level + 1;
}

/** The configured definition of one level, or `undefined` when the structure does not define it. */
export function levelDefinition(
  levels: readonly ConfigurationLevel[],
  level: number,
): ConfigurationLevel | undefined {
  return levels.find((entry) => entry.levelIndex === level);
}

/**
 * The full code the backend will compose: `parent.code + localCode`
 * (a root preview is the segment itself). Returns `null` while the local
 * segment is still empty, so the preview can say so instead of showing a
 * half-code as if it were final.
 */
export function previewFullCode(
  parent: Account | null,
  localCode: string,
): string | null {
  const segment = localCode.trim();
  if (segment === '') return null;
  return parent === null ? segment : `${parent.code}${segment}`;
}

export type LocalCodeFormProblem =
  'required' | 'not_digits' | 'wrong_length' | 'level_unknown';

/**
 * Instant form feedback for the segment, mirroring the backend's
 * `checkLocalCodeSegment` exactly (digits only; width = the level's
 * configured digit length). `null` means "shaped correctly" — uniqueness,
 * parent eligibility and pin coherence remain server verdicts.
 */
export function checkLocalCodeForm(
  localCode: string,
  definition: ConfigurationLevel | undefined,
): LocalCodeFormProblem | null {
  const segment = localCode.trim();
  if (segment === '') return 'required';
  if (!/^[0-9]+$/.test(segment)) return 'not_digits';
  if (definition === undefined) return 'level_unknown';
  if (segment.length !== definition.digitLength) return 'wrong_length';
  return null;
}
