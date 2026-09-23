# Vardena — Accounting Task Index

Status: **Authoritative** · Date: 2026-09-23 · Type: governance / index (documentation only) · Task 11: **ACCEPTED 2026-09-22** · Task 12: **ACCEPTED WITH FOLLOW-UP 2026-09-23** · Task 13: **IN PROGRESS (self-review, 2026-09-23)** — PR #31 open, required CI **green** (`5ad94f6` run `35852213257`; head `692ee0f` run `35852746750`) · Task 14: **READY FOR REVIEW — NOT ACCEPTED (2026-09-23)**, branch `arena/01a0cf1f-vardena` (not pushed yet); see §2 row 14, §6, §9

> This document is the authoritative record of which Accounting implementation
> tasks exist, what state the module is in, which capabilities are still only
> candidates, which Open Questions gate them, and how a future task becomes
> authoritative. It defines no new capability, resolves no Open Question, and
> changes no architecture. The binding technical contract stays in
> [`domain-contract.md`](./domain-contract.md) and [ADR-0026](../adr/0026-accounting-bounded-context.md).

## 1. Purpose

Remove ambiguity around Accounting task sequencing after Task 10.8, so that:

- completed work (Tasks 10.1–10.8) is verifiable against repository evidence;
- the current architectural state is stated once, accurately;
- unimplemented capabilities stay **candidates**, never implicit commitments;
- the Open Questions constraining each candidate are visible;
- the next implementation task can only enter through an explicit, checkable process (§8);
- **no task number (including 10.9) is treated as defined until this index says so.**

## 2. Verification basis

Tasks 10.1–10.8 were verified as complete from merged PRs #15–#23, their file
lists, the implementation reports in `docs/`, the migrations under
`backend/prisma/migrations/`, and the Accounting entry in `docs/modules.md`.
Task 11 (PR #25) is recorded the same way, plus the remediation evidence
(`docs/task-11-implementation-report.md`):

| Task | Merged PR                     | Delivered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Primary evidence                                                                                                                                                              |
| ---- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10.1 | #15 (+ #16 accepts ADR-0026)  | Domain Contract, ADR-0026, OQ-39…OQ-43, notes on OQ-03/11/12/23/25/27/31 (docs only, no code)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `docs/accounting/domain-contract.md`, `docs/adr/0026-accounting-bounded-context.md`                                                                                           |
| 10.2 | #17                           | Financial areas, fiscal years, accounting periods; 17 permissions; HTTP API                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `20260914000000_accounting_foundation`, `docs/modules.md` Accounting entry                                                                                                    |
| 10.3 | #18                           | Coding-structure versions/levels + chart of accounts; 7 more permissions (24 total)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `20260914010000_accounting_coding_structure_accounts`, `docs/modules.md`                                                                                                      |
| 10.4 | #19                           | Voucher header + lines, `draft → temporary → final`, Foundation numbering, idempotency ledger; 5 document permissions (29 total)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `20260915000000_accounting_documents`, `docs/task-10.4-implementation-report.md`                                                                                              |
| 10.5 | #20                           | Posting Readiness contract (pure `domain/posting-readiness.ts` + internal `PostingReadinessService`; no endpoint, permission, migration)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `docs/task-10.5-implementation-report.md`                                                                                                                                     |
| 10.6 | #21                           | Posting & ledger contracts (`domain/posting.ts`, `domain/ledger-entry.ts` + specs; pure, framework-free, no persistence)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | PR #21 file list, source headers, `docs/task-10.7-implementation-report.md` §2                                                                                                |
| 10.7 | #22                           | `ledger_entries` persistence; finalization atomically materializes one immutable entry per stored line; no endpoint, permission, or event                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `20260916000000_accounting_ledger`, `docs/task-10.7-implementation-report.md`                                                                                                 |
| 10.8 | #23                           | Posting orchestration seam (`PostingService.postVoucher`; `finalizeDocument` delegates); provided, not exported; no schema/API/permission/event change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `docs/task-10.8-implementation-report.md`, `docs/modules.md`                                                                                                                  |
| 11   | #25 (+ #29 defect-resolution) | **ACCEPTED 2026-09-22** — Accounting Configuration Foundation per D1–D7: `accounting_configurations` + `accounting_configuration_levels`, `accounts.accounting_configuration_id` NOT NULL (D1/D3), LEGACY backfill for orphan organizations, freeze abstraction with D4 deferred; remediation (2026-09-22) fixed the level-copy/fallback semantics, aligned the `levelKind` contract, and added cross-configuration regression tests + the migration rehearsal; defect-resolution (PR #29, `docs/task-11-defect-resolution-report.md`, CI `35755493453`/`35755917087` success) verified isolation, per-definition consistency, active-status, one-level preservation, levelKind and test-evidence defects — **Task 11 — Accounting Configuration Foundation: ACCEPTED** | `20260920000000_accounting_configuration_foundation`, `docs/accounting/configuration.md`, `docs/task-11-implementation-report.md`, `docs/task-11-defect-resolution-report.md` |
| 12   | `a62a13d` (branch `arena/01a0ca12-vardena`, remediated `f2f10be`/`264a395`/`a62a13d`) | **ACCEPTED WITH FOLLOW-UP 2026-09-23** — Balance Projection (turnover-only, rebuildable) per ADR-0031, contract §19.3 AC-D-31 + §25 AC-I-19: `accounting.account_balance_projections` (org, area, year, period, account) with `period_debit/credit numeric(18,2)` only — no `branch_id`/currency/dimension/opening columns (AR-29); derived `period_net/opening/closing` via `vw_account_balance_derived` (window by `accounting_periods.sequence`, partitioned by year/account never crossing years) + domain `deriveBalances`; transactional maintenance inside `finalizeChecked` (UPSERT per key after ledger inserts, before operation row) with canonical lock order `area→year→period→accounts FOR SHARE→balances FOR UPDATE→document FOR UPDATE` (legacy `document→balances` helper removed); explicit audited rebuild `POST /balances/rebuild` (org-wide optionally area/year, idempotent-by-replacement, `AccountBalance.Rebuilt` event, `FOR UPDATE` slice lock); reads `GET /balances` (batched fallback without silent `take:10000` truncation), `GET /balances/:accountId`, `GET /balances/reconciliation` (`Balance.View`, 404 for foreign keys) + `vw_balance_reconciliation` FULL OUTER JOIN (`missing/extra/debit/credit/both_mismatch` — debit/credit/both tested); migration `20260922000000_accounting_balance_projection` (single-strategy insert-from-ledger backfill HAVING <>0, two views, `abp_`+md5 clarified as one-time deterministic TEXT PK vs ULID for runtime); permissions `Accounting.Balance.View/Rebuild` (31→33); out-of-scope §17 preserved (no zero-row persistence, no Redis/triggers/microservices/EAV, OQ-62/63/64/G7 still OPEN, 10.9 intentionally skipped — next free integer after 11). **Acceptance rationale:** R-01 legacy helper removed, R-02/R-06 canonical lock order documented & statically verified, R-03 silent truncation eliminated (batched fetch), R-04 opening/fiscal-year semantics documented (ADR-0031 §4/§9, first period opening 0, carry-forward OUT OF SCOPE), R-05 reconciliation coverage expanded (all 4 mismatch states + decimals/multi-scope), migration/API/auth/tenant/pagination/build/typecheck/PGlite rehearsal gates PASS. **Mandatory P1 follow-up:** Real PostgreSQL concurrency verification was NOT executed (runtime unavailable) — tracked as P1 follow-up requiring separate PostgreSQL execution with independent connections and lock-timeout/deadlock assertions; do not claim production PG concurrency safety proven by PGlite. ADR-0031 remains **Proposed** per governance; Task 11 remains CLOSED. | `20260922000000_accounting_balance_projection`, `backend/src/modules/accounting/domain/balance-projection.ts`, `backend/src/modules/accounting/data/account-balance-projections.repository.ts` (legacy helper removed), `backend/src/modules/accounting/application/accounting-balances.service.ts` (batched fallback) + `api/accounting-balances.controller.ts`, `docs/adr/0031-balance-projection.md` (interpretation A + fiscal-year deferral), `docs/accounting/lock-order-matrix.md`, `docs/task-12-remediation-report.md` (`a62a13d`, 19 sections, READY FOR REVIEW → ACCEPTED WITH FOLLOW-UP) |
| 13   | `arena/01a0cd89-vardena` (self-review deliverable; pushed SHA recorded in §9 once opened) | **IN PROGRESS (self-review, 2026-09-23) — NOT Accepted** — Accounting Operational Freeze (D4 marker wiring), per `docs/accounting/task-11-mark-operationally-used-decision-note.md` §5/§6 and OQ-64 (now **RESOLVED**): `operationally_used_at` is written by exactly ONE guarded statement — `UPDATE accounting_configurations SET operationally_used_at/updated_at/updated_by WHERE id = ? AND organization_id = ? AND operationally_used_at IS NULL RETURNING id` — issued per DISTINCT pinned configuration of the finalized voucher's lines, inside `finalizeChecked` after the line accounts are resolved and BEFORE they are locked `FOR SHARE` (lock-order row `D4″`, no new position); Account creation/activation marks nothing; a `pending`/`temporary` voucher freezes nothing; a rolled-back finalization leaves `NULL`; replay/second-voucher keep the first timestamp; an unresolvable account pin fails closed before any write; NO new migration/column/table/status/DTO/endpoint/permission/event; `markOperationallyUsed` stays endpoint-free (org-scoped, first-use-wins, delegating to the same statement). **Verification:** `npx tsc --noEmit` clean; unit suites `posting.service.spec.ts` 25 + `posting-readiness.spec.ts` 13 + `accounting-configuration-usage.spec.ts` (domain 10 + data 12) + `accounting-configurations.spec.ts` 11 + `coding-structure-accounts.spec.ts` 32; real-PostgreSQL rehearsal `backend/prisma/rehearsal/task-13-operational-freeze/rehearse.mjs` 23/23 (lock wait, first-use-wins, rollback, org scope, deadlock asymmetry) → `docs/accounting/task-13-evidence/postgres-rehearsal.log`; report `docs/task-13-implementation-report.md`. **Not executed in the sandbox** (no `prisma generate`): the Prisma `*-live.e2e-spec.ts` suites and `build` — the required CI job then ran them on head `5ad94f6` (run `35852213257`, `completed success`, incl. `Prisma generate` + `E2E tests (incl. live-DB suites)` on `postgres:16`) per report §5.4. A post-review remediation added two positive live tests for the marker itself (report §5.5). | `docs/accounting/lock-order-matrix.md` (D4″), `docs/accounting/configuration.md` (Operational freeze — wired), `backend/src/modules/accounting/data/accounting-configuration-usage.ts`, `docs/task-13-implementation-report.md` |

| 14   | `arena/01a0cf1f-vardena` (local, not pushed yet) | **READY FOR REVIEW — NOT ACCEPTED (2026-09-23)** — Accounting Period Close Foundation (`OPEN → CLOSED → SEALED`), scoped by explicit user decision as **"harden, prove, document"**: the lifecycle, the statuses, the explicit transition commands and the enforcement predicate already existed (Tasks 10.2/10.4/10.7); Task 14 hardens *where* the locked status is judged, proves the required behaviours on real PostgreSQL and documents the decisions. **Production changes (no schema, no migration, no endpoint, no permission, no event):** `finalizeChecked` now judges the locked scope **first**, immediately after `lockScopeInTx` and before the Task 13 freeze marker / account `FOR SHARE` / projection / document locks / any write (lock-order row `D4‴`), keeping the post-document-lock re-assertion as the stored-scope verdict; the scope resolver verifies the LOCKED period's organization + year; `AccountingPeriodsRepository.createChecked`/`transitionChecked` verify the caller's organization (and area, on create) against the locked rows and plan the move against the **locked** status. **The contract-sanctioned reopen exception is preserved and documented** (`CLOSED → OPEN`, and `SEALED → OPEN` after the audited year `unseal`) — ADR-0032 §6/§8, with no new bypass, no force-close and no arbitrary status endpoint. **Evidence (this sandbox, real PostgreSQL 17.10 on `127.0.0.1:5432` with all 14 migrations applied):** new live suite `backend/test/accounting-period-lifecycle-live.e2e-spec.ts` **13/13 passed** (open finalizes; closed/sealed refuse with `{scope:'period', status}` and zero trace — no ledger entry, no `final`, no operation row, no marker, no projection, no event; `open→close→seal` applied and every other move refused; permitted reopen + postings resume; sealed-year reopen refusal; organization isolation on real rows; posting-vs-close races in **both** orders; two concurrent closes → one winner and one event; refused posting leaves `operationally_used_at` NULL; finalized rows untouched by close+seal; readiness intact), the gate-placement probe (a posting into a `closed` period is refused **while** an unrelated transaction holds an `accounting_configuration` row `FOR UPDATE` — it never queues behind the freeze path), `npm test` **88 files / 1017 tests passed**, `npm run test:e2e` **24 files / 249 tests passed** (live suites included, none skipped), `npm run build` OK, `npm run typecheck` clean, `npm run format` clean, `npm run lint` 4 pre-existing warnings / 0 errors, `npx prisma validate` OK, all 14 migrations applied in order to a **brand-new empty database** with the resulting catalog identical to the migrated working database (999 objects, zero drift). **Not executed here:** the real `prisma migrate deploy` (its schema-engine download is network-blocked in this sandbox — CI runs it) and CI itself (branch not pushed). Docs: ADR-0032 (Proposed), `docs/accounting/lock-order-matrix.md` rows `D4‴`/`T14-1…T14-4` + four corrected rows, `docs/task-14-implementation-report.md`. `OQ-23` stays OPEN (reopen/unseal authority, closed-period posting policy). | `backend/src/modules/accounting/data/{accounting-documents.repository.ts,accounting-locks.ts,accounting-periods.repository.ts}`, `backend/src/modules/accounting/application/accounting-periods.service.ts`, `backend/test/accounting-period-lifecycle-live.e2e-spec.ts`, `docs/adr/0032-accounting-period-close-enforcement.md`, `docs/task-14-implementation-report.md` |

A repository-wide search for `10.9` returns **zero hits**: no task brief, report,
ADR, OQ, comment, or test defines or references it (see §7).

## 3. Current architecture (after Task 11 — ACCEPTED 2026-09-22; Task 12 — ACCEPTED WITH FOLLOW-UP 2026-09-23)

Accounting currently contains (Task 11 ACCEPTED — see §2/§6/§9). Task 12's balance projection is **ACCEPTED WITH FOLLOW-UP** on `arena/01a0ca12-vardena` (`a62a13d`, see §2 row 12) — pending P1 real-PostgreSQL concurrency verification, but otherwise part of the accepted architecture per §6:

- **Document Foundation** — typed `accounting_voucher` aggregate (header + lines),
  `draft → temporary → final`, Document Foundation numbering per
  (organization, area), origin evidence (`manual` / `system`).
- **Fiscal Year / Accounting Period foundation** — areas, years (`open|closed|sealed`),
  period rows, explicit permission-gated transitions, stored resolution.
- **Posting Readiness** — internal read-only verdict (`ready | not_ready`) over a
  final voucher; calendar status and account activity are deliberate non-criteria.
- **Posting Contract** — `PostingInput` / `PostingResult` pure boundary (Task 10.6).
- **LedgerEntry persistence** — `accounting.ledger_entries`, one immutable row per
  posted line, insert-only, 1:1 backstop on `voucher_line_id`.
- **Atomic Posting** — `finalizeChecked`: one transaction (fixed lock order,
  in-transaction re-validation, `state = final`, N entries, operation row LAST).
- **Posting Orchestration seam** — `PostingService` coordinates resolve →
  idempotency → lifecycle → atomic persistence → `Finalized` event → readiness →
  result; it opens no transaction and writes no row of its own.

Established flow (Tasks 10.5–10.8):

```text
Voucher
  ↓
Posting Readiness
  ↓
Posting Contract
  ↓
Atomic Posting
  ↓
LedgerEntry persistence
  ↓
Posting Orchestration
```

**Task 13 — Operational Freeze (D4 marker): IN PROGRESS (self-review, 2026-09-23)** added the one caller the
configuration foundation deliberately lacked: `finalizeChecked` marks the configurations its lines used through
`data/accounting-configuration-usage.ts` (the module's only writer of `operationally_used_at`), at the existing
configuration position of the lock order (matrix row `D4″`), and `docs/accounting/configuration.md` §Operational freeze
— wired replaced the "deferred" text. Nothing else changed: no migration, no endpoint, no permission, no event, no
status; the freeze policy itself (`domain/accounting-configuration-freeze.ts`) is unchanged apart from the new
pin-resolution rule.

Original Task 11 note preserved for the record:

**Task 11 — Accounting Configuration Foundation: ACCEPTED 2026-09-22 (PR #25 remediated 2026-09-22 + PR #29 defect-resolution `docs/task-11-defect-resolution-report.md`, CI `35755493453`/`35755917087` success) added the configuration root:**

- `accounting.accounting_configurations` + `accounting_configuration_levels`
  (DRAFT → ACTIVE → SUPERSEDED, exactly one ACTIVE per organization: `FOR UPDATE`
  lock primary, partial unique index `uq_accounting_configurations_org_active`
  backstop);
- `accounts.accounting_configuration_id` — the sole configuration scope,
  NOT NULL after the D3 backfill (LEGACY configuration per organization with
  accounts and no ACTIVE one); `coding_structure_version_id` (D2) is untouched
  and remains the code-shape pin;
- root creation and moves validate **only** against the pair the account is
  assigned/inherited from, re-checked under lock at the write boundary
  (`planRootAccountPin`, `planAccountMovePin`);
- the operational-freeze abstraction exists with **D4 deferred**: no caller for
  `markOperationallyUsed` (decision note:
  `accounting/task-11-mark-operationally-used-decision-note.md`, OQ-64);
- the D3 backfill behaviour is verified by the deterministic rehearsal
  (`backend/prisma/rehearsal/task-11-configuration-foundation/rehearse.mjs`,
  `npm run test:migration-rehearsal`) — populated pre-Task-11 data, lock probe,
  row/reference/level/constraint assertions.

Accepted facts this index preserves (Tasks 10.5–10.8, do not reinterpret):

- `PostingResult` has **no `id`**; entry identity is each row's own ULID.
- The idempotency identity is the existing `(organization_id, operation_key)` +
  `request_hash` of kind `document_finalize` — there is no second key scheme and
  no `ledger-post-*` pattern.
- `LedgerEntry` is **immutable and insert-only**: no update, delete, or unscoped-read path.
- Posting is **synchronous, in-process, inside the finalization transaction**:
  no async posting, no Redis/Kafka, no microservice, no worker.
- **Calendar status is enforced inside that same transaction** (Task 14): the **locked** `accounting_periods.status` / `fiscal_years.status` is judged as the first action after the scope locks, before the freeze marker, the account locks, the projection locks and any write, and re-judged after the document lock as the stored-scope verdict; a refused finalization leaves no trace. `closed` refuses new documents and finalizations (AC-I-04, §7.2 rule 4); `sealed` refuses everything, including a period reopen, unless the **year** is unsealed first through its own audited operation — the contract-sanctioned exception (§7.2 rules 4/5, AC-I-17) recorded by ADR-0032 rather than removed.
- **Dimensions, posting rules and reports do not exist** in code. **Balances**: the turnover projection (`account_balance_projections` + derived views + transactional maintenance + rebuild) is **ACCEPTED WITH FOLLOW-UP as Task 12** on `arena/01a0ca12-vardena` (`a62a13d`, `264a395`) — **ADR-0031 remains Proposed per governance** (not marked Accepted outside promotion process), but the projection itself is now part of the accepted architecture per §6; ledger remains the sole source of truth, projection is rebuildable reporting-only, pending P1 real-PostgreSQL concurrency verification.
- **Inventory does not post automatically** to Accounting; no source-module trigger exists.
- **Outbox/delivery semantics are undecided** (OQ-39); the only publication is the
  in-memory `AccountingDocument.Finalized` event.

## 4. Future capability map

Candidate capabilities supported by repository evidence
(contract §28, `docs/modules.md` Accounting entry, task reports). **None of
these is an approved task.** No priority order is implied.

| Capability                                                                     | Status                                                     | Gates                                                        | Evidence                                                               |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Control roles (code-defined role → account mapping)                            | Candidate · Blocked by OQ                                  | OQ-25                                                        | Contract §8.7 (AC-D-09); `docs/modules.md` "still to build"            |
| Detail dimensions / groups / items (incl. floating detail)                     | Candidate · Blocked by OQ                                  | OQ-41                                                        | Contract §10/§11 (AC-D-11…AC-D-15); `docs/modules.md` "still to build" |
| Posting rules / account mapping (incl. tax & valuation mappings)               | Candidate · Blocked by OQ                                  | OQ-24, OQ-25, OQ-30                                          | Contract §20.2; `docs/modules.md` "still to build"                     |
| Correction / reversal / replacement mechanisms                                 | Candidate · Blocked by OQ                                  | OQ-27 (OQ-23 for period dating)                              | Contract §15.4 (AC-D-22); `docs/modules.md` "still to build"           |
| Configuration operational freeze (D4 marker, first use wins)                | **IN PROGRESS (self-review) 2026-09-23 · Task 13** — implementation on `arena/01a0cd89-vardena`, awaiting human acceptance | OQ-64 **RESOLVED**; ADR-0028 §3 + 2026-09-23 addendum; lock-order row `D4″` | `docs/task-13-implementation-report.md`, `docs/accounting/task-13-evidence/postgres-rehearsal.log` |
| Balance projections (rebuildable, never the source of truth)                   | **ACCEPTED WITH FOLLOW-UP 2026-09-23** · ADR-0031 Proposed (P1: real PostgreSQL concurrency verification) | ADR-0031 + AC-D-31/AC-I-19; canonical lock order, batched fallback, opening within fiscal year only, full reconciliation | Task 12: `account_balance_projections` + `vw_*` + 4 endpoints, `a62a13d` remediation report (19 sections), lock matrix, PGlite rehearsal |
| Accounting reporting (ledgers, trial balances, statements via Reporting)       | Candidate · Blocked by OQ                                  | OQ-25, OQ-43 (layouts)                                       | Contract §19 (AC-D-30); `docs/modules.md` planned API                  |
| Inventory → Accounting integration                                             | Candidate · Blocked by OQ                                  | OQ-24, OQ-25, OQ-30, OQ-39                                   | Contract §20 (AC-D-32), activation gate §20.4                          |
| Durable integration / outbox (delivery semantics)                              | Candidate · Requires Architecture Decision · Blocked by OQ | OQ-39 (transactional subscription vs durable queue)          | Contract §16.6 (AC-D-26), §21; Task 10.8 report §7                     |
| Statutory / e-ledger requirements                                              | Candidate · Blocked by OQ                                  | OQ-43 (expert validation first)                              | Contract §2.3 (C1–C7), §28.2                                           |
| Posting modes (Mode A direct / Mode B review) + approval authority             | Candidate · Blocked by OQ                                  | OQ-42                                                        | Contract §17.2 (AC-D-28); Task 10.4 report §19                         |
| Financial-area access grants (user ↔ area)                                     | Candidate · Blocked by OQ                                  | OQ-40                                                        | Contract §5.5 (AC-D-05), §22 vocabulary                                |
| Year-transition operations (closing / opening documents)                       | Candidate · Blocked by OQ                                  | OQ-23                                                        | Contract §6.4; transitions exist (Task 10.2), the operation does not   |
| Per-account financial-area applicability                                       | Candidate · Blocked by OQ                                  | OQ-40                                                        | Contract §5.4/§8.3; deferred in `docs/modules.md`                      |
| Chart-governance extensions (`account_type` / `is_temporary`, reserved ranges) | Candidate · Blocked by OQ                                  | OQ-25                                                        | Contract §8.3/§9.1; deferred in `docs/modules.md`                      |

Statuses used: `Implemented` · `Candidate` · `Blocked by OQ` ·
`Requires Architecture Decision` · `Not yet defined`.

## 5. Open Questions

All entries below are **OPEN** in [`docs/open-questions.md`](../open-questions.md),
which remains the single source of truth for OQ text and status. This index
changes none of them — it only records which candidates each one constrains.
(**OQ-64 is the exception:** Task 13 resolved it on 2026-09-23 and the row moved
to that file's Resolved table — recorded here so this index does not contradict
it.)

```text
Future Capability
        ↓
Relevant Open Question
        ↓
Decision required before implementation
```

| OQ    | Question (short; full text in `open-questions.md`)                                                                  | Constrains                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| OQ-25 | Chart of accounts: coding scheme/levels, mandatory control roles, eligibility defaults, report layouts              | Control roles, posting rules, chart-governance extensions, reporting              |
| OQ-39 | Durable integration: transactional subscription vs durable queue; rejected-posting handling                         | Durable integration/outbox, Inventory → Accounting, any production system posting |
| OQ-40 | Financial areas: multiplicity, per-area charts, access grants, default area, consolidation                          | Area access grants, per-account area applicability                                |
| OQ-41 | Detail dimensions: count, per-dimension requiredness, master-data binding, item governance                          | Detail dimensions / groups / items                                                |
| OQ-42 | System-posting policy: Mode A vs Mode B default, who finalizes/approves, rejection meaning                          | Posting modes / approval authority                                                |
| OQ-43 | Iranian statutory requirements: legal books, timing, language/currency, no deletion, Art. 169, e-invoice, retention | Statutory / e-ledger, reporting layouts, correction windows                       |

Other load-bearing Accounting OQs identified by the repository
(contract §27/§28.2, `docs/modules.md` Accounting rules):

| OQ    | Question (short)                                                                      | Constrains                                       |
| ----- | ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| OQ-03 | Currencies, precision per currency                                                    | Money handling, reporting, future multi-currency |
| OQ-11 | Ledger policy (period rules, opening balances, costing method)                        | Ledger behaviour, valuation reporting            |
| OQ-12 | Numbering: sequences, year component, gap policy                                      | Document numbering extensions                    |
| OQ-23 | Fiscal calendar policy: layout, close/reopen, closed-period posting, year-end entries | Year-transition operations, period policy        |
| OQ-24 | Inventory valuation method, returns/adjustments, negative stock                       | Posting rules, Inventory → Accounting            |
| OQ-27 | Correction windows, cross-period corrections, uncorrectable documents                 | Correction / reversal / replacement              |
| OQ-30 | Tax model: taxes, inclusive/exclusive, rounding, liability accounts                   | Posting rules, invoice content                   |
| OQ-31 | Inter-branch / inter-company treatment, second legal entity                           | Consolidation (deferred; needs its own ADR)      |

## 6. Task 11 acceptance, Task 12 acceptance with follow-up, Task 13 status, and Task 10.9 status

> **Task 13 — Accounting Operational Freeze (D4 marker wiring): IN PROGRESS (self-review,
> 2026-09-23).** The implementation, its evidence and its limits are in
> `docs/task-13-implementation-report.md`. It is **not** Accepted: per §7's rule
> and this index's status vocabulary, acceptance requires human acceptance + push
> to the remote branch + an open PR + PR checks and the required CI job green on
> the head SHA (`lint → typecheck → format:check → unit tests → build →
> migrate deploy + live e2e` on PostgreSQL). The branch is pushed and PR **#31** is
> open; the required job is **green on head `5ad94f6`** (run `35852213257`: Prisma
> generate, lint, typecheck, format, 1017 unit tests, build, migrate deploy, the
> Task 11 migration rehearsal and the live-DB e2e suites on `postgres:16`) —
> report §5.4, then re-run green on the docs-only heads that followed (`692ee0f`,
> run `35852746750`, and `0aa45f0`, run `35853236723`). The gate this sandbox could
> not execute is therefore closed by CI, not by local evidence
> (`docs/accounting/task-13-evidence/postgres-rehearsal.log` covers the SQL/data
> layer only). The residual evidence gap it left — no **positive** live assertion
> that finalization marks the pinned configuration — is now closed in code as well:
> `backend/test/accounting-documents-live.e2e-spec.ts` gained
> `Task 13 D4: finalizing a real voucher marks the configuration its lines pinned`
> and `Task 13 D4: a finalization that rolls back leaves the configuration unused`
> (report §5.5). They execute only where a generated Prisma client and a migrated
> database exist — i.e. in the CI job on `postgres:16` (`VARDENA_TEST_DATABASE_URL` is
> job-level, so the suite's `skipIf` does not fire there) — and they have: head
> `23942af`, run `35866991009`, `completed success`, step
> `E2E tests (incl. live-DB suites)` green. Both new tests therefore ran against a real
> PostgreSQL 16 and passed; the task stays **IN PROGRESS (self-review)** because
> acceptance is a human decision (§7).
>
> **Task 11 — Accounting Configuration Foundation: ACCEPTED 2026-09-22.**
>
> **Task 12 — Accounting Balance Projection: ACCEPTED WITH FOLLOW-UP 2026-09-23.**
>
> **Task 10.9 is not formally defined in the repository at this time.**
>
> **NOT FORMALLY DEFINED** (10.9)

**Task 14 — Accounting Period Close Foundation: READY FOR REVIEW (not Accepted), 2026-09-23.** `docs/task-14-implementation-report.md` is the evidence; `docs/adr/0032-accounting-period-close-enforcement.md` (Proposed) records the two decisions a reviewer must check: the gate is judged on the **locked** rows *inside* the finalization transaction and moved **before** every other step of that transaction (no lock added, removed or moved), and `CLOSED → OPEN` / `SEALED → OPEN` stay reachable **only** through the shipped, permission- and reason-gated `reopen` operation, which contract §7.2 rules 4/5 and AC-I-17 explicitly permit — the brief's "unless the existing domain specification explicitly permits it" clause. Task 14 changes **no** schema, migration, endpoint, permission or event, so it needs no upgrade assumption; the acceptance gate this sandbox cannot close is CI on the pushed branch (and the real `prisma migrate deploy`, whose engine download is network-blocked here) — everything else ran against a real PostgreSQL 17.10 database (§2 row 14). It is **not** Accepted.

**Task 11 — ACCEPTED** — The foundation per D1–D7 (PR #25 + remediation 2026-09-22 + defect-resolution PR #29, `docs/task-11-defect-resolution-report.md`, CI `35755493453`/`35755917087` success) is the authoritative implemented state. Preserved explicitly:

**Task 12 — ACCEPTED WITH FOLLOW-UP 2026-09-23** — Balance Projection delivered on `arena/01a0ca12-vardena` (`a62a13d`, `264a395`) per ADR-0031: `accounting.account_balance_projections` (org, area, year, period, account; `period_debit/credit numeric(18,2)` only) + two views (`vw_account_balance_derived` window by `sequence` partitioned by year/account never crossing years, `vw_balance_reconciliation` FULL OUTER JOIN) + transactional `finalizeChecked` with canonical lock order `area→year→period→accounts FOR SHARE→balances FOR UPDATE→document FOR UPDATE` (legacy `document→balances` helper removed) + batched fallback without silent `take:10000` + explicit audited rebuild + org+financial-scope reads + `Accounting.Balance.View/Rebuild` (31→33) + `AccountBalance.Rebuilt` event + opening within fiscal year only (first period opening 0, carry-forward OUT OF SCOPE) + full reconciliation coverage (all 4 mismatch states + decimals/multi-scope). **Acceptance rationale (R-01…R-06):** legacy helper removed, canonical lock order documented & statically verified, silent truncation eliminated, opening/fiscal-year semantics documented, reconciliation expanded, migration/API/auth/tenant/pagination/build/typecheck/PGlite rehearsal gates PASS. **Mandatory P1 follow-up:** Real PostgreSQL concurrency verification was NOT executed (runtime unavailable) — tracked as P1 follow-up requiring separate PostgreSQL execution with independent connections and lock-timeout/deadlock assertions; do not claim production PG concurrency safety proven by PGlite results. **Preserved:** `10.9 intentionally SKIPPED` (monotonic numbering after 11), `ADR-0031 Proposed` (not marked Accepted outside normal process per governance), `OQ-62/63/64/G7` still OPEN (not silently absorbed), out-of-scope §17 intact (no branch/currency/dimension/opening columns, no Redis/triggers/microservices/EAV, no zero-row persistence). Task 11 stays **ACCEPTED/CLOSED** — not reopened.

Original §6 preserved for Task 11:

- **OQ-62: OPEN** — pin compatibility requires future Product + Architecture decision.
- **OQ-63: OPEN** — legacy fallback shape.
- **OQ-64: OPEN / DEFERRED** — operational freeze integration belongs to Posting integration.
- **G7: ACCEPTED RISK** — raw-SQL partial index `uq_accounting_configurations_org_active` is guarded by live `pg_indexes` verification and migration rehearsal.

Consequences for Task 10.9:

- The number `10.9` is unassigned: it has no objective, scope, non-goals,
  dependencies, blocking OQs, ADRs, or acceptance criteria.
- No candidate in §4 may be treated as "Task 10.9" by assumption, and no
  acceptance criterion may be invented for it.
- The next Accounting implementation task takes the next free number only after
  passing the rule in §8.
- Every _future_ Accounting task, numbered `10.9` or otherwise, still passes §7 before any implementation.

## 7. Future task definition rule

A future Accounting capability becomes an implementation task **only after**
all of the following exist in the repository:

1. Its objective is explicitly defined.
2. Its domain scope is defined.
3. Its non-goals are defined.
4. Dependencies are identified.
5. Blocking Open Questions are identified.
6. Required ADR / domain decisions exist where necessary.
7. Acceptance Criteria are defined.
8. The task is explicitly added to this task index (§2 table).

Only then may an implementation agent implement it. The task index is therefore
the authoritative bridge between:

```text
Architecture / Domain Decisions
            ↓
       Implementation Task
            ↓
           Agent
            ↓
          Review
            ↓
         Accepted
```

## 8. Current follow-ups (findings, NOT the next task)

Known technical follow-ups recorded in accepted task reports. Each needs its
own explicitly defined task (per §7) before any work; none of them is the
"next Accounting task" by default:

- **Task 12 P1 — Real PostgreSQL concurrency verification — OPEN — P1 follow-up (ACCEPTED WITH FOLLOW-UP 2026-09-23):** Real PostgreSQL concurrency verification was **not executed** because the runtime (Docker PostgreSQL, `psql`, separate `pg` connections) was unavailable in the remediation sandbox (`docker: command not found`, `apt` fetch failed). Required scenarios A–H (same key, overlapping/disjoint account sets, rebuild vs finalize existing/missing row, same operation, rebuild vs rebuild, finalization failure) were verified via static lock-order proof (`docs/accounting/lock-order-matrix.md` R1…R8) and executable **PGlite Wasm** rehearsal (`backend/prisma/rehearsal/task-12-pglite-rehearsal.mjs`, `docs/accounting/task-12-evidence/pglite.log` 7 sections ALL PASSED — syntax/view/window/constraint/transaction), but **PGlite is NOT equivalent to production PostgreSQL** for lock contention, deadlock detection, isolation, planner, or concurrent UPSERT under load. This P1 follow-up requires separate PostgreSQL execution with independent `pg` connections, `statement_timeout`/`lock_timeout`, deadlock assertions, and failure surfacing (per remediation brief §5 R-02/R-06). **Do not claim production PostgreSQL concurrency safety has been fully proven by PGlite results.** Tracked as follow-up of Task 12 acceptance with follow-up.

- **Task 10.4 `toAmountString` fallback** (`data/accounting-documents.repository.ts`):
  still contains a `number` → `String(value)` branch and a blanket `String(value)`
  fallback — the float-loss shape Task 10.7 removed from the ledger copy.
  Unreachable today (Prisma returns `Decimal`/string for `numeric(18,2)`); unify
  both copies on the narrowed ledger mapping (Task 10.7 report §13.4, Task 10.8
  report §8.5).
- **Duplicated scoped-read helpers**: two `mustFindInOrganization` copies plus the
  equivalent lines in `PostingReadinessService` (Task 10.8 report §8.6).
- **Fiscal-year date edits lack a document-reference guard** (Task 10.2 §6.5
  reading): readiness detects the resulting drift but the guard belongs to the
  calendar/year-transition task (Task 10.5 report §12.2).
- **Live fixtures use `status = 'published'`**, outside the domain vocabulary
  (`draft|active|superseded`) (Task 10.7 report §12.3).
- **Account pin compatibility is unenforced — OQ-62: OPEN** — pin compatibility requires future Product + Architecture decision. Nothing guarantees that an account's `coding_structure_version_id` (D2) and `accounting_configuration_id` (D1) describe the same level shape, and the Task 11 rehearsal produced a legacy organization where they genuinely disagree. Detection or repair needs the product/architecture decision first (Task 11 report §C/§I).
- **LEGACY fallback shape is a documented default, not derived — OQ-63: OPEN** — legacy fallback shape. Organizations with accounts but no ACTIVE coding-structure version receive Group 2 / Detail 3; whether the newest SUPERSEDED version's shape should be derived instead is open.
- **D4 marker wired — OQ-64: RESOLVED 2026-09-23 (Task 13)** — the caller exists:
  `finalizeChecked` → `markConfigurationsUsedByDocumentInTx`, one guarded
  first-use-wins statement per distinct pinned configuration of the voucher's
  lines, at the configuration position of the lock order (row `D4″`). Two
  findings survive from that work and are follow-ups, not new tasks:
  (a) **pre-existing usage is not backfilled** — the marker only exists from
  Task 13's deployment onward, so databases with older `final` vouchers keep the
  affected configurations editable until the repair `UPDATE` in
  `docs/task-13-implementation-report.md` §9 is run (a data-only migration was
  rejected: it would be an unaudited business effect and the first-use instant is
  not reliably reconstructable); (b) **the usage `reason` stays unpersisted** —
  the domain's `OperationalUsage.reason` (`first_voucher`) is computed for the
  freeze decision but has no column: the task's scope rule forbids a new column (no speculative schema, report §1/§10-R2).
- **D4 `markOperationallyUsed` had no caller (historical, resolved above)** — operational freeze integration belongs to Posting integration. Implementation is blocked on the voucher → configuration cardinality and the marker's position in the module's lock order; the shape is recorded in `accounting/task-11-mark-operationally-used-decision-note.md`.
- **G7: ACCEPTED RISK — raw-SQL partial index `uq_accounting_configurations_org_active` is guarded by live `pg_indexes` verification and migration rehearsal.** The index exists only in the migration (Prisma cannot declare a partial unique index); a future `prisma migrate dev` regenerating the schema would drop it. The live-DB suite (`test/accounting-configuration-live.e2e-spec.ts` item 6) and the rehearsal (`verify.sql` #14–#16) verify it; the drift is accepted and documented in `prisma/schema/accounting.prisma`.
- **`.vardena/project-context.md` staleness**: resolved 2026-09-22 — the file now
  describes the implemented backend instead of the documentation-only era.

## 9. Document history

| Date       | Change                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-17 | Created: index of Tasks 10.1–10.8, current architecture, candidate map, OQ mapping, Task 10.9 status, task definition rule. No code, schema, OQ, or ADR change.                                                                                                                                                                                            |
| 2026-09-22 | Task 11 recorded (PR #25) in §2/§3 and its remediation summarised: D3 level-copy/fallback correction, `levelKind` contract alignment, cross-configuration regression tests, deterministic migration rehearsal (`npm run test:migration-rehearsal`), OQ-62…OQ-64, and the D4 decision note. §8 follow-ups updated; `.vardena/project-context.md` refreshed. |
| 2026-09-22 | **Task 11 — Accounting Configuration Foundation: ACCEPTED** (PR #29 defect-resolution `docs/task-11-defect-resolution-report.md`, CI `35755493453`/`35755917087` success). §2/§3/§6/§8/§9 updated to reflect ACCEPTED; preserved explicitly OQ-62 OPEN, OQ-63 OPEN, OQ-64 OPEN/DEFERRED, G7 ACCEPTED RISK.                                                 |
| 2026-09-22 | **Task 12 — Balance Projection: READY FOR REVIEW (not Accepted)** (branch `arena/01a0ca12-vardena`) — `account_balance_projections` + two views + transactional maintenance + audited rebuild + 4 endpoints. §2/§4/§6/§9 updated; ADR-0031 Proposed (not Accepted), gate §7 not yet passed, 10.9 intentionally skipped, OQ-62/63/64/G7 still OPEN. |
| 2026-09-23 | **Task 13 — remediation: the positive live PostgreSQL marker assertion was added.** `backend/test/accounting-documents-live.e2e-spec.ts` gained two live tests (+316 lines, −0: test-only, no existing assertion touched) — a committed `PostingService.postVoucher` finalization marks the configuration its lines pinned, asserted on the raw `accounting_configurations` row (`operationally_used_at = finalized_at`, `updated_at` the same instant, `updated_by` NULL, and a decoy `SUPERSEDED` configuration in the same organization left NULL), and a finalization aborted by `uq_ledger_entries_voucher_line_id` (`23505`) inside the same transaction leaves the marker NULL with the row untouched (`updated_at` unchanged), after which a fresh-key retry marks it. No production file, migration, endpoint, permission or event changed, and no new marker entry point exists. The sandbox cannot execute live suites (no `prisma generate`); CI did — run `35866991009` on head `23942af` and `35867656089` on the docs head `0718d4e`, both `completed success`, step `E2E tests (incl. live-DB suites)` green on `postgres:16`, i.e. both tests really executed and passed (report §5.5). The task remains **IN PROGRESS (self-review)** — acceptance is a human decision (§7). |
| 2026-09-23 | **Task 13 — CI gate closed on the pushed branch**: PR **#31** (`arena/01a0cd89-vardena` → `main`, head `5ad94f6`), required `backend` job **`completed success`** (run `35852213257`) — Prisma generate, lint, typecheck, format:check, 1017 unit tests, build, migrate deploy, Task 11 migration rehearsal, **live-DB e2e suites on `postgres:16`**. Report §5.4 records it and narrows the residual gap to "no positive live assertion for the marker"; the task index status stays **IN PROGRESS (self-review)** because acceptance is a human decision (§7). |
| 2026-09-23 | **Task 12 — Accounting Balance Projection: ACCEPTED WITH FOLLOW-UP** (branch `arena/01a0ca12-vardena` `a62a13d`/`f2f10be`/`264a395`/`a62a13d`) — R-01 legacy helper removed, canonical lock order documented & statically verified, silent `take:10000` eliminated (batched 5000), opening/fiscal-year semantics documented (ADR-0031 §4/§9), reconciliation coverage expanded (all 4 mismatch states), migration/API/auth/tenant/pagination/build/typecheck/PGlite rehearsal gates PASS. **Mandatory P1 follow-up:** Real PostgreSQL concurrency verification NOT executed (runtime unavailable) — tracked as P1 follow-up requiring separate PostgreSQL execution with independent connections and lock-timeout/deadlock assertions; do not claim production PG concurrency safety proven by PGlite. ADR-0031 remains Proposed, Task 11 remains CLOSED, OQ-62/63/64/G7 still OPEN. §2/§3/§4/§6/§8/§9 updated; remediation report `docs/task-12-remediation-report.md` (19 sections, `a62a13d`) is the acceptance evidence. |
| 2026-09-23 | **Task 13 — Accounting Operational Freeze: IN PROGRESS (self-review)** on `arena/01a0cd89-vardena` — the D4 marker is wired into `finalizeChecked` (one guarded, organization-scoped, first-use-wins statement per distinct pinned configuration of the voucher's lines, at lock-order row `D4″`); the service seam is now org-scoped and delegates to the same SQL; account create/enable/disable still mark nothing; `docs/accounting/configuration.md`, `docs/accounting/lock-order-matrix.md`, `docs/accounting/task-11-mark-operationally-used-decision-note.md` (status banner only), `docs/modules.md` and OQ-64 (**RESOLVED**, moved to the Resolved table) were updated in the same change; no migration, no endpoint, no permission, no event. Not Accepted — see §2 row 13 and §6. |
| 2026-09-23 | **Task 14 — Accounting Period Close Foundation: READY FOR REVIEW (not Accepted)** on `arena/01a0cf1f-vardena` (not pushed) — enforcement *inside* the finalization transaction and *first* (row `D4‴`: before the Task 13 marker, the account/projection locks and every write; the post-document-lock re-assertion kept as the stored-scope verdict); organization ownership verified on the **locked** year/period rows in both period repositories; the contract-sanctioned `reopen` exception preserved and documented (ADR-0032, no new bypass/force-close/status endpoint); no schema, migration, endpoint, permission or event. New live PostgreSQL suite `backend/test/accounting-period-lifecycle-live.e2e-spec.ts` (13 tests: statuses, no-trace refusals, transition truth table, org isolation, both posting-vs-close orders, concurrent closes, marker immutability, finalized-row immutability, gate-placement probe) **13/13 passed** on PostgreSQL 17.10 here, `test:e2e` 24 files/249 tests, `npm test` 88 files/1017 tests, build/typecheck/format clean, lint 4 pre-existing warnings, `prisma validate` OK, 14 migrations applied to an empty database with zero catalog drift; CI not run (branch not pushed). §2 row 14, §3/§6/§9 updated; `docs/accounting/lock-order-matrix.md` rows `Y2/Y3/P1/P2` corrected (documentation-only: those operations never took an area lock) + `D4‴`/`T14-1…T14-4` added; `docs/adr/README.md` index rows for 0031/0032 added. **OQ-23 stays OPEN.** |
