/**
 * In-memory stand-ins for the accounting-document repositories (test support,
 * Task 10.4).
 *
 * Same purpose as the calendar/chart fakes: the e2e suite runs the FULL HTTP
 * stack — controllers, guards, real application services, the real permission
 * registry and its startup sync, the real Document Foundation numbering — with
 * no Postgres, no Docker and no Prisma codegen.
 *
 * What is faked and what is not:
 * - faked: `AccountingDocumentsRepository`, the line reader, the
 *   posting-operation ledger and (Task 10.7) the ledger-entry reader;
 * - NOT faked: authorization, organization/area/branch/account resolution,
 *   lifecycle planning, the Document Foundation's registry and allocation,
 *   composition rules, DTO validation.
 *
 * The fakes honour the contracts the real repositories guarantee:
 * - the guarded writes (`createChecked`, `updateChecked`, `issueChecked`,
 *   `finalizeChecked`, `deleteChecked`) mirror the real transactions'
 *   observable effect and throw the SAME plain errors from
 *   `accounting-document-errors.ts`, so ONE service mapping covers both paths;
 * - the database backstops are real here too: the `(organization, area,
 *   number)` unique index, the `(document, line_no)` unique index, the
 *   `(organization, operation_key)` ledger key and (Task 10.7) the
 *   `voucher_line_id` 1:1 backstop all throw the `P2002` the services fall
 *   back on;
 * - multi-step writes are atomic: `createChecked`/`finalizeChecked` snapshot
 *   the tables before mutating and restore on failure, so a thrown backstop
 *   leaves no partial header/lines/entries behind — the real transaction's
 *   rollback, mirrored (a lost key race must not leak a `final` row). Since
 *   Task 13 the atomic unit of `finalizeChecked` also covers the configuration
 *   rows its operational-freeze marker writes.
 *
 * Locking has no observable effect in a single-threaded fake: what matters is
 * that the guard evaluates against the committed rows and the write applies
 * atomically, which a synchronous fake gives for free. True lock contention is
 * covered by the live-database suite instead.
 */
import { generateId } from '../../src/kernel/ids/ulid.js';
import {
  businessDateFromDbDate,
  businessDateToDbDate,
  type BusinessDate,
} from '../../src/kernel/datetime/business-date.js';
import type { AccountingDocument } from '../../src/modules/accounting/domain/accounting-document.js';
import type { LedgerEntry } from '../../src/modules/accounting/domain/ledger-entry.js';
import { canonicalizeAmount } from '../../src/modules/accounting/domain/money.js';
import {
  toLedgerEntries,
  toPostingInput,
} from '../../src/modules/accounting/domain/posting.js';
import {
  checkVoucherLines,
  type AccountingDocumentLineInput,
} from '../../src/modules/accounting/domain/voucher-lines.js';
import {
  AccountingDocumentAccountRejectedError,
  AccountingDocumentAreaImmutableError,
  AccountingDocumentDateUnresolvableError,
  AccountingDocumentFinalProtectedError,
  AccountingDocumentLineRejectedError,
  AccountingDocumentMissingError,
  AccountingDocumentPhaseConflictError,
  AccountingDocumentScopeRejectedError,
  AccountingDocumentAlreadyReversedError,
} from '../../src/modules/accounting/data/accounting-document-errors.js';
import type {
  AccountingDocumentsRepository,
  CreateAccountingDocumentInput,
  DeleteAccountingDocumentInput,
  FinalizeAccountingDocumentInput,
  IssueAccountingDocumentInput,
  UpdateAccountingDocumentInput,
  ReverseAccountingDocumentInput,
} from '../../src/modules/accounting/data/accounting-documents.repository.js';
import {
  CORRECTION_KIND_REVERSAL,
  invertDocumentLines,
} from '../../src/modules/accounting/domain/document-reversal.js';
import { resolveUsedConfigurationIds } from '../../src/modules/accounting/domain/accounting-configuration-freeze.js';
import type { AccountingDocumentLinesRepository } from '../../src/modules/accounting/data/accounting-document-lines.repository.js';
import type { AccountingPostingOperationsRepository } from '../../src/modules/accounting/data/accounting-posting-operations.repository.js';
import type {
  LedgerEntriesRepository,
  LedgerMovementFilter,
} from '../../src/modules/accounting/data/ledger-entries.repository.js';
import type { OrderBy } from '../../src/modules/accounting/data/accounting-rows.js';
import { InMemoryTable, type Row } from './master-data-repositories.js';
import type { AccountingState } from './accounting-repositories.js';
import type { StructureState } from './accounting-structure-repositories.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface AccountingDocumentRecord extends Row {
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  documentType: string;
  documentNumber: string | null;
  documentDate: Date;
  description: string;
  state: string;
  origin: string;
  branchId: string | null;
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  sourceOperation: string | null;
  idempotencyReference: string | null;
  requestHash: string | null;
  finalizedAt: Date | null;
  finalizedBy: string | null;
  correctionKind: string | null;
  correctionReason: string | null;
  reversesDocumentId: string | null;
  reversedByDocumentId: string | null;
  correlationId: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface AccountingDocumentLineRecord extends Row {
  documentId: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  lineNo: number;
  accountId: string;
  /** Optional Detail item allocation (Task 30 — OD-29-03). */
  detailId: string | null;
  /** Canonical decimal strings (never floats, §13.1). */
  debitAmount: string;
  creditAmount: string;
  description: string | null;
  sourceLineReference: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface AccountingOperationRecord extends Row {
  organizationId: string;
  operationKey: string;
  operation: string;
  requestHash: string;
  result: unknown;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface LedgerEntryRecord extends Row {
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  voucherId: string;
  voucherNumber: string;
  voucherLineId: string;
  lineNo: number;
  accountId: string;
  /** Canonical decimal strings (never floats, §13.1). */
  debitAmount: string;
  creditAmount: string;
  description: string | null;
  documentDate: Date;
  postingTimestamp: Date;
  branchId: string | null;
  origin: string;
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  sourceOperation: string | null;
  correlationId: string | null;
  finalizedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface AccountingDocumentState {
  documents: InMemoryTable<AccountingDocumentRecord>;
  lines: InMemoryTable<AccountingDocumentLineRecord>;
  operations: InMemoryTable<AccountingOperationRecord>;
  ledgerEntries: InMemoryTable<LedgerEntryRecord>;
}

export function createAccountingDocumentState(): AccountingDocumentState {
  return {
    documents: new InMemoryTable<AccountingDocumentRecord>([
      // The database's backstops, mirrored so the services' unique-violation
      // fallbacks are exercised for real (ADR-0023 §3, contract §18/§16.4).
      ['organizationId', 'financialAreaId', 'documentNumber'],
      ['reversesDocumentId'],
      ['reversedByDocumentId'],
    ]),
    lines: new InMemoryTable<AccountingDocumentLineRecord>([
      ['documentId', 'lineNo'],
    ]),
    operations: new InMemoryTable<AccountingOperationRecord>([
      ['organizationId', 'operationKey'],
    ]),
    ledgerEntries: new InMemoryTable<LedgerEntryRecord>([
      // The 1:1 backstop (VoucherLine → LedgerEntry): a second entry for one
      // line is impossible to persist (Task 10.7).
      ['voucherLineId'],
    ]),
  };
}

/**
 * Run a multi-step fake write atomically: snapshot first, restore on failure.
 * The real repositories get this from the transaction; the fakes — which
 * mutate table by table — take it explicitly, so a thrown backstop (a
 * duplicate ledger key, a duplicate entry) leaves no partial write behind.
 *
 * `extraTables` extends the atomic unit to rows a write touches OUTSIDE the
 * document state — Task 13's operational-freeze marker lives on
 * `accounting_configurations`, and the real statement commits or rolls back
 * with the ledger entries, so the fake must too (otherwise a rolled-back
 * finalization would leave a false "used" configuration behind).
 */
function withRollback<T>(
  state: AccountingDocumentState,
  mutate: () => T,
  extraTables: readonly InMemoryTable<Row>[] = [],
): T {
  const snapshot = {
    documents: state.documents.snapshot(),
    lines: state.lines.snapshot(),
    operations: state.operations.snapshot(),
    ledgerEntries: state.ledgerEntries.snapshot(),
  };
  const extraSnapshot = extraTables.map((table) => table.snapshot());
  try {
    return mutate();
  } catch (error) {
    state.documents.restore(snapshot.documents);
    state.lines.restore(snapshot.lines);
    state.operations.restore(snapshot.operations);
    state.ledgerEntries.restore(snapshot.ledgerEntries);
    extraTables.forEach((table, index) => {
      table.restore(extraSnapshot[index] ?? []);
    });
    throw error;
  }
}

/**
 * Task 13 — the fake's mirror of `markConfigurationsUsedByDocumentInTx`:
 * resolve the configurations the posted lines used through the SAME domain
 * rule (`resolveUsedConfigurationIds`) and mark them first-use-wins,
 * organization-scoped, inside the caller's atomic block.
 */
function markConfigurationsUsedInMemory(
  structure: StructureState,
  input: {
    organizationId: string;
    accountIds: readonly string[];
    now: Date;
    actorId: string | null;
  },
): string[] {
  const pins = input.accountIds.map((accountId) => ({
    accountId,
    accountingConfigurationId:
      structure.accounts.findById(accountId)?.accountingConfigurationId ?? null,
  }));
  const marked: string[] = [];
  for (const configurationId of resolveUsedConfigurationIds({
    accountIds: input.accountIds,
    pins,
  })) {
    const row = structure.accountingConfigurations.findById(configurationId);
    // The guarded `WHERE organization_id = … AND operationally_used_at IS NULL`.
    if (row === null || row.organizationId !== input.organizationId) continue;
    if (row.operationallyUsedAt !== null) continue;
    structure.accountingConfigurations.patch(configurationId, {
      operationallyUsedAt: input.now,
      updatedAt: input.now,
      updatedBy: input.actorId,
    });
    marked.push(configurationId);
  }
  return marked;
}

interface ListParams {
  where: Record<string, unknown>;
  orderBy: Array<Record<string, 'asc' | 'desc'>>;
  skip: number;
  take: number;
}

function compareValues(left: unknown, right: unknown): number {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  return String(left ?? '').localeCompare(String(right ?? ''));
}

/**
 * Apply the repository's list FILTER (not a raw `where`): equality on the
 * simple fields, an inclusive date-only range on `documentDate`, and a
 * case-insensitive `contains` on the narration — the same translation the real
 * repository's `toWhere` performs.
 */
function matchesWhere(
  record: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean {
  for (const [key, expected] of Object.entries(where)) {
    if (expected === undefined) continue;
    if (key === 'dateFrom') {
      if (
        !(record.documentDate instanceof Date) ||
        record.documentDate < (expected as Date)
      ) {
        return false;
      }
      continue;
    }
    if (key === 'dateTo') {
      if (
        !(record.documentDate instanceof Date) ||
        record.documentDate > (expected as Date)
      ) {
        return false;
      }
      continue;
    }
    if (key === 'search') {
      if (
        !String(record.description ?? '')
          .toLowerCase()
          .includes(String(expected).toLowerCase())
      ) {
        return false;
      }
      continue;
    }
    if (record[key] !== expected) return false;
  }
  return true;
}

function listPage<TRow extends Row>(
  table: InMemoryTable<TRow>,
  params: ListParams,
): { items: TRow[]; total: number } {
  const filtered = table.findMany((row) =>
    matchesWhere(row as unknown as Record<string, unknown>, params.where),
  );
  const sorted = [...filtered];
  for (const entry of [...params.orderBy].reverse()) {
    const [field, direction] = Object.entries(entry)[0] ?? [];
    if (field === undefined) continue;
    sorted.sort((left, right) => {
      const order = compareValues(
        (left as unknown as Record<string, unknown>)[field],
        (right as unknown as Record<string, unknown>)[field],
      );
      return direction === 'desc' ? -order : order;
    });
  }
  return {
    items: sorted.slice(params.skip, params.skip + params.take),
    total: sorted.length,
  };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export class InMemoryAccountingDocumentsRepository {
  constructor(
    private readonly state: AccountingDocumentState,
    private readonly calendar: AccountingState,
    private readonly structure: StructureState,
  ) {}

  async findById(id: string): Promise<AccountingDocument | null> {
    const row = this.state.documents.findById(id);
    return row === null ? null : this.toDomain(row);
  }

  async findByNumber(
    organizationId: string,
    financialAreaId: string,
    documentNumber: string,
  ): Promise<AccountingDocument | null> {
    const row = this.state.documents.findOne(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.financialAreaId === financialAreaId &&
        candidate.documentNumber === documentNumber,
    );
    return row === null ? null : this.toDomain(row);
  }

  async list(params: {
    where: Record<string, unknown>;
    orderBy: Array<Record<string, 'asc' | 'desc'>>;
    skip: number;
    take: number;
  }): Promise<{ items: AccountingDocument[]; total: number }> {
    const { items, total } = listPage(this.state.documents, params);
    return { items: items.map((row) => this.toDomain(row)), total };
  }

  async createChecked(
    input: CreateAccountingDocumentInput,
  ): Promise<AccountingDocument> {
    assertCreatePhase(input.state, input.documentNumber);
    const scope = this.resolveOpenScope(
      input.organizationId,
      input.financialAreaId,
      input.documentDate,
    );
    this.assertUsableAccounts(
      input.organizationId,
      input.lines.map((line) => line.accountId),
    );
    assertComposition(input.lines);

    const now = input.createdAt;
    const row = withRollback(this.state, () => {
      const inserted = this.state.documents.insert({
        id: input.id,
        organizationId: input.organizationId,
        financialAreaId: input.financialAreaId,
        fiscalYearId: scope.yearId,
        accountingPeriodId: scope.periodId,
        documentType: 'accounting_voucher',
        documentNumber: input.documentNumber,
        documentDate: dbBusinessDate(input.documentDate),
        description: input.description,
        state: input.state,
        origin: input.origin,
        branchId: input.branchId,
        sourceModule: input.source?.module ?? null,
        sourceEntityType: input.source?.entityType ?? null,
        sourceEntityId: input.source?.entityId ?? null,
        sourceOperation: input.source?.operation ?? null,
        idempotencyReference: input.idempotencyReference,
        requestHash: input.requestHash,
        finalizedAt: null,
        finalizedBy: null,
        correctionKind: null,
        correctionReason: null,
        reversesDocumentId: null,
        reversedByDocumentId: null,
        correlationId: input.correlationId,
        createdAt: now,
        updatedAt: now,
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
      });
      this.writeLines(inserted, input.lines, input.createdBy, now);
      if (input.ledger !== null)
        this.state.operations.insert(input.ledger as AccountingOperationRecord);
      return inserted;
    });
    return this.toDomain(row);
  }

  async updateChecked(
    input: UpdateAccountingDocumentInput,
  ): Promise<AccountingDocument> {
    const scope = this.resolveScope(
      input.organizationId,
      input.financialAreaId,
      input.documentDate,
    );
    this.assertUsableAccounts(
      input.organizationId,
      input.lines.map((line) => line.accountId),
    );
    assertComposition(input.lines);

    const locked = this.requireDocument(input.id, input.organizationId);
    if (locked.state === 'final') {
      throw new AccountingDocumentFinalProtectedError('final');
    }
    if (
      input.financialAreaId !== locked.financialAreaId &&
      locked.state !== 'draft'
    ) {
      throw new AccountingDocumentAreaImmutableError();
    }
    const scopeChanged =
      scope.yearId !== locked.fiscalYearId ||
      scope.periodId !== locked.accountingPeriodId;
    if (scopeChanged) assertOpenScope(scope);

    const row = this.state.documents.patch(input.id, {
      financialAreaId: input.financialAreaId,
      fiscalYearId: scope.yearId,
      accountingPeriodId: scope.periodId,
      documentDate: dbBusinessDate(input.documentDate),
      description: input.description,
      branchId: input.branchId,
      updatedAt: input.updatedAt,
      updatedBy: input.updatedBy,
    });
    if (row === null) throw new AccountingDocumentMissingError();
    for (const line of this.state.lines.findMany(
      (candidate) => candidate.documentId === input.id,
    )) {
      this.state.lines.delete(line.id);
    }
    this.writeLines(row, input.lines, input.updatedBy, input.updatedAt);
    return this.toDomain(row);
  }

  async issueChecked(
    input: IssueAccountingDocumentInput,
  ): Promise<AccountingDocument> {
    const locked = this.requireDocument(input.id, input.organizationId);
    if (locked.state !== 'draft' || locked.documentNumber !== null) {
      throw new AccountingDocumentPhaseConflictError(
        toPhase(locked.state),
        'draft',
      );
    }
    const row = this.state.documents.patch(input.id, {
      state: 'temporary',
      documentNumber: input.documentNumber,
      updatedAt: input.updatedAt,
      updatedBy: input.updatedBy,
    });
    if (row === null) throw new AccountingDocumentMissingError();
    return this.toDomain(row);
  }

  async finalizeChecked(
    input: FinalizeAccountingDocumentInput,
  ): Promise<AccountingDocument> {
    const header = this.requireDocument(input.id, input.organizationId);
    const scope = this.resolveScope(
      input.organizationId,
      header.financialAreaId,
      businessDateFromDbDate(header.documentDate),
    );
    // Task 14 — the lifecycle gate refuses a closed/sealed period BEFORE
    // anything else happens, exactly like the real transaction's fail-fast
    // position (the real one has no locks to demonstrate; the fake proves the
    // refusal happens before the account check, the ledger write, the freeze
    // marker and the idempotency row).
    assertOpenScope(scope);
    this.assertUsableAccounts(
      input.organizationId,
      this.state.lines
        .findMany((candidate) => candidate.documentId === input.id)
        .map((line) => line.accountId),
    );

    const locked = this.requireDocument(input.id, input.organizationId);
    if (locked.state === 'final') {
      throw new AccountingDocumentPhaseConflictError('final', 'temporary');
    }
    if (locked.state !== 'temporary') {
      throw new AccountingDocumentPhaseConflictError(
        toPhase(locked.state),
        'temporary',
      );
    }
    if (
      scope.yearId !== locked.fiscalYearId ||
      scope.periodId !== locked.accountingPeriodId
    ) {
      throw new AccountingDocumentMissingError();
    }
    assertOpenScope(scope);
    const storedLines = this.state.lines.findMany(
      (candidate) => candidate.documentId === input.id,
    );
    assertComposition(
      storedLines.map((line) => ({
        lineNo: line.lineNo,
        accountId: line.accountId,
        debitAmount: line.debitAmount,
        creditAmount: line.creditAmount,
        description: line.description,
        sourceLineReference: line.sourceLineReference,
      })),
    );

    const row = withRollback(
      this.state,
      () => {
        const patched = this.state.documents.patch(input.id, {
          state: 'final',
          finalizedAt: input.finalizedAt,
          finalizedBy: input.finalizedBy,
          ...(locked.origin === 'system'
            ? {
                idempotencyReference: input.ledger.operationKey,
                requestHash: input.ledger.requestHash,
              }
            : {}),
          updatedAt: input.finalizedAt,
          updatedBy: input.finalizedBy,
        });
        if (patched === null) throw new AccountingDocumentMissingError();
        // Task 10.7 — the materialization, in the real transaction's position:
        // after the state update, before the idempotency row (which stays LAST,
        // the §16.4 evidence rule). Built through the posting contract, like the
        // real repository — never a second implementation — and rolled back with
        // everything else when a backstop throws.
        this.writeLedgerEntries(
          patched,
          input.ledger.operationKey,
          input.ledger.requestHash,
        );
        // Task 13 — the operational-freeze marker, in the SAME atomic block as
        // the ledger entries (the real one runs at the configuration position
        // of the lock order; a fake has no locks, only the atomicity that
        // matters here). A backstop thrown below therefore also rolls the
        // marker back — never a configuration left "used" by a finalization
        // that did not commit.
        markConfigurationsUsedInMemory(this.structure, {
          organizationId: input.organizationId,
          accountIds: [
            ...new Set(storedLines.map((line) => line.accountId)),
          ].sort(),
          now: input.finalizedAt,
          actorId: input.finalizedBy,
        });
        // The ledger row is written LAST, exactly like the real transaction, so
        // a lost key race aborts the whole write — never a `final` row without
        // its entries or its key.
        this.state.operations.insert(input.ledger as AccountingOperationRecord);
        return patched;
      },
      [this.structure.accountingConfigurations],
    );
    return this.toDomain(row);
  }

  async deleteChecked(
    input: DeleteAccountingDocumentInput,
  ): Promise<AccountingDocument> {
    const locked = this.requireDocument(input.id, input.organizationId);
    if (locked.state === 'final') {
      throw new AccountingDocumentFinalProtectedError('final');
    }
    const discarded = this.toDomain(locked);
    for (const line of this.state.lines.findMany(
      (candidate) => candidate.documentId === input.id,
    )) {
      this.state.lines.delete(line.id);
    }
    this.state.documents.delete(input.id);
    return discarded;
  }

  async reverseChecked(
    input: ReverseAccountingDocumentInput,
  ): Promise<AccountingDocument> {
    const original = this.requireDocument(
      input.originalDocumentId,
      input.organizationId,
    );
    if (original.state !== 'final') {
      throw new AccountingDocumentPhaseConflictError(
        toPhase(original.state),
        'final',
      );
    }
    if (original.reversedByDocumentId) {
      throw new AccountingDocumentAlreadyReversedError(original.id);
    }
    const scope = this.resolveOpenScope(
      input.organizationId,
      original.financialAreaId,
      input.documentDate,
    );
    const storedLines = this.state.lines.findMany(
      (candidate) => candidate.documentId === original.id,
    );
    this.assertUsableAccounts(
      input.organizationId,
      storedLines.map((line) => line.accountId),
    );
    const inverted = invertDocumentLines(
      storedLines.map((line) => ({
        id: line.id,
        documentId: line.documentId,
        lineNo: line.lineNo,
        accountId: line.accountId,
        debitAmount: line.debitAmount,
        creditAmount: line.creditAmount,
        description: line.description,
        sourceLineReference: line.sourceLineReference,
      })),
    );
    assertComposition(inverted);
    const now = input.finalizedAt;
    const row = withRollback(
      this.state,
      () => {
        const inserted = this.state.documents.insert({
          id: input.reversalId,
          organizationId: input.organizationId,
          financialAreaId: original.financialAreaId,
          fiscalYearId: scope.yearId,
          accountingPeriodId: scope.periodId,
          documentType: 'accounting_voucher',
          documentNumber: input.documentNumber,
          documentDate: dbBusinessDate(input.documentDate),
          description: input.description,
          state: 'final',
          origin: original.origin,
          branchId: original.branchId,
          sourceModule: original.sourceModule,
          sourceEntityType: original.sourceEntityType,
          sourceEntityId: original.sourceEntityId,
          sourceOperation: original.sourceOperation,
          idempotencyReference: input.ledger.operationKey,
          requestHash: input.ledger.requestHash,
          finalizedAt: now,
          finalizedBy: input.finalizedBy,
          correctionKind: CORRECTION_KIND_REVERSAL,
          correctionReason: input.reason,
          reversesDocumentId: original.id,
          reversedByDocumentId: null,
          correlationId: input.correlationId,
          createdAt: now,
          updatedAt: now,
          createdBy: input.createdBy,
          updatedBy: input.createdBy,
        });
        this.writeLines(
          inserted,
          inverted.map((line) => ({
            id: generateId(),
            lineNo: line.lineNo,
            accountId: line.accountId,
            debitAmount: line.debitAmount,
            creditAmount: line.creditAmount,
            description: line.description,
            sourceLineReference: line.sourceLineReference,
          })),
          input.createdBy,
          now,
        );
        this.state.documents.patch(original.id, {
          reversedByDocumentId: inserted.id,
          updatedAt: now,
          updatedBy: input.finalizedBy,
        });
        this.writeLedgerEntries(
          inserted,
          input.ledger.operationKey,
          input.ledger.requestHash,
        );
        markConfigurationsUsedInMemory(this.structure, {
          organizationId: input.organizationId,
          accountIds: [...new Set(storedLines.map((l) => l.accountId))].sort(),
          now,
          actorId: input.finalizedBy,
        });
        this.state.operations.insert(input.ledger as AccountingOperationRecord);
        return inserted;
      },
      [this.structure.accountingConfigurations],
    );
    return this.toDomain(row);
  }

  // ---- internals ---------------------------------------------------------

  private requireDocument(
    id: string,
    organizationId: string,
  ): AccountingDocumentRecord {
    const row = this.state.documents.findById(id);
    if (row === null || row.organizationId !== organizationId) {
      throw new AccountingDocumentMissingError();
    }
    return row;
  }

  private resolveScope(
    organizationId: string,
    financialAreaId: string,
    documentDate: BusinessDate,
  ): {
    yearId: string;
    periodId: string;
    yearStatus: string;
    periodStatus: string;
    yearActive: boolean;
  } {
    const area = this.calendar.areas.findById(financialAreaId);
    if (area === null || area.organizationId !== organizationId) {
      throw new AccountingDocumentScopeRejectedError('area', 'missing');
    }
    if (!area.isActive) {
      throw new AccountingDocumentScopeRejectedError('area', 'disabled');
    }
    const year = this.calendar.years.findOne(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.financialAreaId === financialAreaId &&
        candidate.startDate <= documentDate &&
        candidate.endDate >= documentDate,
    );
    if (year === null)
      throw new AccountingDocumentDateUnresolvableError(documentDate);
    const period = this.calendar.periods.findOne(
      (candidate) =>
        candidate.fiscalYearId === year.id &&
        candidate.startDate <= documentDate &&
        candidate.endDate >= documentDate,
    );
    if (period === null)
      throw new AccountingDocumentDateUnresolvableError(documentDate);
    return {
      yearId: year.id,
      periodId: period.id,
      yearStatus: year.status,
      periodStatus: period.status,
      yearActive: year.isActive,
    };
  }

  private resolveOpenScope(
    organizationId: string,
    financialAreaId: string,
    documentDate: BusinessDate,
  ): { yearId: string; periodId: string } {
    const scope = this.resolveScope(
      organizationId,
      financialAreaId,
      documentDate,
    );
    assertOpenScope(scope);
    return scope;
  }

  private assertUsableAccounts(
    organizationId: string,
    accountIds: readonly string[],
  ): void {
    for (const accountId of [...new Set(accountIds)].sort()) {
      const account = this.structure.accounts.findById(accountId);
      if (account === null || account.organizationId !== organizationId) {
        throw new AccountingDocumentAccountRejectedError(
          accountId,
          'account_not_found',
        );
      }
      if (!account.isPostable) {
        throw new AccountingDocumentAccountRejectedError(
          accountId,
          'account_not_postable',
        );
      }
      if (!account.isActive) {
        throw new AccountingDocumentAccountRejectedError(
          accountId,
          'account_disabled',
        );
      }
    }
  }

  private writeLines(
    document: AccountingDocumentRecord,
    lines: readonly {
      id: string;
      lineNo: number;
      accountId: string;
      detailId?: string | null | undefined;
      debitAmount: string;
      creditAmount: string;
      description: string | null;
      sourceLineReference: string | null;
    }[],
    actorId: string | null,
    now: Date,
  ): void {
    for (const line of lines) {
      this.state.lines.insert({
        id: line.id,
        documentId: document.id,
        organizationId: document.organizationId,
        financialAreaId: document.financialAreaId,
        fiscalYearId: document.fiscalYearId,
        accountingPeriodId: document.accountingPeriodId,
        lineNo: line.lineNo,
        accountId: line.accountId,
        detailId: line.detailId ?? null,
        debitAmount: canonicalizeAmount(line.debitAmount),
        creditAmount: canonicalizeAmount(line.creditAmount),
        description: line.description,
        sourceLineReference: line.sourceLineReference,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
      });
    }
  }

  /**
   * Materialize one ledger entry per stored line (Task 10.7) — the fake side
   * of `finalizeChecked`'s in-transaction materialization. The entries come
   * from `toPostingInput`/`toLedgerEntries`, exactly as in the real
   * repository: the preconditions (final-only, numbered, evidenced) and the
   * entry invariants + balance are re-asserted, and the `voucherLineId`
   * backstop throws `P2002` on a second entry for one line.
   */
  private writeLedgerEntries(
    document: AccountingDocumentRecord,
    operationKey: string,
    requestHash: string,
  ): void {
    const postingInput = toPostingInput({
      document: this.toDomain(document),
      operationKey,
      requestHash,
    });
    for (const entry of toLedgerEntries(postingInput, generateId)) {
      this.state.ledgerEntries.insert({
        id: entry.id,
        organizationId: entry.organizationId,
        financialAreaId: entry.financialAreaId,
        fiscalYearId: entry.fiscalYearId,
        accountingPeriodId: entry.accountingPeriodId,
        voucherId: entry.voucherId,
        voucherNumber: entry.voucherNumber,
        voucherLineId: entry.voucherLineId,
        lineNo: entry.lineNo,
        accountId: entry.accountId,
        debitAmount: canonicalizeAmount(entry.debitAmount),
        creditAmount: canonicalizeAmount(entry.creditAmount),
        description: entry.description,
        documentDate: dbBusinessDate(entry.documentDate),
        postingTimestamp: entry.postingTimestamp,
        branchId: entry.branchId,
        origin: entry.origin,
        sourceModule: entry.source?.module ?? null,
        sourceEntityType: entry.source?.entityType ?? null,
        sourceEntityId: entry.source?.entityId ?? null,
        sourceOperation: entry.source?.operation ?? null,
        correlationId: entry.correlationId,
        finalizedBy: entry.finalizedBy,
        createdAt: document.finalizedAt ?? document.updatedAt,
        updatedAt: document.finalizedAt ?? document.updatedAt,
        createdBy: document.finalizedBy,
      });
    }
  }

  private toDomain(row: AccountingDocumentRecord): AccountingDocument {
    const lines = this.state.lines
      .findMany((candidate) => candidate.documentId === row.id)
      .sort((left, right) => left.lineNo - right.lineNo)
      .map((line) => ({
        id: line.id,
        documentId: line.documentId,
        lineNo: line.lineNo,
        accountId: line.accountId,
        detailId: line.detailId ?? null,
        debitAmount: canonicalizeAmount(line.debitAmount),
        creditAmount: canonicalizeAmount(line.creditAmount),
        description: line.description,
        sourceLineReference: line.sourceLineReference,
      }));
    return {
      id: row.id,
      organizationId: row.organizationId,
      financialAreaId: row.financialAreaId,
      fiscalYearId: row.fiscalYearId,
      accountingPeriodId: row.accountingPeriodId,
      documentType: row.documentType,
      documentNumber: row.documentNumber,
      documentDate: businessDateFromDbDate(row.documentDate),
      description: row.description,
      phase: toPhase(row.state),
      origin: row.origin === 'system' ? 'system' : 'manual',
      branchId: row.branchId,
      source:
        row.sourceModule === null || row.sourceEntityType === null
          ? null
          : {
              module: row.sourceModule,
              entityType: row.sourceEntityType,
              entityId: row.sourceEntityId ?? '',
              operation: row.sourceOperation ?? '',
            },
      idempotencyReference: row.idempotencyReference,
      requestHash: row.requestHash,
      finalizedAt: row.finalizedAt,
      finalizedBy: row.finalizedBy,
      correctionKind: (row.correctionKind as 'reversal' | null) ?? null,
      correctionReason: row.correctionReason,
      reversesDocumentId: row.reversesDocumentId,
      reversedByDocumentId: row.reversedByDocumentId,
      correlationId: row.correlationId,
      lines,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// Lines + posting operations
// ---------------------------------------------------------------------------

export class InMemoryAccountingDocumentLinesRepository {
  constructor(private readonly state: AccountingDocumentState) {}

  async countForAccount(accountId: string): Promise<number> {
    return this.state.lines.findMany((line) => line.accountId === accountId)
      .length;
  }
}

export class InMemoryAccountingPostingOperationsRepository {
  constructor(private readonly state: AccountingDocumentState) {}

  async findByKey(
    organizationId: string,
    operationKey: string,
  ): Promise<{
    id: string;
    organizationId: string;
    operationKey: string;
    operation: string;
    requestHash: string;
    result: { documentId: string };
  } | null> {
    const row = this.state.operations.findOne(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.operationKey === operationKey,
    );
    if (row === null) return null;
    return {
      id: row.id,
      organizationId: row.organizationId,
      operationKey: row.operationKey,
      operation: row.operation,
      requestHash: row.requestHash,
      result: row.result as { documentId: string },
    };
  }
}

export class InMemoryLedgerEntriesRepository {
  constructor(private readonly state: AccountingDocumentState) {}

  async findByVoucher(
    organizationId: string,
    voucherId: string,
  ): Promise<LedgerEntry[]> {
    return this.state.ledgerEntries
      .findMany(
        (candidate) =>
          candidate.organizationId === organizationId &&
          candidate.voucherId === voucherId,
      )
      .sort((left, right) => left.lineNo - right.lineNo)
      .map(toLedgerEntry);
  }

  /**
   * The Task 17A movement read source, mirrored from
   * `LedgerEntriesRepository.listMovements`: same organization-first
   * predicate, same caller-supplied order, same skip/take, and a total counted
   * over the SAME filtered set (so a fake can never report a total the real
   * statement would not).
   */
  async listMovements(params: {
    filter: LedgerMovementFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: LedgerEntry[]; total: number }> {
    const matching = this.state.ledgerEntries
      .findMany((candidate) => matchesMovementFilter(candidate, params.filter))
      .sort((left, right) =>
        compareLedgerRowsByOrder(left, right, params.orderBy),
      );
    return {
      items: matching
        .slice(params.skip, params.skip + params.take)
        .map(toLedgerEntry),
      total: matching.length,
    };
  }
}

/** The stored predicate of `LedgerEntriesRepository.listMovements`. */
function matchesMovementFilter(
  row: LedgerEntryRecord,
  filter: LedgerMovementFilter,
): boolean {
  if (row.organizationId !== filter.organizationId) return false;
  if (
    filter.financialAreaId !== undefined &&
    row.financialAreaId !== filter.financialAreaId
  ) {
    return false;
  }
  if (
    filter.fiscalYearId !== undefined &&
    row.fiscalYearId !== filter.fiscalYearId
  ) {
    return false;
  }
  if (
    filter.accountingPeriodId !== undefined &&
    row.accountingPeriodId !== filter.accountingPeriodId
  ) {
    return false;
  }
  if (filter.accountId !== undefined && row.accountId !== filter.accountId) {
    return false;
  }
  if (filter.voucherId !== undefined && row.voucherId !== filter.voucherId) {
    return false;
  }
  if (
    filter.voucherNumber !== undefined &&
    row.voucherNumber !== filter.voucherNumber
  ) {
    return false;
  }
  const day = businessDateFromDbDate(row.documentDate);
  if (filter.dateFrom !== undefined && day < filter.dateFrom) return false;
  if (filter.dateTo !== undefined && day > filter.dateTo) return false;
  return true;
}

/** Apply an `OrderBy` list the way PostgreSQL would (dates by instant). */
function compareLedgerRowsByOrder(
  left: LedgerEntryRecord,
  right: LedgerEntryRecord,
  orderBy: OrderBy,
): number {
  for (const clause of orderBy) {
    const [field, direction] = Object.entries(clause)[0] as [
      string,
      'asc' | 'desc',
    ];
    const a = (left as unknown as Record<string, unknown>)[field];
    const b = (right as unknown as Record<string, unknown>)[field];
    const compared = compareMovementValues(a, b);
    if (compared !== 0) return direction === 'asc' ? compared : -compared;
  }
  return 0;
}

function compareMovementValues(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime();
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function toLedgerEntry(record: LedgerEntryRecord): LedgerEntry {
  if (record.origin !== 'manual' && record.origin !== 'system') {
    throw new Error(
      `Stored ledger entry "${record.id}" has an unknown origin "${record.origin}".`,
    );
  }
  return {
    id: record.id,
    organizationId: record.organizationId,
    financialAreaId: record.financialAreaId,
    fiscalYearId: record.fiscalYearId,
    accountingPeriodId: record.accountingPeriodId,
    voucherId: record.voucherId,
    voucherNumber: record.voucherNumber,
    voucherLineId: record.voucherLineId,
    lineNo: record.lineNo,
    accountId: record.accountId,
    debitAmount: canonicalizeAmount(record.debitAmount),
    creditAmount: canonicalizeAmount(record.creditAmount),
    description: record.description,
    documentDate: businessDateFromDbDate(record.documentDate),
    postingTimestamp: record.postingTimestamp,
    branchId: record.branchId,
    origin: record.origin,
    source:
      record.sourceModule === null || record.sourceEntityType === null
        ? null
        : {
            module: record.sourceModule,
            entityType: record.sourceEntityType,
            entityId: record.sourceEntityId ?? '',
            operation: record.sourceOperation ?? '',
          },
    correlationId: record.correlationId,
    finalizedBy: record.finalizedBy,
    dimensionAssignments: [],
  };
}

// ---------------------------------------------------------------------------
// Store bundle
// ---------------------------------------------------------------------------

export interface AccountingDocumentStores {
  /** Handles typed as the real repositories — safe for `overrideProvider`. */
  documents: AccountingDocumentsRepository;
  lines: AccountingDocumentLinesRepository;
  operations: AccountingPostingOperationsRepository;
  ledgerEntries: LedgerEntriesRepository;
  /** Concrete stores for assertions and direct manipulation. */
  raw: {
    documents: InMemoryAccountingDocumentsRepository;
    lines: InMemoryAccountingDocumentLinesRepository;
    operations: InMemoryAccountingPostingOperationsRepository;
    ledgerEntries: InMemoryLedgerEntriesRepository;
    state: AccountingDocumentState;
  };
}

/**
 * One coherent in-memory "database" for the voucher aggregate. The calendar and
 * chart states are INJECTED (not re-created): the guards read across aggregates
 * — a document resolves its year/period from the calendar and its accounts from
 * the chart — exactly as the real transaction does.
 */
export function createAccountingDocumentStores(input: {
  accounting: AccountingState;
  structure: StructureState;
}): AccountingDocumentStores {
  const state = createAccountingDocumentState();
  const documents = new InMemoryAccountingDocumentsRepository(
    state,
    input.accounting,
    input.structure,
  );
  const lines = new InMemoryAccountingDocumentLinesRepository(state);
  const operations = new InMemoryAccountingPostingOperationsRepository(state);
  const ledgerEntries = new InMemoryLedgerEntriesRepository(state);
  return {
    documents: documents as unknown as AccountingDocumentsRepository,
    lines: lines as unknown as AccountingDocumentLinesRepository,
    operations: operations as unknown as AccountingPostingOperationsRepository,
    ledgerEntries: ledgerEntries as unknown as LedgerEntriesRepository,
    raw: { documents, lines, operations, ledgerEntries, state },
  };
}

// ---------------------------------------------------------------------------
// Shared guard helpers (mirror the real module-local ones)
// ---------------------------------------------------------------------------

function assertCreatePhase(state: string, documentNumber: string | null): void {
  if (state === 'draft') {
    if (documentNumber !== null) {
      throw new Error(
        'A draft accounting document cannot carry a document number.',
      );
    }
    return;
  }
  if (state === 'temporary') {
    if (documentNumber === null) {
      throw new Error(
        'An issued accounting document must carry its allocated number.',
      );
    }
    return;
  }
  throw new Error(`An accounting document cannot be created as "${state}".`);
}

function assertComposition(
  lines: readonly AccountingDocumentLineInput[],
): void {
  const problems = checkVoucherLines(lines);
  if (problems.length > 0) {
    throw new AccountingDocumentLineRejectedError(problems);
  }
}

function assertOpenScope(scope: {
  yearStatus: string;
  periodStatus: string;
  yearActive: boolean;
}): void {
  if (scope.yearStatus !== 'open') {
    throw new AccountingDocumentScopeRejectedError('year', scope.yearStatus);
  }
  if (!scope.yearActive) {
    throw new AccountingDocumentScopeRejectedError('year', 'disabled');
  }
  if (scope.periodStatus !== 'open') {
    throw new AccountingDocumentScopeRejectedError(
      'period',
      scope.periodStatus,
    );
  }
}

function toPhase(state: string): 'draft' | 'temporary' | 'final' {
  if (state === 'draft' || state === 'temporary' || state === 'final') {
    return state;
  }
  throw new Error(`Accounting document has an unknown state "${state}".`);
}

function dbBusinessDate(value: BusinessDate): Date {
  const carrier = businessDateToDbDate(value);
  if (carrier === null) {
    throw new Error(`Invalid canonical Accounting BusinessDate "${value}".`);
  }
  return carrier;
}
