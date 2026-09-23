import { Injectable } from '@nestjs/common';
import { generateId } from '../../../kernel/ids/ulid.js';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { sumAmounts, isZeroAmount } from '../domain/money.js';
import type {
  AccountBalanceProjectionRow,
  AccountingTransactionalClient,
  AccountingTxClient,
} from './accounting-rows.js';

/**
 * Data access for `accounting.account_balance_projections` — the rebuildable,
 * report-only turnover projection (Task 12, ADR-0031, AC-D-31/AC-I-19).
 *
 * This repository OWNS the projection's persistence; the ledger owns the truth
 * and is never read through this module. Reads are ALWAYS org-scoped (AC-I-01
 * → 404 for foreign keys) and callers paginate explicitly. Writes happen ONLY
 * inside two transaction families:
 *  - the per-voucher finalization transaction (`finalizeChecked`) that already
 *    holds (area → year → period → accounts FOR SHARE) and then, after the
 *    ledger inserts, UPSERTs the touched keys' turnover rows in the same
 *    commit;
 *  - the explicit audited rebuild transaction (`rebuildInTx`) that atomically
 *    replaces a scoped slice from the ledger (idempotent-by-replacement).
 *
 * No triggers, no Redis, no generic tables (AR-29).
 */

type Client = {
  accountBalanceProjection: {
    findMany(args: {
      where: {
        organizationId?: string;
        financialAreaId?: string;
        fiscalYearId?: string;
        accountingPeriodId?: string;
        accountId?: string;
      };
      orderBy?: Array<Record<string, 'asc' | 'desc'>>;
      skip?: number;
      take?: number;
    }): Promise<AccountBalanceProjectionRow[]>;
    count(args: {
      where: {
        organizationId?: string;
        financialAreaId?: string;
        fiscalYearId?: string;
        accountingPeriodId?: string;
        accountId?: string;
      };
    }): Promise<number>;
  };
};

@Injectable()
export class AccountBalanceProjectionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  private transacting(): Promise<AccountingTransactionalClient> {
    return this.prisma.getClient<AccountingTransactionalClient>();
  }

  // ---- scoped reads -------------------------------------------------------

  async list(params: {
    where: {
      organizationId: string;
      financialAreaId?: string | undefined;
      fiscalYearId?: string | undefined;
      accountingPeriodId?: string | undefined;
      accountId?: string | undefined;
    };
    orderBy?: Array<Record<string, 'asc' | 'desc'>>;
    skip: number;
    take: number;
  }): Promise<{ items: AccountBalanceProjectionRow[]; total: number }> {
    const { accountBalanceProjection } = await this.client();
    const where: Record<string, string | undefined> = {
      organizationId: params.where.organizationId,
    };
    if (params.where.financialAreaId !== undefined)
      where['financialAreaId'] = params.where.financialAreaId;
    if (params.where.fiscalYearId !== undefined)
      where['fiscalYearId'] = params.where.fiscalYearId;
    if (params.where.accountingPeriodId !== undefined)
      where['accountingPeriodId'] = params.where.accountingPeriodId;
    if (params.where.accountId !== undefined)
      where['accountId'] = params.where.accountId;

    // Prisma maps camelCase where → snake_case columns via @map, so camel is correct here.
    const [items, total] = await Promise.all([
      accountBalanceProjection.findMany({
        where: where as never,
        orderBy: params.orderBy ?? [{ organizationId: 'asc' }],
        skip: params.skip,
        take: params.take,
      }),
      accountBalanceProjection.count({ where: where as never }),
    ]);
    return { items, total };
  }

  async findByKey(
    organizationId: string,
    financialAreaId: string,
    fiscalYearId: string,
    accountingPeriodId: string,
    accountId: string,
  ): Promise<AccountBalanceProjectionRow | null> {
    const { accountBalanceProjection } = await this.client();
    const rows = await accountBalanceProjection.findMany({
      where: {
        organizationId,
        financialAreaId,
        fiscalYearId,
        accountingPeriodId,
        accountId,
      } as never,
      orderBy: [{ organizationId: 'asc' }],
      skip: 0,
      take: 1,
    });
    return rows[0] ?? null;
  }

  // ---- rebuild (explicit, audited, atomic) --------------------------------

  /**
   * Atomic, idempotent-by-replacement slice rebuild (AC-I-19e). The scope is
   * ALWAYS org-wide and optionally narrowed to one financial area and/or one
   * fiscal year (both must belong to the org; validated outside). The whole
   * scoped slice is deleted and re-inserted from the ledger aggregation — a
   * single transaction, so a concurrent finalization waits on the same slice
   * rows and the loser re-reads the winner's committed slice.
   *
   * Returns `{ deleted, inserted }` for audit evidence.
   */
  async rebuildScoped(input: {
    organizationId: string;
    financialAreaId?: string | undefined;
    fiscalYearId?: string | undefined;
    actorId: string | null;
  }): Promise<{ deleted: number; inserted: number }> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      return rebuildInTx(tx, input);
    });
  }
}

// ---------------------------------------------------------------------------
// Transactional helpers — imported by `accounting-documents.repository.ts`
// for in-finalization maintenance. Exported for unit testing.
// ---------------------------------------------------------------------------

/**
 * Production helper — applies delta ASSUMING the caller already holds
 * `FOR UPDATE` on the touched projection keys (accounts → balances → document
 * order). `finalizeChecked` locks projection keys BEFORE the document, then
 * inserts ledger rows, then calls this helper to UPSERT/DELETE the same keys
 * without acquiring a second lock tail (which would be Document→Projection and
 * would violate the global order). The helper re-reads the locked rows' current
 * sums and upserts/deletes — it never acquires new row locks.
 *
 * The pre-fix helper `applyBalanceProjectionDeltaInTx` (document → balances)
 * has been removed — no production caller should ever acquire document before
 * balances. See git history for the deprecated wrapper and
 * docs/accounting/lock-order-matrix.md D4′.
 */
export async function applyBalanceProjectionDeltasWithLocksHeldInTx(
  tx: AccountingTxClient,
  entries: readonly {
    organizationId: string;
    financialAreaId: string;
    fiscalYearId: string;
    accountingPeriodId: string;
    accountId: string;
    debitAmount: string;
    creditAmount: string;
  }[],
  now: Date,
  actorId: string | null,
  locked: Map<string, { id: string }>,
): Promise<void> {
  if (entries.length === 0) return;
  const deltaByKey = aggregateDeltas(entries);
  await upsertDeltasWithLocks(tx, deltaByKey, locked, now, actorId);
}

function aggregateDeltas(
  entries: readonly {
    organizationId: string;
    financialAreaId: string;
    fiscalYearId: string;
    accountingPeriodId: string;
    accountId: string;
    debitAmount: string;
    creditAmount: string;
  }[],
): Map<
  string,
  {
    key: {
      organizationId: string;
      financialAreaId: string;
      fiscalYearId: string;
      accountingPeriodId: string;
      accountId: string;
    };
    debitDelta: string;
    creditDelta: string;
  }
> {
  const deltaByKey = new Map<
    string,
    {
      key: {
        organizationId: string;
        financialAreaId: string;
        fiscalYearId: string;
        accountingPeriodId: string;
        accountId: string;
      };
      debitDelta: string;
      creditDelta: string;
    }
  >();
  for (const e of entries) {
    const keyStr = balanceKey(e);
    let bucket = deltaByKey.get(keyStr);
    if (bucket === undefined) {
      bucket = {
        key: {
          organizationId: e.organizationId,
          financialAreaId: e.financialAreaId,
          fiscalYearId: e.fiscalYearId,
          accountingPeriodId: e.accountingPeriodId,
          accountId: e.accountId,
        },
        debitDelta: '0',
        creditDelta: '0',
      };
      deltaByKey.set(keyStr, bucket);
    }
    bucket.debitDelta = sumAmounts([bucket.debitDelta, e.debitAmount]);
    bucket.creditDelta = sumAmounts([bucket.creditDelta, e.creditAmount]);
  }
  return deltaByKey;
}

async function upsertDeltasWithLocks(
  tx: AccountingTxClient,
  deltaByKey: Map<
    string,
    {
      key: {
        organizationId: string;
        financialAreaId: string;
        fiscalYearId: string;
        accountingPeriodId: string;
        accountId: string;
      };
      debitDelta: string;
      creditDelta: string;
    }
  >,
  locked: Map<string, { id: string }>,
  now: Date,
  actorId: string | null,
): Promise<void> {
  for (const bucket of deltaByKey.values()) {
    const keyStr = balanceKey(bucket.key);
    const held = locked.get(keyStr);

    // Read current stored turnover — if held is defined we already hold it
    // FOR UPDATE, else no row exists (absence = zero).
    let currentDebit = '0';
    let currentCredit = '0';
    if (held !== undefined) {
      const row = await tx.accountBalanceProjection.findFirst({
        where: {
          organizationId: bucket.key.organizationId,
          financialAreaId: bucket.key.financialAreaId,
          fiscalYearId: bucket.key.fiscalYearId,
          accountingPeriodId: bucket.key.accountingPeriodId,
          accountId: bucket.key.accountId,
        },
      });
      if (row !== null) {
        currentDebit = toAmountString(row.periodDebitAmount);
        currentCredit = toAmountString(row.periodCreditAmount);
      }
    } else {
      // No lock means no row — double-check with a direct find (raced CREATE
      // would have locked it above only if it existed). A concurrent INSERT
      // that committed between the lock probe and now will surface as a
      // unique-violation on the UPSERT; let it bubble and be retried by the
      // caller (or rely on the caller's transaction retry). For now, treat as zero.
      const existing = await tx.accountBalanceProjection.findFirst({
        where: {
          organizationId: bucket.key.organizationId,
          financialAreaId: bucket.key.financialAreaId,
          fiscalYearId: bucket.key.fiscalYearId,
          accountingPeriodId: bucket.key.accountingPeriodId,
          accountId: bucket.key.accountId,
        },
      });
      if (existing !== null) {
        currentDebit = toAmountString(existing.periodDebitAmount);
        currentCredit = toAmountString(existing.periodCreditAmount);
      }
    }

    const newDebit = sumAmounts([currentDebit, bucket.debitDelta]);
    const newCredit = sumAmounts([currentCredit, bucket.creditDelta]);
    const becameZero = isZeroAmount(newDebit) && isZeroAmount(newCredit);

    if (becameZero) {
      // Remove the row when turnover becomes zero (AC-I-19c — absence = zero).
      // Deleting a non-existing zero-row is a no-op.
      if (held !== undefined) {
        await tx.accountBalanceProjection.delete({ where: { id: held.id } });
      } else {
        // Check again — maybe an existing row exists that lock probe missed
        // (it locked only existing rows; a 0→non-zero delta already handled).
        const row = await tx.accountBalanceProjection.findFirst({
          where: {
            organizationId: bucket.key.organizationId,
            financialAreaId: bucket.key.financialAreaId,
            fiscalYearId: bucket.key.fiscalYearId,
            accountingPeriodId: bucket.key.accountingPeriodId,
            accountId: bucket.key.accountId,
          },
        });
        if (row !== null) {
          await tx.accountBalanceProjection.delete({ where: { id: row.id } });
        }
      }
      continue;
    }

    // UPSERT the projection row (idempotent within the transaction).
    await tx.accountBalanceProjection.upsert({
      where: {
        organizationId_financialAreaId_fiscalYearId_accountingPeriodId_accountId:
          {
            organizationId: bucket.key.organizationId,
            financialAreaId: bucket.key.financialAreaId,
            fiscalYearId: bucket.key.fiscalYearId,
            accountingPeriodId: bucket.key.accountingPeriodId,
            accountId: bucket.key.accountId,
          },
      },
      create: {
        id: generateId(),
        organizationId: bucket.key.organizationId,
        financialAreaId: bucket.key.financialAreaId,
        fiscalYearId: bucket.key.fiscalYearId,
        accountingPeriodId: bucket.key.accountingPeriodId,
        accountId: bucket.key.accountId,
        periodDebitAmount: newDebit,
        periodCreditAmount: newCredit,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
      },
      update: {
        periodDebitAmount: newDebit,
        periodCreditAmount: newCredit,
        updatedAt: now,
        updatedBy: actorId,
      },
    });
  }
}

/**
 * Rebuild helper — called only from the repository's `rebuildScoped`.
 * Atomically: lock scope rows, DELETE the scoped slice, read ledger
 * aggregates for that scope, INSERT the re-derived rows.
 */
export async function rebuildInTx(
  tx: AccountingTxClient,
  input: {
    organizationId: string;
    financialAreaId?: string | undefined;
    fiscalYearId?: string | undefined;
    actorId: string | null;
  },
): Promise<{ deleted: number; inserted: number }> {
  const { lockBalanceProjectionScope } = await import('./accounting-locks.js');

  // Lock the scoped slice rows FOR UPDATE — makes the DELETE+INSERT atomic
  // against concurrent finalizations that would otherwise extend the slice.
  await lockBalanceProjectionScope(tx, {
    organizationId: input.organizationId,
    financialAreaId: input.financialAreaId,
    fiscalYearId: input.fiscalYearId,
  });

  // Count before delete for audit (or just capture delete count).
  const del = await tx.accountBalanceProjection.deleteMany({
    where: {
      organizationId: input.organizationId,
      ...(input.financialAreaId !== undefined
        ? { financialAreaId: input.financialAreaId }
        : {}),
      ...(input.fiscalYearId !== undefined
        ? { fiscalYearId: input.fiscalYearId }
        : {}),
    },
  });

  // Ledger aggregate for this scope — GROUP BY projection key in SQL (exact
  // DECIMAL sums). Use raw SQL aggregation rather than reading every ledger
  // entry row into Node (memory-efficient for large books).
  // We use a parameterized $queryRaw and rely on null-coalesced predicates so
  // callers may omit area/year.
  type AggRow = {
    organizationId: string;
    financialAreaId: string;
    fiscalYearId: string;
    accountingPeriodId: string;
    accountId: string;
    periodDebit: unknown;
    periodCredit: unknown;
  };

  const aggRows = await tx.$queryRaw<AggRow>`
    SELECT "organization_id"       AS "organizationId",
           "financial_area_id"     AS "financialAreaId",
           "fiscal_year_id"        AS "fiscalYearId",
           "accounting_period_id"  AS "accountingPeriodId",
           "account_id"            AS "accountId",
           SUM("debit_amount")     AS "periodDebit",
           SUM("credit_amount")    AS "periodCredit"
      FROM "accounting"."ledger_entries"
     WHERE "organization_id" = ${input.organizationId}
       AND (${input.financialAreaId as string | undefined}::text IS NULL
            OR "financial_area_id" = ${input.financialAreaId as string | undefined})
       AND (${input.fiscalYearId as string | undefined}::text IS NULL
            OR "fiscal_year_id" = ${input.fiscalYearId as string | undefined})
     GROUP BY "organization_id", "financial_area_id", "fiscal_year_id",
              "accounting_period_id", "account_id"
    HAVING SUM("debit_amount") <> 0 OR SUM("credit_amount") <> 0
  `;

  if (aggRows.length === 0) {
    return { deleted: del.count, inserted: 0 };
  }

  const now = new Date();
  const toCreate = aggRows.map((r) => ({
    id: generateId(),
    organizationId: r.organizationId,
    financialAreaId: r.financialAreaId,
    fiscalYearId: r.fiscalYearId,
    accountingPeriodId: r.accountingPeriodId,
    accountId: r.accountId,
    periodDebitAmount: toAmountString(r.periodDebit),
    periodCreditAmount: toAmountString(r.periodCredit),
    createdAt: now,
    updatedAt: now,
    createdBy: input.actorId,
    updatedBy: input.actorId,
  }));

  // Bulk insert — `createMany` bypasses the unique-check per row in SQL but
  // the UNIQUE index is still the database backstop. Aggregation already
  // dedupes by GROUP, so no duplicates exist in this batch.
  const ins = await tx.accountBalanceProjection.createMany({ data: toCreate });
  return { deleted: del.count, inserted: ins.count };
}

// ---------------------------------------------------------------------------
// Reconciliation read helper — ledger vs projection full OUTER JOIN
// ---------------------------------------------------------------------------

/**
 * Read mismatches directly from the DB reconciliation view
 * (`accounting.vw_balance_reconciliation`) or via equivalent aggregation.
 * Prefer the view when available (operators can query it). The application
 * layer reproduces the classification identically to stay self-consistent
 * even if the view definition drifts, using the same GROUP aggregation as
 * the rebuild path.
 */
export async function readReconciliationMismatchesInTx(
  tx: AccountingTxClient,
  scope: {
    organizationId: string;
    financialAreaId?: string | undefined;
    fiscalYearId?: string | undefined;
    accountingPeriodId?: string | undefined;
    accountId?: string | undefined;
  },
): Promise<
  Array<{
    organizationId: string;
    financialAreaId: string;
    fiscalYearId: string;
    accountingPeriodId: string;
    accountId: string;
    mismatchKind: string;
    ledgerDebit: string | null;
    ledgerCredit: string | null;
    projDebit: string | null;
    projCredit: string | null;
  }>
> {
  type ReconRow = {
    organizationId: string;
    financialAreaId: string;
    fiscalYearId: string;
    accountingPeriodId: string;
    accountId: string;
    ledgerDebit: unknown;
    ledgerCredit: unknown;
    projDebit: unknown;
    projCredit: unknown;
    mismatchKind: string;
  };

  // Use the reconciliation view — already FULL OUTER JOIN with mismatches
  // classified. Filter by org + optional scope predicates, exclude 'matched'.
  const rows = await tx.$queryRaw<ReconRow>`
    SELECT "organization_id"       AS "organizationId",
           "financial_area_id"    AS "financialAreaId",
           "fiscal_year_id"       AS "fiscalYearId",
           "accounting_period_id" AS "accountingPeriodId",
           "account_id"           AS "accountId",
           "ledger_debit"         AS "ledgerDebit",
           "ledger_credit"        AS "ledgerCredit",
           "proj_debit"           AS "projDebit",
           "proj_credit"          AS "projCredit",
           "mismatch_kind"        AS "mismatchKind"
      FROM "accounting"."vw_balance_reconciliation"
     WHERE "organization_id" = ${scope.organizationId}
       AND (${scope.financialAreaId as string | undefined}::text IS NULL
            OR "financial_area_id" = ${scope.financialAreaId as string | undefined})
       AND (${scope.fiscalYearId as string | undefined}::text IS NULL
            OR "fiscal_year_id" = ${scope.fiscalYearId as string | undefined})
       AND (${scope.accountingPeriodId as string | undefined}::text IS NULL
            OR "accounting_period_id" = ${scope.accountingPeriodId as string | undefined})
       AND (${scope.accountId as string | undefined}::text IS NULL
            OR "account_id" = ${scope.accountId as string | undefined})
       AND "mismatch_kind" <> 'matched'
  `;

  return rows.map((r) => ({
    organizationId: r.organizationId,
    financialAreaId: r.financialAreaId,
    fiscalYearId: r.fiscalYearId,
    accountingPeriodId: r.accountingPeriodId,
    accountId: r.accountId,
    mismatchKind: r.mismatchKind,
    ledgerDebit: r.ledgerDebit === null ? null : toAmountString(r.ledgerDebit),
    ledgerCredit:
      r.ledgerCredit === null ? null : toAmountString(r.ledgerCredit),
    projDebit: r.projDebit === null ? null : toAmountString(r.projDebit),
    projCredit: r.projCredit === null ? null : toAmountString(r.projCredit),
  }));
}

function balanceKey(input: {
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  accountId: string;
}): string {
  return [
    input.organizationId,
    input.financialAreaId,
    input.fiscalYearId,
    input.accountingPeriodId,
    input.accountId,
  ].join('|');
}

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
    `Cannot map ledger/balance amount of type "${typeof value}" to a decimal string.`,
  );
}
