import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, loadAppConfig } from '../src/kernel/config/app-config.js';
import { generateId } from '../src/kernel/ids/ulid.js';
import { PrismaService } from '../src/kernel/prisma/prisma.service.js';
import { OrganizationsService } from '../src/modules/organization/application/organizations.service.js';
import { BranchesService } from '../src/modules/organization/application/branches.service.js';
import { OrganizationMembershipsService } from '../src/modules/organization/application/organization-memberships.service.js';
import { WarehousesService } from '../src/modules/inventory/application/warehouses.service.js';
import { UnitsService } from '../src/modules/inventory/application/units.service.js';
import { ItemsService } from '../src/modules/inventory/application/items.service.js';
import { UsersService } from '../src/modules/users/application/users.service.js';
import { RolesService } from '../src/modules/rbac/application/roles.service.js';
import { UserRolesService } from '../src/modules/rbac/application/user-roles.service.js';
import { NumberingSeriesService } from '../src/modules/documents/application/numbering-series.service.js';
import { ACCOUNTING_VOUCHER_DOCUMENT_TYPE } from '../src/modules/accounting/domain/accounting-document.js';
import { INVENTORY_DOCUMENT_PERMISSIONS } from '../src/modules/inventory/domain/inventory-document-permissions.js';
import {
  BALANCE_PERMISSIONS,
  MOVEMENT_PERMISSIONS,
  TRANSFER_PERMISSIONS,
} from '../src/modules/inventory/domain/inventory-core-permissions.js';
import { VALUATION_PERMISSIONS } from '../src/modules/inventory/domain/inventory-valuation-permissions.js';
import {
  INVENTORY_ISSUE_DOCUMENT_TYPE,
  INVENTORY_RECEIPT_DOCUMENT_TYPE,
  INVENTORY_TRANSFER_DOCUMENT_TYPE,
} from '../src/modules/inventory/domain/inventory-document-types.js';
import { createTestApp } from './support/test-app.js';

/**
 * C-62 — the FIRST VERTICAL SLICE of Inventory → Accounting, against REAL
 * PostgreSQL (skipped unless `VARDENA_TEST_DATABASE_URL` is set).
 *
 * The hermetic suites (`inventory-accounting-posting.spec.ts`,
 * `inventory-business-documents.service.spec.ts`) prove the RULES against a
 * faked ledger and a doubled Accounting boundary. What only a real database
 * can answer is what this file exists for, and each of these is a place a
 * unit test would happily lie:
 *
 *   1. **A real Accounting voucher is really produced.** `direct_final` must
 *      reach `final`, which is the only Accounting state that writes ledger
 *      entries — so the GL effect is asserted by COUNTING rows in
 *      `accounting.ledger_entries`, not by trusting a returned string.
 *   2. **Draft mode really stops short of the books.** The document stays
 *      `operational` with an Accounting-owned draft, and NO ledger entry
 *      exists — a draft is never Accounting Posted (C62-OD-02).
 *   3. **The durable operation really is durable and idempotent.** The
 *      operation row, its snapshot and the snapshot's movement facts are real
 *      rows, and a replay answers from them instead of writing a second
 *      voucher (C62-OD-06).
 *   4. **The unique constraints are real.** `(organization_id, document_id,
 *      action, operation_key)` and `(organization_id, operation_key)` are
 *      enforced by PostgreSQL, so a second posting under the same key with a
 *      DIFFERENT request conflicts rather than silently duplicating.
 *
 * The Accounting master data is inserted through the raw client, exactly as
 * `accounting-documents-live.e2e-spec.ts` does: those services are covered by
 * their own suites and must not be re-tested here. `accounting.
 * source_posting_mappings` is inserted the same way because its
 * administrative surface is deliberately a LATER task — the repository is
 * read-only on purpose, and a fixture may write what no user-facing API can
 * yet.
 */
const DATABASE_URL = process.env['VARDENA_TEST_DATABASE_URL'];

/**
 * Wide, fixed, open window so the document's business date always lands in it.
 *
 * Written as SQL LITERALS on purpose: Prisma parameterizes a `${...}`
 * interpolation, and `DATE $6` is a PostgreSQL syntax error. These are
 * compile-time constants of this file, never caller input.
 */

interface AccountingDocumentRow {
  id: string;
  state: string;
  document_number: string | null;
  source_module: string | null;
  source_entity_type: string | null;
  source_entity_id: string | null;
  source_operation: string | null;
  origin: string;
  description: string;
}

interface LedgerEntryRow {
  id: string;
  account_id: string;
  debit_amount: string;
  credit_amount: string;
}

describe.skipIf(DATABASE_URL === undefined)(
  'C-62 Inventory to Accounting posting (live database)',
  () => {
    let app: INestApplication | undefined;
    let prisma: PrismaService;

    let organizationId = '';
    let otherOrganizationId = '';
    let branchId = '';
    let directFinalWarehouseId = '';
    let draftWarehouseId = '';
    // A pricing run's scope is (organization, warehouse, document kinds) and it
    // resumes from the previous run's end date, so every test that needs a run
    // to price something gets a warehouse of its own. Sharing one would make
    // each run inherit the earlier tests' movements — including any document
    // they left unpriced on purpose, which fails the whole key.
    let issueWarehouseId = '';
    let unitId = '';
    let itemId = '';
    let financialAreaId = '';
    let debitAccountId = '';
    let creditAccountId = '';
    let operatorId = '';

    const suffix = generateId().slice(-8).toLowerCase();
    const operatorUsername = `c62-post-op-${suffix}`;
    const password = 'C62-post-live-password-1';

    const base = '/api/v1/inventory/business-documents';
    let operator: ReturnType<typeof request.agent>;

    async function loggedInAgent(
      username: string,
    ): Promise<ReturnType<typeof request.agent>> {
      const agent = request.agent(app!.getHttpServer());
      await agent
        .post('/api/v1/auth/login')
        .send({ username, password })
        .expect(200);
      return agent;
    }

    /**
     * Raw client: the fixture and the assertions that need real GL rows.
     *
     * Only `$queryRaw` is declared, because that is the only part of the
     * generated client a live fixture and a row count need. The runtime object
     * is the full generated client either way.
     */
    type RawClient = {
      $queryRaw: <T>(
        query: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<T>;
    };

    async function db(): Promise<RawClient> {
      return prisma.getClient<RawClient>();
    }

    async function accountingDocuments(): Promise<AccountingDocumentRow[]> {
      const client = await db();
      return client.$queryRaw<
        AccountingDocumentRow[]
      >`SELECT id, state, document_number, source_module, source_entity_type,
          source_entity_id, source_operation, origin, description
        FROM accounting.accounting_documents
        WHERE organization_id = ${organizationId}`;
    }

    async function ledgerEntriesFor(
      documentId: string,
    ): Promise<LedgerEntryRow[]> {
      const client = await db();
      return client.$queryRaw<
        LedgerEntryRow[]
      >`SELECT id, account_id, debit_amount, credit_amount
      FROM accounting.ledger_entries
      WHERE organization_id = ${organizationId}
        AND voucher_id = ${documentId}`;
    }

    async function createPricedReceipt(
      warehouseId: string,
      cost: string,
      quantity: string,
    ): Promise<Record<string, unknown>> {
      const response = await operator
        .post(base)
        .send({
          organizationId,
          kind: 'receipt',
          warehouseId,
          cost,
          lines: [{ itemId, quantity, unitId }],
        })
        .expect(201);
      return response.body as Record<string, unknown>;
    }

    async function finalize(id: string): Promise<Record<string, unknown>> {
      const response = await operator
        .post(`${base}/${id}/finalize`)
        .query({ organizationId })
        .send({})
        .expect(200);
      return response.body as Record<string, unknown>;
    }

    /**
     * Ask Accounting to post, asserting the expected status up front so the
     * caller can read the body without a second request.
     */
    async function accountingPost(
      id: string,
      body: Record<string, unknown> = {},
      expected = 200,
    ): Promise<request.Response> {
      return operator
        .post(`${base}/${id}/accounting-post`)
        .query({ organizationId })
        .send(body)
        .expect(expected);
    }

    interface SnapshotRow {
      document_type: string;
      document_number: string | null;
      valuation_state: string;
      valuation_basis: string;
      total_value: string;
    }

    interface SnapshotMovementRow {
      movement_id: string;
      quantity: string;
      base_quantity: string;
      total_value: string;
      unit_cost: string;
      valuation_status: string;
    }

    /**
     * The immutable snapshot of a document's posting, read straight from the
     * table. This is the audit evidence an accountant would query, so it is
     * asserted here rather than trusted from the API: it is also what turns a
     * column-width or truncation defect into a readable failure instead of a
     * bare 500 from PostgreSQL.
     */
    async function postingSnapshot(id: string): Promise<SnapshotRow | null> {
      const client = await db();
      const rows = await client.$queryRaw<
        SnapshotRow[]
      >`SELECT s.document_type, s.document_number, s.valuation_state,
          s.valuation_basis, s.total_value
        FROM inventory.inventory_accounting_posting_snapshots s
        JOIN inventory.inventory_accounting_posting_operations o
          ON o.id = s.operation_id
        WHERE s.organization_id = ${organizationId} AND o.document_id = ${id}`;
      return rows[0] ?? null;
    }

    async function postingSnapshotMovements(
      id: string,
    ): Promise<SnapshotMovementRow[]> {
      const client = await db();
      return client.$queryRaw<
        SnapshotMovementRow[]
      >`SELECT m.movement_id, m.quantity, m.base_quantity, m.total_value,
          m.unit_cost, m.valuation_status
        FROM inventory.inventory_accounting_posting_snapshot_movements m
        JOIN inventory.inventory_accounting_posting_snapshots s
          ON s.id = m.snapshot_id
        JOIN inventory.inventory_accounting_posting_operations o
          ON o.id = s.operation_id
        WHERE m.organization_id = ${organizationId} AND o.document_id = ${id}`;
    }

    const pricingBase = '/api/v1/inventory/pricing';

    /**
     * Assign a cost to ONE movement directly.
     *
     * This is the step that makes an ISSUE priceable at all: an issue carries
     * no entered cost of its own, so its value is derived from the pool the
     * pricing run averages, and that pool needs a costed receipt to exist.
     */
    async function assignCost(
      movementId: string,
      totalCost: string,
    ): Promise<Record<string, unknown>> {
      const response = await operator
        .post(`/api/v1/inventory/valuation/movements/${movementId}/cost`)
        .send({
          organizationId,
          operationKey: `c62-assign-${suffix}-${generateId()}`,
          totalCost,
          repricing: 'skip',
        })
        .expect(201);
      return response.body as Record<string, unknown>;
    }

    /**
     * The movement a document's first line currently owns.
     *
     * Read from the document's own lines rather than the movement list: the
     * line is the authoritative owner of its movement, and the movement list
     * has no document filter to scope it by.
     */
    async function firstLineMovementId(documentId: string): Promise<string> {
      const response = await operator
        .get(`${base}/${documentId}`)
        .query({ organizationId })
        .expect(200);
      const lines = response.body.lines as Array<Record<string, unknown>>;
      const movementId = lines[0]!['movementId'];
      expect(typeof movementId).toBe('string');
      return movementId as string;
    }

    /** Price every movement of a warehouse up to `toDate`. */
    /**
     * Run pricing over one warehouse's scope.
     *
     * The window ends at `toDate`, and a later run for the same scope resumes
     * strictly after the previous one's end date — so a run must never end in
     * the future: it would claim a window the movements it should price have
     * not reached yet, and every later run would resume past them.
     */
    async function runPricing(
      warehouseId: string,
      toDate: Date = new Date(),
    ): Promise<Record<string, unknown>> {
      const response = await operator
        .post(`${pricingBase}/runs`)
        .send({
          organizationId,
          operationKey: `c62-price-${suffix}-${generateId()}`,
          warehouseId,
          documentKinds: ['receipt', 'issue', 'transfer'],
          toDate: toDate.toISOString(),
        })
        .expect(201);
      return response.body as Record<string, unknown>;
    }

    async function postingTrail(
      id: string,
    ): Promise<Array<Record<string, unknown>>> {
      const response = await operator
        .get(`${base}/${id}/accounting-posting`)
        .query({ organizationId })
        .expect(200);
      return response.body as Array<Record<string, unknown>>;
    }

    interface PostingOperationRow {
      id: string;
      state: string;
      operation_key: string;
      request_hash: string;
      accounting_document_id: string | null;
      gl_posted: boolean;
    }

    /** The document's newest durable posting operation, read from the table. */
    async function postingOperation(
      id: string,
    ): Promise<PostingOperationRow | null> {
      const client = await db();
      const rows = await client.$queryRaw<
        PostingOperationRow[]
      >`SELECT id, state, operation_key, request_hash, accounting_document_id,
          gl_posted
        FROM inventory.inventory_accounting_posting_operations
        WHERE organization_id = ${organizationId} AND document_id = ${id}
        ORDER BY requested_at DESC, created_at DESC`;
      return rows[0] ?? null;
    }

    /**
     * Simulate "Phase 3 never ran": the operation goes back to PENDING with
     * no recorded result. A fixture write, scoped to this test's own rows —
     * the honest durable state after a crash between Phase 2 and Phase 3.
     */
    async function revertOperationToPending(id: string): Promise<void> {
      const client = await db();
      await client.$queryRaw`UPDATE inventory.inventory_accounting_posting_operations
        SET state = 'PENDING', completed_at = NULL,
            accounting_document_id = NULL, accounting_document_number = NULL,
            accounting_document_phase = NULL, accounting_operation_key = NULL,
            gl_posted = false, replayed = false, updated_at = now()
        WHERE organization_id = ${organizationId} AND document_id = ${id}`;
    }

    /**
     * Simulate "Phase 3 never ran" on the document side: undo the Accounting
     * result projection. The document's `updated_at` is deliberately NOT
     * touched — Phase 3 does not bump it (the revision the request hash
     * freezes must survive the posting itself), so this restores the exact
     * pre-post row.
     */
    async function revertDocumentProjection(id: string): Promise<void> {
      const client = await db();
      await client.$queryRaw`UPDATE inventory.inventory_business_documents
        SET status = 'operational', accounting_posting_state = 'not_posted',
            accounting_posting_operation_id = NULL, accounting_document_id = NULL,
            accounting_document_number = NULL, accounting_document_phase = NULL,
            accounting_posted_at = NULL, accounting_posted_by = NULL
        WHERE organization_id = ${organizationId} AND id = ${id}`;
    }

    /**
     * Erase an Accounting voucher with every row it produced: its ledger
     * entries, its lines, its idempotency-ledger rows, the numbering
     * allocation it consumed and the document itself. This is the exact
     * durable state of "Accounting was never called" — a real crash before
     * the boundary call leaves no allocation either, because the allocation
     * is written by the call itself. (A real pre-final deletion KEEPS the
     * ledger rows; here they go too, because the whole point is that the
     * boundary call never happened.) The aggregate balance projections are
     * derived rows no assertion reads and the teardown wipes them, so they
     * are left alone.
     */
    async function eraseAccountingVoucher(
      accountingDocumentId: string,
    ): Promise<void> {
      const client = await db();
      await client.$queryRaw`DELETE FROM accounting.ledger_entries
        WHERE organization_id = ${organizationId} AND voucher_id = ${accountingDocumentId}`;
      await client.$queryRaw`DELETE FROM accounting.accounting_document_lines
        WHERE organization_id = ${organizationId} AND document_id = ${accountingDocumentId}`;
      await client.$queryRaw`DELETE FROM accounting.accounting_posting_operations
        WHERE organization_id = ${organizationId} AND result->>'documentId' = ${accountingDocumentId}`;
      await client.$queryRaw`DELETE FROM documents.numbering_allocations
        WHERE organization_id = ${organizationId} AND reference_document_id = ${accountingDocumentId}`;
      await client.$queryRaw`DELETE FROM accounting.accounting_documents
        WHERE organization_id = ${organizationId} AND id = ${accountingDocumentId}`;
    }

    async function accountingDocumentsForSource(
      sourceDocumentId: string,
    ): Promise<AccountingDocumentRow[]> {
      const documents = await accountingDocuments();
      return documents.filter(
        (row) => row.source_entity_id === sourceDocumentId,
      );
    }

    async function readDocument(id: string): Promise<Record<string, unknown>> {
      const response = await operator
        .get(`${base}/${id}`)
        .query({ organizationId })
        .expect(200);
      return response.body as Record<string, unknown>;
    }

    beforeAll(async () => {
      const baseConfig = loadAppConfig();
      const built = await createTestApp({
        override: (builder) =>
          builder.overrideProvider(APP_CONFIG).useValue({
            ...baseConfig,
            databaseUrl: DATABASE_URL,
            // The lifecycle walks below issue many calls in quick succession,
            // beyond the general per-IP budget `rate-limit.e2e-spec.ts` covers
            // on its own. The login limit is deliberately left untouched.
            rateLimit: { ...baseConfig.rateLimit, max: 5000 },
          }),
      });
      app = built.app;
      prisma = built.module.get(PrismaService);

      const organizations = app.get(OrganizationsService);
      const branches = app.get(BranchesService);
      const memberships = app.get(OrganizationMembershipsService);
      const warehouses = app.get(WarehousesService);
      const units = app.get(UnitsService);
      const items = app.get(ItemsService);
      const users = app.get(UsersService);
      const roles = app.get(RolesService);
      const userRoles = app.get(UserRolesService);
      const numberingSeries = app.get(NumberingSeriesService);

      const organization = await organizations.createOrganization({
        code: `C62P-${suffix}`,
        name: 'C-62 posting live org',
      });
      organizationId = organization.id;

      for (const documentType of [
        INVENTORY_RECEIPT_DOCUMENT_TYPE,
        INVENTORY_ISSUE_DOCUMENT_TYPE,
        INVENTORY_TRANSFER_DOCUMENT_TYPE,
      ]) {
        await numberingSeries.createNumberingSeries({
          organizationId,
          documentType,
          name: `${documentType} c62 ${suffix}`,
          width: 4,
        });
      }

      // A REAL second organization, so the isolation probe below is a genuine
      // foreign scope rather than a non-existent id.
      const otherOrganization = await organizations.createOrganization({
        code: `C62Q-${suffix}`,
        name: 'C-62 posting foreign org',
      });
      otherOrganizationId = otherOrganization.id;

      const branch = await branches.createBranch({
        organizationId,
        code: 'BR-C62',
        name: 'C-62 branch',
      });
      branchId = branch.id;

      // The two warehouses are the SAME warehouse policy except for the C-62
      // posting mode (PDR-10 C62-OD-02), so the only difference between the
      // two slices below is the mode itself.
      const directFinal = await warehouses.createWarehouse({
        organizationId,
        branchId,
        code: 'WH-DF',
        name: 'Direct final warehouse',
        accountingPostingMode: 'direct_final',
      });
      const draft = await warehouses.createWarehouse({
        organizationId,
        branchId,
        code: 'WH-DR',
        name: 'Draft warehouse',
        accountingPostingMode: 'draft',
      });
      const issueWarehouse = await warehouses.createWarehouse({
        organizationId,
        branchId,
        code: 'WH-ISS',
        name: 'Issue pricing warehouse',
        accountingPostingMode: 'direct_final',
      });
      directFinalWarehouseId = directFinal.id;
      draftWarehouseId = draft.id;
      issueWarehouseId = issueWarehouse.id;

      const unit = await units.createUnit({
        organizationId,
        code: 'EA',
        name: 'Each',
      });
      unitId = unit.id;

      const item = await items.createItem({
        organizationId,
        code: 'ITM-C62',
        name: 'C-62 item',
        itemKind: 'goods',
        baseUnitId: unitId,
      });
      itemId = item.id;

      // ---- Accounting master data (fixture; see the file header) ----------
      const client = await db();
      financialAreaId = generateId();
      await client.$queryRaw`INSERT INTO accounting.financial_areas (
        id, organization_id, code, title, is_active, is_default, created_at, updated_at
      ) VALUES (${financialAreaId}, ${organizationId}, ${`FA-${suffix}`},
        ${'C-62 area'}, true, false, now(), now())`;

      const fiscalYearId = generateId();
      await client.$queryRaw`INSERT INTO accounting.fiscal_years (
        id, organization_id, financial_area_id, code, title, start_date, end_date,
        status, is_active, created_at, updated_at
      ) VALUES (${fiscalYearId}, ${organizationId}, ${financialAreaId}, ${'C62Y'},
        ${'C-62 year'}, DATE '2020-01-01', DATE '2035-12-31', 'open', true,
        now(), now())`;

      const accountingPeriodId = generateId();
      await client.$queryRaw`INSERT INTO accounting.accounting_periods (
        id, organization_id, financial_area_id, fiscal_year_id, sequence, title,
        start_date, end_date, status, created_at, updated_at
      ) VALUES (${accountingPeriodId}, ${organizationId}, ${financialAreaId},
        ${fiscalYearId}, 1, ${'Whole window'}, DATE '2020-01-01',
        DATE '2035-12-31', 'open', now(), now())`;

      const codingStructureVersionId = generateId();
      await client.$queryRaw`INSERT INTO accounting.coding_structure_versions (
        id, organization_id, code, version_number, status, max_depth, separator,
        created_at, updated_at
      ) VALUES (${codingStructureVersionId}, ${organizationId}, ${'DEFAULT'}, 1,
        'published', 1, '', now(), now())`;

      const accountingConfigurationId = generateId();
      await client.$queryRaw`INSERT INTO accounting.accounting_configurations (
        id, organization_id, code, name, version_number, status, created_at, updated_at
      ) VALUES (${accountingConfigurationId}, ${organizationId}, ${'DEFAULT'},
        ${'Main'}, 1, 'ACTIVE', now(), now())`;
      await client.$queryRaw`INSERT INTO accounting.accounting_configuration_levels (
        id, organization_id, accounting_configuration_id, level_index, title,
        digit_length, default_is_postable, created_at, updated_at
      ) VALUES (${generateId()}, ${organizationId}, ${accountingConfigurationId},
        1, ${'Level 1'}, 2, true, now(), now())`;

      debitAccountId = generateId();
      creditAccountId = generateId();
      for (const [id, code, title] of [
        [debitAccountId, '1000', 'Inventory'],
        [creditAccountId, '2000', 'Payables'],
      ] as const) {
        await client.$queryRaw`INSERT INTO accounting.accounts (
          id, organization_id, code, title, account_nature, is_postable, is_active,
          level, coding_structure_version_id, accounting_configuration_id,
          created_at, updated_at
        ) VALUES (${id}, ${organizationId}, ${code}, ${title}, 'DEBIT', true,
          true, 1, ${codingStructureVersionId}, ${accountingConfigurationId},
          now(), now())`;
      }

      // Voucher numbers are allocated per financial area, so the series is
      // scoped by the area's key exactly as the numbering service does.
      await numberingSeries.createNumberingSeries({
        organizationId,
        documentType: ACCOUNTING_VOUCHER_DOCUMENT_TYPE,
        scopeKey: financialAreaId.toLowerCase(),
        name: 'C-62 vouchers',
        width: 4,
      });

      // The mapping is the accountant's decision (C62-OD-04) and is inserted
      // raw because its administrative surface is a later task.
      await client.$queryRaw`INSERT INTO accounting.source_posting_mappings (
        id, organization_id, source_module, source_document_type,
        financial_area_id, debit_account_id, credit_account_id,
        created_at, updated_at
      ) VALUES (${generateId()}, ${organizationId}, 'inventory',
        'inventory_receipt', ${financialAreaId}, ${debitAccountId},
        ${creditAccountId}, now(), now())`;

      const operatorRole = await roles.createRole({
        name: `C-62 posting operator ${suffix}`,
        description:
          'Live-spec fixture: full C-58 plus ledger and valuation authority.',
        permissionCodes: [
          ...Object.values(INVENTORY_DOCUMENT_PERMISSIONS),
          MOVEMENT_PERMISSIONS.CREATE,
          MOVEMENT_PERMISSIONS.REVERSE,
          MOVEMENT_PERMISSIONS.VIEW,
          TRANSFER_PERMISSIONS.CREATE,
          BALANCE_PERMISSIONS.VIEW,
          VALUATION_PERMISSIONS.ASSIGN_COST,
          VALUATION_PERMISSIONS.RECALCULATE,
          VALUATION_PERMISSIONS.RUN_PRICING,
          VALUATION_PERMISSIONS.REVERSE_PRICING,
        ],
      });
      const operatorUser = await users.createUser({
        username: operatorUsername,
        password,
      });
      operatorId = operatorUser.id;
      await userRoles.assignRoleToUser(operatorRole.id, operatorId);
      await memberships.grantMembership(organizationId, operatorId);

      operator = await loggedInAgent(operatorUsername);
    }, 180_000);

    afterAll(async () => {
      if (app === undefined) return;
      try {
        const client = await db();
        // Children before parents, and the C-62 tables FIRST: the posting
        // snapshot RESTRICTs its document and the posting operation RESTRICTs
        // nothing but is deleted before the document it names.
        await client.$queryRaw`DELETE FROM accounting.ledger_entries WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM accounting.account_balance_projections WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM accounting.accounting_document_lines WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM accounting.accounting_posting_operations WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM accounting.accounting_documents WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM accounting.source_posting_mappings WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM inventory.inventory_accounting_posting_snapshot_movements WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM inventory.inventory_accounting_posting_snapshots WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM inventory.inventory_accounting_posting_operations WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM accounting.accounting_periods WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM accounting.fiscal_years WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM accounting.accounts WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM accounting.accounting_configuration_levels WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM accounting.accounting_configurations WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM accounting.coding_structure_versions WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM accounting.financial_areas WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM inventory.inventory_business_document_lines WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM inventory.inventory_business_documents WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM documents.numbering_allocations WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM documents.numbering_series WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM inventory.inventory_operations WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM inventory.inventory_balances WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM inventory.inventory_movements WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM inventory.inventory_valuation_states WHERE organization_id = ${organizationId}`;
        // A pricing run's key outcomes RESTRICT the valuation run they name, so
        // they go first; the runs themselves restrict the warehouse they were
        // scoped to, so they go before the warehouses. The runs also reference
        // each other (`reverses_run_id`), and PostgreSQL checks that per row,
        // so a second pass clears whatever the first one left parented.
        await client.$queryRaw`DELETE FROM inventory.inventory_pricing_run_key_outcomes WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM inventory.inventory_valuation_runs WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM inventory.inventory_pricing_runs WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM inventory.inventory_pricing_runs WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM inventory.item_valuation_methods WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM inventory.warehouses WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM inventory.items WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM inventory.units WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM organization.branches WHERE organization_id = ${organizationId}`;
        await client.$queryRaw`DELETE FROM organization.organization_memberships WHERE organization_id IN (${organizationId}, ${otherOrganizationId})`;
        await client.$queryRaw`DELETE FROM organization.organizations WHERE id IN (${organizationId}, ${otherOrganizationId})`;
        await client.$queryRaw`DELETE FROM rbac.user_roles WHERE user_id = ${operatorId}`;
        await client.$queryRaw`DELETE FROM rbac.role_permissions WHERE role_id IN (SELECT id FROM rbac.roles WHERE name LIKE ${`C-62 posting operator ${suffix}%`})`;
        await client.$queryRaw`DELETE FROM rbac.roles WHERE name LIKE ${`C-62 posting operator ${suffix}%`}`;
        // The user's session RESTRICTs the user row, so it goes first. The
        // users table lives in the `users` schema, not `identity`.
        await client.$queryRaw`DELETE FROM identity.sessions WHERE user_id = ${operatorId}`;
        await client.$queryRaw`DELETE FROM users.users WHERE id = ${operatorId}`;
      } finally {
        await app.close();
      }
    }, 120_000);

    // -----------------------------------------------------------------------
    // 1. The eligibility gate runs BEFORE the boundary
    // -----------------------------------------------------------------------

    it('refuses to post a document that is not operational or not fully priced', async () => {
      const draft = await createPricedReceipt(
        directFinalWarehouseId,
        '75.00',
        '3',
      );
      const id = draft['id'] as string;

      // A draft has not crossed its own operational boundary yet.
      await accountingPost(id, {}, 422);
      expect(await postingTrail(id)).toHaveLength(0);

      await finalize(id);

      // An UNPRICED receipt is operational but carries no authoritative value,
      // so it is refused before Accounting is ever asked.
      const unpriced = await operator
        .post(base)
        .send({
          organizationId,
          kind: 'receipt',
          warehouseId: directFinalWarehouseId,
          lines: [{ itemId, quantity: '2', unitId }],
        })
        .expect(201);
      await finalize(unpriced.body.id as string);
      const response = await accountingPost(
        unpriced.body.id as string,
        {},
        422,
      );
      expect(response.body.details).toMatchObject({
        code: 'inventory.document.accounting_ineligible',
        valuationState: 'unpriced',
      });
      expect(await postingTrail(unpriced.body.id as string)).toHaveLength(0);
    }, 30_000);

    // -----------------------------------------------------------------------
    // 2. Direct-Final: the document becomes Accounting Posted, for real
    // -----------------------------------------------------------------------

    it('direct_final produces a FINAL voucher with real ledger entries and crosses the boundary', async () => {
      const receipt = await createPricedReceipt(
        directFinalWarehouseId,
        '1250.00',
        '10',
      );
      const id = receipt['id'] as string;
      await finalize(id);

      const posted = await accountingPost(id);
      expect(posted.body.status).toBe('accounting_posted');
      expect(posted.body.accountingPostingState).toBe('final_posted');
      expect(posted.body.accountingPostedAt).not.toBe(null);
      const accountingDocumentId = posted.body.accountingDocumentId as string;
      expect(accountingDocumentId).toBeTruthy();

      // The GL effect is REAL: a final voucher writes ledger entries, and the
      // value is the authoritative movement value (10 x 125.00).
      const entries = await ledgerEntriesFor(accountingDocumentId);
      expect(entries).toHaveLength(2);
      const debit = entries.find((row) => row.account_id === debitAccountId);
      const credit = entries.find((row) => row.account_id === creditAccountId);
      expect(debit).toBeDefined();
      expect(credit).toBeDefined();
      expect(Number(debit!.debit_amount)).toBeCloseTo(1250, 6);
      expect(Number(credit!.credit_amount)).toBeCloseTo(1250, 6);

      const documents = await accountingDocuments();
      const voucher = documents.find((row) => row.id === accountingDocumentId);
      expect(voucher).toBeDefined();
      expect(voucher!.state).toBe('final');
      expect(voucher!.origin).toBe('system');
      expect(voucher!.source_module).toBe('inventory');
      expect(voucher!.source_entity_type).toBe('inventory_business_document');
      expect(voucher!.source_entity_id).toBe(id);
      expect(voucher!.source_operation).toBe('accounting_post');
      // A FINAL voucher has been issued, so it carries a serial.
      expect(voucher!.document_number).toBeTruthy();
      expect(posted.body.accountingDocumentNumber).toBe(
        voucher!.document_number,
      );
      expect(posted.body.accountingDocumentPhase).toBe('final');

      // The durable trail agrees, and the snapshot is the audit evidence of
      // what Inventory actually sent.
      const trail = await postingTrail(id);
      expect(trail).toHaveLength(1);
      expect(trail[0]!['state']).toBe('POSTED');

      // The snapshot itself: the source document type must survive the column
      // it is stored in (`inventory_receipt` is 17 characters), and the value
      // must be the authoritative movement value, never a re-derivation.
      const snapshot = await postingSnapshot(id);
      expect(snapshot).not.toBe(null);
      expect(snapshot!.document_type).toBe('inventory_receipt');
      expect(snapshot!.document_number).toBe(posted.body.number);
      expect(snapshot!.valuation_state).toBe('priced');
      expect(Number(snapshot!.total_value)).toBeCloseTo(1250, 6);

      const snapshotMovements = await postingSnapshotMovements(id);
      expect(snapshotMovements).toHaveLength(1);
      expect(Number(snapshotMovements[0]!.quantity)).toBeCloseTo(10, 6);
      expect(Number(snapshotMovements[0]!.base_quantity)).toBeCloseTo(10, 6);
      expect(Number(snapshotMovements[0]!.total_value)).toBeCloseTo(1250, 6);
      // The derived per-unit figure is FROZEN here as audit evidence; the
      // ledger keeps no second rounded truth of its own.
      expect(Number(snapshotMovements[0]!.unit_cost)).toBeCloseTo(125, 6);
      expect(snapshotMovements[0]!.valuation_status).toBe('valued');
      expect(trail[0]!['glPosted']).toBe(true);
      expect(trail[0]!['postingMode']).toBe('direct_final');
      expect(trail[0]!['accountingDocumentId']).toBe(accountingDocumentId);
      // The initiating human's authority is recorded on the operation, which
      // is what makes the crossing auditable (C62-OD-03).
      expect(trail[0]!['actorUserId']).toBe(operatorId);
      expect(trail[0]!['actorPermission']).toBe(
        INVENTORY_DOCUMENT_PERMISSIONS.ACCOUNTING_POST,
      );

      // The document is now closed to every direct move.
      await operator
        .patch(`${base}/${id}`)
        .query({ organizationId })
        .send({ description: 'nope' })
        .expect(422);
      await operator
        .delete(`${base}/${id}`)
        .query({ organizationId })
        .expect(422);
      await operator
        .post(`${base}/${id}/cancel`)
        .query({ organizationId })
        .send({})
        .expect(422);
    }, 30_000);

    it('replays the same request instead of writing a second voucher', async () => {
      const receipt = await createPricedReceipt(
        directFinalWarehouseId,
        '40.00',
        '4',
      );
      const id = receipt['id'] as string;
      await finalize(id);

      const operationKey = `c62-replay-${suffix}`;
      const first = await accountingPost(id, { operationKey });
      const second = await accountingPost(id, { operationKey });

      // Same document, same Accounting document, no duplicate voucher.
      expect(second.body.accountingDocumentId).toBe(
        first.body.accountingDocumentId,
      );
      const documents = await accountingDocuments();
      expect(
        documents.filter((row) => row.source_entity_id === id),
      ).toHaveLength(1);

      const trail = await postingTrail(id);
      expect(trail).toHaveLength(1);
      expect(trail[0]!['replayed']).toBe(true);
      expect(trail[0]!['operationKey']).toBe(operationKey);
      expect(trail[0]!['state']).toBe('POSTED');
    }, 30_000);

    it('conflicts when the document moved since the caller read it', async () => {
      // The optimistic-concurrency expectation, not the operation key, is what
      // refuses a stale caller: the key is scoped by (organization, document,
      // action) per C62-OD-06, so two documents may legitimately share one.
      const receipt = await createPricedReceipt(
        directFinalWarehouseId,
        '10.00',
        '1',
      );
      const id = receipt['id'] as string;
      await finalize(id);
      const revision = (
        await operator
          .get(`${base}/${id}`)
          .query({ organizationId })
          .expect(200)
      ).body.updatedAt as string;

      await accountingPost(
        id,
        { expectedDocumentRevision: 'not-the-current-revision' },
        409,
      );
      // Nothing was written by the refused attempt.
      expect(await postingTrail(id)).toHaveLength(0);

      // The correct revision posts.
      const posted = await accountingPost(id, {
        expectedDocumentRevision: revision,
      });
      expect(posted.body.status).toBe('accounting_posted');
      expect(await postingTrail(id)).toHaveLength(1);
    }, 30_000);

    // -----------------------------------------------------------------------
    // 3. Draft mode: an Accounting-owned draft, never Accounting Posted
    // -----------------------------------------------------------------------

    it('draft mode leaves the document operational with an Accounting draft and no GL effect', async () => {
      const receipt = await createPricedReceipt(
        draftWarehouseId,
        '300.00',
        '5',
      );
      const id = receipt['id'] as string;
      await finalize(id);

      const posted = await accountingPost(id);
      // The document did NOT cross the immutability boundary: a draft is not
      // Accounting Posted (C62-OD-02).
      expect(posted.body.status).toBe('operational');
      expect(posted.body.accountingPostingState).toBe('draft_created');
      expect(posted.body.accountingPostedAt).toBe(null);
      const accountingDocumentId = posted.body.accountingDocumentId as string;
      expect(accountingDocumentId).toBeTruthy();

      const documents = await accountingDocuments();
      const voucher = documents.find((row) => row.id === accountingDocumentId);
      expect(voucher!.state).toBe('draft');
      // A draft has NOT been issued, so it carries no serial — the honest
      // answer is null, not an invented number.
      expect(voucher!.document_number).toBe(null);
      expect(posted.body.accountingDocumentNumber).toBe(null);
      // And no ledger entry exists: nothing reached the books.
      expect(await ledgerEntriesFor(accountingDocumentId)).toHaveLength(0);

      // Still operational, so the ordinary operational rules still apply.
      await operator
        .patch(`${base}/${id}`)
        .query({ organizationId })
        .send({ description: 'still editable while a draft exists' })
        .expect(200);

      const trail = await postingTrail(id);
      expect(trail[0]!['state']).toBe('DRAFT_CREATED');
      expect(trail[0]!['glPosted']).toBe(false);
      expect(trail[0]!['postingMode']).toBe('draft');

      // Cancelling the Accounting draft goes through the SAME contract, and
      // the Inventory standing only moves once Accounting confirms.
      const cancelled = await operator
        .post(`${base}/${id}/accounting-post/cancel`)
        .query({ organizationId })
        .send({})
        .expect(200);
      expect(cancelled.body.accountingPostingState).toBe('draft_cancelled');
      const afterCancel = await accountingDocuments();
      expect(afterCancel.some((row) => row.id === accountingDocumentId)).toBe(
        false,
      );
    }, 30_000);

    it('refuses to cancel anything but an Accounting draft', async () => {
      // Never posted at all.
      const receipt = await createPricedReceipt(draftWarehouseId, '20.00', '2');
      const id = receipt['id'] as string;
      await finalize(id);
      await operator
        .post(`${base}/${id}/accounting-post/cancel`)
        .query({ organizationId })
        .send({})
        .expect(422);

      // A FINAL voucher is never cancellable through this route.
      const finalReceipt = await createPricedReceipt(
        directFinalWarehouseId,
        '20.00',
        '2',
      );
      await finalize(finalReceipt['id'] as string);
      await accountingPost(finalReceipt['id'] as string);
      await operator
        .post(`${base}/${finalReceipt['id'] as string}/accounting-post/cancel`)
        .query({ organizationId })
        .send({})
        .expect(422);
    }, 30_000);

    // -----------------------------------------------------------------------
    // 4. The slice is closed to every other document type
    // -----------------------------------------------------------------------

    it('refuses an ISSUE even though the warehouse and the mapping are fine', async () => {
      // An issue carries no entered cost of its own, so it is only priceable
      // from a costed pool: unpriced receipt, issue against it, cost assigned
      // to the receipt movement, then the run. Without the run the document is
      // UNPRICED and the refusal would be Inventory's own eligibility gate
      // rather than Accounting's closure of the slice, which is the point here.
      const stock = await operator
        .post(base)
        .send({
          organizationId,
          kind: 'receipt',
          warehouseId: issueWarehouseId,
          lines: [{ itemId, quantity: '10', unitId }],
        })
        .expect(201);
      const stockId = stock.body.id as string;
      await finalize(stockId);
      await assignCost(await firstLineMovementId(stockId), '50');

      const response = await operator
        .post(base)
        .send({
          organizationId,
          kind: 'issue',
          warehouseId: issueWarehouseId,
          lines: [{ itemId, quantity: '1', unitId }],
        })
        .expect(201);
      const id = response.body.id as string;
      await finalize(id);
      const run = await runPricing(issueWarehouseId, new Date());
      expect(run['keysPriced']).toBe(1);
      expect(run['keysFailed']).toBe(0);

      // Pin the premise: the issue must be PRICED, or the refusal below would be
      // Inventory's own eligibility gate rather than Accounting's closure.
      const priced = await operator
        .get(`${base}/${id}`)
        .query({ organizationId })
        .expect(200);
      expect(priced.body.valuationState).toBe('priced');
      expect(priced.body.accountingEligible).toBe(true);

      const refused = await accountingPost(id);
      expect(refused.body.status).toBe('operational');
      expect(refused.body.accountingPostingState).toBe('not_posted');
      const trail = await postingTrail(id);
      expect(trail[0]!['state']).toBe('REFUSED');
      expect(trail[0]!['refusalCode']).toBe(
        'accounting.source_type_unsupported',
      );
      // Nothing was created, and nothing reached the books.
      const documents = await accountingDocuments();
      expect(documents.some((row) => row.source_entity_id === id)).toBe(false);
    }, 30_000);

    // -----------------------------------------------------------------------
    // 5. Why the reverse-pricing blocker has NO live proof here
    // -----------------------------------------------------------------------

    // `inventory.pricing.reverse_accounting_posted` refuses to reverse a run
    // that valued movements of a document which already crossed the Accounting
    // boundary. It is a real rule and it is enforced in production — but it
    // CANNOT be proven against a live database inside the C-62 slice, and the
    // reason is structural rather than incidental:
    //
    //   the blocker is built from `movements.findByValuationRun(runId)`, the
    //   movements a pricing run RESTATED. For a movement to be restated,
    //   `valuationChanged(before, after)` must hold, and for a receipt's
    //   inbound that is unreachable in BOTH directions:
    //
    //   - a costed inbound is `settled('valued', value, 'entered')`
    //     (moving-weighted-average rule 1), and `toReplayFact` PRESERVES any
    //     movement whose source is not `average_cost` — so the replay
    //     reproduces it byte for byte and nothing changes;
    //   - an uncosted inbound is `unvalued('no_cost_supplied')` (rule 2: "a
    //     receipt with no cost is normal, not an error") and the strategy
    //     never invents a value for one, so it stays unvalued forever.
    //
    // A receipt's inbound is therefore either preserved verbatim or permanently
    // unvalued — never restated. And since C-62 maps only
    // `('inventory', 'inventory_receipt')` into Accounting, the only documents
    // that CAN cross are exactly the documents whose movements a run can never
    // restate. The blocker has nothing to name.
    //
    // The rule is verified where the premise can actually be constructed:
    // `inventory-pricing.service.spec.ts`, "refuses when an affected document
    // has crossed Accounting Post", which seeds the affected movement directly
    // and so is not constrained by what a live receipt can express. The
    // complementary live rule — a REFUSED posting must NOT freeze the valuation
    // history — is proven in `inventory-pricing-live.e2e-spec.ts`.
    //
    // What IS proven live, above, is the half this slice owns: a document that
    // really crossed becomes immutable to direct edit and delete, and its
    // posting trail is readable and organization-scoped.

    it('answers 404 — never 403 — for a posting trail outside the organization', async () => {
      const receipt = await createPricedReceipt(
        directFinalWarehouseId,
        '5.00',
        '1',
      );
      const id = receipt['id'] as string;
      await finalize(id);
      await accountingPost(id);

      // A foreign organization scope is not a member of it, so the document
      // does not resolve at all (ADR-0021 §4).
      await operator
        .get(`${base}/${id}/accounting-posting`)
        .query({ organizationId: otherOrganizationId })
        .expect(404);
    }, 30_000);

    // -----------------------------------------------------------------------
    // 6. OD-06: one operation key answers ONE request — replay or 409
    // -----------------------------------------------------------------------

    it('conflicts (409) when the same operation key is reused for a different request', async () => {
      const receipt = await createPricedReceipt(draftWarehouseId, '60.00', '6');
      const id = receipt['id'] as string;
      await finalize(id);

      const operationKey = `c62-hash-conflict-${suffix}`;
      const posted = await accountingPost(id, { operationKey });
      expect(posted.body.accountingPostingState).toBe('draft_created');

      // The document moves between the two attempts of the same key: the
      // request the caller is making now is not the frozen one.
      await operator
        .patch(`${base}/${id}`)
        .query({ organizationId })
        .send({ description: 'edited between the two attempts' })
        .expect(200);

      const conflict = await accountingPost(id, { operationKey }, 409);
      expect(conflict.body.code).toBe('Conflict');

      // Nothing new was written: one operation, one draft, no second effect.
      const trail = await postingTrail(id);
      expect(trail).toHaveLength(1);
      expect(trail[0]!['state']).toBe('DRAFT_CREATED');
      expect(await accountingDocumentsForSource(id)).toHaveLength(1);
    }, 30_000);

    it('refuses a second operation under a different key while one is in flight', async () => {
      const receipt = await createPricedReceipt(draftWarehouseId, '70.00', '7');
      const id = receipt['id'] as string;
      await finalize(id);

      await accountingPost(id, { operationKey: `c62-inflight-a-${suffix}` });
      // A draft exists: a second operation under ANY key would be a second
      // Accounting effect for the same document, so Phase 1 refuses it.
      const refused = await accountingPost(
        id,
        { operationKey: `c62-inflight-b-${suffix}` },
        422,
      );
      expect(refused.body.details).toMatchObject({
        code: 'inventory.document.accounting_post_in_flight',
        state: 'DRAFT_CREATED',
      });
      expect(await postingTrail(id)).toHaveLength(1);
      expect(await accountingDocumentsForSource(id)).toHaveLength(1);
    }, 30_000);

    it('produces exactly one voucher for a concurrent same-key same-request race', async () => {
      const receipt = await createPricedReceipt(
        directFinalWarehouseId,
        '80.00',
        '8',
      );
      const id = receipt['id'] as string;
      await finalize(id);
      const operationKey = `c62-race-same-${suffix}`;

      // Two requests race on one key with one request: both must be answered
      // (the loser replays or recovers through the same decision procedure),
      // and Accounting's own ledger makes the effect singular.
      const [first, second] = await Promise.all([
        accountingPost(id, { operationKey }),
        accountingPost(id, { operationKey }),
      ]);
      expect(first.body.accountingPostingState).toBe('final_posted');
      expect(second.body.accountingPostingState).toBe('final_posted');
      expect(second.body.accountingDocumentId).toBe(
        first.body.accountingDocumentId,
      );

      const trail = await postingTrail(id);
      expect(trail).toHaveLength(1);
      expect(trail[0]!['state']).toBe('POSTED');
      const documents = await accountingDocumentsForSource(id);
      expect(documents).toHaveLength(1);
      expect(documents[0]!.state).toBe('final');
      expect(await ledgerEntriesFor(documents[0]!.id)).toHaveLength(2);
      expect((await readDocument(id))['status']).toBe('accounting_posted');
    }, 30_000);

    // -----------------------------------------------------------------------
    // 7. OD-01 recovery: a PENDING operation resumes through Accounting's
    //    own idempotency ledger, from its immutable snapshot
    // -----------------------------------------------------------------------

    it('recovers a PENDING operation whose FINAL voucher already exists (crash before Phase 3)', async () => {
      const receipt = await createPricedReceipt(
        directFinalWarehouseId,
        '90.00',
        '9',
      );
      const id = receipt['id'] as string;
      await finalize(id);
      const operationKey = `c62-recover-final-${suffix}`;

      const posted = await accountingPost(id, { operationKey });
      const voucherId = posted.body.accountingDocumentId as string;
      expect(posted.body.accountingPostingState).toBe('final_posted');

      // Crash simulation: Phase 3 never ran — the operation is PENDING, the
      // document projection is undone, but Accounting already holds the FINAL
      // voucher and its ledger rows.
      await revertOperationToPending(id);
      await revertDocumentProjection(id);
      expect((await postingOperation(id))!.state).toBe('PENDING');

      const recovered = await accountingPost(id, { operationKey });
      expect(recovered.body.accountingPostingState).toBe('final_posted');
      // Accounting's own ledger replayed: the SAME voucher, no second one.
      expect(recovered.body.accountingDocumentId).toBe(voucherId);
      const documents = await accountingDocumentsForSource(id);
      expect(documents).toHaveLength(1);
      expect(documents[0]!.id).toBe(voucherId);
      expect(documents[0]!.state).toBe('final');
      expect(await ledgerEntriesFor(voucherId)).toHaveLength(2);

      // The durable records converged.
      expect(await postingOperation(id)).toMatchObject({
        state: 'POSTED',
        gl_posted: true,
        accounting_document_id: voucherId,
      });
      const document = await readDocument(id);
      expect(document['status']).toBe('accounting_posted');
      expect(document['accountingPostingState']).toBe('final_posted');
    }, 30_000);

    it('recovers a PENDING operation whose DRAFT already exists (crash before Phase 3)', async () => {
      const receipt = await createPricedReceipt(draftWarehouseId, '11.00', '1');
      const id = receipt['id'] as string;
      await finalize(id);
      const operationKey = `c62-recover-draft-${suffix}`;

      const drafted = await accountingPost(id, { operationKey });
      expect(drafted.body.accountingPostingState).toBe('draft_created');
      const draftId = drafted.body.accountingDocumentId as string;

      // Crash simulation: Phase 3 never ran — the operation is PENDING and
      // the document standing is back to not_posted, but Accounting already
      // holds the draft.
      await revertOperationToPending(id);
      await revertDocumentProjection(id);

      const recovered = await accountingPost(id, { operationKey });
      expect(recovered.body.accountingPostingState).toBe('draft_created');
      // The SAME draft, discovered through Accounting's idempotency contract.
      expect(recovered.body.accountingDocumentId).toBe(draftId);
      const documents = await accountingDocumentsForSource(id);
      expect(documents).toHaveLength(1);
      expect(documents[0]!.id).toBe(draftId);
      expect(documents[0]!.state).toBe('draft');
      expect(await postingOperation(id)).toMatchObject({
        state: 'DRAFT_CREATED',
      });
      const document = await readDocument(id);
      expect(document['accountingPostingState']).toBe('draft_created');
      expect(document['status']).toBe('operational');
    }, 30_000);

    it('completes a PENDING operation that never reached Accounting (crash before Phase 2)', async () => {
      const receipt = await createPricedReceipt(
        directFinalWarehouseId,
        '12.00',
        '1',
      );
      const id = receipt['id'] as string;
      await finalize(id);
      const operationKey = `c62-recover-fresh-${suffix}`;

      const posted = await accountingPost(id, { operationKey });
      const firstVoucherId = posted.body.accountingDocumentId as string;

      // Crash simulation: Phase 1 committed, the process died before the
      // boundary call — the whole Accounting side of the operation is erased,
      // which is exactly "Accounting was never asked".
      await revertOperationToPending(id);
      await revertDocumentProjection(id);
      await eraseAccountingVoucher(firstVoucherId);
      expect(await accountingDocumentsForSource(id)).toHaveLength(0);

      const recovered = await accountingPost(id, { operationKey });
      expect(recovered.body.accountingPostingState).toBe('final_posted');
      const documents = await accountingDocumentsForSource(id);
      expect(documents).toHaveLength(1);
      expect(documents[0]!.state).toBe('final');
      expect(await ledgerEntriesFor(documents[0]!.id)).toHaveLength(2);
      expect((await postingOperation(id))!.state).toBe('POSTED');
      const document = await readDocument(id);
      expect(document['status']).toBe('accounting_posted');
      expect(document['accountingPostingState']).toBe('final_posted');
    }, 30_000);

    it('converges when the document was projected but the operation update was interrupted', async () => {
      const receipt = await createPricedReceipt(
        directFinalWarehouseId,
        '13.00',
        '1',
      );
      const id = receipt['id'] as string;
      await finalize(id);
      const operationKey = `c62-recover-converge-${suffix}`;

      const posted = await accountingPost(id, { operationKey });
      const voucherId = posted.body.accountingDocumentId as string;

      // Crash between the document write and the operation write: the
      // document is accounting_posted but the operation is still PENDING.
      await revertOperationToPending(id);
      expect((await readDocument(id))['status']).toBe('accounting_posted');

      const recovered = await accountingPost(id, { operationKey });
      expect(recovered.body.accountingPostingState).toBe('final_posted');
      expect(recovered.body.accountingDocumentId).toBe(voucherId);
      // Both durable records converged on the same answer.
      expect((await postingOperation(id))!.state).toBe('POSTED');
      const documents = await accountingDocumentsForSource(id);
      expect(documents).toHaveLength(1);
      expect(documents[0]!.id).toBe(voucherId);
      const document = await readDocument(id);
      expect(document['status']).toBe('accounting_posted');
      expect(document['accountingPostingState']).toBe('final_posted');
    }, 30_000);

    // -----------------------------------------------------------------------
    // 8. Cancellation: a success answer, and convergence of both crash
    //    windows (the draft already gone / the operation update interrupted)
    // -----------------------------------------------------------------------

    it('converges a cancellation retry after Accounting already deleted the draft', async () => {
      const receipt = await createPricedReceipt(draftWarehouseId, '14.00', '1');
      const id = receipt['id'] as string;
      await finalize(id);

      const drafted = await accountingPost(id);
      expect(drafted.body.accountingPostingState).toBe('draft_created');
      const draftId = drafted.body.accountingDocumentId as string;

      // Crash after Accounting deleted the draft, before Inventory wrote:
      // the Accounting document is gone, its ledger rows are gone too (the
      // whole cancellation effect is erased, as if the delete committed and
      // the process died before the Inventory write).
      await eraseAccountingVoucher(draftId);
      expect(await accountingDocumentsForSource(id)).toHaveLength(0);
      expect((await readDocument(id))['accountingPostingState']).toBe(
        'draft_created',
      );

      // The retry converges WITHOUT a second Accounting deletion: the
      // contract answers cancelled because its own ledger holds no document
      // for the operation key any more.
      const cancelled = await operator
        .post(`${base}/${id}/accounting-post/cancel`)
        .query({ organizationId })
        .send({})
        .expect(200);
      expect(cancelled.body.accountingPostingState).toBe('draft_cancelled');
      expect((await postingOperation(id))!.state).toBe('CANCELLED');
      expect(await accountingDocumentsForSource(id)).toHaveLength(0);
    }, 30_000);

    it('converges a cancellation whose operation update was interrupted', async () => {
      const receipt = await createPricedReceipt(draftWarehouseId, '15.00', '1');
      const id = receipt['id'] as string;
      await finalize(id);
      await accountingPost(id);

      const cancelled = await operator
        .post(`${base}/${id}/accounting-post/cancel`)
        .query({ organizationId })
        .send({})
        .expect(200);
      expect(cancelled.body.accountingPostingState).toBe('draft_cancelled');
      expect((await postingOperation(id))!.state).toBe('CANCELLED');

      // Crash between the document write and the operation write: the
      // document says draft_cancelled, the operation still says DRAFT_CREATED.
      const client = await db();
      await client.$queryRaw`UPDATE inventory.inventory_accounting_posting_operations
        SET state = 'DRAFT_CREATED', completed_at = NULL, updated_at = now()
        WHERE organization_id = ${organizationId} AND document_id = ${id}`;

      // The retry converges the operation onto the document's durable fact
      // without touching Accounting again.
      const retried = await operator
        .post(`${base}/${id}/accounting-post/cancel`)
        .query({ organizationId })
        .send({})
        .expect(200);
      expect(retried.body.accountingPostingState).toBe('draft_cancelled');
      expect((await postingOperation(id))!.state).toBe('CANCELLED');

      // A further retry replays the converged success answer.
      const replayed = await operator
        .post(`${base}/${id}/accounting-post/cancel`)
        .query({ organizationId })
        .send({})
        .expect(200);
      expect(replayed.body.accountingPostingState).toBe('draft_cancelled');
      expect((await postingOperation(id))!.state).toBe('CANCELLED');
    }, 30_000);
  },
);
