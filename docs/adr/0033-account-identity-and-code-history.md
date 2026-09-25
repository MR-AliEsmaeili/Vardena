# ADR-0033: Account Identity and Account Code History — `Account.id` Is Permanent, `code` Is a Business Identifier

- **Status:** Proposed (Owner decisions Q3/Q8/Q18/Q21 + Invariant 1 recorded
  2026-09-25 — Task 17C, documentation only; **not Accepted**, no self-acceptance)
- **Date:** 2026-09-25
- **Implements:** nothing. This ADR authorizes no code, schema, migration,
  endpoint, permission or report; it gates the future tasks that will.
- **Owner source:** [`docs/tasks/task-17/task-17c-prompt.md`](../tasks/task-17/task-17c-prompt.md)
  §5 (Invariant 1), Q3, Q8, Q18, Q21, §8
- **Register:** [`docs/accounting/owner-decision-baseline.md`](../accounting/owner-decision-baseline.md) (rows Q3/Q8/Q18/Q21/I-1)
- **Builds on:** ADR-0026 (bounded context), ADR-0028 (configuration foundation),
  ADR-0031 (balance projection); contract §8.2–§8.6, §9.2–§9.5, AC-D-06/07/08,
  AC-I-10/11/14; OQ-25 (content/policy still open)
- **Companion:** [ADR-0035](./0035-account-code-structure-migration.md) (the only
  sanctioned way a code changes after use)

## Context

The Owner decided that `Account.id` is the permanent accounting identity and that
`Account.code` is a business/display identifier with a *history*. The repository
already satisfies the first half structurally: `accounting_document_lines.account_id`,
`accounting.ledger_entries.account_id` and the projection key
`account_balance_projections (organization_id, financial_area_id, fiscal_year_id,
accounting_period_id, account_id)` all reference the account **id**; no ledger or
projection row stores an account code, and the derived view windows by `account_id`
(ADR-0031 §2/§4). The second half does not exist: `accounts.code` is a single
immutable value per account (`uq_accounts_organization_id_code`), `PATCH
/api/v1/accounting/accounts/:id` publishes "The code is immutable", there is no
code-history table, and every read surface renders the one current code
(Task 17A/17B). Q18 (historical reports show the code valid in the reported
period) therefore has no mechanism today, and Q21's "deletable when never used"
half has no mechanism either (freeze-over-delete, AC-D-08; no `Accounting.Account.Delete`).

## Decision

1. **`Account.id` (ULID) is the permanent Accounting identity.** Ledger rows,
   document lines, balance/projection keys, opening and carry-forward logic,
   correction links, dimension assignments and every internal reference resolve by
   id. This records existing repository behaviour as normative (Invariant 1).
2. **`Account.code` is a business/display identifier**, unique per organization,
   digits-only, composed from the configured coding structure (§9.2/§9.3). It is
   never a semantic source: the tree comes from `parent_id`, the code prefix is only
   its proof (§8.5), and no classification may be inferred from a code range.
3. **A code is a time-scoped fact.** The account model must retain every code an
   account has carried with its validity, so that
   `Account.id → {historical code(s), current code}` is reconstructable at any
   reporting date. *Not implemented*: adding it is an additive schema task with its
   own migration (AR-10/AR-29 — no speculative column is added by this ADR).
4. **Historical resolution rule (Q18, Decision D).** A report over a historical
   context (fiscal year, accounting period, `document_date`) resolves and displays
   the code valid in that context by default, and may additionally expose the
   current code and the historical → current mapping. `Report date → Account.id →
   historical code resolution → report`. A current-code rendering is an explicit
   alternative view, never a silent rewrite of the historical one.
5. **Fiscal-year opening identity.** Opening/carry-forward semantics key on
   `Account.id` (ADR-0031 §4/§9; Task 17B decision D2). A code change can therefore
   never create, split, merge or orphan an opening balance, and a code is never a
   join key between two fiscal years.
6. **Code changes before use (Q3).** While an account has no accounting usage, its
   code may be changed inside the configured structure (validated against the pinned
   coding-structure/configuration levels — §9.2/§9.3, digit lengths included).
   After first use, a code changes **only** through ADR-0035's controlled migration.
   *Repository is currently stricter*: no code-edit path exists at all, so this
   clause is a permitted future relaxation, not a description of today's behaviour
   (discrepancy D-2 of the baseline register).
7. **Deletion vs deactivation (Q21, Decision D).** An account with **no** historical
   accounting usage and no other blocking reference may be deleted. An account with
   historical usage must be deactivated (`is_active = false`), never physically
   deleted; history, balances and reports stay readable (§8.6). **A zero current
   balance is not evidence of no usage** — `+100M / −100M = 0` is historical usage.
   "Usage" is therefore defined by the existence of referencing accounting history
   (document lines / ledger entries), never by a balance test. *Repository today*:
   no account deletion exists (no endpoint, no permission) — the implemented rule is
   the stricter half only (discrepancy D-4 of the baseline register).
8. **Integrations.** External systems and adapters must reference accounts by id.
   A code may be exposed as a *controlled business reference* only where an
   integration contract explicitly designs for it (ADR-0003 adapter isolation), and
   such a contract must state which code (current or as-at-a-date) it means.

## Consequences

- Reporting, opening logic and legal profiles gain a code-resolution seam
  (ADR-0036 §5); anything that caches "the account code" as a key becomes a defect.
- The never-reuse rule (§8.6/AC-I-11) and `uq_accounts_organization_id_code` must be
  re-expressed for a history model: whether a superseded code may ever be re-issued
  is **not decided here** and stays open under OQ-25 (baseline register §5, item O-1).
- Q21's deletion half needs its own task: a reference check over accounting history,
  a granular permission (AR-22, no wildcard — OQ-21), and an answer on code reuse
  after deletion (OQ-36 posture). Until then the implemented freeze-over-delete
  behaviour is unchanged and remains correct.
- ADR-0035's migration writes code *history*; it never rewrites ledger rows
  (Invariant 3), which this ADR's §1 makes possible because ledger rows carry ids.
- No production, schema, migration, API, permission or test change is made by this
  ADR; OQ-25 stays OPEN for everything not decided above.

## Links

- Register: [`docs/accounting/owner-decision-baseline.md`](../accounting/owner-decision-baseline.md)
- Contract: [`docs/accounting/domain-contract.md`](../accounting/domain-contract.md) §8.2–§8.6, §9.2–§9.5, §25 (AC-I-10/11/14), §31 addendum
- Evidence: `backend/prisma/schema/accounting.prisma` (`Account`, `LedgerEntry`,
  `AccountBalanceProjection`), `backend/src/modules/accounting/domain/account.ts`,
  `backend/src/modules/accounting/api/accounts.controller.ts`
- Related: ADR-0031 §2/§4/§9 (opening window), ADR-0034 (posting/aggregation),
  ADR-0035 (code migration), ADR-0036 (legal reporting), OQ-25, OQ-36
