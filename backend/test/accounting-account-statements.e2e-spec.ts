import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../src/kernel/config/app-config.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { sumAmounts } from '../src/modules/accounting/domain/money.js';
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
import { AccountStatementsRepository } from '../src/modules/accounting/data/account-statements.repository.js';
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
import {
  createAccountStatementStores,
  type AccountStatementStores,
} from './support/account-statement-repositories.js';
import { createTestApp } from './support/test-app.js';

/**
 * Account statement (e2e, Task 17B Account Statement slice — Owner decisions
 * D1–D7, `docs/tasks/task-17/task-17b-prompt.md` §4).
 *
 * Boots the real application through the production HTTP pipeline
 * (controllers, AuthGuard + AuthorizationGuard, the permission registry and
 * its startup mirror, DTO validation + whitelist, error envelope) and drives
 * the ONE endpoint this task adds: `GET /api/v1/accounting/account-statements`.
 *
 * The fixture is a small but exact book: three in-year periods (sequence 1, 2
 * and 5 — a legal gap), posted vouchers with mixed debit/credit legs on the
 * cash account (including a same-date pair and a two-line voucher for the
 * `voucherNumber`/`lineNo` tie-breakers), a draft and a temporary voucher that
 * must never appear, and a second year whose statement must PROVE the
 * no-carry-forward rule of decision D2. Every expected amount is exact
 * decimal-string arithmetic a reviewer can check by hand.
 */
describe('Accounting account statements (e2e)', () => {
  let app: INestApplication;
  let stores: InMemoryStores;
  let master: MasterDataStores;
  let accounting: AccountingStores;
  let structure: StructureStores;
  let documentStores: DocumentStores;
  let vouchers: AccountingDocumentStores;
  let statements: AccountStatementStores;
  let users: UsersService;
  let roles: RolesService;
  let userRoles: UserRolesService;

  const ROOT = { username: 'as-root', password: 'as-root-secret' };
  const READER = { username: 'as-reader', password: 'as-reader-secret' };
  const MOVER = { username: 'as-mover', password: 'as-mover-secret' };
  const OPERATOR = { username: 'as-operator', password: 'as-operator-secret' };

  let root: ReturnType<typeof request.agent>;
  let reader: ReturnType<typeof request.agent>;
  let mover: ReturnType<typeof request.agent>;
  let operator: ReturnType<typeof request.agent>;

  const state = {
    orgA: '',
    orgB: '',
    orgDisabled: '',
    areaA: '',
    areaA2: '',
    /** 2026 — three periods (sequences 1, 2, 5) and every fixture voucher. */
    yearA: '',
    period1: '',
    period2: '',
    period5: '',
    /** 2027 — proves decision D2: no prior-year carry-forward exists. */
    yearB: '',
    periodB: '',
    cashA: '',
    revenueA: '',
    expenseA: '',
    nonPostableA: '',
    v1: '',
    v2: '',
    v3: '',
    v4: '',
    v5: '',
    vNextYear: '',
    draft: '',
    temporary: '',
  };

  const statementPath = '/api/v1/accounting/account-statements';

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
    statements = createAccountStatementStores({
      accounting: accounting.raw.state,
      structure: structure.raw.state,
      documents: vouchers.raw.state,
    });

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
          .overrideProvider(AccountStatementsRepository)
          .useValue(statements.statements)
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
    // AR-22 / §22: the statement code is registered at startup as the 36th
    // Accounting code (decision D6), and NOTHING it does not enforce exists —
    // the surface is read-only, so no Create/Execute/Export code may appear.
    expect(allCodes).toContain('Accounting.AccountStatement.View');
    expect(allCodes).not.toContain('Accounting.AccountStatement.Create');
    expect(allCodes).not.toContain('Accounting.AccountStatement.Execute');
    expect(allCodes).not.toContain('Accounting.AccountStatement.Export');

    const rootUser = await users.createUser({ ...ROOT });
    await userRoles.assignRoleToUser(
      (
        await roles.createRole({
          name: 'Statement root',
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
          name: 'Account statement reader',
          description: 'Reads account statements only (test fixture)',
          permissionCodes: ['Accounting.AccountStatement.View'],
        })
      ).id,
      readerUser.id,
    );
    const moverUser = await users.createUser({ ...MOVER });
    await userRoles.assignRoleToUser(
      (
        await roles.createRole({
          name: 'Movement reader',
          description: 'Reads ledger movements only (test fixture)',
          permissionCodes: ['Accounting.LedgerMovement.View'],
        })
      ).id,
      moverUser.id,
    );
    const operatorUser = await users.createUser({ ...OPERATOR });
    await userRoles.assignRoleToUser(
      (
        await roles.createRole({
          name: 'Voucher operator',
          description:
            'Composes and finalizes vouchers (test fixture) — holds no statement permission',
          permissionCodes: [
            'Accounting.Document.View',
            'Accounting.Document.Create',
            'Accounting.Document.Edit',
            'Accounting.Document.Finalize',
          ],
        })
      ).id,
      operatorUser.id,
    );

    root = request.agent(app.getHttpServer());
    reader = request.agent(app.getHttpServer());
    mover = request.agent(app.getHttpServer());
    operator = request.agent(app.getHttpServer());
    await root.post('/api/v1/auth/login').send(ROOT).expect(200);
    await reader.post('/api/v1/auth/login').send(READER).expect(200);
    await mover.post('/api/v1/auth/login').send(MOVER).expect(200);
    await operator.post('/api/v1/auth/login').send(OPERATOR).expect(200);

    // ---- fixture: two organizations, one disabled, one book in A ----------
    state.orgA = (
      await root
        .post('/api/v1/organizations')
        .send({ code: 'AST-A', name: 'Statement org A' })
        .expect(201)
    ).body.id as string;
    state.orgB = (
      await root
        .post('/api/v1/organizations')
        .send({ code: 'AST-B', name: 'Statement org B' })
        .expect(201)
    ).body.id as string;
    state.orgDisabled = (
      await root
        .post('/api/v1/organizations')
        .send({ code: 'AST-OFF', name: 'Statement org disabled' })
        .expect(201)
    ).body.id as string;

    // ODR-3 (Task 19): every persona below is a legitimate member of all
    // three organizations — the orgDisabled usability assertions must reach
    // the usability rule (422), not a scope refusal, and the cross-org
    // assertions are data-scoped.
    master.raw.memberships.seed(rootUser.id, state.orgA);
    master.raw.memberships.seed(rootUser.id, state.orgB);
    master.raw.memberships.seed(rootUser.id, state.orgDisabled);
    master.raw.memberships.seed(readerUser.id, state.orgA);
    master.raw.memberships.seed(readerUser.id, state.orgB);
    master.raw.memberships.seed(readerUser.id, state.orgDisabled);
    master.raw.memberships.seed(moverUser.id, state.orgA);
    master.raw.memberships.seed(moverUser.id, state.orgB);
    master.raw.memberships.seed(moverUser.id, state.orgDisabled);
    master.raw.memberships.seed(operatorUser.id, state.orgA);
    master.raw.memberships.seed(operatorUser.id, state.orgB);
    master.raw.memberships.seed(operatorUser.id, state.orgDisabled);

    state.areaA = (
      await root
        .post('/api/v1/financial-areas')
        .send({ organizationId: state.orgA, code: 'GA', title: 'General' })
        .expect(201)
    ).body.id as string;
    // A second, REAL area of org A: reachable (404-wise) but not the year's
    // area — the decision D4 mismatch case.
    state.areaA2 = (
      await root
        .post('/api/v1/financial-areas')
        .send({ organizationId: state.orgA, code: 'GS', title: 'Secondary' })
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
      isPostable = true,
    ): Promise<string> =>
      (
        await root
          .post('/api/v1/accounts')
          .send({
            organizationId: state.orgA,
            code,
            title,
            accountNature: 'DEBIT',
            isPostable,
          })
          .expect(201)
      ).body.id as string;
    state.cashA = await createAccount('1000', 'Cash');
    state.revenueA = await createAccount('2000', 'Revenue');
    state.expenseA = await createAccount('3000', 'Expense');
    state.nonPostableA = await createAccount('4000', 'Control', false);

    // ---- fixture: 2026 with three periods (sequences 1, 2, 5 — a gap) ------
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
    const createPeriod = async (
      sequence: number,
      title: string,
      startDate: string,
      endDate: string,
    ): Promise<string> =>
      (
        await root
          .post('/api/v1/accounting-periods')
          .send({
            organizationId: state.orgA,
            fiscalYearId: state.yearA,
            sequence,
            title,
            startDate,
            endDate,
          })
          .expect(201)
      ).body.id as string;
    state.period1 = await createPeriod(1, 'Jan', '2026-01-01', '2026-01-31');
    state.period2 = await createPeriod(2, 'Feb', '2026-02-01', '2026-02-28');
    // Sequence 5 — the 3–4 gap is legal (§7.1) and must be SKIPPED silently
    // by the sequence-based opening (decision D2).
    state.period5 = await createPeriod(5, 'Mar', '2026-03-01', '2026-03-31');

    // ---- fixture: 2027 — the no-carry-forward year (decision D2) ----------
    state.yearB = (
      await root
        .post('/api/v1/fiscal-years')
        .send({
          organizationId: state.orgA,
          financialAreaId: state.areaA,
          code: 'Y1406',
          title: 'Year 1406',
          startDate: '2027-01-01',
          endDate: '2027-12-31',
        })
        .expect(201)
    ).body.id as string;
    state.periodB = (
      await root
        .post('/api/v1/accounting-periods')
        .send({
          organizationId: state.orgA,
          fiscalYearId: state.yearB,
          sequence: 1,
          title: 'Year 1406 period 1',
          startDate: '2027-01-01',
          endDate: '2027-12-31',
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

    // ---- fixture: five posted cash movements + unposted noise -------------
    //
    // Cash-account ledger rows of 2026 in the FIXED statement order:
    //   2026-01-15 #0001 L1  D 100.50   running 100.50
    //   2026-02-10 #0002 L1  D  40.25   running 140.75
    //   2026-02-10 #0003 L1  D   2.50   running 143.25   ┐ same date and
    //   2026-02-10 #0003 L2  D   2.50   running 145.75   ┘ voucher, line tie
    //   2026-02-20 #0004 L2  C  10.25   running 135.50
    //   2026-03-05 #0005 L1  D   0.01   running 135.51
    const compose = async (
      documentDate: string,
      description: string,
      lines: Array<{
        accountId: string;
        debitAmount: string;
        creditAmount: string;
      }>,
    ): Promise<string> =>
      (
        await operator
          .post('/api/v1/accounting-documents')
          .send({
            organizationId: state.orgA,
            financialAreaId: state.areaA,
            documentDate,
            description,
            operationKey: `as-${description}-${Math.random().toString(36).slice(2)}`,
            lines,
          })
          .expect(201)
      ).body.id as string;

    const issue = async (id: string): Promise<void> => {
      await operator
        .post(`/api/v1/accounting-documents/${id}/issue`)
        .query({ organizationId: state.orgA })
        .send({ operationKey: `as-issue-${id}` })
        .expect(200);
    };

    const finalize = async (id: string): Promise<void> => {
      await operator
        .post(`/api/v1/accounting-documents/${id}/finalize`)
        .query({ organizationId: state.orgA })
        .send({ operationKey: `as-final-${id}` })
        .expect(200);
    };

    const post = async (
      documentDate: string,
      description: string,
      lines: Array<{
        accountId: string;
        debitAmount: string;
        creditAmount: string;
      }>,
    ): Promise<string> => {
      const id = await compose(documentDate, description, lines);
      await issue(id);
      await finalize(id);
      return id;
    };

    state.v1 = await post('2026-01-15', 'Jan rent paid', [
      { accountId: state.cashA, debitAmount: '100.50', creditAmount: '0' },
      { accountId: state.revenueA, debitAmount: '0', creditAmount: '100.50' },
    ]);
    state.v2 = await post('2026-02-10', 'Feb sale', [
      { accountId: state.cashA, debitAmount: '40.25', creditAmount: '0' },
      { accountId: state.revenueA, debitAmount: '0', creditAmount: '40.25' },
    ]);
    // Two CASH lines in one voucher — the `lineNo` tie-breaker of the order.
    state.v3 = await post('2026-02-10', 'Feb split deposit', [
      { accountId: state.cashA, debitAmount: '2.50', creditAmount: '0' },
      { accountId: state.cashA, debitAmount: '2.50', creditAmount: '0' },
      { accountId: state.revenueA, debitAmount: '0', creditAmount: '5.00' },
    ]);
    // Cash on line 2, credited — a negative net row (decision D3).
    state.v4 = await post('2026-02-20', 'Feb refund', [
      { accountId: state.revenueA, debitAmount: '10.25', creditAmount: '0' },
      { accountId: state.cashA, debitAmount: '0', creditAmount: '10.25' },
    ]);
    state.v5 = await post('2026-03-05', 'Mar cent', [
      { accountId: state.cashA, debitAmount: '0.01', creditAmount: '0' },
      { accountId: state.revenueA, debitAmount: '0', creditAmount: '0.01' },
    ]);

    // The next-year movement: 2027's statement must open at `0` — the 2026
    // closing of 135.51 is NOT carried forward (decision D2; ADR-0031 §9).
    state.vNextYear = await post('2027-01-15', 'Next year sale', [
      { accountId: state.cashA, debitAmount: '10', creditAmount: '0' },
      { accountId: state.revenueA, debitAmount: '0', creditAmount: '10' },
    ]);

    // Never posted: a draft and an issued-but-not-final voucher. Their cash
    // legs (999 / 888) must never touch any statement — posted-only ledger.
    state.draft = await compose('2026-03-06', 'Draft never posted', [
      { accountId: state.cashA, debitAmount: '999', creditAmount: '0' },
      { accountId: state.revenueA, debitAmount: '0', creditAmount: '999' },
    ]);
    state.temporary = await compose('2026-03-07', 'Issued never posted', [
      { accountId: state.cashA, debitAmount: '888', creditAmount: '0' },
      { accountId: state.revenueA, debitAmount: '0', creditAmount: '888' },
    ]);
    await issue(state.temporary);

    // A foreign organization's posted movement: a genuine row that must stay
    // unreachable from every org-A statement.
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

  const read = (
    agent: ReturnType<typeof request.agent>,
    query: Record<string, string | number>,
  ): request.Test => agent.get(statementPath).query(query);

  const cashYearA = (): Record<string, string> => ({
    organizationId: state.orgA,
    accountId: state.cashA,
    fiscalYearId: state.yearA,
  });

  // ---- authentication and authorization ------------------------------------

  it('answers 401 for an anonymous request (no data, no scope guess)', async () => {
    await request(app.getHttpServer())
      .get(statementPath)
      .query({ ...cashYearA() })
      .expect(401);
  });

  it('answers 403 for a movement reader — the statement has its OWN code (D6)', async () => {
    const res = await read(mover, { ...cashYearA() }).expect(403);
    expect(res.body).toMatchObject({ code: 'PermissionDenied' });
  });

  it('answers 403 for a document operator without the statement code', async () => {
    await read(operator, { ...cashYearA() }).expect(403);
  });

  it('answers 200 for the holder of Accounting.AccountStatement.View alone', async () => {
    await read(reader, { ...cashYearA() }).expect(200);
  });

  // ---- envelope and the whole-year statement -------------------------------

  it('returns the declared envelope: scope echo, movements, totals, disclosures', async () => {
    const res = await read(reader, { ...cashYearA() }).expect(200);
    expect(res.body.scope).toEqual({
      organizationId: state.orgA,
      financialArea: { id: state.areaA, code: 'GA', title: 'General' },
      fiscalYear: {
        id: state.yearA,
        code: 'Y1405',
        title: 'Year 1405',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        status: 'open',
      },
      account: { id: state.cashA, code: '1000', title: 'Cash' },
      accountingPeriod: null,
    });
    // D3: the account echo carries code/title — never a nature/classification.
    expect(res.body.scope.account).not.toHaveProperty('accountNature');
    expect(res.body.scope.account).not.toHaveProperty('account_type');
    expect(res.body.movements).toMatchObject({
      total: 6,
      page: 1,
      pageSize: 100,
    });
    expect(res.body.totals).toEqual({
      openingBalanceAmount: '0',
      debitTotalAmount: '145.76',
      creditTotalAmount: '10.25',
      netChangeAmount: '135.51',
      closingBalanceAmount: '135.51',
    });
    // D2/D3 disclosures are closed values, echoed so a reader can never
    // mistake the convention.
    expect(res.body.signConvention).toBe('debit-positive');
    expect(res.body.openingBasis).toBe('intra-fiscal-year');
    expect(res.body.orderBasis).toBe('documentDate,voucherNumber,lineNo,id');
  });

  it('opens the whole year at 0 and chains one running balance over the rows', async () => {
    const res = await read(reader, { ...cashYearA() }).expect(200);
    const rows = res.body.movements.items as Array<Record<string, unknown>>;
    expect(
      rows.map((row) => [
        row.documentDate,
        row.voucherNumber,
        row.lineNo,
        row.debitAmount,
        row.creditAmount,
        row.netAmount,
        row.runningBalanceAmount,
      ]),
    ).toEqual([
      ['2026-01-15', '0001', 1, '100.5', '0', '100.5', '100.5'],
      ['2026-02-10', '0002', 1, '40.25', '0', '40.25', '140.75'],
      ['2026-02-10', '0003', 1, '2.5', '0', '2.5', '143.25'],
      ['2026-02-10', '0003', 2, '2.5', '0', '2.5', '145.75'],
      ['2026-02-20', '0004', 2, '0', '10.25', '-10.25', '135.5'],
      ['2026-03-05', '0005', 1, '0.01', '0', '0.01', '135.51'],
    ]);
    // Posted-only source: the draft's 999 and the temporary's 888 are absent
    // (and the vouchers themselves exist — the exclusion is the ledger's
    // lifecycle, not a missing fixture).
    const voucherIds = rows.map((row) => row.voucherId);
    expect(voucherIds).not.toContain(state.draft);
    expect(voucherIds).not.toContain(state.temporary);
    await operator
      .get(`/api/v1/accounting-documents/${state.draft}`)
      .query({ organizationId: state.orgA })
      .expect(200);
    // Traceability fields travel with every row.
    for (const row of rows) {
      expect(row).toHaveProperty('voucherId');
      expect(row).toHaveProperty('voucherLineId');
      expect(row).toHaveProperty('description');
      expect(String(row.postingTimestamp)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('keeps opening + net = closing as an exact identity (page after page)', async () => {
    for (const pageSize of [1, 2, 6, 100]) {
      const res = await read(reader, { ...cashYearA(), pageSize }).expect(200);
      const totals = res.body.totals;
      // Exact decimal arithmetic (never Number/float): opening + net = closing.
      expect(
        sumAmounts([totals.openingBalanceAmount, totals.netChangeAmount]),
      ).toBe(totals.closingBalanceAmount);
      expect(totals).toEqual({
        openingBalanceAmount: '0',
        debitTotalAmount: '145.76',
        creditTotalAmount: '10.25',
        netChangeAmount: '135.51',
        closingBalanceAmount: '135.51',
      });
    }
  });

  it('carries the running balance across pages without a page-local reset', async () => {
    const page1 = await read(reader, {
      ...cashYearA(),
      page: 1,
      pageSize: 2,
    }).expect(200);
    const page2 = await read(reader, {
      ...cashYearA(),
      page: 2,
      pageSize: 2,
    }).expect(200);
    const page3 = await read(reader, {
      ...cashYearA(),
      page: 3,
      pageSize: 2,
    }).expect(200);
    const running = [
      ...(page1.body.movements.items as Array<{
        runningBalanceAmount: string;
      }>),
      ...(page2.body.movements.items as Array<{
        runningBalanceAmount: string;
      }>),
      ...(page3.body.movements.items as Array<{
        runningBalanceAmount: string;
      }>),
    ].map((row) => row.runningBalanceAmount);
    expect(running).toEqual([
      '100.5',
      '140.75',
      '143.25',
      '145.75',
      '135.5',
      '135.51',
    ]);
    // The last row of the full window lands exactly on the closing balance.
    expect(running[running.length - 1]).toBe(
      page3.body.totals.closingBalanceAmount,
    );
  });

  it('computes totals over the whole window — identical on every page', async () => {
    const page1 = await read(reader, {
      ...cashYearA(),
      page: 1,
      pageSize: 2,
    }).expect(200);
    const page2 = await read(reader, {
      ...cashYearA(),
      page: 2,
      pageSize: 2,
    }).expect(200);
    const beyond = await read(reader, {
      ...cashYearA(),
      page: 9,
      pageSize: 2,
    }).expect(200);
    expect(page2.body.totals).toEqual(page1.body.totals);
    expect(beyond.body.totals).toEqual(page1.body.totals);
    // …and the beyond-end page is empty but honest about the total.
    expect(beyond.body.movements.items).toEqual([]);
    expect(beyond.body.movements.total).toBe(6);
  });

  it('serves an all-zero statement for a postable account with no activity', async () => {
    const res = await read(reader, {
      ...cashYearA(),
      accountId: state.expenseA,
    }).expect(200);
    expect(res.body.movements.items).toEqual([]);
    expect(res.body.movements.total).toBe(0);
    expect(res.body.totals).toEqual({
      openingBalanceAmount: '0',
      debitTotalAmount: '0',
      creditTotalAmount: '0',
      netChangeAmount: '0',
      closingBalanceAmount: '0',
    });
  });

  // ---- period windows and the intra-year opening (D2) ----------------------

  it('opens the FIRST period at 0 — nothing prior in-year exists', async () => {
    const res = await read(reader, {
      ...cashYearA(),
      accountingPeriodId: state.period1,
    }).expect(200);
    expect(res.body.scope.accountingPeriod).toMatchObject({
      id: state.period1,
      sequence: 1,
      title: 'Jan',
    });
    expect(res.body.totals.openingBalanceAmount).toBe('0');
    expect(res.body.movements.total).toBe(1);
    expect(res.body.totals.closingBalanceAmount).toBe('100.5');
  });

  it('opens a MIDDLE period at the prior-sequence net (gap sequences skipped)', async () => {
    const res = await read(reader, {
      ...cashYearA(),
      accountingPeriodId: state.period2,
    }).expect(200);
    // Opening = period 1's net = 100.5 (sequence 1 < 2).
    expect(res.body.totals.openingBalanceAmount).toBe('100.5');
    // Four cash rows in February: V2's one leg, V3's two legs, V4's credit.
    expect(res.body.movements.total).toBe(4);
    expect(
      (res.body.movements.items as Array<{ runningBalanceAmount: string }>).map(
        (row) => row.runningBalanceAmount,
      ),
    ).toEqual(['140.75', '143.25', '145.75', '135.5']);
    expect(res.body.totals).toMatchObject({
      debitTotalAmount: '45.25',
      creditTotalAmount: '10.25',
      netChangeAmount: '35',
      closingBalanceAmount: '135.5',
    });
  });

  it('opens the LAST period (sequence 5 — after a gap) at the exact in-year prior net', async () => {
    const res = await read(reader, {
      ...cashYearA(),
      accountingPeriodId: state.period5,
    }).expect(200);
    // Opening = net(periods 1 + 2) = 100.5 + 35 = 135.5. The nonexistent
    // sequences 3–4 are skipped silently — never invented, never estimated.
    expect(res.body.totals.openingBalanceAmount).toBe('135.5');
    expect(res.body.movements.total).toBe(1);
    expect(res.body.movements.items[0]).toMatchObject({
      netAmount: '0.01',
      runningBalanceAmount: '135.51',
    });
    expect(res.body.totals.closingBalanceAmount).toBe('135.51');
  });

  it('NEVER carries a prior year forward: 2027 opens at 0, not at 2026’s closing', async () => {
    const previous = await read(reader, { ...cashYearA() }).expect(200);
    expect(previous.body.totals.closingBalanceAmount).toBe('135.51');

    const next = await read(reader, {
      ...cashYearA(),
      fiscalYearId: state.yearB,
      accountingPeriodId: state.periodB,
    }).expect(200);
    // Decision D2 / ADR-0031 §9 — the deliberate boundary of THIS slice:
    // intra-fiscal-year only. The 2026 closing does not exist here.
    expect(next.body.totals.openingBalanceAmount).toBe('0');
    expect(next.body.totals).toEqual({
      openingBalanceAmount: '0',
      debitTotalAmount: '10',
      creditTotalAmount: '0',
      netChangeAmount: '10',
      closingBalanceAmount: '10',
    });
    expect(next.body.openingBasis).toBe('intra-fiscal-year');
    // The year window holds 2027's rows only.
    expect(next.body.movements.total).toBe(1);
    expect(next.body.movements.items[0]).toMatchObject({
      voucherId: state.vNextYear,
      documentDate: '2027-01-15',
    });
  });

  it('rejects a period of ANOTHER fiscal year with 422 (exists; out of scope)', async () => {
    await read(reader, {
      ...cashYearA(),
      accountingPeriodId: state.periodB,
    }).expect(422);
  });

  // ---- scope-key error matrix (AC-I-16) and the D4 area posture ------------

  it('answers 404 for a foreign/unknown account, year or period (never 403)', async () => {
    await read(reader, {
      ...cashYearA(),
      accountId: '01HZZZZZZZZZZZZZZZZZZZZZZ7',
    }).expect(404);
    await read(reader, {
      ...cashYearA(),
      fiscalYearId: '01HZZZZZZZZZZZZZZZZZZZZZZ3',
    }).expect(404);
    await read(reader, {
      ...cashYearA(),
      accountingPeriodId: '01HZZZZZZZZZZZZZZZZZZZZZZ4',
    }).expect(404);
  });

  it('answers 404 for a foreign financial-area id and 422 for a real foreign area (D4)', async () => {
    await read(reader, {
      ...cashYearA(),
      financialAreaId: '01HZZZZZZZZZZZZZZZZZZZZZZ2',
    }).expect(404);
    // Area A2 genuinely exists — but it is not the year's area.
    await read(reader, {
      ...cashYearA(),
      financialAreaId: state.areaA2,
    }).expect(422);
    // The year's own area id is accepted (explicit, optional).
    await read(reader, {
      ...cashYearA(),
      financialAreaId: state.areaA,
    }).expect(200);
  });

  it('answers 422 for a non-postable account (rollups are not this slice, D1)', async () => {
    await read(reader, {
      ...cashYearA(),
      accountId: state.nonPostableA,
    }).expect(422);
  });

  it('answers 422 for a disabled organization before any scope read', async () => {
    await master.raw.organizations.update(state.orgDisabled, {
      isActive: false,
    });
    await read(reader, {
      organizationId: state.orgDisabled,
      accountId: state.cashA,
      fiscalYearId: state.yearA,
    }).expect(422);
  });

  it('resolves the organization server-side (unknown organization answers 404)', async () => {
    await read(reader, {
      organizationId: '01HZZZZZZZZZZZZZZZZZZZZZZ8',
      accountId: state.cashA,
      fiscalYearId: state.yearA,
    }).expect(404);
  });

  it('never returns another organization’s rows — foreign ids stay 404-empty', async () => {
    const res = await read(reader, { ...cashYearA() }).expect(200);
    expect(JSON.stringify(res.body)).not.toContain('Org B movement');
    expect(JSON.stringify(res.body)).not.toContain('777.77');
    expect(JSON.stringify(res.body)).not.toContain(
      '01HZZZZZZZZZZZZZZZZZZZZZZZ',
    );
  });

  // ---- filter surface (§12) ----------------------------------------------

  it('refuses an explicit sort with 400 — the statement order is fixed (§11)', async () => {
    await read(reader, { ...cashYearA(), sort: 'documentDate:desc' }).expect(
      400,
    );
  });

  it('refuses undeclared parameters with 400 (whitelist validation)', async () => {
    await read(reader, { ...cashYearA(), voucherNumber: '0001' }).expect(400);
    await read(reader, { ...cashYearA(), dateFrom: '2026-01-01' }).expect(400);
    await read(reader, { ...cashYearA(), status: 'open' }).expect(400);
    await read(reader, { ...cashYearA(), accountNature: 'debit' }).expect(400);
  });

  it('bounds paging: default 100, hard max 500, no page below 1', async () => {
    const defaults = await read(reader, { ...cashYearA() }).expect(200);
    expect(defaults.body.movements.pageSize).toBe(100);
    const capped = await read(reader, { ...cashYearA(), pageSize: 500 }).expect(
      200,
    );
    expect(capped.body.movements.pageSize).toBe(500);
    await read(reader, { ...cashYearA(), pageSize: 501 }).expect(400);
    await read(reader, { ...cashYearA(), page: 0 }).expect(400);
  });

  // ---- period statuses are readable, never a read filter (D5) --------------

  it('reads OPEN, CLOSED and SEALED periods alike and echoes status without changing it', async () => {
    // Close 1, seal 5 — reads must behave identically (decision D5).
    accounting.raw.state.periods.patch(state.period1, { status: 'closed' });
    accounting.raw.state.periods.patch(state.period5, { status: 'sealed' });

    const first = await read(reader, {
      ...cashYearA(),
      accountingPeriodId: state.period1,
    }).expect(200);
    const middle = await read(reader, {
      ...cashYearA(),
      accountingPeriodId: state.period2,
    }).expect(200);
    const last = await read(reader, {
      ...cashYearA(),
      accountingPeriodId: state.period5,
    }).expect(200);

    expect(first.body.scope.accountingPeriod.status).toBe('closed');
    expect(middle.body.scope.accountingPeriod.status).toBe('open');
    expect(last.body.scope.accountingPeriod.status).toBe('sealed');
    // The sealed period's rows are still fully readable…
    expect(last.body.movements.total).toBe(1);
    expect(last.body.totals.closingBalanceAmount).toBe('135.51');
    // …and reading did not revalidate, reopen or otherwise touch the status.
    expect(accounting.raw.state.periods.findById(state.period1)?.status).toBe(
      'closed',
    );
    expect(accounting.raw.state.periods.findById(state.period5)?.status).toBe(
      'sealed',
    );
  });

  // ---- no mutation path and no-mutation regression (§24, AC-I-19) ----------

  it('does not expose a mutation path on the resource', async () => {
    // There is no POST/PUT/PATCH/DELETE route: the statement cannot write
    // anything — it is computed per request and never persisted.
    await request(app.getHttpServer())
      .post(statementPath)
      .send({ ...cashYearA() })
      .expect(404);
    await request(app.getHttpServer())
      .put(statementPath)
      .send({ ...cashYearA() })
      .expect(404);
    await request(app.getHttpServer())
      .patch(statementPath)
      .send({ ...cashYearA() })
      .expect(404);
    await reader.delete(statementPath).expect(404);
  });

  it('mutates nothing: ledger, vouchers, accounts, periods and projections stay byte-identical', async () => {
    const snapshot = {
      ledger: vouchers.raw.state.ledgerEntries.snapshot(),
      documents: vouchers.raw.state.documents.snapshot(),
      lines: vouchers.raw.state.lines.snapshot(),
      operations: vouchers.raw.state.operations.snapshot(),
      accounts: structure.raw.state.accounts.snapshot(),
      periods: accounting.raw.state.periods.snapshot(),
      years: accounting.raw.state.years.snapshot(),
      areas: accounting.raw.state.areas.snapshot(),
    };

    // A representative batch of reads across every window shape.
    await read(reader, { ...cashYearA() }).expect(200);
    await read(reader, { ...cashYearA(), page: 2, pageSize: 2 }).expect(200);
    await read(reader, {
      ...cashYearA(),
      accountingPeriodId: state.period5,
    }).expect(200);
    await read(reader, {
      ...cashYearA(),
      fiscalYearId: state.yearB,
      accountingPeriodId: state.periodB,
    }).expect(200);
    await read(reader, { ...cashYearA(), accountId: state.expenseA }).expect(
      200,
    );

    expect(vouchers.raw.state.ledgerEntries.snapshot()).toEqual(
      snapshot.ledger,
    );
    expect(vouchers.raw.state.documents.snapshot()).toEqual(snapshot.documents);
    expect(vouchers.raw.state.lines.snapshot()).toEqual(snapshot.lines);
    expect(vouchers.raw.state.operations.snapshot()).toEqual(
      snapshot.operations,
    );
    expect(structure.raw.state.accounts.snapshot()).toEqual(snapshot.accounts);
    expect(accounting.raw.state.periods.snapshot()).toEqual(snapshot.periods);
    expect(accounting.raw.state.years.snapshot()).toEqual(snapshot.years);
    expect(accounting.raw.state.areas.snapshot()).toEqual(snapshot.areas);
    // The projection surface is not even reachable here: PrismaService is a
    // fail-on-touch stub, and the statement repository is the in-memory read
    // fake — no projection store exists to write to. (The live suite proves
    // the same property against `account_balance_projections` rows.)
  });

  // ---- deployment pin ------------------------------------------------------

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
          .overrideProvider(AccountStatementsRepository)
          .useValue(statements.statements)
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
      await pinnedAgent
        .get(statementPath)
        .query({ ...cashYearA() })
        .expect(200);
      // …and the other organization is not merely empty: it is not there.
      await pinnedAgent
        .get(statementPath)
        .query({
          organizationId: state.orgB,
          accountId: state.cashA,
          fiscalYearId: state.yearA,
        })
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
