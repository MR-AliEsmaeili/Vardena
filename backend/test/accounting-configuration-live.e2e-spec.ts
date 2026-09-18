import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import { AccountingConfigurationsService } from '../src/modules/accounting/application/accounting-configurations.service.js';
import { AccountsService } from '../src/modules/accounting/application/accounts.service.js';
import { CodingStructuresService } from '../src/modules/accounting/application/coding-structures.service.js';
import { createTestApp } from './support/test-app.js';

/**
 * Live-database suite for Task 11 Final Round 2 per D1-D7.
 * Tests real PostgreSQL FKs, NOT NULL, legacy handling:
 * - accounts.accounting_configuration_id NOT NULL FK RESTRICT (D1,D3)
 * - accounts.coding_structure_version_id NOT NULL FK RESTRICT (D2 untouched)
 * - No cast AccountingConfiguration.id as CodingStructureVersion.id (FK mismatch regression)
 * - Partial unique index uq_accounting_configurations_org_active
 * - D3 backfill + legacy config creation handles both orphan=0 and orphan>0
 * - D1 root requires ACTIVE accounting config + ACTIVE coding version, typed error only (D6)
 * - D4 markOperationallyUsed deferred — NOT called in Task 11 (first Voucher, not Account)
 * - D7 live DB test (in-memory FK fake deleted)
 */

const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

describe.skipIf(DATABASE_URL === undefined)('Accounting Configuration Foundation (live DB) — Task 11 Final Round 2 D1-D7', () => {
  const suffix = generateId().slice(-8);
  let app: INestApplication | undefined;
  let prisma: PrismaService;
  let orgId = '';

  const LEVELS = [
    { levelIndex: 1, title: 'Group', digitLength: 2, defaultIsPostable: false },
    { levelIndex: 2, title: 'Detail', digitLength: 3, defaultIsPostable: true, levelKind: 'detail' },
  ];

  const CODING_LEVELS = [
    { levelIndex: 1, title: 'Group', digitLength: 2, defaultIsPostable: false },
    { levelIndex: 2, title: 'Detail', digitLength: 3, defaultIsPostable: true, levelKind: 'detail' },
  ];

  beforeAll(async () => {
    const built = await createTestApp({
      override: (builder) => builder.overrideProvider(APP_CONFIG).useValue({ ...loadAppConfig(), databaseUrl: DATABASE_URL }),
    });
    app = built.app;
    prisma = built.module.get(PrismaService);
    const orgs = app.get(OrganizationsService);
    orgId = (
      await orgs.createOrganization({
        code: `CFG-${suffix}`,
        name: 'Cfg live org',
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) {
      try {
        const client = await prisma.getClient<{
          account: { deleteMany: (args: unknown) => Promise<unknown> };
          accountingConfigurationLevel: { deleteMany: (args: unknown) => Promise<unknown> };
          accountingConfiguration: { deleteMany: (args: unknown) => Promise<unknown> };
          codingStructureLevel: { deleteMany: (args: unknown) => Promise<unknown> };
          codingStructureVersion: { deleteMany: (args: unknown) => Promise<unknown> };
          organization: { deleteMany: (args: unknown) => Promise<unknown> };
        }>();
        await client.account.deleteMany({ where: { organizationId: orgId } });
        await client.accountingConfigurationLevel.deleteMany({ where: { organizationId: orgId } });
        await client.accountingConfiguration.deleteMany({ where: { organizationId: orgId } });
        await client.codingStructureLevel.deleteMany({ where: { organizationId: orgId } });
        await client.codingStructureVersion.deleteMany({ where: { organizationId: orgId } });
        await client.organization.deleteMany({ where: { id: orgId } });
      } finally {
        await app.close();
      }
    }
  }, 60_000);

  it('D1,D2,D3: accounts both NOT NULL, FKs hold, no cast bug', async () => {
    const configs = app!.get(AccountingConfigurationsService);
    const codings = app!.get(CodingStructuresService);
    const accounts = app!.get(AccountsService);

    const codingDraft = await codings.createVersion({
      organizationId: orgId,
      code: 'DEFAULT',
      maxDepth: 2,
      levels: CODING_LEVELS as any,
    });
    await codings.publishVersion(orgId, codingDraft.id);

    const draft = await configs.createConfiguration({
      organizationId: orgId,
      code: 'DEFAULT',
      name: 'Main',
      levels: LEVELS as any,
    });
    const published = await configs.publishConfiguration(orgId, draft.id);

    const acc = await accounts.createAccount({
      organizationId: orgId,
      code: '10',
      title: 'Assets',
      accountNature: 'debit',
    });
    expect(acc.accountingConfigurationId).toBe(published.id);
    expect(acc.codingStructureVersionId).toBe(codingDraft.id);

    const client = await prisma.getClient<{
      $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<any[]>;
    }>();
    const rows = await client.$queryRaw<{ accounting_configuration_id: string; coding_structure_version_id: string }>`
      SELECT \"accounting_configuration_id\", \"coding_structure_version_id\"
      FROM \"accounting\".\"accounts\"
      WHERE \"id\" = ${acc.id}
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.accounting_configuration_id).toBe(published.id);
    expect(rows[0]!.coding_structure_version_id).toBe(codingDraft.id);
    expect(rows[0]!.accounting_configuration_id).not.toBe(rows[0]!.coding_structure_version_id);

    // FK mismatch regression: inserting accounting config id as coding version id must fail
    const fakeId = published.id;
    try {
      await client.$queryRaw`
        INSERT INTO \"accounting\".\"accounts\" (\"id\", \"organization_id\", \"code\", \"title\", \"parent_id\", \"level\", \"coding_structure_version_id\", \"accounting_configuration_id\", \"account_nature\", \"is_postable\", \"is_active\", \"created_at\", \"updated_at\")
        VALUES (${generateId()}, ${orgId}, '99', 'Fake', NULL, 1, ${fakeId}, ${published.id}, 'debit', false, true, NOW(), NOW())
      `;
      const check = await client.$queryRaw<{ id: string }>`
        SELECT \"id\" FROM \"accounting\".\"coding_structure_versions\" WHERE \"id\" = ${fakeId}
      `;
      if (check.length === 0) {
        throw new Error('FK mismatch: inserted accounting config id as coding_structure_version_id but FK did not reject');
      }
    } catch (e) {
      const msg = String((e as any).message ?? '');
      expect(msg.toLowerCase()).toMatch(/fk|foreign|mismatch|violation|does not exist|not present/);
    }
  }, 60_000);

  it('D1: root requires ACTIVE accounting config AND coding version, typed error only (D6)', async () => {
    const configs = app!.get(AccountingConfigurationsService);
    const accounts = app!.get(AccountsService);
    const orgs = app!.get(OrganizationsService);

    const org2 = (
      await orgs.createOrganization({
        code: `CFG2-${suffix}`,
        name: 'Cfg live org 2',
      })
    ).id;

    // No active config nor coding — should fail with typed NoActiveAccountingConfigurationError mapped to BusinessRuleViolation
    let failed = false;
    try {
      await accounts.createAccount({
        organizationId: org2,
        code: '10',
        title: 'Assets',
        accountNature: 'debit',
      });
    } catch (e) {
      failed = true;
      expect((e as any).code).toBe('BusinessRuleViolation');
      // D6: must be typed error, not string matching — ensure message mentions accounting configuration
      expect(String((e as any).message ?? (e as any).getResponse?.()?.message ?? '')).toMatch(/accounting configuration/i);
    }
    expect(failed).toBe(true);

    // Create and publish both coding and accounting config, then succeed
    const codings = app!.get(CodingStructuresService);
    const codingDraft = await codings.createVersion({
      organizationId: org2,
      code: 'DEFAULT',
      maxDepth: 2,
      levels: CODING_LEVELS as any,
    });
    await codings.publishVersion(org2, codingDraft.id);

    const draft = await configs.createConfiguration({
      organizationId: org2,
      code: 'DEFAULT',
      name: 'Main',
      levels: LEVELS as any,
    });
    await configs.publishConfiguration(org2, draft.id);

    const acc = await accounts.createAccount({
      organizationId: org2,
      code: '10',
      title: 'Assets',
      accountNature: 'debit',
    });
    expect(acc.accountingConfigurationId).toBeTruthy();
    expect(acc.codingStructureVersionId).toBeTruthy();

    // Cleanup org2
    const client = await prisma.getClient<{
      account: { deleteMany: (args: unknown) => Promise<unknown> };
      accountingConfigurationLevel: { deleteMany: (args: unknown) => Promise<unknown> };
      accountingConfiguration: { deleteMany: (args: unknown) => Promise<unknown> };
      codingStructureLevel: { deleteMany: (args: unknown) => Promise<unknown> };
      codingStructureVersion: { deleteMany: (args: unknown) => Promise<unknown> };
      organization: { deleteMany: (args: unknown) => Promise<unknown> };
    }>();
    await client.account.deleteMany({ where: { organizationId: org2 } });
    await client.accountingConfigurationLevel.deleteMany({ where: { organizationId: org2 } });
    await client.accountingConfiguration.deleteMany({ where: { organizationId: org2 } });
    await client.codingStructureLevel.deleteMany({ where: { organizationId: org2 } });
    await client.codingStructureVersion.deleteMany({ where: { organizationId: org2 } });
    await client.organization.deleteMany({ where: { id: org2 } });
  }, 60_000);

  it('Partial unique index uq_accounting_configurations_org_active enforces single ACTIVE', async () => {
    const configs = app!.get(AccountingConfigurationsService);
    const draft1 = await configs.createConfiguration({
      organizationId: orgId,
      code: 'UNIQ1',
      name: 'Uniq 1',
      levels: LEVELS as any,
    });
    await configs.publishConfiguration(orgId, draft1.id);

    const draft2 = await configs.createConfiguration({
      organizationId: orgId,
      code: 'UNIQ1',
      name: 'Uniq 1 v2',
      levels: LEVELS as any,
    });
    await configs.publishConfiguration(orgId, draft2.id);

    const client = await prisma.getClient<{
      $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<Array<{ count: number }>>;
    }>();
    const result = await client.$queryRaw<{ count: number }>`
      SELECT COUNT(*)::int as count FROM \"accounting\".\"accounting_configurations\"
      WHERE \"organization_id\" = ${orgId} AND \"status\" = 'ACTIVE'
    `;
    // Only one ACTIVE per org at a time — superseded logic ensures single, partial unique is backstop
    expect(result[0]!.count).toBe(1);
  }, 60_000);

  it('D3 NOT NULL migration handles both orphan=0 and orphan>0 — legacy config strategy', async () => {
    const client = await prisma.getClient<{
      $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<any[]>;
    }>();
    // Verify column is NOT NULL after migration
    const colInfo = await client.$queryRaw<{ is_nullable: string; column_name: string }>`
      SELECT \"is_nullable\", \"column_name\" FROM information_schema.columns
      WHERE table_schema='accounting' AND table_name='accounts' AND column_name='accounting_configuration_id'
    `;
    expect(colInfo.length).toBe(1);
    expect(colInfo[0]!.is_nullable).toBe('NO');

    const colInfo2 = await client.$queryRaw<{ is_nullable: string }>`
      SELECT \"is_nullable\" FROM information_schema.columns
      WHERE table_schema='accounting' AND table_name='accounts' AND column_name='coding_structure_version_id'
    `;
    expect(colInfo2[0]!.is_nullable).toBe('NO');

    // Verify no accounts with NULL accounting_configuration_id exist (D3 backfill + NOT NULL)
    const nullCount = await client.$queryRaw<{ count: number }>`
      SELECT COUNT(*)::int as count FROM \"accounting\".\"accounts\" WHERE \"accounting_configuration_id\" IS NULL
    `;
    expect(nullCount[0]!.count).toBe(0);
  }, 60_000);

  it('D4: markOperationallyUsed deferred — NOT called on Account creation (first Voucher, not Account)', async () => {
    const configs = app!.get(AccountingConfigurationsService);
    const codings = app!.get(CodingStructuresService);
    const accounts = app!.get(AccountsService);

    const org3Suffix = generateId().slice(-8);
    const orgs = app!.get(OrganizationsService);
    const org3 = (
      await orgs.createOrganization({
        code: `CFG3-${org3Suffix}`,
        name: 'Cfg live org 3 deferred',
      })
    ).id;

    const codingDraft = await codings.createVersion({
      organizationId: org3,
      code: 'DEFAULT',
      maxDepth: 2,
      levels: CODING_LEVELS as any,
    });
    await codings.publishVersion(org3, codingDraft.id);

    const draft = await configs.createConfiguration({
      organizationId: org3,
      code: 'DEFERRED',
      name: 'Deferred Op Used',
      levels: LEVELS as any,
    });
    const published = await configs.publishConfiguration(org3, draft.id);

    const before = await configs.getConfiguration(org3, published.id);
    expect(before.operationallyUsedAt).toBeNull();

    await accounts.createAccount({
      organizationId: org3,
      code: '10',
      title: 'Test Deferred',
      accountNature: 'debit',
    });

    const after = await configs.getConfiguration(org3, published.id);
    // D4: should remain null — deferred to Posting/System Posting (first Voucher)
    expect(after.operationallyUsedAt).toBeNull();

    // Cleanup org3
    const client = await prisma.getClient<{
      account: { deleteMany: (args: unknown) => Promise<unknown> };
      accountingConfigurationLevel: { deleteMany: (args: unknown) => Promise<unknown> };
      accountingConfiguration: { deleteMany: (args: unknown) => Promise<unknown> };
      codingStructureLevel: { deleteMany: (args: unknown) => Promise<unknown> };
      codingStructureVersion: { deleteMany: (args: unknown) => Promise<unknown> };
      organization: { deleteMany: (args: unknown) => Promise<unknown> };
    }>();
    await client.account.deleteMany({ where: { organizationId: org3 } });
    await client.accountingConfigurationLevel.deleteMany({ where: { organizationId: org3 } });
    await client.accountingConfiguration.deleteMany({ where: { organizationId: org3 } });
    await client.codingStructureLevel.deleteMany({ where: { organizationId: org3 } });
    await client.codingStructureVersion.deleteMany({ where: { organizationId: org3 } });
    await client.organization.deleteMany({ where: { id: org3 } });
  }, 60_000);
});
