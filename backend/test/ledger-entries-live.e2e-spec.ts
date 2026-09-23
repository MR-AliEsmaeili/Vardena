import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { DocumentTypeRegistry } from '../src/modules/documents/application/document-type-registry.js';
import { NumberingService } from '../src/modules/documents/application/numbering.service.js';
import { NumberingSeriesService } from '../src/modules/documents/application/numbering-series.service.js';
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import { AccountingDocumentsRepository } from '../src/modules/accounting/data/accounting-documents.repository.js';
import type {
  CreateAccountingDocumentInput,
  AccountingDocumentLineWrite,
} from '../src/modules/accounting/data/accounting-documents.repository.js';
import { LedgerEntriesRepository } from '../src/modules/accounting/data/ledger-entries.repository.js';
import { ACCOUNTING_VOUCHER_DOCUMENT_TYPE } from '../src/modules/accounting/domain/accounting-document.js';
import { createTestApp } from './support/test-app.js';

/**
 * Live-database suite for the immutable ledger entries (Task 10.7,
 * contract §12/§13/§15/§19).
 *
 * Skipped unless `VARDENA_TEST_DATABASE_URL` is set (CI with Postgres, or
 * local Docker); requires a generated client (`npm run prisma:generate`) and a
 * migrated database (`prisma migrate dev`). It drives the DATA layer directly
 * — the one place where the guarantees under test genuinely live:
 *
 * - materialization: finalization writes exactly one entry per stored line,
 *   with the full sourcing snapshot (scope, voucher + number, line, account,
 *   exact amounts, business date, posting timestamp, origin/source, branch,
 *   correlation, finalizer) — and nothing is written for a draft or a
 *   temporary voucher;
 * - atomicity: the state change, the N entries and the idempotency row commit
 *   together or not at all — a lost key race leaves the voucher temporary
 *   with no entries, and a colliding hand-written entry aborts the
 *   finalization;
 * - the backstops: `uq_ledger_entries_voucher_line_id` (the 1:1 VoucherLine →
 *   LedgerEntry rule) and the read indexes exist with their contract names;
 * - the foreign keys: every entry references a real voucher/line/account/
 *   scope row, and RESTRICT keeps a posted voucher, line or account from ever
 *   disappearing;
 * - `numeric(18,2)` persistence: what is stored is read back exactly, with no
 *   binary-float drift.
 *
 * The HTTP journey (finalize → entries, replay → no second set) lives in
 * `accounting-documents.e2e-spec.ts`; the entry invariants live in the
 * `ledger-entry`/`posting` unit suites. This file is the only place the ledger
 * SQL is real.
 */
const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

describe.skipIf(DATABASE_URL === undefined)(
  'Accounting ledger entries (live database)',
  () => {
    const suffix = generateId().slice(-8);

    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let documents: AccountingDocumentsRepository;
    let ledger: LedgerEntriesRepository;
    let numbering: NumberingService;

    let organizationId = '';
    let financialAreaId = '';
    let fiscalYearId = '';
    let accountingPeriodId = '';
    let codingStructureVersionId = '';
    let accountingConfigurationId = '';
    let debitAccountId = '';
    let creditAccountId = '';
    let branchId = '';

    const client = async (): Promise<{
      $queryRaw: (
        query: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<unknown>;
      accountingDocument: {
        count: (args: unknown) => Promise<number>;
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      accountingDocumentLine: {
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      accountingPostingOperation: {
        count: (args: unknown) => Promise<number>;
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      ledgerEntry: {
        count: (args: unknown) => Promise<number>;
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      accountBalanceProjection: {
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      accountingPeriod: { deleteMany: (args: unknown) => Promise<unknown> };
      numberingAllocation: { deleteMany: (args: unknown) => Promise<unknown> };
      numberingSeries: { deleteMany: (args: unknown) => Promise<unknown> };
      fiscalYear: { deleteMany: (args: unknown) => Promise<unknown> };
      account: {
        count: (args: unknown) => Promise<number>;
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      branch: { deleteMany: (args: unknown) => Promise<unknown> };
      codingStructureLevel: { deleteMany: (args: unknown) => Promise<unknown> };
      codingStructureVersion: {
        deleteMany: (args: unknown) => Promise<unknown>;
      };
      financialArea: { deleteMany: (args: unknown) => Promise<unknown> };
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

    /** A well-formed sha256-shaped hash for the fixture ledger rows. */
    const TEST_REQUEST_HASH = 'b'.repeat(64);

    const draftInput = (
      overrides: Partial<CreateAccountingDocumentInput> = {},
    ): CreateAccountingDocumentInput => ({
      id: generateId(),
      organizationId,
      financialAreaId,
      documentDate: new Date(Date.UTC(2026, 3, 5)),
      description: 'Live ledger entry',
      state: 'draft',
      origin: 'manual',
      branchId: null,
      source: null,
      documentNumber: null,
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

    /** The idempotency row the service writes LAST inside the effect's tx. */
    const finalizeLedgerRow = (
      operationKey: string,
      documentId: string,
    ): NonNullable<CreateAccountingDocumentInput['ledger']> => ({
      id: generateId(),
      organizationId,
      operationKey,
      operation: 'document_finalize',
      requestHash: TEST_REQUEST_HASH,
      result: { documentId },
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
    });

    const issueVoucher = async (documentId: string): Promise<string> => {
      const number = (
        await numbering.allocateNumber({
          organizationId,
          documentType: 'accounting_voucher',
          scopeKey: financialAreaId.toLowerCase(),
          allocationKey: `ledger-issue-${documentId}`,
          referenceModule: 'accounting',
          referenceDocumentType: 'accounting_voucher',
          referenceDocumentId: documentId,
        })
      ).number;
      await documents.issueChecked({
        id: documentId,
        organizationId,
        documentNumber: number,
        updatedAt: new Date(),
        updatedBy: null,
      });
      return number;
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
      ledger = app.get(LedgerEntriesRepository);
      numbering = app.get(NumberingService);

      // Same ownership assertion as the voucher live suite: the voucher type
      // is registered by `AccountingDocumentTypeRegistration` during
      // `app.init()`, never by a test.
      const registered = app
        .get(DocumentTypeRegistry)
        .all()
        .filter(
          (definition) => definition.code === ACCOUNTING_VOUCHER_DOCUMENT_TYPE,
        );
      expect(registered).toHaveLength(1);
      expect(registered[0]).toMatchObject({ module: 'accounting' });

      const organizations = app.get(OrganizationsService);
      const series = app.get(NumberingSeriesService);
      organizationId = (
        await organizations.createOrganization({
          code: `LDGR-${suffix}`,
          name: 'Ledger live org',
        })
      ).id;

      const db = await client();
      // Fixture rows are inserted through the raw client on purpose: the
      // master-data services are covered by their own suites, and this suite
      // must not depend on their request-scoped authorization.
      const areaCode = `GA-${suffix}`;
      financialAreaId = generateId();
      await db.$queryRaw`INSERT INTO accounting.financial_areas (
        id, organization_id, code, title, is_active, is_default, created_at, updated_at
      ) VALUES (${financialAreaId}, ${organizationId}, ${areaCode}, ${'General area'}, true, false, now(), now())`;

      fiscalYearId = generateId();
      await db.$queryRaw`INSERT INTO accounting.fiscal_years (
        id, organization_id, financial_area_id, code, title, start_date, end_date,
        status, is_active, created_at, updated_at
      ) VALUES (${fiscalYearId}, ${organizationId}, ${financialAreaId}, ${'Y1405'}, ${'Year 1405'},
        DATE '2026-01-01', DATE '2026-12-31', 'open', true, now(), now())`;

      accountingPeriodId = generateId();
      await db.$queryRaw`INSERT INTO accounting.accounting_periods (
        id, organization_id, financial_area_id, fiscal_year_id, sequence, title,
        start_date, end_date, status, created_at, updated_at
      ) VALUES (${accountingPeriodId}, ${organizationId}, ${financialAreaId}, ${fiscalYearId},
        1, ${'Whole year'}, DATE '2026-01-01', DATE '2026-12-31', 'open', now(), now())`;

      // Same fixture status as the voucher live suite (`coding_structure_versions`
      // status is not an input of any document guard, so the suites share it).
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
        ) VALUES (${id}, ${organizationId}, ${code}, ${title}, 'debit', true, true, 1,
          ${codingStructureVersionId}, ${accountingConfigurationId}, now(), now())`;
      }

      // The operational scope dimension lives on the voucher header (AC-D-17):
      // the fixture branch lets the materialization test prove the snapshot.
      branchId = generateId();
      await db.$queryRaw`INSERT INTO organization.branches (
        id, organization_id, code, name, is_active, created_at, updated_at
      ) VALUES (${branchId}, ${organizationId}, ${'HQ'}, ${'Headquarters'}, true, now(), now())`;

      await series.createNumberingSeries({
        organizationId,
        documentType: 'accounting_voucher',
        scopeKey: financialAreaId.toLowerCase(),
        name: 'Live ledger vouchers',
        width: 4,
      });
    }, 120_000);

    afterAll(async () => {
      if (app !== undefined) {
        try {
          const db = await client();
          // Ledger entries FIRST: they RESTRICT their voucher, their lines and
          // their accounts, so nothing they reference can be removed first.
          await db.ledgerEntry.deleteMany({ where: { organizationId } });
          // Task 12: balance projections RESTRICT their period/year/area/account
          // (same lifecycle as ledger entries, sibling of the period), so they
          // must be removed before their parents.
          await db.accountBalanceProjection.deleteMany({
            where: { organizationId },
          });
          await db.accountingPostingOperation.deleteMany({
            where: { organizationId },
          });
          await db.accountingDocumentLine.deleteMany({
            where: { organizationId },
          });
          await db.accountingDocument.deleteMany({
            where: { organizationId },
          });
          await db.accountingPeriod.deleteMany({ where: { organizationId } });
          await db.fiscalYear.deleteMany({ where: { organizationId } });
          await db.account.deleteMany({ where: { organizationId } });
          await db.branch.deleteMany({ where: { organizationId } });
          await db.$queryRaw`DELETE FROM accounting.accounting_configuration_levels WHERE organization_id = ${organizationId}`;
          await db.$queryRaw`DELETE FROM accounting.accounting_configurations WHERE organization_id = ${organizationId}`;
          await db.codingStructureLevel.deleteMany({
            where: { organizationId },
          });
          await db.codingStructureVersion.deleteMany({
            where: { organizationId },
          });
          await db.financialArea.deleteMany({ where: { organizationId } });
          await db.numberingAllocation.deleteMany({
            where: { organizationId },
          });
          await db.numberingSeries.deleteMany({ where: { organizationId } });
          await db.organization.deleteMany({ where: { id: organizationId } });
        } finally {
          await app.close();
        }
      }
    }, 120_000);

    it('materializes one exact entry per line — the full sourcing snapshot', async () => {
      const sourceEntityId = generateId();
      const created = await documents.createChecked(
        draftInput({
          description: 'Ledger source (system)',
          origin: 'system',
          branchId,
          source: {
            module: 'inventory',
            entityType: 'stock_move',
            entityId: sourceEntityId,
            operation: 'issue',
          },
          correlationId: `corr-${suffix}`,
          // `0.1 + 0.2 = 0.3` is exactly representable here or the test
          // fails: the one sum binary floats cannot hold.
          lines: [
            line(debitAccountId, '0.1', '0', 1, 'First leg'),
            line(debitAccountId, '0.2', '0', 2, null),
            line(creditAccountId, '0', '0.30', 3, 'Second leg'),
          ],
        }),
      );
      const serial = await issueVoucher(created.id);

      // Finalization is the act that posts: no entries exist before it.
      expect(
        await ledger.findByVoucher(organizationId, created.id),
      ).toHaveLength(0);

      const finalizedAt = new Date();
      const finalized = await documents.finalizeChecked({
        id: created.id,
        organizationId,
        ledger: finalizeLedgerRow(`ledger-final-${created.id}`, created.id),
        finalizedAt,
        finalizedBy: 'live-finalizer',
      });
      expect(finalized.phase).toBe('final');

      // The mapped read: one entry per stored line, in legal-book order,
      // amounts canonicalized from the stored numerics.
      const entries = await ledger.findByVoucher(organizationId, created.id);
      expect(entries).toHaveLength(3);
      expect(entries.map((entry) => entry.lineNo)).toEqual([1, 2, 3]);
      expect(entries.map((entry) => entry.voucherLineId)).toEqual(
        created.lines.map((entry) => entry.id),
      );
      expect(entries.map((entry) => entry.debitAmount)).toEqual([
        '0.1',
        '0.2',
        '0',
      ]);
      expect(entries.map((entry) => entry.creditAmount)).toEqual([
        '0',
        '0',
        '0.3',
      ]);
      expect(entries.map((entry) => entry.description)).toEqual([
        'First leg',
        null,
        'Second leg',
      ]);
      for (const entry of entries) {
        expect(entry).toMatchObject({
          organizationId,
          financialAreaId,
          fiscalYearId,
          accountingPeriodId,
          voucherId: created.id,
          voucherNumber: serial,
          branchId,
          origin: 'system',
          source: {
            module: 'inventory',
            entityType: 'stock_move',
            entityId: sourceEntityId,
            operation: 'issue',
          },
          correlationId: `corr-${suffix}`,
          finalizedBy: 'live-finalizer',
          dimensionAssignments: [],
        });
        expect(entry.documentDate.toISOString().slice(0, 10)).toBe(
          '2026-04-05',
        );
        expect(entry.postingTimestamp.getTime()).toBe(finalizedAt.getTime());
      }
      // The entry identity is its own ULID — never a line id, never the
      // operation-ledger id (Task 10.6 correction, §22).
      const ids = entries.map((entry) => entry.id);
      expect(new Set(ids).size).toBe(3);
      for (const id of ids) {
        expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      }
      expect(created.lines.map((entry) => entry.id)).not.toEqual(
        expect.arrayContaining(ids),
      );

      // The stored read: `numeric(18,2)` keeps its scale on the wire, so the
      // database holds exactly what the voucher carried — no binary-float
      // drift at any layer. The amounts are cast to `text` because the
      // driver adapter deserializes a selected `numeric` instead of handing
      // back the wire literal (the value arrives scale-stripped, `0.10` →
      // `0.1`), which would make this assertion test the adapter rather than
      // the column. PostgreSQL renders `numeric(18,2)` → `text` with the
      // scale intact, so `'0.10'` here is what the row physically stores.
      const db = await client();
      const stored = (await db.$queryRaw`SELECT
          line_no AS "lineNo",
          debit_amount::text AS "debitAmount",
          credit_amount::text AS "creditAmount",
          voucher_number AS "voucherNumber",
          origin AS "origin",
          source_module AS "sourceModule",
          branch_id AS "branchId"
        FROM accounting.ledger_entries
        WHERE organization_id = ${organizationId} AND voucher_id = ${created.id}
        ORDER BY line_no ASC`) as Array<Record<string, unknown>>;
      expect(stored.map((row) => row['debitAmount'])).toEqual([
        '0.10',
        '0.20',
        '0.00',
      ]);
      expect(stored.map((row) => row['creditAmount'])).toEqual([
        '0.00',
        '0.00',
        '0.30',
      ]);
      expect(stored.map((row) => row['voucherNumber'])).toEqual([
        serial,
        serial,
        serial,
      ]);
      expect(stored.map((row) => row['origin'])).toEqual([
        'system',
        'system',
        'system',
      ]);
      expect(stored.map((row) => row['sourceModule'])).toEqual([
        'inventory',
        'inventory',
        'inventory',
      ]);
      expect(stored.map((row) => row['branchId'])).toEqual([
        branchId,
        branchId,
        branchId,
      ]);

      // Organization isolation: the entries answer only inside their scope.
      expect(await ledger.findByVoucher(generateId(), created.id)).toHaveLength(
        0,
      );
    }, 60_000);

    it('rolls the whole finalization back when the idempotency ledger rejects the key', async () => {
      // The operation row is inserted LAST in the finalization transaction, so
      // a duplicate `(organization, operation_key)` fails AFTER the state
      // update and the N entry inserts — the one place where a partial write
      // would otherwise remain. The transaction must leave nothing behind: a
      // `final` row without its entries, or entries without their evidence,
      // must be unobservable.
      const db = await client();
      const operationKey = `ledger-atomic-${suffix}`;
      const winnerId = generateId();
      await db.$queryRaw`INSERT INTO accounting.accounting_posting_operations (
        id, organization_id, operation_key, operation, request_hash, result,
        created_at, updated_at
      ) VALUES (${generateId()}, ${organizationId}, ${operationKey},
        'document_finalize', ${TEST_REQUEST_HASH},
        ${JSON.stringify({ documentId: winnerId })}::jsonb, now(), now())`;

      const created = await documents.createChecked(
        draftInput({ description: 'Atomic loser' }),
      );
      await issueVoucher(created.id);

      await expect(
        documents.finalizeChecked({
          id: created.id,
          organizationId,
          ledger: finalizeLedgerRow(operationKey, created.id),
          finalizedAt: new Date(),
          finalizedBy: null,
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      // Nothing of the attempt survived: the voucher is still temporary, no
      // entries exist for it, and the winner's key row stands alone.
      expect((await documents.findById(created.id))?.phase).toBe('temporary');
      expect(
        await db.ledgerEntry.count({ where: { voucherId: created.id } }),
      ).toBe(0);
      expect(
        await db.accountingPostingOperation.count({
          where: { organizationId, operationKey },
        }),
      ).toBe(1);
    }, 60_000);

    it('refuses a second entry for one voucher line (the 1:1 backstop)', async () => {
      // A hand-written entry colliding with a finalization aborts that
      // finalization LOUDLY: `uq_ledger_entries_voucher_line_id` is the
      // structural half of first-persister-wins (the state machine is the
      // other half). `skipDuplicates` would hide exactly this collision,
      // which is why the materialization forbids it.
      const db = await client();
      const created = await documents.createChecked(
        draftInput({ description: 'Backstop collision' }),
      );
      const serial = await issueVoucher(created.id);
      const [first] = created.lines;
      if (first === undefined) throw new Error('Fixture must carry lines.');

      const handId = generateId();
      await db.$queryRaw`INSERT INTO accounting.ledger_entries (
        id, organization_id, financial_area_id, fiscal_year_id,
        accounting_period_id, voucher_id, voucher_number, voucher_line_id,
        line_no, account_id, debit_amount, credit_amount, document_date,
        posting_timestamp, origin, created_at, updated_at
      ) VALUES (${handId}, ${organizationId}, ${financialAreaId}, ${fiscalYearId},
        ${accountingPeriodId}, ${created.id}, ${serial}, ${first.id},
        1, ${first.accountId}, ${first.debitAmount}, ${first.creditAmount},
        DATE '2026-04-05', now(), 'manual', now(), now())`;

      await expect(
        documents.finalizeChecked({
          id: created.id,
          organizationId,
          ledger: finalizeLedgerRow(
            `ledger-backstop-${created.id}`,
            created.id,
          ),
          finalizedAt: new Date(),
          finalizedBy: null,
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      // The voucher is still temporary and only the hand-written row exists —
      // no partial entry set was left behind.
      expect((await documents.findById(created.id))?.phase).toBe('temporary');
      expect(
        await db.ledgerEntry.count({ where: { voucherId: created.id } }),
      ).toBe(1);
      await db.$queryRaw`DELETE FROM accounting.ledger_entries WHERE id = ${handId}`;
      expect(
        await db.ledgerEntry.count({ where: { voucherId: created.id } }),
      ).toBe(0);
    }, 60_000);

    it('restricts deleting a posted voucher, line or account, and rejects dangling references', async () => {
      const db = await client();
      const created = await documents.createChecked(
        draftInput({ description: 'FK behaviour' }),
      );
      await issueVoucher(created.id);
      await documents.finalizeChecked({
        id: created.id,
        organizationId,
        ledger: finalizeLedgerRow(`ledger-fk-${created.id}`, created.id),
        finalizedAt: new Date(),
        finalizedBy: null,
      });
      const [first] = created.lines;
      if (first === undefined) throw new Error('Fixture must carry lines.');

      // RESTRICT: a posted voucher, its lines and its accounts can never
      // disappear (§8.6, §15.2 — the ledger is the evidence that pins them).
      await expect(
        db.$queryRaw`DELETE FROM accounting.accounting_documents WHERE id = ${created.id}`,
      ).rejects.toBeTruthy();
      await expect(
        db.$queryRaw`DELETE FROM accounting.accounting_document_lines WHERE document_id = ${created.id}`,
      ).rejects.toBeTruthy();
      await expect(
        db.$queryRaw`DELETE FROM accounting.accounts WHERE id = ${debitAccountId}`,
      ).rejects.toBeTruthy();
      expect(
        await db.accountingDocument.count({ where: { id: created.id } }),
      ).toBe(1);
      expect(await db.account.count({ where: { id: debitAccountId } })).toBe(1);

      // Dangling references are rejected: every entry names a real voucher,
      // line, account and scope row. Fresh ULIDs for the entry and the
      // line reference isolate the FOREIGN KEY (not the 1:1 backstop) as the
      // violated constraint.
      const dangling = {
        id: generateId(),
        voucherLineId: generateId(),
        lineNo: 99,
        debitAmount: '1',
        creditAmount: '0',
      };
      await expect(
        db.$queryRaw`INSERT INTO accounting.ledger_entries (
          id, organization_id, financial_area_id, fiscal_year_id,
          accounting_period_id, voucher_id, voucher_number, voucher_line_id,
          line_no, account_id, debit_amount, credit_amount, document_date,
          posting_timestamp, origin, created_at, updated_at
        ) VALUES (${dangling.id}, ${organizationId}, ${financialAreaId}, ${fiscalYearId},
          ${accountingPeriodId}, ${created.id}, '0000', ${dangling.voucherLineId},
          ${dangling.lineNo}, ${generateId()}, ${dangling.debitAmount}, ${dangling.creditAmount},
          DATE '2026-04-05', now(), 'manual', now(), now())`,
      ).rejects.toBeTruthy();
      await expect(
        db.$queryRaw`INSERT INTO accounting.ledger_entries (
          id, organization_id, financial_area_id, fiscal_year_id,
          accounting_period_id, voucher_id, voucher_number, voucher_line_id,
          line_no, account_id, debit_amount, credit_amount, document_date,
          posting_timestamp, origin, created_at, updated_at
        ) VALUES (${generateId()}, ${organizationId}, ${financialAreaId}, ${fiscalYearId},
          ${accountingPeriodId}, ${generateId()}, '0000', ${generateId()},
          ${dangling.lineNo}, ${debitAccountId}, ${dangling.debitAmount}, ${dangling.creditAmount},
          DATE '2026-04-05', now(), 'manual', now(), now())`,
      ).rejects.toBeTruthy();
      // Nothing dangling survived: the voucher still owns exactly its own set.
      expect(
        await db.ledgerEntry.count({ where: { voucherId: created.id } }),
      ).toBe(2);
    }, 60_000);

    it('creates the ledger uniqueness scope and read indexes under their contract names', async () => {
      // The migration is hand-written SQL (Prisma cannot express the
      // \"why\"), so the suite pins the index names the guards and the reads
      // depend on: the 1:1 UNIQUE backstop plus the three org-scoped reads
      // (by voucher, by account, by period).
      const db = await client();
      const indexes = (await db.$queryRaw`SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'accounting' AND tablename = 'ledger_entries'`) as Array<{
        indexname: string;
        indexdef: string;
      }>;
      const names = indexes.map((index) => index.indexname);
      expect(names).toContain('uq_ledger_entries_voucher_line_id');
      expect(names).toContain('idx_ledger_entries_org_voucher');
      expect(names).toContain('idx_ledger_entries_org_account');
      expect(names).toContain('idx_ledger_entries_org_period');
      const unique = indexes.find(
        (index) => index.indexname === 'uq_ledger_entries_voucher_line_id',
      );
      expect(unique?.indexdef).toContain('UNIQUE');
    }, 60_000);

    it('finalizes once under concurrent attempts: one state change, one entry set, one key row', async () => {
      const created = await documents.createChecked(
        draftInput({ description: 'Race to post' }),
      );
      await issueVoucher(created.id);

      const attempt = (): Promise<unknown> =>
        documents.finalizeChecked({
          id: created.id,
          organizationId,
          ledger: finalizeLedgerRow(`ledger-race-${created.id}`, created.id),
          finalizedAt: new Date(),
          finalizedBy: null,
        });
      const results = await Promise.allSettled([attempt(), attempt()]);
      // One winner; the loser either hits the raced key (mapped by the
      // service to a replay) or the phase guard — never a second transition
      // and never a second entry set.
      expect(results.some((result) => result.status === 'fulfilled')).toBe(
        true,
      );

      const db = await client();
      expect(
        await db.accountingPostingOperation.count({
          where: {
            organizationId,
            operationKey: `ledger-race-${created.id}`,
          },
        }),
      ).toBe(1);
      expect((await documents.findById(created.id))?.phase).toBe('final');
      expect(
        await db.ledgerEntry.count({ where: { voucherId: created.id } }),
      ).toBe(2);
    }, 60_000);
  },
);
