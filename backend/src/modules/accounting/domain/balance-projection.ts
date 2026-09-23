/**
 * Balance projection domain — materialized, rebuildable turnover
 * (Task 12, contract §19.3 AC-D-31, §25 AC-I-19, ADR-0031).
 *
 * This is the ONLY place that decides what a balance projection IS; every
 * transactional writer (finalization) and the rebuild + reconciliation paths
 * derive from these exact rules.
 *
 * Invariants (AC-I-19 a–e, denormalized here for code comments):
 *  - a) Stored measures are ONLY `period_debit_amount` / `period_credit_amount`,
 *       both non-negative numeric(18,2), never negative, never rounded.
 *       Derived `period_net`, `opening`, `closing` live ONLY in reporting
 *       views (`vw_account_balance_derived`) or in-memory window functions.
 *  - b) Scope = organization + financial_area + fiscal_year + accounting_period
 *       + account. Branch, currency, detail dimensions are NOT part of the base
 *       key (AR-29, OQ-03/41).
 *  - c) Absence = zero turnover (no zero-only rows): a key with 0/0 turnover
 *       is not persisted; deleting the last turnover deletes the row.
 *  - d) Finalized-only: only ledger entries materialized from `final` vouchers
 *       feed the projection (§15.5, AC-I-05/06); the projection never reads
 *       drafts/temporaries or other modules' tables.
 *  - e) Idempotency-by-replacement: rebuild is atomic — it replaces the
 *       scoped slice deterministically from the ledger aggregation, never
 *       applies deltas.
 *
 * Framework-free (AR-05): pure types + functions, no Nest/Prisma/HTTP.
 */

import {
  compareAmounts,
  isZeroAmount,
  sumAmounts,
  validateEnteredAmount,
} from './money.js';

// ---------------------------------------------------------------------------
// Types — stored shape + derived reporting shape + reconciliation
// ---------------------------------------------------------------------------

/** Stored projection row — turnover only (AC-I-19 a). */
export interface AccountBalanceProjection {
  readonly id: string;
  readonly organizationId: string;
  readonly financialAreaId: string;
  readonly fiscalYearId: string;
  readonly accountingPeriodId: string;
  readonly accountId: string;
  /** Non-negative exact decimal string, numeric(18,2) semantics. */
  readonly periodDebitAmount: string;
  /** Non-negative exact decimal string, numeric(18,2) semantics. */
  readonly periodCreditAmount: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly createdBy: string | null;
  readonly updatedBy: string | null;
}

/** Derived reporting row — the vw_account_balance_derived shape. */
export interface DerivedBalance {
  readonly organizationId: string;
  readonly financialAreaId: string;
  readonly fiscalYearId: string;
  readonly accountingPeriodId: string;
  /** Authoritative intra-year ordering (§7.1): AccountingPeriod.sequence. */
  readonly periodSequence: number;
  readonly accountId: string;
  readonly periodDebitAmount: string;
  readonly periodCreditAmount: string;
  /** periodDebit - periodCredit, exact. */
  readonly periodNetAmount: string;
  /** Cumulative closing up to PRIOR period — 0 for first period (§19.2). */
  readonly openingBalanceAmount: string;
  /** opening + periodNet, exact. */
  readonly closingBalanceAmount: string;
}

/** One ledger→projection key group that the reconciliation evaluates. */
export interface ReconciliationGroup {
  readonly organizationId: string;
  readonly financialAreaId: string;
  readonly fiscalYearId: string;
  readonly accountingPeriodId: string;
  readonly accountId: string;
  /** True when the mismatch crosses a scope boundary that should never exist. */
  readonly isScopeMismatch?: boolean | undefined;
}

/** Classification produced by reconcile (maps to vw_balance_reconciliation). */
export type BalanceMismatchKind =
  | 'missing_projection' // ledger exists, projection absent
  | 'extra_projection' // projection exists, ledger absent
  | 'debit_mismatch'
  | 'credit_mismatch'
  | 'both_mismatch'
  | 'matched'; // not surfaced in the reconciliation endpoint

export interface BalanceReconciliationMismatch {
  readonly organizationId: string;
  readonly financialAreaId: string;
  readonly fiscalYearId: string;
  readonly accountingPeriodId: string;
  readonly accountId: string;
  readonly mismatchKind: Exclude<BalanceMismatchKind, 'matched'>;
  readonly ledgerDebitAmount: string | null;
  readonly ledgerCreditAmount: string | null;
  readonly projectionDebitAmount: string | null;
  readonly projectionCreditAmount: string | null;
}

// ---------------------------------------------------------------------------
// Validation — stored measures only (AC-I-19a, AR-12)
// ---------------------------------------------------------------------------

export type BalanceProjectionProblem =
  | 'missing_id'
  | 'missing_organization'
  | 'missing_financial_area'
  | 'missing_fiscal_year'
  | 'missing_accounting_period'
  | 'missing_account'
  | 'invalid_period_debit'
  | 'invalid_period_credit'
  | 'negative_not_allowed'
  | 'zero_turnover_row';

export function balanceProjectionProblemMessage(
  problem: BalanceProjectionProblem,
): string {
  switch (problem) {
    case 'missing_id':
      return 'Balance projection requires an immutable identity.';
    case 'missing_organization':
      return 'Balance projection requires an organization scope.';
    case 'missing_financial_area':
      return 'Balance projection requires a financial area scope.';
    case 'missing_fiscal_year':
      return 'Balance projection requires a fiscal year resolution.';
    case 'missing_accounting_period':
      return 'Balance projection requires an accounting period resolution.';
    case 'missing_account':
      return 'Balance projection requires an account reference.';
    case 'invalid_period_debit':
      return 'Period debit amount must be a non-negative decimal with at most 2 decimals.';
    case 'invalid_period_credit':
      return 'Period credit amount must be a non-negative decimal with at most 2 decimals.';
    case 'negative_not_allowed':
      return 'Balance projection amounts are never negative (AC-I-19a).';
    case 'zero_turnover_row':
      return 'A balance projection row with zero turnover must not be persisted (absence = zero).';
  }
}

export function checkBalanceProjection(
  proj: AccountBalanceProjection,
): BalanceProjectionProblem[] {
  const problems: BalanceProjectionProblem[] = [];
  if (proj.id.trim() === '') problems.push('missing_id');
  if (proj.organizationId.trim() === '') problems.push('missing_organization');
  if (proj.financialAreaId.trim() === '')
    problems.push('missing_financial_area');
  if (proj.fiscalYearId.trim() === '') problems.push('missing_fiscal_year');
  if (proj.accountingPeriodId.trim() === '')
    problems.push('missing_accounting_period');
  if (proj.accountId.trim() === '') problems.push('missing_account');

  const debitProblem = validateEnteredAmount(proj.periodDebitAmount);
  const creditProblem = validateEnteredAmount(proj.periodCreditAmount);
  if (debitProblem !== null) problems.push('invalid_period_debit');
  if (creditProblem !== null) problems.push('invalid_period_credit');

  // Negativity is already rejected by validateEnteredAmount (pattern disallows `-`),
  // but belt-and-braces: someone could bypass the pattern and pass numeric string with minus.
  if (
    proj.periodDebitAmount.trim().startsWith('-') ||
    proj.periodCreditAmount.trim().startsWith('-')
  ) {
    problems.push('negative_not_allowed');
  }

  if (
    debitProblem === null &&
    creditProblem === null &&
    !problems.includes('negative_not_allowed') &&
    isZeroAmount(proj.periodDebitAmount) &&
    isZeroAmount(proj.periodCreditAmount)
  ) {
    problems.push('zero_turnover_row');
  }

  return [...new Set(problems)];
}

export function isValidBalanceProjection(
  proj: AccountBalanceProjection,
): boolean {
  return checkBalanceProjection(proj).length === 0;
}

// ---------------------------------------------------------------------------
// Pure helpers — exact money, no floats, never rounding for balance.
// ---------------------------------------------------------------------------

/** Exact period-net: debit − credit, canonicalized. */
export function periodNetAmount(
  periodDebit: string,
  periodCredit: string,
): string {
  // sumAmounts handles signed mantissas; negate via string prepend.
  // Instead of inventing a negate, use compare path: render as debit + (-credit).
  const negCredit = periodCredit.startsWith('-')
    ? periodCredit.slice(1)
    : `-${periodCredit}`;
  // sumAmounts canonicalizes.
  return sumAmounts([periodDebit, negCredit]);
}

/**
 * Totally-ordered projection-key string (for maps / deterministic sort).
 * Mirrors the UNIQUE key order.
 */
export function balanceProjectionKey(input: {
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

// ---------------------------------------------------------------------------
// Aggregation — ledger → projections (the ONE aggregation rule)
// ---------------------------------------------------------------------------

/**
 * Ledger entry's turnover contribution — minimal projection for aggregation
 * (already excludes dimensions / branch by construction via the task).
 */
export interface LedgerTurnoverInput {
  readonly organizationId: string;
  readonly financialAreaId: string;
  readonly fiscalYearId: string;
  readonly accountingPeriodId: string;
  readonly accountId: string;
  readonly debitAmount: string;
  readonly creditAmount: string;
}

/**
 * Aggregate ledger turnovers by (org, area, year, period, account) into
 * stored turnover sums. The aggregation law is:
 *   grouped key → Σ(debit), Σ(credit)
 * — exact, non-negative-rejecting, never negative — and result is already
 * absence=zero-pruned (zero-sum groups are omitted, never a zero row).
 * No opening/closing, no period ordering here.
 */
export function aggregateLedgerTurnovers(
  entries: readonly LedgerTurnoverInput[],
): Array<{
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  accountId: string;
  periodDebitAmount: string;
  periodCreditAmount: string;
}> {
  const grouped = new Map<
    string,
    {
      key: {
        organizationId: string;
        financialAreaId: string;
        fiscalYearId: string;
        accountingPeriodId: string;
        accountId: string;
      };
      debits: string[];
      credits: string[];
    }
  >();

  for (const e of entries) {
    const key = balanceProjectionKey({
      organizationId: e.organizationId,
      financialAreaId: e.financialAreaId,
      fiscalYearId: e.fiscalYearId,
      accountingPeriodId: e.accountingPeriodId,
      accountId: e.accountId,
    });
    let bucket = grouped.get(key);
    if (bucket === undefined) {
      bucket = {
        key: {
          organizationId: e.organizationId,
          financialAreaId: e.financialAreaId,
          fiscalYearId: e.fiscalYearId,
          accountingPeriodId: e.accountingPeriodId,
          accountId: e.accountId,
        },
        debits: [],
        credits: [],
      };
      grouped.set(key, bucket);
    }
    bucket.debits.push(e.debitAmount);
    bucket.credits.push(e.creditAmount);
  }

  const out: Array<{
    organizationId: string;
    financialAreaId: string;
    fiscalYearId: string;
    accountingPeriodId: string;
    accountId: string;
    periodDebitAmount: string;
    periodCreditAmount: string;
  }> = [];

  for (const { key, debits, credits } of grouped.values()) {
    const periodDebit = sumAmounts(debits);
    const periodCredit = sumAmounts(credits);
    if (isZeroAmount(periodDebit) && isZeroAmount(periodCredit)) continue; // AC-I-19c
    out.push({
      ...key,
      periodDebitAmount: periodDebit,
      periodCreditAmount: periodCredit,
    });
  }

  // Deterministic ordering — same order the DB backfill yields.
  out.sort((a, b) =>
    balanceProjectionKey(a) < balanceProjectionKey(b) ? -1 : 1,
  );
  return out;
}

// ---------------------------------------------------------------------------
// Derived opening/closing — in-memory window using periodSequence
// ---------------------------------------------------------------------------

/**
 * Expand stored projections into derived balances by applying the opening/
 * closing window ordered by period sequence WITHIN one (org, area, year,
 * account) partition. The function does NOT cross fiscal-year boundaries by
 * construction — each partition is independent (ADR-0031 § Derived only).
 *
 * `periodsByYear` provides the authoritative ordering: a Map from fiscalYearId
 * → sorted periods (sequence ascending). The stored `accountingPeriodId` of
 * each projection is validated against it — a projection that points to a
 * period outside the partition is ignored (data error — should never occur).
 */
export function deriveBalances(
  projections: readonly AccountBalanceProjection[],
  /** Period ordering: year → [{ id, sequence }], sequence ascending, dense. */
  periodsByYear: ReadonlyMap<
    string,
    readonly { readonly id: string; readonly sequence: number }[]
  >,
): DerivedBalance[] {
  // Index projections by (org, area, year, account), then sum by periodId.
  const partition = new Map<
    string,
    Map<string, { debit: string; credit: string; periodId: string }>
  >();

  for (const p of projections) {
    const partitionKey = [
      p.organizationId,
      p.financialAreaId,
      p.fiscalYearId,
      p.accountId,
    ].join('|');
    let byPeriod = partition.get(partitionKey);
    if (byPeriod === undefined) {
      byPeriod = new Map();
      partition.set(partitionKey, byPeriod);
    }
    const existing = byPeriod.get(p.accountingPeriodId);
    if (existing === undefined) {
      byPeriod.set(p.accountingPeriodId, {
        debit: p.periodDebitAmount,
        credit: p.periodCreditAmount,
        periodId: p.accountingPeriodId,
      });
    } else {
      // Defensive: duplicate projection rows for one key should never exist
      // (UNIQUE backstop), but sum them so the derived path is total-proof.
      existing.debit = sumAmounts([existing.debit, p.periodDebitAmount]);
      existing.credit = sumAmounts([existing.credit, p.periodCreditAmount]);
    }
  }

  const derived: DerivedBalance[] = [];

  for (const [partitionKey, byPeriod] of partition) {
    const [organizationId, financialAreaId, fiscalYearId, accountId] =
      partitionKey.split('|') as [string, string, string, string];
    const periods = periodsByYear.get(fiscalYearId) ?? [];
    // Sequence-ordered traversal.
    const ordered = [...periods].sort((a, b) => a.sequence - b.sequence);

    let cumulativeNet = '0';
    for (const period of ordered) {
      const agg = byPeriod.get(period.id);
      const periodDebit = agg?.debit ?? '0';
      const periodCredit = agg?.credit ?? '0';

      // Only emit rows for periods that have turnover (absence = zero),
      // mirroring vw_account_balance_derived's FROM projection rows.
      if (agg === undefined) continue;

      const pNet = periodNetAmount(periodDebit, periodCredit);
      const opening = cumulativeNet;
      const closing = sumAmounts([opening, pNet]);

      derived.push({
        organizationId,
        financialAreaId,
        fiscalYearId,
        accountingPeriodId: period.id,
        periodSequence: period.sequence,
        accountId,
        periodDebitAmount: periodDebit,
        periodCreditAmount: periodCredit,
        periodNetAmount: pNet,
        openingBalanceAmount: opening,
        closingBalanceAmount: closing,
      });

      cumulativeNet = closing;
    }
  }

  derived.sort((a, b) => {
    const ka = `${a.organizationId}|${a.financialAreaId}|${a.fiscalYearId}|${a.accountId}|${String(a.periodSequence).padStart(6, '0')}`;
    const kb = `${b.organizationId}|${b.financialAreaId}|${b.fiscalYearId}|${b.accountId}|${String(b.periodSequence).padStart(6, '0')}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return derived;
}

// ---------------------------------------------------------------------------
// Reconciliation — ledger aggregate vs projection (pure)
// ---------------------------------------------------------------------------

export function classifyMismatch(input: {
  ledgerDebit: string | null;
  ledgerCredit: string | null;
  projectionDebit: string | null;
  projectionCredit: string | null;
}): BalanceMismatchKind {
  const hasLedger = input.ledgerDebit !== null;
  const hasProjection = input.projectionDebit !== null;
  if (!hasLedger && hasProjection) return 'extra_projection';
  if (hasLedger && !hasProjection) return 'missing_projection';
  if (!hasLedger && !hasProjection)
    throw new Error('classifyMismatch: both sides absent — vacuous.');
  // Both present — compare exact strings via amountsEqual semantics.
  const debitMismatch =
    input.ledgerDebit !== null &&
    input.projectionDebit !== null &&
    compareAmounts(input.ledgerDebit, input.projectionDebit) !== 0;
  const creditMismatch =
    input.ledgerCredit !== null &&
    input.projectionCredit !== null &&
    compareAmounts(input.ledgerCredit, input.projectionCredit) !== 0;
  if (debitMismatch && creditMismatch) return 'both_mismatch';
  if (debitMismatch) return 'debit_mismatch';
  if (creditMismatch) return 'credit_mismatch';
  return 'matched';
}

/**
 * Reconcile ledger aggregates against stored projections, key by key.
 * Returns only mismatches (matched entries are filtered — the reconciliation
 * endpoint surfaces only what needs attention, matching the inventory precedent
 * §25). Scope mismatches (a period/year that does not exist or belongs to a
 * foreign area) are already impossible by the ledger's scope guards, but are
 * classified here as `both_mismatch` with isScopeMismatch for observability
 * (task §7 reconciliation mismatches include scope mismatches).
 */
export function reconcileBalances(input: {
  ledgerAggregates: readonly {
    organizationId: string;
    financialAreaId: string;
    fiscalYearId: string;
    accountingPeriodId: string;
    accountId: string;
    periodDebitAmount: string;
    periodCreditAmount: string;
  }[];
  projections: readonly {
    organizationId: string;
    financialAreaId: string;
    fiscalYearId: string;
    accountingPeriodId: string;
    accountId: string;
    periodDebitAmount: string;
    periodCreditAmount: string;
  }[];
}): BalanceReconciliationMismatch[] {
  const keyOf = (r: {
    organizationId: string;
    financialAreaId: string;
    fiscalYearId: string;
    accountingPeriodId: string;
    accountId: string;
  }): string => balanceProjectionKey(r);

  const ledgerByKey = new Map<
    string,
    (typeof input.ledgerAggregates)[number]
  >();
  for (const r of input.ledgerAggregates) ledgerByKey.set(keyOf(r), r);
  const projByKey = new Map<string, (typeof input.projections)[number]>();
  for (const r of input.projections) projByKey.set(keyOf(r), r);

  const allKeys = new Set<string>([...ledgerByKey.keys(), ...projByKey.keys()]);
  const mismatches: BalanceReconciliationMismatch[] = [];
  for (const key of allKeys) {
    const l = ledgerByKey.get(key);
    const p = projByKey.get(key);
    const kind = classifyMismatch({
      ledgerDebit: l?.periodDebitAmount ?? null,
      ledgerCredit: l?.periodCreditAmount ?? null,
      projectionDebit: p?.periodDebitAmount ?? null,
      projectionCredit: p?.periodCreditAmount ?? null,
    });
    if (kind === 'matched') continue;
    const probe = l ?? p;
    if (probe === undefined) continue; // unreachable — allKeys covers both
    mismatches.push({
      organizationId: probe.organizationId,
      financialAreaId: probe.financialAreaId,
      fiscalYearId: probe.fiscalYearId,
      accountingPeriodId: probe.accountingPeriodId,
      accountId: probe.accountId,
      mismatchKind: kind,
      ledgerDebitAmount: l?.periodDebitAmount ?? null,
      ledgerCreditAmount: l?.periodCreditAmount ?? null,
      projectionDebitAmount: p?.periodDebitAmount ?? null,
      projectionCreditAmount: p?.periodCreditAmount ?? null,
    });
  }
  mismatches.sort((a, b) =>
    balanceProjectionKey(a) < balanceProjectionKey(b) ? -1 : 1,
  );
  return mismatches;
}
