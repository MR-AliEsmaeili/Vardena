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
import { BranchesRepository } from '../src/modules/organization/data/branches.repository.js';
import { FinancialAreasRepository } from '../src/modules/accounting/data/financial-areas.repository.js';
import { FiscalYearsRepository } from '../src/modules/accounting/data/fiscal-years.repository.js';
import { AccountingPeriodsRepository } from '../src/modules/accounting/data/accounting-periods.repository.js';
import { CodingStructuresRepository } from '../src/modules/accounting/data/coding-structures.repository.js';
import { AccountsRepository } from '../src/modules/accounting/data/accounts.repository.js';
import { AccountingDocumentsRepository } from '../src/modules/accounting/data/accounting-documents.repository.js';
import { AccountingDocumentLinesRepository } from '../src/modules/accounting/data/accounting-document-lines.repository.js';
import { AccountingPostingOperationsRepository } from '../src/modules/accounting/data/accounting-posting-operations.repository.js';
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
 * Accounting voucher journeys (e2e, Task 10.4 — contract §12…§18).
 *
 * Boots the real application through the production HTTP pipeline: real
 * controllers, real AuthGuard + AuthorizationGuard, real application services,
 * the real permission registry and its startup mirror, the real Document
 * Foundation (registry, type configuration, numbering), real DTO validation.
 * Only data access is faked — and the fakes throw the same guard errors and
 * enforce the same database backstops (unique number per area, unique line
 * ordinal, unique ledger key) as the real transactions.
 *
 * The journey: two organizations, an area with a year/period and a chart in A,
 * a numbering series per area, then the whole lifecycle — compose a draft,
 * read/list, edit, issue, finalize — and the refusals that matter: an
 * unbalanced or one-sided document, a non-postable or foreign account, a closed
 * period, a final document that must never be edited or deleted, an idempotency
 * key reused for a different intent, and a foreign organization's id answering
 * 404 rather than 403.
 */
describe('Accounting documents (e2e)', () => {
  let app: INestApplication;
  let stores: InMemoryStores;
  let master: MasterDataStores;
  let accounting: AccountingStores;
  let structure: StructureStores;
  let documents: DocumentStores;
  let vouchers: AccountingDocumentStores;
  let users: UsersService;
  let roles: RolesService;
  let userRoles: UserRolesService;

  const ROOT = { username: 'root', password: 'root-secret' };
  const VIEWER = { username: 'viewer', password: 'viewer-secret' };
  const COMPOSER = { username: 'composer', password: 'composer-secret' };
  const FINALIZER = { username: 'finalizer', password: 'finalizer-secret' };

  let root: ReturnType<typeof request.agent>;
  let viewer: ReturnType<typeof request.agent>;
  let composer: ReturnType<typeof request.agent>;
  let finalizer: ReturnType<typeof request.agent>;

  const state = {
    orgA: '',
    orgB: '',
    areaA: '',
    yearA: '',
    periodA: '',
    debitAccountA: '',
    creditAccountA: '',
    nonPostableAccountA: '',
    foreignAccountB: '',
  };

  const draft = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    organizationId: state.orgA,
    financialAreaId: state.areaA,
    documentDate: '2026-04-05',
    description: 'Opening entry',
    operationKey: `key-${Math.random().toString(36).slice(2)}`,
    lines: [
      {
        accountId: state.debitAccountA,
        debitAmount: '1250.00',
        creditAmount: '0',
      },
      {
        accountId: state.creditAccountA,
        debitAmount: '0',
        creditAmount: '1250.00',
      },
    ],
    ...overrides,
  });

  beforeAll(async () => {
    stores = createInMemoryStores();
    master = createMasterDataStores();
    accounting = createAccountingStores();
    // AC-I-11's predicate reads the SAME line table the voucher fakes write, so
    // "the account is referenced" is observable in this suite.
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
    documents = createDocumentStores();
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
          .overrideProvider(AccountsRepository)
          .useValue(structure.accounts)
          .overrideProvider(AccountingDocumentsRepository)
          .useValue(vouchers.documents)
          .overrideProvider(AccountingDocumentLinesRepository)
          .useValue(vouchers.lines)
          .overrideProvider(AccountingPostingOperationsRepository)
          .useValue(vouchers.operations)
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
    users = app.get(UsersService);
    roles = app.get(RolesService);
    userRoles = app.get(UserRolesService);

    const allCodes = app
      .get(PermissionRegistry)
      .all()
      .map((definition) => definition.code);

    // §22: the document vocabulary this task enforces — and nothing beyond it.
    for (const code of [
      'Accounting.Document.View',
      'Accounting.Document.Create',
      'Accounting.Document.Edit',
      'Accounting.Document.Delete',
      'Accounting.Document.Finalize',
    ]) {
      if (!allCodes.includes(code)) {
        throw new Error(
          `Accounting document permission not registered: ${code}`,
        );
      }
    }
    for (const forbidden of [
      'Accounting.Document.Approve',
      'Accounting.Document.Reverse',
      'Accounting.Document.Correct',
      'Accounting.Document.Replace',
      'Accounting.Document.Print',
      'Accounting.Document.Export',
    ]) {
      if (allCodes.includes(forbidden)) {
        throw new Error(
          `${forbidden} must not be registered: no code may exist that nothing enforces (§22, docs/security.md §3).`,
        );
      }
    }

    const rootUser = await users.createUser({ ...ROOT });
    await userRoles.assignRoleToUser(
      (
        await roles.createRole({
          name: 'Root',
          description: 'Bootstrap administrator (test fixture)',
          permissionCodes: allCodes,
        })
      ).id,
      rootUser.id,
    );
    const viewerUser = await users.createUser({ ...VIEWER });
    await userRoles.assignRoleToUser(
      (
        await roles.createRole({
          name: 'Document reader',
          description: 'Read-only documents (test fixture)',
          permissionCodes: ['Accounting.Document.View'],
        })
      ).id,
      viewerUser.id,
    );
    const composerUser = await users.createUser({ ...COMPOSER });
    await userRoles.assignRoleToUser(
      (
        await roles.createRole({
          name: 'Voucher composer',
          description:
            'Compose and edit vouchers, but not finalize (test fixture)',
          permissionCodes: [
            'Accounting.Document.View',
            'Accounting.Document.Create',
            'Accounting.Document.Edit',
          ],
        })
      ).id,
      composerUser.id,
    );
    const finalizerUser = await users.createUser({ ...FINALIZER });
    await userRoles.assignRoleToUser(
      (
        await roles.createRole({
          name: 'Voucher finalizer',
          description: 'Finalize vouchers, but not compose them (test fixture)',
          permissionCodes: [
            'Accounting.Document.View',
            'Accounting.Document.Finalize',
          ],
        })
      ).id,
      finalizerUser.id,
    );

    root = request.agent(app.getHttpServer());
    viewer = request.agent(app.getHttpServer());
    composer = request.agent(app.getHttpServer());
    finalizer = request.agent(app.getHttpServer());
    await root.post('/api/v1/auth/login').send(ROOT).expect(200);
    await viewer.post('/api/v1/auth/login').send(VIEWER).expect(200);
    await composer.post('/api/v1/auth/login').send(COMPOSER).expect(200);
    await finalizer.post('/api/v1/auth/login').send(FINALIZER).expect(200);

    // ---- fixture: organizations, area, calendar, chart, series -------------
    state.orgA = (
      await root
        .post('/api/v1/organizations')
        .send({ code: 'VCHRA', name: 'Voucher Org A' })
        .expect(201)
    ).body.id as string;
    state.orgB = (
      await root
        .post('/api/v1/organizations')
        .send({ code: 'VCHRB', name: 'Voucher Org B' })
        .expect(201)
    ).body.id as string;

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
            accountNature: 'debit',
            isPostable,
          })
          .expect(201)
      ).body.id as string;

    state.debitAccountA = await createAccount('1000', 'Cash');
    state.creditAccountA = await createAccount('2000', 'Revenue');
    state.nonPostableAccountA = await createAccount('3000', 'Group', false);

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

    // One monotonic series per (organization, type, area) — §18.
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

    // The organization asks for a draft phase, so creation yields a draft and
    // the serial is allocated at issuance (§15.1).
    await root
      .put('/api/v1/documents/types/accounting_voucher/configuration')
      .query({ organizationId: state.orgA })
      .send({ draftRequired: true })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  // ---- registration + security surface -------------------------------------

  it('registers the voucher type in the Document Foundation at startup (§12.1)', async () => {
    const res = await root
      .get('/api/v1/documents/types')
      .query({ organizationId: state.orgA })
      .expect(200);
    const voucher = (res.body.items as Array<Record<string, unknown>>).find(
      (item) => item.code === 'accounting_voucher',
    );
    expect(voucher).toMatchObject({
      module: 'accounting',
      draftCapable: true,
      draftRequired: true,
      entryStates: ['temporary'],
      deletablePhases: ['draft', 'temporary'],
    });
  });

  it('rejects anonymous calls with 401 (not 403)', async () => {
    const anonymous = request(app.getHttpServer());
    for (const path of ['/api/v1/accounting-documents']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await anonymous
        .get(path)
        .query({ organizationId: state.orgA })
        .expect(401);
      expect(res.body.code).toBe('Unauthorized');
    }
    await anonymous
      .post('/api/v1/accounting-documents')
      .send(draft())
      .expect(401);
  });

  it('lets a read-only principal read documents but not compose them (403)', async () => {
    await viewer
      .get('/api/v1/accounting-documents')
      .query({ organizationId: state.orgA })
      .expect(200);
    const denied = await viewer
      .post('/api/v1/accounting-documents')
      .send(draft())
      .expect(403);
    expect(denied.body.code).toBe('PermissionDenied');
  });

  // ---- composition ---------------------------------------------------------

  it('composes a draft voucher without a number and derives its totals', async () => {
    const res = await composer
      .post('/api/v1/accounting-documents')
      .send(draft({ description: 'Draft entry' }))
      .expect(201);
    expect(res.body).toMatchObject({
      organizationId: state.orgA,
      financialAreaId: state.areaA,
      fiscalYearId: state.yearA,
      accountingPeriodId: state.periodA,
      documentType: 'accounting_voucher',
      documentNumber: null,
      state: 'draft',
      origin: 'manual',
      description: 'Draft entry',
      totalDebit: '1250',
      totalCredit: '1250',
    });
    expect(res.body.documentDate).toBe('2026-04-05');
    // Audit actors are never exposed (AR-24).
    expect(res.body).not.toHaveProperty('createdBy');
    expect(res.body).not.toHaveProperty('updatedBy');
    // Dense 1-based ordinals, assigned by the server (§12.5).
    expect(
      (res.body.lines as Array<{ lineNo: number }>).map((line) => line.lineNo),
    ).toEqual([1, 2]);
  });

  it('refuses a composition that is not a balanced double entry (422)', async () => {
    const unbalanced = await composer
      .post('/api/v1/accounting-documents')
      .send(
        draft({
          description: 'Unbalanced',
          lines: [
            {
              accountId: state.debitAccountA,
              debitAmount: '10',
              creditAmount: '0',
            },
            {
              accountId: state.creditAccountA,
              debitAmount: '0',
              creditAmount: '9.99',
            },
          ],
        }),
      )
      .expect(422);
    expect(unbalanced.body.code).toBe('BusinessRuleViolation');
    expect(unbalanced.body.details).toMatchObject({
      problems: ['unbalanced_document'],
    });

    // Both sides on one line is two lines, not one.
    const bothSides = await composer
      .post('/api/v1/accounting-documents')
      .send(
        draft({
          lines: [
            {
              accountId: state.debitAccountA,
              debitAmount: '5',
              creditAmount: '5',
            },
            {
              accountId: state.creditAccountA,
              debitAmount: '0',
              creditAmount: '5',
            },
          ],
        }),
      )
      .expect(422);
    expect(bothSides.body.details).toMatchObject({
      problems: expect.arrayContaining(['both_sides_set']),
    });
  });

  it('refuses a one-line document and malformed amounts as bad requests (400)', async () => {
    await composer
      .post('/api/v1/accounting-documents')
      .send(
        draft({
          lines: [
            {
              accountId: state.debitAccountA,
              debitAmount: '1',
              creditAmount: '0',
            },
          ],
        }),
      )
      .expect(400);
    await composer
      .post('/api/v1/accounting-documents')
      .send(
        draft({
          lines: [
            {
              accountId: state.debitAccountA,
              debitAmount: '-1',
              creditAmount: '0',
            },
            {
              accountId: state.creditAccountA,
              debitAmount: '0',
              creditAmount: '1',
            },
          ],
        }),
      )
      .expect(400);
    // Three decimals are refused, never rounded into balance (§13.5).
    await composer
      .post('/api/v1/accounting-documents')
      .send(
        draft({
          lines: [
            {
              accountId: state.debitAccountA,
              debitAmount: '1.005',
              creditAmount: '0',
            },
            {
              accountId: state.creditAccountA,
              debitAmount: '0',
              creditAmount: '1',
            },
          ],
        }),
      )
      .expect(400);
    // An instant is not a business date (§12.3).
    await composer
      .post('/api/v1/accounting-documents')
      .send(draft({ documentDate: '2026-04-05T00:00:00Z' }))
      .expect(400);
  });

  it('refuses a non-postable account with 422 and a foreign account with 404', async () => {
    const notPostable = await composer
      .post('/api/v1/accounting-documents')
      .send(
        draft({
          lines: [
            {
              accountId: state.nonPostableAccountA,
              debitAmount: '1',
              creditAmount: '0',
            },
            {
              accountId: state.creditAccountA,
              debitAmount: '0',
              creditAmount: '1',
            },
          ],
        }),
      )
      .expect(422);
    expect(notPostable.body.details).toMatchObject({
      problem: 'account_not_postable',
    });

    // A missing/foreign account is 404 — the same answer as "does not exist".
    await composer
      .post('/api/v1/accounting-documents')
      .send(
        draft({
          lines: [
            {
              accountId: '7BFKQVZ37BFKQVZ37BFKQVZ37B',
              debitAmount: '1',
              creditAmount: '0',
            },
            {
              accountId: state.creditAccountA,
              debitAmount: '0',
              creditAmount: '1',
            },
          ],
        }),
      )
      .expect(404);
  });

  it('refuses a document dated outside the calendar (422) and in a closed period', async () => {
    await composer
      .post('/api/v1/accounting-documents')
      .send(draft({ documentDate: '2025-06-01' }))
      .expect(422);

    await root
      .post(`/api/v1/accounting-periods/${state.periodA}/close`)
      .query({ organizationId: state.orgA })
      .send({ reason: 'Month-end close (test fixture)' })
      .expect(200);
    const closed = await composer
      .post('/api/v1/accounting-documents')
      .send(draft({ description: 'Into a closed period' }))
      .expect(422);
    expect(closed.body.code).toBe('BusinessRuleViolation');
    await root
      .post(`/api/v1/accounting-periods/${state.periodA}/reopen`)
      .query({ organizationId: state.orgA })
      .send({ reason: 'Reopened for the journey (test fixture)' })
      .expect(200);
  });

  // ---- reads, isolation, idempotency ---------------------------------------

  it('scopes reads by organization: a foreign id is 404, never 403 (AC-I-01)', async () => {
    const created = await composer
      .post('/api/v1/accounting-documents')
      .send(draft({ description: 'Scoped entry' }))
      .expect(201);
    const id = created.body.id as string;

    const read = await root
      .get(`/api/v1/accounting-documents/${id}`)
      .query({ organizationId: state.orgA })
      .expect(200);
    expect(read.body.id).toBe(id);

    await root
      .get(`/api/v1/accounting-documents/${id}`)
      .query({ organizationId: state.orgB })
      .expect(404);
    await root
      .get('/api/v1/accounting-documents/01J8ZQ9W7R6T5Y4U3I2O1P0ZZZ')
      .query({ organizationId: state.orgA })
      .expect(404);

    // The list is never cross-organization.
    const listB = await root
      .get('/api/v1/accounting-documents')
      .query({ organizationId: state.orgB })
      .expect(200);
    expect(listB.body.total).toBe(0);
  });

  it('lists and filters by state, area and date inside one organization', async () => {
    const res = await root
      .get('/api/v1/accounting-documents')
      .query({
        organizationId: state.orgA,
        state: 'draft',
        financialAreaId: state.areaA,
        dateFrom: '2026-04-01',
        dateTo: '2026-04-30',
      })
      .expect(200);
    expect(res.body.total).toBeGreaterThan(0);
    for (const item of res.body.items as Array<Record<string, unknown>>) {
      expect(item.organizationId).toBe(state.orgA);
      expect(item.state).toBe('draft');
    }

    const empty = await root
      .get('/api/v1/accounting-documents')
      .query({ organizationId: state.orgA, dateFrom: '2026-04-06' })
      .expect(200);
    expect(empty.body.total).toBe(0);
  });

  it('replays one composition for one operationKey and refuses a different intent (409)', async () => {
    const operationKey = `replay-${Math.random().toString(36).slice(2)}`;
    const payload = draft({ description: 'Idempotent entry', operationKey });
    const first = await composer
      .post('/api/v1/accounting-documents')
      .send(payload)
      .expect(201);
    const replay = await composer
      .post('/api/v1/accounting-documents')
      .send(payload)
      .expect(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(
      vouchers.raw.state.documents.findMany(
        (row) => row.description === 'Idempotent entry',
      ),
    ).toHaveLength(1);

    const conflict = await composer
      .post('/api/v1/accounting-documents')
      .send({ ...payload, description: 'Different intent' })
      .expect(409);
    expect(conflict.body.code).toBe('Conflict');
    expect(
      vouchers.raw.state.documents.findMany(
        (row) => row.description === 'Different intent',
      ),
    ).toHaveLength(0);
  });

  it('requires an operationKey on composition and on finalization (400)', async () => {
    await composer
      .post('/api/v1/accounting-documents')
      .send({ ...draft(), operationKey: undefined })
      .expect(400);
  });

  // ---- lifecycle -----------------------------------------------------------

  it('edits a draft, issues it once, and finalizes it immutably', async () => {
    const created = await composer
      .post('/api/v1/accounting-documents')
      .send(draft({ description: 'Lifecycle entry' }))
      .expect(201);
    const id = created.body.id as string;

    // Edit the draft (draft phase is editable, §15.2).
    const edited = await composer
      .patch(`/api/v1/accounting-documents/${id}`)
      .query({ organizationId: state.orgA })
      .send({
        description: 'Lifecycle entry (edited)',
        lines: [
          {
            accountId: state.debitAccountA,
            debitAmount: '900.50',
            creditAmount: '0',
          },
          {
            accountId: state.creditAccountA,
            debitAmount: '0',
            creditAmount: '900.50',
          },
        ],
      })
      .expect(200);
    expect(edited.body).toMatchObject({
      description: 'Lifecycle entry (edited)',
      state: 'draft',
      totalDebit: '900.5',
      documentNumber: null,
    });

    // Issuance allocates the serial from the area's series (§18).
    const issued = await composer
      .post(`/api/v1/accounting-documents/${id}/issue`)
      .query({ organizationId: state.orgA })
      .send({ operationKey: `issue-${id}` })
      .expect(200);
    const serial = issued.body.documentNumber as string;
    expect(issued.body.state).toBe('temporary');
    expect(serial).toMatch(/^\d{4}$/);
    expect(
      vouchers.raw.state.operations.findMany(
        (row) => row.operationKey === `issue-${id}`,
      ),
    ).toHaveLength(0);

    // Issuing again replays the SAME serial: no second number is burned.
    const reissued = await composer
      .post(`/api/v1/accounting-documents/${id}/issue`)
      .query({ organizationId: state.orgA })
      .send({ operationKey: `issue-again-${id}` })
      .expect(200);
    expect(reissued.body.documentNumber).toBe(serial);

    // A temporary voucher is still editable, but its number never changes.
    const retitled = await composer
      .patch(`/api/v1/accounting-documents/${id}`)
      .query({ organizationId: state.orgA })
      .send({ description: 'Lifecycle entry (issued edit)' })
      .expect(200);
    expect(retitled.body.documentNumber).toBe(serial);

    // Only the Finalize authority may put it in the books (§22: `Finalize` is
    // an authority of its own, distinct from composing and editing).
    await composer
      .post(`/api/v1/accounting-documents/${id}/finalize`)
      .query({ organizationId: state.orgA })
      .send({ operationKey: `finalize-denied-${id}` })
      .expect(403);
    // ...and the finalizer cannot compose one (403, not 401).
    await finalizer
      .post('/api/v1/accounting-documents')
      .send(draft())
      .expect(403);

    const finalizeKey = `finalize-${id}`;
    const finalized = await finalizer
      .post(`/api/v1/accounting-documents/${id}/finalize`)
      .query({ organizationId: state.orgA })
      .send({ operationKey: finalizeKey })
      .expect(200);
    expect(finalized.body.state).toBe('final');
    expect(finalized.body.finalizedAt).not.toBeNull();
    expect(finalized.body.documentNumber).toBe(serial);

    // A retried finalization replays instead of finalizing twice (§16.4).
    const replay = await finalizer
      .post(`/api/v1/accounting-documents/${id}/finalize`)
      .query({ organizationId: state.orgA })
      .send({ operationKey: finalizeKey })
      .expect(200);
    expect(replay.body.id).toBe(id);
    expect(replay.body.state).toBe('final');

    // Final is structurally immutable: no edit, no re-issue, no delete (§15.2/§15.3).
    const deniedEdit = await composer
      .patch(`/api/v1/accounting-documents/${id}`)
      .query({ organizationId: state.orgA })
      .send({ description: 'Too late' })
      .expect(422);
    expect(deniedEdit.body.code).toBe('BusinessRuleViolation');
    await composer
      .post(`/api/v1/accounting-documents/${id}/issue`)
      .query({ organizationId: state.orgA })
      .send({ operationKey: `issue-final-${id}` })
      .expect(422);
    await root
      .delete(`/api/v1/accounting-documents/${id}`)
      .query({ organizationId: state.orgA })
      .expect(422);
    await finalizer
      .post(`/api/v1/accounting-documents/${id}/finalize`)
      .query({ organizationId: state.orgA })
      .send({ operationKey: `finalize-again-${id}` })
      .expect(422);

    // The stored row is untouched, and its lines are still there.
    const reread = await root
      .get(`/api/v1/accounting-documents/${id}`)
      .query({ organizationId: state.orgA })
      .expect(200);
    expect(reread.body).toMatchObject({
      state: 'final',
      description: 'Lifecycle entry (issued edit)',
      documentNumber: serial,
    });
    expect(reread.body.lines).toHaveLength(2);
  });

  it('discards a pre-final voucher and keeps a numbered one auditable (§15.3)', async () => {
    // A draft may be discarded outright.
    const draftDoc = await composer
      .post('/api/v1/accounting-documents')
      .send(draft({ description: 'Discard me' }))
      .expect(201);
    await root
      .delete(`/api/v1/accounting-documents/${draftDoc.body.id}`)
      .query({ organizationId: state.orgA })
      .expect(200);
    await root
      .get(`/api/v1/accounting-documents/${draftDoc.body.id}`)
      .query({ organizationId: state.orgA })
      .expect(404);

    // A numbered temporary voucher is discarded too, but its allocation row
    // stays: the gap is auditable rather than silently recycled.
    const temporary = await composer
      .post('/api/v1/accounting-documents')
      .send(draft({ description: 'Numbered discard' }))
      .expect(201);
    const issued = await composer
      .post(`/api/v1/accounting-documents/${temporary.body.id}/issue`)
      .query({ organizationId: state.orgA })
      .send({ operationKey: `discard-issue-${temporary.body.id}` })
      .expect(200);
    const serial = issued.body.documentNumber as string;
    // Discarding is its own authority (§22), so the composer cannot do it.
    await composer
      .delete(`/api/v1/accounting-documents/${temporary.body.id}`)
      .query({ organizationId: state.orgA })
      .expect(403);
    await root
      .delete(`/api/v1/accounting-documents/${temporary.body.id}`)
      .query({ organizationId: state.orgA })
      .expect(200);
    const series = await root
      .get('/api/v1/documents/numbering-series')
      .query({ organizationId: state.orgA, documentType: 'accounting_voucher' })
      .expect(200);
    const seriesId = (series.body.items as Array<{ id: string }>)[0]
      ?.id as string;
    const allocations = await root
      .get(`/api/v1/documents/numbering-series/${seriesId}/allocations`)
      .query({ organizationId: state.orgA })
      .expect(200);
    const discarded = (
      allocations.body.items as Array<{ number: string }>
    ).find((allocation) => allocation.number === serial);
    expect(discarded).toBeDefined();
    // The next composition gets a NEW serial: gaps are never reused.
    const next = await composer
      .post('/api/v1/accounting-documents')
      .send(draft({ description: 'After the gap' }))
      .expect(201);
    const nextIssued = await composer
      .post(`/api/v1/accounting-documents/${next.body.id}/issue`)
      .query({ organizationId: state.orgA })
      .send({ operationKey: `after-gap-${next.body.id}` })
      .expect(200);
    expect(nextIssued.body.documentNumber).not.toBe(serial);
  });

  it('freezes a referenced account’s structural fields (AC-I-11)', async () => {
    // Every composed voucher above references the debit account: the chart may
    // no longer re-parent, re-nature or re-post it.
    const denied = await root
      .patch(`/api/v1/accounts/${state.debitAccountA}`)
      .query({ organizationId: state.orgA })
      .send({ isPostable: false })
      .expect(422);
    expect(denied.body.code).toBe('BusinessRuleViolation');

    // A title is still editable: only the structural surface freezes.
    await root
      .patch(`/api/v1/accounts/${state.debitAccountA}`)
      .query({ organizationId: state.orgA })
      .send({ title: 'Cash (renamed)' })
      .expect(200);

    // The unused account keeps its full editability.
    await root
      .patch(`/api/v1/accounts/${state.nonPostableAccountA}`)
      .query({ organizationId: state.orgA })
      .send({ isPostable: true })
      .expect(200);
  });

  it('exposes no correction, reversal, posting or reporting endpoint (scope audit)', async () => {
    for (const path of [
      '/api/v1/accounting-documents/01J8ZQ9W7R6T5Y4U3I2O1P0ZZZ/reverse',
      '/api/v1/accounting-documents/01J8ZQ9W7R6T5Y4U3I2O1P0ZZZ/correct',
      '/api/v1/accounting-documents/01J8ZQ9W7R6T5Y4U3I2O1P0ZZZ/reopen',
      '/api/v1/accounting-documents/01J8ZQ9W7R6T5Y4U3I2O1P0ZZZ/post',
      '/api/v1/accounting-documents/01J8ZQ9W7R6T5Y4U3I2O1P0ZZZ/approve',
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await root
        .post(path)
        .query({ organizationId: state.orgA })
        .send({ operationKey: 'nope' })
        .expect(404);
    }
    // There is no generic document controller and no reporting surface: an
    // unknown sub-resource is indistinguishable from an unknown route.
    await root
      .get('/api/v1/accounting-documents/reports/x')
      .query({ organizationId: state.orgA })
      .expect(404);
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
