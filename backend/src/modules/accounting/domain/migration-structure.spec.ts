import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIGRATION_PATH =
  'prisma/migrations/20260920000000_accounting_configuration_foundation/migration.sql';

/**
 * Defect 4 — Migration one-level structure mutation.
 *
 * The approved specification says: a copied level set is never extended —
 * including a ONE-level structure. The fallback default (Group 2, Detail 3)
 * is inserted ONLY when there is no level set to copy, in one statement
 * guarded by "this configuration has no level rows". The earlier
 * `COUNT(*)=1` guard silently widened one-level copies.
 *
 * This cross-layer contract test proves the migration's SQL preserves existing
 * valid structures: it fails when the guard regresses to `COUNT(*)=1` or when
 * the deterministic single-ACTIVE-version join is removed. The deterministic
 * rehearsal (rehearse.mjs + verify.sql) then proves it against a real
 * PostgreSQL with populated pre-Task-11 data.
 */
describe('Defect 4 — migration preserves one-level structures', () => {
  it('the fallback default is guarded by NOT EXISTS, never by COUNT(*)=1', () => {
    const migration = readFileSync(MIGRATION_PATH, 'utf8');
    // The fallback INSERT ... SELECT must be guarded by "has NO level rows"
    expect(migration).toMatch(
      /NOT EXISTS\s*\(\s*SELECT 1 FROM "accounting"\."accounting_configuration_levels"/,
    );
    // And must NOT contain the old COUNT(*)=1 widening logic
    expect(migration).not.toMatch(/COUNT\(\*\)\s*=\s*1/);
    expect(migration).not.toMatch(/level_index\s*=\s*2.*COUNT/);
  });

  it('the level copy joins exactly one ACTIVE version deterministically', () => {
    const migration = readFileSync(MIGRATION_PATH, 'utf8');
    // The copy must select the ACTIVE version with ORDER BY version_number DESC, id ASC LIMIT 1
    // so a violated "exactly one active" invariant cannot abort on the unique index.
    expect(migration).toMatch(/ORDER BY v\."version_number" DESC, v\."id" ASC/);
    expect(migration).toMatch(/LIMIT 1/);
    // The copy must be from coding_structure_versions where status = 'active'
    expect(migration).toMatch(
      /JOIN "accounting"\."coding_structure_versions" csv/,
    );
    expect(migration).toMatch(/csv\."status" = 'active'/);
  });

  it('mutation probe: restoring the old COUNT(*)=1 guard would be caught', () => {
    // Document why this test is not vacuous: the rehearsal's verify.sql
    // checks that org-one-level's legacy configuration has exactly ONE level.
    // If the migration were reverted to `COUNT(*)=1`, that configuration would
    // have 2 levels and the rehearsal would fail with
    // "org-one-level legacy configuration has 2 level(s); a ONE-level structure must not be extended"
    // (proven by M1c in the verification report). This SQL contract test
    // catches the same regression statically without needing a database.
    const migration = readFileSync(MIGRATION_PATH, 'utf8');
    const hasCorrectGuard =
      /NOT EXISTS\s*\(\s*SELECT 1 FROM "accounting"\."accounting_configuration_levels"/.test(
        migration,
      );
    const hasOldGuard = /COUNT\(\*\)\s*=\s*1/.test(migration);
    expect(hasCorrectGuard).toBe(true);
    expect(hasOldGuard).toBe(false);
  });
});
