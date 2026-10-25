import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { UsersRepository } from '../src/modules/users/data/users.repository.js';
import { UsersService } from '../src/modules/users/application/users.service.js';
import { SessionsRepository } from '../src/modules/identity/data/sessions.repository.js';
import { PermissionsRepository } from '../src/modules/rbac/data/permissions.repository.js';
import { RolesRepository } from '../src/modules/rbac/data/roles.repository.js';
import { UserRolesRepository } from '../src/modules/rbac/data/user-roles.repository.js';
import { PermissionRegistry } from '../src/modules/rbac/application/permission-registry.js';
import { RolesService } from '../src/modules/rbac/application/roles.service.js';
import { UserRolesService } from '../src/modules/rbac/application/user-roles.service.js';
import { OrganizationsRepository } from '../src/modules/organization/data/organizations.repository.js';
import { OrganizationMembershipsRepository } from '../src/modules/organization/data/organization-memberships.repository.js';
import { BranchesRepository } from '../src/modules/organization/data/branches.repository.js';
import { FinancialAreasRepository } from '../src/modules/accounting/data/financial-areas.repository.js';
import { FiscalYearsRepository } from '../src/modules/accounting/data/fiscal-years.repository.js';
import { AccountingPeriodsRepository } from '../src/modules/accounting/data/accounting-periods.repository.js';
import { CodingStructuresRepository } from '../src/modules/accounting/data/coding-structures.repository.js';
import { AccountingConfigurationsRepository } from '../src/modules/accounting/data/accounting-configurations.repository.js';
import { AccountsRepository } from '../src/modules/accounting/data/accounts.repository.js';
import { AccountingDocumentsRepository } from '../src/modules/accounting/data/accounting-documents.repository.js';
import { AccountingDocumentLinesRepository } from '../src/modules/accounting/data/accounting-document-lines.repository.js';
import { AccountingPostingOperationsRepository } from '../src/modules/accounting/data/accounting-posting-operations.repository.js';
import { LedgerEntriesRepository } from '../src/modules/accounting/data/ledger-entries.repository.js';
import { DocumentTypeConfigsRepository } from '../src/modules/documents/data/document-type-configs.repository.js';
import { NumberingSeriesRepository } from '../src/modules/documents/data/numbering-series.repository.js';
import { NumberingAllocationsRepository } from '../src/modules/documents/data/numbering-allocations.repository.js';
import { DocumentRelationsRepository } from '../src/modules/documents/data/document-relations.repository.js';
import { createInMemoryStores } from './support/in-memory-repositories.js';
import { createMasterDataStores } from './support/master-data-repositories.js';
import { createAccountingStores } from './support/accounting-repositories.js';
import { createStructureStores } from './support/accounting-structure-repositories.js';
import { createDocumentStores } from './support/document-repositories.js';
import {
  createAccountingDocumentStores,
  type AccountingDocumentStores,
} from './support/accounting-document-repositories.js';
import { createTestApp } from './support/test-app.js';

/**
 * Hierarchical local-code coding + the balanced-voucher refusals — the
 * fresh-organization journey for a 1+2+3 coding structure:
 *   گروه `1` ← کل `01` ← معین `003`/`004`  (full codes 1 / 101 / 101003 / 101004)
 * followed by a balanced two-line voucher (debit 10000 / credit 10000).
 *
 * This suite began as the BEFORE-fix reproduction of two field reports
 * (account creation forcing the operator to type full codes, and a balanced
 * voucher refused at ثبت). The reproduced root causes, kept here as
 * regression pins:
 *
 * 1. The account form sent the FULL code only; a local segment (`01`) was
 *    refused with `level_length_mismatch`. The API now accepts `localCode`
 *    (the segment of the account's own level) and the BACKEND composes the
 *    stored full code from the resolved parent — this suite proves the
 *    composition, its validation, and that the full-code form still works.
 * 2. With the chart-setup UI's shipped level defaults (level 2 postable by
 *    default, an appended level 3 NOT postable by default) a UI-created کل
 *    refused children (`parent_postable`) and a UI-created معین was silently
 *    non-postable, so a balanced voucher on it was refused with
 *    `account_not_postable`. Those backend rules are CORRECT (§14/AC-I-09)
 *    and stay pinned here; the fix is frontend transparency, not rule
 *    removal.
 * 3. Even with postable accounts, a fresh organization had NO numbering
 *    series (and no UI to create one), so composition was refused by the
 *    Document Foundation (§18) with a business-rule error that carried no
 *    stable discriminator. The refusal now carries
 *    `details.problem: 'numbering_series_missing'` so the UI can name the
 *    real cause; numbering policy itself stays OQ-12 and is not invented.
 *
 * Payloads mirror the frontend forms in the fields that matter: chart setup
 * publishes ONE level set into both the coding structure and the accounting
 * configuration, and account creation omits `isPostable` when the operator
 * keeps the level default.
 */
describe('1+2+3 local-code coding + balanced voucher (fresh org, UI-shaped payloads)', () => {
  let app: INestApplication;
  let root: ReturnType<typeof request.agent>;
  const state = {
    org: '',
    orgB: '',
    area: '',
    group1: '',
    group2: '',
    general101: '',
    general201: '',
    sub201003: '',
    sub201004: '',
    subPostableA: '',
    subPostableB: '',
    localGeneral: '',
    localSubA: '',
    localSubB: '',
  };

  const LEVELS = [
    {
      levelIndex: 1,
      title: 'گروه',
      digitLength: 1,
      defaultIsPostable: false,
      levelKind: 'group',
    },
    // ChartSetupForm ships level 2 with defaultIsPostable: true.
    {
      levelIndex: 2,
      title: 'کل',
      digitLength: 2,
      defaultIsPostable: true,
      levelKind: 'general',
    },
    // ChartSetupForm's add-level button appends defaultIsPostable: false.
    {
      levelIndex: 3,
      title: 'معین',
      digitLength: 3,
      defaultIsPostable: false,
      levelKind: 'subsidiary',
    },
  ];

  beforeAll(async () => {
    const stores = createInMemoryStores();
    const master = createMasterDataStores();
    const accounting = createAccountingStores();
    const holder: { stores: AccountingDocumentStores | null } = {
      stores: null,
    };
    const structure = createStructureStores({
      lineUsage: {
        countForAccount: (accountId) =>
          holder.stores === null
            ? 0
            : holder.stores.raw.state.lines.findMany(
                (l) => l.accountId === accountId,
              ).length,
      },
    });
    const documents = createDocumentStores();
    const vouchers = createAccountingDocumentStores({
      accounting: accounting.raw.state,
      structure: structure.raw.state,
    });
    holder.stores = vouchers;

    const rebuilt = await createTestApp({
      override: (builder) =>
        builder
          .overrideProvider(PrismaService)
          .useValue(buildPrismaStub())
          .overrideProvider(UsersRepository)
          .useValue(stores.users)
          .overrideProvider(SessionsRepository)
          .useValue(stores.sessions)
          .overrideProvider(PermissionsRepository)
          .useValue(stores.permissions)
          .overrideProvider(RolesRepository)
          .useValue(stores.roles)
          .overrideProvider(UserRolesRepository)
          .useValue(stores.userRoles)
          .overrideProvider(OrganizationsRepository)
          .useValue(master.organizations)
          .overrideProvider(OrganizationMembershipsRepository)
          .useValue(master.memberships)
          .overrideProvider(BranchesRepository)
          .useValue(master.branches)
          .overrideProvider(FinancialAreasRepository)
          .useValue(accounting.areas)
          .overrideProvider(FiscalYearsRepository)
          .useValue(accounting.years)
          .overrideProvider(AccountingPeriodsRepository)
          .useValue(accounting.periods)
          .overrideProvider(CodingStructuresRepository)
          .useValue(structure.structures)
          .overrideProvider(AccountingConfigurationsRepository)
          .useValue(structure.configurations)
          .overrideProvider(AccountsRepository)
          .useValue(structure.accounts)
          .overrideProvider(AccountingDocumentsRepository)
          .useValue(vouchers.documents)
          .overrideProvider(AccountingDocumentLinesRepository)
          .useValue(vouchers.lines)
          .overrideProvider(AccountingPostingOperationsRepository)
          .useValue(vouchers.operations)
          .overrideProvider(LedgerEntriesRepository)
          .useValue(vouchers.ledgerEntries)
          .overrideProvider(DocumentTypeConfigsRepository)
          .useValue(documents.typeConfigs)
          .overrideProvider(NumberingSeriesRepository)
          .useValue(documents.numberingSeries)
          .overrideProvider(NumberingAllocationsRepository)
          .useValue(documents.numberingAllocations)
          .overrideProvider(DocumentRelationsRepository)
          .useValue(documents.relations),
    });
    app = rebuilt.app;
    const users = app.get(UsersService);
    const roles = app.get(RolesService);
    const userRoles = app.get(UserRolesService);
    const allCodes = app
      .get(PermissionRegistry)
      .all()
      .map((d) => d.code);
    const rootUser = await users.createUser({
      username: 'root',
      password: 'root-secret',
    });
    await userRoles.assignRoleToUser(
      (
        await roles.createRole({
          name: 'Root',
          description: 'repro',
          permissionCodes: allCodes,
        })
      ).id,
      rootUser.id,
    );
    root = request.agent(app.getHttpServer());
    await root
      .post('/api/v1/auth/login')
      .send({ username: 'root', password: 'root-secret' })
      .expect(200);

    state.org = (
      await root
        .post('/api/v1/organizations')
        .send({ code: 'REPRO1', name: 'Repro Org' })
        .expect(201)
    ).body.id;
    state.orgB = (
      await root
        .post('/api/v1/organizations')
        .send({ code: 'REPRO2', name: 'Other Org' })
        .expect(201)
    ).body.id;
    master.raw.memberships.seed(rootUser.id, state.org);
    master.raw.memberships.seed(rootUser.id, state.orgB);

    state.area = (
      await root
        .post('/api/v1/financial-areas')
        .send({ organizationId: state.org, code: 'GA', title: 'General' })
        .expect(201)
    ).body.id;
    const year = (
      await root
        .post('/api/v1/fiscal-years')
        .send({
          organizationId: state.org,
          financialAreaId: state.area,
          code: 'Y2026',
          title: '2026',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        })
        .expect(201)
    ).body.id;
    await root
      .post('/api/v1/accounting-periods')
      .send({
        organizationId: state.org,
        fiscalYearId: year,
        sequence: 1,
        title: 'Whole year',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      })
      .expect(201);

    // Chart setup exactly as the UI does it: one level set → both aggregates.
    const coding = (
      await root
        .post('/api/v1/coding-structures')
        .send({
          organizationId: state.org,
          code: 'DEFAULT',
          maxDepth: 3,
          separator: '',
          levels: LEVELS,
        })
        .expect(201)
    ).body.id;
    await root
      .post(`/api/v1/coding-structures/${coding}/publish`)
      .query({ organizationId: state.org })
      .expect(200);
    const config = (
      await root
        .post('/api/v1/accounting-configurations')
        .send({
          organizationId: state.org,
          code: 'DEFAULT',
          name: 'Default',
          levels: LEVELS,
        })
        .expect(201)
    ).body.id;
    await root
      .post(`/api/v1/accounting-configurations/${config}/publish`)
      .query({ organizationId: state.org })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  const createAccount = (body: Record<string, unknown>) =>
    root
      .post('/api/v1/accounts')
      .send({ organizationId: state.org, accountNature: 'DUAL', ...body });

  it('pins the level-default trap: a default-postable کل refuses its first معین child (rule kept)', async () => {
    const group = await createAccount({ code: '1', title: 'دارایی‌ها' }).expect(
      201,
    );
    state.group1 = group.body.id;
    expect(group.body).toMatchObject({
      code: '1',
      localCode: '1',
      level: 1,
      isPostable: false,
    });

    const general = await createAccount({
      code: '101',
      title: 'دارایی ثابت',
      parentId: state.group1,
    }).expect(201);
    state.general101 = general.body.id;
    // Level-2 default (true in the UI-shaped chart) silently makes کل postable.
    expect(general.body).toMatchObject({
      code: '101',
      localCode: '01',
      level: 2,
      isPostable: true,
    });

    const sub = await createAccount({
      code: '101003',
      title: 'تاسیسات',
      parentId: state.general101,
    }).expect(422);
    expect(sub.body.code).toBe('BusinessRuleViolation');
    expect(JSON.stringify(sub.body)).toContain('parent_postable');
  });

  it('keeps the full-code form strict: a bare segment sent as `code` is still refused', async () => {
    const group2 = await createAccount({ code: '2', title: 'بدهی‌ها' }).expect(
      201,
    );
    state.group2 = group2.body.id;
    const local = await createAccount({
      code: '01',
      title: 'کل با کد محلی',
      parentId: state.group2,
    }).expect(422);
    expect(JSON.stringify(local.body)).toContain('level_length_mismatch');
  });

  it('composes full codes from local segments: 3 → 301 → 301003/301004', async () => {
    const group = await createAccount({
      localCode: '3',
      title: 'درآمدها',
    }).expect(201);
    expect(group.body).toMatchObject({ code: '3', localCode: '3', level: 1 });
    const general = await createAccount({
      localCode: '01',
      title: 'فروش',
      parentId: group.body.id,
      isPostable: false,
    }).expect(201);
    expect(general.body).toMatchObject({
      code: '301',
      localCode: '01',
      level: 2,
    });

    const subA = await createAccount({
      localCode: '003',
      title: 'فروش داخلی',
      parentId: general.body.id,
      isPostable: true,
    }).expect(201);
    const subB = await createAccount({
      localCode: '004',
      title: 'فروش خارجی',
      parentId: general.body.id,
      isPostable: true,
    }).expect(201);
    expect(subA.body).toMatchObject({
      code: '301003',
      localCode: '003',
      level: 3,
      isPostable: true,
    });
    expect(subB.body).toMatchObject({
      code: '301004',
      localCode: '004',
      level: 3,
      isPostable: true,
    });
    state.localSubA = subA.body.id;
    state.localSubB = subB.body.id;
    state.localGeneral = general.body.id;

    // The derivation is stable on re-reads (detail + list), not an echo of input.
    const fetched = await root
      .get(`/api/v1/accounts/${subA.body.id}`)
      .query({ organizationId: state.org })
      .expect(200);
    expect(fetched.body).toMatchObject({ code: '301003', localCode: '003' });
    const list = await root
      .get('/api/v1/accounts')
      .query({ organizationId: state.org, level: 3, page: 1, pageSize: 100 })
      .expect(200);
    const listed = (list.body.items as Array<Record<string, unknown>>).find(
      (a) => a.id === subB.body.id,
    );
    expect(listed).toMatchObject({ code: '301004', localCode: '004' });
  });

  it('refuses malformed localCode requests without creating anything', async () => {
    // Wrong segment width for the level (3 digits configured).
    const width = await createAccount({
      localCode: '03',
      title: 'عرض اشتباه',
      parentId: state.localGeneral,
      isPostable: true,
    }).expect(422);
    expect(width.body.details).toMatchObject({
      rule: 'local_code_length_mismatch',
      field: 'localCode',
    });

    // Both forms at once: two truths must never be allowed to disagree.
    const both = await createAccount({
      code: '301007',
      localCode: '007',
      title: 'هر دو',
      parentId: state.localGeneral,
      isPostable: true,
    }).expect(400);
    expect(both.body.code).toBe('BadRequest');

    // Neither form.
    const neither = await createAccount({
      title: 'بدون کد',
      parentId: state.localGeneral,
    }).expect(400);
    expect(neither.body.code).toBe('ValidationFailed');

    // Non-digit segment.
    const dirty = await createAccount({
      localCode: '0-7',
      title: 'ناخالص',
      parentId: state.localGeneral,
      isPostable: true,
    }).expect(400);
    expect(dirty.body.code).toBe('BadRequest');

    // Duplicate composed code (301003 already exists) → 409, same as the full form.
    const duplicate = await createAccount({
      localCode: '003',
      title: 'تکراری',
      parentId: state.localGeneral,
      isPostable: true,
    }).expect(409);
    expect(duplicate.body.code).toBe('Conflict');

    // A parent id from another organization is indistinguishable from missing (404).
    const foreign = await root
      .post('/api/v1/accounts')
      .send({
        organizationId: state.orgB,
        localCode: '003',
        title: 'بیگانه',
        parentId: state.localGeneral,
        accountNature: 'DUAL',
        isPostable: true,
      })
      .expect(404);
    expect(foreign.body.code).toBe('EntityNotFound');
  });

  it('pins AC-I-09: a balanced voucher on non-postable معین is refused as account_not_postable', async () => {
    const general = await createAccount({
      code: '201',
      title: 'بدهی جاری',
      parentId: state.group2,
      isPostable: false,
    }).expect(201);
    state.general201 = general.body.id;
    const a = await createAccount({
      code: '201003',
      title: 'الف',
      parentId: state.general201,
    }).expect(201);
    const b = await createAccount({
      code: '201004',
      title: 'ب',
      parentId: state.general201,
    }).expect(201);
    state.sub201003 = a.body.id;
    state.sub201004 = b.body.id;
    // Level-3 default (false from the add-level button) silently aggregates them.
    expect(a.body.isPostable).toBe(false);
    expect(b.body.isPostable).toBe(false);

    const doc = await root
      .post('/api/v1/accounting-documents')
      .send({
        organizationId: state.org,
        financialAreaId: state.area,
        documentDate: '2026-04-05',
        description: 'سند متوازن بازتولید',
        operationKey: 'repro-nonpostable-1',
        lines: [
          {
            accountId: state.sub201003,
            debitAmount: '10000',
            creditAmount: '0',
          },
          {
            accountId: state.sub201004,
            debitAmount: '0',
            creditAmount: '10000',
          },
        ],
      })
      .expect(422);
    expect(doc.body.code).toBe('BusinessRuleViolation');
    expect(doc.body.details?.problem).toBe('account_not_postable');
  });

  it('names the fresh-org blocker precisely: numbering_series_missing (stable discriminator)', async () => {
    const a = await createAccount({
      code: '201005',
      title: 'ج',
      parentId: state.general201,
      isPostable: true,
    }).expect(201);
    const b = await createAccount({
      code: '201006',
      title: 'د',
      parentId: state.general201,
      isPostable: true,
    }).expect(201);
    state.subPostableA = a.body.id;
    state.subPostableB = b.body.id;
    expect(a.body.isPostable).toBe(true);

    const doc = await root
      .post('/api/v1/accounting-documents')
      .send({
        organizationId: state.org,
        financialAreaId: state.area,
        documentDate: '2026-04-05',
        description: 'سند متوازن بازتولید ۲',
        operationKey: 'repro-numbering-1',
        lines: [
          {
            accountId: state.subPostableA,
            debitAmount: '10000',
            creditAmount: '0',
          },
          {
            accountId: state.subPostableB,
            debitAmount: '0',
            creditAmount: '10000',
          },
        ],
      })
      .expect(422);
    expect(doc.body.code).toBe('BusinessRuleViolation');
    expect(String(doc.body.message)).toContain('numbering series');
    // The frontend classifies ONLY by stable details — the discriminator is
    // what lets it show the precise numbering message instead of a generic one.
    expect(doc.body.details?.problem).toBe('numbering_series_missing');
    expect(doc.body.details?.documentType).toBe('accounting_voucher');
  });

  it('after series configuration the balanced voucher composes, replays idempotently, and finalizes', async () => {
    await root
      .post('/api/v1/documents/numbering-series')
      .send({
        organizationId: state.org,
        documentType: 'accounting_voucher',
        scopeKey: state.area.toLowerCase(),
        name: 'Vouchers',
        strategy: 'monotonic',
        width: 4,
      })
      .expect(201);

    const payload = {
      organizationId: state.org,
      financialAreaId: state.area,
      documentDate: '2026-04-05',
      description: 'سند متوازن نهایی',
      operationKey: 'repro-ok-1',
      lines: [
        {
          accountId: state.subPostableA,
          debitAmount: '10000',
          creditAmount: '0',
        },
        {
          accountId: state.subPostableB,
          debitAmount: '0',
          creditAmount: '10000',
        },
      ],
    };
    const created = await root
      .post('/api/v1/accounting-documents')
      .send(payload)
      .expect(201);
    expect(created.body.state).toBe('temporary');
    expect(created.body.documentNumber).toBeTruthy();

    // Idempotent replay: same key + same intent → same document, no duplicate.
    const replay = await root
      .post('/api/v1/accounting-documents')
      .send(payload)
      .expect(201);
    expect(replay.body.id).toBe(created.body.id);

    const finalized = await root
      .post(`/api/v1/accounting-documents/${created.body.id}/finalize`)
      .query({ organizationId: state.org })
      .send({ operationKey: 'repro-fin-1' })
      .expect(200);
    expect(finalized.body.state).toBe('final');

    // Unbalanced stays refused.
    const unbalanced = await root
      .post('/api/v1/accounting-documents')
      .send({
        ...payload,
        operationKey: 'repro-unbalanced-1',
        lines: [
          {
            accountId: state.subPostableA,
            debitAmount: '10000',
            creditAmount: '0',
          },
          {
            accountId: state.subPostableB,
            debitAmount: '0',
            creditAmount: '9000',
          },
        ],
      })
      .expect(422);
    expect(unbalanced.body.details?.problems).toContain('unbalanced_document');
  });

  it('acceptance: balanced voucher over local-code-created معین (301003/301004) composes + finalizes', async () => {
    const created = await root
      .post('/api/v1/accounting-documents')
      .send({
        organizationId: state.org,
        financialAreaId: state.area,
        documentDate: '2026-04-05',
        description: 'سند پذیرش کدینگ محلی',
        operationKey: 'accept-local-1',
        lines: [
          {
            accountId: state.localSubA,
            debitAmount: '10000',
            creditAmount: '0',
          },
          {
            accountId: state.localSubB,
            debitAmount: '0',
            creditAmount: '10000',
          },
        ],
      })
      .expect(201);
    expect(created.body.state).toBe('temporary');
    const finalized = await root
      .post(`/api/v1/accounting-documents/${created.body.id}/finalize`)
      .query({ organizationId: state.org })
      .send({ operationKey: 'accept-local-fin-1' })
      .expect(200);
    expect(finalized.body.state).toBe('final');
  });

  it('refuses a line on an unknown account id with 404 (nothing partially written)', async () => {
    const missing = await root
      .post('/api/v1/accounting-documents')
      .send({
        organizationId: state.org,
        financialAreaId: state.area,
        documentDate: '2026-04-05',
        description: 'حساب ناموجود',
        operationKey: 'accept-missing-1',
        lines: [
          {
            accountId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
            debitAmount: '10000',
            creditAmount: '0',
          },
          {
            accountId: state.localSubB,
            debitAmount: '0',
            creditAmount: '10000',
          },
        ],
      })
      .expect(404);
    expect(missing.body.code).toBe('EntityNotFound');
  });
});

function buildPrismaStub(): PrismaService {
  const fail = (): never => {
    throw new Error('PrismaService must not be touched in e2e tests.');
  };
  return {
    getClient: fail,
    onModuleInit: async () => {},
    onModuleDestroy: async () => {},
    enableShutdownHooks: () => {},
  } as unknown as PrismaService;
}
