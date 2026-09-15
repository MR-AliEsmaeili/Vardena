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
 * - faked: `AccountingDocumentsRepository`, the line reader and the
 *   posting-operation ledger;
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
 *   number)` unique index, the `(document, line_no)` unique index and the
 *   `(organization, operation_key)` ledger key all throw the `P2002` the
 *   services fall back on.
 *
 * Locking has no observable effect in a single-threaded fake: what matters is
 * that the guard evaluates against the committed rows and the write applies
 * atomically, which a synchronous fake gives for free. True lock contention is
 * covered by the live-database suite instead.
 */
import type { AccountingDocument } from '../../src/modules/accounting/domain/accounting-document.js';
import { canonicalizeAmount } from '../../src/modules/accounting/domain/money.js';
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
} from '../../src/modules/accounting/data/accounting-document-errors.js';
import type {
  AccountingDocumentsRepository,
  CreateAccountingDocumentInput,
  DeleteAccountingDocumentInput,
  FinalizeAccountingDocumentInput,
  IssueAccountingDocumentInput,
  UpdateAccountingDocumentInput,
} from '../../src/modules/accounting/data/accounting-documents.repository.js';
import type { AccountingDocumentLinesRepository } from '../../src/modules/accounting/data/accounting-document-lines.repository.js';
import type { AccountingPostingOperationsRepository } from '../../src/modules/accounting/data/accounting-posting-operations.repository.js';
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

export interface AccountingDocumentState {
  documents: InMemoryTable<AccountingDocumentRecord>;
  lines: InMemoryTable<AccountingDocumentLineRecord>;
  operations: InMemoryTable<AccountingOperationRecord>;
}

export function createAccountingDocumentState(): AccountingDocumentState {
  return {
    documents: new InMemoryTable<AccountingDocumentRecord>([
      // The database's backstops, mirrored so the services' unique-violation
      // fallbacks are exercised for real (ADR-0023 §3, contract §18/§16.4).
      ['organizationId', 'financialAreaId', 'documentNumber'],
    ]),
    lines: new InMemoryTable<AccountingDocumentLineRecord>([
      ['documentId', 'lineNo'],
    ]),
    operations: new InMemoryTable<AccountingOperationRecord>([
      ['organizationId', 'operationKey'],
    ]),
  };
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
    const row = this.state.documents.insert({
      id: input.id,
      organizationId: input.organizationId,
      financialAreaId: input.financialAreaId,
      fiscalYearId: scope.yearId,
      accountingPeriodId: scope.periodId,
      documentType: 'accounting_voucher',
      documentNumber: input.documentNumber,
      documentDate: input.documentDate,
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
      correlationId: input.correlationId,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
    });
    this.writeLines(row, input.lines, input.createdBy, now);
    if (input.ledger !== null)
      this.state.operations.insert(input.ledger as AccountingOperationRecord);
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
      documentDate: input.documentDate,
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
      header.documentDate,
    );
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

    const row = this.state.documents.patch(input.id, {
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
    if (row === null) throw new AccountingDocumentMissingError();
    // The ledger row is written LAST, exactly like the real transaction, so a
    // lost key race aborts before the state change is observable.
    this.state.operations.insert(input.ledger as AccountingOperationRecord);
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
    documentDate: Date,
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
    documentDate: Date,
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

  private toDomain(row: AccountingDocumentRecord): AccountingDocument {
    const lines = this.state.lines
      .findMany((candidate) => candidate.documentId === row.id)
      .sort((left, right) => left.lineNo - right.lineNo)
      .map((line) => ({
        id: line.id,
        documentId: line.documentId,
        lineNo: line.lineNo,
        accountId: line.accountId,
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
      documentDate: row.documentDate,
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

// ---------------------------------------------------------------------------
// Store bundle
// ---------------------------------------------------------------------------

export interface AccountingDocumentStores {
  /** Handles typed as the real repositories — safe for `overrideProvider`. */
  documents: AccountingDocumentsRepository;
  lines: AccountingDocumentLinesRepository;
  operations: AccountingPostingOperationsRepository;
  /** Concrete stores for assertions and direct manipulation. */
  raw: {
    documents: InMemoryAccountingDocumentsRepository;
    lines: InMemoryAccountingDocumentLinesRepository;
    operations: InMemoryAccountingPostingOperationsRepository;
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
  return {
    documents: documents as unknown as AccountingDocumentsRepository,
    lines: lines as unknown as AccountingDocumentLinesRepository,
    operations: operations as unknown as AccountingPostingOperationsRepository,
    raw: { documents, lines, operations, state },
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
