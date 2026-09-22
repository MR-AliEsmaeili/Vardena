import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { MAX_LEVEL_KIND_LENGTH } from '../../domain/accounting-configuration.js';
import { AccountingConfigurationLevelInputDto } from './accounting-configuration.dto.js';

/**
 * API boundary of the informational `levelKind` label (Task 11 remediation §5).
 *
 * The DTO must refuse exactly what
 * `accounting_configuration_levels.level_kind` (`varchar(20)`) cannot store, so
 * a 21- or 64-character value fails validation as a 400 before it can reach
 * PostgreSQL — the value is never silently truncated. The domain check
 * (`planAccountingConfiguration`) and the SQL/Prisma width are covered by
 * `domain/accounting-configuration.spec.ts` and
 * `domain/level-kind-contract.spec.ts`.
 */

const BASE_LEVEL = {
  levelIndex: 1,
  title: 'Group',
  digitLength: 2,
  defaultIsPostable: false,
};

async function levelKindErrors(levelKind: unknown): Promise<string[]> {
  const dto = plainToInstance(AccountingConfigurationLevelInputDto, {
    ...BASE_LEVEL,
    levelKind,
  });
  const errors = await validate(dto);
  return errors.map((error) => error.property);
}

describe('AccountingConfigurationLevelInputDto.levelKind', () => {
  it('accepts 20 characters — the stored column width', async () => {
    expect(await levelKindErrors('k'.repeat(MAX_LEVEL_KIND_LENGTH))).toEqual(
      [],
    );
  });

  it('rejects 21 characters', async () => {
    expect(
      await levelKindErrors('k'.repeat(MAX_LEVEL_KIND_LENGTH + 1)),
    ).toEqual(['levelKind']);
  });

  it('rejects 64 characters', async () => {
    expect(await levelKindErrors('k'.repeat(64))).toEqual(['levelKind']);
  });

  it('accepts null and an omitted levelKind', async () => {
    expect(await levelKindErrors(null)).toEqual([]);
    expect(await levelKindErrors(undefined)).toEqual([]);
  });

  it('rejects a non-string value', async () => {
    expect(await levelKindErrors(7)).toEqual(['levelKind']);
  });
});
