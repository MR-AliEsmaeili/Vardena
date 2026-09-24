/**
 * In-memory stand-in for `AccountStatementsRepository` (test support, Task 17B
 * Account Statement slice).
 *
 * Mirrors the real repository's reads exactly — same organization-first scope
 * predicates, the same FIXED statement order (`STATEMENT_ORDER`, imported so
 * the order cannot drift from production), the same skip/take paging, and
 * window aggregates computed over the SAME filtered set the rows come from
 * (so a fake can never report totals or an opening the real statement would
 * not). The five window reads arrive as one `readStatementLedgerFacts` call,
 * exactly like the real `REPEATABLE READ` transaction block.
 *
 * What is faked and what is not (the established e2e convention):
 * - faked: the scope row reads (accounts / areas / years / periods) and the
 *   ledger window reads — this class replaces the Prisma-backed repository;
 * - NOT faked: authorization, organization pin + usability, the scope-key
 *   error matrix (404/422), the opening/running/closing math (real
 *   `domain/account-statement.ts`), DTO validation and the HTTP pipeline.
 *
 * The states are INJECTED (not re-created): the statement reads across
 * aggregates — the calendar (years/periods), the chart (accounts) and the
 * immutable ledger — from one coherent in-memory "database", just as the real
 * transaction does.
 */
import type {
  AccountStatementLedgerFacts,
  StatementAccountRef,
  StatementAreaRef,
  StatementLedgerWhere,
  StatementPeriodRef,
  StatementYearRef,
} from '../../src/modules/accounting/data/account-statements.repository.js';
import { STATEMENT_ORDER } from '../../src/modules/accounting/data/account-statements.repository.js';
import type { AccountStatementsRepository } from '../../src/modules/accounting/data/account-statements.repository.js';
import type { LedgerEntry } from '../../src/modules/accounting/domain/ledger-entry.js';
import {
  canonicalizeAmount,
  sumAmounts,
} from '../../src/modules/accounting/domain/money.js';
import type { AccountingState } from './accounting-repositories.js';
import type { StructureState } from './accounting-structure-repositories.js';
import type {
  AccountingDocumentState,
  LedgerEntryRecord,
} from './accounting-document-repositories.js';

export class InMemoryAccountStatementsRepository {
  constructor(
    private readonly accounting: AccountingState,
    private readonly structure: StructureState,
    private readonly documents: AccountingDocumentState,
  ) {}

  async findAccount(
    organizationId: string,
    accountId: string,
  ): Promise<StatementAccountRef | null> {
    const row = this.structure.accounts.findOne(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.id === accountId,
    );
    return row === null
      ? null
      : {
          id: row.id,
          code: row.code,
          title: row.title,
          isPostable: row.isPostable,
          isActive: row.isActive,
        };
  }

  async findFinancialArea(
    organizationId: string,
    financialAreaId: string,
  ): Promise<StatementAreaRef | null> {
    const row = this.accounting.areas.findOne(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.id === financialAreaId,
    );
    return row === null
      ? null
      : { id: row.id, code: row.code, title: row.title };
  }

  async findFiscalYear(
    organizationId: string,
    fiscalYearId: string,
  ): Promise<StatementYearRef | null> {
    const row = this.accounting.years.findOne(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.id === fiscalYearId,
    );
    return row === null
      ? null
      : {
          id: row.id,
          financialAreaId: row.financialAreaId,
          code: row.code,
          title: row.title,
          startDate: row.startDate,
          endDate: row.endDate,
          status: row.status,
        };
  }

  async findPeriod(
    organizationId: string,
    accountingPeriodId: string,
  ): Promise<StatementPeriodRef | null> {
    const row = this.accounting.periods.findOne(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.id === accountingPeriodId,
    );
    return row === null ? null : toPeriodRef(row.sequence, row);
  }

  async listPeriodsOfYear(
    organizationId: string,
    fiscalYearId: string,
  ): Promise<StatementPeriodRef[]> {
    return this.accounting.periods
      .findMany(
        (candidate) =>
          candidate.organizationId === organizationId &&
          candidate.fiscalYearId === fiscalYearId,
      )
      .sort((left, right) => left.sequence - right.sequence)
      .map((row) => toPeriodRef(row.sequence, row));
  }

  /**
   * The one window read — five facts over the SAME predicate and the SAME
   * fixed order, computed together (the real repository wraps them in one
   * `REPEATABLE READ` transaction for exactly this consistency).
   */
  async readStatementLedgerFacts(
    params: {
      window: StatementLedgerWhere;
      priorPeriodIds: readonly string[];
    },
    skip: number,
    take: number,
  ): Promise<AccountStatementLedgerFacts> {
    const matching = this.documents.ledgerEntries
      .findMany((candidate) => matchesWindow(candidate, params.window))
      .sort(compareByStatementOrder);
    const prior =
      params.priorPeriodIds.length === 0
        ? []
        : this.documents.ledgerEntries.findMany(
            (candidate) =>
              candidate.organizationId === params.window.organizationId &&
              candidate.financialAreaId === params.window.financialAreaId &&
              candidate.fiscalYearId === params.window.fiscalYearId &&
              candidate.accountId === params.window.accountId &&
              params.priorPeriodIds.includes(candidate.accountingPeriodId),
          );
    return {
      total: matching.length,
      debitTotal: sumRows(matching, 'debitAmount'),
      creditTotal: sumRows(matching, 'creditAmount'),
      priorPeriodDebit: sumRows(prior, 'debitAmount'),
      priorPeriodCredit: sumRows(prior, 'creditAmount'),
      prePageAmounts: matching.slice(0, skip).map((row) => ({
        debitAmount: canonicalizeAmount(row.debitAmount),
        creditAmount: canonicalizeAmount(row.creditAmount),
      })),
      rows: matching.slice(skip, skip + take).map(toLedgerEntry),
    };
  }
}

/** The stored window predicate of `AccountStatementsRepository`. */
function matchesWindow(
  row: LedgerEntryRecord,
  window: StatementLedgerWhere,
): boolean {
  if (row.organizationId !== window.organizationId) return false;
  if (row.financialAreaId !== window.financialAreaId) return false;
  if (row.fiscalYearId !== window.fiscalYearId) return false;
  if (row.accountId !== window.accountId) return false;
  if (window.accountingPeriodId === undefined) return true;
  return typeof window.accountingPeriodId === 'string'
    ? row.accountingPeriodId === window.accountingPeriodId
    : window.accountingPeriodId.in.includes(row.accountingPeriodId);
}

/** Apply the FIXED statement order (`STATEMENT_ORDER`) the way SQL would. */
function compareByStatementOrder(
  left: LedgerEntryRecord,
  right: LedgerEntryRecord,
): number {
  for (const clause of STATEMENT_ORDER) {
    const [field, direction] = Object.entries(clause)[0] as [
      string,
      'asc' | 'desc',
    ];
    const a = (left as unknown as Record<string, unknown>)[field];
    const b = (right as unknown as Record<string, unknown>)[field];
    const compared = compareValues(a, b);
    if (compared !== 0) return direction === 'asc' ? compared : -compared;
  }
  return 0;
}

function compareValues(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** `SUM` over zero rows is `0` — exact decimal strings, never floats. */
function sumRows(
  rows: readonly LedgerEntryRecord[],
  column: 'debitAmount' | 'creditAmount',
): string {
  return rows.length === 0
    ? '0'
    : sumAmounts(rows.map((row) => canonicalizeAmount(row[column])));
}

function toPeriodRef(
  sequence: number,
  row: {
    id: string;
    title: string;
    startDate: Date;
    endDate: Date;
    status: string;
  },
): StatementPeriodRef {
  return {
    id: row.id,
    sequence,
    title: row.title,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
  };
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
    documentDate: record.documentDate,
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

export interface AccountStatementStores {
  /** Handle typed as the real repository — safe for `overrideProvider`. */
  statements: AccountStatementsRepository;
  /** Concrete store for assertions and direct manipulation. */
  raw: InMemoryAccountStatementsRepository;
}

/** One coherent in-memory statement reader over the shared states. */
export function createAccountStatementStores(input: {
  accounting: AccountingState;
  structure: StructureState;
  documents: AccountingDocumentState;
}): AccountStatementStores {
  const raw = new InMemoryAccountStatementsRepository(
    input.accounting,
    input.structure,
    input.documents,
  );
  return {
    statements: raw as unknown as AccountStatementsRepository,
    raw,
  };
}
