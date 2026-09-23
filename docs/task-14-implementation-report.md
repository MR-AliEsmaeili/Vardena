# Task 14 — Accounting Period Close Foundation: Implementation Report

- **Status:** **READY FOR REVIEW — NOT ACCEPTED**
- **Date:** 2026-09-23
- **Task:** Task 14 — Accounting Period Close Foundation (backend/domain only)
- **Branch:** `arena/01a0cf1f-vardena` (PR **#32** → `main`)
- **Base commit:** `2ea11609170f7fd52916068603b02955cae819a2` (`main`, = merge of PR #31)
- **Change commit:** `31442cf` (evidence + docs commit recorded in §11)
- **Decision record:** [`docs/adr/0032-accounting-period-close-enforcement.md`](./adr/0032-accounting-period-close-enforcement.md) (Proposed)
- **Concurrency reference:** [`docs/accounting/lock-order-matrix.md`](./accounting/lock-order-matrix.md) rows `D4‴`, `T14-1…T14-4`
- **Scope decision (user, this session):** *"harden, prove, document"* — the enforcement layer is **not** re-implemented, and the deliverable is not verification-only.
- **Contract exception (user, this session):** the shipped, contract-permitted `reopen` operation is **kept** (no endpoint/permission removed, no contract change).

## 0. How to read the evidence

| Label | Meaning in this report |
| --- | --- |
| **VERIFIED** | Executed in this sandbox against a real PostgreSQL 17.10 database that has all 14 migrations applied; exact command and result given. |
| **REPORTED** | Executed by a system this report does not control (CI), with the run id / job conclusion quoted. |
| **INFERRED** | Follows from code reading or from a verified run; **not** directly executed. |
| **UNVERIFIED** | Not executed anywhere yet. Never claimed as passing. |

**Environment used here (VERIFIED):** PostgreSQL **17.10** on `127.0.0.1:5432`, database `vardena_test` (all 14 migrations applied), Node **22.22.3**, Prisma client generated locally (`prisma generate`) from `prisma/schema`. The two Prisma *engine downloads* are network-blocked in this sandbox, so the schema engine is not executable here — see §3 and §9 (`L-1`).

## 1. Summary

The task asks for an accounting-period lifecycle `OPEN → CLOSED → SEALED` in which a **CLOSED** period deterministically rejects new voucher finalization **before any ledger mutation**, where the enforcement lives **inside the same authoritative transaction boundary as ledger creation** (not a controller/service pre-check), where **SEALED** is irreversible except through explicitly approved/audited paths, where every transition is organization-scoped, atomic, validated against persisted state, stale/concurrency-safe and audited, and where the locking strategy is the smallest that works.

**Finding that shaped the work (VERIFIED by reading the tree at the base commit):** the lifecycle, the statuses (`open|closed|sealed`), the explicit transition operations (permission- and reason-gated), the pure transition planner, the audit events and — crucially — an in-transaction enforcement point already existed:

- `AccountingDocumentsRepository.finalizeChecked` resolved and locked the document's calendar scope (`financial_area → fiscal_year → accounting_period`), re-read the document under its own lock and asserted the open scope **inside the same `$transaction`** that writes `state = final`, the ledger entries, the balance projection and the posting-operation row;
- `planAccountingPeriodTransition` already refuses `OPEN → SEALED`, `CLOSED → CLOSED`, `SEALED → CLOSED`, `SEALED → SEALED`, `OPEN → REOPEN`;
- `AccountingPeriodsService.transitionAccountingPeriod` already maps "moved in flight" → 409 and "refused move" → 422, with a mandatory reason and an `AccountingPeriod.{Closed,Reopened,Sealed}` event.

So the honest task was **not** "build the lifecycle". It was: make the enforcement point *provably* the first thing that happens in the finalization transaction, make the organization boundary hold *on the locked rows*, prove every behaviour the brief lists — including both orders of the posting/close race — on **real PostgreSQL**, and document the one place where the brief's rejected-transition list and the accepted contract disagree.

**What changed (production, 4 files, no new lock):**

1. The Task 14 gate in `finalizeChecked` now runs **first**: `assertOpenScope(scope)` immediately after `lockScopeInTx`, i.e. **before** the Task 13 operational-freeze marker, **before** the account `FOR SHARE` locks, **before** the balance-projection `FOR UPDATE` locks, **before** the document lock and **before any write**. The existing post-document-lock assertion is kept as the authoritative stored-scope verdict (§15.5 step 1). The *predicate* is unchanged (AC-I-04); only its position moved earlier inside the same total lock order (new row `D4‴`). A refusal now holds only the `area → year → period` locks that every posting takes anyway — it cannot queue behind a committing sibling's configuration/account/projection/document rows.
2. The scope resolver verifies that the **locked** period's `organization_id` and `fiscal_year_id` agree with the locked year — the authoritative in-transaction tenant check.
3. `AccountingPeriodsRepository.createChecked` / `transitionChecked` verify the caller's organization (and the area, on create) against the **locked** year/period rows, and the transition is planned against the **locked** status, so a move is never applied to a stale `open`. `TransitionAccountingPeriodCheckedInput` carries `organizationId`; `LockedAccountingPeriod` now carries `organizationId`.
4. `docs/accounting/lock-order-matrix.md` rows `Y2`, `Y3`, `P1`, `P2` were **corrected** (documentation only): those four operations never took the `financial_area` lock the matrix claimed. That is a *subsequence* of the global order, not a reordering — no cycle, but the matrix has to say what the code does.

**What deliberately did not change:** no Prisma schema/migration (§3), no endpoint, no permission, no event name, no new error code (§4), no new lock position (§6), no unrelated module (§2).

**The one place the brief and the contract disagree (documented, not silently resolved):** the brief lists `CLOSED → OPEN` and `SEALED → OPEN` as rejected "unless the existing domain specification explicitly permits it". `docs/accounting/domain-contract.md` §7.2 rules 4–5 and AC-I-17 **explicitly permit** both, through the shipped `reopen` operation (permission `Accounting.AccountingPeriod.Reopen`, mandatory reason, audit event, and a sealed year must be unsealed first by its own audited operation). ADR-0032 §6/§8 records the decision to **keep** that exception and why removing it would be a contract change (not an implementation detail), together with the additive path a stricter policy would take (supersede AC-I-17, decide OQ-23, remove the endpoint + permission). The other two pairings (`SEALED → CLOSED`, `OPEN → SEALED`) stay refused in code and are covered by tests.

## 2. Files changed

Production (`backend/src/modules/accounting/`):

| File | Change |
| --- | --- |
| `data/accounting-documents.repository.ts` | Task 14 gate first (after `lockScopeInTx`); locked-period organization/year check in the shared scope resolver; JSDoc + lock-order header paragraph explaining the position and the no-trace guarantee. **No lock added, moved or split.** |
| `data/accounting-locks.ts` | `LockedAccountingPeriod` gains `organizationId`; `lockAccountingPeriodRow` selects `organization_id`. Header notes the Task 14 posture (order unchanged). |
| `data/accounting-periods.repository.ts` | `TransitionAccountingPeriodCheckedInput` gains `organizationId`; `createChecked` rejects a locked year that is not the caller's organization/area; `transitionChecked` rejects a locked year **or** period that is not the caller's organization before the status gate; JSDoc. |
| `application/accounting-periods.service.ts` | Passes `organizationId` into `transitionChecked`; JSDoc stating the plan is re-evaluated against the locked row (409 moved / 422 refused / sealed-year gate). |

Test support mirrors (so the in-memory doubles cannot drift from the SQL):

| File | Change |
| --- | --- |
| `backend/test/support/accounting-repositories.ts` | `createChecked` mirrors the locked-year organization/area guard; `transitionChecked` requires `organizationId` and rejects year/period organization mismatch before the status conflict + `PeriodYearSealedError`. |
| `backend/test/support/accounting-document-repositories.ts` | Fake `finalizeChecked` calls `assertOpenScope(scope)` right after `resolveScope` (first step of the faked transaction). |

Tests:

| File | Change |
| --- | --- |
| `backend/test/accounting-period-lifecycle-live.e2e-spec.ts` | **New** live PostgreSQL suite, 13 tests (§7). Skipped unless `VARDENA_TEST_DATABASE_URL` is set; raw-SQL fixtures with a full `afterAll` cleanup; its own `application_name` so the concurrency probes cannot see other suites. |

Docs: `docs/adr/0032-accounting-period-close-enforcement.md` (new), `docs/accounting/lock-order-matrix.md`, `docs/accounting/task-index.md`, `docs/modules.md`, `docs/open-questions.md` (OQ-23 note), `docs/adr/README.md` (index rows for 0031/0032 — 0031 was missing), this report.

**Diff size:** `+1635 / −20` across 13 files — 4 production files (~120 meaningful lines, most of it documentation), 2 test-support files, 1 new test file (1260 lines), 1 new ADR + 5 doc files. The 1260-line test file is the bulk; per AG-19 the *production* change is ~120 lines and the rest is verification, deliberately **not** split from the change it verifies (a period-lifecycle race suite without the gate placement would test nothing).

## 3. Schema, migration and upgrade assumptions

**No schema change. No migration. No backfill. No upgrade assumption.**

- `git status --porcelain backend/prisma/` is empty; `backend/prisma/migrations/` still contains exactly the 14 existing migrations; `npx prisma validate` → *"The schemas at prisma/schema are valid"* (**VERIFIED**).
- The lifecycle needs no column: `accounting.accounting_periods.status` and `accounting.fiscal_years.status` already exist with the three values; transitions, permissions and events exist; the organization column exists on both tables (used by the new checks). Nothing to default, nothing to backfill, so an existing database is already compliant — Task 14 is a pure code + test + docs change.
- **Migration verification (VERIFIED):** all 14 migration files were applied **in lexical order, each in its own transaction, to a brand-new empty database** (`vardena_clean_t14`). Result: 14/14 applied, and a catalog comparison against the fully migrated working database (`information_schema` tables, views, columns with nullability, `pg_indexes`, `pg_constraint` definitions, sequences over all nine schemas) is **identical — 999 objects each, zero drift in either direction**.
- **Not executed here (UNVERIFIED in this sandbox, REPORTED by CI):** the real `npx prisma migrate deploy`. Its `schema-engine` binary download is network-blocked here, so the wrapper cannot run; the equivalent raw-SQL application above is what this sandbox can prove. CI runs `npm run prisma:deploy` against `postgres:16` on every push (§8), which is the authoritative gate for this item.

## 4. Contracts, APIs and error surface

**Unchanged:** no endpoint added, removed or modified; no permission added or removed; no DTO change; no event name or payload change; no new error code.

- Period transitions stay `POST /api/v1/accounting-periods/:id/{close,reopen,seal}` with a mandatory `reason`, gated by `Accounting.AccountingPeriod.{Close,Reopen,Seal}`; year transitions keep `{close,reopen,seal,unseal}` and `Accounting.AccountingPeriod.{Open,Close,Reopen,Seal}`/year codes exactly as they were. There is **no** endpoint that accepts an arbitrary target status, and none was added (§6 of ADR-0032).
- **The refusal contract for a closed/sealed period is the existing one:** `AccountingDocumentScopeRejectedError` → `422 businessRule` with details `{ scope: 'area'|'year'|'period', status }` and the message *"The period is "closed": a document cannot be created, moved or finalized in a closed or sealed book (§7.2 rule 4/8)."* Task 14 changes **when** it is raised inside the finalization transaction, not what the caller sees (**VERIFIED** by the live suite asserting `{scope:'period', status:'closed'|'sealed'}`).
- A period that moved while the request was in flight still answers **409** (`PeriodTransitionConflictError`), a refused move still answers **422** (`BusinessRuleViolation`), a foreign id still answers **404** (AC-I-16), and a sealed year still gates `close`/`reopen` with `BusinessRuleViolation` (§7.2 rule 4) — all exercised in the live suite and in the pre-existing unit suites.
- Idempotency semantics are untouched: a replay of an already finalized voucher returns the stored result through the posting-operation ledger and writes nothing new; a refusal is not recorded as an operation, so nothing is "replayed" that never happened (§16.4).

## 5. Integration point

The enforcement point is the **repository transaction**, and the reason is concrete rather than stylistic:

```
AccountingDocumentsService.finalizeDocument            (application)
  └─ PostingService.postVoucher                        (orchestration: resolve → idempotency → lifecycle verdict → persist → event → readiness)
       └─ AccountingDocumentsRepository.finalizeChecked (data) — ONE $transaction:
            header read (org-scoped)
            lockScopeInTx:      financial_area FOR UPDATE → fiscal_year FOR UPDATE → accounting_period FOR UPDATE
            assertOpenScope     ← TASK 14 GATE (first: locked status authorizes the whole transaction)
            accountIdsInTx + Task 13 freeze marker (configuration rows)
            accounts FOR SHARE (ascending id)
            balance projections FOR UPDATE (by key, ascending)
            accounting_document FOR UPDATE
            phase + staleness + stored-scope checks → assertOpenScope (stored-scope verdict)
            composition re-check
            UPDATE accounting_documents SET state = 'final'
            INSERT ledger_entries (one per line)
            balance projection UPSERT/DELETE
            INSERT accounting_posting_operations (LAST)
```

- **Why not a service-level or controller-level pre-check:** between any such check and the write there is an unbounded window in which another transaction can commit `close`; the check would validate a status that is no longer true. The brief forbids it, §15.5 requires it, and it is the classic TOCTOU shape.
- **Why the locked row is the authority:** `close` and `finalize` both take `FOR UPDATE` on the same `accounting_periods` row, so they serialize on it. Whichever commits first is exactly what the other reads afterwards — "posting after close" is impossible by construction, not by timing (§6, races `T14-1`/`T14-2`).
- **Why the gate moved to the front:** a refusal should be decided while the transaction holds the least it can hold. Judging the locked status first means a rejected posting touches only the calendar rows every posting locks, so it cannot block behind (or add load to) the freeze marker, account locks, projection locks or the document lock, and its failure mode is unambiguous — the test that discriminates the two placements holds an `accounting_configuration` row `FOR UPDATE` in an unrelated transaction: the refusal must still arrive promptly rather than queueing behind it (§7, test 9; the probe was validated as non-vacuous, see §7.4).
- **Refusal is total:** because the gate throws inside the finalization transaction, the transaction rolls back — no ledger entry, no `state = final`, no operation row, no projection delta, no marker, no event (**VERIFIED** on real PostgreSQL, not inferred from a mock).

## 6. Concurrency and lock-order analysis

**Lock order at the base commit, and after Task 14, is unchanged and total:**

```
financial_area (FOR UPDATE)
  → fiscal_year (FOR UPDATE)
    → accounting_period (FOR UPDATE)
      → coding_structure_version / accounting_configuration (FOR UPDATE)   [chart writes; Task 13 marker]
        → account (FOR SHARE for voucher writes, FOR UPDATE for chart writes, ascending id)
          → account_balance_projections (FOR UPDATE, composite key order)   [Task 12]
            → accounting_document (FOR UPDATE, last)
```

- **No lock was added, removed, moved or split by Task 14.** The only ordering change is *which statement runs first* inside the already-ordered transaction: the status judgement. The lock *acquisition* sequence of a successful finalization is byte-for-byte what it was; a *rejected* finalization simply stops after the third lock instead of walking the rest of the chain.
- **Locks held by a refused posting:** `financial_area`, `fiscal_year`, `accounting_period` — the exact prefix every posting takes. No configuration, no account, no projection, no document row. This is the "smallest locking strategy" the brief asks for: the gate adds zero locking and *reduces* the footprint of the refusal path.
- **No broad table locks:** all statements are row locks on specific `WHERE "id" = …` (or `ORDER BY id ASC` multi-row) predicates; `LOCK TABLE`, `SELECT … FOR UPDATE` without a predicate, and serializable-isolation tricks are absent. Ledger rows are insert-only and never locked (as before).
- **No deadlock:** the total order above is never reversed. The two operations that race here (`finalizeChecked`, `period transition`) both take `fiscal_year → accounting_period` in that order, and neither ever later takes `financial_area`, so adding the organization checks introduced no new edge. The one behavioural difference the brief cares about — a posting that waits instead of being refused — is exactly what test 7 (`T14-1`) asserts.
- **Races executed on real PostgreSQL (VERIFIED, `T14-1…T14-4` in the matrix):**

| # | Race | Required and observed outcome |
| --- | --- | --- |
| `T14-1` | finalize (voucher in period P) vs `close(P)`, finalize first | finalize commits (`state=final`, N ledger rows, 1 operation row, projections); `close` then sees the committed `open` and applies `open→closed`. **Both succeed, no bypass.** |
| `T14-2` | same pair, `close` first | finalize refused `{scope:'period', status:'closed'}` with **zero trace**: 0 ledger rows, document still `temporary`, 0 operation rows, marker `NULL`, no projection row, no event. |
| `T14-3` | two concurrent `close(P)` | one wins; the loser re-reads the **locked** row, `planAccountingPeriodTransition` refuses `closed→closed`, it answers 409 with no status write and no second event. Exactly one `AccountingPeriod.Closed`. |
| `T14-4` | foreign organization id reaching the repositories | refused inside the transaction (locked-row organization check); the service's in-scope resolution still answers 404 first for a foreign id, and the live test additionally posts a **real** voucher with the foreign scope and calls `finalizeChecked` under the foreign organization — both rejected, document unchanged, 0 ledger rows. |

- **Deadlock-freedom argument that Task 14 had to re-check:** the four corrected matrix rows (`Y2`, `Y3`, `P1`, `P2`) never took the area lock, so the previously published "area first" claim was wrong for them. They take `fiscal_year` (then `accounting_period`) only — a strict *subsequence* of the global order — and they never subsequently acquire an area lock, which is precisely the invariant `accounting-locks.ts` states ("no transaction holding a year lock ever waits on an area lock"). Correcting the matrix does not change the code; it removes a false statement that a future change could have been validated against.

## 7. Tests added, changed and executed

### 7.1 New live suite — `backend/test/accounting-period-lifecycle-live.e2e-spec.ts` (VERIFIED: 13/13 passed)

Real PostgreSQL 17.10, real repositories, real transactions, independent connections from a connection pool for every probe. Fixtures are raw SQL (organization → area → year → period → accounts → coding structure → configuration) with a full `afterAll` cleanup; the suite tags its own connections with `application_name` so its `pg_stat_activity` lock probes can never observe another suite.

| # | Test | Proves |
| --- | --- | --- |
| 1 | finalizes into an OPEN period and commits the whole posting | positive control: `state=final`, 2 ledger rows, 1 operation row, 2 projection rows |
| 2 | refuses finalization in a CLOSED period and leaves no trace | `{scope:'period', status:'closed'}`; 0 ledger rows, document `temporary`, 0 operation rows, no marker, no projection, no event |
| 3 | refuses finalization in a SEALED period and leaves no trace | same, `status:'sealed'` |
| 4 | applies OPEN → CLOSED → SEALED and refuses every other move | the full transition truth table on persisted state: `open→close→closed`, `closed→seal→sealed` applied; `open→seal`, `open→reopen`, `closed→close`, `sealed→close`, `sealed→seal` refused 422; events = exactly one per committed move, none on refusal |
| 5 | keeps the contract's explicitly permitted reopen, gated by the year | `closed→reopen→open` succeeds (permission + reason + event), posting resumes; sealing the **year** makes `reopen` refuse (`BusinessRuleViolation`) while the period stays `closed`; `sealed→reopen` refuses while the year is sealed (AC-I-17) |
| 6 | never crosses the organization boundary | foreign-org voucher post → `EntityNotFound`; `finalizeChecked` under the foreign org → rejected with the document untouched and 0 ledger rows; repository `transitionChecked`/`createChecked` reject a foreign organization on locked rows |
| 7 | lets a posting that already holds the calendar win: the close queues behind it | `T14-1`: both commit; period ends `closed`, document ends `final`, evidence complete |
| 8 | refuses a posting that follows a close: the closed period is the final word | `T14-2` with a real `pg_stat_activity` wait probe (the posting demonstrably queues on the period lock, then is refused) |
| 9 | **refuses a closed period without touching the configuration the posting would mark** | **gate placement**: with an unrelated transaction holding an `accounting_configuration` row `FOR UPDATE`, the refusal arrives promptly (5 s budget, refusal observed immediately) — i.e. it never walks the Task 13 marker path. `L-4`/§7.4 |
| 10 | settles two concurrent closes of one period with exactly one winner | `T14-3`: one status change, one event, the loser 409 |
| 11 | marks no configuration when the finalization is refused by a closed period | `operationally_used_at` stays `NULL` (with a positive control in test 1 that finalization *does* mark it) — the "no marker changes" requirement |
| 12 | leaves finalized rows untouched by a later close, and keeps sibling periods open (Tasks 10–13 intact) | close+seal do not move, delete or rewrite finalized documents/ledger rows; readiness verdict stays `ready`; a sibling OPEN period in the same year still posts |
| 13 | keeps the refused voucher postable again once the period is reopened | the refusal is a state decision, not a poisoned document: after the permitted reopen the same voucher finalizes normally |

Race technique: an independent `$transaction` holds the row `FOR UPDATE` (its own connection, generous timeouts); the test waits until `pg_stat_activity` reports a **waiting** backend of this suite on a calendar statement (`wait_event_type='Lock'`, `query ILIKE '%accounting_periods%'/'%fiscal_years%'`, filtered by `application_name`), which is evidence that the transaction really queued rather than a sleep-and-hope. Holders are released in `try/finally`, so a failed assertion cannot leave a lock behind for the next test.

### 7.2 Suites re-run (VERIFIED)

| Command | Result |
| --- | --- |
| `npx vitest run --config vitest.config.e2e.ts test/accounting-period-lifecycle-live.e2e-spec.ts` | **13/13 passed** (2115 ms) |
| `npm test` (unit + component) | **88 files / 1017 tests passed** (no failures, no skips) |
| `npm run test:e2e` (all e2e incl. every live suite) | **24 files / 249 tests passed** — 24 files vs. 23 and 249 tests vs. 236 before this change: the delta is exactly the new suite, so the pre-existing live suites ran and passed (none skipped) |
| `npm run test:migration-rehearsal` | **PASSED** (5 organizations, 9 accounts, 4 configurations, 8 levels; lock probe + assertions) |

### 7.3 Existing unit coverage for the transition table (VERIFIED)

`accounting-period.spec.ts` tabulates the moves; Task 14 did not change the planner. The live suite above re-proves the same table against **persisted PostgreSQL state** through the real service, which is what the brief asks for ("validated against persisted state").

### 7.4 Anti-vacuity check for the gate-placement test (VERIFIED)

Test 9 must fail if the gate is moved back after the freeze path; otherwise it proves nothing. It was validated by temporarily removing the early gate (keeping the post-document-lock one) and re-running only that test: **it failed** (`expected 'blocked' not to be 'blocked'` — the refusal queued behind the held configuration row until the 5 s timeout). The production file was restored immediately afterwards (`grep` confirms both `assertOpenScope` call sites and no marker comment), and the suite was re-run 13/13. *This is verification of the test, not a shipped change.*

## 8. CI status

**REPORTED — required job green.** PR **#32** (`arena/01a0cf1f-vardena` → `main`), head `31442cf`, run **`35893640670`** (`2026-09-23T17:09:08Z → 17:12:07Z`), job `backend`: **`completed success`** (`pass`, 2 m 54 s).

The job executes, in order: `npm ci` (npm 11), `prisma validate`, **`prisma generate`**, lint, typecheck, format:check, **unit tests (1017)**, build, **`npm run prisma:deploy` against the `postgres:16` service container**, the Task 11 migration rehearsal, and **`npm run test:e2e` including every live-DB suite** — `VARDENA_TEST_DATABASE_URL` is job-level, so the new suite's `skipIf` does not fire there: its **13 tests really executed against PostgreSQL 16 in CI and passed**, which independently reproduces §7.1 outside this sandbox. The run's annotations are the 4 pre-existing lint warnings (0 errors) and Node-20 deprecation notices; there are no failures.

This closes the two gates this sandbox cannot execute (§3, `L-1`): the real `prisma migrate deploy` and the CI-run live suites. A docs-only commit (this report + the task-index CI record) follows; its run is recorded in the task index §9.

## 9. Known limitations and risks

| id | Item | Classification |
| --- | --- | --- |
| `L-1` | `prisma migrate deploy` and `prisma generate` cannot execute in this sandbox (Prisma engine downloads are network-blocked); the equivalent migration application + catalog comparison was done by hand (§3). CI runs the real command. | **REPORTED** (CI) / local substitution VERIFIED |
| `L-2` | The live suite exercises the **data plane** in system context; HTTP authorization (401/403, permission mapping) is covered by the existing e2e/unit suites for these endpoints, not by the new suite. No authz change was made by Task 14, but the new tests do not re-prove it. | **VERIFIED** as a design boundary; authz itself is pre-existing coverage |
| `L-3` | The `reopen` exception means `CLOSED → OPEN` (and `SEALED → OPEN` after a year unseal) remain possible by design. A reviewer who reads the brief's rejected-transition list strictly will see this as a deviation — it is the contract's decision, recorded in ADR-0032 §6/§8 and in OQ-23, not an omission. | **VERIFIED** (documented decision) |
| `L-4` | Test 9's budget is a wall-clock bound (5 s) around a refusal that is expected to be immediate; a pathologically slow (but correct) refusal would fail the test. The failure mode is a false negative, never a false pass. | **INFERRED** |
| `L-5` | The refusal's 422 message string still cites *"§7.2 rule 4/8"* for create/move/finalize alike (pre-existing wording). The finalize path is governed by rule 4; the wording was left untouched because it is user-visible contract text asserted by no test. | **VERIFIED** (string inspected; no test asserts it) |
| `L-6` | Task 13 (operational freeze) is still **IN PROGRESS (self-review)** in the task index; tests 9 and 11 assert marker behaviour, so the live suite depends on Task 13's code that is in the same tree but not Accepted. | **VERIFIED** |
| `L-7` | The new live suite creates and drops its own rows via raw SQL; a crashed run can leave fixtures behind (the cleanup runs in `afterAll`). Fixtures are prefix-namespaced (`T14-…`) and per-test years (2030+i) so a rerun does not collide. | **INFERRED** |
| `L-8` | The four corrected lock-matrix rows were corrected from code reading; no runtime probe was written to assert that a period transition never waits on an area lock (the deadlock rehearsal harness of Task 11/13 could be extended to do so). | **UNVERIFIED** (nice-to-have) |

## 10. Deferred (explicitly out of scope, not implemented)

Per the brief's prohibition list, none of the following was built, and no stub, flag or TODO was left behind for them: year-end closing; retained-earnings transfer; tax settlement; financial statements; reopening/unsealing **beyond** the existing contract; bulk period generation; rollover; adjustments; audit UI; frontend; unrelated refactors. Also deferred and recorded rather than invented:

- **A strict "SEALED is irreversible without exception" policy** — would supersede AC-I-17/§7.2 rules 4–5 and remove the `reopen` endpoint + permission; belongs to an explicit task with its own ADR (ADR-0032 §6/§8, OQ-23).
- **Posting into a closed period with a special permission** (OQ-23): the contract's default remains fail-closed; only a product decision can change it.
- **Reopen/unseal authority and approval** (OQ-23), **correction windows** (OQ-27).
- **Task 12 P1 follow-up** (real-PostgreSQL concurrency verification for the balance projection) and **Task 13 follow-ups** (no backfill for `operationally_used_at`; `OperationalUsage.reason` not persisted) — unchanged by this task, listed so they are not mistaken for Task 14 omissions.

## 11. Commit hash and branch

| | |
| --- | --- |
| Branch | `arena/01a0cf1f-vardena` (pushed to `origin`) |
| Base commit | `2ea11609170f7fd52916068603b02955cae819a2` (`main`) |
| Task 14 commit | `31442cf` — *"Task 14 — Accounting Period Close Foundation: in-transaction lifecycle gate"* |
| Later docs/evidence commits | recorded in the task index §9 and on PR #32 |
| Pull request | **#32** → `main` |

## 12. Status

**READY FOR REVIEW — NOT ACCEPTED.** The implementation, its evidence and its limits are above; acceptance (and any merge) is a human decision. The task index keeps Task 14 at *READY FOR REVIEW — NOT ACCEPTED* and leaves Task 13 at *IN PROGRESS (self-review)*, Task 12 at *ACCEPTED WITH FOLLOW-UP*, Task 11 at *ACCEPTED*.
