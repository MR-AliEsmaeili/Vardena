# ADR-0032: Accounting Period Close — In-Transaction Enforcement, Gate Placement and the Reopen Exception

- **Status:** Proposed (2026-09-23 — Task 14 implemented as `READY FOR REVIEW`, not Accepted)
- **Date:** 2026-09-23
- **Implements:** Task 14 (Accounting Period Close Foundation), contract §6.3/§7.2, §15.5, §25 AC-I-04/AC-I-16/AC-I-17
- **Builds on:** ADR-0026 (Accounting bounded context), ADR-0028 (configuration foundation), ADR-0022/0023 (idempotency/numbering), Task 10.7/10.8 (atomic posting), Task 12 (balance projection), Task 13 (operational freeze)
- **Open questions intentionally not absorbed:** OQ-23 (close/reopen policy, reopen/unseal authority, whether posting into a closed period is ever allowed), OQ-27 (correction windows). This ADR records a **decision about the implementation**, it does not answer them.

## Context

The brief for Task 14 asks for an `OPEN → CLOSED → SEALED` lifecycle whose
CLOSED state **deterministically rejects new voucher finalization before any
ledger mutation** — with the enforcement living "inside the same authoritative
transaction boundary as ledger creation, not merely a service-level or
controller-level pre-check" — and it lists `CLOSED → OPEN`, `SEALED → CLOSED`,
`SEALED → OPEN` and `OPEN → SEALED` as rejected transitions "unless the existing
domain specification explicitly permits it".

The existing domain specification **does** permit two of those four, through
operations that already ship:

- `docs/accounting/domain-contract.md` §7.2 rule 4 — *"`closed` refuses new
  documents and new corrections dated in the period. `sealed` refuses
  everything, including a period reopen, **unless the year is unsealed first**
  (§6.3)"*;
- §7.2 rule 5 — *"Status transitions are explicit operations with their own
  permissions (`Accounting.AccountingPeriod.{Open, Close, Reopen, Seal}`),
  reasons and audit records — never inferred from document activity"*;
- AC-I-17 — *"A sealed fiscal year cannot be reopened without a distinct
  permission, a recorded reason and an audit entry; sealed periods cannot be
  reopened while the year is sealed"*.

So `CLOSED → OPEN` (period reopen) and `SEALED → OPEN` (period reopen after the
year was unsealed by its own audited operation) are **contract-sanctioned
exceptions**, not gaps: they are the only backward moves the accepted contract
allows, each behind its own permission, a mandatory reason, an audit event and a
year-level gate. The other two (`SEALED → CLOSED`, `OPEN → SEALED`) are not
operations of this module at all and are refused in code
(`business-rule-violation`), as is `CLOSED → CLOSED`, `SEALED → SEALED` and
`OPEN → REOPEN`.

At the same time, the enforcement that Task 14 describes already existed in
shape: `AccountingDocumentsRepository.finalizeChecked` resolved the document's
calendar scope, locked it (`financial_area → fiscal_year → accounting_period`),
re-read the document under its own lock and asserted the open scope **inside the
same transaction** that writes `state = final`, the ledger entries, the balance
projection and the posting-operation row. What the task therefore had to settle
is *not* whether enforcement exists but **where exactly in that transaction the
locked status is judged**, **which row is authoritative**, and **how the
contract's reopen exception is recorded** so a future reader does not mistake the
`closed → open` endpoint for a missing guard.

## Decision

1. **Enforcement point: the data-layer transaction, never a pre-check.** The
   authority for "may this voucher be finalized" is
   `AccountingDocumentsRepository.finalizeChecked`: it runs in one
   `$transaction`, and the period/year status it judges is read **under the same
   row locks** that the ledger write later commits with. The application service
   (`AccountingDocumentsService.finalizeDocument` → `PostingService.postVoucher`)
   keeps its lifecycle/phase/idempotency orchestration but makes **no** scope
   decision on its own; a service- or controller-level pre-check would be a
   TOCTOU window by construction and is rejected (contract §15.5 step 1).

2. **Authority is the locked row.** The locked `accounting_periods.status` (and
   the locked `fiscal_years.status`/`is_active`) decides. Nothing caches period
   status, no second status column, no in-memory calendar, no event-driven
   mirror. A `close` commits on the same period row a posting locks, so the two
   operations serialize on that row and the loser reads the winner's committed
   status — this is what makes "posting after close" impossible rather than
   merely unlikely.

3. **Gate placement: fail-fast, immediately after the scope locks (lock-order
   row `D4‴`).** `assertOpenScope(scope)` runs as the first action after
   `lockScopeInTx` — before the Task 13 operational-freeze marker, before the
   account `FOR SHARE` locks, before the balance-projection `FOR UPDATE` locks
   and before any write. A refusal therefore holds only the `area → year →
   period` locks that **every** posting takes, touches no configuration/account/
   projection/document row, and cannot queue behind a committing sibling that
   holds those rows. The pre-existing re-assertion **after** the document lock is
   kept: it is the authoritative verdict on the re-read, stored scope (Task 10.7
   staleness check, §15.5). The gate's *predicate* is unchanged (AC-I-04); only
   its *position* moved earlier within the same lock order — **no lock was added,
   removed, moved or split** by this ADR.

4. **Rejection is total: no trace.** Because the refusal happens inside the
   finalization transaction, a rejected finalization leaves *no* ledger entry,
   *no* `state = final`, *no* `accounting_posting_operations` row, *no*
   projection change, *no* `operationally_used_at` marker and no domain event.
   This is verified on real PostgreSQL (not asserted from a rollback in a mock):
   `backend/test/accounting-period-lifecycle-live.e2e-spec.ts`.

5. **Organization ownership of the locked rows is verified inside the
   transaction.** The scope resolver rejects a locked period whose
   `organization_id`/`fiscal_year_id` disagrees with the locked year, and
   `AccountingPeriodsRepository.createChecked`/`transitionChecked` compare the
   caller's organization (and area, on create) against the **locked** year and
   period rows. The service's in-scope resolution remains the user-facing 404
   (AC-I-16); the in-transaction check is the boundary violation that no future
   caller can bypass by handing the repository a foreign id. This is defense in
   depth, not a second authorization model.

6. **The reopen exception is preserved and documented (the brief's "unless the
   existing domain specification explicitly permits it").** `CLOSED → OPEN` and
   `SEALED → OPEN` remain reachable **only** through the shipped, contract-
   sanctioned `POST /accounting-periods/:id/reopen` operation: permission
   `Accounting.AccountingPeriod.Reopen`, a mandatory reason, an
   `AccountingPeriod.Reopened` audit event, and the year-level gate (a sealed
   year must be unsealed first by the distinct audited `FiscalYear.Unseal`
   operation; `reopen` while the year is sealed is refused with
   `business-rule-violation`). **No new bypass is introduced:** no force-close,
   no wildcard/administrative status write, no arbitrary target-status endpoint,
   no "system override" flag. Every other rejected pairing (`SEALED → CLOSED`,
   `OPEN → SEALED`, same-status repeats) stays refused by
   `planAccountingPeriodTransition`.

7. **No schema change, no new endpoint, no new permission, no new event.** Task
   14 ships no Prisma migration: the statuses, the transition set, the
   operations and the events all exist (`open|closed|sealed` with
   `AccountingPeriod.{Opened,Closed,Reopened,Sealed}`). The lifecycle needs no
   column, no table, no enum widening and no backfill, so **no upgrade
   assumption is required** — an existing database is already compliant.

8. **A strict "SEALED is irreversible, full stop" policy is not adopted here.**
   Making `SEALED → OPEN` impossible would contradict §7.2 rule 4, §6.3 and
   AC-I-17, and would silently invert an accepted contract (and delete a shipped
   permission/endpoint). If the product wants that stricter policy, it is an
   explicit additive task: supersede AC-I-17/§7.2 with its own ADR, decide
   OQ-23's reopen/unseal authority, and remove the endpoint + permission in the
   same change. Until then the exception stands, documented — see
   `docs/task-14-implementation-report.md` §10 (Deferred) and OQ-23.

## Alternatives Considered

- **Service-level pre-check only (reject in `PostingService`/controller before
  the transaction).** Rejected: it validates a status that can change before the
  transaction opens — precisely the "posting after close" window Task 14 exists
  to close, and it contradicts §15.5's "inside the transaction" language.
- **Judge the scope *after* the freeze marker / account locks (the pre-Task-14
  order).** Rejected as the *primary* gate: it is correct (the transaction rolls
  back) but it makes a refusal wait on configuration, account, projection and
  document rows it never needed, and it blurs the observable difference between
  "rejected" and "blocked". Kept only as the secondary stored-scope verdict.
- **A database trigger or `CHECK` constraint for the lifecycle.** Rejected:
  Prisma cannot represent it (`prisma migrate dev` would silently drop it — the
  documented drift hazard of the Task 11 partial index), the decision needs the
  document's resolved period and organization context, and the module's
  concurrency contract is row locks in application transactions (AR-11).
- **A new `accounting_period_status_history` table / event-sourced lifecycle.**
  Rejected: audit already comes from the domain event + the row's
  `updated_at`/`updated_by`, and the brief forbids new abstractions/state
  machines without an explicit requirement.
- **Removing `reopen` (strict irreversibility).** Rejected for this task — it
  changes an accepted contract (see Decisions §6/§8).

## Consequences

- The period lifecycle has **one** enforcement point and **one** authority, both
  inside the finalization transaction; the same predicate answers "may this
  document be created in this period", "may it be re-dated here" and "may it be
  finalized here".
- A refused posting is cheap and trace-free; the only rows it touches are the
  calendar rows every posting locks, so close/reseal work never starves behind a
  posting that is about to be rejected.
- The lock-order matrix gains row `D4‴` and the race table `T14-1…T14-4`
  (`docs/accounting/lock-order-matrix.md`); four stale rows (`Y2`, `Y3`, `P1`,
  `P2`) that claimed an area lock they never take are corrected there
  (documentation-only; a subsequence of the global order is not a reordering).
- The reopen exception is now **explicit** in the ADR, the report and the lock
  matrix, so a future reviewer reads `closed → open` as the contract's
  decision, not as a missing guard.
- **Not** decided here: whether posting into a closed period may ever be allowed
  with a special permission (OQ-23), who may reopen/unseal (OQ-23), correction
  windows (OQ-27), year-end closing, retained earnings, period generation.
