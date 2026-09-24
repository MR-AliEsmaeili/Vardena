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
import { PostingService } from '../src/modules/accounting/application/posting.service.js';
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
 * - the Task 13 operational freeze, POSITIVELY: a committed finalization marks
 *   the configuration its lines pinned and a rolled-back one does not — read
 *   back from `accounting_configurations` itself, the one place a fake cannot
 *   answer for;
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
    let posting: PostingService;

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

    /**
     * Seeds a configuration for the two Task 13 marker tests. The rows go in
     * raw exactly as the fixture above seeds its own, so the tests depend on the
     * tables and on the production finalization path — and on nothing else.
     *
     * `SUPERSEDED` is deliberate twice over: the organization already owns its
     * one ACTIVE configuration (`uq_accounting_configurations_org_active`), and
     * a superseded version is the case Task 13 had to get right — the marker
     * follows the version the books were written under, never "whatever is
     * ACTIVE" (decision note §5, OQ-64).
     */
    const seedMarkerConfiguration = async (code: string): Promise<string> => {
      const db = await client();
      const id = generateId();
      await db.$queryRaw`INSERT INTO accounting.accounting_configurations (
        id, organization_id, code, name, version_number, status, created_at, updated_at
      ) VALUES (${id}, ${organizationId}, ${code}, ${'Marker probe'}, 1, 'SUPERSEDED', now(), now())`;
      await db.$queryRaw`INSERT INTO accounting.accounting_configuration_levels (
        id, organization_id, accounting_configuration_id, level_index, title, digit_length, default_is_postable, created_at, updated_at
      ) VALUES (${generateId()}, ${organizationId}, ${id}, 1, ${'Level 1'}, 2, true, now(), now())`;
      return id;
    };

    /** A postable account pinned to `configurationId` — the pin the marker reads. */
    const seedMarkerAccount = async (
      code: string,
      configurationId: string,
    ): Promise<string> => {
      const db = await client();
      const id = generateId();
      await db.$queryRaw`INSERT INTO accounting.accounts (
        id, organization_id, code, title, account_nature, is_postable, is_active,
        level, coding_structure_version_id, accounting_configuration_id, created_at, updated_at
      ) VALUES (${id}, ${organizationId}, ${code}, ${'Marker probe account'}, 'debit',
        true, true, 1, ${codingStructureVersionId}, ${configurationId}, now(), now())`;
      return id;
    };

    /**
     * The marker as PostgreSQL stores it. Read with raw SQL on purpose: the
     * configuration DTO is derived state the module already tests elsewhere, and
     * the property under test is the COLUMN — so the test asks the database.
     */
    const markerRow = async (
      configurationId: string,
    ): Promise<{
      operationallyUsedAt: Date | null;
      updatedAt: Date;
      updatedBy: string | null;
    }> => {
      const db = await client();
      const rows =
        (await db.$queryRaw`SELECT "operationally_used_at" AS "operationallyUsedAt",
                          "updated_at" AS "updatedAt",
                          "updated_by" AS "updatedBy"
                     FROM accounting.accounting_configurations
                    WHERE id = ${configurationId}`) as Array<{
          operationallyUsedAt: Date | null;
          updatedAt: Date;
          updatedBy: string | null;
        }>;
      const [row] = rows;
      if (row === undefined) {
        throw new Error(
          `The marker probe needs exactly one configuration row, got ${rows.length}.`,
        );
      }
      return row;
    };

    /** The stored document row, read from PostgreSQL rather than from a DTO. */
    const documentRow = async (
      documentId: string,
    ): Promise<{ state: string; finalizedAt: Date | null }> => {
      const db = await client();
      const rows =
        (await db.$queryRaw`SELECT "state" AS state, "finalized_at" AS "finalizedAt"
                         FROM accounting.accounting_documents
                        WHERE id = ${documentId}`) as Array<{
          state: string;
          finalizedAt: Date | null;
        }>;
      const [row] = rows;
      if (row === undefined) {
        throw new Error(`The voucher row ${documentId} must exist.`);
      }
      return row;
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
      posting = app.get(PostingService);

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
          // Task 12: balance projections RESTRICT their period/year/area/account
          // (migration comment §FKs are RESTRICT), so they must be removed
          // before their parents — same lifecycle as ledger entries, but the
          // projection is a sibling, not a child, of the period.
          await db.accountBalanceProjection.deleteMany({
            where: { organizationId },
          });
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

    it('Task 13 D4: finalizing a real voucher marks the configuration its lines pinned', async () => {
      const db = await client();
      const usedConfigurationId = await seedMarkerConfiguration('MRK-USED');
      const untouchedConfigurationId =
        await seedMarkerConfiguration('MRK-UNTOUCHED');
      const usedDebitAccountId = await seedMarkerAccount(
        '9001',
        usedConfigurationId,
      );
      const usedCreditAccountId = await seedMarkerAccount(
        '9002',
        usedConfigurationId,
      );
      const untouchedAccountId = await seedMarkerAccount(
        '9003',
        untouchedConfigurationId,
      );

      // Neither configuration has been used operationally.
      expect(
        (await markerRow(usedConfigurationId)).operationallyUsedAt,
      ).toBeNull();
      expect(
        (await markerRow(untouchedConfigurationId)).operationallyUsedAt,
      ).toBeNull();

      const created = await documents.createChecked(
        draftInput({
          description: 'Marks the configuration it used',
          lines: [
            line(usedDebitAccountId, '75.25', '0', 1),
            line(usedCreditAccountId, '0', '75.25', 2),
          ],
        }),
      );
      const serial = (
        await numbering.allocateNumber({
          organizationId,
          documentType: 'accounting_voucher',
          scopeKey: financialAreaId.toLowerCase(),
          allocationKey: `live-marker-${created.id}`,
          referenceModule: 'accounting',
          referenceDocumentType: 'accounting_voucher',
          referenceDocumentId: created.id,
        })
      ).number;
      await documents.issueChecked({
        id: created.id,
        organizationId,
        documentNumber: serial,
        updatedAt: new Date(),
        updatedBy: null,
      });

      // THE PRODUCTION ENTRY POINT, unshortened: `finalizeDocument` is
      // `PostingService.postVoucher`, and `postVoucher` is what
      // `POST /accounting-documents/:id/finalize` reaches (ADR-0023 §2). No
      // marker method is invoked by hand and no transaction is opened by the
      // test, so this fails the moment the wiring is removed — which is exactly
      // the assertion the fixture-level suites could not make.
      const outcome = await posting.postVoucher({
        organizationId,
        voucherId: created.id,
        operationKey: `live-marker-${created.id}`,
      });
      expect(outcome.kind).toBe('posted');
      expect(outcome.document.phase).toBe('final');
      expect(outcome.result.ledgerEntries).toHaveLength(2);

      // The posting is real rows, not an echo of them in an aggregate.
      expect(
        await db.ledgerEntry.count({ where: { voucherId: created.id } }),
      ).toBe(2);
      const postedRow = await documentRow(created.id);
      expect(postedRow.state).toBe('final');

      const marked = await markerRow(usedConfigurationId);
      // (a) the column is NOT NULL, (b) it holds a real timestamp — a text or
      // epoch drift would not survive the instance check — and (c) it is the
      // FINALIZATION INSTANT: the same `input.finalizedAt` the document row
      // carries and that the marker statement wrote into `updated_at`. A second,
      // detached write could not reproduce that triple.
      const usedAt = marked.operationallyUsedAt;
      expect(usedAt instanceof Date && !Number.isNaN(usedAt.getTime())).toBe(
        true,
      );
      // `expect.any` would accept any Date; this pins the SAME instant the
      // document row carries, which is what "written by this finalization" means.
      const finalizedAt = postedRow.finalizedAt;
      expect(finalizedAt).toBeInstanceOf(Date);
      expect(usedAt?.getTime()).toBe(finalizedAt?.getTime());
      expect(marked.updatedAt.getTime()).toBe(finalizedAt?.getTime());
      // No HTTP principal exists in this suite, so the actor the marker records
      // is the finalization's own: NULL, never a fabricated one.
      expect(marked.updatedBy).toBeNull();

      // And ONLY the configuration the voucher used. `untouchedAccountId` is a
      // postable, active account under a different configuration, in the same
      // organization, that this voucher never referenced — marking "the ACTIVE
      // configuration", or marking everything, leaves a NULL here. That is the
      // one live discrimination between the touched pin and its neighbours.
      expect(
        (await markerRow(untouchedConfigurationId)).operationallyUsedAt,
      ).toBeNull();
      expect(
        await db.account.count({ where: { id: untouchedAccountId } }),
      ).toBe(1);
    }, 60_000);

    it('lets exactly one concurrent reverse of the same original commit (Task 15)', async () => {
      const created = await documents.createChecked(
        draftInput({ description: 'Live reverse race' }),
      );
      const serial = (
        await numbering.allocateNumber({
          organizationId,
          documentType: 'accounting_voucher',
          scopeKey: financialAreaId.toLowerCase(),
          allocationKey: `live-rev-src-${created.id}`,
          referenceModule: 'accounting',
          referenceDocumentType: 'accounting_voucher',
          referenceDocumentId: created.id,
        })
      ).number;
      await documents.issueChecked({
        id: created.id,
        organizationId,
        documentNumber: serial,
        updatedAt: new Date(),
        updatedBy: null,
      });
      await documents.finalizeChecked({
        id: created.id,
        organizationId,
        ledger: {
          id: generateId(),
          organizationId,
          operationKey: `live-rev-final-${created.id}`,
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

      const attempt = async (label: 'a' | 'b'): Promise<string> => {
        const reversalId = generateId();
        const documentNumber = (
          await numbering.allocateNumber({
            organizationId,
            documentType: 'accounting_voucher',
            scopeKey: financialAreaId.toLowerCase(),
            allocationKey: `live-rev-${label}-${created.id}`,
            referenceModule: 'accounting',
            referenceDocumentType: 'accounting_voucher',
            referenceDocumentId: reversalId,
          })
        ).number;
        await documents.reverseChecked({
          originalDocumentId: created.id,
          organizationId,
          reversalId,
          documentNumber,
          documentDate: new Date(Date.UTC(2026, 3, 5)),
          description: `Reversal ${label}`,
          reason: `race-${label}`,
          ledger: {
            id: generateId(),
            organizationId,
            operationKey: `live-rev-op-${label}-${created.id}`,
            operation: 'document_reverse',
            requestHash: TEST_REQUEST_HASH,
            result: { documentId: reversalId },
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: null,
          },
          finalizedAt: new Date(),
          finalizedBy: null,
          correlationId: null,
          createdBy: null,
        });
        return reversalId;
      };

      const results = await Promise.allSettled([attempt('a'), attempt('b')]);
      const winners = results.filter((result) => result.status === 'fulfilled');
      const losers = results.filter((result) => result.status === 'rejected');
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      const loser = losers[0];
      expect(loser?.status).toBe('rejected');
      if (loser?.status === 'rejected') {
        const error = loser.reason as { code?: string; name?: string };
        expect(
          error.code === 'P2002' ||
            String(error.name ?? error).includes('AlreadyReversed'),
        ).toBe(true);
      }

      const db = await client();
      const reversals = await db.accountingDocument.findMany({
        where: { reversesDocumentId: created.id },
      });
      expect(reversals).toHaveLength(1);
      const winnerId = reversals[0]?.['id'] as string;
      expect(
        await db.ledgerEntry.count({ where: { voucherId: winnerId } }),
      ).toBe(2);
      const original = await documents.findById(created.id);
      expect(original?.reversedByDocumentId).toBe(winnerId);
      expect(original?.phase).toBe('final');
      const orphanIds = [results[0], results[1]]
        .filter(
          (result): result is PromiseFulfilledResult<string> =>
            result.status === 'fulfilled',
        )
        .map((result) => result.value)
        .filter((id) => id !== winnerId);
      expect(orphanIds).toHaveLength(0);
      expect(
        await db.accountingDocument.count({
          where: { reversesDocumentId: created.id },
        }),
      ).toBe(1);
    }, 60_000);

    it('Task 13 D4: a finalization that rolls back leaves the configuration unused', async () => {
      const db = await client();
      const configurationId = await seedMarkerConfiguration('MRK-ROLLBACK');
      const rollbackDebitAccountId = await seedMarkerAccount(
        '9011',
        configurationId,
      );
      const rollbackCreditAccountId = await seedMarkerAccount(
        '9012',
        configurationId,
      );

      const created = await documents.createChecked(
        draftInput({
          description: 'Rolled back after the marker',
          lines: [
            line(rollbackDebitAccountId, '40.00', '0', 1),
            line(rollbackCreditAccountId, '0', '40.00', 2),
          ],
        }),
      );
      const serial = (
        await numbering.allocateNumber({
          organizationId,
          documentType: 'accounting_voucher',
          scopeKey: financialAreaId.toLowerCase(),
          allocationKey: `live-marker-rollback-${created.id}`,
          referenceModule: 'accounting',
          referenceDocumentType: 'accounting_voucher',
          referenceDocumentId: created.id,
        })
      ).number;
      await documents.issueChecked({
        id: created.id,
        organizationId,
        documentNumber: serial,
        updatedAt: new Date(),
        updatedBy: null,
      });
      const operationKey = `live-marker-rollback-${created.id}`;
      const before = await markerRow(configurationId);
      expect(before.operationallyUsedAt).toBeNull();

      // A deterministic failure inside the finalization transaction, positioned
      // AFTER the marker statement: a hand-written entry for line 1 makes
      // `uq_ledger_entries_voucher_line_id` refuse the materialization. The
      // abort is a real `23505` from the database — the convention
      // `ledger-entries-live.e2e-spec.ts` already uses — not a stub, a timeout
      // or a killed process.
      const [firstLine] = created.lines;
      if (firstLine === undefined) {
        throw new Error('The fixture voucher must carry lines.');
      }
      const handWrittenId = generateId();
      await db.$queryRaw`INSERT INTO accounting.ledger_entries (
        id, organization_id, financial_area_id, fiscal_year_id,
        accounting_period_id, voucher_id, voucher_number, voucher_line_id,
        line_no, account_id, debit_amount, credit_amount, document_date,
        posting_timestamp, origin, created_at, updated_at
      ) VALUES (${handWrittenId}, ${organizationId}, ${financialAreaId}, ${fiscalYearId},
        ${accountingPeriodId}, ${created.id}, ${serial}, ${firstLine.id},
        1, ${firstLine.accountId}, ${firstLine.debitAmount}, ${firstLine.creditAmount},
        DATE '2026-04-05', now(), 'manual', now(), now())`;

      await expect(
        posting.postVoucher({
          organizationId,
          voucherId: created.id,
          operationKey,
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      // Nothing about the attempt survived: no state change, no finalization
      // instant, no entry set, no idempotency evidence.
      expect((await documents.findById(created.id))?.phase).toBe('temporary');
      expect(await documentRow(created.id)).toEqual({
        state: 'temporary',
        finalizedAt: null,
      });
      expect(
        await db.ledgerEntry.count({ where: { voucherId: created.id } }),
      ).toBe(1);
      expect(
        await db.accountingPostingOperation.count({
          where: { organizationId, operationKey },
        }),
      ).toBe(0);

      // The marker is gone with them — and not merely still NULL: `updated_at`
      // still holds the seed's own value, so the guarded statement matched zero
      // rows and the row was never touched. A marker written outside the
      // transaction would leave exactly the opposite evidence here.
      const after = await markerRow(configurationId);
      expect(after.operationallyUsedAt).toBeNull();
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      expect(after.updatedBy).toBeNull();

      // The retry that follows the failed attempt is a fresh posting, not a
      // replay of one that never happened — and it is what finally marks.
      await db.$queryRaw`DELETE FROM accounting.ledger_entries WHERE id = ${handWrittenId}`;
      const retried = await posting.postVoucher({
        organizationId,
        voucherId: created.id,
        operationKey: `live-marker-retry-${created.id}`,
      });
      expect(retried.kind).toBe('posted');
      expect(
        (await markerRow(configurationId)).operationallyUsedAt,
      ).toBeInstanceOf(Date);
    }, 60_000);
  },
);
