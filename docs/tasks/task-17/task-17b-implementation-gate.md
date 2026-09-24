# Task 17B — Implementation Gate (first Accounting reporting slice)

- **Task:** Task 17B — Owner Decision Pack and Implementation Gate Preparation
- **Type:** OWNER DECISION PREPARATION ONLY (documentation)
- **Gate status:** **CLOSED — implementation NOT AUTHORIZED.**
- **Document status:** READY FOR REVIEW. Nothing in it is accepted until the Owner records
  it.
- **Date:** 2026-09-25 (the repository's UTC+03:30 date convention; 2026-09-24 UTC)
- **Branch / baseline:** `arena/01a0d55b-vardena`, base
  `0f2951eca69fcedc3ae85c894ff3bf3103360195` (merge of PR #41)
- **Companion (decisions and evidence):**
  [`task-17b-owner-decision-pack.md`](./task-17b-owner-decision-pack.md). Evidence ids
  `E-nn`, decision ids `D1`–`D7` and checklist ids `G-1`–`G-4` refer to that pack.

> **Boundary.** This gate defines the conditions under which the Owner *could*
> authorize the first narrow Accounting reporting slice. It authorizes nothing by
> itself. It does not resolve or reclassify any Open Question (**OQ-25 and OQ-43 remain
> OPEN**). It does not change Task 17's status (**FORMALIZED / IMPLEMENTATION
> BLOCKED**). It does not replace the Task 17 gate in [`brief.md`](./brief.md) §7 or the
> stop conditions in [`prompt.md`](./prompt.md). Task 17A remains **ACCEPTED**. Task 17B's
> investigation is accepted only as a documentation milestone.

| Item | State at baseline | Class |
| --- | --- | --- |
| Gate | CLOSED: no Owner decision, no interim posture and no authorization is recorded on `main` | CONFIRMED BY REPOSITORY |
| Task 17 | FORMALIZED / IMPLEMENTATION BLOCKED | CONFIRMED BY REPOSITORY |
| OQ-25, OQ-43 | OPEN | CONFIRMED BY REPOSITORY |
| Proposed scope (§2) | A technical proposal only | PROPOSED DESIGN |

Classes follow the decision pack §0: CONFIRMED BY REPOSITORY, PROPOSED DESIGN, UNKNOWN,
REQUIRES OWNER DECISION, BLOCKED BY OQ, OUT OF SCOPE. In tables, a "Proposal" column is
PROPOSED DESIGN unless a cell names another class.

---

## 1. How this gate relates to the existing Task 17 gate

This gate **narrows** the Task 17 gate to one slice. Every Task 17 condition still applies.

- The Task 17 conditions quoted in the left column are recorded in `brief.md` §7 and
  `prompt.md`. *(CONFIRMED BY REPOSITORY)*
- The mapping to this gate's prerequisites is this document's proposal.
  *(PROPOSED DESIGN)*

| Task 17 condition | Where this gate checks it |
| --- | --- |
| `brief.md` §7 (1): OQ-25 resolved, or an Owner-recorded bounded interim posture | P-01 |
| `brief.md` §7 (2): OQ-43 resolved, or an accountant / tax-legal interim posture for the exact scope | P-02 |
| `brief.md` §7 (3): Task 14's review state re-read and respected | P-07 |
| `brief.md` §7 (4): deferred concepts (area grants, currency, cross-year opening, dimensions, localization) cleared or excluded | P-08 and §2 |
| `brief.md` §7 (5): work limited to Accounting's contribution, with no generic Reporting module or Report Builder | P-08 and §9 |
| `prompt.md` stop condition 5: a dependency's status conflicts with the implementation assumption | P-04 and P-07 |
| `prompt.md` stop condition 6: the Owner has not authorized the exact report set | P-05 |

## 2. Proposed implementation scope

> The whole of this section is **PROPOSED DESIGN**. It matches decision pack §5.7. If
> the Owner's recorded decisions differ, the recorded decisions govern.

### 2.1 Surface

| Item | Proposal |
| --- | --- |
| Name | **Intra-fiscal-year Account Statement.** Non-statutory and ledger-native. It is not a legal book. |
| Operations | Two read-only GET operations in the Accounting module. Illustrative paths: `GET /api/v1/accounting/account-movements` (rows) and `GET /api/v1/accounting/account-movements/summary` (one summary object). Final paths are confirmed at implementation (kebab-case, `/api/v1`, AG-10). |
| Relation to Task 17A | A separate controller and service. The accepted `GET /api/v1/accounting/ledger-movements` contract is **not** changed. |
| Source of truth | `accounting.ledger_entries` only, for rows, opening, running balance and totals. Scope rows (`accounts`, `fiscal_years`, `accounting_periods`, `financial_areas`) are read only for validation and for period `sequence`. The Task 12 projection is **not** read at runtime. |
| Permission | `Accounting.LedgerMovement.View`, reused and checked by the route guard and in the service (ADR-0016). No new code, unless D6 records otherwise. |

### 2.2 Request contract and error posture

| Parameter | Rule |
| --- | --- |
| `organizationId` | Required. A ULID. The pin is asserted, then the organization is resolved server-side. |
| `accountId` | Required. A ULID. Must be a **postable** account of the organization. Inactive accounts are allowed, because history stays readable. |
| `fiscalYearId` | Required. A ULID of the organization. Exactly one year per request. |
| `financialAreaId` | Optional. When present, it must equal the fiscal year's area. |
| `accountingPeriodId` | Optional. One period of that fiscal year. When absent, the window is the whole year. |
| `page`, `pageSize` | Rows operation only. Default 1 / 100; `pageSize` maximum 500 (shared `PageQueryDto`). |
| Anything else | Rejected with 400, including `sort`, `dateFrom`, `dateTo`, `voucherId`, `voucherNumber`, branch, currency, dimension, status, search and grouping parameters. |

| Condition | Response | Basis |
| --- | --- | --- |
| Anonymous request | 401 | ADR-0016 |
| Missing `Accounting.LedgerMovement.View` | 403 (generic message) | ADR-0016 |
| Malformed or unknown parameter | 400 | E-09 |
| Organization outside the pin, or unknown | 404 | E-18 |
| Organization disabled | 422 (existing `requireUsableOrganization` behavior) | E-18 |
| Account, year, period or area not in the organization | 404, never 403 | contract §4, AC-I-16; E-11 precedent |
| `financialAreaId` ≠ the year's area, or period not in the year | 422 | E-11 precedent |
| Account not postable (it cannot hold ledger rows) | 422 (proposed) | E-15 |
| No rows in the window | 200, empty `items`; the summary still returns the opening and zero totals | Task 17A precedent (E-08) |

### 2.3 Response contract

- **Rows operation.** Standard envelope `{ items, total, page, pageSize }` (E-09). Each
  item carries the Task 17A movement fields:
  - identity and scope: `id`, `organizationId`, `financialAreaId`, `fiscalYearId`,
    `accountingPeriodId`;
  - voucher traceability: `voucherId`, `voucherNumber`, `voucherLineId`, `lineNo`,
    `accountId`;
  - amounts and text: `debitAmount`, `creditAmount`, `description`;
  - dates: `documentDate`, `postingTimestamp`;
  - origin: `origin` and `source*`;
  - **plus `runningBalanceAmount`**.
- **Summary operation.** One object containing:
  - a scope echo: organization, area, fiscal year, optional period, account;
  - `openingBalanceAmount`, `debitTotalAmount`, `creditTotalAmount`, `netChangeAmount`,
    `closingBalanceAmount` and `entryCount`;
  - `signConvention` = `debit-positive`;
  - `openingBasis` = `intra-fiscal-year`;
  - `orderBasis` = `documentDate, voucherNumber, lineNo, id`;
  - the fiscal year's status and bounds;
  - `coveredPeriods` (id, `sequence`, status, bounds);
  - `notices`, a closed code-defined list (for example `open-period-in-scope`), never
    free text.
- **Money encoding.** Exact canonical decimal strings from `canonicalizeAmount` (E-27).
  `debitAmount`, `creditAmount`, `debitTotalAmount` and `creditTotalAmount` are never
  negative. Only opening, running, net and closing values carry a sign (debit-positive).
  No JSON numbers, no floats, no rounding.
- **Date encoding.** `documentDate` and the year/period bounds use `YYYY-MM-DD`
  (date-only). `postingTimestamp` is an ISO-8601 UTC instant. No localized or Jalali
  rendering (OQ-02).
- **Exclusions.** No account code, title or nature; no classification; no layout,
  captions or subtotals; no reversal linkage.

### 2.4 Computation rules

| Rule | Proposal |
| --- | --- |
| R-1 Window | Ledger rows with `organization_id` = O, `account_id` = A and `fiscal_year_id` = Y, plus `accounting_period_id` = P when P is given. |
| R-2 Opening | With no P: `0`, by construction (ADR-0031 §9). With P: Σ(`debit_amount` − `credit_amount`) over the rows of (O, A, Y) whose period `sequence` is lower than P's (the ADR-0031 semantics, E-10). **No cross-year carry-forward, ever** (OQ-23). |
| R-3 Order | `document_date`, `voucher_number`, `line_no`, `id`, all ascending. Fixed and total. |
| R-4 Running balance | For the row at position k in R-3 order across the **whole window** (not only the page): opening + Σ(debit − credit) of rows 1…k. |
| R-5 Totals | `debitTotal` = Σdebit(W); `creditTotal` = Σcredit(W); `net` = debitTotal − creditTotal; `closing` = opening + net; the running balance of the last row equals `closing`. |
| R-6 Snapshot | Every value in one response comes from **one consistent snapshot**: either one read-only `REPEATABLE READ` transaction or one SQL statement. |
| R-7 Exactness | PostgreSQL `numeric` or BigInt (`sumAmounts`). Prisma `Decimal` is converted with `toString()`, never `Number()`. |
| R-8 Faithfulness | One row per ledger entry. No synthesized, netted or suppressed rows. Reversal rows appear as posted. |

### 2.5 Performance boundary

| Item | Proposal |
| --- | --- |
| Page size | Default 100, maximum 500. |
| Scope bound | One organization, one account, one fiscal year (optionally one period) per request. |
| Statements per request | Bounded: scope reads, `count`, the opening aggregate, the pre-page aggregate and the page `findMany`. No N+1 queries, no relation loading. |
| Timeouts | There is no platform statement timeout (E-25), and none is claimed. Adding one is infrastructure (OUT OF SCOPE). |
| Rate limiting | The existing global per-IP limiter applies (E-26). A stricter per-endpoint budget is optional. |
| Indexes used | The existing `idx_ledger_entries_org_account` and `idx_ledger_entries_org_period` (E-06). |
| Candidate index | `(organization_id, account_id, fiscal_year_id, document_date, voucher_number, line_no, id)`. **Deferred.** Created only after live-PostgreSQL plans on the approved dataset show a need, and then only with a separate Owner approval and a forward migration (AR-10). |

### 2.6 Implementation constraints

| Constraint | Proposal |
| --- | --- |
| Layers | The controller is transport-only (AR-03). The application service does authorization and scope (AR-04). The domain does the pure exact arithmetic (AR-05). The data layer does the reads (AR-02). |
| Data access | Parameterized Prisma reads (`findMany`, `count`, `aggregate`/`_sum`; precedent E-30), so no raw SQL is required. A raw-SQL window-function statement in `data/` is acceptable only if it is measured as necessary and documented under AR-11(c) in `docs/modules.md`. |
| Schema | No table, view, materialized view, migration, index, trigger or projection change. |
| Concurrency | No `FOR UPDATE` / `FOR SHARE`, no write transaction, no event and no lock-order change (`docs/accounting/lock-order-matrix.md` untouched). |
| Module boundaries | Only Accounting-owned tables, plus the public `OrganizationsService` (AR-07). |
| Contract docs | OpenAPI documented from DTOs with decimal-string examples and every error response (ADR-0014). |
| Records | Update `docs/modules.md` (the Accounting API entry). Write an implementation report. Update the task index and `STATE.md` with evidence only. Leave OQ and ADR statuses unchanged. |

## 3. Prerequisites

Every row must be evidenced **on current `main`** before any production file changes.

| Id | Prerequisite | Evidence required | State at baseline | Class |
| --- | --- | --- | --- | --- |
| P-01 | OQ-25: resolved, **or** an Owner-recorded bounded interim posture for exactly this slice (non-statutory; nature-agnostic; excludes classification, control roles and statutory layouts). The posture does not close OQ-25. | A repository record naming this slice; the OQ-25 row stays in the Open table | Not recorded | BLOCKED BY OQ |
| P-02 | OQ-43: resolved, **or** an interim posture recorded by the accountant / tax-legal owner for exactly this slice, excluding compliance, e-ledger and statutory claims. The posture does not close OQ-43. | A repository record naming this slice; the OQ-43 row stays in the Open table | Not recorded | BLOCKED BY OQ |
| P-03 | Decisions D1–D7 recorded (decision pack §12) | A decision record on `main` | None | REQUIRES OWNER DECISION |
| P-04 | Task 17B recorded as accepted **as a documentation milestone** (G-3). Otherwise the index conflicts with this gate (DR-1). | `docs/accounting/task-index.md` and `STATE.md` updated by the Owner | The index says `READY FOR REVIEW — NOT ACCEPTED` | REQUIRES OWNER DECISION |
| P-05 | The implementation task is explicitly authorized (G-4): name or number, scope (§2 as amended), branch and PR expectations | An authorization record on `main` | None | REQUIRES OWNER DECISION |
| P-06 | This gate and the decision pack are reviewed and merged by the Owner | Both files on `main` | On `arena/01a0d55b-vardena`, unmerged | REQUIRES OWNER DECISION |
| P-07 | Dependency statuses re-read and respected. Task 17A is ACCEPTED. Task 14 is **not** accepted, so no finality claims. Task 12 P1 stays separate and is not absorbed. ADR-0031 and ADR-0032 are not promoted. ADR-0031 reliance follows D2.d. | A current `main` re-read, recorded in the implementation report | As E-02 and E-03 | CONFIRMED BY REPOSITORY (baseline; must be re-verified) |
| P-08 | The scope needs none of: OQ-40 grants (with the D4 posture accepted), OQ-03 currency, OQ-23 cross-year opening, OQ-41 dimensions, OQ-02 localization, OQ-49 builder, or a Reporting module | §2 unchanged, or the amendments recorded | §2 is designed this way | PROPOSED DESIGN |
| P-09 | A performance dataset and a latency target (or "record only") agreed (D7.c) | Recorded decision | None | REQUIRES OWNER DECISION |
| P-10 | The permission decision recorded (D6). If a **new** code is chosen, the contract §22 vocabulary update and registry addition become authorized scope, and OQ-20 persistence is acknowledged. | Recorded decision | None | REQUIRES OWNER DECISION |

## 4. Required Owner approvals

Every approval below is **REQUIRES OWNER DECISION**. Two sources shape the decider
column:

- The Repository Owner is the final decision-maker (`STATE.md` §4).
  *(CONFIRMED BY REPOSITORY)*
- For A-08 and A-09, the decider also follows the OQ owner recorded in
  `docs/open-questions.md`: OQ-25 is owned by the Accountant, and OQ-43 by the
  Accountant plus a tax/legal expert. *(CONFIRMED BY REPOSITORY)*

| Id | Approval | Pack reference | Decider |
| --- | --- | --- | --- |
| A-01 | Movement content, scope and intra-day ordering | D1, D1.o | Owner (accountant input advised) |
| A-02 | Fiscal-year restriction, multi-year behavior, opening basis and disclosure, ADR-0031 reliance | D2.a–D2.d | Owner + accountant |
| A-03 | Nature-agnostic semantics only; nature-aware presentation deferred or allowed | D3.a–D3.b | Owner + accountant (OQ-25 is not resolved) |
| A-04 | Financial-area posture and deployment confirmation | D4, D4.c | Owner |
| A-05 | Closed/sealed read policy; whether Task 14 acceptance must come first | D5 | Owner (accountant input advised) |
| A-06 | First-slice permission and long-term permission model | D6, D6.l | Owner |
| A-07 | Slice specification, delivery shape, dataset/latency target, index deferral | D7.a–D7.d | Owner (architecture reviewer advised) |
| A-08 | OQ-25 interim posture | G-1 | Accountant + Owner |
| A-09 | OQ-43 interim posture | G-2 | Accountant + tax/legal expert |
| A-10 | Record Task 17B's documentation-milestone status | G-3 | Owner |
| A-11 | Authorize the implementation task | G-4 | Owner |

## 5. Blocked items

These stay blocked regardless of the approvals above.

| Id | Item | Governing decision | Class |
| --- | --- | --- | --- |
| B-01 | Cross-year opening and carry-forward; presenting year-transition documents as opening | OQ-23; ADR-0031 §9 (dedicated task + ADR) | BLOCKED BY OQ |
| B-02 | Account classification, temporary/permanent, control roles, classified summaries | OQ-25 | BLOCKED BY OQ |
| B-03 | Income statement and balance sheet | OQ-25, OQ-23, OQ-43 | BLOCKED BY OQ |
| B-04 | Statutory books (journal, general, subsidiary, detail), 4/6/8-column trial balances, statutory ordering, e-ledger export | OQ-43, OQ-25 | BLOCKED BY OQ |
| B-05 | Per-user area grants; cross-area aggregation; two-book accounting | OQ-40, OQ-56 | BLOCKED BY OQ |
| B-06 | Multi-currency, FX, revaluation | OQ-03, OQ-47, OQ-48 | BLOCKED BY OQ |
| B-07 | Dimension and detail ledgers | OQ-41 | BLOCKED BY OQ |
| B-08 | Reversal netting and correction-window presentation | OQ-27 | BLOCKED BY OQ |
| B-09 | Localized (Persian/Jalali) labels and rendering | OQ-02 | BLOCKED BY OQ |
| B-10 | Report Builder depth | OQ-49 | BLOCKED BY OQ |
| B-11 | Pruning a permission code after it is removed | OQ-20 | BLOCKED BY OQ |
| B-12 | Wildcard or superuser access | OQ-21 | BLOCKED BY OQ |

## 6. Acceptance criteria

These apply to a future, gate-cleared implementation only. None has been executed.

| Id | Criterion | Class |
| --- | --- | --- |
| **Correctness** | | |
| AC-01 | Exactly one row per ledger entry in (O, A, Y[, P]), reconciled 1:1 with `accounting.ledger_entries`. No synthesized rows. | PROPOSED DESIGN |
| AC-02 | The opening follows R-2. For a projection-backed period it equals `vw_account_balance_derived.opening_balance_amount`. A whole-year window has opening `0`. | PROPOSED DESIGN |
| AC-03 | Running balances follow R-4 and are continuous across pages within one snapshot. The last row's running balance equals `closing`. | PROPOSED DESIGN |
| AC-04 | Totals follow R-5 and are exact. Money is canonical strings; only balance fields carry a sign. | PROPOSED DESIGN |
| AC-05 | No cross-year carry-forward. A second fiscal year cannot be requested. | PROPOSED DESIGN |
| AC-06 | Reversal rows appear as posted and originals are never suppressed. A reversal pair inside one window contributes zero to `netChangeAmount` while raising both Σdebit and Σcredit. | PROPOSED DESIGN |
| AC-07 | Closed and sealed periods are readable. Statuses are echoed. No "final" or "statutory" label appears. | PROPOSED DESIGN |
| AC-08 | Every value of one response comes from one snapshot (R-6). | PROPOSED DESIGN |
| **Security** | | |
| AC-09 | The permission is enforced by the route guard and the service (401/403 tested). No new code unless D6 says so. | PROPOSED DESIGN |
| AC-10 | Organization isolation: pin → 404; unknown organization → 404; foreign account/year/period/area → 404. A live two-organization test returns no foreign rows. | PROPOSED DESIGN |
| AC-11 | Exactly one area per request. A mismatch returns 422. No aggregation. | PROPOSED DESIGN |
| AC-12 | Unknown parameters, including `sort`, date filters and voucher filters, return 400. All values are bound parameters. | PROPOSED DESIGN |
| AC-13 | Read-only: no write method, no row locks, no mutation route, no rebuild call. | PROPOSED DESIGN |
| **Performance** | | |
| AC-14 | `pageSize ≤ 500`. Statements per request are bounded. | PROPOSED DESIGN |
| AC-15 | Live-PostgreSQL query plans on the approved dataset are documented, and the index decision is recorded. No index is added without approval. | PROPOSED DESIGN |
| **Operational** | | |
| AC-16 | No schema, migration, view, projection or lock-order change (unless separately approved). | PROPOSED DESIGN |
| AC-17 | `docs/modules.md` and the implementation report are updated. Task index and `STATE.md` updates are evidence-only. OQ-25 and OQ-43 stay OPEN. Review is requested; the task is never self-accepted. | PROPOSED DESIGN |

## 7. Test expectations

All of these are **PROPOSED DESIGN**. File names are indicative.

| Level | Indicative location | Must cover |
| --- | --- | --- |
| Domain unit | `backend/src/modules/accounting/domain/<statement>.spec.ts` | Opening, running and closing arithmetic on exact strings; signed values; `0` and `-0`; magnitudes near the `numeric(18,2)` limit and sums beyond it; order totality. |
| Service unit | `backend/src/modules/accounting/application/<statement>.service.spec.ts` | Service-layer 401/403; pin 404; unknown organization 404; disabled organization 422; foreign account, year, period or area 404; area mismatch 422; period not in year 422; non-postable 422; inactive account allowed; `sort` rejected; paging defaults and maximum. |
| HTTP e2e | `backend/test/<statement>.e2e-spec.ts` | Guard 401/403; 400 for unknown parameters (`sort`, `dateFrom`, `voucherId`); envelopes; running-balance continuity from page N to page N+1; page beyond the end; empty-window summary; no mutation route. |
| Live PostgreSQL (CI) | `backend/test/<statement>-live.e2e-spec.ts` | See the fixture list below this table. |
| Structural | Extend the reference-surface lock in `backend/src/modules/accounting/application/posting.service.spec.ts`, or an equivalent | The new read path adds no write method and takes no lock. |
| Performance evidence | Implementation report | `EXPLAIN (ANALYZE, BUFFERS)` on live PostgreSQL for page 1, a deep page, a single-period window and a whole-year window on the approved dataset (D7.c). Timings recorded. The index decision recorded. |

The live-PostgreSQL suite should include:

- **Fixtures:** two organizations, two areas, two fiscal years, and periods in `open`,
  `closed` and `sealed` status. Manual postings. One reversal pair inside the window and
  one that crosses a period boundary.
- **Reconciliation:** rows reconcile 1:1 with the ledger; the opening equals the derived
  view; `closing` = opening + net.
- **Isolation and exactness:** cross-organization isolation on real rows; exactness at
  `0.01`.
- **Edge cases:** a misaligned-sequence fixture that *documents* the behavior (ACC-3);
  a snapshot-consistency probe.

Evidence rules *(PROPOSED DESIGN)*:

- Record the commands, their actual results and the CI run ids.
- Never relabel inherited Task 12, 13, 14 or 17A evidence as new.
- Do not assert Σdebit = Σcredit for a single account (ACC-6).

## 8. Rollback and safety considerations

| Id | Consideration | Class |
| --- | --- | --- |
| RB-1 | The slice is read-only and has no schema. Rollback is reverting the implementation PR: no data repair, no down-migration. | PROPOSED DESIGN |
| RB-2 | The route and service are separate, so a rollback cannot affect Task 17A's accepted endpoint. | PROPOSED DESIGN |
| RB-3 | Reusing the permission leaves nothing behind. A **new** code would stay in `rbac.permissions` and in role assignments after rollback, because the sync never deletes (E-24, OQ-20). | CONFIRMED BY REPOSITORY |
| RB-4 | Kill switch: revoking the code from roles takes effect on the next request (no cache, E-23). With reuse, this **also** disables Task 17A's endpoint, so reuse gives no independent switch. The alternative is reverting or removing the route. | PROPOSED DESIGN |
| RB-5 | No locks and no writes, so the finalization path and the lock order are untouched. A `FOR UPDATE` / `FOR SHARE` in the read path is a defect. | PROPOSED DESIGN |
| RB-6 | The snapshot transaction is read-only, per request, and short-lived. It must never span requests. | PROPOSED DESIGN |
| RB-7 | Adding an index later means a forward migration. A plain `CREATE INDEX` blocks ledger writes for the whole build. `CONCURRENTLY` cannot run in a transaction block and has no repository precedent with Prisma Migrate, so the index needs a verified operational plan or a maintenance window. Its rollback is another forward migration (AR-10). | PROPOSED DESIGN |
| RB-8 | A ledger-only source means a rejection of ADR-0031 (whose fallback is ledger aggregation) would not break the slice. Only the reconciliation tests would change. | PROPOSED DESIGN |
| RB-9 | Disclosure fields (`openingBasis`, `signConvention`, period statuses) guard against misreading. Removing them is a regression. | PROPOSED DESIGN |
| RB-10 | Nothing is persisted: no report snapshot, cache or second truth (AC-I-19). | PROPOSED DESIGN |

## 9. Out-of-scope list

For the first slice, **all OUT OF SCOPE** unless a separate authorized record says
otherwise:

- **Accounts and dimensions.** Account hierarchy or descendant rollups; several accounts
  at once; account code, title or nature enrichment; branch, currency, dimension or
  detail filters.
- **Filters and windows.** Date-window filters; voucher or serial filters; client
  sorting; keyset paging; dense or zero-row synthesis; several years or areas;
  cross-area aggregation.
- **Balance semantics.** Cross-year opening; year-transition operations; nature-aware or
  classification-dependent presentation; reversal linkage or netting.
- **Report types.** Trial balances (detailed or summary); income statement; balance
  sheet; statutory books and layouts; e-ledger export.
- **Reporting platform.** A Reporting module, registry, pipeline, `ReportResponse<T>`
  envelope, `Report.<id>.View` codes, dashboards or the Report Builder (OQ-49); user SQL
  or expressions.
- **Outputs.** XLSX, CSV, PDF, print, export engines or artifacts; asynchronous jobs.
- **Frontend.** Frontend or UI work.
- **Schema and infrastructure.** Schema, migrations, indexes, views, materialized views,
  projections or triggers. Statement timeouts, a read-only DB role, caching, Redis, new
  infrastructure or new dependencies.
- **Permissions and access.** New permissions (unless D6 decides otherwise); area grants.
- **Governance.** Posting changes or ledger mutation. Changes to OQ, ADR or task status
  outside evidence-only records. Absorbing Task 12's P1 follow-up.

## 10. Stop conditions for a future implementing agent

**STOP and make no production change** when any of these holds:

1. Any of P-01 to P-10 is not evidenced on current `main`.
2. The recorded Owner decisions require something this gate prohibits (schema, index,
   new permission, Reporting module, export) and that item is not explicitly authorized.
3. The work would read another module's tables, compute a cross-year opening, infer a
   classification, render a statutory layout or enforce area authorization.
4. A dependency's status conflicts with this gate. Examples: Task 17A is no longer
   ACCEPTED; Task 14 is presented as accepted without a record; ADR-0031 is rejected
   and D2.d relied on it.
5. A test or document would need to claim finality, statutory compliance or tenancy
   beyond the ADR-0025 posture.

When stopped, record the evidence, the blocking prerequisite and the narrow decision
needed. Invent no interim rule. *(PROPOSED DESIGN, mirroring Task 17 `prompt.md`)*

## 11. Gate evaluation record (to be filled by the Owner or reviewer)

| Prerequisite | Evidence location on `main` | Verified by / date |
| --- | --- | --- |
| P-01 | | |
| P-02 | | |
| P-03 | | |
| P-04 | | |
| P-05 | | |
| P-06 | | |
| P-07 | | |
| P-08 | | |
| P-09 | | |
| P-10 | | |

## 12. Verification performed (documentation-only)

These are the same documentation-only checks as decision pack §13: `git diff --check`,
cited paths exist, ADR and OQ references resolve, no production, schema, migration or
dependency file changed, and Task 17, OQ-25 and OQ-43 statuses are unchanged. No runtime
test was run and none is claimed.

## 13. Version record

- 2026-09-25 — Created as part of *Task 17B — Owner Decision Pack and Implementation Gate
  Preparation* (OWNER DECISION PREPARATION ONLY). Gate recorded as **CLOSED**. No
  production, schema, migration, index, endpoint, permission, projection, OQ, ADR or
  status change.
