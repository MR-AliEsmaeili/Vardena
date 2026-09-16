/**
 * Posting readiness — the eligibility seam between a stored accounting
 * voucher and the future Posting Engine (Task 10.5; contract §15.5/§19.3,
 * ADR-0026).
 *
 * THE CONTRACT THIS FILE IMPLEMENTS
 *
 * Finalization is "the single act that makes a voucher part of the books"
 * (§15.5, AC-D-23): inside one locked transaction it re-validates the
 * balance, the line composition, the account eligibility, the resolved
 * calendar scope, the description and the origin evidence, allocates the
 * number and writes the state. Posting readiness answers the question the
 * future Posting Engine — the consumer of Final document lines that §19.3
 * (balance projections, AC-D-31/AC-I-19) defers — must ask before it
 * consumes a voucher:
 *
 * ```
 * AccountingDocument ──► PostingReadiness ──► ready | not_ready + reasons
 * ```
 *
 * Readiness re-evaluates, as a PURE function over a read-only snapshot,
 * every invariant of that finalization set that is PERMANENT — guaranteed by
 * the finalization transaction and then immutable (the document and its
 * lines, §15.2), frozen by reference (a referenced account's postability,
 * AC-I-11) or structural (the stored scope resolution, AC-I-14). It
 * deliberately does NOT re-require the two dimensions the contract says may
 * legitimately change AFTER finalization without invalidating anything:
 *
 * - period/year STATUS: "Final documents keep their resolved period forever.
 *   A later period close does not move or invalidate them" (§7.2 rule 7).
 *   Openness is finalization's own gate (AC-I-04, enforced inside the
 *   finalization transaction), not consumption's — a sealed year whose
 *   vouchers became unconsumable would erase history from every projection
 *   (AC-I-19). The scope input below therefore carries no status field at
 *   all: the decision cannot depend on it.
 * - account ACTIVITY: deactivation "blocks new posting lines and new child
 *   creation; existing lines, balances, reports and history keep referring
 *   to the account and remain fully readable" (§8.6, AC-D-08). The account
 *   input below carries no `isActive` field for the same reason.
 *
 * What is NOT decided anywhere yet (and therefore NOT evaluated — the seam
 * is recorded, not invented, AR-29/AG-09):
 * - dimension assignments (§10.6/AC-I-18 → OQ-41: no dimension tables exist;
 *   finalization in Task 10.4 checks none either);
 * - per-account financial-area applicability (§14 rule 1's "area-applicable"
 *   → OQ-40: no applicability structure exists; the chart is
 *   organization-scoped per AC-D-04);
 * - approval authority and posting modes (§17.2 → OQ-42: no approval state
 *   exists, and `Finalize` ≠ `Approve`);
 * - delivery durability and system-source liveness (§16.6 → OQ-39: readiness
 *   says nothing about how an effect reaches an engine, and no production
 *   system posting is enabled);
 * - statutory behaviour (OQ-43).
 * When one of those lands, its check EXTENDS this decision table with a new
 * reason — the stability of the existing codes is what makes that additive.
 *
 * READ-ONLY BY CONSTRUCTION (Task 10.5): the evaluation allocates no number,
 * changes no state, writes no idempotency row, emits no event and touches no
 * account or calendar row. It is an eligibility verdict, not an accounting
 * effect — which is also why it is NOT a posting operation and never enters
 * the `accounting_posting_operations` ledger (§16.4 belongs to effects).
 *
 * RESULT MODEL: `ready` means "every permanent book invariant holds for the
 * stored aggregate"; `not_ready` carries EVERY reason found (the
 * `checkVoucherLines` convention), as machine-readable problem codes reusing
 * the module's existing vocabularies — `VoucherLineProblem` (§13/§12.5) and
 * `AccountingDocumentOriginProblem` (§16.1/§16.3) verbatim, plus the
 * readiness-specific codes for the state, account and scope dimensions. No
 * human-readable string is a contract: consumers match on `problem`.
 *
 * CONSISTENCY BOUNDARY (documented for the future engine): a `ready` verdict
 * on a FINAL voucher is STABLE — nothing can revoke it, because every fact
 * the verdict depends on is immutable, frozen or excluded by contract (see
 * above), so a plain unlocked read is not a check-then-act race. The engine
 * still owns its own effect's consistency: whatever it materializes, it
 * re-validates inside its own transaction (the ADR-0022 "evaluate inside the
 * transaction" posture), reusing `data/accounting-locks.ts` and its fixed
 * order (area → year → period → accounts → document) if it needs a locked
 * read. This evaluation takes no locks at all, so it can never participate
 * in a lock-order cycle.
 *
 * Framework-free (AR-05): pure functions, unit-tested; no Nest, no Prisma,
 * no HTTP. The future Posting Engine depends on THIS file's shapes, never on
 * repositories, Prisma models or DTOs.
 */

import type { Account } from './account.js';
import type { AccountingPeriod } from './accounting-period.js';
import type {
  AccountingDocument,
  AccountingDocumentOriginProblem,
  AccountingDocumentPhase,
} from './accounting-document.js';
import { checkOriginEvidence } from './accounting-document.js';
import type { DateOnlyRange } from './date-range.js';
import { dateOnlyRangeWithin } from './date-range.js';
import type { FinancialArea } from './financial-area.js';
import type { FiscalYear } from './fiscal-year.js';
import type { VoucherLineProblem } from './voucher-lines.js';
import { checkVoucherLines } from './voucher-lines.js';

// ---------------------------------------------------------------------------
// Result model
// ---------------------------------------------------------------------------

/** The verdict: eligible for consumption, or not (with reasons). */
export type PostingReadinessStatus = 'ready' | 'not_ready';

/**
 * The account problems readiness can report — the structural subset of the
 * document guard's `AccountingDocumentAccountProblem` vocabulary
 * (`data/accounting-document-errors.ts`, AC-I-09): a missing or foreign
 * account is `account_not_found` (AC-I-16: foreign is indistinguishable
 * from missing), a non-postable account is `account_not_postable`.
 *
 * `account_disabled` is DELIBERATELY ABSENT: deactivation after
 * finalization blocks new lines only — existing lines, balances, reports
 * and history keep referring to the account (§8.6, AC-D-08).
 */
export type PostingReadinessAccountProblem =
  'account_not_found' | 'account_not_postable';

/**
 * Which calendar row failed to resolve — the same `scope` vocabulary the
 * document guard's `AccountingDocumentScopeRejectedError` carries
 * (`'area' | 'year' | 'period'`).
 */
export type PostingReadinessScopeName = 'area' | 'year' | 'period';

/**
 * One reason a voucher is not posting-ready. Every variant is a stable,
 * machine-readable problem code plus the context that identifies it — the
 * shape of the module's guard errors, without their HTTP mapping.
 */
export type PostingReadinessReason =
  /** Only `final` vouchers may be consumed (§15.1/§15.5, AC-D-20/23). */
  | { problem: 'document_not_final'; phase: AccountingDocumentPhase }
  /** A FINAL document always carries its number (§15.5 step 2, §18, AC-I-22). */
  | { problem: 'document_not_numbered' }
  /** The header narration is required and non-blank (§12.2). */
  | { problem: 'missing_description' }
  /** The origin/source evidence pair is inconsistent (§16.1/§16.3). */
  | { problem: AccountingDocumentOriginProblem }
  /** A §13/§12.5 line-composition problem, verbatim from the decision table. */
  | { problem: VoucherLineProblem }
  /** A referenced account cannot receive the line (§14, AC-I-09). */
  | { problem: PostingReadinessAccountProblem; accountId: string }
  /**
   * The stored calendar scope no longer resolves from `document_date`
   * within the document's organization/area (§6.2 rule 4, AC-I-02/AC-I-14)
   * — the drift seam fiscal-year date edits can open while a year is open
   * (Task 10.2's §6.5 reading; the reference guard is not enforced yet).
   */
  | { problem: 'scope_unresolvable'; scope: PostingReadinessScopeName };

/** The eligibility verdict for one stored voucher. */
export interface PostingReadiness {
  status: PostingReadinessStatus;
  /** The document the verdict is about. */
  documentId: string;
  /**
   * Every reason found, in the fixed dimension order: state → source →
   * composition → accounts (ascending by id) → scope (area, year, period).
   * Empty if and only if `status === 'ready'`.
   */
  reasons: PostingReadinessReason[];
}

// ---------------------------------------------------------------------------
// Evaluation input (narrow, status-free — what the decision may read)
// ---------------------------------------------------------------------------

/**
 * The calendar rows the evaluation reads, narrowed to identity + dates.
 * Statuses (`open|closed|sealed`), `isActive` flags and titles are
 * deliberately NOT part of the input: §7.2 rule 7 keeps final documents
 * valid across later closes/seals, so the decision cannot see them.
 */
export interface PostingReadinessScope {
  /** The document's financial area, read by the header's `financialAreaId`. */
  area: Pick<FinancialArea, 'id' | 'organizationId'> | null;
  /** The stored fiscal year, read by the header's `fiscalYearId`. */
  fiscalYear: Pick<
    FiscalYear,
    'id' | 'organizationId' | 'financialAreaId' | 'startDate' | 'endDate'
  > | null;
  /** The stored accounting period, read by the header's `accountingPeriodId`. */
  accountingPeriod: Pick<
    AccountingPeriod,
    'id' | 'fiscalYearId' | 'startDate' | 'endDate'
  > | null;
}

/**
 * One referenced account, narrowed to the fields the decision reads.
 * `isActive` is deliberately absent (§8.6 — see
 * `PostingReadinessAccountProblem`).
 */
export type PostingReadinessAccount = Pick<
  Account,
  'id' | 'organizationId' | 'isPostable'
>;

/** Everything the pure evaluation needs: the stored aggregate + its references. */
export interface PostingReadinessEvaluation {
  document: AccountingDocument;
  scope: PostingReadinessScope;
  /**
   * The account rows that were FOUND for the lines' distinct account ids.
   * A referenced id with no row here reports `account_not_found` — the
   * caller never has to encode "missing" itself.
   */
  accounts: readonly PostingReadinessAccount[];
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/**
 * Decide whether a stored voucher is eligible for consumption by the future
 * Posting Engine. Pure and total: it reads nothing, writes nothing, throws
 * nothing, and the same input always yields the same verdict.
 *
 * Every dimension is evaluated and EVERY problem is reported (the
 * `checkVoucherLines` convention), so one verdict tells the consumer all
 * that is wrong — there is no short-circuit that hides a second defect.
 */
export function evaluatePostingReadiness(
  input: PostingReadinessEvaluation,
): PostingReadiness {
  const reasons: PostingReadinessReason[] = [
    ...stateReasons(input.document),
    ...originReasons(input.document),
    ...compositionReasons(input.document),
    ...accountReasons(input.document, input.accounts),
    ...scopeReasons(input.document, input.scope),
  ];
  return {
    status: reasons.length === 0 ? 'ready' : 'not_ready',
    documentId: input.document.id,
    reasons,
  };
}

/** The document-state dimension: final, numbered, described (§15.5/§18/§12.2). */
function stateReasons(document: AccountingDocument): PostingReadinessReason[] {
  const reasons: PostingReadinessReason[] = [];
  if (document.phase !== 'final') {
    reasons.push({ problem: 'document_not_final', phase: document.phase });
  }
  // "A Final document always has one [number]" (§18) — the requirement is a
  // property of the FINAL state, so it is checked for final documents only:
  // a draft legitimately has no serial yet, and its verdict is already
  // `document_not_final`.
  if (document.phase === 'final' && document.documentNumber === null) {
    reasons.push({ problem: 'document_not_numbered' });
  }
  if (document.description.trim() === '') {
    reasons.push({ problem: 'missing_description' });
  }
  return reasons;
}

/** The origin-evidence dimension (§16.1/§16.3) — the one existing decision table. */
function originReasons(document: AccountingDocument): PostingReadinessReason[] {
  const problem = checkOriginEvidence(document.origin, document.source);
  return problem === null ? [] : [{ problem }];
}

/**
 * The composition dimension (§13, AC-I-07/08) — `checkVoucherLines` on the
 * STORED lines, never a second implementation of the arithmetic.
 */
function compositionReasons(
  document: AccountingDocument,
): PostingReadinessReason[] {
  return checkVoucherLines(document.lines).map((problem) => ({ problem }));
}

/**
 * The account dimension (§14, AC-I-09): every referenced account must exist
 * in the document's organization and be postable. Ascending by id and
 * deduplicated, like every account walk in this module. Activity is not a
 * criterion (§8.6).
 */
function accountReasons(
  document: AccountingDocument,
  accounts: readonly PostingReadinessAccount[],
): PostingReadinessReason[] {
  const reasons: PostingReadinessReason[] = [];
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const accountIds = [
    ...new Set(document.lines.map((line) => line.accountId)),
  ].sort();
  for (const accountId of accountIds) {
    const account = byId.get(accountId);
    // Foreign is not-found (AC-I-16) — the row is invisible across the
    // organization boundary, exactly like the guard's posture.
    if (
      account === undefined ||
      account.organizationId !== document.organizationId
    ) {
      reasons.push({ problem: 'account_not_found', accountId });
      continue;
    }
    if (!account.isPostable) {
      reasons.push({ problem: 'account_not_postable', accountId });
    }
  }
  return reasons;
}

/**
 * The scope dimension (§6.2 rule 4, AC-I-02/AC-I-14): the stored
 * area/year/period must still be the ones `document_date` resolves to
 * within the document's organization and area. Because years of one area
 * never overlap and periods of one year never overlap (AC-I-03), reading
 * the STORED rows and verifying ownership + date containment is exactly the
 * resolution the finalization transaction validated — a drift (a year whose
 * dates were edited while open) is reported, never re-resolved or guessed.
 */
function scopeReasons(
  document: AccountingDocument,
  scope: PostingReadinessScope,
): PostingReadinessReason[] {
  const reasons: PostingReadinessReason[] = [];
  const { area, fiscalYear, accountingPeriod } = scope;
  if (
    area === null ||
    area.id !== document.financialAreaId ||
    area.organizationId !== document.organizationId
  ) {
    reasons.push({ problem: 'scope_unresolvable', scope: 'area' });
  }
  if (
    fiscalYear === null ||
    fiscalYear.id !== document.fiscalYearId ||
    fiscalYear.organizationId !== document.organizationId ||
    fiscalYear.financialAreaId !== document.financialAreaId ||
    !dateWithin(document.documentDate, fiscalYear)
  ) {
    reasons.push({ problem: 'scope_unresolvable', scope: 'year' });
  }
  if (
    accountingPeriod === null ||
    accountingPeriod.id !== document.accountingPeriodId ||
    accountingPeriod.fiscalYearId !== document.fiscalYearId ||
    !dateWithin(document.documentDate, accountingPeriod)
  ) {
    reasons.push({ problem: 'scope_unresolvable', scope: 'period' });
  }
  return reasons;
}

/** Inclusive date containment, through the one date-only range rule (§6.1). */
function dateWithin(date: Date, range: DateOnlyRange): boolean {
  // A single day is a zero-length range; `dateOnlyRangeWithin` is inclusive
  // on both bounds, which is exactly [start_date, end_date] containment.
  return dateOnlyRangeWithin({ startDate: date, endDate: date }, range);
}
