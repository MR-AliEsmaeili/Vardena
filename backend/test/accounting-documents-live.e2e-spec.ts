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
import { ACCOUNTING_VOUCHER_DOCUMENT_TYPE } from '../src/modules/accounting/domain/accounting-document.js';
import {
  AccountingDocumentFinalProtectedError,
  AccountingDocumentPhaseConflictError,
} from '../src/modules/accounting/data/accounting-document-errors.js';
import { createTestApp } from './support/test-app.js';

/**
 * Live-database suite for the accounting voucher aggregate (Task 10.4).
 *
 * Skipped unless `VARDENA_TEST_DATABASE_URL` is set (CI with Postgres, or
 * local Docker); requires a generated client (`npm run prisma:generate`) and a
 * migrated database (`prisma migrate dev`). It drives the DATA layer directly
 * — the one place where the guarantees under test genuinely live:
 *
 * - `FOR UPDATE`/`FOR SHARE` locking and the `(organization, area, number)`
 *   unique index under real concurrency;
 * - transaction atomicity: a failed line write leaves no header, no lines and
 *   no ledger row behind;
 * - the foreign keys: cascade from a document to its lines, restrict from an
 *   account referenced by a line;
 * - final-state protection enforced by the guard inside the transaction;
 * - `numeric(18,2)` persistence: what is stored is read back exactly, with no
 *   binary-float drift.
 *
 * The HTTP journeys live in `accounting-documents.e2e-spec.ts`; the domain
 * rules live in the unit suites. This file is the only place the SQL is real.
 */
const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

describe.skipIf(DATABASE_URL === undefined)(
  'Accounting documents (live database)',
  () => {
    const suffix = generateId().slice(-8);

    let app: INestApplication | undefined;
    let prisma: PrismaService;
    let documents: AccountingDocumentsRepository;
    let numbering: NumberingService;

    let organizationId = '';
    let financialAreaId = '';
    let fiscalYearId = '';
    let accountingPeriodId = '';
    let codingStructureVersionId = '';
    let accountingConfigurationId = '';
    let debitAccountId = '';
    let creditAccountId = '';

    const client = async (): Promise<{
      $queryRaw: (
        query: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<unknown>;
      accountingDocument: {
        create: (args: unknown) => Promise<{ id: string }>;
        count: (args: unknown) => Promise<number>;
        deleteMany: (args: unknown) => Promise<unknown>;
        findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
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
    ): AccountingDocumentLineWrite => ({
      id: generateId(),
      lineNo,
      accountId,
      debitAmount,
      creditAmount,
      description: null,
      sourceLineReference: null,
    });

    /** A well-formed sha256-shaped hash for the fixture ledger rows. */
    const TEST_REQUEST_HASH = 'a'.repeat(64);

    /** The idempotency row the service writes LAST inside the effect's tx. */
    const ledgerRow = (
      operationKey: string,
      documentId: string,
    ): NonNullable<CreateAccountingDocumentInput['ledger']> => ({
      id: generateId(),
      organizationId,
      operationKey,
      operation: 'document_create',
      requestHash: TEST_REQUEST_HASH,
      result: { documentId },
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
    });

    const draftInput = (
      overrides: Partial<CreateAccountingDocumentInput> = {},
    ): CreateAccountingDocumentInput => ({
      id: generateId(),
      organizationId,
      financialAreaId,
      documentDate: new Date(Date.UTC(2026, 3, 5)),
      description: 'Live entry',
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

      // The voucher type is OWNED by Accounting: `AccountingDocumentTypeRegistration`
      // registers it during `app.init()` (ADR-0023 §2, contract §12.1
      // AC-D-16), and `createTestApp` awaits that init before returning. The
      // suite must therefore NOT register it again: `DocumentTypeRegistry`
      // refuses any second registrant by design, and re-registering the
      // production-owned type here is exactly what made this suite fail at
      // startup. Assert the ownership the suite depends on instead.
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
          code: `VCHR-${suffix}`,
          name: 'Voucher live org',
        })
      ).id;

      const db = await client();
      // Fixture rows are inserted through the raw client on purpose: the
      // master-data services are covered by their own suites, and this suite
      // must not depend on their request-scoped authorization.
      const area =
        (await db.$queryRaw`SELECT id FROM accounting.financial_areas LIMIT 0`) as unknown;
      expect(Array.isArray(area)).toBe(true);
      expect(area).toHaveLength(0);

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
      // `financial_area_id` is NOT NULL on `accounting_periods` (Task 10.2
      // denormalizes the scope so a period can be filtered by area without a
      // join): the fixture must write it, exactly as the period service does.
      await db.$queryRaw`INSERT INTO accounting.accounting_periods (
        id, organization_id, financial_area_id, fiscal_year_id, sequence, title,
        start_date, end_date, status, created_at, updated_at
      ) VALUES (${accountingPeriodId}, ${organizationId}, ${financialAreaId}, ${fiscalYearId},
        1, ${'Whole year'}, DATE '2026-01-01', DATE '2026-12-31', 'open', now(), now())`;

      // A chart account cannot exist without the structure version its code was
      // composed under (§9.4: `coding_structure_version_id` is NOT NULL and an
      // FK), so the fixture publishes one single-level structure first.
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

      await series.createNumberingSeries({
        organizationId,
        documentType: 'accounting_voucher',
        scopeKey: financialAreaId.toLowerCase(),
        name: 'Live vouchers',
        width: 4,
      });
    }, 120_000);

    afterAll(async () => {
      if (app !== undefined) {
        try {
          const db = await client();
          // Ledger entries FIRST (Task 10.7): they RESTRICT their voucher,
          // their lines and their accounts, so nothing they reference can be
          // removed before them.
          await db.ledgerEntry.deleteMany({ where: { organizationId } });
          await db.accountingPostingOperation.deleteMany({
            where: { organizationId },
          });
          await db.accountingDocumentLine.deleteMany({
            where: { organizationId },
          });
          await db.accountingDocument.deleteMany({ where: { organizationId } });
          await db.accountingPeriod.deleteMany({ where: { organizationId } });
          await db.fiscalYear.deleteMany({ where: { organizationId } });
          await db.account.deleteMany({ where: { organizationId } });
          await db.$queryRaw`DELETE FROM accounting.accounting_configuration_levels WHERE organization_id = ${organizationId}`;
          await db.$queryRaw`DELETE FROM accounting.accounting_configurations WHERE organization_id = ${organizationId}`;
          await db.codingStructureLevel.deleteMany({
            where: { organizationId },
          });
          await db.codingStructureVersion.deleteMany({
            where: { organizationId },
          });
          await db.financialArea.deleteMany({ where: { organizationId } });
          // The numbering series (and its allocations) that the fixture
          // created are organization-scoped with an ON DELETE RESTRICT FK
          // (`fk_numbering_series_organization`): without these two the
          // organization could never be removed and the hook would fail.
          // Allocations first — they reference the series.
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

    it('persists money exactly as numeric(18,2) — never as a float', async () => {
      const created = await documents.createChecked(
        draftInput({
          description: 'Decimal exactness',
          lines: [
            line(debitAccountId, '0.1', '0', 1),
            line(debitAccountId, '0.2', '0', 2),
            line(creditAccountId, '0', '0.30', 3),
            line(creditAccountId, '0', '900.50', 4),
            line(debitAccountId, '900.50', '0', 5),
          ],
        }),
      );
      expect(created.lines.map((entry) => entry.debitAmount)).toEqual([
        '0.1',
        '0.2',
        '0',
        '0',
        '900.5',
      ]);
      expect(created.lines.map((entry) => entry.creditAmount)).toEqual([
        '0',
        '0',
        '0.3',
        '900.5',
        '0',
      ]);
      const reread = await documents.findById(created.id);
      expect(reread?.lines).toEqual(created.lines);
    }, 60_000);

    it('rolls the whole write back when the idempotency ledger rejects the key', async () => {
      // The ledger row is inserted LAST in the document transaction, so a
      // duplicate `(organization, operation_key)` fails AFTER the header and
      // the lines have been written — the one place where a partial write would
      // otherwise remain. The transaction must leave nothing behind.
      const db = await client();
      const operationKey = `atomic-${suffix}-1`;
      const winnerId = generateId();

      const winner = await documents.createChecked(
        draftInput({
          id: winnerId,
          description: 'Ledger winner',
          ledger: ledgerRow(operationKey, winnerId),
        }),
      );
      expect(winner.id).toBe(winnerId);
      const committed = await db.accountingDocument.count({
        where: { organizationId },
      });

      const loserId = generateId();
      await expect(
        documents.createChecked(
          draftInput({
            id: loserId,
            description: 'Ledger loser',
            ledger: ledgerRow(operationKey, loserId),
          }),
        ),
      ).rejects.toMatchObject({ code: 'P2002' });

      // Nothing of the loser survived: no header, no lines, no second ledger
      // row — and the winner is untouched.
      expect(
        await db.accountingDocument.count({ where: { id: loserId } }),
      ).toBe(0);
      expect(
        await db.accountingDocumentLine.count({
          where: { documentId: loserId },
        }),
      ).toBe(0);
      expect(
        await db.accountingDocument.count({ where: { organizationId } }),
      ).toBe(committed);
      expect(
        await db.accountingPostingOperation.count({
          where: { organizationId, operationKey },
        }),
      ).toBe(1);
    }, 60_000);

    it('refuses a second document with the same number in the same area', async () => {
      const first = await documents.createChecked(
        draftInput({
          description: 'First number',
          state: 'temporary',
          documentNumber: '9001',
        }),
      );
      expect(first.documentNumber).toBe('9001');

      await expect(
        documents.createChecked(
          draftInput({
            description: 'Duplicate number',
            state: 'temporary',
            documentNumber: '9001',
          }),
        ),
      ).rejects.toMatchObject({ code: 'P2002' });
    }, 60_000);

    it('allocates distinct serials under concurrent issuance and replays a repeated key', async () => {
      const allocated = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          numbering.allocateNumber({
            organizationId,
            documentType: 'accounting_voucher',
            scopeKey: financialAreaId.toLowerCase(),
            allocationKey: `live-issue-${index}`,
            referenceModule: 'accounting',
            referenceDocumentType: 'accounting_voucher',
            referenceDocumentId: generateId(),
          }),
        ),
      );
      const numbers = allocated.map((allocation) => allocation.number);
      expect(new Set(numbers).size).toBe(12);

      // ONE reference, two concurrent calls: replay is defined on the
      // allocation key AND the reference, so a second call naming a different
      // document is a conflict (409), not a replay (the `documents-live`
      // suite asserts exactly that distinction).
      const reference = {
        referenceModule: 'accounting',
        referenceDocumentType: 'accounting_voucher',
        referenceDocumentId: generateId(),
      };
      const [a, b] = await Promise.all([
        numbering.allocateNumber({
          organizationId,
          documentType: 'accounting_voucher',
          scopeKey: financialAreaId.toLowerCase(),
          allocationKey: 'live-same-key',
          ...reference,
        }),
        numbering.allocateNumber({
          organizationId,
          documentType: 'accounting_voucher',
          scopeKey: financialAreaId.toLowerCase(),
          allocationKey: 'live-same-key',
          ...reference,
        }),
      ]);
      expect(b.number).toBe(a.number);
      expect(b.id).toBe(a.id);
    }, 60_000);

    it('locks the document row, refuses illegal transitions and keeps final immutable', async () => {
      const created = await documents.createChecked(
        draftInput({ description: 'Lifecycle on real rows' }),
      );
      expect(created.phase).toBe('draft');
      expect(created.documentNumber).toBeNull();

      const issuedNumber = (
        await numbering.allocateNumber({
          organizationId,
          documentType: 'accounting_voucher',
          scopeKey: financialAreaId.toLowerCase(),
          allocationKey: `live-lifecycle-${created.id}`,
          referenceModule: 'accounting',
          referenceDocumentType: 'accounting_voucher',
          referenceDocumentId: created.id,
        })
      ).number;
      const issued = await documents.issueChecked({
        id: created.id,
        organizationId,
        documentNumber: issuedNumber,
        updatedAt: new Date(),
        updatedBy: null,
      });
      expect(issued.phase).toBe('temporary');
      expect(issued.documentNumber).toBe(issuedNumber);

      // Issuing twice is a phase conflict, not a silent second number. The
      // guard errors are identified by CLASS: the data layer throws plain
      // errors (no `code` property — the transport code is the service's
      // mapping concern, `mapDocumentGuardError`).
      await expect(
        documents.issueChecked({
          id: created.id,
          organizationId,
          documentNumber: `${issuedNumber}-again`,
          updatedAt: new Date(),
          updatedBy: null,
        }),
      ).rejects.toBeInstanceOf(AccountingDocumentPhaseConflictError);

      const finalized = await documents.finalizeChecked({
        id: created.id,
        organizationId,
        ledger: {
          id: generateId(),
          organizationId,
          operationKey: `live-finalize-${created.id}`,
          operation: 'document_finalize',
          requestHash: TEST_REQUEST_HASH,
          result: { documentId: created.id },
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: null,
        },
        finalizedAt: new Date(),
        finalizedBy: null,
      });
      expect(finalized.phase).toBe('final');

      // Final is protected by the in-transaction guard, not by a caller's care.
      await expect(
        documents.updateChecked({
          id: created.id,
          organizationId,
          financialAreaId,
          documentDate: new Date(Date.UTC(2026, 3, 5)),
          description: 'Too late',
          branchId: null,
          lines: [
            line(debitAccountId, '10', '0', 1),
            line(creditAccountId, '0', '10', 2),
          ],
          updatedAt: new Date(),
          updatedBy: null,
        }),
      ).rejects.toBeInstanceOf(AccountingDocumentFinalProtectedError);
      await expect(
        documents.deleteChecked({ id: created.id, organizationId }),
      ).rejects.toBeInstanceOf(AccountingDocumentFinalProtectedError);

      // And the stored row is exactly what finalization left behind.
      const db = await client();
      const rows = await db.accountingDocument.findMany({
        where: { id: created.id },
      });
      expect(rows[0]?.['state']).toBe('final');
      expect(rows[0]?.['description']).toBe('Lifecycle on real rows');
      expect(
        await db.accountingPostingOperation.count({
          where: {
            organizationId,
            operationKey: `live-finalize-${created.id}`,
          },
        }),
      ).toBe(1);
      // Task 10.7: the finalization materialized exactly one entry per line.
      expect(
        await db.ledgerEntry.count({ where: { voucherId: created.id } }),
      ).toBe(2);
    }, 60_000);

    it('finalizes once under a repeated key: one state change, one ledger row', async () => {
      const created = await documents.createChecked(
        draftInput({ description: 'Race to finalize' }),
      );
      const number = (
        await numbering.allocateNumber({
          organizationId,
          documentType: 'accounting_voucher',
          scopeKey: financialAreaId.toLowerCase(),
          allocationKey: `live-race-${created.id}`,
          referenceModule: 'accounting',
          referenceDocumentType: 'accounting_voucher',
          referenceDocumentId: created.id,
        })
      ).number;
      await documents.issueChecked({
        id: created.id,
        organizationId,
        documentNumber: number,
        updatedAt: new Date(),
        updatedBy: null,
      });

      const attempt = (): Promise<unknown> =>
        documents.finalizeChecked({
          id: created.id,
          organizationId,
          ledger: {
            id: generateId(),
            organizationId,
            operationKey: `live-race-final-${created.id}`,
            operation: 'document_finalize',
            requestHash: TEST_REQUEST_HASH,
            result: { documentId: created.id },
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: null,
          },
          finalizedAt: new Date(),
          finalizedBy: null,
        });
      const results = await Promise.allSettled([attempt(), attempt()]);
      // One winner; the loser either replays the winner's row (mapped by the
      // service) or is rejected by the phase guard — never a second transition.
      expect(results.some((result) => result.status === 'fulfilled')).toBe(
        true,
      );

      const db = await client();
      expect(
        await db.accountingPostingOperation.count({
          where: {
            organizationId,
            operationKey: `live-race-final-${created.id}`,
          },
        }),
      ).toBe(1);
      const rows = await db.accountingDocument.findMany({
        where: { id: created.id },
      });
      expect(rows[0]?.['state']).toBe('final');
      // Task 10.7: the winner posted exactly one entry set — never two.
      expect(
        await db.ledgerEntry.count({ where: { voucherId: created.id } }),
      ).toBe(2);
    }, 60_000);

    it('cascades lines with the document and restricts deleting a referenced account', async () => {
      const created = await documents.createChecked(
        draftInput({ description: 'FK behaviour' }),
      );
      const db = await client();
      expect(
        await db.accountingDocumentLine.count({
          where: { documentId: created.id },
        }),
      ).toBe(2);

      await expect(
        db.$queryRaw`DELETE FROM accounting.accounts WHERE id = ${debitAccountId}`,
      ).rejects.toBeTruthy();

      const discarded = await documents.deleteChecked({
        id: created.id,
        organizationId,
      });
      expect(discarded.phase).not.toBe('final');
      expect(
        await db.accountingDocumentLine.count({
          where: { documentId: created.id },
        }),
      ).toBe(0);
      expect(
        await db.accountingDocument.count({ where: { id: created.id } }),
      ).toBe(0);

      // The account still exists: nothing about discarding a voucher may
      // remove master data (§5.6).
      expect(await db.account.count({ where: { id: debitAccountId } })).toBe(1);
    }, 60_000);
  },
);
