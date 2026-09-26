import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../src/kernel/config/app-config.js';
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
import {
  createInMemoryStores,
  type InMemoryStores,
} from './support/in-memory-repositories.js';
import {
  createMasterDataStores,
  type MasterDataStores,
} from './support/master-data-repositories.js';
import {
  createAccountingStores,
  type AccountingStores,
} from './support/accounting-repositories.js';
import {
  createStructureStores,
  type StructureStores,
} from './support/accounting-structure-repositories.js';
import {
  createDocumentStores,
  type DocumentStores,
} from './support/document-repositories.js';
import {
  createAccountingDocumentStores,
  type AccountingDocumentStores,
} from './support/accounting-document-repositories.js';
import { createTestApp } from './support/test-app.js';

/**
 * Ledger movements (e2e, Task 17A — contract §19.1/§19.2 AC-D-30, §13/§15).
 *
 * Boots the real application through the production HTTP pipeline (controllers,
 * AuthGuard + AuthorizationGuard, the permission registry and its startup
 * mirror, DTO validation, error envelope) and drives the one endpoint this task
 * adds: `GET /api/v1/accounting/ledger-movements`.
 *
 * The suite proves the properties that make the source safe to build reports
 * on, end to end:
 *
 * - only POSTED movements are visible — a draft and an issued-but-not-final
 *   voucher contribute zero rows, and the same vouchers' rows appear the moment
 *   finalization commits;
 * - the organization scope cannot be widened by any client input: another
 *   organization's movements never answer, a foreign voucher/account filter
 *   returns an empty page instead of foreign rows, and a pinned deployment
 *   answers 404 for any other organization;
 * - the read is permission-gated by the NEW movement code (document/balance
 *   readers do not qualify), and anonymous access is 401;
 * - filters (account, business-date window, voucher id and serial), paging and
 *   the deterministic order behave as documented, including the empty result;
 * - amounts cross the wire as exact decimal strings;
 * - no mutation path exists on the resource.
 */
describe('Accounting ledger movements (e2e)', () => {
  let app: INestApplication;
  let stores: InMemoryStores;
  let master: MasterDataStores;
  let accounting: AccountingStores;
  let structure: StructureStores;
  let documentStores: DocumentStores;
  let vouchers: AccountingDocumentStores;
  let users: UsersService;
  let roles: RolesService;
  let userRoles: UserRolesService;

  const ROOT = { username: 'lm-root', password: 'lm-root-secret' };
  const READER = { username: 'lm-reader', password: 'lm-reader-secret' };
  const DOC_READER = {
    username: 'lm-doc-reader',
    password: 'lm-doc-reader-secret',
  };
  const OPERATOR = { username: 'lm-operator', password: 'lm-operator-secret' };

  let root: ReturnType<typeof request.agent>;
  let reader: ReturnType<typeof request.agent>;
  let docReader: ReturnType<typeof request.agent>;
  let operator: ReturnType<typeof request.agent>;

  const state = {
    orgA: '',
    orgB: '',
    areaA: '',
    yearA: '',
    periodA: '',
    cashA: '',
    revenueA: '',
    /** Finalized vouchers of org A, in their business-date order. */
    finalizedFirst: '',
    finalizedSecond: '',
    /** A draft: composed, never issued, never final. */
    draft: '',
    /** Issued (temporary) but never finalized. */
    temporary: '',
  };

  const ledgerPath = '/api/v1/accounting/ledger-movements';

  beforeAll(async () => {
    stores = createInMemoryStores();
    master = createMasterDataStores();
    accounting = createAccountingStores();
    const holder: { stores: AccountingDocumentStores | null } = {
      stores: null,
    };
    structure = createStructureStores({
      lineUsage: {
        countForAccount: (accountId) =>
          holder.stores === null
            ? 0
            : holder.stores.raw.state.lines.findMany(
                (line) => line.accountId === accountId,
              ).length,
      },
    });
    documentStores = createDocumentStores();
    vouchers = createAccountingDocumentStores({
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
          .useValue(documentStores.typeConfigs)
          .overrideProvider(NumberingSeriesRepository)
          .useValue(documentStores.numberingSeries)
          .overrideProvider(NumberingAllocationsRepository)
          .useValue(documentStores.numberingAllocations)
          .overrideProvider(DocumentRelationsRepository)
          .useValue(documentStores.relations),
    });
    app = rebuilt.app;
    users = app.get(UsersService);
    roles = app.get(RolesService);
    userRoles = app.get(UserRolesService);

    const allCodes = app
      .get(PermissionRegistry)
      .all()
      .map((definition) => definition.code);
    // AR-22 / §22: the movement code must be registered at startup, and the
    // codes nothing enforces must not exist.
    expect(allCodes).toContain('Accounting.LedgerMovement.View');
    expect(allCodes).not.toContain('Accounting.LedgerMovement.Create');

    const rootUser = await users.createUser({ ...ROOT });
    await userRoles.assignRoleToUser(
      (
        await roles.createRole({
          name: 'Ledger root',
          description: 'Bootstrap administrator (test fixture)',
          permissionCodes: allCodes,
        })
      ).id,
      rootUser.id,
    );
    const readerUser = await users.createUser({ ...READER });
    await userRoles.assignRoleToUser(
      (
        await roles.createRole({
          name: 'Ledger movement reader',
          description: 'Reads ledger movements only (test fixture)',
          permissionCodes: ['Accounting.LedgerMovement.View'],
        })
      ).id,
      readerUser.id,
    );
    const docReaderUser = await users.createUser({ ...DOC_READER });
    await userRoles.assignRoleToUser(
      (
        await roles.createRole({
          name: 'Document reader',
          description: 'Reads documents only (test fixture)',
          permissionCodes: [
            'Accounting.Document.View',
            'Accounting.Balance.View',
          ],
        })
      ).id,
      docReaderUser.id,
    );
    const operatorUser = await users.createUser({ ...OPERATOR });
    await userRoles.assignRoleToUser(
      (
        await roles.createRole({
          name: 'Voucher operator',
          description:
            'Composes and finalizes vouchers and reads movements (test fixture)',
          permissionCodes: [
            'Accounting.Document.View',
            'Accounting.Document.Create',
            'Accounting.Document.Edit',
            'Accounting.Document.Finalize',
            'Accounting.LedgerMovement.View',
          ],
        })
      ).id,
      operatorUser.id,
    );

    root = request.agent(app.getHttpServer());
    reader = request.agent(app.getHttpServer());
    docReader = request.agent(app.getHttpServer());
    operator = request.agent(app.getHttpServer());
    await root.post('/api/v1/auth/login').send(ROOT).expect(200);
    await reader.post('/api/v1/auth/login').send(READER).expect(200);
    await docReader.post('/api/v1/auth/login').send(DOC_READER).expect(200);
    await operator.post('/api/v1/auth/login').send(OPERATOR).expect(200);

    // ---- fixture: two organizations, one configured book in A --------------
    state.orgA = (
      await root
        .post('/api/v1/organizations')
        .send({ code: 'LMOV-A', name: 'Ledger movement org A' })
        .expect(201)
    ).body.id as string;
    state.orgB = (
      await root
        .post('/api/v1/organizations')
        .send({ code: 'LMOV-B', name: 'Ledger movement org B' })
        .expect(201)
    ).body.id as string;
    // ODR-3 (Task 19): every persona below is a legitimate member of both
    // organizations (the cross-org assertions are data-scoped).
    master.raw.memberships.seed(rootUser.id, state.orgA);
    master.raw.memberships.seed(rootUser.id, state.orgB);
    master.raw.memberships.seed(readerUser.id, state.orgA);
    master.raw.memberships.seed(readerUser.id, state.orgB);
    master.raw.memberships.seed(docReaderUser.id, state.orgA);
    master.raw.memberships.seed(docReaderUser.id, state.orgB);
    master.raw.memberships.seed(operatorUser.id, state.orgA);
    master.raw.memberships.seed(operatorUser.id, state.orgB);

    state.areaA = (
      await root
        .post('/api/v1/financial-areas')
        .send({ organizationId: state.orgA, code: 'GA', title: 'General' })
        .expect(201)
    ).body.id as string;

    const version = (
      await root
        .post('/api/v1/coding-structures')
        .send({
          organizationId: state.orgA,
          code: 'DEFAULT',
          maxDepth: 1,
          separator: '',
          levels: [
            {
              levelIndex: 1,
              title: 'Account',
              digitLength: 4,
              defaultIsPostable: true,
              levelKind: 'detail',
            },
          ],
        })
        .expect(201)
    ).body.id as string;
    await root
      .post(`/api/v1/coding-structures/${version}/publish`)
      .query({ organizationId: state.orgA })
      .expect(200);

    const configuration = (
      await root
        .post('/api/v1/accounting-configurations')
        .send({
          organizationId: state.orgA,
          code: 'DEFAULT',
          name: 'Default Accounting Config',
          levels: [
            {
              levelIndex: 1,
              title: 'Account',
              digitLength: 4,
              defaultIsPostable: true,
              levelKind: 'detail',
            },
          ],
        })
        .expect(201)
    ).body.id as string;
    await root
      .post(`/api/v1/accounting-configurations/${configuration}/publish`)
      .query({ organizationId: state.orgA })
      .expect(200);

    const createAccount = async (
      code: string,
      title: string,
    ): Promise<string> =>
      (
        await root
          .post('/api/v1/accounts')
          .send({
            organizationId: state.orgA,
            code,
            title,
            accountNature: 'debit',
            isPostable: true,
          })
          .expect(201)
      ).body.id as string;
    state.cashA = await createAccount('1000', 'Cash');
    state.revenueA = await createAccount('2000', 'Revenue');

    state.yearA = (
      await root
        .post('/api/v1/fiscal-years')
        .send({
          organizationId: state.orgA,
          financialAreaId: state.areaA,
          code: 'Y1405',
          title: 'Year 1405',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        })
        .expect(201)
    ).body.id as string;
    state.periodA = (
      await root
        .post('/api/v1/accounting-periods')
        .send({
          organizationId: state.orgA,
          fiscalYearId: state.yearA,
          sequence: 1,
          title: 'Whole year',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        })
        .expect(201)
    ).body.id as string;

    await root
      .post('/api/v1/documents/numbering-series')
      .send({
        organizationId: state.orgA,
        documentType: 'accounting_voucher',
        scopeKey: state.areaA.toLowerCase(),
        name: 'Vouchers (General)',
        strategy: 'monotonic',
        width: 4,
      })
      .expect(201);
    await root
      .put('/api/v1/documents/types/accounting_voucher/configuration')
      .query({ organizationId: state.orgA })
      .send({ draftRequired: true })
      .expect(200);

    // ---- fixture: four vouchers, two of them posted ------------------------
    const compose = async (
      documentDate: string,
      description: string,
      debitAmount: string,
    ): Promise<string> =>
      (
        await operator
          .post('/api/v1/accounting-documents')
          .send({
            organizationId: state.orgA,
            financialAreaId: state.areaA,
            documentDate,
            description,
            operationKey: `lm-${description}-${Math.random().toString(36).slice(2)}`,
            lines: [
              { accountId: state.cashA, debitAmount, creditAmount: '0' },
              {
                accountId: state.revenueA,
                debitAmount: '0',
                creditAmount: debitAmount,
              },
            ],
          })
          .expect(201)
      ).body.id as string;

    const issue = async (id: string): Promise<void> => {
      await operator
        .post(`/api/v1/accounting-documents/${id}/issue`)
        .query({ organizationId: state.orgA })
        .send({ operationKey: `lm-issue-${id}` })
        .expect(200);
    };

    const finalize = async (id: string): Promise<void> => {
      await operator
        .post(`/api/v1/accounting-documents/${id}/finalize`)
        .query({ organizationId: state.orgA })
        .send({ operationKey: `lm-final-${id}` })
        .expect(200);
    };

    state.draft = await compose('2026-04-01', 'Draft never posted', '10.00');

    state.temporary = await compose(
      '2026-04-02',
      'Issued never posted',
      '20.00',
    );
    await issue(state.temporary);

    state.finalizedFirst = await compose(
      '2026-04-03',
      'Posted first',
      '1250.50',
    );
    await issue(state.finalizedFirst);
    await finalize(state.finalizedFirst);

    state.finalizedSecond = await compose(
      '2026-04-04',
      'Posted second',
      '0.01',
    );
    await issue(state.finalizedSecond);
    await finalize(state.finalizedSecond);

    // A foreign organization's posted movements: rows that genuinely exist and
    // must stay unreachable from every org-A request. Seeded straight into the
    // ledger table because composing org B's chart is not what this suite is
    // about (the posting path itself is covered by its own suites).
    vouchers.raw.state.ledgerEntries.seed({
      id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
      organizationId: state.orgB,
      financialAreaId: '01HZZZZZZZZZZZZZZZZZZZZZZ2',
      fiscalYearId: '01HZZZZZZZZZZZZZZZZZZZZZZ3',
      accountingPeriodId: '01HZZZZZZZZZZZZZZZZZZZZZZ4',
      voucherId: '01HZZZZZZZZZZZZZZZZZZZZZZ5',
      voucherNumber: '9999',
      voucherLineId: '01HZZZZZZZZZZZZZZZZZZZZZZ6',
      lineNo: 1,
      accountId: '01HZZZZZZZZZZZZZZZZZZZZZZ7',
      debitAmount: '777.77',
      creditAmount: '0',
      description: 'Org B movement',
      documentDate: new Date(Date.UTC(2026, 3, 3)),
      postingTimestamp: new Date('2026-04-03T00:00:00.000Z'),
      branchId: null,
      origin: 'manual',
      sourceModule: null,
      sourceEntityType: null,
      sourceEntityId: null,
      sourceOperation: null,
      correlationId: null,
      finalizedBy: null,
      createdAt: new Date('2026-04-03T00:00:00.000Z'),
      updatedAt: new Date('2026-04-03T00:00:00.000Z'),
      createdBy: null,
    });
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  const list = (
    agent: ReturnType<typeof request.agent>,
    query: Record<string, string | number>,
  ): request.Test => agent.get(ledgerPath).query(query);

  // ---- authentication and authorization ------------------------------------

  it('answers 401 for an anonymous request (no data, no scope guess)', async () => {
    await request(app.getHttpServer())
      .get(ledgerPath)
      .query({ organizationId: state.orgA })
      .expect(401);
  });

  it('answers 403 for a caller without Accounting.LedgerMovement.View', async () => {
    // A document/balance reader holds real Accounting read permissions — and
    // still cannot read the posted ledger under them.
    const res = await list(docReader, { organizationId: state.orgA }).expect(
      403,
    );
    expect(res.body).toMatchObject({ code: 'PermissionDenied' });
    expect(JSON.stringify(res.body)).not.toContain('LedgerMovement');
  });

  // ---- posted-only source ---------------------------------------------------

  it('returns only POSTED movements: the draft and the temporary voucher have none', async () => {
    const res = await list(reader, { organizationId: state.orgA }).expect(200);

    const voucherIds = (res.body.items as Array<{ voucherId: string }>).map(
      (item) => item.voucherId,
    );
    // Two finalized vouchers × two lines each = four movements.
    expect(res.body.total).toBe(4);
    expect(new Set(voucherIds)).toEqual(
      new Set([state.finalizedFirst, state.finalizedSecond]),
    );
    expect(voucherIds).not.toContain(state.draft);
    expect(voucherIds).not.toContain(state.temporary);
    // …and the un-posted vouchers really do exist (the exclusion is the
    // ledger's lifecycle, not a fixture that never composed them).
    await operator
      .get(`/api/v1/accounting-documents/${state.draft}`)
      .query({ organizationId: state.orgA })
      .expect(200);
  });

  it('returns the authoritative movement fields with exact decimal strings', async () => {
    const res = await list(reader, {
      organizationId: state.orgA,
      voucherId: state.finalizedFirst,
    }).expect(200);

    expect(res.body.total).toBe(2);
    const first = res.body.items[0];
    expect(first).toMatchObject({
      organizationId: state.orgA,
      financialAreaId: state.areaA,
      fiscalYearId: state.yearA,
      accountingPeriodId: state.periodA,
      voucherId: state.finalizedFirst,
      lineNo: 1,
      accountId: state.cashA,
      debitAmount: '1250.5',
      creditAmount: '0',
      documentDate: '2026-04-03',
      origin: 'manual',
      sourceModule: null,
      sourceEntityType: null,
      sourceEntityId: null,
      sourceOperation: null,
    });
    expect(typeof first.id).toBe('string');
    expect(typeof first.voucherNumber).toBe('string');
    expect(first.voucherLineId).toBeTruthy();
    expect(String(first.postingTimestamp)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The wire carries exact decimal STRINGS — a JSON number here would have
    // silently reintroduced binary floating point (§13.1).
    expect(typeof first.debitAmount).toBe('string');
    expect(typeof first.creditAmount).toBe('string');

    const second = res.body.items[1];
    expect(second).toMatchObject({
      lineNo: 2,
      accountId: state.revenueA,
      debitAmount: '0',
      creditAmount: '1250.5',
    });
  });

  it('keeps a tiny exact amount exact (no float rounding on the way out)', async () => {
    const res = await list(reader, {
      organizationId: state.orgA,
      voucherId: state.finalizedSecond,
    }).expect(200);
    expect(res.body.items[0].debitAmount).toBe('0.01');
  });

  // ---- tenant isolation -----------------------------------------------------

  it('never returns another organization’s movements', async () => {
    const resA = await list(reader, { organizationId: state.orgA }).expect(200);
    const ids = (resA.body.items as Array<{ id: string }>).map(
      (item) => item.id,
    );
    expect(ids).not.toContain('01HZZZZZZZZZZZZZZZZZZZZZZZ');
    expect(resA.body.total).toBe(4);

    // The foreign rows DO exist: asking for org B returns them (this
    // deployment is unpinned, so org B is readable by an authorized caller).
    const resB = await list(reader, { organizationId: state.orgB }).expect(200);
    expect(resB.body.total).toBe(1);
    expect(resB.body.items[0]).toMatchObject({
      organizationId: state.orgB,
      debitAmount: '777.77',
      description: 'Org B movement',
    });
  });

  it('cannot reach foreign rows through a foreign voucher, account or area filter', async () => {
    // Org A + org B's voucher id: no row, no leak, no existence oracle.
    await list(reader, {
      organizationId: state.orgA,
      voucherId: '01HZZZZZZZZZZZZZZZZZZZZZZ5',
    })
      .expect(200)
      .expect((res) => {
        expect(res.body.items).toEqual([]);
        expect(res.body.total).toBe(0);
      });

    // Org A + org B's account id — same result.
    await list(reader, {
      organizationId: state.orgA,
      accountId: '01HZZZZZZZZZZZZZZZZZZZZZZ7',
    })
      .expect(200)
      .expect((res) => {
        expect(res.body.items).toEqual([]);
        expect(res.body.total).toBe(0);
      });

    // Org A + org B's financial area — same result.
    await list(reader, {
      organizationId: state.orgA,
      financialAreaId: '01HZZZZZZZZZZZZZZZZZZZZZZ2',
    })
      .expect(200)
      .expect((res) => {
        expect(res.body.items).toEqual([]);
      });
  });

  it('resolves the organization server-side (unknown organization answers 404)', async () => {
    await list(reader, { organizationId: '01HZZZZZZZZZZZZZZZZZZZZZZ8' }).expect(
      404,
    );
  });

  // ---- filters --------------------------------------------------------------

  it('filters by account', async () => {
    const res = await list(reader, {
      organizationId: state.orgA,
      accountId: state.revenueA,
    }).expect(200);
    expect(res.body.total).toBe(2);
    for (const item of res.body.items as Array<{ accountId: string }>) {
      expect(item.accountId).toBe(state.revenueA);
    }
  });

  it('filters by an inclusive business-date window', async () => {
    const window = await list(reader, {
      organizationId: state.orgA,
      dateFrom: '2026-04-03',
      dateTo: '2026-04-03',
    }).expect(200);
    expect(window.body.total).toBe(2);
    for (const item of window.body.items as Array<{ documentDate: string }>) {
      expect(item.documentDate).toBe('2026-04-03');
    }

    const openEnded = await list(reader, {
      organizationId: state.orgA,
      dateFrom: '2026-04-04',
    }).expect(200);
    expect(openEnded.body.total).toBe(2);

    const nothingBefore = await list(reader, {
      organizationId: state.orgA,
      dateTo: '2026-04-02',
    }).expect(200);
    expect(nothingBefore.body.total).toBe(0);
  });

  it('filters by the stored period and year resolutions', async () => {
    const res = await list(reader, {
      organizationId: state.orgA,
      financialAreaId: state.areaA,
      fiscalYearId: state.yearA,
      accountingPeriodId: state.periodA,
    }).expect(200);
    expect(res.body.total).toBe(4);
  });

  it('handles an empty result with the standard envelope, not a 404', async () => {
    const res = await list(reader, {
      organizationId: state.orgA,
      accountId: '01HZZZZZZZZZZZZZZZZZZZZZZ9',
    }).expect(200);
    expect(res.body).toEqual({ items: [], total: 0, page: 1, pageSize: 100 });
  });

  // ---- ordering and pagination ---------------------------------------------

  it('orders deterministically and pages without gaps or duplicates', async () => {
    const all = await list(reader, {
      organizationId: state.orgA,
      pageSize: 100,
    }).expect(200);
    const orderedIds = (all.body.items as Array<{ id: string }>).map(
      (item) => item.id,
    );
    expect(orderedIds).toHaveLength(4);

    const firstPage = await list(reader, {
      organizationId: state.orgA,
      page: 1,
      pageSize: 2,
    }).expect(200);
    const secondPage = await list(reader, {
      organizationId: state.orgA,
      page: 2,
      pageSize: 2,
    }).expect(200);
    expect(firstPage.body.total).toBe(4);
    expect(secondPage.body.total).toBe(4);
    expect([
      ...firstPage.body.items.map((item: { id: string }) => item.id),
      ...secondPage.body.items.map((item: { id: string }) => item.id),
    ]).toEqual(orderedIds);

    // The default order is the legal-book reading order: business date, then
    // the voucher serial, then the line ordinal.
    const keys = (
      all.body.items as Array<{
        documentDate: string;
        voucherNumber: string;
        lineNo: number;
      }>
    ).map(
      (item) => `${item.documentDate}|${item.voucherNumber}|${item.lineNo}`,
    );
    expect(keys).toEqual([...keys].sort());
  });

  it('accepts a whitelisted sort and rejects anything else', async () => {
    const res = await list(reader, {
      organizationId: state.orgA,
      sort: 'postingTimestamp:desc',
    }).expect(200);
    expect(res.body.total).toBe(4);

    const rejected = await list(reader, {
      organizationId: state.orgA,
      sort: 'debitAmount:desc',
    }).expect(400);
    expect(rejected.body).toMatchObject({ code: 'ValidationFailed' });
  });

  it('serves a page beyond the end as an empty page with the true total', async () => {
    const res = await list(reader, {
      organizationId: state.orgA,
      page: 9,
      pageSize: 2,
    }).expect(200);
    expect(res.body).toEqual({ items: [], total: 4, page: 9, pageSize: 2 });
  });

  // ---- validation -----------------------------------------------------------

  it('rejects a request that carries no organization scope at all with 400', async () => {
    await reader.get(ledgerPath).expect(400);
  });

  it.each([
    ['a malformed organization id', { organizationId: 'not-a-ulid' }],
    ['a malformed account id', { accountId: 'not-a-ulid' }],
    ['a malformed financial area id', { financialAreaId: 'nope' }],
    ['a malformed voucher id', { voucherId: 'nope' }],
    [
      'a voucher number above the column width',
      { voucherNumber: '9'.repeat(33) },
    ],
    ['a malformed business date', { dateFrom: '2026-02-30' }],
    ['a date that is not date-only', { dateTo: '2026-04-03T10:00:00Z' }],
    ['a page below 1', { page: 0 }],
    ['a page size above the cap', { pageSize: 501 }],
    ['an unknown filter field', { unknownFilter: 'x' }],
  ])('rejects %s with 400', async (_label, query) => {
    await list(reader, {
      organizationId: state.orgA,
      ...(query as Record<string, string | number>),
    }).expect(400);
  });

  it('does not expose a mutation path on the resource', async () => {
    // There is no POST/PATCH/DELETE route: the source cannot write anything,
    // so accounting truth has no mutation surface here (AC-I-05/06).
    await operator
      .post(ledgerPath)
      .query({ organizationId: state.orgA })
      .send({})
      .expect(404);
    await operator.patch(`${ledgerPath}/anything`).expect(404);
    await operator.delete(`${ledgerPath}/anything`).expect(404);
  });

  // ---- deployment pin -------------------------------------------------------

  it('confines a pinned deployment to its own organization (404, never 403)', async () => {
    const pinned = await createTestApp({
      override: (builder) =>
        builder
          .overrideProvider(APP_CONFIG)
          .useValue({
            ...app.get(APP_CONFIG),
            deploymentOrganizationId: state.orgA,
          })
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
          .useValue(documentStores.typeConfigs)
          .overrideProvider(NumberingSeriesRepository)
          .useValue(documentStores.numberingSeries)
          .overrideProvider(NumberingAllocationsRepository)
          .useValue(documentStores.numberingAllocations)
          .overrideProvider(DocumentRelationsRepository)
          .useValue(documentStores.relations),
    });
    const pinnedAgent = request.agent(pinned.app.getHttpServer());
    try {
      await pinnedAgent.post('/api/v1/auth/login').send(READER).expect(200);
      // The pinned organization still reads fine…
      const own = await pinnedAgent
        .get(ledgerPath)
        .query({ organizationId: state.orgA })
        .expect(200);
      expect(own.body.total).toBe(4);
      // …and the other organization is not merely empty: it is not there.
      await pinnedAgent
        .get(ledgerPath)
        .query({ organizationId: state.orgB })
        .expect(404);
    } finally {
      await pinned.app.close();
    }
  }, 60_000);
});

/** The e2e convention: the database is never touched — a failing read is loud. */
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
