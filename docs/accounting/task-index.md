# Vardena — Accounting Task Index

Status: **Authoritative** · Date: 2026-09-22 · Type: governance / index (documentation only) · Task 11: **ACCEPTED 2026-09-22**

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

A repository-wide search for `10.9` returns **zero hits**: no task brief, report,
ADR, OQ, comment, or test defines or references it (see §7).

## 3. Current architecture (after Task 11 — ACCEPTED 2026-09-22)

Accounting currently contains (Task 11 ACCEPTED — see §2/§6/§9):

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
- **Dimensions, posting rules, balances, and reports do not exist** in code.
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
| Balance projections (rebuildable, never the source of truth)                   | Candidate · Requires Architecture Decision                 | Materialization choice belongs to the balance task (AC-D-31) | Contract §19.3; `docs/modules.md` "still to build"                     |
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
changes none of them — it only records which candidates each one constrains:

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

## 6. Task 11 acceptance and Task 10.9 status

> **Task 11 — Accounting Configuration Foundation: ACCEPTED 2026-09-22.**
>
> **Task 10.9 is not formally defined in the repository at this time.**
>
> **NOT FORMALLY DEFINED** (10.9)

**Task 11 — ACCEPTED** — The foundation per D1–D7 (PR #25 + remediation 2026-09-22 + defect-resolution PR #29, `docs/task-11-defect-resolution-report.md`, CI `35755493453`/`35755917087` success) is the authoritative implemented state. Preserved explicitly:

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
- **D4 `markOperationallyUsed` has no caller — OQ-64: OPEN / DEFERRED** — operational freeze integration belongs to Posting integration. Implementation is blocked on the voucher → configuration cardinality and the marker's position in the module's lock order; the shape is recorded in `accounting/task-11-mark-operationally-used-decision-note.md`.
- **G7: ACCEPTED RISK — raw-SQL partial index `uq_accounting_configurations_org_active` is guarded by live `pg_indexes` verification and migration rehearsal.** The index exists only in the migration (Prisma cannot declare a partial unique index); a future `prisma migrate dev` regenerating the schema would drop it. The live-DB suite (`test/accounting-configuration-live.e2e-spec.ts` item 6) and the rehearsal (`verify.sql` #14–#16) verify it; the drift is accepted and documented in `prisma/schema/accounting.prisma`.
- **`.vardena/project-context.md` staleness**: resolved 2026-09-22 — the file now
  describes the implemented backend instead of the documentation-only era.

## 9. Document history

| Date       | Change                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-17 | Created: index of Tasks 10.1–10.8, current architecture, candidate map, OQ mapping, Task 10.9 status, task definition rule. No code, schema, OQ, or ADR change.                                                                                                                                                                                            |
| 2026-09-22 | Task 11 recorded (PR #25) in §2/§3 and its remediation summarised: D3 level-copy/fallback correction, `levelKind` contract alignment, cross-configuration regression tests, deterministic migration rehearsal (`npm run test:migration-rehearsal`), OQ-62…OQ-64, and the D4 decision note. §8 follow-ups updated; `.vardena/project-context.md` refreshed. |
| 2026-09-22 | **Task 11 — Accounting Configuration Foundation: ACCEPTED** (PR #29 defect-resolution `docs/task-11-defect-resolution-report.md`, CI `35755493453`/`35755917087` success). §2/§3/§6/§8/§9 updated to reflect ACCEPTED; preserved explicitly OQ-62 OPEN, OQ-63 OPEN, OQ-64 OPEN/DEFERRED, G7 ACCEPTED RISK.                                                 |
