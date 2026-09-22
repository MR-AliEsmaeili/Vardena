import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_LEVEL_KIND_LENGTH } from './accounting-configuration.js';

/**
 * Cross-layer contract for the informational `levelKind` label
 * (Task 11 remediation §5).
 *
 * The four places that must agree:
 *   1. the API DTO bound (behaviourally covered in
 *      `api/dto/accounting-configuration.dto.spec.ts`),
 *   2. this domain constant (`planAccountingConfiguration`),
 *   3. the Prisma declaration (`@db.VarChar(20)`),
 *   4. the SQL column width (`level_kind VARCHAR(20)`).
 *
 * Nothing else in the suite can catch a drift between 3/4 and 2: the unit
 * tests would stay green while PostgreSQL rejected a value the API accepted (or
 * a later migration silently widened the column and let truncation-shaped
 * values through). So the declarations are read and compared, exactly like the
 * behavioural tests compare the code.
 */

const SCHEMA_PATH = 'prisma/schema/accounting.prisma';
const TASK_11_MIGRATION_PATH =
  'prisma/migrations/20260920000000_accounting_configuration_foundation/migration.sql';

describe('levelKind cross-layer contract', () => {
  it('declares @db.VarChar(20) for every level_kind column in the Prisma schema', () => {
    const schema = readFileSync(SCHEMA_PATH, 'utf8');
    const declarations = [
      ...schema.matchAll(
        /levelKind\s+String\?\s+@map\("level_kind"\)\s+@db\.VarChar\((\d+)\)/g,
      ),
    ].map((match) => Number(match[1]));

    // Both level tables carry the label: coding_structure_levels (Task 10.3)
    // and accounting_configuration_levels (Task 11).
    expect(declarations).toHaveLength(2);
    expect(declarations).toEqual([
      MAX_LEVEL_KIND_LENGTH,
      MAX_LEVEL_KIND_LENGTH,
    ]);
  });

  it('declares level_kind VARCHAR(20) in the Task 11 migration', () => {
    const migration = readFileSync(TASK_11_MIGRATION_PATH, 'utf8');
    const configurationLevels = migration.slice(
      migration.indexOf(
        'CREATE TABLE "accounting"."accounting_configuration_levels"',
      ),
      migration.indexOf('-- ---- Alter accounting.accounts'),
    );
    const match = /"level_kind"\s+VARCHAR\((\d+)\)/i.exec(configurationLevels);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(MAX_LEVEL_KIND_LENGTH);
  });

  it('never truncates: no slicing or padding of a level kind exists in the code', () => {
    // The bound is a REFUSAL. A `slice`/`substring`/`padEnd` on a levelKind
    // would be silent corruption and must be visible here.
    for (const path of [
      'src/modules/accounting/domain/accounting-configuration.ts',
      'src/modules/accounting/application/accounting-configurations.service.ts',
      'src/modules/accounting/data/accounting-configurations.repository.ts',
    ]) {
      const source = readFileSync(path, 'utf8');
      for (const line of source.split('\n')) {
        if (!/levelKind/.test(line)) continue;
        expect(line).not.toMatch(
          /\.(slice|substring|substr|padEnd|padStart)\(/,
        );
      }
    }
  });
});
