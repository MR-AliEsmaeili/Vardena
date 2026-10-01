import { licensingTestDouble } from '../../../../test/support/licensing.js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DomainEventBus,
  type DomainEvent,
} from '../../../kernel/events/domain-event-bus.js';
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
  type LedgerEntryRecord,
} from '../../../../test/support/accounting-document-repositories.js';
import { uniqueViolation } from '../../../../test/support/in-memory-repositories.js';
import { UNPINNED_APP_CONFIG } from '../../../../test/support/app-config.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { AccountingDocumentPhaseConflictError } from '../data/accounting-document-errors.js';
import { LedgerEntriesRepository } from '../data/ledger-entries.repository.js';
import type { AccountingDocument } from '../domain/accounting-document.js';
import { ACCOUNTING_DOCUMENT_FINALIZED_EVENT } from '../domain/accounting.events.js';
import { parseDateOnly } from '../domain/date-range.js';
import type { LedgerEntry } from '../domain/ledger-entry.js';
import { checkPostingInput } from '../domain/posting.js';
import { buildRequestHash } from './accounting-document-support.js';
import { PostingReadinessService } from './posting-readiness.service.js';
import {
  assertPostedLedger,
  PostingService,
  type PostingOutcome,
} from './posting.service.js';

/**
 * The posting orchestration seam against the REAL service and the in-memory
 * repositories (Task 10.8, contract §15.5/§16.4/§19.2, ADR-0026).
 *
 * What this suite pins — and what it deliberately leaves to the suites that
 * already own it:
 *
 * - THE SEQUENCE. One `postVoucher` call performs the whole posting act: the
 *   state change, exactly one immutable entry per stored line, the
 *   `document_finalize` evidence row, ONE `AccountingDocument.Finalized` event
 *   — and nothing else mutates. The seam opens no transaction and takes no
 *   lock of its own: the atomic act is `finalizeChecked` (Task 10.7), called
 *   exactly once, so the module's fixed lock order cannot have changed here.
 * - IDEMPOTENCY, the only identity being `(organization, operationKey)` +
 *   `requestHash` on the existing `document_finalize` kind: same key + same
 *   hash replays (no second entry set, no second evidence row, no second
 *   event, no second finalization); same key + different hash is a 409 that
 *   mutates nothing. There is no second key scheme and no `PostingResult.id`.
 * - ROLLBACK, end to end through the seam: a failed ledger insert, a PARTIAL
 *   ledger insert, the 1:1 `voucher_line_id` backstop and a failed evidence
 *   insert each leave the voucher `temporary` with zero entries and zero
 *   evidence — no orphan finalized voucher, no partial ledger, no orphan key.
 * - CONCURRENCY on one operationKey: one committed posting, one entry set, one
 *   evidence row, one event.
 * - READINESS (Task 10.5) as the gate on the stored result, consulted through
 *   the real `PostingReadinessService` — never re-implemented here.
 * - LEDGER INTEGRITY (AC-07/AC-08) from STORED rows: one entry per line and
 *   every sourcing column equal to the voucher's; a stored entry that does not
 *   match its voucher cannot be reported as a posting result.
 * - IMMUTABILITY (AC-I-05/06): the ledger repository exposes no update, no
 *   delete and no upsert — structurally, by name.
 *
 * The pure contract (`domain/posting.spec.ts`), the readiness decision table
 * (`domain/posting-readiness.spec.ts`, `application/posting-readiness.spec.ts`)
 * and the real-database atomicity/locking behaviour
 * (`test/ledger-entries-live.e2e-spec.ts`, CI-only: no PostgreSQL in this
 * sandbox) keep their own coverage; nothing here re-tests them, and the HTTP
 * surface keeps its own (`test/accounting-documents.e2e-spec.ts`, whose
 * finalize journey now runs through this seam unchanged).
 */

const ORG_A = '01ORGANIZATIONA000000000AA';
const ORG_B = '01ORGANIZATIONB000000000BB';
const AREA = '01AREAAAAAAAAAAAAAAAAAAAA01';
const YEAR = '01YEARAAAAAAAAAAAAAAAAAAAA01';
const PERIOD = '01PERIODAAAAAAAAAAAAAAAAAAA01';
const DEBIT_ACCOUNT = '01ACCOUNTAAAAAAAAAAAAAAAAA01';
const CREDIT_ACCOUNT = '01ACCOUNTAAAAAAAAAAAAAAAAA02';
const LEGACY_ACCOUNT = '01ACCOUNTAAAAAAAAAAAAAAAAA03';
const CONFIGURATION = '01CONFIGAAAAAAAAAAAAAAAAAA01';
const LEGACY_CONFIGURATION = '01CONFIGAAAAAAAAAAAAAAAAAA02';

const DOCUMENT_DATE = parseDateOnly('2026-04-05') as Date;

function loggerStub(): JsonLogger {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
}

interface Fixture {
  posting: PostingService;
  readiness: PostingReadinessService;
  bus: DomainEventBus;
  accounting: AccountingStores;
  structure: StructureStores;
  vouchers: AccountingDocumentStores;
  /** Every `AccountingDocument.Finalized` event published during a test. */
  finalizedEvents: DomainEvent[];
}

function buildFixture(): Fixture {
  const rbacStores = createInMemoryStores();
  const masterStores = createMasterDataStores();
  const accounting = createAccountingStores();
  const structure = createStructureStores();
  const bus = new DomainEventBus();
  const finalizedEvents: DomainEvent[] = [];
  bus.on(ACCOUNTING_DOCUMENT_FINALIZED_EVENT, (event) => {
    finalizedEvents.push(event);
  });

  // Only the deployment pin guard is consulted (a no-op unpinned); the fixture
  // needs no organization rows because the fakes scope by the organization_id
  // stored on each row, exactly like the real queries.
  const organizations = new OrganizationsService(
    masterStores.organizations,
    masterStores.memberships,
    new AuthorizationService(
      rbacStores.userRoles,
      loggerStub(),
      licensingTestDouble(),
    ),
    loggerStub(),
    bus,
    UNPINNED_APP_CONFIG,
    licensingTestDouble(),
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

  const posting = new PostingService(
    vouchers.documents,
    vouchers.operations,
    vouchers.ledgerEntries,
    readiness,
    organizations,
    loggerStub(),
    bus,
  );

  return {
    posting,
    readiness,
    bus,
    accounting,
    structure,
    vouchers,
    finalizedEvents,
  };
}

/** Seed the calendar and the chart the posting transaction resolves against. */
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
  // The chart of the accepted model: every account pins ONE accounting
  // configuration (`accounts.accounting_configuration_id`, NOT NULL since
  // Task 11 D1/D3). Task 13's operational-freeze marker reads exactly that
  // pin at finalization, so the fixture carries it — including the
  // mixed-configuration shape the Task 11 backfill produces (older accounts
  // pinned to a superseded configuration, newer ones to the ACTIVE one), which
  // a voucher may legitimately straddle.
  const structureId = '01STRUCTAAAAAAAAAAAAAAAAA01';
  for (const [id, code, status] of [
    [CONFIGURATION, 'DEFAULT', 'ACTIVE'],
    [LEGACY_CONFIGURATION, 'LEGACY', 'SUPERSEDED'],
  ] as const) {
    fx.structure.raw.state.accountingConfigurations.seed({
      id,
      organizationId: ORG_A,
      code,
      name: `Config ${code}`,
      versionNumber: 1,
      status,
      effectiveFrom: null,
      operationallyUsedAt: null,
      codingStructureVersionId: structureId,
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
    });
  }
  for (const [id, code, title, configurationId] of [
    [DEBIT_ACCOUNT, '1000', 'Cash', CONFIGURATION],
    [CREDIT_ACCOUNT, '2000', 'Revenue', CONFIGURATION],
    [LEGACY_ACCOUNT, '2100', 'Legacy revenue', LEGACY_CONFIGURATION],
  ] as const) {
    fx.structure.raw.state.accounts.seed({
      id,
      organizationId: ORG_A,
      code,
      title,
      parentId: null,
      level: 1,
      codingStructureVersionId: structureId,
      accountingConfigurationId: configurationId,
      accountNature: 'DEBIT',
      accountType: 'BALANCE_SHEET',
      detailGroupId: null,
      isPostable: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
    });
  }
}

let serial = 0;

/**
 * Compose a PRE-FINAL voucher through the fake's guarded path — the shape the
 * posting seam acts on. Amounts are exact decimal strings (§13.1) and the
 * default `0.10` is deliberately a value a binary float cannot render as
 * written, so any float in the path shows up as a canonicalization mismatch
 * instead of passing silently.
 */
async function composeVoucher(
  fx: Fixture,
  phase: 'draft' | 'temporary' = 'temporary',
  overrides: {
    organizationId?: string;
    description?: string;
    debitAmount?: string;
    creditAmount?: string;
    /**
     * Task 13: the line set, when the default two lines of one configuration
     * are not the shape under test (e.g. a voucher straddling two
     * configurations). Amounts stay exact decimal strings (§13.1).
     */
    lines?: readonly {
      accountId: string;
      debitAmount: string;
      creditAmount: string;
    }[];
  } = {},
): Promise<AccountingDocument> {
  const now = new Date();
  const organizationId = overrides.organizationId ?? ORG_A;
  const documentId = generateId();
  serial += 1;
  const documentNumber = String(serial).padStart(4, '0');
  return fx.vouchers.documents.createChecked({
    id: documentId,
    organizationId,
    financialAreaId: AREA,
    documentDate: DOCUMENT_DATE,
    description: overrides.description ?? 'Opening entry',
    state: phase,
    origin: 'manual',
    branchId: null,
    source: null,
    documentNumber: phase === 'draft' ? null : documentNumber,
    correlationId: null,
    idempotencyReference: null,
    requestHash: null,
    lines:
      overrides.lines !== undefined
        ? overrides.lines.map((line, index) => ({
            id: generateId(),
            lineNo: index + 1,
            accountId: line.accountId,
            debitAmount: line.debitAmount,
            creditAmount: line.creditAmount,
            description: `Line ${index + 1}`,
            sourceLineReference: null,
          }))
        : [
            {
              id: generateId(),
              lineNo: 1,
              accountId: DEBIT_ACCOUNT,
              debitAmount: overrides.debitAmount ?? '0.10',
              creditAmount: '0',
              description: 'Cash in',
              sourceLineReference: null,
            },
            {
              id: generateId(),
              lineNo: 2,
              accountId: CREDIT_ACCOUNT,
              debitAmount: '0',
              creditAmount: overrides.creditAmount ?? '0.10',
              description: 'Revenue out',
              sourceLineReference: null,
            },
          ],
    ledger:
      phase === 'draft'
        ? null
        : {
            id: generateId(),
            organizationId,
            operationKey: `create-${documentId}`,
            operation: 'document_create',
            requestHash: 'create-hash',
            result: { documentId },
            createdAt: now,
            updatedAt: now,
            createdBy: null,
          },
    createdAt: now,
    createdBy: null,
  });
}

/** The canonical `document_finalize` hash of one voucher (§16.4). */
function finalizeHash(voucherId: string): string {
  return buildRequestHash('document_finalize', { documentId: voucherId });
}

/** Stored entries of one voucher, through the insert-only repository. */
function storedEntries(
  fx: Fixture,
  organizationId: string,
  voucherId: string,
): Promise<LedgerEntry[]> {
  return fx.vouchers.raw.ledgerEntries.findByVoucher(organizationId, voucherId);
}

/** The evidence rows of one operation key. */
function evidenceRows(fx: Fixture, operationKey: string) {
  return fx.vouchers.raw.state.operations.findMany(
    (row) => row.organizationId === ORG_A && row.operationKey === operationKey,
  );
}

/** Deep snapshots of every table the posting act can touch. */
function snapshotStores(fx: Fixture) {
  return {
    documents: fx.vouchers.raw.state.documents.snapshot(),
    lines: fx.vouchers.raw.state.lines.snapshot(),
    operations: fx.vouchers.raw.state.operations.snapshot(),
    ledgerEntries: fx.vouchers.raw.state.ledgerEntries.snapshot(),
    areas: fx.accounting.raw.state.areas.snapshot(),
    years: fx.accounting.raw.state.years.snapshot(),
    periods: fx.accounting.raw.state.periods.snapshot(),
    accounts: fx.structure.raw.state.accounts.snapshot(),
    // Task 13: the freeze marker lives here, so "mutated nothing" now also
    // proves no configuration was marked used by a refused or replayed call.
    configurations: fx.structure.raw.state.accountingConfigurations.snapshot(),
  };
}

/** A hand-written ledger row (the 1:1 backstop probe). */
function handWrittenEntry(input: {
  voucherId: string;
  voucherLineId: string;
  accountId: string;
}): LedgerEntryRecord {
  const now = new Date();
  return {
    id: generateId(),
    organizationId: ORG_A,
    financialAreaId: AREA,
    fiscalYearId: YEAR,
    accountingPeriodId: PERIOD,
    voucherId: input.voucherId,
    voucherNumber: '9999',
    voucherLineId: input.voucherLineId,
    lineNo: 1,
    accountId: input.accountId,
    debitAmount: '0.10',
    creditAmount: '0',
    description: null,
    documentDate: DOCUMENT_DATE,
    postingTimestamp: now,
    branchId: null,
    origin: 'manual',
    sourceModule: null,
    sourceEntityType: null,
    sourceEntityId: null,
    sourceOperation: null,
    correlationId: null,
    finalizedBy: null,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
  };
}

describe('PostingService (Task 10.8 seam)', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = buildFixture();
    seedScope(fixture);
    serial = 0;
  });

  // ---- 1. a valid posting --------------------------------------------------

  it('posts a temporary voucher: state, one entry per line, one evidence row, one event', async () => {
    const voucher = await composeVoucher(fixture);
    const operationKey = `post-${voucher.id}`;
    const before = snapshotStores(fixture);

    const outcome = await fixture.posting.postVoucher({
      organizationId: ORG_A,
      voucherId: voucher.id,
      operationKey,
    });

    expect(outcome.kind).toBe('posted');
    expect(outcome.document.phase).toBe('final');
    expect(outcome.document.finalizedAt).not.toBeNull();
    expect(
      fixture.vouchers.raw.state.documents.findById(voucher.id)?.state,
    ).toBe('final');

    // AC-07 — exactly one immutable entry per voucher line, in book order.
    const entries = await storedEntries(fixture, ORG_A, voucher.id);
    expect(entries).toHaveLength(voucher.lines.length);
    expect(entries.map((entry) => entry.lineNo)).toEqual([1, 2]);
    expect(entries.map((entry) => entry.voucherLineId)).toEqual(
      [...voucher.lines]
        .sort((left, right) => left.lineNo - right.lineNo)
        .map((line) => line.id),
    );

    // AC-02 — the result is the Task 10.6 contract, and the entries it carries
    // are the STORED ones (same identities), never regenerated.
    expect(checkPostingInput(outcome.input)).toEqual([]);
    expect(outcome.input.organizationId).toBe(ORG_A);
    expect(outcome.input.voucherId).toBe(voucher.id);
    expect(outcome.input.operationKey).toBe(operationKey);
    expect(outcome.input.requestHash).toBe(finalizeHash(voucher.id));
    expect(outcome.result.ledgerEntries.map((entry) => entry.id)).toEqual(
      entries.map((entry) => entry.id),
    );
    expect(outcome.result.postedAt.toISOString()).toBe(
      outcome.document.finalizedAt?.toISOString(),
    );
    // The corrected Task 10.6 contract: a posting is NOT a persisted entity,
    // so the result carries no `id` and never borrows the evidence row's.
    expect('id' in outcome.result).toBe(false);

    // AC-05/§16.4 — exactly one evidence row, of the existing kind, and it is
    // the ONLY idempotency mechanism: no second key scheme was invented.
    const rows = evidenceRows(fixture, operationKey);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.operation).toBe('document_finalize');
    expect(rows[0]?.requestHash).toBe(finalizeHash(voucher.id));
    // The ledger holds exactly the two keys this voucher's life spent: the
    // composition key and the posting key. No `ledger-post-${voucherId}`-style
    // second scheme was invented (AC-05, Task 10.6 correction).
    expect(
      allOperationKeys(fixture).filter((key) => key.includes(voucher.id)),
    ).toEqual([`create-${voucher.id}`, operationKey]);

    // §21 — `Finalized` IS the posting evidence: exactly one event, no
    // `Posted` event invented, and the payload is the module's one shape.
    expect(fixture.finalizedEvents).toHaveLength(1);
    expect(fixture.finalizedEvents[0]?.aggregateId).toBe(voucher.id);
    expect(fixture.finalizedEvents[0]?.payload).toMatchObject({
      id: voucher.id,
      organizationId: ORG_A,
      financialAreaId: AREA,
      state: 'final',
      origin: 'manual',
      documentNumber: outcome.document.documentNumber,
    });

    // The seam adds no effect of its own: only the document state, the ledger
    // entries and the evidence row changed — no line, no calendar row, no
    // account, no numbering side effect (AC-14: nothing else was touched).
    const after = snapshotStores(fixture);
    expect(after.lines).toEqual(before.lines);
    expect(after.areas).toEqual(before.areas);
    expect(after.years).toEqual(before.years);
    expect(after.periods).toEqual(before.periods);
    expect(after.accounts).toEqual(before.accounts);
    expect(after.ledgerEntries).toHaveLength(before.ledgerEntries.length + 2);
    expect(after.operations).toHaveLength(before.operations.length + 1);
  });

  it('keeps the ledger identity independent from the operation evidence identity', async () => {
    const voucher = await composeVoucher(fixture);
    const operationKey = `post-${voucher.id}`;
    const outcome = await fixture.posting.postVoucher({
      organizationId: ORG_A,
      voucherId: voucher.id,
      operationKey,
    });
    const evidenceId = evidenceRows(fixture, operationKey)[0]?.id;
    const lineIds = voucher.lines.map((line) => line.id);

    expect(evidenceId).toBeDefined();
    for (const entry of outcome.result.ledgerEntries) {
      // Own ULID: not the evidence row's id, not a voucher line's id, not the
      // voucher's id (Task 10.6 correction — no id conflation anywhere).
      expect(entry.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(entry.id).not.toBe(evidenceId);
      expect(lineIds).not.toContain(entry.id);
      expect(entry.id).not.toBe(voucher.id);
    }
    const ids = outcome.result.ledgerEntries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('persists money exactly: canonical decimal strings, never a float', async () => {
    // AC-09 — `0.10` is the canonicalization probe (the module renders exact
    // decimals without trailing zeros, §13.5) and `numeric(18,2)`'s largest
    // magnitude is the float probe: no JS number can hold it, so the stored
    // string proves the path never went through one (§13.1, AR-12).
    expect(String(Number('9999999999999999.99'))).toBe('10000000000000000');

    const small = await composeVoucher(fixture);
    const smallOutcome = await fixture.posting.postVoucher({
      organizationId: ORG_A,
      voucherId: small.id,
      operationKey: `post-${small.id}`,
    });
    const smallEntries = await storedEntries(fixture, ORG_A, small.id);
    expect(smallEntries.map((entry) => entry.debitAmount)).toEqual([
      '0.1',
      '0',
    ]);
    expect(smallEntries.map((entry) => entry.creditAmount)).toEqual([
      '0',
      '0.1',
    ]);
    expect(
      smallOutcome.result.ledgerEntries.map((entry) => entry.creditAmount),
    ).toEqual(['0', '0.1']);

    const large = await composeVoucher(fixture, 'temporary', {
      debitAmount: '9999999999999999.99',
      creditAmount: '9999999999999999.99',
    });
    await fixture.posting.postVoucher({
      organizationId: ORG_A,
      voucherId: large.id,
      operationKey: `post-${large.id}`,
    });
    const largeEntries = await storedEntries(fixture, ORG_A, large.id);
    expect(largeEntries.map((entry) => entry.debitAmount)).toEqual([
      '9999999999999999.99',
      '0',
    ]);
    expect(largeEntries.map((entry) => entry.creditAmount)).toEqual([
      '0',
      '9999999999999999.99',
    ]);
    for (const entry of [...smallEntries, ...largeEntries]) {
      expect(typeof entry.debitAmount).toBe('string');
      expect(typeof entry.creditAmount).toBe('string');
      expect(entry.debitAmount).not.toMatch(/e/i);
      expect(entry.creditAmount).not.toMatch(/e/i);
    }
  });

  // ---- 2. idempotency: replay and conflict ---------------------------------

  it('replays the same key with the same hash: no second entry set, evidence row, finalization or event', async () => {
    const voucher = await composeVoucher(fixture);
    const operationKey = `post-${voucher.id}`;
    const first = await fixture.posting.postVoucher({
      organizationId: ORG_A,
      voucherId: voucher.id,
      operationKey,
    });
    const entriesAfterFirst = await storedEntries(fixture, ORG_A, voucher.id);
    const evidenceAfterFirst = evidenceRows(fixture, operationKey);
    const finalizedAt = first.document.finalizedAt?.toISOString();
    const before = snapshotStores(fixture);

    const second = await fixture.posting.postVoucher({
      organizationId: ORG_A,
      voucherId: voucher.id,
      operationKey,
    });

    expect(second.kind).toBe('replayed');
    // The same posting, re-read from current rows: same entries, same ids,
    // same evidence row, same finalization instant.
    expect(second.result.ledgerEntries.map((entry) => entry.id)).toEqual(
      entriesAfterFirst.map((entry) => entry.id),
    );
    expect(second.result.postedAt.toISOString()).toBe(finalizedAt);
    expect(second.document.finalizedAt?.toISOString()).toBe(finalizedAt);
    expect(evidenceRows(fixture, operationKey)).toEqual(evidenceAfterFirst);
    // No second finalization: no second event, and NOTHING was written.
    expect(fixture.finalizedEvents).toHaveLength(1);
    expect(snapshotStores(fixture)).toEqual(before);
    expect(await storedEntries(fixture, ORG_A, voucher.id)).toHaveLength(2);
  });

  it('refuses the same key with a different hash: 409 and no financial mutation', async () => {
    const posted = await composeVoucher(fixture);
    const operationKey = `post-${posted.id}`;
    await fixture.posting.postVoucher({
      organizationId: ORG_A,
      voucherId: posted.id,
      operationKey,
    });
    // A DIFFERENT voucher reusing the key is a different intent: the hash
    // covers `{ documentId }`, so it differs and the reuse is refused.
    const other = await composeVoucher(fixture);
    const before = snapshotStores(fixture);
    await expect(
      fixture.posting.postVoucher({
        organizationId: ORG_A,
        voucherId: other.id,
        operationKey,
      }),
    ).rejects.toMatchObject({ code: 'Conflict' });

    // Nothing mutated: the other voucher is still temporary with no entries,
    // the posted one still has exactly its own set, and there is still ONE
    // evidence row for the key.
    expect(fixture.vouchers.raw.state.documents.findById(other.id)?.state).toBe(
      'temporary',
    );
    expect(await storedEntries(fixture, ORG_A, other.id)).toHaveLength(0);
    expect(await storedEntries(fixture, ORG_A, posted.id)).toHaveLength(2);
    expect(evidenceRows(fixture, operationKey)).toHaveLength(1);
    expect(fixture.finalizedEvents).toHaveLength(1);
    // (the only change since `before` is nothing at all)
    expect(snapshotStores(fixture)).toEqual(before);
  });

  it('refuses a key already used for another operation kind (409)', async () => {
    const voucher = await composeVoucher(fixture);
    // `create-<id>` is the composition key the fixture already spent.
    await expect(
      fixture.posting.postVoucher({
        organizationId: ORG_A,
        voucherId: voucher.id,
        operationKey: `create-${voucher.id}`,
      }),
    ).rejects.toMatchObject({ code: 'Conflict' });
    expect(
      fixture.vouchers.raw.state.documents.findById(voucher.id)?.state,
    ).toBe('temporary');
    expect(await storedEntries(fixture, ORG_A, voucher.id)).toHaveLength(0);
  });

  it('requires an operationKey and answers the uniform 404 across organizations', async () => {
    const voucher = await composeVoucher(fixture);
    await expect(
      fixture.posting.postVoucher({
        organizationId: ORG_A,
        voucherId: voucher.id,
        operationKey: '   ',
      }),
    ).rejects.toMatchObject({ code: 'BadRequest' });

    // A foreign voucher is indistinguishable from a missing one (AC-I-01/16),
    // and the ledger is never consulted for it.
    const before = snapshotStores(fixture);
    for (const organizationId of [ORG_B, ORG_A]) {
      const voucherId =
        organizationId === ORG_B ? voucher.id : '01J8ZQ9W7R6T5Y4U3I2O1P0ZZZ';
      // eslint-disable-next-line no-await-in-loop
      await expect(
        fixture.posting.postVoucher({
          organizationId,
          voucherId,
          operationKey: `post-${voucher.id}`,
        }),
      ).rejects.toMatchObject({
        code: 'EntityNotFound',
        details: { entity: 'AccountingDocument' },
      });
    }
    expect(snapshotStores(fixture)).toEqual(before);
    // Organization isolation of the evidence: ORG_B has no rows at all.
    expect(
      fixture.vouchers.raw.state.operations.findMany(
        (row) => row.organizationId === ORG_B,
      ),
    ).toHaveLength(0);
  });

  it('refuses what the lifecycle refuses, without touching the books', async () => {
    // A draft is not postable: the Foundation's decision table says so, and
    // readiness says the same thing (`document_not_final`) — the seam does not
    // re-implement either.
    const draft = await composeVoucher(fixture, 'draft');
    const before = snapshotStores(fixture);
    await expect(
      fixture.posting.postVoucher({
        organizationId: ORG_A,
        voucherId: draft.id,
        operationKey: `post-${draft.id}`,
      }),
    ).rejects.toMatchObject({
      code: 'BusinessRuleViolation',
      details: { problem: 'not_temporary' },
    });
    const verdict = await fixture.readiness.evaluateReadiness(ORG_A, draft.id);
    expect(verdict.reasons).toEqual([
      { problem: 'document_not_final', phase: 'draft' },
    ]);
    expect(snapshotStores(fixture)).toEqual(before);
    expect(fixture.finalizedEvents).toHaveLength(0);

    // A second posting under a FRESH key is refused too: one voucher is posted
    // at most once, and the refusal is not a replay.
    const posted = await composeVoucher(fixture);
    await fixture.posting.postVoucher({
      organizationId: ORG_A,
      voucherId: posted.id,
      operationKey: `post-${posted.id}`,
    });
    const after = snapshotStores(fixture);
    await expect(
      fixture.posting.postVoucher({
        organizationId: ORG_A,
        voucherId: posted.id,
        operationKey: `post-again-${posted.id}`,
      }),
    ).rejects.toMatchObject({
      code: 'BusinessRuleViolation',
      details: { problem: 'already_final' },
    });
    expect(snapshotStores(fixture)).toEqual(after);
    expect(await storedEntries(fixture, ORG_A, posted.id)).toHaveLength(2);
  });

  // ---- 3. readiness enforcement (Task 10.5) --------------------------------

  it('refuses to replay a posting whose stored voucher is no longer posting-ready', async () => {
    const voucher = await composeVoucher(fixture);
    const operationKey = `post-${voucher.id}`;
    await fixture.posting.postVoucher({
      organizationId: ORG_A,
      voucherId: voucher.id,
      operationKey,
    });
    expect(
      (await fixture.readiness.evaluateReadiness(ORG_A, voucher.id)).status,
    ).toBe('ready');

    // The one REACHABLE drift seam Task 10.5 documents: a fiscal year's dates
    // are editable while it is open, so a stored resolution can go stale. The
    // seam must not hand back a posting result the readiness contract refuses.
    fixture.accounting.raw.state.years.patch(YEAR, {
      startDate: parseDateOnly('2027-01-01') as Date,
      endDate: parseDateOnly('2027-12-31') as Date,
    });
    const before = snapshotStores(fixture);

    await expect(
      fixture.posting.postVoucher({
        organizationId: ORG_A,
        voucherId: voucher.id,
        operationKey,
      }),
    ).rejects.toMatchObject({
      code: 'BusinessRuleViolation',
      details: {
        problem: 'posting_not_ready',
        reasons: [{ problem: 'scope_unresolvable', scope: 'year' }],
      },
    });

    // The refusal mutated nothing: the voucher stays final with its entries
    // and its single evidence row (the books are not the seam's to undo).
    expect(snapshotStores(fixture)).toEqual(before);
    expect(
      fixture.vouchers.raw.state.documents.findById(voucher.id)?.state,
    ).toBe('final');
    expect(await storedEntries(fixture, ORG_A, voucher.id)).toHaveLength(2);
    expect(evidenceRows(fixture, operationKey)).toHaveLength(1);
    expect(fixture.finalizedEvents).toHaveLength(1);
  });

  // ---- 4. rollback (AC-10) -------------------------------------------------

  it('rolls the whole posting back when the ledger insert fails', async () => {
    const voucher = await composeVoucher(fixture);
    const operationKey = `post-${voucher.id}`;
    const table = fixture.vouchers.raw.state.ledgerEntries;
    const insert = table.insert.bind(table);
    table.insert = (): never => {
      throw uniqueViolation();
    };
    try {
      await expect(
        fixture.posting.postVoucher({
          organizationId: ORG_A,
          voucherId: voucher.id,
          operationKey,
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    } finally {
      table.insert = insert;
    }

    // No orphan finalized voucher, no partial ledger, no orphan evidence, no
    // event: the atomic act rolled back as one.
    expect(
      fixture.vouchers.raw.state.documents.findById(voucher.id)?.state,
    ).toBe('temporary');
    expect(await storedEntries(fixture, ORG_A, voucher.id)).toHaveLength(0);
    expect(evidenceRows(fixture, operationKey)).toHaveLength(0);
    expect(fixture.finalizedEvents).toHaveLength(0);
  });

  it('rolls the whole posting back when only part of the entry set could be written', async () => {
    const voucher = await composeVoucher(fixture);
    const operationKey = `post-${voucher.id}`;
    const table = fixture.vouchers.raw.state.ledgerEntries;
    const insert = table.insert.bind(table);
    let written = 0;
    table.insert = ((row: LedgerEntryRecord) => {
      written += 1;
      // The first entry lands, the second fails: a partial set is exactly what
      // the transaction must not leave observable.
      if (written > 1) throw uniqueViolation();
      return insert(row);
    }) as typeof table.insert;
    try {
      await expect(
        fixture.posting.postVoucher({
          organizationId: ORG_A,
          voucherId: voucher.id,
          operationKey,
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    } finally {
      table.insert = insert;
    }

    expect(written).toBe(2);
    expect(
      fixture.vouchers.raw.state.documents.findById(voucher.id)?.state,
    ).toBe('temporary');
    // The entry that DID insert was rolled back with the rest: zero entries.
    expect(await storedEntries(fixture, ORG_A, voucher.id)).toHaveLength(0);
    expect(fixture.vouchers.raw.state.ledgerEntries.snapshot()).toHaveLength(0);
    expect(evidenceRows(fixture, operationKey)).toHaveLength(0);
    expect(fixture.finalizedEvents).toHaveLength(0);
  });

  it('rolls the whole posting back on the 1:1 voucher_line_id backstop', async () => {
    const voucher = await composeVoucher(fixture);
    const operationKey = `post-${voucher.id}`;
    const [firstLine] = voucher.lines;
    if (firstLine === undefined) throw new Error('Fixture must carry lines.');
    // A hand-written entry already claims the line: `skipDuplicates` is
    // forbidden, so the collision must abort the posting loudly.
    fixture.vouchers.raw.state.ledgerEntries.seed(
      handWrittenEntry({
        voucherId: voucher.id,
        voucherLineId: firstLine.id,
        accountId: firstLine.accountId,
      }),
    );

    await expect(
      fixture.posting.postVoucher({
        organizationId: ORG_A,
        voucherId: voucher.id,
        operationKey,
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    expect(
      fixture.vouchers.raw.state.documents.findById(voucher.id)?.state,
    ).toBe('temporary');
    // Only the hand-written row exists — no partial entry set was left behind.
    expect(fixture.vouchers.raw.state.ledgerEntries.snapshot()).toHaveLength(1);
    expect(evidenceRows(fixture, operationKey)).toHaveLength(0);
    expect(fixture.finalizedEvents).toHaveLength(0);
  });

  it('rolls the whole posting back when the idempotency evidence insert fails', async () => {
    const voucher = await composeVoucher(fixture);
    const operationKey = `post-${voucher.id}`;
    const table = fixture.vouchers.raw.state.operations;
    const insert = table.insert.bind(table);
    table.insert = (): never => {
      throw uniqueViolation();
    };
    try {
      await expect(
        fixture.posting.postVoucher({
          organizationId: ORG_A,
          voucherId: voucher.id,
          operationKey,
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    } finally {
      table.insert = insert;
    }

    // The evidence row is written LAST, so its failure happens after the state
    // update and after the entries: nothing of the attempt may survive.
    expect(
      fixture.vouchers.raw.state.documents.findById(voucher.id)?.state,
    ).toBe('temporary');
    expect(await storedEntries(fixture, ORG_A, voucher.id)).toHaveLength(0);
    expect(evidenceRows(fixture, operationKey)).toHaveLength(0);
    expect(fixture.finalizedEvents).toHaveLength(0);
  });

  // ---- 5. concurrency (AC-11) ----------------------------------------------

  it('posts once under concurrent attempts with the same operationKey', async () => {
    const voucher = await composeVoucher(fixture);
    const operationKey = `post-${voucher.id}`;
    const attempt = (): Promise<PostingOutcome> =>
      fixture.posting.postVoucher({
        organizationId: ORG_A,
        voucherId: voucher.id,
        operationKey,
      });

    const results = await Promise.allSettled([attempt(), attempt()]);

    // ONE winner. The loser meets the phase guard under the document lock —
    // the data layer's own error, which the calling use case maps to 409
    // (`mapDocumentGuardError`); had it lost on the ledger key instead, the
    // seam's raced replay-or-reject would have answered with the winner's
    // posting. Neither answer is a second posting.
    const posted = results.filter(
      (result) =>
        result.status === 'fulfilled' && result.value.kind === 'posted',
    );
    const replayed = results.filter(
      (result) =>
        result.status === 'fulfilled' && result.value.kind === 'replayed',
    );
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(posted).toHaveLength(1);
    expect(replayed).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    const [loser] = rejected as [PromiseRejectedResult];
    expect(loser?.reason).toBeInstanceOf(AccountingDocumentPhaseConflictError);

    // Exactly one committed posting: one state change, one entry set, one
    // evidence row, one event — and nothing the loser left behind.
    expect(
      fixture.vouchers.raw.state.documents.findById(voucher.id)?.state,
    ).toBe('final');
    expect(evidenceRows(fixture, operationKey)).toHaveLength(1);
    expect(await storedEntries(fixture, ORG_A, voucher.id)).toHaveLength(2);
    expect(fixture.finalizedEvents).toHaveLength(1);
    const winner = posted[0];
    if (winner?.status !== 'fulfilled') throw new Error('Expected a winner.');
    expect(winner.value.result.ledgerEntries).toHaveLength(2);
    expect(winner.value.result.operationKey).toBe(operationKey);
    expect(winner.value.result.requestHash).toBe(finalizeHash(voucher.id));
  });

  // ---- 6. ledger integrity + immutability ----------------------------------

  it('verifies the stored sourcing snapshot against the voucher (AC-08)', async () => {
    const voucher = await composeVoucher(fixture);
    const outcome = await fixture.posting.postVoucher({
      organizationId: ORG_A,
      voucherId: voucher.id,
      operationKey: `post-${voucher.id}`,
    });
    const entries = await storedEntries(fixture, ORG_A, voucher.id);
    const lines = [...voucher.lines].sort(
      (left, right) => left.lineNo - right.lineNo,
    );

    // The pure assertion holds for the stored rows, column by column.
    expect(() => assertPostedLedger(outcome.document, entries)).not.toThrow();
    entries.forEach((entry, index) => {
      const line = lines[index];
      expect(entry.organizationId).toBe(voucher.organizationId);
      expect(entry.financialAreaId).toBe(voucher.financialAreaId);
      expect(entry.fiscalYearId).toBe(voucher.fiscalYearId);
      expect(entry.accountingPeriodId).toBe(voucher.accountingPeriodId);
      expect(entry.voucherId).toBe(voucher.id);
      expect(entry.voucherNumber).toBe(voucher.documentNumber);
      expect(entry.voucherLineId).toBe(line?.id);
      expect(entry.lineNo).toBe(line?.lineNo);
      expect(entry.accountId).toBe(line?.accountId);
      expect(entry.debitAmount).toBe(line?.debitAmount);
      expect(entry.creditAmount).toBe(line?.creditAmount);
      expect(entry.documentDate.toISOString()).toBe(
        voucher.documentDate.toISOString(),
      );
      // The finalization evidence is the outcome's (the pre-posting aggregate
      // carried none): the posting timestamp IS `finalizedAt` (§15.5, Class C3).
      expect(entry.postingTimestamp.toISOString()).toBe(
        outcome.document.finalizedAt?.toISOString(),
      );
      expect(entry.finalizedBy).toBe(outcome.document.finalizedBy);
      expect(entry.origin).toBe('manual');
      expect(entry.dimensionAssignments).toEqual([]);
    });

    // …and the seam refuses to report a posting whose stored evidence does not
    // match the voucher: the snapshot is verified, not assumed.
    const tampered: LedgerEntry[] = entries.map((entry, index) =>
      index === 0
        ? { ...entry, financialAreaId: AREA.slice(0, 25) + '9' }
        : entry,
    );
    expect(() => assertPostedLedger(outcome.document, tampered)).toThrow(
      /sourcing snapshot/,
    );
    const short = entries.slice(0, 1);
    expect(() => assertPostedLedger(outcome.document, short)).toThrow(
      /one entry|exactly one/i,
    );
  });

  it('refuses to report a replay whose stored entry drifted from its voucher line', async () => {
    const voucher = await composeVoucher(fixture);
    const operationKey = `post-${voucher.id}`;
    await fixture.posting.postVoucher({
      organizationId: ORG_A,
      voucherId: voucher.id,
      operationKey,
    });
    const entries = await storedEntries(fixture, ORG_A, voucher.id);
    const [first] = entries;
    if (first === undefined) throw new Error('Expected stored entries.');
    // A guard-bypassing tamper (no application path can write a ledger row):
    // the replay must fail loudly rather than report an entry that no longer
    // matches the voucher it claims to come from.
    fixture.vouchers.raw.state.ledgerEntries.patch(first.id, {
      debitAmount: '999',
    });

    await expect(
      fixture.posting.postVoucher({
        organizationId: ORG_A,
        voucherId: voucher.id,
        operationKey,
      }),
    ).rejects.toThrow(/sourcing snapshot/);

    // The failed report mutated nothing.
    expect(await storedEntries(fixture, ORG_A, voucher.id)).toHaveLength(2);
    expect(evidenceRows(fixture, operationKey)).toHaveLength(1);
    expect(fixture.finalizedEvents).toHaveLength(1);
  });

  it('exposes no ledger update, delete or upsert path (AC-I-05/06)', async () => {
    // Structural immutability, two ways. (1) The repository's whole surface is
    // a scoped read plus the private client accessor: no mutation verb exists
    // to call. (2) The transaction client cannot express one either —
    // `AccountingTxClient.ledgerEntry` is `Pick<LedgerEntryDelegate,
    // 'createMany'>` (`data/accounting-rows.ts`), so even a future writer
    // inside a transaction has only an insert (type-checked, not asserted
    // here). This seam adds neither.
    const surface = Object.getOwnPropertyNames(
      LedgerEntriesRepository.prototype,
    );
    // Task 17A added the second READ (`listMovements`, the movement source).
    // The surface is still reads only — the listing below is exhaustive on
    // purpose: a new verb must be reviewed here, not slip in.
    expect(surface.sort()).toEqual([
      'client',
      'constructor',
      'findByVoucher',
      'listMovements',
    ]);
    expect(
      surface.filter((name) => /update|delete|remove|upsert|patch/i.test(name)),
    ).toEqual([]);

    // And behaviourally: a posting and its replay only ever ADD entries, and
    // the stored rows of the first posting are byte-identical afterwards.
    const voucher = await composeVoucher(fixture);
    const operationKey = `post-${voucher.id}`;
    await fixture.posting.postVoucher({
      organizationId: ORG_A,
      voucherId: voucher.id,
      operationKey,
    });
    const posted = fixture.vouchers.raw.state.ledgerEntries.snapshot();
    await fixture.posting.postVoucher({
      organizationId: ORG_A,
      voucherId: voucher.id,
      operationKey,
    });
    expect(fixture.vouchers.raw.state.ledgerEntries.snapshot()).toEqual(posted);
  });

  // ---- 7. the seam delegates the atomic act --------------------------------

  it('delegates the atomic act: exactly one finalizeChecked call, no transaction of its own', async () => {
    // Structural proof of AC-04/AC-13, not just a call count: this fixture
    // hands the seam NO Prisma client and NO transactional client at all — the
    // fakes expose guarded methods, never `$transaction` or a lock helper. The
    // suite can therefore only pass if the seam opens no transaction of its
    // own and takes no lock: the single writer it can reach is
    // `finalizeChecked`, whose lock order (`data/accounting-locks.ts`: area →
    // year → period → accounts FOR SHARE → document FOR UPDATE) is Task 10.7's
    // and is not touched here.
    const voucher = await composeVoucher(fixture);
    const operationKey = `post-${voucher.id}`;
    const repository = fixture.vouchers.raw.documents;
    const finalizeChecked = repository.finalizeChecked.bind(repository);
    let calls = 0;
    repository.finalizeChecked = ((input) => {
      calls += 1;
      // The evidence row handed to the transaction is the existing kind, on
      // the existing key — the seam invented no second idempotency identity.
      expect(input.ledger.operation).toBe('document_finalize');
      expect(input.ledger.operationKey).toBe(operationKey);
      expect(input.ledger.requestHash).toBe(finalizeHash(voucher.id));
      expect(input.organizationId).toBe(ORG_A);
      return finalizeChecked(input);
    }) as typeof repository.finalizeChecked;

    try {
      await fixture.posting.postVoucher({
        organizationId: ORG_A,
        voucherId: voucher.id,
        operationKey,
      });
      // A replay must NOT run the transaction again.
      await fixture.posting.postVoucher({
        organizationId: ORG_A,
        voucherId: voucher.id,
        operationKey,
      });
    } finally {
      repository.finalizeChecked = finalizeChecked;
    }
    expect(calls).toBe(1);
  });

  // ---- 8. operational freeze — the usage marker (Task 13) ------------------
  //
  // The boundary Task 11 deferred to this seam's transaction: the FIRST use of
  // an accounting configuration is the posting that runs over it, and the mark
  // is written by `finalizeChecked` — never by this service, never by a caller
  // that only reads or drafts. The in-memory documents fake mirrors the real
  // transaction's atomicity (its `withRollback` now covers the configuration
  // rows), so what these tests pin is the BOUNDARY and its semantics; the
  // statement itself (guard, organization predicate, lock position) is
  // `data/accounting-configuration-usage.spec.ts`, and the real-PostgreSQL
  // behaviour is the Task 13 rehearsal + the live suite.

  /** The stored marker of one configuration (the fake table is the oracle). */
  function usageMarkOf(fx: Fixture, configurationId: string): unknown {
    return fx.structure.raw.state.accountingConfigurations.findById(
      configurationId,
    )?.operationallyUsedAt;
  }

  it('marks the configuration the posting used, with the finalization clock and actor', async () => {
    const voucher = await composeVoucher(fixture);
    expect(usageMarkOf(fixture, CONFIGURATION)).toBeNull();

    const outcome = await fixture.posting.postVoucher({
      organizationId: ORG_A,
      voucherId: voucher.id,
      operationKey: `post-${voucher.id}`,
    });

    expect(outcome.kind).toBe('posted');
    const marked =
      fixture.structure.raw.state.accountingConfigurations.findById(
        CONFIGURATION,
      );
    // First use, and the ONLY use recorded: the marker is a first-use instant,
    // not a counter, and its clock/actor are the finalization's own (no second
    // `new Date()`, no separate actor).
    expect(marked?.operationallyUsedAt).toBeInstanceOf(Date);
    expect(marked?.operationallyUsedAt?.toISOString()).toBe(
      outcome.document.finalizedAt?.toISOString(),
    );
    expect(marked?.updatedBy).toBe(outcome.document.finalizedBy);
    // The configuration the voucher did NOT touch stays untouched.
    expect(usageMarkOf(fixture, LEGACY_CONFIGURATION)).toBeNull();
  });

  it('marks nothing for a draft, and nothing for an issued-but-unposted voucher', async () => {
    // Draft: reading/drafting a configuration is authoring, not use (§3A).
    const draft = await composeVoucher(fixture, 'draft');
    expect(usageMarkOf(fixture, CONFIGURATION)).toBeNull();

    // Issued (draft → temporary): still no durable accounting effect, so still
    // no mark — the marker belongs to the ledger, not to the serial.
    await fixture.vouchers.documents.issueChecked({
      id: draft.id,
      organizationId: ORG_A,
      documentNumber: '0001',
      updatedAt: new Date(),
      updatedBy: null,
    });
    expect(fixture.vouchers.raw.state.documents.findById(draft.id)?.state).toBe(
      'temporary',
    );
    expect(usageMarkOf(fixture, CONFIGURATION)).toBeNull();
  });

  it('rolls the usage mark back when the posting does not commit', async () => {
    const voucher = await composeVoucher(fixture);
    const table = fixture.vouchers.raw.state.ledgerEntries;
    const insert = table.insert.bind(table);
    table.insert = (): never => {
      throw uniqueViolation();
    };
    try {
      await expect(
        fixture.posting.postVoucher({
          organizationId: ORG_A,
          voucherId: voucher.id,
          operationKey: `post-${voucher.id}`,
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    } finally {
      table.insert = insert;
    }

    // No false positive: the effect and its usage evidence are one atomic fact.
    expect(usageMarkOf(fixture, CONFIGURATION)).toBeNull();
    expect(
      fixture.vouchers.raw.state.documents.findById(voucher.id)?.state,
    ).toBe('temporary');
    expect(await storedEntries(fixture, ORG_A, voucher.id)).toHaveLength(0);
  });

  it('keeps the first-use timestamp across a replay and across a second posting', async () => {
    const first = await composeVoucher(fixture);
    const operationKey = `post-${first.id}`;
    await fixture.posting.postVoucher({
      organizationId: ORG_A,
      voucherId: first.id,
      operationKey,
    });
    const firstUse = usageMarkOf(fixture, CONFIGURATION);
    expect(firstUse).toBeInstanceOf(Date);

    // Replay of the same intent: the idempotency ledger answers before the
    // transaction is even opened, so the marker statement never runs twice.
    await fixture.posting.postVoucher({
      organizationId: ORG_A,
      voucherId: first.id,
      operationKey,
    });
    expect(usageMarkOf(fixture, CONFIGURATION)).toEqual(firstUse);

    // A DIFFERENT voucher over the same configuration is a second real use —
    // and still no new mark: first use wins, nothing appends, nothing moves.
    const second = await composeVoucher(fixture);
    await fixture.posting.postVoucher({
      organizationId: ORG_A,
      voucherId: second.id,
      operationKey: `post-${second.id}`,
    });
    expect(usageMarkOf(fixture, CONFIGURATION)).toEqual(firstUse);
    // Exactly one marker row per configuration — no duplicate usage evidence.
    expect(
      fixture.structure.raw.state.accountingConfigurations.findMany(
        (row) => row.operationallyUsedAt !== null,
      ),
    ).toHaveLength(1);
  });

  it('marks every configuration a mixed-configuration voucher posted over', async () => {
    // OQ-64's cardinality question, answered by the model: the configurations a
    // posting used are the pins of the accounts its lines reference — so a
    // voucher that straddles the ACTIVE and a SUPERSEDED configuration (the
    // shape the Task 11 backfill produces) marks BOTH, and freezes neither more
    // nor less than what it touched.
    const voucher = await composeVoucher(fixture, 'temporary', {
      lines: [
        { accountId: DEBIT_ACCOUNT, debitAmount: '0.10', creditAmount: '0' },
        { accountId: LEGACY_ACCOUNT, debitAmount: '0', creditAmount: '0.10' },
      ],
    });
    expect(usageMarkOf(fixture, CONFIGURATION)).toBeNull();
    expect(usageMarkOf(fixture, LEGACY_CONFIGURATION)).toBeNull();

    await fixture.posting.postVoucher({
      organizationId: ORG_A,
      voucherId: voucher.id,
      operationKey: `post-${voucher.id}`,
    });

    expect(usageMarkOf(fixture, CONFIGURATION)).toBeInstanceOf(Date);
    expect(usageMarkOf(fixture, LEGACY_CONFIGURATION)).toBeInstanceOf(Date);
  });

  it("fails closed when a posted line's account carries no configuration pin", async () => {
    const voucher = await composeVoucher(fixture);
    // The impossible state under Task 11 D1/D3 (the pin is NOT NULL): reached
    // here by degrading the fixture. The seam must refuse the whole posting
    // rather than record a partial or invented usage record.
    fixture.structure.raw.state.accounts.patch(DEBIT_ACCOUNT, {
      accountingConfigurationId: null,
    });

    await expect(
      fixture.posting.postVoucher({
        organizationId: ORG_A,
        voucherId: voucher.id,
        operationKey: `post-${voucher.id}`,
      }),
    ).rejects.toThrow(/account_pin_missing/);

    expect(usageMarkOf(fixture, CONFIGURATION)).toBeNull();
    expect(
      fixture.vouchers.raw.state.documents.findById(voucher.id)?.state,
    ).toBe('temporary');
    expect(await storedEntries(fixture, ORG_A, voucher.id)).toHaveLength(0);
    expect(fixture.finalizedEvents).toHaveLength(0);
  });

  it('publishes no second usage record: the marker rides the configuration row', async () => {
    const voucher = await composeVoucher(fixture);
    await fixture.posting.postVoucher({
      organizationId: ORG_A,
      voucherId: voucher.id,
      operationKey: `post-${voucher.id}`,
    });
    // Task 13 added no table and no event: usage lives in the one column, and
    // the durable effect (entries + evidence row) stays its explanation.
    expect(
      fixture.vouchers.raw.state.operations
        .snapshot()
        .filter(
          (row) =>
            row.operation !== 'document_finalize' &&
            row.operation !== 'document_create',
        ),
    ).toEqual([]);
    expect(
      fixture.structure.raw.state.accountingConfigurations.snapshot(),
    ).toHaveLength(2);
  });
});

// ---- helpers ---------------------------------------------------------------

/** Every operation key in the ledger (proves no second key scheme exists). */
function allOperationKeys(fx: Fixture): string[] {
  return fx.vouchers.raw.state.operations
    .snapshot()
    .map((row) => row.operationKey)
    .sort();
}
