# Task 17B — Owner Decision Pack (first Accounting reporting slice)

- **Task:** Task 17B — Owner Decision Pack and Implementation Gate Preparation
- **Type:** OWNER DECISION PREPARATION ONLY (documentation)
- **Status:** READY FOR REVIEW. **Every decision below is pending the Owner.**
  This document decides nothing, accepts nothing and authorizes nothing.
- **Date:** 2026-09-25 (the repository's UTC+03:30 date convention; 2026-09-24 UTC)
- **Branch / baseline:** `arena/01a0d55b-vardena`, base
  `0f2951eca69fcedc3ae85c894ff3bf3103360195` (merge of PR #41)
- **Inputs:** [`task-17b-investigation.md`](./task-17b-investigation.md),
  [`task-17b-brief.md`](./task-17b-brief.md), [`brief.md`](./brief.md),
  [`prompt.md`](./prompt.md), [`task-17a-acceptance-record.md`](./task-17a-acceptance-record.md)
- **Companion:** [`task-17b-implementation-gate.md`](./task-17b-implementation-gate.md)

> **Boundary.** This pack presents repository evidence, options, consequences and
> *technically safe proposals*. It makes no business, accounting, tax or legal
> decision on the Owner's behalf. It does not resolve, reclassify or close any Open
> Question (**OQ-25 and OQ-43 remain OPEN**). It changes no task, ADR or OQ status.
> It authorizes no production code, schema, migration, index, endpoint, permission,
> projection, view, report builder, export, print or frontend work.

## Status at a glance

| Item | Status | Class |
| --- | --- | --- |
| Task 17A | **ACCEPTED (2026-09-25)**. Unchanged. | CONFIRMED BY REPOSITORY |
| PR #41 (Task 17B investigation) | Merged into `main` as `0f2951e`. | CONFIRMED BY REPOSITORY |
| Task 17B investigation, as recorded in the repository | The authoritative index still says `READY FOR REVIEW — NOT ACCEPTED` (E-02). | CONFIRMED BY REPOSITORY |
| Recording the documentation-milestone acceptance in `docs/accounting/task-index.md` / `STATE.md` | Not done by this pack (see G-3 and DR-1). | REQUIRES OWNER DECISION |
| Task 17 | **FORMALIZED / IMPLEMENTATION BLOCKED**. Unchanged. | CONFIRMED BY REPOSITORY |
| OQ-25 / OQ-43 | **OPEN**. Unchanged. | CONFIRMED BY REPOSITORY |
| Implementation authorization for any reporting slice | None exists. | CONFIRMED BY REPOSITORY |

**Owner instruction for this task.** Task 17B is accepted **as a
documentation/investigation milestone only**, once PR #41 is merged. That merge condition
is met (E-01). Accepting the milestone authorizes no implementation. Task 17 stays
FORMALIZED / IMPLEMENTATION BLOCKED, and OQ-25 and OQ-43 stay OPEN.

---

## 0. How to read this pack

Every conclusion carries exactly one class:

| Class | Meaning |
| --- | --- |
| CONFIRMED BY REPOSITORY | A fact established from the current `main` tree (file, symbol, migration, decision record), cited by an `E-nn` evidence id (§3). |
| PROPOSED DESIGN | This pack's own analysis or technical proposal, including derived technical/accounting consequences. It binds nothing until the Owner adopts it. |
| UNKNOWN | Cannot be determined from repository evidence; no assumption is manufactured. |
| REQUIRES OWNER DECISION | Only the Repository Owner (with accountant / tax-legal input where named) can decide. |
| BLOCKED BY OQ | Governed by an open entry in [`docs/open-questions.md`](../../open-questions.md); nothing here resolves it. |
| OUT OF SCOPE | Explicitly outside the first slice and outside this pack. |

In tables, the **"Repository fact"** column is always CONFIRMED BY REPOSITORY and the
**"Proposed"** column is always PROPOSED DESIGN, unless a cell names another class.
Option columns describe alternatives; they are not conclusions.

**Numbering.** D1–D7 here are *this pack's* decisions. They differ from the D1–D7
list in `task-17b-brief.md` §6. The crosswalk is in §4.

---

## 1. Executive summary

**What the Owner is asked to do.** Take seven decisions (D1–D7, §5) and four gate
actions (G-1…G-4, §12). Together they decide whether, and how narrowly, the first
Accounting reporting implementation slice may start. Until they are recorded on
`main`, the gate in [`task-17b-implementation-gate.md`](./task-17b-implementation-gate.md)
stays **CLOSED**. *(REQUIRES OWNER DECISION)*

**Recommended technically safe path.** *(PROPOSED DESIGN — not a decision)*

The proposal is an **"intra-fiscal-year account statement"** with these properties:

- **Scope:** one postable account, one fiscal year, and optionally one accounting period.
- **Source:** read only from `accounting.ledger_entries`.
- **Balances:** an opening balance computed with the existing ADR-0031 intra-year
  semantics, plus a running balance and a closing balance.
- **Signs and order:** debit-positive signed exact decimals, in the fixed Task 17A
  legal-book order.
- **Paging:** offset paging with `pageSize ≤ 500`.
- **Permission:** reuse `Accounting.LedgerMovement.View`.
- **Financial area:** one area per request, with structural scoping only.
- **Period status:** every period status is readable, and the statuses are disclosed.
- **No changes:** no schema, migration, index, projection or permission change.

Why this slice:

- It is the smallest increment beyond Task 17A that adds user value, namely balances.
- It needs only repository-determinable, nature-agnostic semantics.
- It needs no account classification (OQ-25), no statutory layout (OQ-43), no
  cross-year opening (OQ-23), no area grants (OQ-40) and no Reporting module (OQ-49).

**Lower-risk fallback.** D1 Option A: movement rows plus turnover totals, with no
opening balance and no running balance. *(PROPOSED DESIGN)*

**What stays blocked whatever the Owner decides here** *(BLOCKED BY OQ)*:

- cross-year carry-forward (OQ-23);
- income statement, balance sheet and classified summaries (OQ-25);
- statutory books and the 4/6/8-column layouts (OQ-43 / OQ-25);
- per-user area authorization (OQ-40);
- currency (OQ-03), dimensions (OQ-41) and the Report Builder (OQ-49).

| # | Decision | Proposed (non-binding) | Final |
| --- | --- | --- | --- |
| D1 | Account Movement scope | Option B: intra-year statement for one postable account. Rows as posted, fixed order, offset ≤ 500. | REQUIRES OWNER DECISION |
| D2 | Opening balance and fiscal-year boundary | One fiscal year per request. Opening is intra-year and period-sequence based (ADR-0031). Multi-year requests are rejected. No carry-forward. | REQUIRES OWNER DECISION |
| D3 | Classification and OQ-25 | Nature-agnostic measures only, debit-positive. Nature-aware presentation deferred. | REQUIRES OWNER DECISION |
| D4 | Financial-area access | Structural scope, exactly one area per request, disclosed as *not* an authorization boundary. | REQUIRES OWNER DECISION |
| D5 | Closed and sealed period reporting | Read all statuses. Echo each period status. No finality or statutory claims. | REQUIRES OWNER DECISION |
| D6 | Permission model | First slice reuses `Accounting.LedgerMovement.View`. Long-term: hybrid model. | REQUIRES OWNER DECISION |
| D7 | First slice and performance boundary | Spec in §5.7. Index deferred until measured. | REQUIRES OWNER DECISION |

Suggested decision order *(PROPOSED DESIGN)*: take D3 and D2 first (semantics), then D1
(scope), then D4 and D5 (policy), then D6 (permission), then D7 (slice approval), and
finally G-1…G-4 (gate records).

---

## 2. Baseline verified

- HEAD of `main` and of this branch is `0f2951e`, the merge of PR #41 (`docs(accounting):
  investigate movement balance and reporting contracts`). *(CONFIRMED BY REPOSITORY — E-01)*
- The recorded statuses of Task 12, 13, 14, 17, 17A and 17B and of ADR-0031/ADR-0032 are
  exactly as listed in E-02 and E-03. This pack alters none of them, and it alters no
  other task's status either.
  *(CONFIRMED BY REPOSITORY)*
- No `reporting` backend module exists. *(CONFIRMED BY REPOSITORY — E-25)*

## 3. Repository evidence register

All rows are **CONFIRMED BY REPOSITORY** at baseline `0f2951e`.

| Id | Topic | Evidence |
| --- | --- | --- |
| E-01 | Baseline | `git log -1` = `0f2951e`. `gh pr view 41` reports MERGED (2026-09-24T21:38:12Z). PR #41 added `docs/tasks/task-17/task-17b-investigation.md` and `docs/tasks/task-17/task-17b-brief.md`, and updated `docs/accounting/task-index.md`. |
| E-02 | Task statuses | Sources: `docs/accounting/task-index.md` (header, §2, §4, §9) and `STATE.md` §7/§8. Task 17: FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS. Task 17A: ACCEPTED 2026-09-25. Task 17B: READY FOR REVIEW — NOT ACCEPTED. Task 12: legacy label "ACCEPTED WITH FOLLOW-UP", with P1 real-PostgreSQL concurrency open (`STATE.md` BOOT-OQ-02). Task 13: IN PROGRESS. Task 14: READY FOR REVIEW — NOT ACCEPTED. |
| E-03 | ADR status | ADR-0031 (`docs/adr/0031-balance-projection.md`) and ADR-0032 (`docs/adr/0032-accounting-period-close-enforcement.md`) are **Proposed**. ADR-0006, ADR-0009, ADR-0016, ADR-0025 and ADR-0026 are Accepted. |
| E-04 | OQ status | The Open table of `docs/open-questions.md` lists OQ-02, OQ-03, OQ-20, OQ-21, OQ-23, OQ-25, OQ-27, OQ-40, OQ-41, OQ-43, OQ-47, OQ-48, OQ-49 and OQ-56, among others. The only Resolved entry is OQ-64. |
| E-05 | Ledger shape | Model `LedgerEntry` in `backend/prisma/schema/accounting.prisma` stores: org, area, fiscal year and period; voucher id; `voucher_number` (`VARCHAR(32)`); unique `voucher_line_id`; `line_no`; `account_id`; `debit_amount` / `credit_amount` as `numeric(18,2)`; `document_date` (`DATE`); `posting_timestamp` (`timestamptz`); `branch_id`; `origin`; and source references. It has **no status column**. |
| E-06 | Ledger indexes | Same model: `idx_ledger_entries_org_voucher`, `idx_ledger_entries_org_account`, `idx_ledger_entries_org_period` and `uq_ledger_entries_voucher_line_id`. There is **no date-leading and no account+date index**. |
| E-07 | Insert-only ledger | `backend/src/modules/accounting/data/ledger-entries.repository.ts`: rows are written only inside finalization. There is no update or delete path. `listMovements` is read-only. |
| E-08 | Task 17A movement read | `backend/src/modules/accounting/application/ledger-movements.service.ts`: the permission is checked first, then the deployment pin and `requireUsableOrganization`. Optional filters: area, year, period, account, voucher, serial and an inclusive date window. Sort is allow-listed to `documentDate` / `postingTimestamp`. Default order is `documentDate, voucherNumber, lineNo, id`. **Foreign filter ids return an empty page, not a 404.** |
| E-09 | Paging and validation | `backend/src/kernel/pagination/page-query.dto.ts`: default page size 100, max 500. `backend/src/kernel/pagination/paginated-result.ts`: offset paging, envelope `{ items, total, page, pageSize }`. `backend/src/kernel/http/validation.ts`: `whitelist` + `forbidNonWhitelisted`, so unknown parameters return 400. |
| E-10 | Projection and derived view | `backend/prisma/migrations/20260922000000_accounting_balance_projection/migration.sql` stores turnover only. In `vw_account_balance_derived`, opening = Σ(debit − credit) of prior periods, `PARTITION BY` org, area, fiscal year, account, `ORDER BY accounting_periods.sequence`. The first period's opening is 0. The view is sparse and **never crosses a fiscal year** (ADR-0031 §2/§4/§9). |
| E-11 | Balance reads | `backend/src/modules/accounting/application/accounting-balances.service.ts`: permission `Accounting.Balance.View`. Scope keys are validated: a foreign key returns **404**; an area/year or year/period mismatch returns **422**. Closed-period balances remain readable, because status is not re-validated on read. |
| E-12 | Year transition | `docs/accounting/domain-contract.md` §6.4: carry-forward is done by ordinary closing/opening documents. There is no opening-balance table. The content is EXPERT-GATED (OQ-23). The operation is not implemented (`docs/accounting/task-index.md` §4), and `Accounting.YearTransition` is not registered. |
| E-13 | No opening-document marker | `AccountingDocument` has a fixed `document_type` (default `accounting_voucher`). Its `correction_kind` has one value only, `reversal` (`backend/src/modules/accounting/domain/document-reversal.ts`). **No field identifies an opening or closing voucher.** |
| E-14 | Period sequence | `backend/src/modules/accounting/application/accounting-periods.service.ts` and `backend/src/modules/accounting/data/accounting-periods.repository.ts`: `sequence` is **caller-supplied** and unique per year. Only overlap and inside-year are checked. `backend/src/modules/accounting/domain/accounting-period.ts`: gaps are permitted. **Nothing checks that sequence order equals date order.** No period-edit permission exists. |
| E-15 | Account model | Model `Account` and the schema header (lines 44–50) of `backend/prisma/schema/accounting.prisma` define: an org-scoped chart; `parent_id` and `level`; `account_nature` = `debit` \| `credit` (reporting semantics only); `is_postable` (postable implies leaf); `is_active`. **`account_type`, `is_temporary` and `control_role` are not stored** (OQ-25). |
| E-16 | Contract account rules | `docs/accounting/domain-contract.md`: §8.3 (type and temporary status are EXPERT-GATED); §8.5 (a parent's movement is the rollup of its descendants, and the tree is never re-derived from codes); §8.6 (freeze, never delete; history stays readable); §13.4 (nature is not side; warning or blocking on contrary-nature balances is EXPERT-GATED under OQ-25). |
| E-17 | Financial area | `backend/src/modules/accounting/application/financial-areas.service.ts` creates areas **without a per-organization cap**. Contract §5.5 describes grants as the target model. The OQ-40 interim posture is structural (caller-supplied) access. `Accounting.FinancialAreaAccess.*` is listed in contract §22 but **not registered**, and there is no grant table. |
| E-18 | Organization isolation | `backend/src/modules/organization/application/organizations.service.ts`: `assertOrganizationInScope` returns 404 under the deployment pin. `requireUsableOrganization` returns 404 for an unknown organization and **422** for a disabled one (`assertUsable` in `backend/src/modules/organization/application/master-data-support.ts`). Also ADR-0025 and contract §4 (AC-D-01; AC-I-01/16). |
| E-19 | Period enforcement | ADR-0032 and `docs/task-14-implementation-report.md`: closed and sealed periods are refused **inside the finalization transaction**. The predicate pre-existed; Task 14 moved it to run first. The audited reopen/unseal exceptions are preserved. Read paths have **no status predicate** (E-08, E-11). |
| E-20 | Period rules for reports | Contract §7.2 rule 3: reports must state which periods they include. §6.3: a sealed year is the frozen statutory basis, and unseal remains possible with a distinct permission. |
| E-21 | Reversal | `backend/prisma/migrations/20260923000000_accounting_document_reversal/migration.sql`. `reverseDocument` in `backend/src/modules/accounting/application/accounting-documents.service.ts` creates a new final counter-document. Its date must resolve to an **open** period, and the original rows are never suppressed. The linkage lives on the voucher header only. |
| E-22 | Permission registry | `backend/src/modules/accounting/domain/accounting-permissions.ts` registers 35 codes, including `Accounting.LedgerMovement.View`, `Accounting.Balance.View` and `Accounting.Balance.Rebuild`. Contract §22 reserves `Report.<id>.View` for the Reporting module. `docs/reporting-strategy.md` §1 item 4 and §6: export requires the report permission plus `Excel.Export`. |
| E-23 | Enforcement model | ADR-0016: guard plus service check, all listed codes required, fail closed, no cache, immediate revocation. `backend/src/modules/rbac/application/authorization.service.ts`: with no request context (system context), the service check is skipped. |
| E-24 | Permission sync | `backend/src/modules/rbac/data/permissions.repository.ts` upserts only and **never deletes** a code's row (OQ-20). |
| E-25 | No Reporting runtime | `backend/src/modules/` has no reporting module. `backend/src/kernel/prisma/prisma.service.ts` uses one pool (max 10), with **no statement timeout and no read-only role**. The ADR-0009 caps, timeout and read-only connection are not implemented. |
| E-26 | Rate limit | `backend/src/kernel/rate-limit/rate-limit.middleware.ts`: a global in-memory per-IP limiter. Stricter per-endpoint budgets can reuse it. |
| E-27 | Money | `backend/src/modules/accounting/domain/money.ts`: exact BigInt arithmetic (`sumAmounts`). `canonicalizeAmount` accepts signed values (`1250.50` → `1250.5`, `-0` → `0`). Storage is `numeric(18,2)`. |
| E-28 | Serial ordering | `backend/src/modules/documents/domain/numbering.ts`: serials are numeric-only, and the zero-padding width is configurable (0 = none). String order of `voucher_number` equals numeric order **only for fixed-width serials**. |
| E-29 | Measured plans | `docs/tasks/task-17/task-17a-implementation-report.md` §12 items 4–5 and §14: a PGlite/WASM rehearsal on 150k synthetic rows. The account filter is index-served. Date-window and unfiltered pages are scan plus sort. A deep offset spills to disk. Candidate indexes were recorded, not created. There is no approved dataset or latency target. |
| E-30 | Data-access precedents | Prisma `aggregate` / `_sum` is used in `backend/src/modules/inventory/data/inventory-movements.repository.ts`. Parameterized `$queryRaw` is used in `backend/src/modules/accounting/data/accounting-locks.ts`. **No transaction isolation level is set anywhere** in `backend/src`. |
| E-31 | Samples | `docs/tasks/task-17/reporting-sample-audit.md`: the statutory sample workbooks were never supplied or inspected. |
| E-32 | Security baseline | `docs/security.md` §4: exports of sensitive reports are audited. §5: per-user limits on heavy endpoints; `pageSize ≤ 500`. |

## 4. Crosswalk — `task-17b-brief.md` §6 items → this pack

| Brief §6 item | Topic | Handled in this pack |
| --- | --- | --- |
| Brief D1 | Nature-agnostic balance semantics only | D3 (and the D1 sign convention) |
| Brief D2 | Sparse vs dense output | Not needed for the movement slice (D7). Remains open for balance and trial-balance surfaces (U-7). |
| Brief D3 | Offset vs keyset paging; caps and timeouts | D1 (paging) and D7 (limits) |
| Brief D4 | Permission model | D6 |
| Brief D5 | Net-of-reversal and closed/sealed switches | D1 (reversals) and D5 (periods) |
| Brief D6 | `ReportResponse<T>` envelope and four-layer boundary | Deferred to the future Reporting task (D7 non-goal; U-8) |
| Brief D7 | OQ-25 / OQ-43 interim postures | Gate prerequisites P-01 and P-02; checklist G-1 and G-2 |

---

## 5. Decisions

### 5.1 D1 — Account Movement scope

**Decision needed.** The minimum content and scope of the first Account Movement surface.
Evidence: E-05 to E-09, E-14 to E-16, E-21, E-27 to E-29.

**Options (packages).**

- **Option A — Movement plus turnover totals.** Task 17A-shaped rows for one postable
  account in one fiscal year (optionally one period), plus Σdebit and Σcredit over that
  window. No opening balance, no running balance.
- **Option B — Intra-fiscal-year account statement.** Everything in Option A, plus an
  intra-year opening balance, a per-row running balance and a closing balance.

| Dimension | Repository fact | Option A | Option B | Proposed first slice |
| --- | --- | --- | --- | --- |
| One account vs hierarchy | Ledger rows exist only on postable (leaf) accounts. A parent's movement is the rollup of its descendants. There is no `path` projection (E-15, E-16). | One postable account | One postable account | One postable account. Reject a non-postable account: it has no rows, so an empty statement would look like "no activity". |
| Organization scope | `organizationId` is mandatory, with pin and usability checks (E-18). | Same | Same | Mandatory `organizationId` (Task 17A precedent). |
| Financial-area scope | Each row carries its area. A fiscal year belongs to exactly one area (E-05). | One area | One area | Area derived from the required fiscal year. An optional `financialAreaId` must match it. No aggregation across areas (D4). |
| Fiscal year / period filters | Stored year and period are authoritative. Reports never recompute them from dates (contract §19.2 rule 3). | Required year; optional single period | Same | Same |
| Document date vs posting timestamp | Three axes exist: stored period/year, `document_date`, `posting_timestamp` (E-05, E-08). | Window by stored year/period | Window by stored year/period. A date window would need a second opening basis (D2). | Window by stored year/period only. Both dates are returned; neither is a filter. |
| Opening balance | Only ADR-0031 intra-year semantics exist (E-10). | Not returned | Intra-year, sequence-based (D2) | Option B |
| Debit / credit turnover | Exact sums are available (E-27). | Σdebit and Σcredit over the window | Same, plus net | Exact decimal strings |
| Running balance | No surface provides one today. | None | Opening + Σ(debit − credit) in the fixed order, debit-positive | Option B. No flipping of signs by nature (D3). |
| Reversal / correction visibility | Originals are never suppressed. A reversal may be dated in another period or year. Only `reversal` is implemented (E-13, E-21). | Rows as posted | Rows as posted | As posted. No linkage fields, no netting. |
| Pagination and max page size | Offset paging, `pageSize ≤ 500`, default 100 (E-09). | Same | Same. Each page's running balance is computed over the whole ordered window. | Offset, default 100, maximum 500 |
| Deterministic ordering | Task 17A's order is total because it ends with the unique `id`. Serial order is string order (E-08, E-28). | Fixed Task 17A default; no client `sort` | Same, and fixed order is mandatory because the running balance depends on it | Fixed order; the serial limitation is disclosed |

**Technical consequences.**

- **Option A.** Reuses the Task 17A query shape and adds one exact aggregate. No new
  semantics. Low risk, but little added value, because Task 17A already lists the same
  rows. *(PROPOSED DESIGN)*
- **Option B: fixed order.** Client re-sorting and any row-subsetting filter must be
  forbidden, because voucher, serial or date filters would change what "running
  balance" means. *(PROPOSED DESIGN)*
- **Option B: consistent snapshot.** The page rows, the sum of rows before the page, the
  opening and the total must all come from **one consistent snapshot**. The repository
  has no isolation-level precedent (E-30). *(PROPOSED DESIGN)*
- **Option B: no schema change needed.** It can be built with parameterized Prisma reads
  plus exact domain arithmetic (E-27, E-30). *(PROPOSED DESIGN)*
- **Hierarchy (not proposed).** It would need a recursive account walk and a
  multi-account ordered scan. No index serves that order (E-06). *(PROPOSED DESIGN)*

**Accounting consequences.**

- **Option A** carries no balance semantics, so nothing can be misread as an opening.
  Users must obtain balances from `/balances` (E-11). *(PROPOSED DESIGN)*
- **Option B: permanent accounts.** A permanent account's statement that starts at the
  fiscal year's start shows an opening of **0**. The only exception is when an opening
  voucher was posted in that year, and it then appears as ordinary rows (E-12, E-13).
  This must be disclosed (D2). *(PROPOSED DESIGN)*
- **Option B: credit-nature accounts.** Their normal balances appear **negative** under
  the debit-positive convention. This is a presentation risk handled in D3.
  *(PROPOSED DESIGN)*
- **Both options: reversals.** A reversal pair split across windows shows one side only.
  That is correct "as posted", but it can surprise readers. *(PROPOSED DESIGN)*
- **Both options: intra-day order.** Rows within one day follow string serial order,
  which equals numeric order only for zero-padded serials (E-28).
  *(CONFIRMED BY REPOSITORY)*
- **Both options: legally required order.** Whether statutory books must follow the
  numeric voucher order is not settled. *(BLOCKED BY OQ — OQ-43)*

**Proposed safe first slice.** Option B, with every element in the "Proposed first slice"
column. Option A is the fallback if the Owner does not approve intra-year opening
semantics now. *(PROPOSED DESIGN)*

**Final decision.** Choose A or B, or amend, and confirm or reject each element of the
table. The first slice's intra-day ordering (keep the Task 17A string order vs a numeric
serial order) is part of this decision. *(REQUIRES OWNER DECISION)*

### 5.2 D2 — Opening balance and fiscal-year boundary

Evidence: E-02, E-03, E-10, E-12 to E-14.

**Confirmed facts.**

| # | Fact | Class |
| --- | --- | --- |
| F-1 | The intra-year opening of a period is Σ(debit − credit) over the **prior periods of the same (org, area, fiscal year, account)**, ordered by `accounting_periods.sequence` (E-10). | CONFIRMED BY REPOSITORY |
| F-2 | The first period of every fiscal year has opening **0**, because the window never crosses a year (E-10; ADR-0031 §9). | CONFIRMED BY REPOSITORY |
| F-3 | Cross-year carry-forward is **not computed**. It is deferred to a dedicated Fiscal Year Transition / Opening Balance task with its own ADR (ADR-0031 §9). | CONFIRMED BY REPOSITORY |
| F-4 | The contract's carry-forward mechanism is ordinary closing and opening **documents**, with no opening-balance table. Go-live balances also arrive as opening documents (E-12). | CONFIRMED BY REPOSITORY |
| F-5 | The year-transition operation and its permission do not exist (E-12). | CONFIRMED BY REPOSITORY |
| F-6 | No stored field distinguishes an opening or closing voucher from an ordinary one (E-13). | CONFIRMED BY REPOSITORY |
| F-7 | Period `sequence` is caller-supplied. Its alignment with the period dates is not enforced, and gaps are permitted (E-14). | CONFIRMED BY REPOSITORY |
| F-8 | A posted row's stored year and period never change. Final rows are immutable, periods have no edit path, and year dates become immutable once referenced (contract §6.5). | CONFIRMED BY REPOSITORY |
| F-9 | ADR-0031 is **Proposed**, and Task 12's P1 follow-up is open (E-02, E-03). | CONFIRMED BY REPOSITORY |

**Determinations requested by the task.**

| Topic | Determination | Class |
| --- | --- | --- |
| Intra-year opening semantics | As F-1. The first slice can reproduce it from the ledger alone (the sum of entries in lower-sequence periods of the same year) and reconcile it to `vw_account_balance_derived`. | PROPOSED DESIGN |
| First-period behavior | Opening is 0. An opening voucher posted in period 1 appears as period-1 **turnover rows**, not as "opening" (F-2, F-6). | CONFIRMED BY REPOSITORY |
| Showing an opening voucher *as* the opening balance | Needs a document marker and a policy. Neither exists. | BLOCKED BY OQ (OQ-23) |
| Cross-year carry-forward | Must not be synthesized. Doing so would **double count** once opening documents exist (F-4). | BLOCKED BY OQ (OQ-23) |
| A report spanning several fiscal years | There are no repository semantics for it. Alternatives: reject the request (proposed); show per-year sections without carry; compute a carry (blocked). | REQUIRES OWNER DECISION |
| Is cross-year opening blocked by OQ-23? | **Yes.** OQ-23 owns "how year-end/opening entries are produced and approved", and ADR-0031 §9 requires a dedicated task and ADR. | BLOCKED BY OQ |
| Must the first slice be limited to one fiscal year? | Proposed: **yes**. | PROPOSED DESIGN |
| Period sequence not matching the calendar (F-7) | Use a sequence-based opening, consistent with ADR-0031. Document the divergence from date order. A calendar-alignment check is a separate decision (U-4). | PROPOSED DESIGN |

**Unknowns.** U-1 to U-5 in §10: opening-document production, statutory carry
presentation, special periods, calendar alignment in real data, and multi-year demand.

**Safe implementation boundary.** *(PROPOSED DESIGN)*

- Exactly one fiscal year per request.
- The opening basis is declared as intra-fiscal-year and sequence-based.
- No carry-forward is computed.
- Multi-year requests are rejected.
- Opening vouchers are shown as ordinary rows.
- A mandatory disclosure states that a year-start opening excludes prior-year balances,
  unless they were posted as a voucher inside that year.

**Final decision** *(REQUIRES OWNER DECISION)*:

- **D2.a** — restrict the first slice to one fiscal year;
- **D2.b** — how multi-year requests behave (proposed: reject);
- **D2.c** — the opening basis and its disclosure wording;
- **D2.d** — rely on ADR-0031's implemented semantics while ADR-0031 is Proposed, or
  first take ADR-0031 through its own acceptance process.

### 5.3 D3 — Account classification and OQ-25

Evidence: E-10, E-15, E-16.

**Classification inputs today.**

| Attribute | Repository state | Class |
| --- | --- | --- |
| `account_type` (asset / liability / equity / revenue / expense) | Not stored. The vocabulary is EXPERT-GATED. | BLOCKED BY OQ (OQ-25) |
| Temporary vs permanent (`is_temporary`) | Not stored. The mapping is EXPERT-GATED. | BLOCKED BY OQ (OQ-25) |
| Financial-statement classification (sections, subtotals, control roles) | No columns, no mapping, no role vocabulary. | BLOCKED BY OQ (OQ-25; layouts OQ-43) |
| Closing behavior (year-end close of temporary accounts) | No operation, no permission, no document marker (E-12, E-13). | BLOCKED BY OQ (OQ-23 / OQ-25) |
| `account_nature` (`debit` \| `credit`) | Stored and DECIDED, but *reporting direction only*. It does not restrict sides and is **not** a classification. Whether contrary-nature balances warn or block is EXPERT-GATED (E-16). | CONFIRMED BY REPOSITORY |
| Hierarchy (`parent_id`, `level`) and code prefix | Structure for rollups. Level titles are configuration. The code prefix is never a classification source (§8.5). | CONFIRMED BY REPOSITORY |

**Calculation tiers.**

| Tier | Calculations | Class |
| --- | --- | --- |
| T1 — nature-agnostic | Σdebit; Σcredit; net = debit − credit; intra-year opening and closing on a net basis; running balance (debit-positive); Σdebit = Σcredit over scopes made of whole vouchers; tree rollups summing descendants without double counting. All inputs exist. | CONFIRMED BY REPOSITORY |
| T2 — nature-aware | Normal-balance presentation (showing credit-nature balances as positive "credit"); contrary-nature flags. Uses only the stored `account_nature`, but the presentation policy is undecided. | REQUIRES OWNER DECISION |
| T3 — classification-dependent | Statement sections and subtotals; net income and retained earnings; temporary-account closing; current vs non-current; control-role groupings; sign rules per class. | BLOCKED BY OQ (OQ-25; OQ-43 statutory form; OQ-23 year-end) |

**Which reports are safe without classification.**

| Report | Needs classification data? | Computable without it (T1) | Blocked part | Implementation verdict |
| --- | --- | --- | --- | --- |
| Account Movement | No (CONFIRMED BY REPOSITORY) | Rows, turnover, intra-year opening/closing, running balance | Statutory ledger-book form: BLOCKED BY OQ (OQ-43) | Candidate first slice (REQUIRES OWNER DECISION) |
| Account Balance | No (CONFIRMED BY REPOSITORY) | Period turnover and derived opening/closing, already served by Task 12 (E-11) | Cross-year opening: BLOCKED BY OQ (OQ-23) | No new slice needed (PROPOSED DESIGN) |
| Detailed Trial Balance | No, for a flat non-statutory listing (CONFIRMED BY REPOSITORY) | T1 per postable account, plus the Σdebit = Σcredit check | 4/6/8-column layout and captions: BLOCKED BY OQ (OQ-25, OQ-43) | Not proposed first: density decision pending and risk of layout confusion (PROPOSED DESIGN) |
| Summary Trial Balance | No, for tree-level rollups (CONFIRMED BY REPOSITORY) | Rollup by account tree | Grouping by class or control role: BLOCKED BY OQ (OQ-25) | Not proposed first (PROPOSED DESIGN) |
| Income Statement | **Yes** (CONFIRMED BY REPOSITORY) | Nothing meaningful | The whole report: BLOCKED BY OQ (OQ-25, OQ-43, OQ-23) | BLOCKED BY OQ |
| Balance Sheet | **Yes** (CONFIRMED BY REPOSITORY) | Nothing meaningful. Grouping by code range would be inference, which is forbidden (§8.5). | The whole report: BLOCKED BY OQ (OQ-25, OQ-23, OQ-43) | BLOCKED BY OQ |

**Proposed.** The first slice uses T1 only, with debit-positive signed values. T2 is
deferred. The response states its sign convention explicitly. *(PROPOSED DESIGN)*

**Final decision** *(REQUIRES OWNER DECISION)*. This does not resolve OQ-25.

- **D3.a** — confirm T1 as the only balance semantics of the first slice.
- **D3.b** — allow or defer T2 presentation.
- **D3.c** — acknowledge that T3 reports remain blocked.

### 5.4 D4 — Financial-area access

Evidence: E-04, E-08, E-11, E-17, E-18.

| Question | Finding | Class |
| --- | --- | --- |
| Is `financialAreaId` caller-supplied? | Yes. It is an optional query parameter on both existing read surfaces (E-08, E-11). | CONFIRMED BY REPOSITORY |
| Do per-user grants exist? | No. There is no grant table and no `Accounting.FinancialAreaAccess.*` code registered (E-17). | CONFIRMED BY REPOSITORY |
| Structural vs authorization-based access | Only structural. Predicates limit rows to the area named. A foreign-organization id returns an empty page (Task 17A) or a 404 (balances). No user-level restriction exists. | CONFIRMED BY REPOSITORY |
| Is "one area per organization" enforced? | No. Areas can be created without a cap. The OQ-40 statement is an interim *assumption* (E-04, E-17). | CONFIRMED BY REPOSITORY |
| Exposure risk | Any holder of the read permission can read **every area of the same organization**. Tenant isolation is unaffected. | CONFIRMED BY REPOSITORY |
| Severity in real deployments | Depends on how many areas exist and whether they hold separately confidential books (OQ-56). | UNKNOWN |

**Options.**

- **A — Structural, explicit single area.** The area is derived from the required fiscal
  year. An optional `financialAreaId` must match it. There is no cross-area aggregation.
  The API docs state that the area is **not** an authorization boundary.
  *(PROPOSED DESIGN)*
- **B — Structural, organization-wide.** Aggregation across areas would mix books and
  depends on consolidation semantics. *(BLOCKED BY OQ — OQ-40 / OQ-56)*
- **C — Block until grants exist.** Best confidentiality, but it blocks indefinitely.
  Grants need their own schema, codes and task. *(REQUIRES OWNER DECISION)*
- **Deployment-level area restriction.** No such configuration exists. *(OUT OF SCOPE)*

**Proposed minimum safe behavior.** Option A. *(PROPOSED DESIGN)*

**Final decision.** Choose A or C. With A, the Owner also confirms one of two things:
deployments run a single area, or intra-organization visibility across areas is
acceptable until OQ-40 grants exist. *(REQUIRES OWNER DECISION)*

### 5.5 D5 — Closed and sealed period reporting

Evidence: E-02, E-03, E-11, E-19 to E-22.

| Question | Finding | Class |
| --- | --- | --- |
| Statuses | `open`, `closed` and `sealed` exist on years and periods, with explicit, permission-gated transitions. Audited reopen and unseal remain possible (ADR-0032 §6/§8). | CONFIRMED BY REPOSITORY |
| Current posting enforcement | Closed and sealed periods refuse finalization inside the transaction. This code is on `main`. A reversal must be dated in an open period (E-19, E-21). | CONFIRMED BY REPOSITORY |
| Task 14 status | READY FOR REVIEW — NOT ACCEPTED. ADR-0032 is Proposed. | CONFIRMED BY REPOSITORY |
| Read vs posting behavior | Reads apply no status predicate. Balances of closed periods are readable by design (E-11). | CONFIRMED BY REPOSITORY |
| Is "closed" final forever? | No. Reopen and unseal can change a period's contents later. | CONFIRMED BY REPOSITORY |
| Must a report state which periods it covers? | Yes (contract §7.2 rule 3). | CONFIRMED BY REPOSITORY |
| Is there a permission for closed/sealed reads? | No (E-22). | CONFIRMED BY REPOSITORY |

| Option | Assessment | Class |
| --- | --- | --- |
| 1. Read all authorized periods, echo each covered period's status and flag windows that include `open` periods | Consistent with freeze-over-delete and §7.2 rule 3. No new permission. | PROPOSED DESIGN (recommended) |
| 2. Restrict sealed periods | Hides readable history. There is no repository basis for it. | PROPOSED DESIGN (not recommended) |
| 3. Special permission for closed/sealed reads | Would invent a policy and need a new code. OQ-23 territory. | REQUIRES OWNER DECISION |
| 4. Warnings only | Already part of option 1. | PROPOSED DESIGN |
| 5. Block until Task 14 is accepted | Task 14 concerns the posting gate; read semantics do not depend on it. Only needed if a report claims that closed periods are final. | PROPOSED DESIGN (not needed if no finality claim is made) |

**Proposed.** Option 1. The output never labels closed or sealed figures as final or
statutory. Task 14 acceptance is not a prerequisite for this disclosure-based read
behavior. *(PROPOSED DESIGN)*

**Final decision.** Choose the read policy and state whether Task 14 acceptance must come
first. *(REQUIRES OWNER DECISION)*

### 5.6 D6 — Permission model

Evidence: E-22 to E-24; ADR-0006; ADR-0016; AR-22 in `.vardena/architecture-rules.md`.

| Code / convention | Governs | Registered | Class |
| --- | --- | --- | --- |
| `Accounting.LedgerMovement.View` | Reading immutable posted ledger rows (Task 17A) | Yes | CONFIRMED BY REPOSITORY |
| `Accounting.Balance.View` | Projection reads and reconciliation | Yes | CONFIRMED BY REPOSITORY |
| `Accounting.Balance.Rebuild` | Audited projection rebuild (a write) | Yes | CONFIRMED BY REPOSITORY |
| `Report.<id>.View` | Future per-report codes owned by the Reporting module | No (module absent) | CONFIRMED BY REPOSITORY |
| Report code + `Excel.Export` | Future export capability (reporting-strategy §6) | No | CONFIRMED BY REPOSITORY |

| Criterion | 1. Accounting-owned | 2. Reporting-owned | 3. Hybrid |
| --- | --- | --- | --- |
| Least privilege | Good per source. Reusing the code exposes nothing new, because the balances derive from rows the holder can already read. | Good per report. The report code alone gates access when Reporting reads Accounting-owned views directly (ADR-0009, AR-07). Not usable today, because no Reporting module exists. | Strongest: the user needs both the report code and the Accounting source code. This is automatic when Reporting calls the Accounting service inside a request (E-23). It must be a deliberate rule when Reporting reads views directly. |
| Route and service enforcement | Exists today (guard + service) | Needs Reporting guards and services first | Accounting half exists; Reporting half is future |
| Export separation | Not addressed. Export needs its own capability later. | Report code + `Excel.Export`; sensitive exports audited (E-32) | Same as model 2 |
| Future Reporting ownership | Accounting codes stay as source guards | Accounting must not register `Report.*` codes | Clean split: layer 1 (Accounting) vs layer 2 (Reporting) |
| ADR-0016 / AR-22 compatibility | Yes | Yes, once the module exists | Yes (all listed codes required) |
| Rollback | Reuse: nothing to roll back. A new code stays in `rbac.permissions` forever (E-24, OQ-20). | Not applicable now | Not applicable now |
| Admin burden | Low | Medium | Higher (two grants per user) |

Further findings:

- A future asynchronous report or export runs in system context, where service checks
  are skipped (E-23). The Reporting module must therefore authorize at submission time.
  *(PROPOSED DESIGN)*
- The read surface must never require or call `Accounting.Balance.Rebuild`.
  *(PROPOSED DESIGN)*

**Proposed.** For the first slice, model 1 reusing `Accounting.LedgerMovement.View`, with
no new code. Adopt model 3 when a Reporting module is separately authorized. Export codes
stay separate. No wildcard (OQ-21). *(PROPOSED DESIGN)*

**Final decision.** Reuse the code or register a dedicated Accounting code (name to be
chosen by the Owner), and choose the long-term model. *(REQUIRES OWNER DECISION)*

### 5.7 D7 — First implementation slice and performance boundary

This is the full specification that the gate document reuses. Every row is **PROPOSED
DESIGN** unless it names another class.

| Item | Proposal |
| --- | --- |
| Exact surface | **Intra-fiscal-year Account Statement**: two read-only GET operations in the Accounting module. Illustrative paths: `GET /api/v1/accounting/account-movements` (rows) and `GET /api/v1/accounting/account-movements/summary`. It is separate from the Task 17A endpoint, whose accepted contract stays unchanged. |
| Source of truth | `accounting.ledger_entries` only, for rows, totals, opening and running balance. `accounting.accounts`, `accounting.fiscal_years`, `accounting.accounting_periods` and `accounting.financial_areas` are read only to validate scope and to get period `sequence`. The Task 12 projection is **not** read at runtime; it is used only in reconciliation tests. |
| Supported filters | `organizationId` (required). `accountId` (required; a postable account of the organization). `fiscalYearId` (required). `financialAreaId` (optional; must equal the year's area). `accountingPeriodId` (optional; one period of that year). `page` and `pageSize` (rows only). |
| Unsupported filters (rejected with 400) | `dateFrom` / `dateTo`; `voucherId` / `voucherNumber`; branch; currency; dimensions; origin and source references; text search; status; several accounts or descendants; several years or areas; `sort`; grouping; density; "as of" posting time. |
| Maximum page size | Default 100, maximum 500 (shared `PageQueryDto`). |
| Query limits | Each request covers at most one organization, one account, one fiscal year and optionally one period. It runs a bounded set of statements (scope reads, count, opening, pre-page sum, page), with no N+1, all in **one consistent snapshot**. There is no platform statement timeout (E-25), and none is claimed. An optional per-endpoint rate budget can reuse the existing limiter (E-26). |
| Deterministic ordering | Fixed `document_date, voucher_number, line_no, id` ascending (the Task 17A default). No client sort. It is total because it ends with the unique `id`. The string-serial limitation is disclosed (E-28). |
| Decimal format | Every money value is an exact canonical decimal string (E-27). `debitAmount`, `creditAmount` and the totals are never negative. Only opening, running, net and closing values carry a sign (debit-positive). No JSON numbers, no floats, no rounding. |
| Date format | `documentDate` and the period/year bounds use `YYYY-MM-DD`. `postingTimestamp` is an ISO-8601 UTC instant. No Jalali or other localized rendering (OQ-02). |
| Permission | `Accounting.LedgerMovement.View`, checked by the route guard and again in the service (D6). |
| Organization isolation | Mandatory `organizationId`. The pin is asserted first (404), then `requireUsableOrganization` (unknown → 404, disabled → 422, E-18). Every predicate leads with `organization_id`. A foreign account, year, period or area returns **404** (AC-I-16). |
| Financial-area behavior | Exactly one area, derived from the year. An area/year mismatch returns 422 (E-11 precedent). No aggregation. Documented as not an authorization boundary (D4). |
| Fiscal-year limitation | Exactly one year. The opening is intra-year and sequence-based, and is declared in the response. Multi-year requests are impossible by construction (D2). |
| Expected indexes | The existing `idx_ledger_entries_org_account` and `idx_ledger_entries_org_period` (E-06). Candidate, **not created**: `(organization_id, account_id, fiscal_year_id, document_date, voucher_number, line_no, id)`, which gives an index-ordered scan with no sort. |
| Index now or deferred | **Deferred.** Add it only if live-PostgreSQL plans on the approved dataset show a need. It would then require a separate Owner approval and a forward migration (AR-10). |
| Response contract | Rows: the Task 17A movement fields plus `runningBalanceAmount`. Summary: a scope echo; `openingBalanceAmount`, `debitTotalAmount`, `creditTotalAmount`, `netChangeAmount`, `closingBalanceAmount`; the entry count; `signConvention: debit-positive`; `openingBasis: intra-fiscal-year`; the order basis; covered periods with their statuses; conditional notices such as open-period-in-scope. |
| Test requirements | Unit, service, HTTP e2e and live-PostgreSQL reconciliation, plus query-plan evidence. Full list in the gate (§7). |
| Explicit non-goals | Full list in the gate (§9). |

**Alternatives considered.** *(PROPOSED DESIGN)*

- **D1 Option A** is the fallback slice.
- A **flat non-statutory trial-balance listing** is not proposed first. Its density
  decision is pending, and it risks being read as a statutory layout.
- A **source-only delivery with no endpoint**, as recommended in
  `next-step-recommendation.md`, remains an Owner option. Task 17A set the endpoint
  precedent.

**Final decision** *(REQUIRES OWNER DECISION)*:

- **D7.a** — approve the specification as written, or as amended;
- **D7.b** — the delivery shape: two GETs (proposed), a composite response (which
  departs from the standard list envelope), or source-only;
- **D7.c** — the performance dataset and latency target (U-6);
- **D7.d** — defer the index until it is measured.

---

## 6. Security implications

| Id | Implication | Class |
| --- | --- | --- |
| SEC-1 | Tenant isolation holds. `organizationId` is mandatory, the pin and the service re-check it, every predicate is org-leading, and foreign scope ids return 404 (E-18). | PROPOSED DESIGN |
| SEC-2 | The financial area is **not** an authorization boundary. Any permission holder can read all areas of the organization until OQ-40 grants exist. | CONFIRMED BY REPOSITORY |
| SEC-3 | Reusing `Accounting.LedgerMovement.View` widens no data exposure, because every derived balance is a sum of rows the holder can already list. | PROPOSED DESIGN |
| SEC-4 | A newly registered code cannot be cleanly removed. The sync never deletes rows or role assignments. | CONFIRMED BY REPOSITORY (E-24, OQ-20) |
| SEC-5 | Input safety: unknown parameters (including `sort` and date filters) return 400. Values are bound parameters. No identifier comes from input (E-09). | PROPOSED DESIGN |
| SEC-6 | Read-only by construction: no write path, no `FOR UPDATE` / `FOR SHARE`, and no call to rebuild. The lock order is unchanged. | PROPOSED DESIGN |
| SEC-7 | Export, print and asynchronous execution are excluded. When added later, they need a separate capability, audit (E-32) and submission-time authorization (E-23). | OUT OF SCOPE |
| SEC-8 | Revoking the code from roles takes effect immediately (no cache). This is the operational kill switch. | CONFIRMED BY REPOSITORY (E-23) |

## 7. Accounting-correctness implications

| Id | Implication | Class |
| --- | --- | --- |
| ACC-1 | An intra-year opening is not a carried-forward balance. Year-start opening is 0 unless an opening voucher was posted in that year, so the response must declare `openingBasis`. | PROPOSED DESIGN |
| ACC-2 | Computing a carry-forward while opening documents also exist would double count, so carry-forward must never be synthesized. | BLOCKED BY OQ (OQ-23) |
| ACC-3 | When period sequence and calendar order disagree, a sequence-based opening diverges from a date-ordered running balance. How often that happens in real data is tracked as U-4. | PROPOSED DESIGN |
| ACC-4 | Reversal pairs can straddle windows and show one side. Rows appear as posted, with no netting (netting policy is OQ-27). | PROPOSED DESIGN |
| ACC-5 | Debit-positive signs show credit-nature balances as negative. The convention must be explicit; nature-aware presentation is D3. | PROPOSED DESIGN |
| ACC-6 | A single account has no Σdebit = Σcredit invariant. Tests must not assert one. The invariant applies only to scopes made of whole vouchers. | PROPOSED DESIGN |
| ACC-7 | Closed and sealed are reversible states. Figures must not be labeled final or statutory (D5). | PROPOSED DESIGN |
| ACC-8 | The source is ledger-only, so projection drift can never distort the statement. Reconciliation tests detect projection defects separately. | PROPOSED DESIGN |
| ACC-9 | All arithmetic is exact (PostgreSQL `numeric` or BigInt), serialized with `canonicalizeAmount`. No float and no rounding. | PROPOSED DESIGN |
| ACC-10 | Whether intra-day order must follow numeric voucher serials (legal-book order) is undecided. Closing and totals do not depend on intra-day order (E-28). | BLOCKED BY OQ (OQ-43) |

## 8. Scalability implications

| Id | Implication | Class |
| --- | --- | --- |
| SCL-1 | Cost is bounded by one account's rows in one fiscal year, far below the unfiltered tenant-wide scans measured in Task 17A. | PROPOSED DESIGN |
| SCL-2 | No index serves account + legal-book order (E-06). A high-volume account needs a sort on every page. | CONFIRMED BY REPOSITORY |
| SCL-3 | The pre-page sum costs O(offset) within the account-year. Deep pages cost more but stay bounded. | PROPOSED DESIGN |
| SCL-4 | Performance is unmeasured for this shape. The only evidence is a synthetic WASM rehearsal (E-29). | UNKNOWN |
| SCL-5 | There is no statement timeout and no read-only pool (E-25). Adding either is infrastructure. | OUT OF SCOPE |
| SCL-6 | A migration-generated plain `CREATE INDEX` on a large ledger blocks writes to `ledger_entries` (and therefore finalization) for the whole build. `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block, has a known upstream limitation with Prisma Migrate (prisma/orm issue #14456), and has no repository precedent. Any index therefore needs its own operational plan, which is a reason to defer it. | PROPOSED DESIGN |
| SCL-7 | Offset pages are not stable across requests while an open period receives postings. Each page is consistent within its own snapshot only. | PROPOSED DESIGN |
| SCL-8 | Keyset paging would change the repository-wide list convention. | OUT OF SCOPE |

## 9. Dependencies

| Dependency | State | Effect on the first slice | Class |
| --- | --- | --- | --- |
| Task 17A | ACCEPTED | Query shape, order and permission reused. Its endpoint is unchanged. | CONFIRMED BY REPOSITORY |
| Task 12 / ADR-0031 | Legacy "accepted with follow-up"; ADR Proposed; P1 open | Semantics relied upon (D2.d). The projection is not written, locked or read at runtime. P1 is not absorbed. | REQUIRES OWNER DECISION |
| Task 14 / ADR-0032 | NOT ACCEPTED; Proposed | No finality claims (D5). | CONFIRMED BY REPOSITORY |
| Task 15 reversal | Implemented; no dedicated review record (`STATE.md` §7) | Rows shown as posted. | CONFIRMED BY REPOSITORY |
| Task 13 | IN PROGRESS | Not affected (read-only; no configuration interplay). | PROPOSED DESIGN |
| OQ-25, OQ-43 | OPEN | Interim postures required (G-1, G-2). | BLOCKED BY OQ |
| OQ-23 | OPEN | Cross-year opening excluded. | BLOCKED BY OQ |
| OQ-40 | OPEN | Structural area posture (D4). | BLOCKED BY OQ |
| OQ-27 | OPEN | No netting or linkage presentation. | BLOCKED BY OQ |
| OQ-20 | OPEN | Only matters if a new permission code is chosen. | BLOCKED BY OQ |
| OQ-02, OQ-03, OQ-41, OQ-49, OQ-56 | OPEN | Excluded from the slice. | BLOCKED BY OQ |
| ADR-0009 / reporting-strategy | Accepted; runtime not implemented | Future consumption only. No Reporting module is created. | CONFIRMED BY REPOSITORY |
| Statutory samples (E-31) | Not supplied | Needed only for statutory work, not for this slice. | CONFIRMED BY REPOSITORY |

## 10. Unresolved questions

These are raised as Owner-facing questions, **not** registered as new OQs. The Owner may
choose to register any of them.

| Id | Question | Class |
| --- | --- | --- |
| U-1 | Will opening and closing documents be generated or entered manually, and when? | BLOCKED BY OQ (OQ-23) |
| U-2 | Must statutory output show the prior-year closing as the new-year opening? | BLOCKED BY OQ (OQ-43) |
| U-3 | Will adjustment or special periods exist, and how do they order? | BLOCKED BY OQ (OQ-23) |
| U-4 | Is period `sequence` aligned with the calendar in real deployments, and should alignment be validated? | UNKNOWN |
| U-5 | Are multi-year account statements needed at launch? | UNKNOWN |
| U-6 | What representative dataset and latency target should the performance evidence use? | REQUIRES OWNER DECISION |
| U-7 | Sparse vs dense defaults for balance and trial-balance surfaces (brief D2). | REQUIRES OWNER DECISION |
| U-8 | Adoption of the `ReportResponse<T>` envelope and the four-layer boundary (brief D6). | REQUIRES OWNER DECISION |
| U-9 | Must intra-day order follow numeric voucher serials? | BLOCKED BY OQ (OQ-43) |
| U-10 | How many financial areas do real deployments use, and are they separately confidential? | UNKNOWN |

## 11. Documentation drift observed

These are flagged only, per AG-17. None of them is edited here.

| Id | Drift | Class |
| --- | --- | --- |
| DR-1 | `docs/accounting/task-index.md` (header, §2 row 17B, §4) says Task 17B is `READY FOR REVIEW — NOT ACCEPTED`. `STATE.md` has no Task 17B row. The Owner's instruction treats 17B as accepted as a documentation milestone after PR #41's merge. | CONFIRMED BY REPOSITORY |
| DR-2 | `docs/accounting/task-index.md` §4 row "Ledger movement read source" still says Task 17A `READY FOR REVIEW — NOT ACCEPTED`. `docs/modules.md` (summary table, line 25) says "not accepted". Both conflict with ACCEPTED (2026-09-25). | CONFIRMED BY REPOSITORY |
| DR-3 | `task-17a-implementation-report.md` §6 says a missing or inactive organization returns 404. The code returns **422** for a disabled organization (E-18). | CONFIRMED BY REPOSITORY |
| DR-4 | The task-index header still calls PRs #31 and #32 open. `STATE.md` records them as merged. Already tracked as BOOT-R-03. | CONFIRMED BY REPOSITORY |
| DR-5 | The foreign-id posture differs between the two read surfaces: an empty page for movements (E-08) and a 404 for balances (E-11). The first slice proposes 404 for its required keys. | CONFIRMED BY REPOSITORY |

A future agent that re-reads DR-1 on `main` would hit Task 17 `prompt.md` stop
condition 5. Recording the milestone (G-3) is therefore a gate prerequisite.
*(PROPOSED DESIGN)*

## 12. Owner decision checklist

Everything below is **REQUIRES OWNER DECISION**, except G-1 and G-2, which are
**BLOCKED BY OQ** until the postures are recorded. "Proposed" means a technical proposal
only.

| Id | Decision | Options | Proposed | Owner selection |
| --- | --- | --- | --- | --- |
| D1 | Movement content and scope | A: rows + totals / B: intra-year statement | B, restricted as in §5.1 | ☐ A ☐ B ☐ amended: ____ |
| D1.o | Intra-day ordering | Task 17A string order / numeric serial order | Task 17A order, disclosed | ☐ 17A ☐ numeric |
| D2.a | One fiscal year per request | yes / no | yes | ☐ yes ☐ no |
| D2.b | Multi-year request behavior | reject / per-year sections without carry | reject | ☐ reject ☐ sections |
| D2.c | Opening basis and disclosure | sequence-based (ADR-0031) / date-based | sequence-based + disclosure | ☐ sequence ☐ date |
| D2.d | Reliance on ADR-0031 while it is Proposed | rely / accept ADR-0031 first | rely, with disclosure | ☐ rely ☐ accept first |
| D3.a | Balance semantics limited to T1 | yes / no | yes | ☐ yes ☐ no |
| D3.b | T2 (nature-aware) presentation | defer / allow | defer | ☐ defer ☐ allow |
| D4 | Area posture | A: structural single-area / C: block until grants | A | ☐ A ☐ C |
| D4.c | Deployments have one area, or cross-area visibility is accepted | confirm / reject | confirm, if true | ☐ confirmed ☐ not |
| D5 | Closed/sealed read policy | 1 read-all+disclose / 2 restrict / 3 special permission / 5 wait for Task 14 | 1 | ☐ 1 ☐ 2 ☐ 3 ☐ 5 |
| D6 | First-slice permission | reuse `Accounting.LedgerMovement.View` / new Accounting code | reuse | ☐ reuse ☐ new: ____ |
| D6.l | Long-term model | Accounting-owned / Reporting-owned / hybrid | hybrid | ☐ 1 ☐ 2 ☐ 3 |
| D7.a | Slice specification (§5.7) | approve / amend / reject | approve | ☐ approve ☐ amend ☐ reject |
| D7.b | Delivery shape | two GETs / composite response / source-only | two GETs | ☐ 2 GETs ☐ composite ☐ source |
| D7.c | Dataset and latency target | e.g. ≥ 100k tenant rows (reporting-strategy §8) / other | ≥ 100k rows incl. one high-volume account; record latency | ☐ ____ |
| D7.d | Index | defer until measured / add in slice | defer | ☐ defer ☐ add |
| G-1 | OQ-25 interim posture for exactly this slice (non-statutory, nature-agnostic; excludes classification, control roles and statutory layouts). **Does not close OQ-25.** | record / do not | — | ☐ recorded at: ____ |
| G-2 | OQ-43 interim posture from accountant / tax-legal for exactly this slice, excluding compliance and e-ledger claims. **Does not close OQ-43.** | record / do not | — | ☐ recorded at: ____ |
| G-3 | Record Task 17B as accepted **as a documentation milestone** in `docs/accounting/task-index.md` and `STATE.md` | record / do not | record | ☐ done |
| G-4 | Authorize the implementation task (name/number, scope = gate §2 as amended) | authorize / defer | — | ☐ authorized: ____ |

## 13. Verification performed (documentation-only)

These checks are documentation-oriented only. They were run against base `0f2951e`.
No runtime test was run and none is claimed.

- **Whitespace.** `git diff --check` is clean.
- **Scope of the diff.** `git diff --name-only 0f2951e` lists exactly two files: this
  pack and the gate.
- **Paths.** Every backticked repository path and every relative link in both documents
  was extracted and tested on the filesystem: 75 references, all present. Code symbols
  such as `vw_account_balance_derived`, the index names, `canonicalizeAmount` and
  `requireAllPermissions` were confirmed by `grep` in `backend/`.
- **ADR references.** ADR-0006, 0009, 0014, 0016, 0025, 0026, 0031 and 0032 all resolve
  to files under `docs/adr/`, and their stated statuses match E-03.
- **OQ references.** OQ-02, 03, 20, 21, 23, 25, 27, 40, 41, 43, 47, 48, 49 and 56 are rows
  of the **Open** table of `docs/open-questions.md`. OQ-64 is in the Resolved table.
- **Unchanged files.** `backend/`, `.github/`, `docker-compose.yml` and `.env.example`
  have no diff, so no production, schema, migration, dependency or CI change was made.
  `STATE.md`, `docs/open-questions.md`, `docs/accounting/`, `docs/adr/`,
  `docs/modules.md` and the existing Task 17 / 17A / 17B records have no diff either.
- **Statuses.** Task 17 is still FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS
  (`brief.md`). OQ-25 and OQ-43 are still in the Open table.

## 14. Version record

- 2026-09-25 — Created as part of *Task 17B — Owner Decision Pack and Implementation Gate
  Preparation* (OWNER DECISION PREPARATION ONLY). Documentation only: no production,
  schema, migration, index, endpoint, permission, projection, OQ, ADR or status change.

## Later date/time clarification (2026-10-09)

This pack is a historical Task 17B snapshot dated 2026-09-25. Its statements
that BusinessDate fields were Gregorian-only/unlocalized and that Jalali display
was blocked by OQ-02 accurately describe that snapshot; they are not current
policy. Owner-accepted ADR-0042 (2026-10-09) later resolved the generic
BusinessDate/Instant contract and OQ-73: canonical Gregorian BusinessDates are
PostgreSQL `date` values, user-facing input/display follows the organization's
calendar (Jalali by default), and UTC Instants render in the configured valid
IANA zone and calendar. This later decision does not broaden Task 17B's accepted
scope or imply that its implementation added date localization. OQ-02 remains
open for primary UI language, Persian numerals, and broader localization. See
ADR-0042 and `docs/datetime.md`.
