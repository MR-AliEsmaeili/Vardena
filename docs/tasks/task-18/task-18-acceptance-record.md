# Task 18 — Review & Acceptance Record

**VERDICT: ACCEPTED**

**Status:** ACCEPTED (2026-09-25)
**Task Title:** Task 18 — Accounting Reporting Read Foundation
**Pull Request:** #46 (`feat(accounting): add reporting read foundation`) — Merged into `main` (`e774a1c37c921ba83e4e9c23729fde6205cedb76`)
**Implementation head (reviewed before merge):** `5971bedf551a023d3a7936767345f0d70fac477a`
**Review-fix commits:** `418234666375e1fb6776dd8b1186b1be5cafe735` (focused Ledger → Trial Balance reconciliation test, D5) and `0d9cf760330ea37b4fded0ddb675731db72c1d25` (review-fix documentation/status handoff)
**Acceptance authority:** Repository Owner / Reviewer (`MR-AliEsmaeili`) — the same authority that reviewed and merged PR #46
**Authorization basis:** the Task 18 acceptance-sync authorization (documentation/governance only) plus the binding Owner Decisions D1–D20 recorded below
**Record type:** documentation/governance only — this record authors no production, schema, migration, API, permission, dependency or test change

---

## 1. Owner Decision & Executive Summary

The Repository Owner/Reviewer reviewed PR #46 **before merge** and accepts the bounded
implementation it introduced as **Task 18 — Accounting Reporting Read Foundation**. PR #46
is **MERGED** into `main` in merge commit
`e774a1c37c921ba83e4e9c23729fde6205cedb76` (merged 2026-09-25T12:25:13Z); the
implementation is now the accepted state of `main`.

This record is the governance synchronization that converts the repository state from
**implementation/merge status** into **formal task acceptance**. Both facts are true and
remain distinct, and neither substitutes for the other:

| Field               | Value                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------- |
| Task                | **Task 18 — Accounting Reporting Read Foundation**                                     |
| Status              | **ACCEPTED**                                                                           |
| PR                  | **#46** (`feat(accounting): add reporting read foundation`) — **MERGED**               |
| Merge commit        | `e774a1c37c921ba83e4e9c23729fde6205cedb76`                                             |
| Implementation head | `5971bedf551a023d3a7936767345f0d70fac477a`                                             |
| Review-fix commits  | `418234666375e1fb6776dd8b1186b1be5cafe735`; `0d9cf760330ea37b4fded0ddb675731db72c1d25` |
| Acceptance date     | 2026-09-25                                                                             |
| Acceptance record   | this file (`docs/tasks/task-18/task-18-acceptance-record.md`)                          |

Task 18 was implemented against the **approved D1–D20 Owner Decision baseline** (§4 below).
The accepted scope is the bounded, read-only Accounting-owned reporting read foundation:

- one shared Accounting-owned read/query layer (`AccountingReadQueryRepository`) over the
  immutable `accounting.ledger_entries` and Accounting-owned chart/calendar/document rows;
- **three explicit read-only APIs** — `GET /api/v1/accounting/account-statements`,
  `GET /api/v1/accounting/general-ledger`, `GET /api/v1/accounting/trial-balance`;
- **three independent read permissions** — `Accounting.AccountStatement.View`,
  `Accounting.GeneralLedger.View`, `Accounting.TrialBalance.View`;
- exact Decimal-string money, one organization / one financial area / one fiscal year per
  request, same-year period/date semantics, readable OPEN/CLOSED/SEALED periods,
  POSTING → AGGREGATION roll-up without parent/child double counting, bounded pagination
  with a hard row limit and query timeout, deterministic allow-listed ordering, and source
  document/line references for traceability.

This acceptance **DOES NOT** imply or authorize any of the following — none of them is
implemented, and none of them is closed by accepting Task 18:

- Report Builder, generic reporting engine/report registry, or a `/api/v1/reports` surface;
- XLSX export, CSV export, PDF generation, print engine or any other export/formatting path;
- Legal Books, Iranian statutory / electronic books (`دفاتر قانونی / الکترونیکی`), statutory
  layouts, financial statements, or any legal/statutory claim;
- Cash Book, Treasury reports, Bank operational reports, Receipts/payments operational
  reports, Settlement/allocation, AR/AP, Sales, Purchase, Treasury;
- cross-year opening carry-forward / brought-forward balances as a class;
- **OQ-25** classification resolution or **OQ-43** legal-book resolution;
- the account code migration service, account-level-count migration, or configurable
  reporting dimensions;
- UI Account Overview (Task 18 is the read foundation, not the UI implementation);
- a new accounting monetary source of truth.

**OQ-25 and OQ-43 remain OPEN** (§9), **Task 17 overall remains BLOCKED** (§9), and no ADR
status is promoted by this acceptance (§9).

---

## 2. Review basis

### 2.1 Reviewed before merge

PR #46 was reviewed against the Task 18 Owner Decisions **D1–D20** before it was merged into
`main`. The reviewed implementation head is `5971bed`; the merged diff was inspected and the
implementation satisfies the approved Task 18 scope. PR #46 was merged by the Repository
Owner/Reviewer in `e774a1c`.

Evidence basis: the merge commit `e774a1c` was authored by the Repository Owner/Reviewer
(`MR-AliEsmaeili`) and the review/approval-before-merge is recorded by the Task 18 acceptance
authorization; GitHub holds no separate review object on PR #46, so none is claimed here.

### 2.2 The review-fix, and the D5 reconciliation point

The final review-fix addressed the **D5 source-of-truth / reconciliation point**: after the
reviewed implementation head `5971bed`, two surgical review-fix commits were added —

- `418234666375e1fb6776dd8b1186b1be5cafe735` — **test-only**: the focused Ledger → Trial
  Balance reconciliation assertion in
  `backend/src/modules/accounting/domain/trial-balance.spec.ts`, which derives `opening`,
  `periodNet` and `closing` from exact authoritative Ledger debit/credit aggregates and
  asserts `opening + periodNet = closing` (the focused D5 reconciliation, **2 passed**);
- `0d9cf760330ea37b4fded0ddb675731db72c1d25` — **documentation-only**: the review-fix
  handoff/status record (the implementation report and the mandatory `STATE.md` /
  task-index status synchronization).

**Neither review-fix commit changed production code, schema, migration, API contract,
permission implementation or dependency.** The review-fix is therefore documentation/test-only
and the previously reviewed production behavior is unchanged. Prior to this acceptance
synchronization the repository recorded only `4182346`; PR #46's complete commit list
(implementation `d986c78`, `9b784f0`, `5971bed`; review-fix `4182346`, `0d9cf76`) is recorded
here for completeness.

### 2.3 Ledger-native, non-statutory read foundation

Task 18 introduces no second monetary truth: the read layer consumes the immutable
`accounting.ledger_entries` rows and the Task 12 balance projection is **not** a runtime
input for financial truth (a repository test asserts the report SQL does not read
`account_balance_projections`); projection reconciliation remains a test obligation, exactly
as accepted for Task 17B. No statement snapshot, cache, report table, materialized report
view, statutory book structure or export artifact was created.

### 2.4 No schema, migration, index or report persistence

The three read surfaces ride the existing Accounting storage and indexes; **zero DDL** was
introduced by PR #46, and no migration, index, view or persisted report artifact was added.

---

## 3. Required acceptance fields

- **Task:** Task 18 — Accounting Reporting Read Foundation.
- **Status:** **ACCEPTED** (§1).
- **PR:** **#46**.
- **Merge commit:** `e774a1c37c921ba83e4e9c23729fde6205cedb76` (the `main` head at the time of this synchronization).
- **Implementation head:** `5971bedf551a023d3a7936767345f0d70fac477a`.
- **Reviewed before merge:** yes — the implementation was reviewed and approved before it was
  merged; the Repository Owner/Reviewer performed the merge (§2.1).
- **D5 review-fix:** yes — the final review-fix addressed the D5
  source-of-truth/reconciliation point (§2.2 and §5).

---

## 4. Owner Decisions D1–D20 — accepted baseline

The implementation was built against the approved Owner Decisions **D1–D20**. Their meaning is
preserved exactly as approved; this acceptance promotes nothing beyond them.

| #       | Owner Decision (approved baseline)                                                                                                        | Acceptance note                                                                                                                                                                                                                                                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1**  | **Shared Reporting Read Foundation** for **Account Statement**, **General Ledger** and **Trial Balance**, with **explicit APIs for each** | Accepted: one shared Accounting-owned read/query layer plus the three explicit APIs (§1).                                                                                                                                                                                                                                        |
| **D2**  | General Ledger has the **richer movement fields** required by the approved contract                                                       | Accepted: General Ledger rows expose the approved movement fields (document date, posting timestamp, document type, document/voucher identity and number, ledger/voucher-line identity, line number, account identity/labels, description, exact debit/credit/net, origin and source snapshots, nullable source-line reference). |
| **D3**  | **Deterministic ordering**: Document Date → Posting Timestamp → Document → Line                                                           | Accepted: General Ledger's default deterministic order is document date, posting timestamp, document, line, completed by immutable row identity; the Account Statement keeps its accepted fixed statement order.                                                                                                                 |
| **D4**  | Trial Balance includes **Opening**, **Debit Turnover**, **Credit Turnover**, **Period Net**, **Closing**                                  | Accepted: Trial Balance returns exactly those five exact Decimal-string measures.                                                                                                                                                                                                                                                |
| **D5**  | **Opening/balance source-of-truth decision**                                                                                              | Accepted — see the explicit note in §5.                                                                                                                                                                                                                                                                                          |
| **D6**  | Posting and aggregation are supported according to the **approved account semantics**                                                     | Accepted: POSTING XOR AGGREGATION is preserved; POSTING activity rolls to AGGREGATION ancestors with no parent/child double counting.                                                                                                                                                                                            |
| **D7**  | **Classification-agnostic reporting remains valid. OQ-25 is NOT resolved by Task 18**                                                     | Accepted: no classification/nature/type presentation exists in the accepted surfaces; OQ-25 remains OPEN.                                                                                                                                                                                                                        |
| **D8**  | **Account hierarchy plus code/name support** is retained                                                                                  | Accepted: hierarchy narrowing/roll-up plus account code/name fields are retained.                                                                                                                                                                                                                                                |
| **D9**  | **Document Date is the primary financial reporting axis**; Posting Timestamp remains available for audit/technical ordering               | Accepted: document date drives the reporting windows; posting timestamp is exposed for audit/technical ordering.                                                                                                                                                                                                                 |
| **D10** | **One Financial Area per request**                                                                                                        | Accepted: every report requires exactly one organization, one financial area and one fiscal year.                                                                                                                                                                                                                                |
| **D11** | **OPEN, CLOSED and SEALED periods remain readable**                                                                                       | Accepted: status is echoed, never a read filter, and no report mutates period/year state.                                                                                                                                                                                                                                        |
| **D12** | **Separate permissions**: `Accounting.AccountStatement.View`, `Accounting.GeneralLedger.View`, `Accounting.TrialBalance.View`             | Accepted: three independent read codes, enforced at the route and at the service entry (ADR-0016).                                                                                                                                                                                                                               |
| **D13** | **Pagination, hard row limit and query timeout** are part of the bounded read foundation                                                  | Accepted: bounded pages (existing 500 maximum), 50,000-row hard window and a five-second interactive read timeout.                                                                                                                                                                                                               |
| **D14** | **SQL aggregation and hierarchy rollup** are used within the approved scope                                                               | Accepted: aggregation and the hierarchy roll-up are done in reviewed SQL/CTE branches with bound values.                                                                                                                                                                                                                         |
| **D15** | APIs expose **source document/line references** for traceability                                                                          | Accepted: General Ledger and Trial Balance expose document/line and ledger-line identities and the existing nullable source-line reference; no unavailable field was fabricated.                                                                                                                                                 |
| **D16** | **Account Overview UI remains future scope** — Task 18 is the read foundation, not the UI implementation                                  | Accepted: no UI was implemented; the Account Overview remains future scope.                                                                                                                                                                                                                                                      |
| **D17** | **XLSX/CSV export remains future scope**                                                                                                  | Accepted: no export path exists on the accepted surfaces.                                                                                                                                                                                                                                                                        |
| **D18** | **Legal Books remain future scope**                                                                                                       | Accepted: no legal/statutory book structure or claim is introduced.                                                                                                                                                                                                                                                              |
| **D19** | Explicit APIs remain `/accounting/account-statements`, `/accounting/general-ledger`, `/accounting/trial-balance`                          | Accepted: exactly these three read APIs; no generic report surface was added.                                                                                                                                                                                                                                                    |
| **D20** | A **shared Accounting Read/Query Layer** is the underlying read foundation                                                                | Accepted: one shared `AccountingReadQueryRepository` underlies all three surfaces.                                                                                                                                                                                                                                               |

---

## 5. D5 — opening/balance source of truth (explicit acceptance note)

D5 is accepted **Ledger-native**, exactly as recorded by the implementation and the review-fix:

- **`accounting.ledger_entries` is the authoritative financial source.**
- The **Task 12 projection is a materialized, turnover-only, derived and rebuildable read
  optimization** — not an authority.
- **Task 18 remains Ledger-native.**
- **Task 18 does NOT introduce a second monetary source of truth.**
- **Task 18 does NOT depend on the Task 12 projection at runtime for financial truth.**
- A **focused Trial Balance reconciliation assertion** was added to verify **opening, turnover,
  period net and closing** against the authoritative Ledger source (review-fix commit
  `4182346`; **2 passed**).

This decision is **not** re-interpreted as "the projection is authoritative". The authoritative
source is **`accounting.ledger_entries`**, and the projection remains derived/rebuildable, in
line with ADR-0031.

---

## 6. Validation evidence (recorded)

The following evidence was completed for the reviewed/merged Task 18 state. It is **recorded**;
this acceptance synchronization re-runs no test suite and invents no new result.

| Evidence                                                                               | Recorded result                                                              |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Focused D5 reconciliation (Ledger → Trial Balance opening/turnover/period net/closing) | **2 passed**                                                                 |
| Accounting unit suite                                                                  | **43 files / 538 tests passed**                                              |
| Full backend unit suite                                                                | **97 files / 1,100 tests passed**                                            |
| Static/build validation                                                                | **typecheck passed; build passed; format passed; `git diff --check` passed** |
| Lint                                                                                   | **0 errors; 6 pre-existing unrelated warnings**                              |

The **six lint warnings are pre-existing in unrelated files and are NOT Task 18 failures**; they
are neither fixed nor re-attributed by this acceptance.

### CI evidence

| Field                   | Value                                                                |
| ----------------------- | -------------------------------------------------------------------- |
| Run                     | GitHub Actions **`36133360887`** (`CI` → `backend`)                  |
| PR                      | **#46**                                                              |
| Head SHA executed by CI | **`5971bedf551a023d3a7936767345f0d70fac477a`** (implementation head) |
| Job result              | `backend` **completed success**                                      |

The relevant backend CI gates passed, including: **Prisma validation**, **lint**, **typecheck**,
**format**, **unit tests**, **build**, **migration rehearsal** and **live PostgreSQL E2E**.

**CI ran on the implementation head `5971bed` and therefore predates the surgical review-fix
commits `4182346` / `0d9cf76`.** This is acceptable because those review-fix changes were
**documentation/test-only and introduced no production code changes**: the focused
reconciliation test and the local full validation covered the **post-fix state**. This record
does **not** claim that CI executed the later review-fix commit.

---

## 7. Scope boundaries that must remain explicit

Task 18 acceptance **must not** be read as implementing, authorizing or closing:

Report Builder · generic reporting engine · XLSX export · CSV export · PDF generation · print
engine · Legal Books · Iranian tax/electronic books · Cash Book · Treasury reports · Bank
operational reports · Receipts/payments operational reports · Settlement/allocation · AR/AP ·
Sales · Purchase · Treasury · cross-year opening carry · **OQ-25** classification resolution ·
**OQ-43** legal-book resolution · account code migration service · account-level-count
migration · configurable reporting dimensions · UI Account Overview · a new accounting monetary
source of truth.

None of these is closed merely because Task 18 is accepted.

---

## 8. OQ and cross-task state (unchanged by this acceptance)

| Item                                                                | State after this acceptance                                                                                                                                                                                                                     |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OQ-25** (chart of accounts / report-layout classification policy) | **OPEN** — not resolved by Task 18 (D7); not annotated, closed or reclassified here                                                                                                                                                             |
| **OQ-43** (Iranian statutory / legal reporting requirements)        | **OPEN** — not resolved by Task 18; no legal/statutory claim made                                                                                                                                                                               |
| **Task 17 overall**                                                 | **BLOCKED** (FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS) — **NOT complete**; unchanged                                                                                                                                               |
| **Task 17A**                                                        | **ACCEPTED (2026-09-25)** — unchanged                                                                                                                                                                                                           |
| **Task 17B**                                                        | **ACCEPTED (2026-09-25)** for its bounded D1–D7 slice — unchanged                                                                                                                                                                               |
| **Task 17C**                                                        | **READY FOR REVIEW — NOT ACCEPTED** — unchanged                                                                                                                                                                                                 |
| Task 12 P1 follow-up, Task 13, Task 14, Task 16                     | Statuses unchanged                                                                                                                                                                                                                              |
| ADR statuses                                                        | **No ADR promoted** by this acceptance: ADR-0009 / ADR-0026 / ADR-0031 / ADR-0032 and ADR-0033…0037 (Proposed) are unchanged. **No new ADR was created** — Task 18 acceptance is a governance synchronization, not a new architectural decision |

---

## 9. Recorded documentation observations (not fixed by this acceptance)

These observations were found during the acceptance synchronization and are **recorded, not
silently resolved** (AG-17). None of them changes the accepted implementation, and none is a
Task 18 production defect:

1. **Binding contract §22 vocabulary row for the Task 18 permissions** —
   `docs/accounting/domain-contract.md` §22 records `Accounting.LedgerMovement` (Task 17A) and
   `Accounting.AccountStatement` (Task 17B) but has **no row** for
   `Accounting.GeneralLedger.View` / `Accounting.TrialBalance.View`, which the accepted
   implementation registers (D12). The binding technical contract is **not edited by this
   acceptance-synchronization**; adding the rows is a separately authorized contract
   documentation change.
2. **`docs/modules.md` Accounting prose** — the module's long-form Accounting section
   documents the Task 17A/17B API surfaces but not yet the Task 18 General Ledger / Trial
   Balance surfaces; only the module status line is synchronized here. Completing that prose
   is separate documentation work.
3. **Task 18 Owner Decision text** — the approved D1–D20 text was not stored as a repository
   task prompt (`docs/tasks/task-18/` previously held only the implementation report), unlike
   Task 17A/17B, whose prompts are stored. D1–D20 are therefore transcribed in §4 of this
   record so the approved baseline is no longer unrecorded; their meaning is preserved, not
   rewritten.

---

## 10. Related records

- Implementation report and recorded evidence:
  [`task-18-implementation-report.md`](./task-18-implementation-report.md)
- Governance index: `docs/accounting/task-index.md` header/§2/§3/§5/§9; `STATE.md` §7/§8/§9/§10
- Contract: `docs/accounting/domain-contract.md` (binding technical contract, §19 AC-D-30,
  §22 permission vocabulary)
- Predecessor acceptance records: `docs/tasks/task-17/task-17a-acceptance-record.md`,
  `docs/tasks/task-17/task-17b-acceptance-record.md`
- PR #46; merge commit `e774a1c37c921ba83e4e9c23729fde6205cedb76`; CI run `36133360887`

---

**Task 18 — Accounting Reporting Read Foundation: ACCEPTED (2026-09-25).**
