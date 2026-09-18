import { beforeEach, describe, expect, it } from 'vitest';
import { DomainEventBus } from '../../../kernel/events/domain-event-bus.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { createInMemoryStores } from '../../../../test/support/in-memory-repositories.js';
import { createMasterDataStores } from '../../../../test/support/master-data-repositories.js';
import {
  createAccountingStores,
  type AccountingStores,
} from '../../../../test/support/accounting-repositories.js';
import {
  createStructureStores,
  type StructureStores,
} from '../../../../test/support/accounting-structure-repositories.js';
import {
  createAccountingDocumentStores,
  type AccountingDocumentStores,
} from '../../../../test/support/accounting-document-repositories.js';
import { UNPINNED_APP_CONFIG } from '../../../../test/support/app-config.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import type { AccountingDocument } from '../domain/accounting-document.js';
import { parseDateOnly } from '../domain/date-range.js';
import { PostingReadinessService } from './posting-readiness.service.js';

/**
 * The posting-readiness seam against the real service and the in-memory
 * repositories (Task 10.5, contract §15.5/§19.3).
 *
 * This suite pins what the pure domain table cannot:
 * - the SERVICE assembles the snapshot from persisted rows (documents,
 *   calendar, chart) and delegates the verdict — no rule of its own;
 * - organization isolation: a foreign or missing document is the module's
 *   uniform 404, never a readiness verdict (AC-I-01/16);
 * - the two DELIBERATE non-criteria, end to end on stored rows: a period
 *   closed and a year sealed AFTER finalization, and an account disabled
 *   AFTER finalization, all leave the voucher READY (§7.2 rule 7, §8.6 —
 *   the domain input carries no status/activity, and here that is proven
 *   against real state transitions);
 * - the defensive re-checks catch stored-state corruption (a postability
 *   flip, a vanished account, a tampered line amount) and the one reachable
 *   drift seam (fiscal-year dates edited while the year is open);
 * - READ-ONLY: before/after snapshots of every table the evaluation reads
 *   are deep-equal — no document, line, ledger, calendar or chart row
 *   changes. The service cannot allocate numbering or emit events at all
 *   (no such dependencies exist in its constructor — the fixture builds it
 *   without them), and the unchanged `operations` table proves no
 *   idempotency row is written (§16.4 belongs to effects, not evaluations).
 *
 * Vouchers are composed through the fake repository's guarded methods
 * (`createChecked`/`finalizeChecked`), which enforce the same composition,
 * scope and account rules as the real transactions — so a fixture document
 * that reaches `final` here is a document the real module would finalize.
 */

const ORG_A = '01ORGANIZATIONA000000000AA';
const ORG_B = '01ORGANIZATIONB000000000BB';
const AREA = '01AREAAAAAAAAAAAAAAAAAAAA01';
const YEAR = '01YEARAAAAAAAAAAAAAAAAAAAA01';
const PERIOD = '01PERIODAAAAAAAAAAAAAAAAAAA01';
const DEBIT_ACCOUNT = '01ACCOUNTAAAAAAAAAAAAAAAAA01';
const CREDIT_ACCOUNT = '01ACCOUNTAAAAAAAAAAAAAAAAA02';

const DOCUMENT_DATE = parseDateOnly('2026-04-05') as Date;

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

interface Fixture {
  readiness: PostingReadinessService;
  accounting: AccountingStores;
  structure: StructureStores;
  vouchers: AccountingDocumentStores;
}

function buildFixture(): Fixture {
  const rbacStores = createInMemoryStores();
  const masterStores = createMasterDataStores();
  const accounting = createAccountingStores();
  const structure = createStructureStores();
  const bus = new DomainEventBus();

  // Only the deployment pin guard is consulted (a no-op unpinned); the
  // fixture needs no organization rows because the fakes scope by the
  // organization_id stored on each row, exactly like the real queries.
  const organizations = new OrganizationsService(
    masterStores.organizations,
    new AuthorizationService(rbacStores.userRoles, loggerStub()),
    loggerStub(),
    bus,
    UNPINNED_APP_CONFIG,
  );

  const vouchers = createAccountingDocumentStores({
    accounting: accounting.raw.state,
    structure: structure.raw.state,
  });

  const readiness = new PostingReadinessService(
    vouchers.documents,
    accounting.areas,
    accounting.years,
    accounting.periods,
    structure.accounts,
    organizations,
  );

  return { readiness, accounting, structure, vouchers };
}

/** Seed the calendar and the chart the voucher guards resolve against. */
function seedScope(fx: Fixture): void {
  const now = new Date();
  fx.accounting.raw.state.areas.seed({
    id: AREA,
    organizationId: ORG_A,
    code: 'GA',
    title: 'General',
    isDefault: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  fx.accounting.raw.state.years.seed({
    id: YEAR,
    organizationId: ORG_A,
    financialAreaId: AREA,
    code: 'Y1405',
    title: 'Year 1405',
    startDate: parseDateOnly('2026-01-01') as Date,
    endDate: parseDateOnly('2026-12-31') as Date,
    status: 'open',
    isActive: true,
    priorYearId: null,
    createdAt: now,
    updatedAt: now,
  });
  fx.accounting.raw.state.periods.seed({
    id: PERIOD,
    organizationId: ORG_A,
    financialAreaId: AREA,
    fiscalYearId: YEAR,
    sequence: 1,
    title: 'April',
    startDate: parseDateOnly('2026-04-01') as Date,
    endDate: parseDateOnly('2026-04-30') as Date,
    status: 'open',
    periodKind: 'normal',
    createdAt: now,
    updatedAt: now,
  });
  for (const [id, code, title] of [
    [DEBIT_ACCOUNT, '1000', 'Cash'],
    [CREDIT_ACCOUNT, '2000', 'Revenue'],
  ] as const) {
    fx.structure.raw.state.accounts.seed({
      id,
      organizationId: ORG_A,
      code,
      title,
      parentId: null,
      level: 1,
      codingStructureVersionId: '01STRUCTAAAAAAAAAAAAAAAAA01',
      accountingConfigurationId: null,
      accountNature: 'debit',
      isPostable: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
    });
  }
}

/**
 * Compose a voucher through the fake's guarded path (§15.1): created as
 * `draft` (no serial) or as an issued `temporary`, and — unless the caller
 * asks to stop earlier — finalized with a ledger row, exactly the shape the
 * real finalization transaction produces.
 */
async function composeVoucher(
  fx: Fixture,
  stopAt: 'draft' | 'temporary' | 'final',
): Promise<AccountingDocument> {
  const now = new Date();
  const documentId = generateId();
  const created = await fx.vouchers.documents.createChecked({
    id: documentId,
    organizationId: ORG_A,
    financialAreaId: AREA,
    documentDate: DOCUMENT_DATE,
    description: 'Opening entry',
    state: stopAt === 'draft' ? 'draft' : 'temporary',
    origin: 'manual',
    branchId: null,
    source: null,
    documentNumber: stopAt === 'draft' ? null : '0001',
    correlationId: null,
    idempotencyReference: null,
    requestHash: null,
    lines: [
      {
        id: generateId(),
        lineNo: 1,
        accountId: DEBIT_ACCOUNT,
        debitAmount: '1250',
        creditAmount: '0',
        description: null,
        sourceLineReference: null,
      },
      {
        id: generateId(),
        lineNo: 2,
        accountId: CREDIT_ACCOUNT,
        debitAmount: '0',
        creditAmount: '1250',
        description: null,
        sourceLineReference: null,
      },
    ],
    ledger:
      stopAt === 'draft'
        ? null
        : {
            id: generateId(),
            organizationId: ORG_A,
            operationKey: `create-${documentId}`,
            operation: 'document_create',
            requestHash: 'hash',
            result: { documentId },
            createdAt: now,
            updatedAt: now,
            createdBy: null,
          },
    createdAt: now,
    createdBy: null,
  });
  if (stopAt !== 'final') return created;
  return fx.vouchers.documents.finalizeChecked({
    id: documentId,
    organizationId: ORG_A,
    ledger: {
      id: generateId(),
      organizationId: ORG_A,
      operationKey: `finalize-${documentId}`,
      operation: 'document_finalize',
      requestHash: 'hash',
      result: { documentId },
      createdAt: now,
      updatedAt: now,
      createdBy: null,
    },
    finalizedAt: now,
    finalizedBy: null,
  });
}

/** Deep snapshots of every table the evaluation reads. */
function snapshotStores(fx: Fixture) {
  return {
    documents: fx.vouchers.raw.state.documents.snapshot(),
    lines: fx.vouchers.raw.state.lines.snapshot(),
    operations: fx.vouchers.raw.state.operations.snapshot(),
    areas: fx.accounting.raw.state.areas.snapshot(),
    years: fx.accounting.raw.state.years.snapshot(),
    periods: fx.accounting.raw.state.periods.snapshot(),
    accounts: fx.structure.raw.state.accounts.snapshot(),
  };
}

describe('PostingReadinessService (Task 10.5 seam)', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = buildFixture();
    seedScope(fixture);
  });

  it('reports a finalized valid voucher as ready', async () => {
    const voucher = await composeVoucher(fixture, 'final');
    const verdict = await fixture.readiness.evaluateReadiness(
      ORG_A,
      voucher.id,
    );
    expect(verdict).toEqual({
      status: 'ready',
      documentId: voucher.id,
      reasons: [],
    });
  });

  it('does not mutate anything: every store is deep-equal unchanged', async () => {
    const voucher = await composeVoucher(fixture, 'final');
    const before = snapshotStores(fixture);
    const operationsBefore =
      fixture.vouchers.raw.state.operations.snapshot().length;

    await fixture.readiness.evaluateReadiness(ORG_A, voucher.id);
    // A second evaluation — idempotent by construction, and still no writes.
    await fixture.readiness.evaluateReadiness(ORG_A, voucher.id);

    expect(snapshotStores(fixture)).toEqual(before);
    // The concrete no-mutation promises (task 10.5 §9/§19): no state change,
    // no serial change, no idempotency row, no timestamp bump.
    const stored = fixture.vouchers.raw.state.documents.findById(voucher.id);
    expect(stored?.state).toBe('final');
    expect(stored?.documentNumber).toBe('0001');
    expect(fixture.vouchers.raw.state.operations.snapshot().length).toBe(
      operationsBefore,
    );
  });

  it('refuses a draft voucher: document_not_final, nothing else', async () => {
    const draft = await composeVoucher(fixture, 'draft');
    const verdict = await fixture.readiness.evaluateReadiness(ORG_A, draft.id);
    expect(verdict.status).toBe('not_ready');
    expect(verdict.reasons).toEqual([
      { problem: 'document_not_final', phase: 'draft' },
    ]);
  });

  it('refuses a temporary voucher: document_not_final', async () => {
    const temporary = await composeVoucher(fixture, 'temporary');
    const verdict = await fixture.readiness.evaluateReadiness(
      ORG_A,
      temporary.id,
    );
    expect(verdict.status).toBe('not_ready');
    expect(verdict.reasons).toEqual([
      { problem: 'document_not_final', phase: 'temporary' },
    ]);
  });

  it('answers the uniform 404 for a missing document (never a verdict)', async () => {
    await expect(
      fixture.readiness.evaluateReadiness(ORG_A, '01J8ZQ9W7R6T5Y4U3I2O1P0ZZZ'),
    ).rejects.toMatchObject({
      code: 'EntityNotFound',
      details: { entity: 'AccountingDocument' },
    });
  });

  it('answers the uniform 404 for another organization’s document (AC-I-01/16)', async () => {
    const voucher = await composeVoucher(fixture, 'final');
    await expect(
      fixture.readiness.evaluateReadiness(ORG_B, voucher.id),
    ).rejects.toMatchObject({ code: 'EntityNotFound' });
    // …and the correct organization still evaluates it normally: the
    // foreign lookup changed nothing about the stored aggregate.
    await expect(
      fixture.readiness.evaluateReadiness(ORG_A, voucher.id),
    ).resolves.toMatchObject({ status: 'ready' });
  });

  // ---- the two deliberate non-criteria (§7.2 rule 7, §8.6) ----------------

  it('stays READY after the period is closed and the year sealed (§7.2 rule 7)', async () => {
    const voucher = await composeVoucher(fixture, 'final');
    fixture.accounting.raw.state.periods.patch(PERIOD, { status: 'closed' });
    fixture.accounting.raw.state.years.patch(YEAR, { status: 'sealed' });
    await expect(
      fixture.readiness.evaluateReadiness(ORG_A, voucher.id),
    ).resolves.toEqual({
      status: 'ready',
      documentId: voucher.id,
      reasons: [],
    });
  });

  it('stays READY after a referenced account is disabled (§8.6)', async () => {
    const voucher = await composeVoucher(fixture, 'final');
    fixture.structure.raw.state.accounts.patch(CREDIT_ACCOUNT, {
      isActive: false,
    });
    await expect(
      fixture.readiness.evaluateReadiness(ORG_A, voucher.id),
    ).resolves.toEqual({
      status: 'ready',
      documentId: voucher.id,
      reasons: [],
    });
  });

  // ---- the defensive re-checks (corruption and the year-date drift) -------

  it('refuses a final voucher whose account is no longer postable', async () => {
    const voucher = await composeVoucher(fixture, 'final');
    // A guard-bypassing flip (AC-I-11 refuses this through the service):
    // the stored state is corrupt, and the seam must not hand it to an engine.
    fixture.structure.raw.state.accounts.patch(CREDIT_ACCOUNT, {
      isPostable: false,
    });
    await expect(
      fixture.readiness.evaluateReadiness(ORG_A, voucher.id),
    ).resolves.toEqual({
      status: 'not_ready',
      documentId: voucher.id,
      reasons: [{ problem: 'account_not_postable', accountId: CREDIT_ACCOUNT }],
    });
  });

  it('refuses a final voucher whose account row is gone', async () => {
    const voucher = await composeVoucher(fixture, 'final');
    fixture.structure.raw.state.accounts.delete(CREDIT_ACCOUNT);
    await expect(
      fixture.readiness.evaluateReadiness(ORG_A, voucher.id),
    ).resolves.toEqual({
      status: 'not_ready',
      documentId: voucher.id,
      reasons: [{ problem: 'account_not_found', accountId: CREDIT_ACCOUNT }],
    });
  });

  it('refuses a final voucher whose stored scope drifted from its date', async () => {
    const voucher = await composeVoucher(fixture, 'final');
    // The reachable seam: year dates are editable while the year is open
    // (Task 10.2's §6.5 reading; no document-reference guard exists on year
    // edits yet), so a stored resolution can go stale — readiness reports
    // the drift instead of re-resolving and silently accepting it.
    fixture.accounting.raw.state.years.patch(YEAR, {
      startDate: parseDateOnly('2027-01-01') as Date,
      endDate: parseDateOnly('2027-12-31') as Date,
    });
    await expect(
      fixture.readiness.evaluateReadiness(ORG_A, voucher.id),
    ).resolves.toEqual({
      status: 'not_ready',
      documentId: voucher.id,
      reasons: [{ problem: 'scope_unresolvable', scope: 'year' }],
    });
  });

  it('refuses a final voucher whose period row is gone', async () => {
    const voucher = await composeVoucher(fixture, 'final');
    fixture.accounting.raw.state.periods.delete(PERIOD);
    await expect(
      fixture.readiness.evaluateReadiness(ORG_A, voucher.id),
    ).resolves.toEqual({
      status: 'not_ready',
      documentId: voucher.id,
      reasons: [{ problem: 'scope_unresolvable', scope: 'period' }],
    });
  });

  it('refuses a final voucher whose stored lines no longer balance', async () => {
    const voucher = await composeVoucher(fixture, 'final');
    const line = fixture.vouchers.raw.state.lines.findOne(
      (row) => row.documentId === voucher.id && row.lineNo === 1,
    );
    expect(line).not.toBeNull();
    fixture.vouchers.raw.state.lines.patch(line!.id, { debitAmount: '999' });
    await expect(
      fixture.readiness.evaluateReadiness(ORG_A, voucher.id),
    ).resolves.toMatchObject({
      status: 'not_ready',
      reasons: [{ problem: 'unbalanced_document' }],
    });
  });
});
