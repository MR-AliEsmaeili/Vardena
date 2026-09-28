import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { NumberingService } from '../src/modules/documents/application/numbering.service.js';
import { NumberingSeriesService } from '../src/modules/documents/application/numbering-series.service.js';
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import { AccountingDocumentsRepository } from '../src/modules/accounting/data/accounting-documents.repository.js';
import type {
  AccountingDocumentLineWrite,
  CreateAccountingDocumentInput,
} from '../src/modules/accounting/data/accounting-documents.repository.js';
import { AccountingDocumentsService } from '../src/modules/accounting/application/accounting-documents.service.js';
import { AccountStatementsService } from '../src/modules/accounting/application/account-statements.service.js';
import { PostingService } from '../src/modules/accounting/application/posting.service.js';
import {
  amountsEqual,
  canonicalizeAmount,
  sumAmounts,
} from '../src/modules/accounting/domain/money.js';
import { createTestApp } from './support/test-app.js';

/**
 * Account statement against REAL PostgreSQL (Task 17B live suite, Owner
 * decisions D1–D7).
 *
 * Skipped unless `VARDENA_TEST_DATABASE_URL` is set (CI with Postgres, or
 * local Docker); requires a generated client and a migrated database. Where
 * the fake-backed e2e suite proves the HTTP contract, this suite proves the
 * parts only a real database can answer, on rows genuinely POSTED through the
 * module's own finalization and reversal transactions:
 *
 * - the statement math over real `numeric(18,2)` rows — exact opening /
 *   running / closing incl. a REVERSAL PAIR whose movements net to zero
 *   without cancelling their own rows (D3, AC-D-31);
 * - the intra-year, SEQUENCE-based opening (D2) reconciled against the
 *   Task 12 derived view `accounting.vw_account_balance_derived` — the
 *   projection agrees with the ledger-derived opening it was maintained from;
 * - the deliberate no-carry-forward boundary: a new fiscal year opens at `0`
 *   no matter what the prior year closed at (ADR-0031 §9);
 * - period SEQUENCE beats calendar order when the two disagree (the Q6/Q17
 *   misaligned fixture) and gaps in the sequence are skipped silently;
 * - organization isolation as a real SQL predicate (foreign scope keys are
 *   404 — never 403, never foreign rows);
 * - `open`, `closed` and `sealed` periods are all readable and reading never
 *   touches period status (decision D5);
 * - no mutation of ledger entries, vouchers, accounts, periods or
 *   `account_balance_projections` across every window shape.
 */
const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

describe.skipIf(DATABASE_URL === undefined)(
  'Accounting account statements (live database)',
  () => {
    const suffix = generateId().slice(-8);

    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let documents: AccountingDocumentsRepository;
    let documentService: AccountingDocumentsService;
    let numbering: NumberingService;
    let posting: PostingService;
    let statements: AccountStatementsService;

    interface Book {
      organizationId: string;
      financialAreaId: string;
      codingStructureVersionId: string;
      accountingConfigurationId: string;
      cashAccountId: string;
      revenueAccountId: string;
    }

    /** Book A: 2026 (periods seq 1, 2, 5) + 2027 — the D2 boundary fixture. */
    const bookA: Book & {
      yearId: string;
      period1: string;
      period2: string;
      period5: string;
      nextYearId: string;
      nextPeriodId: string;
    } = {
      organizationId: '',
      financialAreaId: '',
      codingStructureVersionId: '',
      accountingConfigurationId: '',
      cashAccountId: '',
      revenueAccountId: '',
      yearId: '',
      period1: '',
      period2: '',
      period5: '',
      nextYearId: '',
      nextPeriodId: '',
    };

    /** Book B: the foreign organization whose rows must stay unreachable. */
    const bookB: Book & { yearId: string; periodId: string } = {
      organizationId: '',
      financialAreaId: '',
      codingStructureVersionId: '',
      accountingConfigurationId: '',
      cashAccountId: '',
      revenueAccountId: '',
      yearId: '',
      periodId: '',
    };

    /**
     * Book C: the Q6/Q17 MISALIGNED fixture — period sequence deliberately
     * disagrees with the calendar (seq 1 = March, seq 2 = January,
     * seq 3 = February). The opening must follow SEQUENCE (ADR-0031 §4),
     * never the calendar.
     */
    const bookC: Book & {
      yearId: string;
      periodSeq1Mar: string;
      periodSeq2Jan: string;
      periodSeq3Feb: string;
    } = {
      organizationId: '',
      financialAreaId: '',
      codingStructureVersionId: '',
      accountingConfigurationId: '',
      cashAccountId: '',
      revenueAccountId: '',
      yearId: '',
      periodSeq1Mar: '',
      periodSeq2Jan: '',
      periodSeq3Feb: '',
    };

    const client = async (): Promise<{
      $queryRaw: (
        query: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<unknown>;
      ledgerEntry: {
        count: (args: unknown) => Promise<number>;
        aggregate: (args: unknown) => Promise<{
          _sum: { debitAmount: unknown; creditAmount: unknown };
        }>;
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      accountBalanceProjection: {
        findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      accountingPostingOperation: {
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      accountingDocumentLine: {
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      accountingDocument: {
        count: (args: unknown) => Promise<number>;
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      accountingPeriod: {
        findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
        update: (args: unknown) => Promise<unknown>;
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      fiscalYear: { deleteMany: (args: unknown) => Promise<unknown> };
      account: { deleteMany: (args: unknown) => Promise<unknown> };
      codingStructureLevel: { deleteMany: (args: unknown) => Promise<unknown> };
      codingStructureVersion: {
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      financialArea: { deleteMany: (args: unknown) => Promise<unknown> };
      numberingAllocation: { deleteMany: (args: unknown) => Promise<unknown> };
      numberingSeries: { deleteMany: (args: unknown) => Promise<unknown> };
      organization: { deleteMany: (args: unknown) => Promise<unknown> };
    }> => prisma.getClient<never>() as never;

    const line = (
      accountId: string,
      debitAmount: string,
      creditAmount: string,
      lineNo: number,
      description: string | null = null,
    ): AccountingDocumentLineWrite => ({
      id: generateId(),
      lineNo,
      accountId,
      debitAmount,
      creditAmount,
      description,
      sourceLineReference: null,
    });

    /** Compose a voucher in one book and post it exactly as production does. */
    const postVoucher = async (
      book: Book,
      input: {
        documentDate: Date;
        description: string;
        lines: AccountingDocumentLineWrite[];
        finalize: boolean;
        issue: boolean;
      },
    ): Promise<string> => {
      const create: CreateAccountingDocumentInput = {
        id: generateId(),
        organizationId: book.organizationId,
        financialAreaId: book.financialAreaId,
        documentDate: input.documentDate,
        description: input.description,
        state: 'draft',
        origin: 'manual',
        branchId: null,
        source: null,
        documentNumber: null,
        correlationId: null,
        idempotencyReference: null,
        requestHash: null,
        lines: input.lines,
        ledger: null,
        createdAt: new Date(),
        createdBy: null,
      };
      const created = await documents.createChecked(create);

      if (input.issue || input.finalize) {
        const number = (
          await numbering.allocateNumber({
            organizationId: book.organizationId,
            documentType: 'accounting_voucher',
            scopeKey: book.financialAreaId.toLowerCase(),
            allocationKey: `as-issue-${created.id}`,
            referenceModule: 'accounting',
            referenceDocumentType: 'accounting_voucher',
            referenceDocumentId: created.id,
          })
        ).number;
        await documents.issueChecked({
          id: created.id,
          organizationId: book.organizationId,
          documentNumber: number,
          updatedAt: new Date(),
          updatedBy: null,
        });
      }

      if (input.finalize) {
        // THE PRODUCTION ENTRY POINT (Task 10.8): one atomic finalization
        // transaction materializes the ledger rows this suite reads.
        await posting.postVoucher({
          organizationId: book.organizationId,
          voucherId: created.id,
          operationKey: `as-final-${created.id}`,
        });
      }
      return created.id;
    };

    const insertYear = async (
      book: Book,
      id: string,
      code: string,
      yearStart: string,
      yearEnd: string,
    ): Promise<void> => {
      const db = await client();
      await db.$queryRaw`INSERT INTO accounting.fiscal_years (
        id, organization_id, financial_area_id, code, title, start_date, end_date,
        status, is_active, created_at, updated_at
      ) VALUES (${id}, ${book.organizationId}, ${book.financialAreaId}, ${code}, ${`Year ${code}`},
        ${yearStart}::date, ${yearEnd}::date, 'open', true, now(), now())`;
    };

    const insertPeriod = async (
      book: Book,
      input: {
        id: string;
        fiscalYearId: string;
        sequence: number;
        title: string;
        startDate: string;
        endDate: string;
      },
    ): Promise<void> => {
      const db = await client();
      await db.$queryRaw`INSERT INTO accounting.accounting_periods (
        id, organization_id, financial_area_id, fiscal_year_id, sequence, title,
        start_date, end_date, status, created_at, updated_at
      ) VALUES (${input.id}, ${book.organizationId}, ${book.financialAreaId}, ${input.fiscalYearId},
        ${input.sequence}, ${input.title}, ${input.startDate}::date, ${input.endDate}::date,
        'open', now(), now())`;
    };

    const seedChart = async (book: Book, code: string): Promise<void> => {
      const db = await client();
      const organizations = app?.get(OrganizationsService);
      if (organizations === undefined) throw new Error('app not initialized');
      book.organizationId = (
        await organizations.createOrganization({
          code,
          name: `Statements live ${code}`,
        })
      ).id;

      book.financialAreaId = generateId();
      await db.$queryRaw`INSERT INTO accounting.financial_areas (
        id, organization_id, code, title, is_active, is_default, created_at, updated_at
      ) VALUES (${book.financialAreaId}, ${book.organizationId}, ${'GA'}, ${'General area'}, true, false, now(), now())`;

      book.codingStructureVersionId = generateId();
      await db.$queryRaw`INSERT INTO accounting.coding_structure_versions (
        id, organization_id, code, version_number, status, max_depth, separator,
        created_at, updated_at
      ) VALUES (${book.codingStructureVersionId}, ${book.organizationId}, ${'DEFAULT'}, 1, 'published', 1, '', now(), now())`;

      book.accountingConfigurationId = generateId();
      await db.$queryRaw`INSERT INTO accounting.accounting_configurations (
        id, organization_id, code, name, version_number, status, created_at, updated_at
      ) VALUES (${book.accountingConfigurationId}, ${book.organizationId}, ${'DEFAULT'}, ${'Main'}, 1, 'ACTIVE', now(), now())`;
      await db.$queryRaw`INSERT INTO accounting.accounting_configuration_levels (
        id, organization_id, accounting_configuration_id, level_index, title, digit_length, default_is_postable, created_at, updated_at
      ) VALUES (${generateId()}, ${book.organizationId}, ${book.accountingConfigurationId}, 1, ${'Level 1'}, 2, true, now(), now())`;

      const accounts: Array<[keyof Book, string, string]> = [
        ['cashAccountId', '1000', 'Cash'],
        ['revenueAccountId', '2000', 'Revenue'],
      ];
      for (const [key, accountCode, title] of accounts) {
        const id = generateId();
        book[key] = id;
        await db.$queryRaw`INSERT INTO accounting.accounts (
          id, organization_id, code, title, account_nature, is_postable, is_active,
          level, coding_structure_version_id, accounting_configuration_id, created_at, updated_at
        ) VALUES (${id}, ${book.organizationId}, ${accountCode}, ${title}, 'DEBIT', true, true, 1,
          ${book.codingStructureVersionId}, ${book.accountingConfigurationId}, now(), now())`;
      }

      await app?.get(NumberingSeriesService).createNumberingSeries({
        organizationId: book.organizationId,
        documentType: 'accounting_voucher',
        scopeKey: book.financialAreaId.toLowerCase(),
        name: `Statements live ${code}`,
        width: 4,
      });
    };

    /** `day(2026, 1, 15)` = 2026-01-15 — month is 1-based here (unlike `Date.UTC`). */
    const day = (year: number, month: number, date: number): Date =>
      new Date(Date.UTC(year, month - 1, date));

    const posted = {
      /** Book A, 2026 cash rows in statement order (see the math test). */
      a1: '',
      a2: '',
      a3: '',
      a4: '',
      a5: '',
      a6: '',
      reversal: '',
      aNextYear: '',
      aDraft: '',
      aTemporary: '',
      b1: '',
      cJan: '',
      cFeb: '',
      cMar: '',
    };

    beforeAll(async () => {
      const built = await createTestApp({
        override: (builder) =>
          builder
            .overrideProvider(APP_CONFIG)
            .useValue({ ...loadAppConfig(), databaseUrl: DATABASE_URL }),
      });
      app = built.app;
      prisma = built.module.get(PrismaService);
      documents = app.get(AccountingDocumentsRepository);
      documentService = app.get(AccountingDocumentsService);
      numbering = app.get(NumberingService);
      posting = app.get(PostingService);
      statements = app.get(AccountStatementsService);

      await seedChart(bookA, `AST-A-${suffix}`);
      await seedChart(bookB, `AST-B-${suffix}`);
      await seedChart(bookC, `AST-C-${suffix}`);

      // Book A: 2026 with a legal sequence GAP (1, 2, 5) + 2027 (D2 boundary).
      await insertYear(
        bookA,
        (bookA.yearId = generateId()),
        'Y2806',
        '2026-01-01',
        '2026-12-31',
      );
      await insertPeriod(bookA, {
        id: (bookA.period1 = generateId()),
        fiscalYearId: bookA.yearId,
        sequence: 1,
        title: 'Jan',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });
      await insertPeriod(bookA, {
        id: (bookA.period2 = generateId()),
        fiscalYearId: bookA.yearId,
        sequence: 2,
        title: 'Feb',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
      });
      await insertPeriod(bookA, {
        id: (bookA.period5 = generateId()),
        fiscalYearId: bookA.yearId,
        sequence: 5,
        title: 'Mar (sequence 5 — gap 3–4)',
        startDate: '2026-03-01',
        endDate: '2026-03-31',
      });
      await insertYear(
        bookA,
        (bookA.nextYearId = generateId()),
        'Y2807',
        '2027-01-01',
        '2027-12-31',
      );
      await insertPeriod(bookA, {
        id: (bookA.nextPeriodId = generateId()),
        fiscalYearId: bookA.nextYearId,
        sequence: 1,
        title: 'Next year period 1',
        startDate: '2027-01-01',
        endDate: '2027-12-31',
      });

      // Book B: one whole-year period (the isolation fixture).
      await insertYear(
        bookB,
        (bookB.yearId = generateId()),
        'Y2806',
        '2026-01-01',
        '2026-12-31',
      );
      await insertPeriod(bookB, {
        id: (bookB.periodId = generateId()),
        fiscalYearId: bookB.yearId,
        sequence: 1,
        title: 'Whole year',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      });

      // Book C: MISALIGNED sequences — seq 1 = March, seq 2 = January,
      // seq 3 = February. The opening must follow sequence, not the calendar.
      await insertYear(
        bookC,
        (bookC.yearId = generateId()),
        'Y2806',
        '2026-01-01',
        '2026-12-31',
      );
      await insertPeriod(bookC, {
        id: (bookC.periodSeq1Mar = generateId()),
        fiscalYearId: bookC.yearId,
        sequence: 1,
        title: 'March (sequence 1!)',
        startDate: '2026-03-01',
        endDate: '2026-03-31',
      });
      await insertPeriod(bookC, {
        id: (bookC.periodSeq2Jan = generateId()),
        fiscalYearId: bookC.yearId,
        sequence: 2,
        title: 'January (sequence 2!)',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });
      await insertPeriod(bookC, {
        id: (bookC.periodSeq3Feb = generateId()),
        fiscalYearId: bookC.yearId,
        sequence: 3,
        title: 'February (sequence 3)',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
      });

      // ---- book A movements (posted out of date order on purpose) ---------
      posted.a6 = await postVoucher(bookA, {
        documentDate: day(2026, 2, 20),
        description: 'Feb refund',
        lines: [
          line(bookA.revenueAccountId, '10.25', '0', 1, 'refund debit'),
          line(bookA.cashAccountId, '0', '10.25', 2, 'refund credit'),
        ],
        finalize: true,
        issue: true,
      });
      posted.a1 = await postVoucher(bookA, {
        documentDate: day(2026, 1, 15),
        description: 'Jan receipt',
        lines: [
          line(bookA.cashAccountId, '100.50', '0', 1, 'Jan cash'),
          line(bookA.revenueAccountId, '0', '100.50', 2),
        ],
        finalize: true,
        issue: true,
      });
      posted.a2 = await postVoucher(bookA, {
        documentDate: day(2026, 2, 10),
        description: 'Feb sale',
        lines: [
          line(bookA.cashAccountId, '40.25', '0', 1),
          line(bookA.revenueAccountId, '0', '40.25', 2),
        ],
        finalize: true,
        issue: true,
      });
      // Same business date as `a2`, posted later: its rows sort AFTER a2's by
      // the voucher-number tie-breaker, and its two cash legs sort by `lineNo`.
      posted.a4 = await postVoucher(bookA, {
        documentDate: day(2026, 2, 10),
        description: 'Feb split deposit',
        lines: [
          line(bookA.cashAccountId, '2.50', '0', 1, 'split one'),
          line(bookA.cashAccountId, '2.50', '0', 2, 'split two'),
          line(bookA.revenueAccountId, '0', '5.00', 3),
        ],
        finalize: true,
        issue: true,
      });
      posted.a5 = await postVoucher(bookA, {
        documentDate: day(2026, 3, 5),
        description: 'Mar cent',
        lines: [
          line(bookA.cashAccountId, '0.01', '0', 1, 'Exact cent'),
          line(bookA.revenueAccountId, '0', '0.01', 2),
        ],
        finalize: true,
        issue: true,
      });
      posted.a3 = await postVoucher(bookA, {
        documentDate: day(2026, 3, 10),
        description: 'Mar error posting',
        lines: [
          line(bookA.cashAccountId, '55.55', '0', 1, 'erroneous cash'),
          line(bookA.revenueAccountId, '0', '55.55', 2),
        ],
        finalize: true,
        issue: true,
      });
      // THE REVERSAL PAIR (Task 15, AC-D-22): the production reverse entry
      // point creates the counter-document. Both rows stay in the ledger and
      // their movements net to zero — nothing is deleted or hidden.
      posted.reversal = (
        await documentService.reverseDocument(bookA.organizationId, posted.a3, {
          reason: 'Posted in error',
          operationKey: `as-reverse-${posted.a3}`,
        })
      ).id;

      posted.aNextYear = await postVoucher(bookA, {
        documentDate: day(2027, 1, 15),
        description: 'Next year sale',
        lines: [
          line(bookA.cashAccountId, '10', '0', 1),
          line(bookA.revenueAccountId, '0', '10', 2),
        ],
        finalize: true,
        issue: true,
      });

      posted.aDraft = await postVoucher(bookA, {
        documentDate: day(2026, 3, 6),
        description: 'Draft never posted',
        lines: [
          line(bookA.cashAccountId, '999.99', '0', 1),
          line(bookA.revenueAccountId, '0', '999.99', 2),
        ],
        finalize: false,
        issue: false,
      });
      posted.aTemporary = await postVoucher(bookA, {
        documentDate: day(2026, 3, 7),
        description: 'Temporary never posted',
        lines: [
          line(bookA.cashAccountId, '888.88', '0', 1),
          line(bookA.revenueAccountId, '0', '888.88', 2),
        ],
        finalize: false,
        issue: true,
      });

      posted.b1 = await postVoucher(bookB, {
        documentDate: day(2026, 3, 15),
        description: 'Foreign org voucher',
        lines: [
          line(bookB.cashAccountId, '777.77', '0', 1),
          line(bookB.revenueAccountId, '0', '777.77', 2),
        ],
        finalize: true,
        issue: true,
      });

      // Book C movements land in their CALENDAR months: Jan → seq 2,
      // Feb → seq 3, Mar → seq 1.
      posted.cJan = await postVoucher(bookC, {
        documentDate: day(2026, 1, 10),
        description: 'Misaligned January',
        lines: [
          line(bookC.cashAccountId, '7', '0', 1),
          line(bookC.revenueAccountId, '0', '7', 2),
        ],
        finalize: true,
        issue: true,
      });
      posted.cFeb = await postVoucher(bookC, {
        documentDate: day(2026, 2, 10),
        description: 'Misaligned February',
        lines: [
          line(bookC.cashAccountId, '3', '0', 1),
          line(bookC.revenueAccountId, '0', '3', 2),
        ],
        finalize: true,
        issue: true,
      });
      posted.cMar = await postVoucher(bookC, {
        documentDate: day(2026, 3, 10),
        description: 'Misaligned March',
        lines: [
          line(bookC.cashAccountId, '1', '0', 1),
          line(bookC.revenueAccountId, '0', '1', 2),
        ],
        finalize: true,
        issue: true,
      });
    }, 180_000);

    afterAll(async () => {
      if (app !== undefined) {
        try {
          const db = await client();
          for (const book of [bookA, bookB, bookC]) {
            await db.ledgerEntry.deleteMany({
              where: { organizationId: book.organizationId },
            });
            await db.accountBalanceProjection.deleteMany({
              where: { organizationId: book.organizationId },
            });
            await db.accountingPostingOperation.deleteMany({
              where: { organizationId: book.organizationId },
            });
            await db.accountingDocumentLine.deleteMany({
              where: { organizationId: book.organizationId },
            });
            await db.accountingDocument.deleteMany({
              where: { organizationId: book.organizationId },
            });
            await db.accountingPeriod.deleteMany({
              where: { organizationId: book.organizationId },
            });
            await db.fiscalYear.deleteMany({
              where: { organizationId: book.organizationId },
            });
            await db.account.deleteMany({
              where: { organizationId: book.organizationId },
            });
            await db.$queryRaw`DELETE FROM accounting.accounting_configuration_levels WHERE organization_id = ${book.organizationId}`;
            await db.$queryRaw`DELETE FROM accounting.accounting_configurations WHERE organization_id = ${book.organizationId}`;
            await db.codingStructureLevel.deleteMany({
              where: { organizationId: book.organizationId },
            });
            await db.codingStructureVersion.deleteMany({
              where: { organizationId: book.organizationId },
            });
            await db.financialArea.deleteMany({
              where: { organizationId: book.organizationId },
            });
            await db.numberingAllocation.deleteMany({
              where: { organizationId: book.organizationId },
            });
            await db.numberingSeries.deleteMany({
              where: { organizationId: book.organizationId },
            });
            await db.organization.deleteMany({
              where: { id: book.organizationId },
            });
          }
        } finally {
          await app.close();
        }
      }
    }, 120_000);

    const statementA = (overrides: Record<string, unknown> = {}) =>
      statements.getAccountStatement({
        organizationId: bookA.organizationId,
        accountId: bookA.cashAccountId,
        fiscalYearId: bookA.yearId,
        page: 1,
        pageSize: 100,
        ...overrides,
      } as never);

    it('derives the whole-year statement exactly over real numeric(18,2) rows', async () => {
      const result = await statementA();
      // Cash rows in the FIXED statement order (documentDate, voucherNumber,
      // lineNo, id) — insertion order of the fixtures is deliberately NOT
      // this order. The reversal pair (Mar 10 debit + its counter credit)
      // keeps BOTH rows and nets them to zero inside the running balance.
      expect(
        result.movements.items.map((row) => [
          row.documentDate,
          row.lineNo,
          row.debitAmount,
          row.creditAmount,
          row.netAmount,
          row.runningBalanceAmount,
        ]),
      ).toEqual([
        ['2026-01-15', 1, '100.5', '0', '100.5', '100.5'],
        ['2026-02-10', 1, '40.25', '0', '40.25', '140.75'],
        ['2026-02-10', 1, '2.5', '0', '2.5', '143.25'],
        ['2026-02-10', 2, '2.5', '0', '2.5', '145.75'],
        ['2026-02-20', 2, '0', '10.25', '-10.25', '135.5'],
        ['2026-03-05', 1, '0.01', '0', '0.01', '135.51'],
        ['2026-03-10', 1, '55.55', '0', '55.55', '191.06'],
        ['2026-03-10', 1, '0', '55.55', '-55.55', '135.51'],
      ]);
      expect(result.totals).toEqual({
        openingBalanceAmount: '0',
        debitTotalAmount: '201.31',
        creditTotalAmount: '65.8',
        netChangeAmount: '135.51',
        closingBalanceAmount: '135.51',
      });
      // The unposted vouchers contributed nothing (posted-only ledger).
      const voucherIds = new Set(
        result.movements.items.map((row) => row.voucherId),
      );
      expect(voucherIds.has(posted.aDraft)).toBe(false);
      expect(voucherIds.has(posted.aTemporary)).toBe(false);
      expect(voucherIds.has(posted.a3)).toBe(true);
      expect(voucherIds.has(posted.reversal)).toBe(true);
    });

    it('opens periods intra-year by SEQUENCE and skips sequence gaps (D2)', async () => {
      const first = await statementA({ accountingPeriodId: bookA.period1 });
      const middle = await statementA({ accountingPeriodId: bookA.period2 });
      const last = await statementA({ accountingPeriodId: bookA.period5 });

      expect(first.totals.openingBalanceAmount).toBe('0');
      expect(middle.totals.openingBalanceAmount).toBe('100.5');
      // Sequences 3–4 do not exist — skipped silently (§7.1). The opening is
      // net(1) + net(2) = 100.5 + 35 = 135.5, never invented for the gap.
      expect(last.totals.openingBalanceAmount).toBe('135.5');
      expect(last.totals.closingBalanceAmount).toBe('135.51');
      for (const result of [first, middle, last]) {
        expect(
          sumAmounts([
            result.totals.openingBalanceAmount,
            result.totals.netChangeAmount,
          ]),
        ).toBe(result.totals.closingBalanceAmount);
      }
    });

    it('reconciles the statement opening with vw_account_balance_derived (Task 12)', async () => {
      const db = await client();
      for (const periodId of [bookA.period1, bookA.period2, bookA.period5]) {
        const rows = (await db.$queryRaw`
          SELECT "opening_balance_amount"::text AS opening
          FROM "accounting"."vw_account_balance_derived"
          WHERE "organization_id" = ${bookA.organizationId}
            AND "account_id" = ${bookA.cashAccountId}
            AND "accounting_period_id" = ${periodId}`) as Array<{
          opening: string;
        }>;
        expect(rows.length, periodId).toBe(1);
        const statement = await statementA({ accountingPeriodId: periodId });
        expect(
          amountsEqual(
            canonicalizeAmount(rows[0]?.opening ?? '0'),
            statement.totals.openingBalanceAmount,
          ),
          `period ${periodId}: view ${rows[0]?.opening} vs statement ${statement.totals.openingBalanceAmount}`,
        ).toBe(true);
      }
    });

    it('NEVER carries a prior year forward: 2027 opens at 0 (D2 boundary)', async () => {
      const previous = await statementA();
      expect(previous.totals.closingBalanceAmount).toBe('135.51');
      const next = await statementA({
        fiscalYearId: bookA.nextYearId,
        accountingPeriodId: bookA.nextPeriodId,
      });
      expect(next.totals).toEqual({
        openingBalanceAmount: '0',
        debitTotalAmount: '10',
        creditTotalAmount: '0',
        netChangeAmount: '10',
        closingBalanceAmount: '10',
      });
      expect(next.movements.total).toBe(1);
    });

    it('follows period SEQUENCE over the calendar when the two disagree (Q6/Q17)', async () => {
      // seq 1 = March, seq 2 = January, seq 3 = February.
      const january = await statements.getAccountStatement({
        organizationId: bookC.organizationId,
        accountId: bookC.cashAccountId,
        fiscalYearId: bookC.yearId,
        accountingPeriodId: bookC.periodSeq2Jan,
        page: 1,
        pageSize: 100,
      } as never);
      const february = await statements.getAccountStatement({
        organizationId: bookC.organizationId,
        accountId: bookC.cashAccountId,
        fiscalYearId: bookC.yearId,
        accountingPeriodId: bookC.periodSeq3Feb,
        page: 1,
        pageSize: 100,
      } as never);
      const march = await statements.getAccountStatement({
        organizationId: bookC.organizationId,
        accountId: bookC.cashAccountId,
        fiscalYearId: bookC.yearId,
        accountingPeriodId: bookC.periodSeq1Mar,
        page: 1,
        pageSize: 100,
      } as never);

      // March is FIRST in sequence: it opens at 0 — even though the calendar
      // would have given it 10 (Jan 7 + Feb 3).
      expect(march.totals.openingBalanceAmount).toBe('0');
      expect(march.totals.closingBalanceAmount).toBe('1');
      // January (seq 2) opens at March's net (1) — sequence, not the calendar.
      expect(january.totals.openingBalanceAmount).toBe('1');
      expect(january.totals.closingBalanceAmount).toBe('8');
      // February (seq 3) opens at net(1) + net(2) = 1 + 7 = 8.
      expect(february.totals.openingBalanceAmount).toBe('8');
      expect(february.totals.closingBalanceAmount).toBe('11');

      // The whole-year window still orders movements by the STATEMENT order
      // (documentDate — the business order), independent of period sequences.
      const whole = await statements.getAccountStatement({
        organizationId: bookC.organizationId,
        accountId: bookC.cashAccountId,
        fiscalYearId: bookC.yearId,
        page: 1,
        pageSize: 100,
      } as never);
      expect(
        whole.movements.items.map((row) => [
          row.documentDate,
          row.runningBalanceAmount,
        ]),
      ).toEqual([
        ['2026-01-10', '7'],
        ['2026-02-10', '10'],
        ['2026-03-10', '11'],
      ]);
    });

    it('is unreachable across organizations through every scope key (404, never 403)', async () => {
      for (const overrides of [
        { organizationId: bookB.organizationId },
        { accountId: bookB.cashAccountId },
        { fiscalYearId: bookB.yearId },
        { accountingPeriodId: bookB.periodId },
        { financialAreaId: bookB.financialAreaId },
      ]) {
        await expect(
          statementA(overrides as Record<string, unknown>),
        ).rejects.toMatchObject({ status: 404 });
      }
      // …while the foreign organization reads its own statement normally.
      const own = await statements.getAccountStatement({
        organizationId: bookB.organizationId,
        accountId: bookB.cashAccountId,
        fiscalYearId: bookB.yearId,
        page: 1,
        pageSize: 100,
      } as never);
      expect(own.totals).toEqual({
        openingBalanceAmount: '0',
        debitTotalAmount: '777.77',
        creditTotalAmount: '0',
        netChangeAmount: '777.77',
        closingBalanceAmount: '777.77',
      });
    });

    it('rejects a period of another fiscal year (422 — exists, out of scope)', async () => {
      await expect(
        statementA({ accountingPeriodId: bookA.nextPeriodId }),
      ).rejects.toMatchObject({ status: 422 });
    });

    it('reads OPEN, CLOSED and SEALED periods and never mutates their status (D5)', async () => {
      const db = await client();
      await db.accountingPeriod.update({
        where: { id: bookA.period1 },
        data: { status: 'closed' },
      });
      await db.accountingPeriod.update({
        where: { id: bookA.period5 },
        data: { status: 'sealed' },
      });

      const readPeriodRows = async () =>
        (await db.$queryRaw`
        SELECT id, status, updated_at
        FROM "accounting"."accounting_periods"
        WHERE id IN (${bookA.period1}, ${bookA.period2}, ${bookA.period5})
        ORDER BY sequence`) as Array<{
          id: string;
          status: string;
          updated_at: Date | string;
        }>;
      const before = await readPeriodRows();
      expect(before.map((row) => row.status)).toEqual([
        'closed',
        'open',
        'sealed',
      ]);

      const first = await statementA({ accountingPeriodId: bookA.period1 });
      const middle = await statementA({ accountingPeriodId: bookA.period2 });
      const last = await statementA({ accountingPeriodId: bookA.period5 });
      expect(first.scope.accountingPeriod?.status).toBe('closed');
      expect(middle.scope.accountingPeriod?.status).toBe('open');
      expect(last.scope.accountingPeriod?.status).toBe('sealed');
      // The SEALED period's rows are fully readable (decision D5).
      expect(last.movements.total).toBe(3);

      // Reading changed nothing: status AND updated_at are byte-identical.
      expect(await readPeriodRows()).toEqual(before);
      const reRead = await statementA({ accountingPeriodId: bookA.period5 });
      expect(reRead.scope.accountingPeriod?.status).toBe('sealed');
    });

    it('preserves numeric(18,2) exactness through the statement measures', async () => {
      const result = await statementA({ accountingPeriodId: bookA.period5 });
      const cent = result.movements.items[0];
      expect(cent?.debitAmount).toBe('0.01');
      for (const amount of [
        cent?.debitAmount,
        cent?.netAmount,
        cent?.runningBalanceAmount,
        result.totals.closingBalanceAmount,
      ]) {
        expect(typeof amount).toBe('string');
      }
      // 135.5 + 0.01 = 135.51 — a binary float would round-trip this wrong
      // in at least one of the spellings; the decimal strings do not.
      expect(result.totals.openingBalanceAmount).toBe('135.5');
      expect(result.totals.closingBalanceAmount).toBe('135.51');
    });

    it('pages deterministically and keeps the running balance continuous', async () => {
      const all = await statementA();
      const orderedIds = all.movements.items.map((row) => row.id);
      expect(orderedIds).toHaveLength(8);

      const pages = [] as Array<Array<string>>;
      const running = [] as Array<string>;
      for (const page of [1, 2, 3, 4]) {
        const result = await statementA({ page, pageSize: 2 });
        pages.push(result.movements.items.map((row) => row.id));
        running.push(
          ...result.movements.items.map((row) => row.runningBalanceAmount),
        );
        expect(result.totals).toEqual(all.totals); // totals are page-independent
      }
      expect(pages.flat()).toEqual(orderedIds);
      expect(running[running.length - 1]).toBe('135.51');

      const repeated = await statementA({ page: 1, pageSize: 2 });
      expect(repeated.movements.items.map((row) => row.id)).toEqual(
        pages[0] ?? [],
      );
      const beyond = await statementA({ page: 9, pageSize: 2 });
      expect(beyond.movements.items).toEqual([]);
      expect(beyond.movements.total).toBe(8);

      await expect(
        statementA({ sort: 'documentDate:desc' }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        statementA({ organizationId: generateId() }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('mutates nothing: ledger, vouchers, accounts, periods and projections are untouched', async () => {
      const db = await client();
      const snapshot = async () => ({
        ledgerCount: await db.ledgerEntry.count({
          where: { organizationId: bookA.organizationId },
        }),
        ledgerSums: await db.ledgerEntry.aggregate({
          where: { organizationId: bookA.organizationId },
          _sum: { debitAmount: true, creditAmount: true },
        }),
        documentCount: await db.accountingDocument.count({
          where: { organizationId: bookA.organizationId },
        }),
        projections: (
          (await db.accountBalanceProjection.findMany({
            where: { organizationId: bookA.organizationId },
            orderBy: { id: 'asc' },
          })) as Array<Record<string, unknown>>
        ).map((row) => ({
          id: row['id'],
          debit: String(row['periodDebitAmount'] ?? row['period_debit_amount']),
          credit: String(
            row['periodCreditAmount'] ?? row['period_credit_amount'],
          ),
          updatedAt: String(row['updatedAt'] ?? row['updated_at']),
        })),
        periods: (
          (await db.$queryRaw`
            SELECT id, status, updated_at
            FROM "accounting"."accounting_periods"
            WHERE organization_id = ${bookA.organizationId}
            ORDER BY sequence`) as Array<Record<string, unknown>>
        ).map((row) => ({
          id: row['id'],
          status: row['status'],
          updatedAt: String(row['updated_at']),
        })),
      });

      const before = await snapshot();
      // Every window shape, including an empty account and a foreign probe.
      await statementA();
      await statementA({ page: 3, pageSize: 2 });
      await statementA({ accountingPeriodId: bookA.period5 });
      await statementA({
        fiscalYearId: bookA.nextYearId,
        accountingPeriodId: bookA.nextPeriodId,
      });
      await statementA({ accountId: bookA.revenueAccountId });
      await expect(
        statementA({ accountId: bookB.cashAccountId }),
      ).rejects.toMatchObject({ status: 404 });

      const after = await snapshot();
      expect(after.ledgerCount).toBe(before.ledgerCount);
      expect(after.ledgerSums).toEqual(before.ledgerSums);
      expect(after.documentCount).toBe(before.documentCount);
      expect(after.projections).toEqual(before.projections);
      expect(after.periods).toEqual(before.periods);
    });
  },
);
