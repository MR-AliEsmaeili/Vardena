# Task 13 — Accounting Operational Freeze (D4 marker wiring): implementation report

Branch: `arena/01a0cd89-vardena` · Baseline: `1ce8d78` (`Merge pull request #30 from MR-AliEsmaeili/arena/01a0ca12-vardena`, Task 12 head) — working tree clean at start
Date: 2026-09-23 · Area: Accounting (module 3) — `domain/` + `data/` + `application/` seams + test fakes + docs
Governance status: **READY FOR REVIEW — IN PROGRESS (self-review), NOT Accepted** (per
`docs/accounting/task-index.md` §6/§7: acceptance needs human acceptance + push + open PR + PR
checks and the required CI green on the head SHA). The branch is pushed and **PR #31** is open
(`https://github.com/MR-AliEsmaeili/Vardena/pull/31`, `arena/01a0cd89-vardena` → `main`,
`MERGEABLE`) — the required CI job is **green**: job `backend`, run `35852213257` on head
`5ad94f6` and run `35852746750` on head `692ee0f` (a docs-only delta), every step `success` —
`Prisma validate`, `Prisma generate`, `Lint`, `Typecheck`, `Format check`, `Unit tests`,
`Build`, `Migrate test database`, `Migration rehearsal (populated pre-Task-11 data)` and **`E2E
tests (incl. live-DB suites)`** on `postgres:16` (§5.4). That closes the one gate this sandbox
could not execute (§10 R1). Acceptance itself remains a human decision; nothing here claims it.
(Run `35852180644` on `3e198d2` was auto-cancelled by the next push; no code changed between
those heads.)

Implementation commit: **`a0d90d3d7d22c45b11936439243bdee856c3e14a`** —
`feat(accounting): wire the operational-freeze marker into finalization (Task 13, D4)`,
27 files: the code, both evidence scripts, all documentation updates and this report.
It is followed only by documentation commits that record the review state (`3e198d2`
the SHA line, `5ad94f6` PR/CI status, `64335c5` §5.4, `692ee0f` the task index,
`7bc9d8c` and the one adding this sentence), with **no code, schema, migration or
test line** changed in any of them. The list is necessarily one commit short of
itself — a commit cannot record its own hash, and the PR head keeps advancing by such
record-keeping commits, each gated by the same CI job

**Remediation addendum (after review, same day).** The reviewer's second finding —
no _positive_ live assertion that finalization marks the pinned configuration — was
addressed by a **test-only** change: two live tests in
`backend/test/accounting-documents-live.e2e-spec.ts`, documented in §5.5. No
production, schema, migration, permission or DTO file moved, and no existing
assertion was altered. Their status is **READY FOR REVIEW**, verified on CI: this
sandbox cannot execute a live suite at all (`prisma generate` is blocked, so the two
tests only collect and report `skipped` here), and CI is what ran them — head
`23942af`, run `35866991009`, job `backend`, `completed success`, step
`E2E tests (incl. live-DB suites)` green (§5.5). Acceptance remains a human decision.

## 1. Task definition — what was asked

The task index recorded Task 11's operational-freeze abstraction as **complete at the policy level but deliberately without a caller** (D4), with the boundary questions registered as **OQ-64: OPEN** and analysed — not implemented — in `docs/accounting/task-11-mark-operationally-used-decision-note.md`. Task 13 was the follow-up task that index §6 listed for a later PR. Its mandate:

- Wire the **operational freeze (D4)**: mark `accounting_configurations.operationally_used_at` when a configuration is first used **operationally**.
- Resolve exactly **which configuration** a voucher uses (OQ-64), including the multi-configuration / `SUPERSEDED`-pin cases.
- Resolve the marker's **position in the module's lock order**, since marking is a write on a table the finalize path previously only guarded through chart rules.
- Decide **who may mark**: Posting (finalization), not the chart (account creation/activation) — per D4's own wording — and whether the existing caller-free service seam (`AccountingConfigurationsService.markOperationallyUsed`) should get an endpoint (it should not — decision note §7 keeps the seam caller-free, and the service method's own doc comment says so).
- Define **idempotency / replay / concurrency** semantics for the marker (first-use-wins, rollback, replay).
- Honor the task's scope rule: **no new tables, columns, statuses, DTOs, endpoints, permissions, events or indexes**; no new migration unless genuinely required (it was not); Prisma-only persistence, parameterized raw SQL where Prisma cannot express the statement (AR-11).
- Tests for every rule, **including failure paths** (AG-06), plus **docs in sync** (AG-07).

## 2. Design decisions

### 2.1 The marked set — the accounts' pinned configurations

**Chosen:** the **distinct set of `accounts.accounting_configuration_id` values referenced by the lines of the finalized voucher**, ascending. Marked rows include configurations whose status is `SUPERSEDED`, because a line may legitimately post through an account pinned to a superseded version (exactly the shape Task 11's D3 backfill produces for legacy organizations).

**Why:** the freeze exists to protect _the version the books were written under_. If the marker wrote "the organization's ACTIVE configuration", a mixed-configuration voucher would freeze a version it never used and leave the used version editable — the DoS-by-edit / silent-reinterpretation vector the whole D4 rule exists to close (`ensureConfigurationMutable`, the freeze-state matrix's `frozen_used` row). Marking the touched set makes the guard true by construction and needs **no new business rule** (the OQ-64 question is dissolved, not legislated).

**Rejected alternatives** (§6): (a) mark the ACTIVE configuration — wrong target (above); (b) mark per-level or per-structure — no consumer, `SUPERSEDED` already blocks edits, and it would invent level-usage semantics the contract does not have; (c) mark the coding-structure version too — `coding_structure_versions` has no usage column and adding one is a schema change the task's no-new-schema rule forbids (§1) (and Task 11's D2 keeps that table untouched); (d) mark at _issuance_ (`draft`→`temporary`) or at account creation — neither is a durable effect on the books (see 2.2).

### 2.2 The marking boundary — finalization, not issuance, not the chart

**Chosen:** `AccountingDocumentsRepository.finalizeChecked`, immediately after the line accounts are resolved and **before** they are locked `FOR SHARE`. This is the module's **only** production caller.

**Why:** `final` **is** posted (AC-D-20; Task 10.7 made `finalizeChecked` the only writer of `ledger_entries`), so "the first operational use" and "the transaction that commits the durable effect" are the same moment, and the marker inherits that transaction's atomicity for free:

- a validation refusal (phase, stale scope, closed period, illegal composition, missing account) rolls the marker back with everything else → a configuration that was never effectively used stays editable;
- a crash between "ledger committed" and "marker written" is impossible, so the freeze guarantee can never be silently void;
- a replay never reaches the marker: `PostingService.postVoucher` short-circuits on the `(organization_id, operation_key)` + `request_hash` idempotency row **before** it opens any transaction (§16.4), and even if it did reach it, the guarded statement updates 0 rows.

Marking from `PostingService` instead was rejected because the seam "opens no transaction, takes no lock, writes no row of its own" (its own header) — a second boundary would either widen the lock scope or split the effect from its evidence, both forbidden.

### 2.3 The service seam stays caller-free

`AccountingConfigurationsService.markOperationallyUsed` is kept (it is a documented, tested **domain-facing** seam, not dead code) but is now `markOperationallyUsed(organizationId, id, actorId = null)`, is **first-use-wins**, returns the marked row or `null`, and delegates to the _same_ SQL as the finalization path. **No endpoint, no permission, no DTO change** (the service seam's own doc comment, `application/accounting-configurations.service.ts` — "there is no endpoint, no permission and no service call that marks usage on request", and decision note §7.1 keeps the seam endpoint-free): an HTTP surface that sets the marker would let any authorized caller freeze a configuration without performing an operation, and would create a second, unguarded writer of the column. It is the path the test fixtures and any future caller that already owns a transaction can use.

### 2.4 Marker semantics — first use wins, one statement

```sql
UPDATE "accounting"."accounting_configurations"
   SET "operationally_used_at" = :now,
       "updated_at"            = :now,
       "updated_by"            = :actorId
 WHERE "id" = :configurationId
   AND "organization_id" = :organizationId
   AND "operationally_used_at" IS NULL
RETURNING "id"
```

**Deviation from the note's suggested shape, on purpose:** §5 sketched
`WHERE id = ANY(:ids)` in one statement plus a re-read for the response. The
implementation issues the guarded `UPDATE` once per configuration id, ascending,
and reads the outcome from `RETURNING "id"` instead of a re-read. Same semantics
(one guarded write, first use wins, no lost update), but it keeps the
organization predicate on the write itself, keeps the multi-row discipline the
module uses everywhere else (`ASC id`, deduplicated), and avoids an array bind
parameter whose serialization could not be verified in this sandbox (no generated
Prisma client) — see §6.

- **One statement, not read-then-write.** The `IS NULL` guard is what makes first-use-wins true under concurrency: the second writer blocks on the row lock, PostgreSQL re-evaluates the predicate against the winner's committed version, and it updates **0 rows** — no retry loop, no lost first timestamp, no duplicated evidence. Verified against a real server (§5.2, rehearsal §5).
- **`operationally_used_at` = the first-use instant**, monotonic and one-way. It is deliberately **not** an append-only usage registry: the column is a guard, not an audit log of every operation (decision note §4/§5 — the marker is an instant, not a registry). `updated_at`/`updated_by` carry the marking actor for the transition (AG-16/AR-23).
- **Replay / second voucher**: the first timestamp survives untouched in both cases (§5.1 unit tests; §5.2 real-DB test).
- **`RETURNING "id"`** is what lets the caller report _only_ the rows it transitioned — a replay or a losing racer returns nothing.

### 2.5 Fail closed — never a partial mark

`domain/accounting-configuration-freeze.ts` gained `resolveUsedConfigurationIds({ accountIds, pins })`, a framework-free pure function (AR-05) that answers "which configuration did this use" and refuses when the answer is not derivable:

| Problem                  | When                                                                                                    | Consequence                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `account_pin_unresolved` | a referenced account has no pin row (deleted / foreign — the JOIN dropped it)                           | typed `ConfigurationUsageReferenceError` before the first write |
| `account_pin_missing`    | `accountingConfigurationId` is `NULL` or blank after trim (an invariant violation at the data boundary) | same                                                            |
| `account_pin_conflict`   | two rows disagree about one account's pin                                                               | same                                                            |
| `account_pin_unexpected` | a pin for an account the caller did not pass, or a duplicated input id                                  | same                                                            |

A refusal aborts the whole finalization transaction (same failure mode as `AccountingDocumentAccountRejectedError`), so **a voucher is never `final` while its configuration reads as unused**. The error is deliberately **not** mapped to a 4xx: the client cannot repair a broken pin by sending different input, so it surfaces through the global filter as the generic `500 InternalError` ("An unexpected error occurred.", no internals leaked) with `logger.error` carrying the typed error, its `problem`/`subject` and the correlation id — the same posture the module takes for driver errors, and the reason no new `AppException` code was invented (AG-03). The mark is therefore never partial, never cross-organization (the read is scoped on _both_ `lines.organization_id` and `accounts.organization_id`; the write carries `organization_id` in its predicate), and an inconsistent pair of rows is never reconciled by guessing.

### 2.6 Lock position — the existing configuration slot, no new position

The module's global order already places `coding_structure_version / accounting_configuration (FOR UPDATE)` between the calendar and the accounts (`docs/accounting/lock-order-matrix.md` §1). Marking is an `UPDATE`, i.e. a row-exclusive configuration lock, so it sits **at that position**:

```text
financial_area → fiscal_year → accounting_period
  → accounting_configuration (marker UPDATE, ids ASC)      ← D4″ (new row, same position)
  → account(s) FOR SHARE (ASC)
  → account_balance_projections FOR UPDATE (ASC)
  → accounting_document FOR UPDATE
  → ledger INSERT → balance UPSERT → posting-operation INSERT (LAST)
```

Why that placement is safe and why the two neighbours matter:

- **Chart writers** (A1 root create, A5 postability flip, AC11-2 publish, AC11-3 draft write, AC11-4 delete) all take configuration locks **before** any account row, so the finalize path agrees with them and the two families merely serialize for the duration of one `UPDATE`.
- **`lockAccountsForLinesInTx` must stay after it** — the marker is exclusive, so the reverse order would invert the pair. This is not a paper argument: rehearsal §7 runs a finalize-shaped writer against a chart-shaped writer in both orders on a real server and gets _clean_ for the shipped order and **SQLSTATE `40P01` for the inverted one**.
- **The document/projection locks come later**, so the marker never holds a ledger, projection or document row while waiting on a configuration, and the posting-operation row stays the last `INSERT` (unchanged by this task).
- **`lockConfigurationsOfOrgForUpdate` (all rows of the org, used by publish/draft-write/delete) vs the marker (a few rows)** is not an inversion: both are configuration-position, both ascending, so a concurrent publish waits and then sees the committed marker (which is precisely what its `ensureConfigurationMutable` guard must read).

### 2.7 The pins read is unlocked and set-based

`configurationPinsOfDocumentLinesInTx` is a plain `SELECT … JOIN` with `ORDER BY ln."line_no" ASC, ln."id" ASC` and **no `FOR` clause**. The authoritative validation of every referenced account (existence, organization, postability, activity) is the `FOR SHARE` pass that follows, and the stored-line-set check inside the document lock proves the read still describes the same lines — the same read-then-verify discipline Task 12 uses for projection keys. An account row that disappears in between makes `resolveUsedConfigurationIds` refuse the whole operation rather than be skipped. `ORDER BY line_no, id` makes the row order deterministic (replay-safe test assertions), and a document with no matching rows yields the empty set, so the write loop issues **zero statements** and changes nothing.

### 2.8 Backfill is explicitly out of scope (documented limitation)

The marker exists only from this change onward. **No migration** was added to reconstruct usage from the ledger: a data-only migration is an unaudited business effect that fires on every fresh database where nothing is missing, and "first use" reconstructed from history is not reliably the real first use (older `final` documents may have been corrected, and `posting_timestamp` is not necessarily the first touch). The optional operator `UPDATE` is specified and **validated on a real server** (§5.3) but not shipped or applied — see §8.

## 3. Files changed — per file

### 3.1 Production code

| File                                                                              | ±                   | Change                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backend/src/modules/accounting/data/accounting-configuration-usage.ts`           | +173 (new)          | **The marking boundary.** `configurationPinsOfDocumentLinesInTx` (pins read), `markConfigurationsUsedByDocumentInTx` (read → resolve → mark), `markConfigurationsUsedInDb` (the module's **only** writer of `operationally_used_at`, one guarded statement per id, ascending, deduplicated). Header carries the rationale for the layer, the lock position, the idempotency argument and the organization scoping. |
| `backend/src/modules/accounting/domain/accounting-configuration-freeze.ts`        | +172 −13            | `AccountConfigurationPin`, `ConfigurationUsageProblem` (4 cases), `ConfigurationUsageReferenceError`, `resolveUsedConfigurationIds` (§2.5); `OperationalUsage` documented as the **unpersisted** identity of a mark (first-use instant only); the `frozen_used` row is now described as the wired rule it is.                                                                                                      |
| `backend/src/modules/accounting/data/accounting-documents.repository.ts`          | +27 −1              | `finalizeChecked` calls `markConfigurationsUsedByDocumentInTx` between `accountIdsInTx` and `lockAccountsForLinesInTx`, with the comment that states the ordering reason; method doc extended.                                                                                                                                                                                                                     |
| `backend/src/modules/accounting/data/accounting-configurations.repository.ts`     | +36 −15             | `markOperationallyUsed` rewritten: organization-scoped, first-use-wins, `RETURNING`-based (`marked(id) \| null`), delegating to `markConfigurationsUsedInDb`; `Client` type gained `$queryRaw: RawQuery`. The inline freeze guards (`updateDraftChecked`, `publishChecked`, `deleteDraft`) are **unchanged** — they already read `operationallyUsedAt`.                                                            |
| `backend/src/modules/accounting/application/accounting-configurations.service.ts` | +29 −9              | `markOperationallyUsed(organizationId, id, actorId = null)`: documented as a transactional seam with **no HTTP surface by design**, passing the ambient transaction through and forwarding the repository's result.                                                                                                                                                                                                |
| `backend/src/modules/accounting/application/accounts.service.ts`                  | +9 −2               | The D4 note at the account-create path rewritten to state the **settled** boundary: create/enable/disable mark nothing, and why (a chart row is not a business effect; `temporary` freezes nothing; marking here would freeze a configuration with no effect on the books).                                                                                                                                        |
| `backend/src/modules/accounting/data/accounting-locks.ts`                         | +15 (comments only) | File header states that Task 13 added **no new lock position**, names the call order inside `finalizeChecked` (`lockScopeInTx` → marker → `lockAccountRowForShare`, ids ascending) and points at `docs/accounting/lock-order-matrix.md` row `D4″` for the full matrix and the deadlock argument. No lock helper changed.                                                                                           |

### 3.2 Test doubles (shared fakes)

| File                                                        | ±        | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/test/support/accounting-structure-repositories.ts` | +11 −1   | The in-memory `markOperationallyUsed` now matches production semantics exactly: organization-scoped, first-use-wins (`if (row.operationallyUsedAt !== null) return null`), and writes `updatedBy` alongside `updatedAt` — so a test that asserts "no re-mark" is asserting the same rule the SQL enforces.                                                                                                                                                                       |
| `backend/test/support/accounting-document-repositories.ts`  | +107 −33 | `withRollback` gained an `extraTables` parameter (snapshot/restore of the configuration table, so a fake rejection/rollback really rolls the marker back); `markConfigurationsUsedInMemory(structure, input)` mirrors `resolveUsedConfigurationIds` + the guard (fail-closed problems included) and is called from the fake `finalizeChecked` at the same relative position. The fakes therefore enforce the boundary too, which is what makes the HTTP-level suites meaningful. |

### 3.3 Tests

| File                                                                           | ±              | New cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/src/modules/accounting/domain/accounting-configuration-usage.spec.ts` | +181 (new)     | 10 unit tests for the pure rule: dedup + ascending output, one config per mixed voucher, empty set, each of the four failure problems (including a duplicated caller input and blank/whitespace pins), and the mark→freeze link (`resolveFreezeState` reports `frozen_used` **only** because of the marker).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `backend/src/modules/accounting/data/accounting-configuration-usage.spec.ts`   | +380 (new)     | 12 tests against a fake `$queryRaw`: one guarded `UPDATE` per id, ascending and deduplicated, only the four tables' names appear, bind parameters only (no inlined ids), `IS NULL` guard present, zero statements for the empty set, already-used row → 0 rows and untouched timestamp, foreign-organization row → 0 rows, clock/actor forwarded, pins read is unlocked and org-scoped on both sides with the exact parameter order, refusal happens **before** any statement; plus 4 static contract tests (only ONE writer of `SET "operationally_used_at"` in `src/modules`; `markConfigurationsUsedByDocumentInTx` is called from `accounting-documents.repository.ts` only; no `api/` file mentions the seam, a `usage                                                                                                                                                                    | used | freeze` route, or the column; no permission code for marking). |
| `backend/src/modules/accounting/application/posting.service.spec.ts`           | +284 −25       | New section "8. operational freeze — the usage marker (Task 13)", 7 tests through the **whole** posting chain (`PostingService` + fake repositories): finalize marks with the finalization clock and actor; a draft and an issuance mark nothing; a ledger-insert failure rolls the mark back with the document; a replay and a second voucher keep the **first** timestamp and mark exactly one row; a mixed-configuration voucher marks **both** configurations (ACTIVE + SUPERSEDED); an unpinned account fails closed with `account_pin_missing` and mutates **nothing** (document state, lines, ledger, operation row and the other configuration all verified); no extra operation rows and no extra configuration rows. `composeVoucher` gained an optional `lines` override, and the fixture now seeds configurations + pins (also needed to keep the shared store assertions honest). |
| `backend/src/modules/accounting/application/posting-readiness.spec.ts`         | +20 −1         | `seedScope` seeds one `ACTIVE` configuration and pins its accounts, so the readiness suite keeps exercising the real write path against the new marker (13 tests, unchanged in number).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `backend/src/modules/accounting/application/accounting-configurations.spec.ts` | +107 −1        | 3 seam tests: marking another organization's configuration is a **no-op returning `null`** while the owning organization's identical call marks; a repeated mark keeps the **first** instant (three attempts, one timestamp); a `DRAFT` that somehow got used can no longer be **published** (`BusinessRuleViolation`, the row stays `DRAFT`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `backend/src/modules/accounting/application/coding-structure-accounts.spec.ts` | +70 (new test) | The chart-boundary half of D4 at the service level: create root, create child, rename, disable, enable — and a second DRAFT configuration edit — mark **nothing**, read straight off the shared store (`operationallyUsedAt === null` before and after each step).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Total: **33 new test cases** across 6 suites (10 + 12 + 7 + 3 + 1), plus the fixture/seed changes in §3.2 and §3.3 needed to make the marker visible to the existing posting suites.

### 3.4 Evidence scripts (not shipped in the runtime path)

- `backend/prisma/rehearsal/task-13-operational-freeze/rehearse.mjs` (new, 958 lines) — the marker rehearsal on a real PostgreSQL. It **extracts both SQL statements out of `accounting-configuration-usage.ts`**, turns the tagged-template placeholders into positional parameters in order of appearance (what `$queryRaw` does) and executes _that_ text, so the rehearsal proves the shipped statement, not a paraphrase, and fails loudly if the statement's shape changes. It seeds a throwaway organization, runs 10 sections and deletes every row it created in a `finally`.
- `backend/prisma/rehearsal/task-13-operational-freeze/backfill-repair-probe.mjs` (new, 306 lines) — runs the §8 repair statement inside one transaction that is always rolled back, asserts first-use semantics and re-run safety.
- `docs/accounting/task-13-evidence/postgres-rehearsal.log`, `docs/accounting/task-13-evidence/postgres-backfill-repair-probe.log` — captured outputs with the server version and how they were produced.

## 4. Invariants

| #    | Invariant                                                                                                                                                              | Enforced by                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| I-1  | A configuration is `frozen_used` **iff** `operationally_used_at IS NOT NULL`; edit, publish and delete all refuse on that one fact (no second state, no derived check) | existing `ensureConfigurationMutable` / `deleteDraft` guards, unchanged; marker is the only input |
| I-2  | The marker is written **only** by the transaction that commits the durable effect (finalization). Exactly one writer of the column exists in `src/modules`             | `accounting-configuration-usage.ts` + static contract test                                        |
| I-3  | First use wins: no code path can move or clear a set `operationally_used_at` (no unmark method exists anywhere; only a rolled-back transaction can leave it `NULL`)    | `… AND "operationally_used_at" IS NULL` guard + repository/fake semantics                         |
| I-4  | Every configuration the voucher's lines pinned is marked, all of them or none (never a partial set)                                                                    | `resolveUsedConfigurationIds` fails closed before the first write                                 |
| I-5  | No cross-organization effect, in either direction: the pins read scopes `lines` **and** `accounts`; the write's predicate includes `organization_id`                   | SQL + data-layer spec + rehearsal §3                                                              |
| I-6  | Marking is never reachable over HTTP: no endpoint, no route DTO field, no permission, no event                                                                         | static contract tests over the whole `api/` folder + `accounting-permissions.ts` code scan        |
| I-7  | The lock order is never reversed: configuration-before-account, before any projection/document/ledger lock                                                             | `finalizeChecked` call site + matrix row `D4″` + rehearsal §7 (deadlock asymmetry)                |
| I-8  | Chart work is not operational use: account create / enable / disable / move, and document draft / issue, mark nothing                                                  | service tests (both suites) + the pre-existing live e2e assertion                                 |
| I-9  | A `pending`/`temporary` voucher freezes nothing; only `final` does                                                                                                     | same as I-8 (the marker lives in `finalizeChecked` only)                                          |
| I-10 | The posting operation row remains the last `INSERT`; a lost idempotency race aborts the mark with it                                                                   | unchanged ordering; verified by "no extra operation rows" + rollback test                         |

## 5. Test results

### 5.1 Unit / contract (executed here, all green)

```
$ npx vitest run            (from backend/, NODE_ENV=test, in-memory fakes)
 Test Files  88 passed (88)
      Tests  1017 passed (1017)
$ npx vitest run --config ./vitest.config.e2e.ts
 Test Files  15 passed | 8 skipped (23)
      Tests  189 passed | 45 skipped (234)
```

Task-relevant files: `posting.service.spec.ts` 25, `posting-readiness.spec.ts` 13, `data/accounting-configuration-usage.spec.ts` 12, `domain/accounting-configuration-usage.spec.ts` 10, `accounting-configurations.spec.ts` 11, `coding-structure-accounts.spec.ts` 32 — 103 passing. The 8 skipped e2e files are the `*-live.e2e-spec.ts` suites, which self-skip without `VARDENA_TEST_DATABASE_URL` — they were executed instead by CI on the pushed head (§5.4).

**Evidence label: VERIFIED-locally** (this sandbox, Node 22.22.3, `npm ci` install, in-memory fakes — no database involved). The e2e run is meaningful beyond the 503/readiness paths it was designed for: `test/accounting-documents.e2e-spec.ts` boots the real NestJS app with the `PrismaService`/`AccountingDocumentsRepository`/`AccountingConfigurationsRepository` providers **overridden by the in-memory fakes this task extended**, and drives the whole HTTP lifecycle (create → edit → issue → finalize) plus the refusals — so "finalize marks the pinned configuration", "no endpoint marks it" and "a rejected finalization rolls the mark back" are also exercised over HTTP (against the fakes, not against PostgreSQL).

### 5.2 Real PostgreSQL rehearsal — 23/23

Executed three times consecutively against a real PostgreSQL **18.4** server in this sandbox (all 14 migrations applied); identical results each run, and zero residue afterwards (verified by row counts on every touched table):

| Section | Proved                                                                                                                                                                                                                                                                                                                                                                              |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0       | The rehearsal runs the **shipped** statement text; `operationally_used_at` is `timestamptz(6)` nullable; **no usage table** exists                                                                                                                                                                                                                                                  |
| 2       | The mixed-configuration voucher (3 lines over 3 accounts, 2 configurations) resolves to **both** configuration ids; the same document read under another organization resolves to **nothing**                                                                                                                                                                                       |
| 3       | First use marks exactly 1 row with the caller's clock + actor; a repeated mark matches **0 rows** and cannot move the timestamp; the statement cannot mark a configuration of another organization; a foreign row id never matches                                                                                                                                                  |
| 4       | The mark is visible inside the transaction and gone after `ROLLBACK`                                                                                                                                                                                                                                                                                                                |
| 5       | **Concurrency:** session A marks and holds; session B is **observed** blocked (`pg_stat_activity.wait_event_type = 'Lock'`, polled with a bounded deadline) before A commits; a second write inside A matches 0 rows; after `COMMIT` B updates **0 rows** and **A's first timestamp survives** with A as actor                                                                      |
| 6       | A rolled-back first writer leaves `NULL`, so a later real use still marks (the guard is not a latch-on-failure)                                                                                                                                                                                                                                                                     |
| 7       | **Lock position:** both interleavings are FORCED and observed. Shipped order (marker → accounts): the chart writer is seen waiting on the marker and both transactions then complete — real contention, **no** `40P01`. Inverted order (accounts → marker): **both** sides are observed waiting on the other and PostgreSQL reports **`40P01`**                                     |
| 8       | A full finalize-shaped transaction (calendar locks → pins read → marker → accounts `FOR SHARE` → document → `UPDATE state=final` → 2 ledger entries → posting-operation row → `COMMIT`) leaves the document `final` **and** the configuration marked with the finalizer as actor; a **later** voucher over the same configuration then marks nothing, so the first instant survives |
| 9       | The same transaction aborted by a **real** `UNIQUE (voucher_line_id)` violation (`23505`) rolls the marker back with the state change — the configuration reads unused again                                                                                                                                                                                                        |
| 10      | The marker does not block unrelated reads; marked and unmarked rows are both listed, with their account counts                                                                                                                                                                                                                                                                      |

**Evidence label: VERIFIED-on-PostgreSQL-18.4-in-sandbox.** This is **not** production-grade concurrency evidence: the target version is PostgreSQL 16 (`postgres:16` in `.github/workflows/ci.yml`), the server was reached through the `pg` driver rather than Prisma, and the run had no workload pressure beyond two sessions. Per Task 12's lesson, do **not** read this as "concurrency safety proven"; it proves the statement semantics and the ordering asymmetry.

**Self-review correction worth recording:** the first version of §5/§7 coordinated the two sessions with fixed `sleep`s and asserted what they _should_ have produced. On a re-run that made §7 fail (no deadlock observed) — and, worse, the ordered probe could have "passed" with the two writers never overlapping at all. Both probes now poll `pg_stat_activity` and **assert the wait they depend on** (`waits=1` / `waits=2` in the check output), so a scheduler that does not cooperate produces a FAIL instead of a meaningless PASS. `NOTIFY`-based coordination was tried first and is wrong here: notifications raised inside a transaction are not delivered until it commits, which is precisely the window the probes sit in.

Log: `docs/accounting/task-13-evidence/postgres-rehearsal.log`. To reproduce from `backend/`: `DATABASE_URL=postgresql://… npm run test:operational-freeze-rehearsal` (added next to the existing `test:migration-rehearsal`, same convention, no new dependency — `pg` is already a runtime dependency).

### 5.3 Backfill repair probe — 5/5

First-use instants reconstructed as `MIN(ledger_entries.posting_timestamp)` per configuration (the earliest of two vouchers, not the newest, not the document date), nothing left unmarked, re-run = 0 rows, and no existing timestamp moved. All inside one `ROLLBACK`ed transaction. **Evidence label: VERIFIED-on-PostgreSQL-18.4-in-sandbox** for the statement's correctness; it was **not** applied to any database and is not shipped as a migration.

### 5.4 CI on the pushed head (post-handoff) — `completed success`

```
run 35852213257 · job "backend" · head 5ad94f6 · postgres:16 service container
  Prisma validate · Prisma generate · Lint · Typecheck · Format check · Unit tests
  · Build · Migrate test database · Migration rehearsal (populated pre-Task-11 data)
  · E2E tests (incl. live-DB suites)            → all steps success
```

`npm run test:e2e` runs with `VARDENA_TEST_DATABASE_URL` set
(`.github/workflows/ci.yml:120-122`), so the seven `*-live.e2e-spec.ts` suites
executed against a real PostgreSQL 16 with a **generated** Prisma client —
including `accounting-configuration-live.e2e-spec.ts` (its D4 assertion that
account creation records no usage, and the configuration publish/edit race
tests), `accounting-documents-live.e2e-spec.ts` and
`ledger-entries-live.e2e-spec.ts` (the finalize transaction that now carries the
marker, through the real `$queryRaw` plumbing).

**Evidence label: VERIFIED-on-CI (GitHub Actions, `postgres:16`, head `5ad94f6`; re-run green on `692ee0f`, run `35852746750`, docs-only delta).**
Reported from `gh run view 35852213257`, not inferred; step-level conclusions are
what CI published, and the raw log was not re-parsed here. Two caveats: CI does
**not** run this task's rehearsal (`test:operational-freeze-rehearsal` is
manual — see §6), and a passing suite proves the properties those suites assert,
not every property in §4.

### 5.5 Positive live PostgreSQL marker assertion

Added after review, to close the one gap §12 used to leave open. **Test-only**: one
file, `backend/test/accounting-documents-live.e2e-spec.ts`, +316 lines and **0
deleted** — no existing assertion was touched, and no production, schema,
migration, permission or DTO file changed.

| Test (exact names)                                                               | What it proves                                                                                                                                     |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Task 13 D4: finalizing a real voucher marks the configuration its lines pinned` | A committed finalization through the real path writes `operationally_used_at`, and writes it for exactly the pinned configuration.                 |
| `Task 13 D4: a finalization that rolls back leaves the configuration unused`     | A finalization aborted inside the transaction leaves the marker NULL and the row untouched, and the retry after the failure is what finally marks. |

**The production path used, unshortened.** Both tests compose a draft voucher
through `AccountingDocumentsRepository.createChecked`, number and issue it through
`NumberingService` + `issueChecked` (so the state machine is the real one), and
then call **`PostingService.postVoucher`** — the exact seam
`AccountingDocumentsService.finalizeDocument` delegates to
(`application/accounting-documents.service.ts:517-538`), which is what
`POST /api/v1/accounting-documents/:id/finalize` reaches. Its step 4 opens the one
atomic finalization transaction that carries the marker
(`data/accounting-documents.repository.ts:532`). **No marker method is called by
hand** — not `markOperationallyUsed`, not `markConfigurationsUsedInDb` — and the
test opens no transaction, so removing the wiring in `finalizeChecked` turns the
success test red. The HTTP layer itself is not driven here because the live suites
deliberately own no session/RBAC fixture (that journey is the fake-backed
`accounting-documents.e2e-spec.ts`); `postVoucher` is the highest production seam a
live-database suite can reach without inventing one.

**Success assertions** (test 1): `outcome.kind === 'posted'`,
`outcome.document.phase === 'final'`, `outcome.result.ledgerEntries` has 2
entries, and those entries are real rows
(`ledgerEntry.count({ voucherId }) === 2`). The marker is then read **directly from
PostgreSQL** with raw SQL — the column, not the DTO — and the test asserts
`operationally_used_at` is a `Date` whose `getTime()` equals the row's own
`finalized_at` (both come from the same `input.finalizedAt`, so a second, detached
write could not reproduce it), that `updated_at` carries the same instant, and that
`updated_by` is NULL (no principal exists in this suite). Isolation of the target
is asserted with a decoy: a second `SUPERSEDED` configuration with its own postable,
active account in the **same organization**, unreferenced by the voucher, which must
stay NULL. Marking "the ACTIVE configuration" instead of the touched pin — the
mistake OQ-64 existed to prevent — fails here; and the fixture's own ACTIVE
configuration is deliberately _not_ the target, so the ordering of the earlier tests
cannot let this pass vacuously.

**Rollback assertions** (test 2): the failure is a real database constraint, not a
stub or a clock. A hand-written `ledger_entries` row for line 1 is committed first,
so the finalization's own materialization violates
`uq_ledger_entries_voucher_line_id` (`23505`) _after_ the marker statement has
already run inside the same transaction; `postVoucher` rethrows it (its
`isUniqueViolation` branch finds no operation row to replay). The test then asserts
nothing persisted: phase `temporary`, `state = 'temporary'` and
`finalized_at IS NULL` read from the row itself, `ledgerEntry.count === 1` (only
the hand-written row), `accountingPostingOperation.count === 0`, and — the part a
plain NULL could not prove — `updated_at` still equals the value read **before** the
attempt, i.e. the guarded `UPDATE` matched zero rows and the row was never touched.
Finally the hand-written row is removed and a retry under a fresh key commits, which
is what marks the configuration: the failed attempt left no state that could
suppress a later legitimate mark.

**Execution environment — and why this is not "verified locally".** The suite
cannot run in this sandbox: `prisma generate` fails because the engine CDN
(`binaries.prisma.sh`) is network-blocked here, and the checked-in
`src/generated/prisma/client.ts` is a type-only stub whose constructor throws; the
live suites need a generated client plus a migrated database and otherwise
self-skip. So the tests are executed by CI: `npm run test:e2e` under
`VARDENA_TEST_DATABASE_URL` on `postgres:16`, the step §5.4 already records for the
earlier heads. **This head has now been executed there:** run `35866991009` on
`23942af`, `completed success`, step 16 `E2E tests (incl. live-DB suites)` green.
Because `VARDENA_TEST_DATABASE_URL` is a job-level env
(`.github/workflows/ci.yml:38-39,53,122`, service image `postgres:16`), the
`describe.skipIf(DATABASE_URL === undefined)` guard in this file does not fire in CI,
so both new tests really ran against PostgreSQL 16 and passed — a red assertion in
either would have turned step 16 red. **Label: VERIFIED-on-CI (live PostgreSQL 16,
head `23942af`).** The documentation head that followed it is green as well (run
`35867656089` on `0718d4e`, `completed success`), so the PR head itself carries a
passing live run. The raw CI log is not retrievable from this sandbox (`gh run view
--log` and the job-log endpoint both fail), so what is recorded here is the
step-level conclusion plus the `skipIf` mechanism — stated, not implied.

What _was_ executed here is the SQL these tests rest on, against a real PostgreSQL
18.4 built by applying all 14 migrations to an empty cluster (a private throwaway
sandbox cluster; `pg` + `@embedded-postgres`, nothing committed): every insert in
the new helpers was run verbatim, the hand-written colliding `ledger_entries` INSERT
was accepted by the schema and did fire `23505 Key (voucher_line_id)=(…) already
exists`, `uq_ledger_entries_voucher_line_id` and the `operationally_used_at`
`timestamptz(6)` column were confirmed present, the guarded `UPDATE … RETURNING`
statement was extracted from `data/accounting-configuration-usage.ts` and shown to
stamp the marker to the finalization instant with `updated_by` NULL, to touch 0 rows
on a second use, to leave `updated_at` unchanged when its transaction rolls back,
and to leave the decoy configuration NULL; the lines→accounts pin read resolved to
the used configuration; a repeated `operation_key` was refused by its unique index
(the replay branch that skips the marker); and row counts after cleanup showed zero
residue. **Label: VERIFIED-on-PostgreSQL-18.4-in-sandbox for the SQL and the
constraints; the vitest suite itself is VERIFIED-by-CI on `postgres:16`.** Neither
is a production-concurrency claim — that stays rehearsal §5/§7's job.

**Limitations this leaves.** (i) No live test drives the HTTP controller with real
auth/RBAC for this property — the seam under test starts at `postVoucher`; (ii) the
`23505` abort is the established convention for "a failure after the marker", not
exhaustive failure injection (a `40P01` abort is proven only in rehearsal §7);
(iii) the sandbox cluster is PostgreSQL 18.4 while CI is 16, and the marker
statement uses no version-specific syntax.

## 6. Rejected / deferred approaches

| Option                                                                                   | Why not                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mark the organization's `ACTIVE` configuration                                           | Freezes a version the voucher never used and leaves the used one editable — inverts the point of D4 (§2.1)                                                                                                                                                                                                                                                |
| Mark from `PostingService` (application layer)                                           | The seam opens no transaction; a separate one would split the effect from its evidence or widen the lock scope (§2.2)                                                                                                                                                                                                                                     |
| Mark at issuance (`draft`→`temporary`) or on account create/enable                       | Neither is a durable effect on the books; D4 explicitly excludes the chart, and the live e2e asserts it                                                                                                                                                                                                                                                   |
| Per-level / per-structure / coding-structure-version markers                             | No consumer; `SUPERSEDED` already blocks edits; would need a new column (schema change — rejected by the task's scope rule, §1) and would invent semantics the contract lacks                                                                                                                                                                             |
| Add `updateMany` / a `select` to `AccountingTxClient`, or a delegate-only implementation | Grows the typed delegate surface for one statement, and Prisma cannot express `WHERE … IS NULL … RETURNING` as one guarded write; two statements would re-open the race the guard exists to close                                                                                                                                                         |
| Array-parameter SQL (`id = ANY($1::text[])`) for the pin read                            | Serialization of array bind parameters could not be verified in this sandbox (no generated client) — the chosen shape uses only scalars                                                                                                                                                                                                                   |
| `take`/pagination on the pins read                                                       | Truncation would silently under-mark; the line count of a voucher is bounded by composition and by `MAX_VOUCHER_LINES`                                                                                                                                                                                                                                    |
| A data-only backfill migration                                                           | An unaudited business effect, fires on fresh databases, and reconstructs a first-use instant that history cannot guarantee (§2.8, §8)                                                                                                                                                                                                                     |
| A new `AccountingConfiguration.OperationalUsage` event/registry                          | Zero consumers today; the marker is guard state, not an audit log (AG-07/AR-23) — deferred with the audit-trail task                                                                                                                                                                                                                                      |
| An endpoint + permission to mark/unmark usage                                            | Turns the freeze into a self-inflicted DoS vector and creates a second writer of the column                                                                                                                                                                                                                                                               |
| Add `test:operational-freeze-rehearsal` to the CI workflow                               | It would fit as one step after `Migrate test database` and would gate the statement-level proof; not done because editing the CI config is outside this task's authorized surface (the brief scoped permissions/DTO/OpenAPI/schema changes, not pipeline changes). One-line addition if you want it — the script is idempotent and cleans up after itself |
| Routing the inline guards through `assertConfigurationMutable` (cleanup)                 | A drive-by refactor; AG-03. The guards already enforce the same predicate and are separately tested                                                                                                                                                                                                                                                       |
| Persisting `OperationalUsage.reason` (`first_voucher`)                                   | the task's scope rule forbids a new column (§1); the value is derivable from the ledger and has no consumer (recorded as a known limitation, §10-R2)                                                                                                                                                                                                      |

## 7. Migration status

**None introduced.** This is a behavior change with **no schema change** — the column, its nullability and its semantics were accepted in Task 11's migration `20260920000000_accounting_configuration_foundation`. The task's "if a migration is genuinely required, include it with the Task 11 pattern" clause did not trigger: `operationally_used_at` already exists, and the backfill was rejected (§2.8). `prisma validate` / `migrate diff` are not runnable in this sandbox (no engine download), but nothing under `prisma/schema/` or `prisma/migrations/` changed, so the schema-hash drift check cannot regress (verified by `git status` on those paths — untouched).

## 8. Permissions / DTO / OpenAPI — status

**Unchanged.** No permission code added (the count stays as-is; the static test asserts no `*Used*/*Freeze*/*Mark*` code exists), no route added or removed, no request/response DTO field added — `isOperationallyUsed` and `operationallyUsedAt` were already exposed read-only by Task 11, and the OpenAPI e2e contract suite passes untouched (§5.1). Marking is not a client-facing operation (decision note §7, and the service seam's doc comment).

## 9. Known limitation — usage that predates the change (operator action, optional)

Configurations used by vouchers finalized **before** this deployment keep `operationally_used_at IS NULL` and remain editable/deletable until an operator runs the repair statement below (validated in §5.3). Every operation performed **after** the change is marked correctly, so the guarantee is "no usage lost from now on", not "history is frozen".

```sql
-- Optional operator action, ONE-SHOT, never a migration (report §2.8).
-- Sets each configuration's first-use instant to the earliest ledger posting
-- over any account pinned to it. Guarded, so it is safe to re-run and it never
-- moves an existing timestamp. Run in a maintenance window, after a backup.
UPDATE "accounting"."accounting_configurations" AS cfg
   SET "operationally_used_at" = used.first_use,
       "updated_at" = now(),
       "updated_by" = NULL
  FROM (
        SELECT acc."organization_id"             AS organization_id,
               acc."accounting_configuration_id" AS configuration_id,
               MIN(le."posting_timestamp")       AS first_use
          FROM "accounting"."ledger_entries" le
          JOIN "accounting"."accounts" acc
            ON acc."id" = le."account_id"
           AND acc."organization_id" = le."organization_id"
         WHERE acc."accounting_configuration_id" IS NOT NULL
         GROUP BY acc."organization_id", acc."accounting_configuration_id"
       ) AS used
 WHERE cfg."id" = used.configuration_id
   AND cfg."organization_id" = used.organization_id
   AND cfg."operationally_used_at" IS NULL
RETURNING cfg."id" AS id, cfg."code" AS code, used."first_use" AS first_use;
```

`updated_by = NULL` is deliberate (the transition has no human actor); if a deployment needs it attributed to the operator, set it explicitly before running. Note that a legacy `SUPERSEDED` configuration with no ledger history is (correctly) left usable.

## 10. Risk register

| #   | Risk                                                                                                                                                                                                                                                   | Severity                | Assessment                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | The Prisma `*-live.e2e-spec.ts` suites could not be executed in this sandbox — including `accounting-configuration-live.e2e-spec.ts` ("D4 … NOT called on Account creation", which reads `updated_at`/`updated_by`/`status` as proxies for the marker) | **CLOSED by CI** (§5.4) | `npx prisma generate` is network-blocked here, so every app-boot-with-DB spec self-skipped locally; the required CI job on head `5ad94f6` ran `Prisma generate` + the live e2e suites on `postgres:16` and reported success. The residual risk is what those suites do **not** assert (they were not extended for the marker, beyond keeping the D4 boundary test green), not whether they run. |
| R2  | `OperationalUsage.reason` (`first_voucher`) is computed for the decision but **not persisted**                                                                                                                                                         | Low–medium              | Accepted: the task's scope rule forbids the column (§1). Consequence: an auditor cannot tell _which_ kind of operation first used a configuration from the row alone (the ledger answers it). If an audit trail for unmark/reattribute is ever needed, it arrives with the audit-trail task, not as a speculative column.                                                                       |
| R3  | Pre-existing databases have unmarked historical usage (§9)                                                                                                                                                                                             | Medium                  | Documented + repair statement provided; no silent auto-fix. Consider making §9 part of the release checklist for the first environment that already has `final` vouchers.                                                                                                                                                                                                                       |
| R4  | Every finalization now takes row locks on configuration rows                                                                                                                                                                                           | Low                     | One `UPDATE` per touched configuration (usually **one**), inside the transaction that already holds the calendar locks; the chart's own configuration locks are equally short. Throughput impact is bounded; measured under a real workload only in CI.                                                                                                                                         |
| R5  | Sandbox PostgreSQL is 18.4, CI/production target is 16                                                                                                                                                                                                 | Low                     | The statements used are plain `UPDATE … WHERE … IS NULL RETURNING` / `SELECT … JOIN` — no version-specific behavior; MVCC row-lock + predicate-re-evaluation semantics involved here are stable since well before 14. Not re-verified on 16 here.                                                                                                                                               |
| R6  | A future writer that locks accounts _before_ configurations would deadlock against the marker                                                                                                                                                          | Low, now guarded        | Matrix row `D4″` + the §3 cross-cutting note (which is the change rule for future writers of the column: position + "side effect, never an operation of its own"), plus the rehearsal's inverted-order probe as the executable warning.                                                                                                                                                         |
| R7  | Fake-vs-real divergence: the in-memory fakes re-implement the guard                                                                                                                                                                                    | Low                     | The fakes assert the same rules (guard, org scope, first-use-wins, fail-closed) and the data-layer spec pins the SQL text/shape; the residual gap is Prisma's own parameterization, which the rehearsal covers.                                                                                                                                                                                 |

## 11. Verification commands and results

All from `/home/user/Vardena/backend`. Baseline `1ce8d78` was clean; every command below was run after the final edit and after `npm run format`.

| Command                                                                                                                                              | Result                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run format` (prettier write) → `npm run format:check`                                                                                           | `All matched files use Prettier code style!` — **PASS** (it reformatted my own spec/source files first)                                                                                                                                                                                                                                                                                                                                  |
| `npm run lint` (oxlint + eslint)                                                                                                                     | **PASS** — `Found 4 warnings and 0 errors.` All 4 are **pre-existing at the baseline** (`publishBoth` unused in `coding-structure-accounts.spec.ts:309`; the unused type imports `CodingStructureVersion` in `accounts.service.ts:48` and `AccountingConfigurationLevelCreate` in `accounting-configurations.repository.ts:24`; one `no-unsafe-optional-chaining` hint) — verified against `git show HEAD:…`. No new warning introduced. |
| `npm run typecheck` (`tsc --noEmit`)                                                                                                                 | **PASS** — no output                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npx vitest run` (full unit config)                                                                                                                  | **PASS** — 88 files, 1017 tests                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npx vitest run --config ./vitest.config.e2e.ts`                                                                                                     | **PASS** — 15 files / 189 tests passed, 8 files / 45 tests skipped (the live suites, by design)                                                                                                                                                                                                                                                                                                                                          |
| `npm run build` (`nest build`)                                                                                                                       | **PASS** — compiles against the checked-in generated-client stub                                                                                                                                                                                                                                                                                                                                                                         |
| `npx prisma generate` / `prisma validate` / `migrate dev`                                                                                            | **NOT AVAILABLE** in this sandbox — the engine download is network-blocked. `schema-engine` binary fetch fails; consequently all `*-live.e2e-spec.ts` suites cannot run here. Nothing under `prisma/` changed except the two new rehearsal scripts (plain `pg`, no codegen).                                                                                                                                                             |
| `npm run test:operational-freeze-rehearsal` (= `rehearse.mjs` then `backfill-repair-probe.mjs`, needs `DATABASE_URL` at a migrated PostgreSQL)       | **PASS** — 23/23 then 5/5; the rehearsal was run three times in a row with identical output, zero residue (verified by row counts; the repair probe rolls its own transaction back)                                                                                                                                                                                                                                                      |
| `git status` on `backend/prisma/schema/`, `backend/prisma/migrations/`                                                                               | clean — no schema or migration change                                                                                                                                                                                                                                                                                                                                                                                                    |
| `npm run test:e2e` (the live suites)                                                                                                                 | **NOT EXECUTABLE in this sandbox** — needs `prisma generate` + a migrated DB (§5.5). Locally the two new tests collect and report `skipped` (47 skipped, was 45), which is all this sandbox can show about them. CI runs them on `postgres:16`.                                                                                                                                                                                          |
| sandbox-only SQL check for §5.5 (the new tests' INSERTs verbatim, the shipped marker statement, the `23505` collision, first-use-wins, zero residue) | **ALL CHECKS PASS** on a freshly migrated PostgreSQL 18.4 private cluster (the environment squats a non-functional proxy on port 55432, so a separate port was used). Not committed — the durable version of this evidence is the live suite itself.                                                                                                                                                                                     |
| CI (PR #31, run `35866991009` on head `23942af` — the §5.5 remediation)                                                                              | **PASS** — `completed success`, every step green; step 16 `E2E tests (incl. live-DB suites)` executed the two new live tests against `postgres:16` (the job-level `VARDENA_TEST_DATABASE_URL` disables this suite's `skipIf`), which is the first real execution of them                                                                                                                                                                 |
| CI (PR #31)                                                                                                                                          | **PASS** — run `35852213257` on head `5ad94f6` and run `35852746750` on head `692ee0f`, job `backend` `completed success`: all steps green incl. `Prisma generate`, `Unit tests`, `Build`, `Migrate test database`, `Migration rehearsal (populated pre-Task-11 data)` and `E2E tests (incl. live-DB suites)` on `postgres:16` (§5.4)                                                                                                    |

Sandbox-only artifacts deliberately **not** committed: the locally installed real PostgreSQL binaries (`node_modules/@embedded-postgres/*`), `pg`/`pglite` installed with `--no-save`, and the throwaway cluster at `127.0.0.1:55432`. `pg` is already a runtime dependency of the app, so the rehearsal scripts need no new package.

## 12. What is not proven here (be honest about it)

1. **The live e2e suites** — not executed **in this sandbox** (§10 R1); they were
   executed by the required CI job on the pushed head and passed (§5.4). The gap this
   used to leave — no _positive_ live assertion pinning the marker to a real
   finalization — is **closed by §5.5**: the two new live tests in
   `accounting-documents-live.e2e-spec.ts` assert the mark, the decoy, the rollback and
   the retry against PostgreSQL itself. What is still not proven live is the
   HTTP/controller layer with a real auth/RBAC session (the live tests start at
   `postVoucher`) and the deadlock-abort shape (rehearsal §7 only).
2. **Concurrency under production conditions** — rehearsal §5 proves the row-lock guard with two sessions on one row; it does not measure contention at production scale, nor the 16-specific planner behavior, nor the interaction with the balance-projection locks under load (Task 12's own P1 follow-up is still open for the same reason).
3. **The `marking` path through a real Prisma client** — `$queryRaw`'s handling of the `Date`/`null` bind parameters and the `RETURNING` row shape is asserted by source-shape tests and the fake, and the _SQL_ is proven on a real server; the Prisma plumbing itself is only exercised by the live suites.
4. **Multi-deployment/upgrade ordering** — the assumption that no other module writes `accounting.*` directly is enforced by convention/AR-07, not by a test.
5. **Frontend** — none exists yet; the read-only DTO fields this task leaves untouched are what a UI would surface later.

## 13. Docs updated (AG-07)

| File                                                               | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/accounting/lock-order-matrix.md`                             | §1 global order: the configuration line annotated ("the ONLY place a voucher write touches a configuration row"), the voucher-write bullet rewritten to include the marker, and a new bullet stating that a finalize is **no longer** a pure configuration reader (with the rehearsal's deadlock asymmetry as the evidence). §2: new **row `D4″`** — the whole finalize path with the marker step, its statement shape, first-use-wins, rollback, fail-closed and the no-endpoint rule. §3: new cross-cutting note "Operational-usage marker (Task 13)" holding the two placement rules every future writer must obey (side effect, never an operation of its own; before the account locks and before any ledger insert). |
| `docs/accounting/configuration.md`                                 | Scope line and the D4 bullets now say **wired by Task 13**; new section **"Operational freeze — wired (Task 13)"** (where/what/fail-closed/atomicity/idempotency/lifecycle consequence/known limitation); the OQ-64 line replaced by the resolution summary; repository-seam note; Future-Extensions item struck through; Links extended with the usage file, the rehearsal and the report.                                                                                                                                                                                                                                                                                                                                |
| `docs/accounting/task-11-mark-operationally-used-decision-note.md` | **Status banner only** (per the task): IMPLEMENTED by Task 13, what was decided for each of the three open questions, that §5's recommendation including both open sub-points is what shipped, and that the analysis below is preserved as the 2026-09-22 record rather than maintained as current architecture.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `docs/open-questions.md`                                           | **OQ-64 → RESOLVED**, row moved to the `Resolved` table (new table header added, since it was "(None yet)") with the full resolution text, the deciding references (ADR-0028 §3 + the 2026-09-23 addendum) and the pointer to this report. `Updated:` date bumped.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `docs/adr/0028-accounting-configuration-foundation.md`             | New **"Operational Freeze Implementation Addendum (2026-09-23, Task 13)"** — six numbered decisions (what counts as first use, cardinality, fail-closed, idempotency/replay/concurrency, no new authority surface, no backfill) + a status pointer at the head of §3. ADR-0028 stays **Accepted**; the addendum supersedes the "not called" bullets without rewriting history.                                                                                                                                                                                                                                                                                                                                             |
| `docs/accounting/task-index.md`                                    | Header status line; **new §2 row 13** (what shipped, verification basis, what was not executed); §3 paragraph; new §4 capability-map row for the operational freeze with its gate; §5 note that OQ-64 is the exception to "all OPEN"; §8 D4 follow-up replaced by the resolved entry + the two surviving findings; §6 heading + Task 13 status block; §9 change-log row.                                                                                                                                                                                                                                                                                                                                                   |
| `docs/modules.md`                                                  | Accounting entry: the "abstraction exists but `markOperationallyUsed` stays deferred" sentence replaced, OQ-64 status changed to RESOLVED, a new Task 13 paragraph (semantics, lock position, what is deliberately absent, known limitation), and the Task 10.8 bullet's transaction contents now list the marker.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `docs/accounting/task-13-evidence/*.log`                           | The two captured evidence logs (new files).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## 14. Focus points for the reviewer

1. `data/accounting-configuration-usage.ts` — read the header, then the three functions: is "one writer, one guard, ascending, org-scoped" actually what the code does, and is the **`RawClient` split** (a `{ $queryRaw }`-shaped parameter) acceptable for your taste versus threading `AccountingTransactionalClient` everywhere?
2. `data/accounting-documents.repository.ts` `finalizeChecked` — the **position** of the mark call (after `accountIdsInTx`, before `lockAccountsForLinesInTx`) and whether you agree the stored-line-set check makes the unlocked pins read safe (that is the one inference in the chain a reviewer should try to break).
3. `domain/accounting-configuration-freeze.ts` `resolveUsedConfigurationIds` — the fail-closed table in §2.5; is `account_pin_conflict` too strict (two rows for one account can only mean data corruption)? The error is left unmapped on purpose → generic `500 InternalError` + `logger.error` with `problem`/`subject` and the correlation id (§2.5); if you would rather it were a `BusinessRuleViolation` 409 with a stable code, that is a one-line `AppException.businessRule` branch in `mapDocumentGuardError` (`application/accounting-documents.service.ts:829`, the function that already maps the sibling finalize-guard errors), and it should be decided once for all invariant violations, not for this one error.
4. `data/accounting-configurations.repository.ts` `markOperationallyUsed` — it is now org-scoped, first-use-wins and **still has no production caller**. If you would rather delete the service seam entirely (leaving only the data-layer function), say so; it was kept because Task 11 documented it as the tested seam.
5. The size of the change (§15) and whether you want it split before review.
6. `test/support/accounting-document-repositories.ts` — the `extraTables` parameter on `withRollback`: it exists so the fake's rollback realism matches production; a reviewer may prefer a dedicated store snapshot.
7. The pre-existing D4 live test (`test/accounting-configuration-live.e2e-spec.ts`) is unchanged by design — it asserts marking does **not** happen on account creation. It ran green in CI on the pushed head (§5.4); deciding whether to add a **positive** live assertion (finalize marks the pinned configuration, through the real Prisma path) is a reviewer call — the marker's SQL semantics are covered by `rehearse.mjs` and by the unit suites, not by a live HTTP round-trip.

## 15. AG-19 size note and split recommendation

Measured against the baseline (`git diff --numstat` + the new files):

| Part                                              | Lines                                                                                                                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| production `src/modules/accounting/**` (non-spec) | **+461 / −40** — 173 of those insertions are the new `data/accounting-configuration-usage.ts`; a large share of the rest is the rationale headers the module convention requires (AG-07/AG-16) |
| shared test doubles (`test/support/`)             | +118 / −34                                                                                                                                                                                     |
| unit specs                                        | +1042 / −27                                                                                                                                                                                    |
| live e2e (remediation, §5.5)                      | +316 / −0 — one file, `backend/test/accounting-documents-live.e2e-spec.ts`; nothing removed, so no existing assertion was weakened                                                             |
| docs                                              | +179 / −25 (+335 for this report)                                                                                                                                                              |
| evidence scripts + logs                           | +1264 (scripts) + 68 (captured logs)                                                                                                                                                           |

Excluding the evidence scripts and logs, the reviewed surface is ~**1840 added lines**, of which the behavioral core is 461 — still **over AG-19's ~600-line guidance**, driven mostly by the new test suites (which is where a reviewer should spend their skepticism, not their time).

**Recommendation: review as one commit; split only if you want the seams separated for the record.** The parts are not independently meaningful: the marker's semantics (set resolution), its write, its lock position, the fakes and the tests are one decision. If a split is required, the only clean cut is (A) domain rule + fakes + domain unit tests, then (B) the data-layer marker + `finalizeChecked` wiring + matrix/docs + rehearsal scripts — noting that (A) alone changes no production behavior, so it buys review focus at the cost of a temporarily dead rule.

## 16. Links

- Decision analysis implemented here: [`accounting/task-11-mark-operationally-used-decision-note.md`](./accounting/task-11-mark-operationally-used-decision-note.md) §3/§4/§5/§6 (banner + preserved text)
- Governance: [`accounting/configuration.md`](./accounting/configuration.md) (Operational freeze — wired), [`accounting/lock-order-matrix.md`](./accounting/lock-order-matrix.md) (row `D4″`), [`accounting/task-index.md`](./accounting/task-index.md) §2 row 13, [`adr/0028-accounting-configuration-foundation.md`](./adr/0028-accounting-configuration-foundation.md) (addendum), [`open-questions.md`](./open-questions.md) (OQ-64 Resolved), `modules.md`
- Review: PR **#31** `https://github.com/MR-AliEsmaeili/Vardena/pull/31` (head `3e198d2e`, pushed from `arena/01a0cd89-vardena`)
- Evidence: [`accounting/task-13-evidence/postgres-rehearsal.log`](./accounting/task-13-evidence/postgres-rehearsal.log), [`accounting/task-13-evidence/postgres-backfill-repair-probe.log`](./accounting/task-13-evidence/postgres-backfill-repair-probe.log)
- Related reports: `task-11-implementation-report.md` (D1–D7), `task-11-defect-resolution-report.md` (A–J), `task-12-remediation-report.md` (P1 real-PostgreSQL follow-up — still open, and deliberately not absorbed here)
- Rules: AR-05 (framework-free domain), AR-11 (parameterized raw SQL, scoped), AR-12 (money as decimal strings), AR-23 (audit), AG-03 (scope), AG-06 (failure-path tests), AG-07 (docs in sync), AG-16 (citations), AG-19 (review size), AG-21 (handoff)
- Contract references: §12 (voucher lines/accounts), §13.1/§13.5 (exact decimals), §15.2–§15.5 (finalization, immutability), §16.4 (idempotency), §19.3 (projections), AC-D-20/22/23, AC-I-05/06/08/12/14
