import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import {
  DOMAIN_EVENT_BUS,
  DomainEventBus,
  type DomainEvent,
} from '../src/kernel/events/domain-event-bus.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import {
  toBusinessDate,
  type BusinessDate,
} from '../src/kernel/datetime/business-date.js';
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import { AccountingPeriodsService } from '../src/modules/accounting/application/accounting-periods.service.js';
import { FiscalYearsService } from '../src/modules/accounting/application/fiscal-years.service.js';
import { PostingReadinessService } from '../src/modules/accounting/application/posting-readiness.service.js';
import { PostingService } from '../src/modules/accounting/application/posting.service.js';
import { AccountingPeriodsRepository } from '../src/modules/accounting/data/accounting-periods.repository.js';
import {
  AccountingDocumentsRepository,
  type AccountingDocumentLineWrite,
  type CreateAccountingDocumentInput,
} from '../src/modules/accounting/data/accounting-documents.repository.js';
import { AccountingDocumentScopeRejectedError } from '../src/modules/accounting/data/accounting-document-errors.js';
import {
  ACCOUNTING_PERIOD_CLOSED_EVENT,
  ACCOUNTING_PERIOD_REOPENED_EVENT,
  ACCOUNTING_PERIOD_SEALED_EVENT,
} from '../src/modules/accounting/domain/accounting.events.js';
import { createTestApp } from './support/test-app.js';

/**
 * Live-database suite for the Accounting **period lifecycle** (Task 14).
 *
 * Skipped unless `VARDENA_TEST_DATABASE_URL` is set (CI with Postgres, or a
 * local PostgreSQL); requires a generated client
 * (`npm run prisma:generate`) and a migrated database.
 *
 * WHAT THIS PROVES, AND WHY IT HAS TO BE THIS FILE
 *
 * The period guard is not a validation the application layer performs on its
 * way to a repository — it is a decision taken INSIDE the one transaction that
 * writes the ledger, under the row locks that transaction already holds. The
 * only way to test that is against real PostgreSQL: `FOR UPDATE` contention,
 * `EvalPlanQual` re-reading a row that was updated while a lock wait was in
 * flight, transaction rollback and the unique backstops have no meaning in an
 * in-memory fake (which is why the fakes mirror the *observable effects* and
 * this file proves the *ordering*).
 *
 * The suite covers, against real rows:
 *
 * 1. an OPEN period admits finalization — state, ledger entries, balance
 *    projection, idempotency evidence and the Task 13 freeze marker;
 * 2. a CLOSED period refuses finalization with the module's domain error, and
 *    leaves NOTHING behind: no `final` state, no finalized evidence, no ledger
 *    entry, no balance row, no posting-operation row, no freeze marker;
 * 3. the same for a SEALED period;
 * 4. the transitions `OPEN → CLOSED` and `CLOSED → SEALED` commit; a second
 *    close, a `seal` from `open`, a `close` from `sealed` and a period reopen
 *    under a sealed year are refused, deterministically, with no write;
 * 5. the contract's explicitly permitted `reopen` (§7.2 rule 4, ADR-0032 §5)
 *    still works — the one backward move this foundation keeps;
 * 6. organization isolation: a foreign period cannot be read (404), transitioned
 *    through the service (404) or through the repository's transaction (throws,
 *    row untouched), and a foreign voucher cannot be posted;
 * 7. the two race orderings the lifecycle must survive, driven with real row
 *    locks and observed through `pg_stat_activity`:
 *    (a) a posting already inside its transaction WINS: the `close` queues
 *        behind it, commits after it, and the ledger keeps the entries;
 *    (b) a `close` wins: the posting that follows is refused by the locked
 *        period status and leaves no trace — "posted after close" is impossible;
 * 8. concurrency of the transition itself: two concurrent closes settle with
 *    exactly one winner and one clean 4xx;
 * 9. Tasks 10–13 behaviour stays intact: a finalized voucher, its ledger rows
 *    and its projection are untouched by a later close, readiness still says
 *    `ready` (Task 10.5), and a sibling OPEN period still accepts postings —
 *    there is no global "closed" flag and no redirect.
 *
 * The services run here in system context (no HTTP request in flight), so
 * authorization is not under test — only the data-plane guarantees. The
 * permission/HTTP surface of the same operations is covered by
 * `accounting.e2e-spec.ts` and `accounting-authorization.spec.ts`.
 */
const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

/**
 * Every connection this suite opens is tagged, so the lock probe below can
 * count THIS suite's blocked transactions only — the live suites share one
 * database in CI and another suite's contention must never change the meaning
 * of these assertions.
 */
const APPLICATION_NAME = 'vardena-t14-period-lifecycle';

/** The suite's own connection string, tagged via `application_name`. */
const APP_DATABASE_URL = (() => {
  const url = new URL(DATABASE_URL ?? 'postgresql://invalid:1@127.0.0.1:1/x');
  url.searchParams.set('application_name', APPLICATION_NAME);
  return url.toString();
})();

describe.skipIf(DATABASE_URL === undefined)(
  'Accounting period lifecycle (live database)',
  () => {
    const suffix = generateId().slice(-8);

    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let documents: AccountingDocumentsRepository;
    let posting: PostingService;
    let readiness: PostingReadinessService;
    let periods: AccountingPeriodsService;
    let years: FiscalYearsService;
    let periodsRepository: AccountingPeriodsRepository;
    /** Every period lifecycle event published while the suite ran. */
    let periodEvents: DomainEvent[];

    let organizationId = '';
    let financialAreaId = '';
    let codingStructureVersionId = '';
    let accountingConfigurationId = '';
    let debitAccountId = '';
    let creditAccountId = '';

    /** A second organization, used only by the isolation test. */
    let otherOrganizationId = '';
    let otherAreaId = '';
    let otherYearId = '';
    let otherPeriodId = '';

    /** Every document this suite creates, so teardown is exhaustive. */
    const createdDocumentIds: string[] = [];

    const client = async (): Promise<{
      $queryRaw: (
        query: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<unknown>;
      $transaction: <T>(
        fn: (tx: {
          $queryRaw: (
            query: TemplateStringsArray,
            ...values: unknown[]
          ) => Promise<unknown>;
        }) => Promise<T>,
        options?: unknown,
      ) => Promise<T>;
      accountingDocument: {
        count: (args: unknown) => Promise<number>;
        findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      accountingDocumentLine: {
        count: (args: unknown) => Promise<number>;
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      accountingPostingOperation: {
        count: (args: unknown) => Promise<number>;
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      ledgerEntry: {
        count: (args: unknown) => Promise<number>;
        findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      accountBalanceProjection: {
        count: (args: unknown) => Promise<number>;
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      accountingPeriod: { deleteMany: (args: unknown) => Promise<unknown> };
      fiscalYear: { deleteMany: (args: unknown) => Promise<unknown> };
      account: { deleteMany: (args: unknown) => Promise<unknown> };
      codingStructureLevel: { deleteMany: (args: unknown) => Promise<unknown> };
      codingStructureVersion: {
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      financialArea: { deleteMany: (args: unknown) => Promise<unknown> };
      organization: { deleteMany: (args: unknown) => Promise<unknown> };
    }> => prisma.getClient<never>() as never;

    // -------------------------------------------------------------------------
    // Readers — every assertion is made against PostgreSQL, never a DTO
    // -------------------------------------------------------------------------

    /** The stored status of one period, read from the table itself. */
    const periodRow = async (
      periodId: string,
    ): Promise<{ status: string; updatedAt: Date }> => {
      const db = await client();
      const rows =
        (await db.$queryRaw`SELECT "status" AS "status", "updated_at" AS "updatedAt"
                              FROM accounting.accounting_periods
                             WHERE id = ${periodId}`) as Array<{
          status: string;
          updatedAt: Date;
        }>;
      const [row] = rows;
      if (row === undefined) {
        throw new Error(`Accounting period "${periodId}" must exist.`);
      }
      return row;
    };

    /** The stored voucher header (the finalization evidence included). */
    const documentRow = async (
      documentId: string,
    ): Promise<{
      state: string;
      finalizedAt: Date | null;
      accountingPeriodId: string;
      documentDate: Date;
    }> => {
      const db = await client();
      const rows = (await db.$queryRaw`SELECT "state"                AS "state",
                                  "finalized_at"         AS "finalizedAt",
                                  "accounting_period_id" AS "accountingPeriodId",
                                  "document_date"        AS "documentDate"
                             FROM accounting.accounting_documents
                            WHERE id = ${documentId}`) as Array<{
        state: string;
        finalizedAt: Date | null;
        accountingPeriodId: string;
        documentDate: Date;
      }>;
      const [row] = rows;
      if (row === undefined) {
        throw new Error(`Accounting document "${documentId}" must exist.`);
      }
      return row;
    };

    /** The freeze marker of one configuration row, as PostgreSQL stores it. */
    const markerRow = async (
      configurationId: string,
    ): Promise<{ operationallyUsedAt: Date | null; updatedAt: Date }> => {
      const db = await client();
      const rows =
        (await db.$queryRaw`SELECT "operationally_used_at" AS "operationallyUsedAt",
                                  "updated_at"            AS "updatedAt"
                             FROM accounting.accounting_configurations
                            WHERE id = ${configurationId}`) as Array<{
          operationallyUsedAt: Date | null;
          updatedAt: Date;
        }>;
      const [row] = rows;
      if (row === undefined) {
        throw new Error(`Configuration "${configurationId}" must exist.`);
      }
      return row;
    };

    /** Every trace a committed finalization would have left behind. */
    const traceCounts = async (
      documentId: string,
    ): Promise<{
      ledgerEntries: number;
      postingOperations: number;
    }> => {
      const db = await client();
      return {
        ledgerEntries: await db.ledgerEntry.count({
          where: { voucherId: documentId },
        }),
        postingOperations: await db.accountingPostingOperation.count({
          where: { operationKey: `t14-finalize-${documentId}` },
        }),
      };
    };

    // -------------------------------------------------------------------------
    // Fixture builders
    // -------------------------------------------------------------------------

    /**
     * One calendar slot per test: a fiscal year of its own, one period covering
     * it. Years of one area may not overlap (§6.2 rule 2), so each test gets a
     * disjoint range and no test can influence another's resolution.
     */
    let calendarSlot = 0;
    interface Calendar {
      yearId: string;
      periodId: string;
      /** A business date that resolves to the period. */
      documentDate: BusinessDate;
    }

    const seedCalendar = async (): Promise<Calendar> => {
      const slot = calendarSlot++;
      const startYear = 2030 + slot;
      const startDate = `${startYear}-01-01`;
      const endDate = `${startYear}-12-31`;
      const yearId = generateId();
      const periodId = generateId();
      const db = await client();
      await db.$queryRaw`INSERT INTO accounting.fiscal_years (
        id, organization_id, financial_area_id, code, title, start_date, end_date,
        status, is_active, created_at, updated_at
      ) VALUES (${yearId}, ${organizationId}, ${financialAreaId}, ${`FY-${startYear}`},
        ${`Year ${startYear}`}, CAST(${startDate} AS date), CAST(${endDate} AS date),
        'open', true, now(), now())`;
      await db.$queryRaw`INSERT INTO accounting.accounting_periods (
        id, organization_id, financial_area_id, fiscal_year_id, sequence, title,
        start_date, end_date, status, period_kind, created_at, updated_at
      ) VALUES (${periodId}, ${organizationId}, ${financialAreaId}, ${yearId},
        1, ${`Period ${startYear}`}, CAST(${startDate} AS date),
        CAST(${endDate} AS date), 'open', 'normal', now(), now())`;
      return {
        yearId,
        periodId,
        documentDate: toBusinessDate(`${startYear}-01-31`)!,
      };
    };

    /** A `temporary` (issued) voucher — the only shape finalization accepts. */
    const temporaryVoucher = async (
      calendar: Calendar,
      description = 'Lifecycle live entry',
      overrides: Partial<CreateAccountingDocumentInput> = {},
    ): Promise<string> => {
      const line = (
        accountId: string,
        debitAmount: string,
        creditAmount: string,
        lineNo: number,
      ): AccountingDocumentLineWrite => ({
        id: generateId(),
        lineNo,
        accountId,
        debitAmount,
        creditAmount,
        description: null,
        sourceLineReference: null,
      });
      const id = generateId();
      createdDocumentIds.push(id);
      await documents.createChecked({
        id,
        organizationId,
        financialAreaId,
        documentDate: calendar.documentDate,
        description,
        state: 'temporary',
        origin: 'manual',
        branchId: null,
        source: null,
        // The number is part of the fixture: numbering has its own suite
        // (`documents-live.e2e-spec.ts`), and what this file needs is a voucher
        // that may legally be finalized.
        documentNumber: `T14-${id.slice(-10)}`,
        correlationId: null,
        idempotencyReference: null,
        requestHash: null,
        lines: [
          line(debitAccountId, '1250.50', '0', 1),
          line(creditAccountId, '0', '1250.50', 2),
        ],
        ledger: null,
        createdAt: new Date(),
        createdBy: null,
        ...overrides,
      });
      return id;
    };

    /** Post a voucher through the ONE posting seam (§15.5, Task 10.8). */
    const post = (voucherId: string): Promise<unknown> =>
      posting.postVoucher({
        organizationId,
        voucherId,
        operationKey: `t14-finalize-${voucherId}`,
      });

    /** Apply one lifecycle move through the real application service. */
    const transition = (
      id: string,
      move: 'close' | 'reopen' | 'seal',
      reason = 'Task 14 live-fixture move',
      scopeOrganizationId = organizationId,
    ): Promise<{ status: string }> =>
      periods.transitionAccountingPeriod({
        organizationId: scopeOrganizationId,
        id,
        transition: move,
        reason,
      });

    // -------------------------------------------------------------------------
    // Concurrency helpers
    // -------------------------------------------------------------------------

    /**
     * How many backends in THIS database are currently blocked on a lock that
     * belongs to the period lifecycle (`accounting_periods` / `fiscal_years`).
     * Scoping the probe to those two tables keeps it from reacting to unrelated
     * contention — and a *waiting* statement is the only evidence that a
     * transaction has really queued on the lock, which is what makes the two
     * race tests deterministic instead of timing-dependent.
     */
    const waitingOnCalendarLock = async (): Promise<number> => {
      const db = await client();
      const rows = (await db.$queryRaw`SELECT count(*)::int AS "waiting"
                              FROM pg_stat_activity
                             WHERE datname = current_database()
                               AND wait_event_type = 'Lock'
                               AND (query ILIKE '%accounting_periods%'
                                    OR query ILIKE '%fiscal_years%')`) as Array<{
        waiting: number;
      }>;
      return rows[0]?.waiting ?? 0;
    };

    const waitForBlockedCalendarTransactions = async (
      minimum: number,
      message: string,
    ): Promise<void> => {
      const deadline = Date.now() + 20_000;
      for (;;) {
        if ((await waitingOnCalendarLock()) >= minimum) return;
        if (Date.now() > deadline) throw new Error(message);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };

    /**
     * Hold one row `FOR UPDATE` from an INDEPENDENT transaction. The holder is
     * never part of the lifecycle code under test: it only creates the window
     * in which the real transactions have to queue (or prove that they do not),
     * so the test can describe each ordering instead of hoping for it.
     */
    const holdRowLock = async (
      row: 'period' | 'configuration',
      rowId: string,
    ): Promise<{ release: () => Promise<void> }> => {
      let releaseLock: (() => void) | undefined;
      const releaseSignal = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      let signalHeld: (() => void) | undefined;
      const heldSignal = new Promise<void>((resolve) => {
        signalHeld = resolve;
      });
      const db = await client();
      const done = db.$transaction(
        async (tx) => {
          if (row === 'period') {
            await tx.$queryRaw`SELECT "id" FROM accounting.accounting_periods
                                WHERE "id" = ${rowId} FOR UPDATE`;
          } else {
            await tx.$queryRaw`SELECT "id" FROM accounting.accounting_configurations
                                WHERE "id" = ${rowId} FOR UPDATE`;
          }
          signalHeld?.();
          await releaseSignal;
        },
        { timeout: 120_000, maxWait: 60_000 },
      );
      await heldSignal;
      let released = false;
      return {
        release: async () => {
          if (!released) {
            released = true;
            releaseLock?.();
          }
          await done;
        },
      };
    };

    // -------------------------------------------------------------------------
    // Suite lifecycle
    // -------------------------------------------------------------------------

    beforeAll(async () => {
      const built = await createTestApp({
        override: (builder) =>
          builder
            .overrideProvider(APP_CONFIG)
            .useValue({ ...loadAppConfig(), databaseUrl: APP_DATABASE_URL }),
      });
      app = built.app;
      prisma = built.module.get(PrismaService);
      documents = app.get(AccountingDocumentsRepository);
      posting = app.get(PostingService);
      readiness = app.get(PostingReadinessService);
      periods = app.get(AccountingPeriodsService);
      years = app.get(FiscalYearsService);
      periodsRepository = app.get(AccountingPeriodsRepository);

      // The audit trail of this task IS the module's event contract: every
      // transition publishes exactly one typed event with its reason, and a
      // refused move publishes nothing. Subscribing here lets the suite assert
      // that (the v1 bus is in-process; persistence arrives with the Audit
      // module).
      periodEvents = [];
      const bus = app.get<DomainEventBus>(DOMAIN_EVENT_BUS);
      for (const type of [
        ACCOUNTING_PERIOD_CLOSED_EVENT,
        ACCOUNTING_PERIOD_REOPENED_EVENT,
        ACCOUNTING_PERIOD_SEALED_EVENT,
      ]) {
        bus.on(type, (event) => {
          periodEvents.push(event);
        });
      }

      const db = await client();
      const organizations = app.get(OrganizationsService);
      organizationId = (
        await organizations.createOrganization({
          code: `T14-${suffix}`,
          name: 'Period lifecycle org',
        })
      ).id;

      financialAreaId = generateId();
      await db.$queryRaw`INSERT INTO accounting.financial_areas (
        id, organization_id, code, title, is_active, is_default, created_at, updated_at
      ) VALUES (${financialAreaId}, ${organizationId}, ${`GA-${suffix}`}, ${'General area'},
        true, false, now(), now())`;

      // A chart account cannot exist without the structure version its code was
      // composed under (§9.4) and the configuration its level shape came from
      // (Task 11): the fixture publishes both, exactly like the production
      // services do.
      codingStructureVersionId = generateId();
      await db.$queryRaw`INSERT INTO accounting.coding_structure_versions (
        id, organization_id, code, version_number, status, max_depth, separator,
        created_at, updated_at
      ) VALUES (${codingStructureVersionId}, ${organizationId}, ${'DEFAULT'}, 1, 'published', 1, '', now(), now())`;

      accountingConfigurationId = generateId();
      await db.$queryRaw`INSERT INTO accounting.accounting_configurations (
        id, organization_id, code, name, version_number, status, created_at, updated_at
      ) VALUES (${accountingConfigurationId}, ${organizationId}, ${'DEFAULT'}, ${'Main'}, 1, 'ACTIVE', now(), now())`;
      await db.$queryRaw`INSERT INTO accounting.accounting_configuration_levels (
        id, organization_id, accounting_configuration_id, level_index, title, digit_length, default_is_postable, created_at, updated_at
      ) VALUES (${generateId()}, ${organizationId}, ${accountingConfigurationId}, 1, ${'Level 1'}, 2, true, now(), now())`;

      debitAccountId = generateId();
      creditAccountId = generateId();
      for (const [id, code, title] of [
        [debitAccountId, '1000', 'Cash'],
        [creditAccountId, '2000', 'Revenue'],
      ]) {
        await db.$queryRaw`INSERT INTO accounting.accounts (
          id, organization_id, code, title, account_nature, is_postable, is_active,
          level, coding_structure_version_id, accounting_configuration_id, created_at, updated_at
        ) VALUES (${id}, ${organizationId}, ${code}, ${title}, 'DEBIT', true, true, 1,
          ${codingStructureVersionId}, ${accountingConfigurationId}, now(), now())`;
      }

      // The second organization for the isolation test: its own area, year and
      // period — nothing about it is shared with the organization above.
      otherOrganizationId = (
        await organizations.createOrganization({
          code: `T14B-${suffix}`,
          name: 'Period lifecycle foreign org',
        })
      ).id;
      otherAreaId = generateId();
      await db.$queryRaw`INSERT INTO accounting.financial_areas (
        id, organization_id, code, title, is_active, is_default, created_at, updated_at
      ) VALUES (${otherAreaId}, ${otherOrganizationId}, ${`GB-${suffix}`}, ${'Foreign area'},
        true, false, now(), now())`;
      otherYearId = generateId();
      otherPeriodId = generateId();
      await db.$queryRaw`INSERT INTO accounting.fiscal_years (
        id, organization_id, financial_area_id, code, title, start_date, end_date,
        status, is_active, created_at, updated_at
      ) VALUES (${otherYearId}, ${otherOrganizationId}, ${otherAreaId}, ${'FY-B'},
        ${'Foreign year'}, CAST(${'2099-01-01'} AS date),
        CAST(${'2099-12-31'} AS date), 'open', true, now(), now())`;
      await db.$queryRaw`INSERT INTO accounting.accounting_periods (
        id, organization_id, financial_area_id, fiscal_year_id, sequence, title,
        start_date, end_date, status, period_kind, created_at, updated_at
      ) VALUES (${otherPeriodId}, ${otherOrganizationId}, ${otherAreaId}, ${otherYearId},
        1, ${'Foreign period'}, CAST(${'2099-01-01'} AS date),
        CAST(${'2099-12-31'} AS date), 'open', 'normal', now(), now())`;
    }, 120_000);

    afterAll(async () => {
      if (app === undefined) return;
      try {
        const db = await client();
        for (const org of [organizationId, otherOrganizationId]) {
          // Ledger RESTRICTs its voucher, its lines and its accounts; balance
          // projections RESTRICT their period/year/area/account: children of
          // the ledger go first, then the document tree, then the calendar,
          // then master data (the Task 12/13 suites' order).
          await db.ledgerEntry.deleteMany({ where: { organizationId: org } });
          await db.accountBalanceProjection.deleteMany({
            where: { organizationId: org },
          });
          await db.accountingPostingOperation.deleteMany({
            where: { organizationId: org },
          });
          await db.accountingDocumentLine.deleteMany({
            where: { organizationId: org },
          });
          await db.accountingDocument.deleteMany({
            where: { organizationId: org },
          });
          await db.accountingPeriod.deleteMany({
            where: { organizationId: org },
          });
          await db.fiscalYear.deleteMany({ where: { organizationId: org } });
          await db.account.deleteMany({ where: { organizationId: org } });
          await db.$queryRaw`DELETE FROM accounting.accounting_configuration_levels WHERE organization_id = ${org}`;
          await db.$queryRaw`DELETE FROM accounting.accounting_configurations WHERE organization_id = ${org}`;
          await db.codingStructureLevel.deleteMany({
            where: { organizationId: org },
          });
          await db.codingStructureVersion.deleteMany({
            where: { organizationId: org },
          });
          await db.financialArea.deleteMany({ where: { organizationId: org } });
          await db.organization.deleteMany({ where: { id: org } });
        }
      } finally {
        await app.close();
      }
    }, 120_000);

    // -------------------------------------------------------------------------
    // 1. OPEN admits finalization
    // -------------------------------------------------------------------------

    it('finalizes into an OPEN period and commits the whole posting', async () => {
      const calendar = await seedCalendar();
      const voucherId = await temporaryVoucher(calendar);

      const outcome = (await post(voucherId)) as {
        kind: string;
        document: { phase: string };
      };
      expect(outcome.kind).toBe('posted');
      expect(outcome.document.phase).toBe('final');

      const stored = await documentRow(voucherId);
      expect(stored.state).toBe('final');
      expect(stored.finalizedAt).not.toBeNull();
      // The stored period is the resolved one — never a redirect.
      expect(stored.accountingPeriodId).toBe(calendar.periodId);

      const traces = await traceCounts(voucherId);
      expect(traces.ledgerEntries).toBe(2);
      expect(traces.postingOperations).toBe(1);
      expect(
        await (
          await client()
        ).accountBalanceProjection.count({
          where: { accountingPeriodId: calendar.periodId },
        }),
      ).toBe(2);
      // The period itself is untouched by posting (§6.2 rule 5: status is never
      // a side effect of documents).
      expect((await periodRow(calendar.periodId)).status).toBe('open');
    }, 60_000);

    // -------------------------------------------------------------------------
    // 2. CLOSED refuses finalization, and leaves nothing behind
    // -------------------------------------------------------------------------

    it('refuses finalization in a CLOSED period and leaves no trace', async () => {
      const calendar = await seedCalendar();
      // The voucher is composed while the period is open, then the period is
      // closed before the posting: the exact sequence the guard exists for.
      const voucherId = await temporaryVoucher(calendar);
      await expect(
        transition(calendar.periodId, 'close'),
      ).resolves.toMatchObject({ status: 'closed' });

      const rejected = await post(voucherId).then(
        () => null,
        (error: unknown) => error,
      );
      expect(rejected).toBeInstanceOf(AccountingDocumentScopeRejectedError);
      // Deterministic and domain-specific: the PERIOD is named, with the status
      // that refused (the service maps this to 422 BusinessRuleViolation).
      expect(rejected).toMatchObject({ scope: 'period', status: 'closed' });

      const stored = await documentRow(voucherId);
      expect(stored.state).toBe('temporary');
      expect(stored.finalizedAt).toBeNull();
      const traces = await traceCounts(voucherId);
      expect(traces.ledgerEntries).toBe(0);
      expect(traces.postingOperations).toBe(0);
      const db = await client();
      expect(
        await db.ledgerEntry.count({
          where: { accountingPeriodId: calendar.periodId },
        }),
      ).toBe(0);
      expect(
        await db.accountBalanceProjection.count({
          where: { accountingPeriodId: calendar.periodId },
        }),
      ).toBe(0);
      // The refusal is a no-op on the period as well: no silent reopen, no
      // redirect, no status flip.
      expect((await periodRow(calendar.periodId)).status).toBe('closed');
    }, 60_000);

    // -------------------------------------------------------------------------
    // 3. SEALED refuses finalization, and leaves nothing behind
    // -------------------------------------------------------------------------

    it('refuses finalization in a SEALED period and leaves no trace', async () => {
      const calendar = await seedCalendar();
      const voucherId = await temporaryVoucher(calendar);
      await transition(calendar.periodId, 'close');
      await expect(
        transition(calendar.periodId, 'seal'),
      ).resolves.toMatchObject({
        status: 'sealed',
      });

      const rejected = await post(voucherId).then(
        () => null,
        (error: unknown) => error,
      );
      expect(rejected).toBeInstanceOf(AccountingDocumentScopeRejectedError);
      expect(rejected).toMatchObject({ scope: 'period', status: 'sealed' });

      const stored = await documentRow(voucherId);
      expect(stored.state).toBe('temporary');
      expect(stored.finalizedAt).toBeNull();
      const traces = await traceCounts(voucherId);
      expect(traces.ledgerEntries).toBe(0);
      expect(traces.postingOperations).toBe(0);
      expect((await periodRow(calendar.periodId)).status).toBe('sealed');
    }, 60_000);

    // -------------------------------------------------------------------------
    // 4. The lifecycle itself: allowed moves commit, everything else is refused
    // -------------------------------------------------------------------------

    it('applies OPEN → CLOSED → SEALED and refuses every other move', async () => {
      const calendar = await seedCalendar();
      periodEvents.length = 0;

      await expect(
        transition(calendar.periodId, 'close'),
      ).resolves.toMatchObject({ status: 'closed' });
      expect((await periodRow(calendar.periodId)).status).toBe('closed');
      // One auditable event with its reason — the module's audit convention.
      expect(periodEvents).toHaveLength(1);
      expect(periodEvents[0]?.type).toBe(ACCOUNTING_PERIOD_CLOSED_EVENT);
      expect(periodEvents[0]?.aggregateId).toBe(calendar.periodId);
      expect(periodEvents[0]?.payload).toMatchObject({
        fromStatus: 'open',
        toStatus: 'closed',
        reason: 'Task 14 live-fixture move',
      });

      // A second close is refused deterministically (422 at the API boundary)
      // and publishes nothing: no silent no-op, no second event.
      await expect(
        transition(calendar.periodId, 'close'),
      ).rejects.toMatchObject({
        code: 'BusinessRuleViolation',
      });
      expect(periodEvents).toHaveLength(1);
      expect((await periodRow(calendar.periodId)).status).toBe('closed');

      await expect(
        transition(calendar.periodId, 'seal'),
      ).resolves.toMatchObject({
        status: 'sealed',
      });
      expect((await periodRow(calendar.periodId)).status).toBe('sealed');
      expect(periodEvents).toHaveLength(2);
      expect(periodEvents[1]?.type).toBe(ACCOUNTING_PERIOD_SEALED_EVENT);

      // `sealed → closed` does not exist, and `sealed → sealed` is not a step.
      await expect(
        transition(calendar.periodId, 'close'),
      ).rejects.toMatchObject({
        code: 'BusinessRuleViolation',
      });
      await expect(transition(calendar.periodId, 'seal')).rejects.toMatchObject(
        {
          code: 'BusinessRuleViolation',
        },
      );
      expect((await periodRow(calendar.periodId)).status).toBe('sealed');
      expect(periodEvents).toHaveLength(2);
      expect(periodEvents[1]?.type).toBe(ACCOUNTING_PERIOD_SEALED_EVENT);

      // `open → sealed` is not a shortcut either: a fresh period may be closed
      // or sealed, and the skip is refused.
      const skip = await seedCalendar();
      await expect(transition(skip.periodId, 'seal')).rejects.toMatchObject({
        code: 'BusinessRuleViolation',
      });
      expect((await periodRow(skip.periodId)).status).toBe('open');
    }, 60_000);

    it("keeps the contract's explicitly permitted reopen, gated by the year", async () => {
      // Contract §7.2 rule 4 + AC-I-17: a sealed period is reopened only through
      // the explicit, permission-gated operations (`Accounting.AccountingPeriod.
      // Reopen`, and a year that is not sealed). Task 14 keeps that operation —
      // it is the existing permitted behaviour the task preserves (ADR-0032 §5),
      // and this test pins both halves of the rule: the move works while the
      // year allows it, and it is refused while the year is sealed.
      const calendar = await seedCalendar();
      await transition(calendar.periodId, 'close');
      await transition(calendar.periodId, 'seal');

      await expect(
        transition(calendar.periodId, 'reopen', 'Audited correction window'),
      ).resolves.toMatchObject({ status: 'open' });
      expect((await periodRow(calendar.periodId)).status).toBe('open');
      // Reopened means reopened: posting works again, on the same voucher that
      // the sealed period refused a moment ago.
      const voucherId = await temporaryVoucher(calendar);
      await expect(post(voucherId)).resolves.toMatchObject({ kind: 'posted' });

      // Now seal the YEAR around the period: close the period, close the year
      // (which cascades to its open periods), then seal it.
      await transition(calendar.periodId, 'close');
      await years.transitionFiscalYear({
        organizationId,
        id: calendar.yearId,
        transition: 'close',
        reason: 'Year-end close',
      });
      await years.transitionFiscalYear({
        organizationId,
        id: calendar.yearId,
        transition: 'seal',
        reason: 'Audit sign-off',
      });

      // While the year is sealed, the period cannot be reopened (§7.2 rule 4,
      // AC-I-17) — the year-level gate is the only path to a sealed period.
      await expect(
        transition(calendar.periodId, 'reopen', 'Must be refused: sealed year'),
      ).rejects.toMatchObject({ code: 'BusinessRuleViolation' });
      expect((await periodRow(calendar.periodId)).status).toBe('closed');
    }, 60_000);

    // -------------------------------------------------------------------------
    // 5. Organization isolation
    // -------------------------------------------------------------------------

    it('never crosses the organization boundary', async () => {
      // A real voucher of THIS organization, posted with the OTHER
      // organization's scope: it is not there (AC-I-01/16), and nothing moves.
      const calendar = await seedCalendar();
      const voucherId = await temporaryVoucher(calendar, 'Cross-org probe');
      await expect(
        posting.postVoucher({
          organizationId: otherOrganizationId,
          voucherId,
          operationKey: `t14-foreign-${voucherId}`,
        }),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
      expect((await documentRow(voucherId)).state).toBe('temporary');
      expect((await traceCounts(voucherId)).ledgerEntries).toBe(0);

      // The same on the repository's own transaction: a foreign organization
      // reaches the document guard, not the ledger.
      await expect(
        documents.finalizeChecked({
          id: voucherId,
          organizationId: otherOrganizationId,
          ledger: {
            id: generateId(),
            organizationId: otherOrganizationId,
            operationKey: `t14-foreign-direct-${voucherId}`,
            operation: 'document_finalize',
            requestHash: 'f'.repeat(64),
            result: { documentId: voucherId },
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: null,
          },
          finalizedAt: new Date(),
          finalizedBy: null,
        }),
      ).rejects.toBeTruthy();
      expect((await documentRow(voucherId)).state).toBe('temporary');
      expect((await traceCounts(voucherId)).ledgerEntries).toBe(0);

      // Period-level isolation: read (404), transition through the service
      // (404) and through the repository's transaction (boundary violation).
      await expect(
        periods.getAccountingPeriod(organizationId, otherPeriodId),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });

      await expect(
        transition(otherPeriodId, 'close', 'Must not apply', organizationId),
      ).rejects.toMatchObject({ code: 'EntityNotFound' });
      expect((await periodRow(otherPeriodId)).status).toBe('open');

      await expect(
        periodsRepository.transitionChecked({
          organizationId,
          id: otherPeriodId,
          from: 'open',
          to: 'closed',
          gatesOnYearSealed: true,
          updatedAt: new Date(),
          updatedBy: null,
        }),
      ).rejects.toBeTruthy();
      expect((await periodRow(otherPeriodId)).status).toBe('open');

      // The same for creation: a foreign year cannot receive a period.
      await expect(
        periodsRepository.createChecked({
          id: generateId(),
          organizationId,
          financialAreaId,
          fiscalYearId: otherYearId,
          sequence: 2,
          title: 'Foreign year period',
          startDate: toBusinessDate('2099-01-01')!,
          endDate: toBusinessDate('2099-06-30')!,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: null,
        }),
      ).rejects.toBeTruthy();
      expect((await periodRow(otherPeriodId)).status).toBe('open');
    }, 60_000);

    // -------------------------------------------------------------------------
    // 6. The races — proven with real row locks, not with timing luck
    // -------------------------------------------------------------------------

    it('lets a posting that already holds the calendar win: the close queues behind it', async () => {
      const calendar = await seedCalendar();
      const voucherId = await temporaryVoucher(calendar);
      const holder = await holdRowLock('period', calendar.periodId);
      try {
        // The posting starts first and blocks on the period row: it is inside
        // its finalization transaction, holding the area and the year locks.
        const postingPromise = post(voucherId);
        await waitForBlockedCalendarTransactions(
          1,
          'The posting never queued on the locked accounting period.',
        );

        // The close can only queue behind it — it needs the year lock the
        // posting already holds, and the period row the holder owns.
        const closePromise = transition(calendar.periodId, 'close');
        await waitForBlockedCalendarTransactions(
          2,
          'The close never queued behind the in-flight posting.',
        );

        await holder.release();
        const [posted, closed] = await Promise.all([
          postingPromise,
          closePromise,
        ]);

        // The posting committed against the period as it was (open) …
        expect(posted).toMatchObject({ kind: 'posted' });
        // … and the close observed the committed state and applied afterwards.
        expect(closed).toMatchObject({ status: 'closed' });
      } finally {
        await holder.release();
      }
      const stored = await documentRow(voucherId);
      expect(stored.state).toBe('final');
      const traces = await traceCounts(voucherId);
      expect(traces.ledgerEntries).toBe(2);
      expect(traces.postingOperations).toBe(1);
      expect((await periodRow(calendar.periodId)).status).toBe('closed');
    }, 90_000);

    it('refuses a posting that follows a close: the closed period is the final word', async () => {
      const calendar = await seedCalendar();
      const voucherId = await temporaryVoucher(calendar);
      const holder = await holdRowLock('period', calendar.periodId);
      try {
        // The close goes first: it takes the year lock and queues on the period
        // row the holder owns.
        const closePromise = transition(calendar.periodId, 'close');
        await waitForBlockedCalendarTransactions(
          1,
          'The close never queued on the locked accounting period.',
        );

        // The posting starts second and queues on the YEAR lock the close
        // holds, i.e. strictly behind the close in the module's lock order.
        const postingPromise = post(voucherId);
        await waitForBlockedCalendarTransactions(
          2,
          'The posting never queued behind the in-flight close.',
        );

        await holder.release();
        const [closed, posted] = await Promise.allSettled([
          closePromise,
          postingPromise,
        ]);
        expect(closed.status).toBe('fulfilled');
        const rejection =
          posted.status === 'rejected' ? posted.reason : (undefined as unknown);
        expect(rejection).toBeInstanceOf(AccountingDocumentScopeRejectedError);
        expect(rejection).toMatchObject({ scope: 'period', status: 'closed' });
      } finally {
        await holder.release();
      }

      // Nothing survived the refusal — not a marker, not a ledger row, not an
      // evidence row, not a final document state (Task 14 §7.4).
      const stored = await documentRow(voucherId);
      expect(stored.state).toBe('temporary');
      expect(stored.finalizedAt).toBeNull();
      const traces = await traceCounts(voucherId);
      expect(traces.ledgerEntries).toBe(0);
      expect(traces.postingOperations).toBe(0);
      const db = await client();
      expect(
        await db.accountBalanceProjection.count({
          where: { accountingPeriodId: calendar.periodId },
        }),
      ).toBe(0);
      expect((await periodRow(calendar.periodId)).status).toBe('closed');
    }, 90_000);

    it('refuses a closed period without touching the configuration the posting would mark', async () => {
      // The placement of the gate is observable, not cosmetic: the freeze
      // marker (Task 13) is an UPDATE on the configuration row, and the account
      // `FOR SHARE` locks come after it. A refusal that happened *after* those
      // steps would queue behind them. Holding the configuration row FOR UPDATE
      // here therefore discriminates the two implementations: the fail-fast
      // refusal must arrive while the row is still locked, not after it is
      // released.
      const calendar = await seedCalendar();
      const voucherId = await temporaryVoucher(calendar);
      await transition(calendar.periodId, 'close');

      const holder = await holdRowLock(
        'configuration',
        accountingConfigurationId,
      );
      let outcome: unknown;
      try {
        outcome = await Promise.race([
          post(voucherId).then(
            () => 'posted',
            (error: unknown) => error,
          ),
          // Comfortably longer than the refusal path (a few statements) and
          // shorter than any lock wait this test would allow.
          new Promise((resolve) => setTimeout(() => resolve('blocked'), 5_000)),
        ]);
      } finally {
        await holder.release();
      }

      expect(outcome).not.toBe('blocked');
      expect(outcome).toBeInstanceOf(AccountingDocumentScopeRejectedError);
      expect(outcome).toMatchObject({ scope: 'period', status: 'closed' });
      expect((await documentRow(voucherId)).state).toBe('temporary');
      expect((await traceCounts(voucherId)).ledgerEntries).toBe(0);
    }, 90_000);

    it('settles two concurrent closes of one period with exactly one winner', async () => {
      const calendar = await seedCalendar();
      periodEvents.length = 0;
      const results = await Promise.allSettled([
        transition(calendar.periodId, 'close', 'Concurrent close A'),
        transition(calendar.periodId, 'close', 'Concurrent close B'),
      ]);
      const winners = results.filter((r) => r.status === 'fulfilled');
      const losers = results.filter((r) => r.status === 'rejected');
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      // The loser is a clean, documented outcome — a stale-plan refusal (422) or
      // the transaction's own stale-status conflict (409) — never a torn write.
      expect((losers[0] as PromiseRejectedResult).reason).toMatchObject({
        code: expect.stringMatching(/^(Conflict|BusinessRuleViolation)$/),
      });
      expect((await periodRow(calendar.periodId)).status).toBe('closed');
      // … and exactly one auditable Closed event was published.
      expect(
        periodEvents.filter(
          (event) => event.type === ACCOUNTING_PERIOD_CLOSED_EVENT,
        ),
      ).toHaveLength(1);
    }, 90_000);

    // -------------------------------------------------------------------------
    // 7. The freeze marker and Tasks 10–13 behaviour
    // -------------------------------------------------------------------------

    it('marks no configuration when the finalization is refused by a closed period', async () => {
      const db = await client();
      // A configuration of its own, unused: the marker is the observation.
      const configurationId = generateId();
      await db.$queryRaw`INSERT INTO accounting.accounting_configurations (
        id, organization_id, code, name, version_number, status, created_at, updated_at
      ) VALUES (${configurationId}, ${organizationId}, ${'T14-MARKER'}, ${'Marker probe'},
        1, 'SUPERSEDED', now(), now())`;
      await db.$queryRaw`INSERT INTO accounting.accounting_configuration_levels (
        id, organization_id, accounting_configuration_id, level_index, title, digit_length, default_is_postable, created_at, updated_at
      ) VALUES (${generateId()}, ${organizationId}, ${configurationId}, 1, ${'Level 1'}, 2, true, now(), now())`;
      const pinnedAccountId = generateId();
      await db.$queryRaw`INSERT INTO accounting.accounts (
        id, organization_id, code, title, account_nature, is_postable, is_active,
        level, coding_structure_version_id, accounting_configuration_id, created_at, updated_at
      ) VALUES (${pinnedAccountId}, ${organizationId}, ${'9100'}, ${'Marker account'}, 'DEBIT',
        true, true, 1, ${codingStructureVersionId}, ${configurationId}, now(), now())`;

      const before = await markerRow(configurationId);
      expect(before.operationallyUsedAt).toBeNull();

      const calendar = await seedCalendar();
      const voucherId = await temporaryVoucher(
        calendar,
        'Marker refusal probe',
        {
          lines: [
            {
              id: generateId(),
              lineNo: 1,
              accountId: pinnedAccountId,
              debitAmount: '10.00',
              creditAmount: '0',
              description: null,
              sourceLineReference: null,
            },
            {
              id: generateId(),
              lineNo: 2,
              accountId: creditAccountId,
              debitAmount: '0',
              creditAmount: '10.00',
              description: null,
              sourceLineReference: null,
            },
          ],
        },
      );
      await transition(calendar.periodId, 'close');
      await expect(post(voucherId)).rejects.toBeInstanceOf(
        AccountingDocumentScopeRejectedError,
      );

      const after = await markerRow(configurationId);
      expect(after.operationallyUsedAt).toBeNull();
      // Untouched — not even the timestamp moved (the statement never ran).
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());

      // Positive control on the SAME configuration: a legal posting of a
      // voucher pinning it marks it, so the guard did not disable the freeze.
      const openCalendar = await seedCalendar();
      const legalVoucherId = await temporaryVoucher(
        openCalendar,
        'Marker positive control',
        {
          lines: [
            {
              id: generateId(),
              lineNo: 1,
              accountId: pinnedAccountId,
              debitAmount: '10.00',
              creditAmount: '0',
              description: null,
              sourceLineReference: null,
            },
            {
              id: generateId(),
              lineNo: 2,
              accountId: creditAccountId,
              debitAmount: '0',
              creditAmount: '10.00',
              description: null,
              sourceLineReference: null,
            },
          ],
        },
      );
      await expect(post(legalVoucherId)).resolves.toMatchObject({
        kind: 'posted',
      });
      expect(
        (await markerRow(configurationId)).operationallyUsedAt,
      ).not.toBeNull();
    }, 90_000);

    it('leaves finalized rows untouched by a later close, and keeps sibling periods open (Tasks 10–13 intact)', async () => {
      const calendar = await seedCalendar();
      const voucherId = await temporaryVoucher(calendar);
      await post(voucherId);

      const db = await client();
      const ledgerBefore = await db.ledgerEntry.findMany({
        where: { voucherId },
        orderBy: [{ lineNo: 'asc' }],
      });
      const balanceBefore = await db.accountBalanceProjection.count({
        where: { accountingPeriodId: calendar.periodId },
      });

      await transition(calendar.periodId, 'close');
      await transition(calendar.periodId, 'seal');

      const ledgerAfter = await db.ledgerEntry.findMany({
        where: { voucherId },
        orderBy: [{ lineNo: 'asc' }],
      });
      expect(ledgerAfter).toEqual(ledgerBefore);
      expect(
        await db.accountBalanceProjection.count({
          where: { accountingPeriodId: calendar.periodId },
        }),
      ).toBe(balanceBefore);
      expect((await documentRow(voucherId)).state).toBe('final');

      // Task 10.5: readiness is a statement about the voucher, not about the
      // calendar — it stays `ready` after the period is sealed.
      await expect(
        readiness.evaluateReadiness(organizationId, voucherId),
      ).resolves.toMatchObject({ status: 'ready' });

      // Nothing became globally "closed": a NEW period of the same
      // organization/area still accepts a posting (no redirect, no cascade).
      const sibling = await seedCalendar();
      const siblingVoucherId = await temporaryVoucher(
        sibling,
        'Sibling open period',
      );
      const posted = (await post(siblingVoucherId)) as {
        document: { accountingPeriodId: string };
      };
      expect(posted.document.accountingPeriodId).toBe(sibling.periodId);
      expect(
        await db.ledgerEntry.count({ where: { voucherId: siblingVoucherId } }),
      ).toBe(2);
    }, 90_000);

    it('keeps the refused voucher postable again once the period is reopened', async () => {
      // The guard refuses a state, it does not spoil the document: after the
      // contract's explicit reopen the same voucher finalizes, once, with a
      // fresh operation key.
      const calendar = await seedCalendar();
      const voucherId = await temporaryVoucher(
        calendar,
        'Refused, then opened',
      );
      await transition(calendar.periodId, 'close');
      await expect(post(voucherId)).rejects.toBeInstanceOf(
        AccountingDocumentScopeRejectedError,
      );
      await transition(
        calendar.periodId,
        'reopen',
        'Correction window for the refused voucher',
      );
      await expect(post(voucherId)).resolves.toMatchObject({ kind: 'posted' });
      const traces = await traceCounts(voucherId);
      expect(traces.ledgerEntries).toBe(2);
      expect(traces.postingOperations).toBe(1);
    }, 90_000);
  },
);
