import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isAccountingDocumentOrigin } from '../domain/accounting-document.js';
import { canonicalizeAmount } from '../domain/money.js';
import type { LedgerEntry } from '../domain/ledger-entry.js';
import type {
  AccountingTxClient,
  LedgerEntryCreate,
  LedgerEntryRow,
  LedgerEntryWhere,
  OrderBy,
} from './accounting-rows.js';

/**
 * Data access for `accounting.ledger_entries` — the immutable posted evidence
 * (Task 10.7, contract §12/§13/§15/§19, AC-I-05/06/07/08/14/19/22).
 *
 * Rows are insert-only and are written ONLY inside the finalization
 * transaction owned by `AccountingDocumentsRepository.finalizeChecked` (via
 * `insertLedgerEntries`): the state change, the N ledger rows (N = stored
 * lines, ≥ 2) and the `accounting_posting_operations` evidence row commit
 * together or not at all. There is deliberately no update method, no delete
 * method and no unscoped read — corrections are future counter-documents with
 * NEW entries (AC-D-22), and every read leads with the organization scope
 * (AC-I-01).
 *
 * Task 17A adds the second reader: `listMovements` — the Accounting-owned,
 * read-only movement source future reports (account ledger, general/
 * subsidiary ledger, account movements, trial-balance inputs) consume. It adds
 * NO write path, no projection, no second truth and no derived column: a
 * movement IS a ledger entry, so the source cannot disagree with the ledger it
 * reads. The reporting-shaped mapping lives in `domain/ledger-movement.ts`.
 *
 * The entry identity is the row's own ULID (`id`), never reused and never
 * derived from a mutable business field. It is NOT
 * `accounting_posting_operations.id`: that ledger is idempotency/evidence
 * infrastructure, not the ledger identity and not a Posting entity (Task 10.6
 * correction). Traceability rides on the stored snapshot — `voucher_id` +
 * `voucher_line_id` (the 1:1 key) + `line_no`, the number, the scope and the
 * account — so an entry never needs to re-read mutable state.
 */

type Client = {
  ledgerEntry: {
    findMany(args: {
      where: LedgerEntryWhere;
      orderBy: OrderBy;
      skip?: number;
      take?: number;
    }): Promise<LedgerEntryRow[]>;
    count(args: { where: LedgerEntryWhere }): Promise<number>;
  };
};

/**
 * The movement read source's filter set (Task 17A). Every field is optional
 * EXCEPT the organization — the tenant predicate is not a filter a caller can
 * omit (AC-I-01). Bounds are inclusive, date-only (`DATE` semantics, §12.3).
 */
export interface LedgerMovementFilter {
  organizationId: string;
  financialAreaId?: string | undefined;
  fiscalYearId?: string | undefined;
  accountingPeriodId?: string | undefined;
  accountId?: string | undefined;
  voucherId?: string | undefined;
  voucherNumber?: string | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
}

@Injectable()
export class LedgerEntriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  /**
   * One voucher's posted entries in legal-book order (`line_no` ascending).
   * Always scoped: a voucher id from another organization answers empty
   * (AC-I-01).
   */
  async findByVoucher(
    organizationId: string,
    voucherId: string,
  ): Promise<LedgerEntry[]> {
    const { ledgerEntry } = await this.client();
    const rows = await ledgerEntry.findMany({
      where: { organizationId, voucherId },
      orderBy: [{ lineNo: 'asc' }],
    });
    return rows.map(toDomain);
  }

  /**
   * The Task 17A read source: one page of posted ledger movements plus the
   * matching total, both computed over the SAME predicate.
   *
   * Three deliberate properties:
   * - **Organization scope is structural.** `filter.organizationId` is
   *   required by the type and is the first predicate of every statement, so
   *   no call shape can read across organizations — a foreign area/year/
   *   period/account/voucher id simply matches nothing.
   * - **The order is the caller's resolved order.** The repository applies the
   *   whitelisted `orderBy` it is given and never invents one; the service owns
   *   the allow-list and appends the stable tie-breakers, so every page comes
   *   from a total order.
   * - **No relations are loaded.** The movement row is the ledger row itself
   *   (no joins, hence no N+1 and no duplicated row from a join fan-out), and
   *   the amounts are mapped to decimal STRINGS — never to JS numbers
   *   (§13.1/§13.5, AC-I-07).
   *
   * The ledger is insert-only, so this is a pure read: it writes nothing, and
   * the class exposes no update/delete for accounting to mutate through.
   */
  async listMovements(params: {
    filter: LedgerMovementFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: LedgerEntry[]; total: number }> {
    const { ledgerEntry } = await this.client();
    const where = toMovementWhere(params.filter);
    const [rows, total] = await Promise.all([
      ledgerEntry.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      ledgerEntry.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }
}

/**
 * Translate the movement filter into the stored predicate. Nothing is
 * interpolated into SQL — these are Prisma `where` values, bound as
 * parameters by the driver — and the organization predicate is unconditional.
 */
function toMovementWhere(filter: LedgerMovementFilter): LedgerEntryWhere {
  const where: LedgerEntryWhere = { organizationId: filter.organizationId };
  if (filter.financialAreaId !== undefined) {
    where.financialAreaId = filter.financialAreaId;
  }
  if (filter.fiscalYearId !== undefined) {
    where.fiscalYearId = filter.fiscalYearId;
  }
  if (filter.accountingPeriodId !== undefined) {
    where.accountingPeriodId = filter.accountingPeriodId;
  }
  if (filter.accountId !== undefined) {
    where.accountId = filter.accountId;
  }
  if (filter.voucherId !== undefined) {
    where.voucherId = filter.voucherId;
  }
  if (filter.voucherNumber !== undefined) {
    where.voucherNumber = filter.voucherNumber;
  }
  if (filter.dateFrom !== undefined || filter.dateTo !== undefined) {
    const documentDate: { gte?: Date; lte?: Date } = {};
    if (filter.dateFrom !== undefined) documentDate.gte = filter.dateFrom;
    if (filter.dateTo !== undefined) documentDate.lte = filter.dateTo;
    where.documentDate = documentDate;
  }
  return where;
}

/**
 * Insert the N materialized entries inside the finalization transaction —
 * AFTER the state update (the snapshot they carry is the final one) and
 * BEFORE the idempotency row, which stays the LAST statement (§16.4): a lost
 * key race aborts the whole transaction, so a `final` document can never exist
 * without its entries and a retry can never post twice.
 *
 * A plain `createMany`: `skipDuplicates` is forbidden here — a second entry
 * for one voucher line (`uq_ledger_entries_voucher_line_id`) must abort the
 * finalization loudly, never vanish silently.
 */
export async function insertLedgerEntries(
  tx: AccountingTxClient,
  creates: readonly LedgerEntryCreate[],
): Promise<void> {
  if (creates.length === 0) {
    throw new Error('Cannot materialize an empty ledger entry set.');
  }
  const { count } = await tx.ledgerEntry.createMany({ data: [...creates] });
  if (count !== creates.length) {
    throw new Error(
      `Ledger materialization wrote ${count} of ${creates.length} entries.`,
    );
  }
}

function toDomain(row: LedgerEntryRow): LedgerEntry {
  if (!isAccountingDocumentOrigin(row.origin)) {
    throw new Error(
      `Stored ledger entry "${row.id}" has an unknown origin "${row.origin}".`,
    );
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    financialAreaId: row.financialAreaId,
    fiscalYearId: row.fiscalYearId,
    accountingPeriodId: row.accountingPeriodId,
    voucherId: row.voucherId,
    voucherNumber: row.voucherNumber,
    voucherLineId: row.voucherLineId,
    lineNo: row.lineNo,
    accountId: row.accountId,
    debitAmount: canonicalizeAmount(toAmountString(row.debitAmount)),
    creditAmount: canonicalizeAmount(toAmountString(row.creditAmount)),
    description: row.description,
    documentDate: row.documentDate,
    postingTimestamp: row.postingTimestamp,
    branchId: row.branchId,
    origin: row.origin,
    source:
      row.sourceModule === null || row.sourceEntityType === null
        ? null
        : {
            module: row.sourceModule,
            entityType: row.sourceEntityType,
            entityId: row.sourceEntityId ?? '',
            operation: row.sourceOperation ?? '',
          },
    correlationId: row.correlationId,
    finalizedBy: row.finalizedBy,
    // OQ-41 is unresolved: no dimension model exists, so a stored entry
    // carries none (contract §10.6 — no fixed columns, no EAV, no JSONB).
    dimensionAssignments: [],
  };
}

/**
 * Map a stored `numeric(18,2)` to the domain's decimal string — the narrowest
 * safe mapping (review pass, Task 10.7): Prisma returns a `Decimal` object
 * with an exact `toString()` in production, and the in-memory fakes store
 * canonical strings. Anything else — especially a JS `number`, whose binary
 * float semantics the contract forbids (§13.1/§13.5) — is refused loudly
 * rather than stringified, because `String(0.1 + 0.2)` is float loss wearing
 * a decimal costume. A malformed string still fails downstream in
 * `canonicalizeAmount`, so no silent value can reach the domain.
 */
function toAmountString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toString?: unknown }).toString === 'function'
  ) {
    return (value as { toString(): string }).toString();
  }
  throw new Error(
    `Cannot map a ledger amount of type "${typeof value}" to a decimal string without float semantics.`,
  );
}
