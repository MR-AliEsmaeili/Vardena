import type { AccountingDocumentPhase } from '../domain/accounting-document.js';
import type { AccountingDocumentOriginProblem } from '../domain/accounting-document.js';
import type { VoucherLineProblem } from '../domain/voucher-lines.js';

/**
 * Guard failures that can only be detected INSIDE the guarded transactions of
 * the accounting-document repositories (Task 10.4, contract §12/§13/§15/§18).
 *
 * Same contract as `accounting-calendar-errors.ts` and
 * `accounting-structure-errors.ts`: the repository stays HTTP-free (AR-02/04)
 * and throws one of these plain errors; the application service maps it onto
 * the stable API error model. The in-memory test fakes throw the SAME errors,
 * so one mapping covers both paths.
 */

/**
 * The document moved while the request was in flight — it is no longer in the
 * phase the caller planned from. A 409 (conflict), never a 422: the request
 * was valid against the state it read, the state simply changed underneath it
 * (the `PeriodTransitionConflictError` precedent).
 */
export class AccountingDocumentPhaseConflictError extends Error {
  readonly actual: AccountingDocumentPhase;
  readonly expected: AccountingDocumentPhase;

  constructor(
    actual: AccountingDocumentPhase,
    expected: AccountingDocumentPhase,
  ) {
    super(`The accounting document is "${actual}", not "${expected}".`);
    this.name = 'AccountingDocumentPhaseConflictError';
    this.actual = actual;
    this.expected = expected;
  }
}

/**
 * Final protection reached the DATABASE path (§15.2, AC-I-05/06). The service
 * refuses an edit/delete of a final voucher before touching the repository, so
 * reaching this error means a concurrent finalization won the race — the
 * caller re-reads and sees `final`.
 *
 * The error carries the offending phase so the mapping names what happened
 * without re-reading.
 */
export class AccountingDocumentFinalProtectedError extends Error {
  readonly phase: AccountingDocumentPhase;

  constructor(phase: AccountingDocumentPhase) {
    super('Final accounting documents are immutable and cannot be deleted.');
    this.name = 'AccountingDocumentFinalProtectedError';
    this.phase = phase;
  }
}

/**
 * The line set is not a legal double-entry composition (§13, AC-I-07/08):
 * unbalanced, fewer than two lines, a missing debit or credit side, a
 * zero/both-sided line, a malformed amount or a non-dense numbering.
 *
 * Raised by the composition path and again INSIDE the finalization
 * transaction, where the STORED lines are the authority — a concurrent edit
 * cannot slip an unbalanced document past finalization.
 */
export class AccountingDocumentLineRejectedError extends Error {
  readonly problems: readonly VoucherLineProblem[];

  constructor(problems: readonly VoucherLineProblem[]) {
    super(
      `The accounting document lines are invalid (${problems.join(', ')}).`,
    );
    this.name = 'AccountingDocumentLineRejectedError';
    this.problems = problems;
  }
}

export type AccountingDocumentAccountProblem =
  /** The account does not exist, or belongs to another organization. */
  | 'account_not_found'
  /** The account is disabled (`is_active = false`, §8.6). */
  | 'account_disabled'
  /** Posting eligibility (§14, AC-I-09): `is_postable` is false. */
  | 'account_not_postable';

/**
 * A line references an account that may not receive it (§14, AC-I-09).
 * Re-evaluated under the account's `FOR SHARE` lock, so a concurrent
 * postability flip or deactivation is either observed or blocked — never
 * silently ignored (the AC-I-09/AC-I-11 interlock, `accounting-locks.ts`).
 *
 * A missing or foreign account is deliberately a distinct problem: the service
 * maps it to 404 (AC-I-16 — a foreign row is indistinguishable from a missing
 * one), while ineligible-but-visible accounts are 422.
 */
export class AccountingDocumentAccountRejectedError extends Error {
  readonly accountId: string;
  readonly problem: AccountingDocumentAccountProblem;

  constructor(accountId: string, problem: AccountingDocumentAccountProblem) {
    super(`Account "${accountId}" cannot receive document lines (${problem}).`);
    this.name = 'AccountingDocumentAccountRejectedError';
    this.accountId = accountId;
    this.problem = problem;
  }
}

/**
 * The `document_date` resolved to no fiscal year, or to a period, or resolved
 * to a period whose year does not match (§6.2 rule 3, AC-I-02). No implicit
 * year creation, no nearest-year guessing.
 */
export class AccountingDocumentDateUnresolvableError extends Error {
  readonly documentDate: Date;

  constructor(documentDate: Date) {
    super('The document date resolves to no accounting period.');
    this.name = 'AccountingDocumentDateUnresolvableError';
    this.documentDate = documentDate;
  }
}

/**
 * The resolved calendar cannot accept the document (§7.2 rule 4, §6.3,
 * AC-I-04): the period is `closed`/`sealed`, or the year above it is
 * `closed`/`sealed`. Fail closed — the contract's default for posting into a
 * locked period (§7.2 rule 8).
 *
 * The service pre-checks to produce a precise message; the repository
 * re-evaluates under the year/period row locks, where the status is the
 * committed one. Notably, the year's status is authoritative: a period that
 * still reads `open` under a closed year is refused.
 */
export class AccountingDocumentScopeRejectedError extends Error {
  readonly scope: 'area' | 'year' | 'period';
  readonly status: string;

  constructor(scope: 'area' | 'year' | 'period', status: string) {
    super(
      `The ${scope} is "${status}" and cannot accept the accounting document.`,
    );
    this.name = 'AccountingDocumentScopeRejectedError';
    this.scope = scope;
    this.status = status;
  }
}

/**
 * The voucher header violates a schema-level uniqueness rule: a duplicate
 * number in the (organization, area) scope. The `documents` allocation ledger
 * is the authoritative allocator (ADR-0023 §3) and cannot hand out a serial
 * twice; this error is the accounting-side backstop speaking, which means a
 * hand-written row, a restored dump or a bug — never a normal race.
 */
export class AccountingDocumentNumberConflictError extends Error {
  readonly documentNumber: string;

  constructor(documentNumber: string) {
    super(`The accounting document number "${documentNumber}" already exists.`);
    this.name = 'AccountingDocumentNumberConflictError';
    this.documentNumber = documentNumber;
  }
}

/**
 * The document's financial AREA cannot change any more (AC-D-03: it is
 * immutable once the document is issued). A `draft` has no serial yet and may
 * still move; re-homing a `temporary`/`final` voucher would move a number
 * across series, because the number's scope IS the area (§18).
 */
export class AccountingDocumentAreaImmutableError extends Error {
  constructor() {
    super(
      'The financial area of an issued accounting document cannot change: the document number belongs to that area’s series.',
    );
    this.name = 'AccountingDocumentAreaImmutableError';
  }
}

/** The `origin`/source-identity pair is inconsistent (§16.1/§16.3). */
export class AccountingDocumentOriginRejectedError extends Error {
  readonly problem: AccountingDocumentOriginProblem;

  constructor(problem: AccountingDocumentOriginProblem) {
    super(`The accounting document origin evidence is invalid (${problem}).`);
    this.name = 'AccountingDocumentOriginRejectedError';
    this.problem = problem;
  }
}

/**
 * The document is not there (any more). The service resolves every by-id
 * action in scope first, so this is either a foreign document (AC-I-16: the
 * same 404 as a missing one) or a concurrent deletion of a pre-final voucher
 * (§15.3) that won the race — both answers are "not found".
 */
export class AccountingDocumentMissingError extends Error {
  constructor() {
    super('The accounting document does not exist.');
    this.name = 'AccountingDocumentMissingError';
  }
}

/**
 * The document changed while the request was in flight (a concurrent edit
 * replaced its lines, re-dated it or moved its scope). The guard refuses to
 * validate one version while writing into another; the caller re-reads and
 * retries (a 409, never a 422 — the request was valid against the state it
 * read).
 */
export class AccountingDocumentStaleError extends Error {
  constructor() {
    super(
      'The accounting document changed while the request was in flight. Refresh and retry.',
    );
    this.name = 'AccountingDocumentStaleError';
  }
}
