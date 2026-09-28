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
import { LedgerMovementsService } from '../src/modules/accounting/application/ledger-movements.service.js';
import { PostingService } from '../src/modules/accounting/application/posting.service.js';
import {
  compareAmounts,
  sumAmounts,
} from '../src/modules/accounting/domain/money.js';
import { createTestApp } from './support/test-app.js';

/**
 * Ledger movements against REAL PostgreSQL (Task 17A live suite).
 *
 * Skipped unless `VARDENA_TEST_DATABASE_URL` is set (CI with Postgres, or local
 * Docker); requires a generated client and a migrated database. Where the
 * fake-backed e2e suite proves the HTTP contract, this suite proves the parts
 * only a real database can answer, on rows that were genuinely POSTED through
 * the module's own finalization transaction:
 *
 * - the organization predicate is a real SQL filter: another organization's
 *   ledger rows exist in the same table and are unreachable through every
 *   filter combination (including foreign account/voucher/period ids);
 * - only posted movements come back: a `draft` and an issued `temporary`
 *   voucher have zero rows in `accounting.ledger_entries`, so they cannot
 *   appear in a page — the exclusion is the ledger's lifecycle, not a query
 *   clause that could be bypassed;
 * - the inclusive `DATE` business-date window behaves like the calendar's
 *   inclusive range rule (AC-I-03): boundary days are included;
 * - paging is stable across repeated executions and reconstructs one total
 *   order (business date, serial, line ordinal, unique id);
 * - `numeric(18,2)` amounts survive the round trip exactly (canonical decimal
 *   strings, no binary float), and a finalized voucher's movements still
 *   balance to the cent.
 */
const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

describe.skipIf(DATABASE_URL === undefined)(
  'Accounting ledger movements (live database)',
  () => {
    const suffix = generateId().slice(-8);

    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let documents: AccountingDocumentsRepository;
    let numbering: NumberingService;
    let movements: LedgerMovementsService;
    let posting: PostingService;

    interface Book {
      organizationId: string;
      financialAreaId: string;
      fiscalYearId: string;
      accountingPeriodId: string;
      codingStructureVersionId: string;
      accountingConfigurationId: string;
      cashAccountId: string;
      revenueAccountId: string;
      expenseAccountId: string;
    }

    const bookA: Book = {
      organizationId: '',
      financialAreaId: '',
      fiscalYearId: '',
      accountingPeriodId: '',
      codingStructureVersionId: '',
      accountingConfigurationId: '',
      cashAccountId: '',
      revenueAccountId: '',
      expenseAccountId: '',
    };
    const bookB: Book = { ...bookA };

    const client = async (): Promise<{
      $queryRaw: (
        query: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<unknown>;
      ledgerEntry: {
        count: (args: unknown) => Promise<number>;
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      accountBalanceProjection: {
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      accountingPostingOperation: {
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      accountingDocumentLine: {
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      accountingDocument: { deleteMany: (args: unknown) => Promise<unknown> };
      accountingPeriod: { deleteMany: (args: unknown) => Promise<unknown> };
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
        /** Compose but never post (draft / temporary fixtures). */
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
            allocationKey: `lm-issue-${created.id}`,
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
        // THE PRODUCTION ENTRY POINT, unshortened: `POST
        // /accounting-documents/:id/finalize` reaches `posting.postVoucher`,
        // which owns the lifecycle verdict, the idempotency identity and the
        // single atomic finalization transaction that materializes the ledger
        // rows this suite reads (Task 10.7/10.8, ADR-0022 §3). Calling the
        // repository's `finalizeChecked` directly would let the fixture drift
        // from what production actually posts.
        await posting.postVoucher({
          organizationId: book.organizationId,
          voucherId: created.id,
          operationKey: `lm-final-${created.id}`,
        });
      }
      return created.id;
    };

    const seedBook = async (
      book: Book,
      code: string,
      yearStart: string,
      yearEnd: string,
    ): Promise<void> => {
      const db = await client();
      const organizations = app?.get(OrganizationsService);
      if (organizations === undefined) throw new Error('app not initialized');
      book.organizationId = (
        await organizations.createOrganization({
          code,
          name: `Movements live ${code}`,
        })
      ).id;

      book.financialAreaId = generateId();
      await db.$queryRaw`INSERT INTO accounting.financial_areas (
        id, organization_id, code, title, is_active, is_default, created_at, updated_at
      ) VALUES (${book.financialAreaId}, ${book.organizationId}, ${'GA'}, ${'General area'}, true, false, now(), now())`;

      book.fiscalYearId = generateId();
      await db.$queryRaw`INSERT INTO accounting.fiscal_years (
        id, organization_id, financial_area_id, code, title, start_date, end_date,
        status, is_active, created_at, updated_at
      ) VALUES (${book.fiscalYearId}, ${book.organizationId}, ${book.financialAreaId}, ${'Y1405'}, ${'Year 1405'},
        ${yearStart}::date, ${yearEnd}::date, 'open', true, now(), now())`;

      book.accountingPeriodId = generateId();
      await db.$queryRaw`INSERT INTO accounting.accounting_periods (
        id, organization_id, financial_area_id, fiscal_year_id, sequence, title,
        start_date, end_date, status, created_at, updated_at
      ) VALUES (${book.accountingPeriodId}, ${book.organizationId}, ${book.financialAreaId}, ${book.fiscalYearId},
        1, ${'Whole year'}, ${yearStart}::date, ${yearEnd}::date, 'open', now(), now())`;

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
        ['expenseAccountId', '3000', 'Expense'],
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
        name: `Movements live ${code}`,
        width: 4,
      });
    };

    /** Business dates of the org-A fixture (deliberately non-ascending posts). */
    const day = (year: number, month: number, date: number): Date =>
      new Date(Date.UTC(year, month, date));

    const posted = {
      /** Posted LAST but dated first — proves the order is the business order. */
      earlier: '',
      mid: '',
      late: '',
      draft: '',
      temporary: '',
      foreign: '',
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
      numbering = app.get(NumberingService);
      movements = app.get(LedgerMovementsService);
      posting = app.get(PostingService);

      await seedBook(bookA, `LMV-A-${suffix}`, '2026-01-01', '2026-12-31');
      await seedBook(bookB, `LMV-B-${suffix}`, '2026-01-01', '2026-12-31');

      // Posted out of date order on purpose: insertion order must not decide
      // the reading order.
      posted.late = await postVoucher(bookA, {
        documentDate: day(2026, 3, 20),
        description: 'Late April voucher',
        lines: [
          line(bookA.cashAccountId, '100.00', '0', 1, 'Late leg one'),
          line(bookA.revenueAccountId, '0', '100.00', 2, 'Late leg two'),
        ],
        finalize: true,
        issue: true,
      });

      posted.mid = await postVoucher(bookA, {
        documentDate: day(2026, 3, 10),
        description: 'Mid April voucher',
        lines: [
          line(bookA.cashAccountId, '250.50', '0', 1, 'Mid leg one'),
          line(bookA.expenseAccountId, '0', '200.00', 2, 'Mid leg two'),
          line(bookA.revenueAccountId, '0', '50.50', 3, 'Mid leg three'),
        ],
        finalize: true,
        issue: true,
      });

      posted.earlier = await postVoucher(bookA, {
        documentDate: day(2026, 3, 1),
        description: 'Earlier April voucher',
        lines: [
          line(bookA.cashAccountId, '0.01', '0', 1, 'Exact cent'),
          line(bookA.revenueAccountId, '0', '0.01', 2, null),
        ],
        finalize: true,
        issue: true,
      });

      // Never posted: a draft (composed only) and an issued temporary voucher.
      posted.draft = await postVoucher(bookA, {
        documentDate: day(2026, 3, 25),
        description: 'Draft never posted',
        lines: [
          line(bookA.cashAccountId, '999.99', '0', 1),
          line(bookA.revenueAccountId, '0', '999.99', 2),
        ],
        finalize: false,
        issue: false,
      });
      posted.temporary = await postVoucher(bookA, {
        documentDate: day(2026, 3, 26),
        description: 'Temporary never posted',
        lines: [
          line(bookA.cashAccountId, '888.88', '0', 1),
          line(bookA.revenueAccountId, '0', '888.88', 2),
        ],
        finalize: false,
        issue: true,
      });

      // The foreign organization's real posted evidence: same table, same
      // period, and it must stay unreachable from every org-A query.
      posted.foreign = await postVoucher(bookB, {
        documentDate: day(2026, 3, 15),
        description: 'Foreign org voucher',
        lines: [
          line(bookB.cashAccountId, '777.77', '0', 1),
          line(bookB.revenueAccountId, '0', '777.77', 2),
        ],
        finalize: true,
        issue: true,
      });
    }, 180_000);

    afterAll(async () => {
      if (app !== undefined) {
        try {
          const db = await client();
          for (const book of [bookA, bookB]) {
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

    const listA = (overrides: Record<string, unknown> = {}) =>
      movements.listMovements({
        organizationId: bookA.organizationId,
        page: 1,
        pageSize: 100,
        ...overrides,
      });

    it('returns every posted movement of the organization and nothing else', async () => {
      const page = await listA();
      // 2 + 3 + 2 entries across the three finalized vouchers.
      expect(page.total).toBe(7);
      expect(page.items).toHaveLength(7);

      const voucherIds = new Set(page.items.map((item) => item.voucherId));
      expect(voucherIds).toEqual(
        new Set([posted.earlier, posted.mid, posted.late]),
      );
      expect(voucherIds.has(posted.draft)).toBe(false);
      expect(voucherIds.has(posted.temporary)).toBe(false);
      expect(voucherIds.has(posted.foreign)).toBe(false);
      // Every returned row belongs to the requested organization.
      for (const item of page.items) {
        expect(item.organizationId).toBe(bookA.organizationId);
      }
    });

    it('proves the un-posted vouchers really have no ledger rows (lifecycle, not a filter)', async () => {
      const db = await client();
      expect(
        await db.ledgerEntry.count({ where: { voucherId: posted.draft } }),
      ).toBe(0);
      expect(
        await db.ledgerEntry.count({ where: { voucherId: posted.temporary } }),
      ).toBe(0);
      expect(
        await db.ledgerEntry.count({
          where: { organizationId: bookB.organizationId },
        }),
      ).toBe(2);
    });

    it('orders by business date, then serial, then line ordinal', async () => {
      const page = await listA();
      const keys = page.items.map(
        (item) => `${item.documentDate}|${item.voucherNumber}|${item.lineNo}`,
      );
      expect(keys).toEqual([...keys].sort());
      // The first movement is the earliest DATED voucher — not the first posted.
      expect(page.items[0]?.voucherId).toBe(posted.earlier);
      expect(page.items[0]?.documentDate).toBe('2026-04-01');
      expect(page.items.at(-1)?.voucherId).toBe(posted.late);
      // One voucher's lines stay adjacent and in order.
      const mids = page.items.filter((item) => item.voucherId === posted.mid);
      expect(mids.map((item) => item.lineNo)).toEqual([1, 2, 3]);
    });

    it('is unreachable across organizations through every filter', async () => {
      // Direct: the foreign organization's rows are not in an org-A page.
      const page = await listA();
      expect(
        page.items.some((item) => item.organizationId !== bookA.organizationId),
      ).toBe(false);

      // Through a foreign voucher id, account id, period id and area id.
      for (const filter of [
        { voucherId: posted.foreign },
        { accountId: bookB.cashAccountId },
        { accountingPeriodId: bookB.accountingPeriodId },
        { financialAreaId: bookB.financialAreaId },
        { fiscalYearId: bookB.fiscalYearId },
      ]) {
        const foreign = await listA(filter);
        expect(foreign.items, JSON.stringify(filter)).toEqual([]);
        expect(foreign.total, JSON.stringify(filter)).toBe(0);
      }

      // …while the foreign organization reads its own movements normally.
      const ownB = await movements.listMovements({
        organizationId: bookB.organizationId,
        page: 1,
        pageSize: 100,
      });
      expect(ownB.total).toBe(2);
      expect(ownB.items[0]?.voucherId).toBe(posted.foreign);
    });

    it('filters by account over the real column', async () => {
      const page = await listA({ accountId: bookA.cashAccountId });
      // One debit line per finalized voucher.
      expect(page.total).toBe(3);
      for (const item of page.items) {
        expect(item.accountId).toBe(bookA.cashAccountId);
        expect(item.creditAmount).toBe('0');
      }
      expect(sumAmounts(page.items.map((item) => item.debitAmount))).toBe(
        '350.51',
      );
    });

    it('treats the business-date window as inclusive on both ends (AC-I-03)', async () => {
      const bothBounds = await listA({
        dateFrom: '2026-04-10',
        dateTo: '2026-04-20',
      });
      // Both boundary days are inside: the 10th (mid) and the 20th (late).
      expect(bothBounds.total).toBe(5);
      expect(new Set(bothBounds.items.map((item) => item.voucherId))).toEqual(
        new Set([posted.mid, posted.late]),
      );

      const singleDay = await listA({
        dateFrom: '2026-04-01',
        dateTo: '2026-04-01',
      });
      expect(singleDay.total).toBe(2);
      expect(singleDay.items[0]?.documentDate).toBe('2026-04-01');

      const openStart = await listA({ dateTo: '2026-04-10' });
      expect(openStart.total).toBe(5);
      const openEnd = await listA({ dateFrom: '2026-04-20' });
      expect(openEnd.total).toBe(2);
    });

    it('filters by voucher id and by the immutable serial snapshot', async () => {
      const byId = await listA({ voucherId: posted.mid });
      expect(byId.total).toBe(3);
      const serial = byId.items[0]?.voucherNumber;
      expect(serial).toBeTruthy();

      const bySerial = await listA({ voucherNumber: serial });
      expect(bySerial.total).toBe(3);
      expect(new Set(bySerial.items.map((item) => item.voucherId))).toEqual(
        new Set([posted.mid]),
      );

      const unknownSerial = await listA({ voucherNumber: 'ZZZZ' });
      expect(unknownSerial).toEqual({
        items: [],
        total: 0,
        page: 1,
        pageSize: 100,
      });
    });

    it('pages deterministically with a total order (no gaps, no duplicates)', async () => {
      const all = await listA();
      const orderedIds = all.items.map((item) => item.id);

      const first = await listA({ page: 1, pageSize: 3 });
      const second = await listA({ page: 2, pageSize: 3 });
      const third = await listA({ page: 3, pageSize: 3 });

      expect(
        [...first.items, ...second.items, ...third.items].map(
          (item) => item.id,
        ),
      ).toEqual(orderedIds);
      for (const page of [first, second, third]) {
        expect(page.total).toBe(7);
      }

      // Re-running the same page answers the same rows in the same order.
      const repeated = await listA({ page: 1, pageSize: 3 });
      expect(repeated.items.map((item) => item.id)).toEqual(
        first.items.map((item) => item.id),
      );

      // Beyond the end: an empty page, with the true total.
      const beyond = await listA({ page: 4, pageSize: 3 });
      expect(beyond.items).toEqual([]);
      expect(beyond.total).toBe(7);
      expect(beyond.page).toBe(4);
    });

    it('preserves numeric(18,2) exactness through the round trip', async () => {
      const page = await listA();
      const cent = page.items.find((item) => item.voucherId === posted.earlier);
      // Stored 0.01 → read back exactly (and canonicalized, never a float).
      expect(cent?.debitAmount).toBe('0.01');
      expect(typeof cent?.debitAmount).toBe('string');

      const half = page.items.find(
        (item) => item.voucherId === posted.mid && item.lineNo === 1,
      );
      // Stored 250.50 → canonical 250.5: exact, not a rounded float.
      expect(half?.debitAmount).toBe('250.5');
      expect(half?.creditAmount).toBe('0');

      // The posted voucher still balances to the cent, on the movement source.
      for (const voucherId of [posted.earlier, posted.mid, posted.late]) {
        const rows = page.items.filter((item) => item.voucherId === voucherId);
        expect(
          compareAmounts(
            sumAmounts(rows.map((item) => item.debitAmount)),
            sumAmounts(rows.map((item) => item.creditAmount)),
          ),
          voucherId,
        ).toBe(0);
      }
    });

    it('exposes the stored scope and traceability snapshots unchanged', async () => {
      const page = await listA({ voucherId: posted.mid });
      for (const item of page.items) {
        expect(item.financialAreaId).toBe(bookA.financialAreaId);
        expect(item.fiscalYearId).toBe(bookA.fiscalYearId);
        expect(item.accountingPeriodId).toBe(bookA.accountingPeriodId);
        expect(item.origin).toBe('manual');
        expect(item.sourceModule).toBeNull();
        expect(item.voucherNumber).toMatch(/^\d{4}$/);
        expect(item.postingTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        // The posting timestamp is a real instant; the business date is a day.
        expect(item.documentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('refuses an organization that does not exist (404, never an empty page)', async () => {
      await expect(
        movements.listMovements({
          organizationId: generateId(),
          page: 1,
          pageSize: 10,
        }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('rejects a malformed business date before touching the database', async () => {
      await expect(listA({ dateFrom: '2026-13-01' })).rejects.toMatchObject({
        status: 400,
      });
    });

    it('rejects a sort field outside the allow-list', async () => {
      await expect(listA({ sort: 'debitAmount:desc' })).rejects.toMatchObject({
        status: 400,
      });
    });
  },
);
