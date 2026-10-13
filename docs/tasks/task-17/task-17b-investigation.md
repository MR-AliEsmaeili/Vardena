# Task 17B — Accounting Movement, Balance Read Surface & Reporting Contract Investigation

- **Task title:** Accounting Movement, Balance Read Surface & Reporting Contract Investigation
- **Type:** INVESTIGATION + CONTRACT DESIGN ONLY
- **Status:** READY FOR REVIEW (documentation only) — 2026-09-25
- **Branch:** `arena/01a0d54c-vardena` (base `332229387bebfd78eda13d71e29fbc1dbe8ae477` = merge of PR #40)
- **Related:** Task 17 (`brief.md`, `prompt.md`), Task 17A (`task-17a-acceptance-record.md`)

> This document investigates and **designs** the Accounting-owned read-side
> contracts needed for future accounting reports. It defines **no production
> code, no endpoint, no service, no repository, no projection, no view, no
> migration, no index, no permission, no report builder, no export, no print
> engine and no frontend.** Its status is `READY FOR REVIEW`; the only capable
> reviewers are the Repository Owner / accountant / tax-legal owner. `READY FOR
> REVIEW` is **not** acceptance of implementation.

---

## 1. Scope

Investigate and formally define, at contract level only:

1. the **canonical source** for account movement;
2. **opening balance**, **closing balance**, and **debit/credit total** semantics;
3. a contract-level answer for how **account balance** is computed given that
   `account_type`/`is_temporary` are **not** authoritative today;
4. whether the current schema can support account-level movement, hierarchy
   aggregation, detailed trial balance, summary trial balance and period
   comparison;
5. the authoritative **date filter**, **financial-area filter** semantics, and
   cross-period / closed-period / sealed-period behavior;
6. reversal/correction appearance, zero-balance and no-movement handling,
   deterministic ordering, pagination, and query limits;
7. exact Decimal representation requirements;
8. the **Accounting vs Reporting** data-ownership boundary;
9. a conceptual, implementation-neutral `ReportResponse<T>` envelope and the
   four distinct contract layers (domain read contract, shared Reporting
   envelope, export formatting, legal/statutory profile);
10. minimum future data requirements for **Account Movement**, **Account
    Balance**, **Detailed Trial Balance**, and **Summary Trial Balance**.

## 2. Non-goals (explicit)

This task does **not** produce, change, or authorize any of the following —
each is listed so that a later reader cannot treat this investigation as an
implementation record:

- production code (services, controllers, repositories, projections, views);
- schema changes or migrations (Prisma `.prisma`, `migrations/`);
- new endpoints or new permissions in code;
- report builders, generic Report Builder (OQ-49), user-defined report SQL;
- XLSX/CSV generation, PDF/print implementation, frontend;
- electronic books (`دفاتر قانونی`), statutory or financial-statement
  implementation, AR/AP, cash flow, workflow/rules engine;
- universal report tables, EAV or giant-JSONB report models;
- microservices, Redis or any other infrastructure addition.

If any implementation appears necessary from this analysis, it is recorded in
§16 as a **future task**, never started here.

## 3. How to read this document

Every important conclusion is tagged with exactly one classification:

| Marker | Meaning |
| --- | --- |
| CONFIRMED BY REPOSITORY | A fact established by citing the current `main` tree (file, symbol, migration, test, or decision record). |
| PROPOSED DESIGN | A contract-level proposal made by this task, clearly identified as a proposal and not as repository fact. |
| UNKNOWN | Not determinable from current repository evidence; no assumption is manufactured. |
| REQUIRES OWNER DECISION | Determinable only by the Repository Owner / accountant / tax-legal / architecture owner. |
| BLOCKED BY OQ | Governed by an Open Question in `docs/open-questions.md`; nothing here resolves or reclassifies it. |
| OUT OF SCOPE | Explicitly outside this task's boundary. |

Lineage is fully inside **Accounting-owned facts**; no conclusion below reads
operational modules (AR-07, AC-I-13, ADR-0026 §3.1).

---

## 4. Repository baseline verified

- HEAD of `main` and of the working branch: `3322293` — **Merge pull request #40
  from MR-AliEsmaeili/arena/01a0d4d0-vardena** (`docs(accounting): accept Task
  17A ledger movement source`). *(CONFIRMED BY REPOSITORY — `git log -1`.)*
- PR #40 is therefore present in the tree that this investigation reads.
  *(CONFIRMED BY REPOSITORY.)*
- `docs/tasks/task-17/task-17a-acceptance-record.md` records Task 17A as
  **ACCEPTED (2026-09-25)** via PR #39 merged in `130fab9`.
  *(CONFIRMED BY REPOSITORY.)*
- `docs/tasks/task-17/brief.md` and `prompt.md` record Task 17 as
  **FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS (OQ-25/OQ-43)**.
  *(CONFIRMED BY REPOSITORY.)*
- `docs/accounting/task-index.md` and `STATE.md` carry the same statuses and
  additionally record Task 12 **ACCEPTED WITH FOLLOW-UP** (P1 real-PG
  concurrency), Task 13 **IN PROGRESS (self-review)**, Task 14 **READY FOR
  REVIEW — NOT ACCEPTED**, Task 16 **BLOCKED — OWNER CONFIRMATION REQUIRED**.
  None of those statuses is altered by this task. *(CONFIRMED BY REPOSITORY.)*

---

## 5. Repository evidence

### 5.1 A — Accounting ledger

**LedgerEntry schema and semantics** — `backend/prisma/schema/accounting.prisma`,
model `LedgerEntry` (schema `accounting`, table `ledger_entries`); materialized
by `backend/src/modules/accounting/data/accounting-rows.ts`
(`LedgerEntryCreate`/`LedgerEntryRow`) and
`backend/src/modules/accounting/data/ledger-entries.repository.ts`
(`insertLedgerEntries`). Key facts:

- One row per **finalized voucher line**. The migration only-populates through
  `AccountingDocumentsRepository.finalizeChecked` inside the finalization
  transaction; there is no update/delete method.
- Stored scope: `organization_id`, `financial_area_id`, `fiscal_year_id`,
  `accounting_period_id` (all denormalized, resolved once from
  `document_date`; reports never recompute — AC-I-14, contract §6.2 rule 4).
- Traceability: `voucher_id`, `voucher_number`, `voucher_line_id` (UNIQUE),
  `line_no`, `account_id`.
- Amounts: `debit_amount` / `credit_amount` `numeric(18,2)` — non-negative,
  exactly one non-zero per row (§13.2, AC-I-08). Carried as decimal **strings**
  through the domain (`backend/src/modules/accounting/domain/money.ts`:
  `canonicalizeAmount`, `sumAmounts`, `compareAmounts` — BigInt mantissa
  arithmetic, no JS float).
- Two dates: `document_date` (`DATE`, business/occurrence date — §12.3) and
  `posting_timestamp` (`timestamptz(6)` — the finalization instant, §15.5).
- `origin` `manual|system`; `source_module/entity_type/entity_id/operation`
  logical references (null for manual); `branch_id` header-level snapshot;
  `correlation_id`, `finalized_by` audit snapshots.

**Posted/final constraint** — `ledger_entries` has **no** `status` column.
Rows exist only for `final` documents; a `draft`/`temporary` voucher has zero
entries. Posted-only is structural, not a filter; Task 17A documents this
explicitly in `backend/src/modules/accounting/domain/ledger-movement.ts`
(“POSTED-ONLY BY CONSTRUCTION”).

**Immutability** — structural: no repository update/delete API, no mutation
route (`ledger-entries.repository.ts` header comment; contract §15.2/§15.3,
AC-I-05/06). Corrections are new, additive counter-documents (AC-D-22).

**Reversal/correction behavior** — Task 15 migration
`backend/prisma/migrations/20260923000000_accounting_document_reversal/migration.sql`
adds typed voucher-header self-links (`correction_kind`, `correction_reason`,
`reverses_document_id`, `reversed_by_document_id`). The **ledger rows of the
original are never suppressed or negated**; a reversal materializes its own
new ledger rows with debit/credit swapped. The movement read source does not
project this linkage (Task 17A limitation §15 item 4 in
`task-17a-implementation-report.md`).

**Indexes and query capability** — model `LedgerEntry` carries
`@@index([organizationId, voucherId])`, `@@index([organizationId, accountId])`,
`@@index([organizationId, accountingPeriodId])`; the unique
`voucherLineId` backstop. Task 17A's rehearsal (§14) confirms the real index
set (`pk_ledger_entries`, `uq_ledger_entries_voucher_line_id`,
`idx_ledger_entries_org_voucher`, `idx_ledger_entries_org_account`,
`idx_ledger_entries_org_period`) and the **absence of any date-leading index**.
*Scalability consequence:* account/period/voucher equality filters are
index-served; an unfiltered tenant-wide page or a business-date window is a
tenant-wide scan + top-N sort.

### 5.2 B — Account structure

- **One adjacency table** (`Account`, schema `accounting.accounts`): `parent_id`
  self-FK (RESTRICT), integer `level` (1-based), digits-only immutable `code`
  (`@db.VarChar(32)`), `title`, `account_nature` (`debit|credit`),
  `is_postable`, `is_active`. Group/General/Subsidiary/Detail are **configured
  level labels**, never tables and never code constants (AC-D-06/07,
  `backend/src/modules/accounting/domain/account.ts` header).
- **Identity/code:** `code` unique per `(organization_id, code)`; immutable;
  prefix-proven against parent (`backend/src/modules/accounting/domain/account-code.ts`
  `checkAccountCode`).
- **Active/inactive:** `is_active` freeze-over-delete; deactivation blocks new
  postings/children, history stays readable (§8.6).
- **Nature:** `account_nature` (`debit|credit`) **is** a closed, decided list and
  **is** stored. It is **reporting semantics only** — it does not restrict which
  side a line uses (§13.4). *(CONFIRMED BY REPOSITORY.)*
- **Classification:** `account_type` and `is_temporary` (asset/liability/equity/
  revenue/expense + temporary closing) are **NOT stored** — the vocabulary and
  the mapping are EXPERT-GATED with OQ-25 (schema file header: “`account_type`
  … no column is invented”; contract §8.3). **Account nature is therefore NOT
  authoritative for account classification.** *(CONFIRMED BY REPOSITORY —
  see also `docs/open-questions.md` OQ-25 row.)*
- **Hierarchy sufficiency:** one adjacency tree `parent_id` + `level` is
  sufficient for rollups via recursive CTE / materialized path; the schema
  header notes a rebuildable `path` projection belongs “with the reporting task
  that reads it” (§8.2). Indexes `(organization_id, parent_id)`,
  `(organization_id, level)` exist. No `account_type`/control-role columns exist
  yet, so **classification-driven summary reporting is not supportable without
  OQ-25 resolution**.

### 5.3 C — Task 12 and balance infrastructure

- `AccountBalanceProjection` (`accounting.account_balance_projections`) — one
  row per `(org, area, fiscal_year, accounting_period, account)`; stored
  measures **only** `period_debit_amount` / `period_credit_amount`
  (`numeric(18,2)`). Unique 5-column key + indexes `(org, area, year)`,
  `(org, account)`, `(org, period)`.
- **Projection source of truth:** always the ledger. Rebuilt by
  `Accounting.Balance.Rebuild` (explicit audited slice replacement, `GROUP BY`
  ledger, `HAVING <> 0`); reconciliation view `vw_balance_reconciliation` and
  domain `reconcileBalances` (`backend/src/modules/accounting/domain/balance-projection.ts`)
  surface drift. AC-I-19: the projection is **never** the authority.
- **Rebuildability / consistency / transaction boundary:** maintained
  transactionally inside `finalizeChecked` (ADR-0031 §5); rebuild is atomic and
  idempotent-by-replacement (ADR-0031 §6). P1 real-PostgreSQL concurrency
  verification remains open (Task 12 follow-up) — not claimed here.
- **Derived measures:** `vw_account_balance_derived`
  (`backend/prisma/migrations/20260922000000_accounting_balance_projection/migration.sql`)
  computes `period_net = debit − credit`, `opening = cumulative closing up to
  PRIOR period`, `closing = opening + period_net`, **windowed**
  `PARTITION BY (org, area, fiscal_year, account) ORDER BY accounting_periods.sequence`
  — **never crossing a fiscal-year boundary**. First period opening = 0.
- **Reporting suitability gap:** the projection answers “turnover per period ×
  account”. It deliberately does **not** store opening/closing, does **not**
  carry branch/currency/dimension keys, does **not** synthesize zero-turnover
  rows, and does **not** carry cross-year opening. A report that needs dense
  periods, cross-year carry-forward, classification, or dimension keys must
  obtain the missing semantics from the owning decisions (OQ-23/OQ-25/OQ-40/
  OQ-41), never from the projection.

### 5.4 D — Fiscal period and financial area

- `FiscalYear` / `AccountingPeriod`
  (`backend/src/modules/accounting/domain/fiscal-year.ts`,
  `domain/accounting-period.ts`): statuses `open|closed|sealed`; periods are
  explicit dated rows inside one year with a 1-based `sequence`, `period_kind`
  `normal` only (adjustment/special period = OQ-23 seam); years may be
  non-contiguous (non-overlap required); several periods may be open at once.
  Enforcement **inside** the finalization transaction (Task 14 / ADR-0032 —
  READY FOR REVIEW, not accepted). `reopen`/`unseal` are explicit
  permission-gated operations (ADR-0032 §6/§8).
- `FinancialArea` (`domain` + model): Accounting-owned bookkeeping scope;
  `isDefault` per org; a document belongs to exactly one area
  (AC-D-03); years/periods/documents/numbering/balances are **area-scoped**;
  chart + coding structure are **organization-scoped** with area applicability
  (AC-D-04). Per-user financial-area **grants** are a target model, not
  implemented — access today is **structural** (caller-supplied, like
  `organizationId`) — OQ-40.
- **Organization binding:** all rows carry `organization_id`; the deployment
  pin `DEPLOYMENT_ORGANIZATION_ID` (ADR-0025) is an opt-in per-process
  assertion; by-id mismatches answer **404, never 403**.

### 5.5 E — Permissions and security

- Accounting registers granular `Accounting.<Entity>.<Action>` codes
  (`backend/src/modules/accounting/domain/accounting-permissions.ts` +
  `application/accounting-permission-registration.ts`), evaluated twice
  (route guard + service) with no wildcard/superuser (ADR-0016, OQ-21).
- **Task 17A permission** `Accounting.LedgerMovement.View` (registered, 35
  codes total). `Accounting.Balance.View`/`Rebuild` cover the projection.
- **Reporting permissions:** Reporting-strategy §1 item 4 + domain contract §22
  reserve `Report.<id>.View` codes **registered by the (not-yet-implemented)
  Reporting module**. Whether separate permissions are needed for movement /
  balance / trial-balance / export / execution is a **design decision**, not a
  code change here — see §7 Q/design and the brief.
- **Deployment pin:** `backend/src/kernel/config/app-config.ts`
  (`deploymentOrganizationId`, validated ULID) + global
  `DeploymentOrganizationScopeGuard`; services re-check via
  `organizations.assertOrganizationInScope` /
  `requireUsableOrganization` (`backend/src/modules/organization/application/organizations.service.ts`).
  Tenant isolation therefore **does not** depend only on the pin: every ledger
  / projection read leads with `organization_id` in its predicates.

### 5.6 F — Existing reporting architecture

Reconciled sources:

- **ADR-0009** (`docs/adr/0009-reporting-views-raw-sql.md`, Accepted): module-owned
  views first; parameterized raw SQL only in a Reporting module for cross-module
  reports; report definitions are code (registry: id, permission, source,
  columns, filter whitelist, limits); one pipeline (filter → group → sort →
  paginate → cap) serving UI / Excel / Print; per-report permission; row caps
  (5k UI / 50k export); query timeout + async escalation; read-only DB role.
- **ADR-0012** (`docs/adr/0012-print-template-system.md`, Accepted): Print
  provides the **mechanism** (document-type registry, data providers, versioned
  HTML/CSS templates, PDF in the worker); source modules provide **data**.
  Reporting must not re-implement print.
- **`docs/reporting-strategy.md`** (Accepted foundation): code-defined
  definitions, view-first, single pipeline, `columns[]` / `filters[]` operator
  whitelist, single-column grouping v1, `pageSize ≤ 500`, read-only posture.
- **OQ-25** (`docs/open-questions.md`): chart/coding and **statutory report
  layouts** — class-and-layout gate. **OPEN.**
- **OQ-43** (`docs/open-questions.md`): Iranian statutory/legal requirements
  (legal books, entry timing, language/currency, no-deletion, branch
  obligations, Art. 169, retention) — must be validated with expert/
  authoritative sources before any statutory layout. **OPEN.**
- **OQ-49** (`docs/decisions/product/OQ-49-report-builder-mvp-depth.md`): Report
  Builder MVP depth — separate from code-defined reports, **OPEN**, explicitly
  out of scope for Task 17 family.
- **Task 17 documents** (`brief.md`/`prompt.md`) + **domain contract §19**
  (AC-D-30/31): ledger is truth; balances are rebuildable projections; report
  filters are stored-column predicates; layouts ≠ models; statutory layouts
  expert-gated.
- **Accounting task index** (`docs/accounting/task-index.md`): authority for
  task statuses. No `reporting` backend module exists today
  (`backend/src/modules/` lists: accounting, documents, health, identity,
  inventory, organization, rbac, users, workflow).

**Reconciliation verdict:** the invitation for Accounting-owned report sources
already exists (domain contract §19.1/§19.2/§19.3, ADR-0009, reporting-strategy);
what is **missing by design** is (a) the shared Reporting registry/execution
module, (b) report definition/pipeline code, and (c) the OQ-25/OQ-43-gated
layout and classification decisions. Nothing in this task designs (a) or
starts (b) or (c).

---

## 6. Data lineage (current, authoritative)

```
accounting_documents  (header)  ── finalizeChecked ──►  state = final
       │  (1 : N)
       ▼
accounting_document_lines   ── 1:1 (voucher_line_id UNIQUE) ──►  ledger_entries
       │                                                            (immutable, insert-only)
       │ Task 12 UPSERT inside finalization tx
       ▼
account_balance_projections  (turnover-only, rebuildable)
       │  vw_account_balance_derived  (period_net / opening / closing, intra-year)
       ▼
Accounting-owned report sources  ──(future, this task designs contracts)──►  Reporting module (future)
```

**Source-of-truth order:** `ledger_entries` (authority) → `account_balance_projections`
(derived, rebuildable, reconciliation-checked) → report sources (read-only).
The Reporting module (future) consumes; it never writes `accounting.*`.

---

## 7. Required design questions

**Q1. What exactly is the canonical source for account movement?**

- **Evidence:** `ledger_entries` is the immutably materialized posted evidence;
  `LedgerEntriesRepository.listMovements` + `domain/ledger-movement.ts`
  (Task 17A, ACCEPTED) is the Accounting-owned read source; one movement = one
  ledger row; no second truth.
- **Decision:** CONFIRMED BY REPOSITORY. Account movement = `accounting.ledger_entries`.
- **Consequence:** future Account Movement / account-ledger reports must read
  ledger facts (or a module-owned view over them), never the projection and
  never operational tables.

**Q2. How should opening balance be calculated?**

- **Evidence:** ADR-0031 §4/§9 + `vw_account_balance_derived`: opening for a
  period = cumulative `SUM(debit − credit)` of **prior periods of the same
  (org, area, fiscal year, account)**, windowed by `accounting_periods.sequence`,
  first period = 0. Cross-year opening carry is **explicitly deferred**
  (ADR-0031 §9; year-transition documents = OQ-23, contract §6.4).
- **Decision:** CONFIRMED BY REPOSITORY for **intra-year** opening; cross-year
  opening is UNKNOWN → BLOCKED BY OQ (OQ-23) / future Year-Transition task.
- **Consequence:** any report claiming an opening balance must state its
  window; filtering periods before computing an opening changes the answer
  (noted in `next-step-recommendation.md`).

**Q3. How should closing balance be calculated?**

- **Evidence:** `closing = opening + period_net` (`period_debit − period_credit`),
  exact decimal, derived and **never stored** (ADR-0031 §2; view SQL).
- **Decision:** CONFIRMED BY REPOSITORY (intra-year). Cross-year closing ⇒
  same OQ-23 gate as Q2.
- **Consequence:** closing is a pure function of turnover; no snapshot may be
  persisted as an authority.

**Q4. How should debit and credit totals be calculated?**

- **Evidence:** totals are `SUM(debit_amount)` / `SUM(credit_amount)` over the
  scoped ledger predicate, or the projection's per-key `period_debit/credit`
  sums for period × account. Exact `numeric(18,2)` arithmetic
  (`sumAmounts`/SQL numeric), never float.
- **Decision:** CONFIRMED BY REPOSITORY.
- **Consequence:** totals are derived aggregates; the report contract must
  always expose boundary context (ledger-scope vs projection-scope) so the two
  cannot be conflated.

**Q5. Account balance for asset/liability/equity/revenue/expense where account
nature is not authoritative?**

- **Evidence:** `account_nature` (`debit|credit`) is stored and decided; but
  asset/liability/equity/revenue/expense classification (`account_type`,
  `is_temporary`) is **not stored** (schema header; OQ-25). `accountNature`
  governs balance *direction* only, and §13.4 forbids rejecting a
  contrary-nature balance as a rule.
- **Decision:** BLOCKED BY OQ. A **debit-nature** account's balance can be
  expressed as `Σ debit − Σ credit`; a **credit-nature** account's natural
  presentation would be `Σ credit − Σ debit` — but **which** presentation,
  per-class sign conventions, and statement classification require OQ-25
  (`account_type`, control roles) and, for statements, OQ-43.
- **Consequence:** Task 17B may only define **nature-agnostic** balance
  measures — `debitTurnover`, `creditTurnover`, `net (= debit − credit)` — and a
  derived `natureNormalBalance` flag presented only if a future permitted
  layout asks for it. Class-specific balance rules are OUT OF SCOPE until
  OQ-25.

**Q6. Can the current schema support: account-level movement, hierarchy
aggregation, detailed trial balance, summary trial balance, period comparison?**

- **Evidence:** account-level movement ✅ (ledger + `(org, account)` index);
  hierarchy aggregation ✅ structurally (adjacency tree; recursive CTE; note
  the §8.5 no-double-count rule) but **classification-grouped** summary +
  *control-role* rollups ❌ (no `account_type`/roles); detailed trial balance
  ✅ over projection/derived view (per period × account) without dimensions;
  summary trial balance ⚠️ only as **account-code/tree rollups** in a
  non-classified form (not asset/liability/… grouped); period comparison ⚠️
  intra-year only (no cross-year opening carry), and multi-period/`sequence`
  ordering exists.
- **Decision:** CONFIRMED BY REPOSITORY with OQ-gated exclusions.
- **Consequence:** any future summary statement must block on OQ-25 (and
  OQ-43 for statutory form).

**Q7. What is the authoritative date filter?**

- **Evidence:** Task 17A exposes `document_date` (business date, `DATE`) plus
  `posting_timestamp`; period/year are **stored resolutions** — reports never
  re-derive them (§6.2 rule 4, AC-I-14). Contract §12.3 keeps both dates
  deliberately.
- **Decision:** CONFIRMED BY REPOSITORY. Authoritative **reporting** axis =
  stored `fiscal_year_id`/`accounting_period_id`; the **chronological/business**
  axis = `document_date`; the **audit/timing** axis = `posting_timestamp`. No
  single field is “the” date — the report definition must name the axis.
- **Consequence:** a report contract must declare which axis its filters and
  ordering use, and never re-resolve a period from a date.

**Q8. How should financial-area filtering work?**

- **Evidence:** every ledger/projection row carries `financial_area_id`;
  `ListBalancesQueryDto` and `ListLedgerMovementsQueryDto` accept an optional
  `financialAreaId` inside the organization; per-user area grants are NOT
  implemented (OQ-40 interim = structural).
- **Decision:** CONFIRMED BY REPOSITORY for organizational scoping; area as an
  *authorization* boundary is BLOCKED BY OQ (OQ-40) until grants exist.
- **Consequence:** future sources may require a single area id or an
  allow-listed area set within one organization; aggregation across areas and
  area-access enforcement must wait for OQ-40 / OQ-56.

**Q9. What happens when a report spans multiple fiscal periods, closed periods,
sealed periods, or multiple financial areas?**

- **Evidence:** stored period/year resolution makes multi-period reads a plain
  predicate; closed/sealed statuses do **not** suppress history (freeze over
  delete; Task 14 enforcement gates *posting*, not reading); multiple open
  periods allowed; the projection window does **not** cross years (ADR-0031 §9).
- **Decision:** CONFIRMED BY REPOSITORY for “history stays readable”; the
  *reporting policy* for closed/sealed inclusion (which periods a legal book
  may show, whether sealed years must be re-rendered identically) is UNKNOWN →
  BLOCKED BY OQ (OQ-23/OQ-27/OQ-43).
- **Consequence:** a report contract must carry an explicit
  `periodCoverage`/`includingClosedSealed` intent and must not silently
  synthesize cross-year opening; multi-area aggregation is OUT OF SCOPE until
  OQ-40.

**Q10. How should reversals and correcting documents appear?**

- **Evidence:** Task 15 typed reversal adds ledger rows for the reversal
  (debit/credit swapped); the original ledger rows stay; correction/replacement
  mechanisms (AC-D-22) are additive. The movement source does **not** flatten
  or suppress them.
- **Decision:** CONFIRMED BY REPOSITORY for the ledger shape. The **presentation**
  (netting, linking, “reversed” badges, statutory reversal columns) is UNKNOWN
  → BLOCKED BY OQ (OQ-27 policy; OQ-43 layout).
- **Consequence:** a raw source must expose movement rows as-is; any “present
  net of reversals” view is a separately authorized layout, never the source.

**Q11. How should zero-balance accounts be handled?**

- **Evidence:** projection **omits** zero-turnover rows (absence = zero,
  AC-I-19c); accounts are never deleted; a leaf may be non-postable.
- **Decision:** CONFIRMED BY REPOSITORY for the projection; the **reporting
  density** rule (show vs collapse zero rows in a trial balance) is PROPOSED
  DESIGN — and the choice between *sparse* (projection-faithful) and *dense*
  (LEFT JOIN periods/accounts) output is REQUIRES OWNER DECISION for each
  future surface.
- **Consequence:** the report contract must carry a `density` policy (sparse/
  dense) and, when dense, the join source (periods and/or accounts).

**Q12. How should accounts with no movement during the selected period be
handled?**

- **Evidence:** identical mechanics to Q11; ADR-0031 §4 explicitly says dense
  series must `LEFT JOIN accounting.accounting_periods`; the projection never
  fabricates rows.
- **Decision:** CONFIRMED BY REPOSITORY (no-movement = absent) + PROPOSED
  DESIGN (dense option via LEFT JOIN) + REQUIRES OWNER DECISION (default
  density per report).
- **Consequence:** cannot mark a no-movement account as zero-balance without
  deciding the density policy; can always derive it.

**Q13. What deterministic ordering is required?**

- **Evidence:** Task 17A established allow-listed sort (`documentDate`,
  `postingTimestamp`) plus unconditional stable tie-breakers
  (`voucher_number`, `line_no`, `id`). Balance list allow-lists
  `periodSequence`, `accountId`, amounts, `createdAt/updatedAt`.
- **Decision:** PROPOSED DESIGN (formalized rule): every report ordering must be a
  **total order** — whitelisted fields + a unique id as the final tie-breaker —
  and must be returned in response metadata.
- **Consequence:** paging is stable only if ordering is total; this is a hard
  requirement (mirrors `STABLE_TIE_BREAKERS` in
  `ledger-movements.service.ts`).

**Q14. What pagination model is safe for large ledgers?**

- **Evidence:** shared `PageQueryDto` (`DEFAULT_PAGE=1`, `DEFAULT_PAGE_SIZE=100`,
  `MAX_PAGE_SIZE=500`); reporting-strategy row caps (UI 5k / export 50k), query
  timeout, async escalation; Task 17A measured deep OFFSET cost (external merge
  sort at ~49,900 offset).
- **Decision:** CONFIRMED BY REPOSITORY (bounded page size) + PROPOSED DESIGN
  (prefer **cursor/keyset** pagination over offset for movement sources that
  routinely page deep; retain offset only where bounded datasets make it safe).
- **Consequence:** deep offset on tenant-wide scans is a known scalability
  risk (§11); a future source should document its paging model and limits.

**Q15. What limits are required to prevent unbounded queries?**

- **Evidence:** page size ≤ 500; row caps 5k/50k; query timeout; read-only
  connection; async threshold.
- **Decision:** PROPOSED DESIGN — every future report definition must declare
  `pageSize` cap, `rowCap`, `timeoutMs`, `asyncThreshold`, and mandatory scope
  predicates; no report may run an unscoped aggregation.
- **Consequence:** these are definition-metadata requirements the Reporting
  module enforces (reporting-strategy §7); Accounting sources must not
  undermine them.

**Q16. Which values must remain exact Decimal strings in API responses?**

- **Evidence:** Task 17A serializes `debit_amount`/`credit_amount` as canonical
  decimal strings (`canonicalizeAmount`, `renderDecimal`); Task 12 DTOs carry
  `periodDebitAmount`, `periodCreditAmount`, `periodNetAmount`,
  `openingBalanceAmount`, `closingBalanceAmount` as strings; JSON numbers are
  explicitly forbidden for money (`money.ts`/`ledger-movement.ts` comments).
- **Decision:** CONFIRMED BY REPOSITORY. Any money value — turnover, net,
  opening, closing, totals, and any future comparative/total measure — must be
  an exact decimal string. Non-money integers (sequence, lineNo, page) may be
  JSON numbers.
- **Consequence:** the report contract must type money columns as `decimal-string`
  and reject any numeric coercion path.

**Q17. Which data belongs to Accounting and which belongs to Reporting?**

- **Evidence:** domain contract §3.1/§19 — Accounting owns facts and read
  sources/views; Reporting owns definitions, pipeline, permission-per-report,
  export/print delegation; Excel/Print own formatting (ADR-0012;
  reporting-strategy §6). OQ-49 builder depth is separate.
- **Decision:** PROPOSED DESIGN (boundary table in §8, “four layers”), aligned
  with repository architecture.
- **Consequence:** no universal report table, no report-maintained accounting
  snapshot, no export logic inside Accounting report sources.

**Q18. What must remain outside Task 17B because of OQ-25/OQ-43?**

- **Decision:** BLOCKED BY OQ — statutory layouts (journal/ledger/trial-balance
  column sets and 4/6/8-column forms), account classification/sections
  (asset/liability/equity/revenue/expense), control-role vocabulary, temporary-
  account closing, Persian/Jalali statutory presentation, e-ledger export,
  correction-window presentation. Any layout or classification decision is
  excluded; only ledger-native, nature-agnostic, non-statutory semantics are
  specified below.

---

## 8. Report contract design (conceptual, implementation-neutral)

### 8.1 Four distinct layers — never merged

| Layer | Owner | Concern | Governed by |
| --- | --- | --- | --- |
| 1. **Accounting domain read contract** | Accounting | Ledger-native rows and exact turnover/derived balance measures; scope, reconciliation, Decimal strings. | Contract §19, AC-D-30/31, ADR-0031, Task 17A. |
| 2. **Shared Reporting envelope** | Reporting (future) | The generic `ReportResponse<T>` in §8.2: id, version, context, filters, columns, rows, totals, pagination, order, auth, warnings, provenance. | ADR-0009, `reporting-strategy.md`. |
| 3. **Export-specific formatting** | Excel/Print | Column order/labels, number formats, RTL, paper, template — presentation only, never changes money values or scope. | ADR-0012, reporting-strategy §6. |
| 4. **Legal/statutory report profile** | Expert-approved profile | Versioned, validated legal column sets, layout, language, filing obligations. | **OQ-43** (not designed here); `prints`/e-ledger excluded. |

Do not merge these into one document or one report table. A report *definition*
(layer 2) references an Accounting source (layer 1); an export (layer 3) formats
a result; a statutory profile (layer 4) is a separate, versioned,
expert-signed artifact.

### 8.2 Proposed `ReportResponse<T>` shape

> PROPOSED DESIGN — TypeScript-like sketch only; no code file is created.

```ts
interface ReportResponse<T> {
  // Identity + versioning
  reportId: string;            // stable kebab-case id (registry), e.g. "accounting-account-movement"
  reportVersion: string;       // semantic version of the DEFINITION semantics
  generatedAt: string;         // ISO-8601 UTC instant the query executed

  // Context (all mandatory; scope is server-resolved)
  organization: { organizationId: string };
  financialArea: { financialAreaId: string | null; mode: "single" | "all-shaped" | "unset" };
  fiscalPeriod: {
    fiscalYearId: string | null;
    accountingPeriodId: string | null;
    coverage: "single-period" | "period-range" | "year-to-date" | "all-periods" | "unspecified";
    includesClosedSealed: boolean;
  };

  // Applied filters (normalized, echo-only)
  appliedFilters: ReadonlyArray<{
    column: string; operator: string; value: string | number | null; // values always serialized
  }>;
  appliedSort: ReadonlyArray<{ column: string; direction: "asc" | "desc" }>;
  sortIsTotal: boolean;        // MUST be true (unique id tie-breaker enforced)

  // Shape
  columns: ReadonlyArray<ColumnMeta>;   // key, labelKey?, dataType, sortable, groupable, summable
  rows: T[];                           // row type is source-specific (layer 1)
  totals: ReadonlyArray<TotalSpec>;     // only exact-decimal sums declared by the definition

  // Pagination
  pagination: {
    model: "offset" | "cursor";
    page?: number;
    pageSize: number;          // ≤ 500
    total?: number;            // present for offset; may be estimate-only when declared
    nextCursor?: string | null;
    rowCap: number;            // enforced cap (UI 5k / export 50k)
    truncated: boolean;        // true when cap cut the result
  };

  // Ordering metadata
  ordering: { declared: ReadonlyArray<{column:string;direction:string}>; tieBreakers: ReadonlyArray<string> };

  // Data representation
  valueEncoding: { money: "decimal-string"; dates: "date-only-string" | "instant-string" };

  // Partial-result / warnings (never silent)
  warnings: ReadonlyArray<Warning>;
  complete: boolean;           // false when truncated, timed out, or partial scope resolved

  // Source / reconciliation metadata (layer 1 provides; Reporting relays)
  source: {
    module: string;            // "accounting"
    sourceKind: "ledger" | "balance-projection" | "derived-balance" | "composed-view";
    readAsOf: string | null;   // explicit snapshot note if a point-in-time read is ever authorized
  };
  reconcile?: {
    expectation: string;       // e.g. "rows reconcile 1:1 with ledger_entries for the same predicate"
    check: string | null;      // reference to the reconciliation surface/identity used
  };
}

type Warning =
  | { kind: "row-cap"; message: string }
  | { kind: "timeout-approaching"; message: string }
  | { kind: "scope-unset"; message: string }
  | { kind: "density-note"; message: string };   // closed, code-defined list — never free text from SQL
```

Key properties the proposal **mandates**:

- `organization` context and every scope predicate are **server-resolved** and
  mandatory; they are never derived from client hints alone and never depend
  only on a deployment pin.
- `valueEncoding` pins Decimal-string and date-string transport so exports
  (layer 3) cannot reinterpret money as float.
- `warnings` and `complete` make partial results explicit; a report never
  silently returns a truncated or recomputed-perimeter result.
- `reconcile` links the response to the ledger/projection reconciliation
  expectation (AC-I-19); reproducibility is declared, and where a projection
  is the source, its rebuild/generation identity is the explanation for any
  non-reproducibility.

> This is a concept, not code, not a database table, and not a universal
> report container. It does not authorize the Reporting module.

---

## 9. Required reports — minimum future data requirements

Each report below is analyzed **only to bound future requirements**; nothing is
implemented.

### 9.1 Account Movement

- **Purpose:** chronological, one-row-per-posted-entry inquiry for an account /
  ledger / voucher.
- **Source data:** `accounting.ledger_entries` (layer-1 movement source,
  Task 17A read contract extended with the same fields).
- **Dimensions:** organization, financialArea, fiscalYear, accountingPeriod,
  account, voucher (id/number), lineNo, origin, source refs.
- **Measures:** `debitAmount`, `creditAmount` (exact decimal strings); no
  running balance (balances stay layer-1 balance semantics).
- **Filters:** organization (mandatory), area/year/period/account/voucher,
  exact serial, inclusive `documentDate` window; allow-listed.
- **Grouping:** none in the source (grouping is a Reporting concern).
- **Sorting:** default legal-book order (documentDate, voucherNumber, lineNo,
  id); allow-listed `documentDate`/`postingTimestamp` only.
- **Opening/closing:** NOT part of the movement source (running balance and
  opening/closing belong to balance semantics — §19.3 / Task 17A §15 item 3).
- **Reconciliation:** 1:1 with `ledger_entries` over the identical predicate.
- **Permissions:** `Accounting.LedgerMovement.View` today; a future surfaced
  report adds a `Report.<id>.View` per ADR-0009 (REQUIRES OWNER DECISION on
  whether the existing code is reused or a report code is added).
- **Scalability risks:** tenant-wide scan for unfiltered/date-window pages; no
  date-leading index; deep offset sort (measured in Task 17A §14).
- **Unresolved:** reversal-flattening/linkage projection; whether `branch_id`
  is exposed as a filter (it is stored but not a Task 17A filter).

### 9.2 Account Balance

- **Purpose:** per-account, per-period turnover with derived opening/closing.
- **Source data:** `account_balance_projections` + `vw_account_balance_derived`
  (Task 12), reconciled to ledger.
- **Dimensions:** org, area, fiscalYear, period (sequence), account.
- **Measures:** `periodDebitAmount`, `periodCreditAmount`, `periodNetAmount`,
  `openingBalanceAmount`, `closingBalanceAmount` (all decimal strings).
- **Filters:** org (mandatory), area/year/period/account.
- **Grouping:** by account within (area, year); dense option via LEFT JOIN
  periods.
- **Sorting:** `periodSequence` + `accountId` + `id`.
- **Opening/closing:** derived, intra-year only; cross-year carry BLOCKED BY
  OQ (OQ-23).
- **Reconciliation:** projection vs ledger aggregate
  (`vw_balance_reconciliation`; drift = defect surfaced, never report-edits).
- **Permissions:** `Accounting.Balance.View` today; future surfaced report adds
  a report code (REQUIRES OWNER DECISION).
- **Scalability risks:** window function over full year per account; dense
  multi-account materialization; cross-year series must be assembled explicitly.
- **Unresolved:** sparse vs dense default; branch/currency/dimension widening
  (OQ-03/40/41); classification presentation (OQ-25).

### 9.3 Detailed Trial Balance

- **Purpose:** one row per **postable account** showing period turnover and
  derived opening/closing (detailed), in a **non-statutory** shape.
- **Source data:** derived balance view / projection (layer 1).
- **Dimensions:** org, area, fiscalYear, period, account (code/id/title).
- **Measures:** opening debit=0 (debit-nature accounting not authoritative),
  period `debitTurnover`/`creditTurnover`, closing `net` — plus nature-aware
  presentation only if OQ-25 ever authorizes it.
- **Filters:** org, area, year, period range; includeClosedSealed flag.
- **Grouping:** flat per account; NOT classified by asset/liability/… (OQ-25).
- **Sorting:** account code/tree order (or chosen allow-listed key) + id.
- **Opening/closing:** intra-year derived (ADR-0031 §9); no cross-year.
- **Reconciliation:** Σ debit turnover = Σ credit turnover exactly (double-entry
  invariant, AC-I-07) and per-row = ledger aggregates.
- **Permissions:** REQUIRES OWNER DECISION (new report code vs balance view
  code).
- **Scalability risks:** many-account materialization; dense periods; page size
  vs whole-sheet export divergence (UI 5k vs export 50k).
- **Unresolved:** 4/6/8-column statutory layout (BLOCKED BY OQ-43); zero-row/
  no-movement density; hierarchy rollup vs flat leaf set.

### 9.4 Summary Trial Balance

- **Purpose:** rollup of account balances, likely at a chosen tree level
  (group/general), in a **non-statutory**, classification-neutral shape.
- **Source data:** same as detailed, aggregated by an account-tree group key
  (§8.5: parent movement = rollup of descendants; never sum a parent with its
  children — no double counting).
- **Dimensions:** org, area, fiscalYear, groupKey (account-tree node), period.
- **Measures:** aggregated debit/credit turnover + derived net.
- **Filters/Grouping/Sorting:** group by tree node; order by code/tree.
- **Opening/closing:** intra-year only.
- **Reconciliation:** rollup sums equal leaf ledger aggregate sums (rollup
  identity).
- **Permissions:** REQUIRES OWNER DECISION.
- **Scalability risks:** recursive rollup cost; pre-materialized path could
  help but is a future projection (schema header §8.2) — not part of this task.
- **Unresolved:** **control-role** grouping (accounts → roles) is OQ-25; the
  classification that makes a summary a real “statement” is absent by design.

---

## 10. Security and data-integrity verification matrix

| Requirement | Verdict / evidence |
| --- | --- |
| `organizationId` mandatory for every future read | REQUIRED (proposal) and already enforced in both existing read paths (`listMovements`, balance reads). CONFIRMED BY REPOSITORY. |
| Tenant isolation cannot depend only on the deployment pin | CONFIRMED BY REPOSITORY — pin is an *additional* assertion; structural `organization_id` predicates + 404 posture are the isolation (ADR-0025; AC-I-01/16). |
| Cross-organization reads impossible | CONFIRMED BY REPOSITORY for current sources (predicates lead with scope; e2e `never returns another organization’s movements`); extended to future sources as a hard requirement (AC-I-16). |
| Financial-area scope enforced | CONFIRMED BY REPOSITORY structurally (stored `financial_area_id`, 404 posture); as *authorization* (user grants) BLOCKED BY OQ-40. |
| Permissions distinct from license/entitlement | CONFIRMED BY REPOSITORY — RBAC granular codes (ADR-0016/0022/0026 §4) are separate from license (ADR-0030 proposed, enforcement OFF, OQ-45). |
| Decimal precision preserved | CONFIRMED BY REPOSITORY (`numeric(18,2)` + decimal-string transport; `money.ts` exact BigInt arithmetic). |
| No floating-point calculations | CONFIRMED BY REPOSITORY for existing Accounting; REQUIRED for all future report sources. |
| No arbitrary SQL fragments | CONFIRMED BY REPOSITORY posture (parameterized Prisma/values; ADR-0009 whitelists identifiers; reporting-strategy §3). |
| Filters and sorting allow-listed | CONFIRMED BY REPOSITORY (Task 17A sort whitelist + tie-breakers; balance `LIST_SORTABLE`). |
| Pagination bounded | CONFIRMED BY REPOSITORY (`MAX_PAGE_SIZE=500`; row caps 5k/50k). |
| Deterministic ordering mandatory | REQUIRED (proposal) — total order with unique tie-breaker (§7 Q13). |
| Read models must not become a second source of truth | CONFIRMED BY REPOSITORY (movement = ledger row; projection rebuildable + reconciliation; AC-I-19). |
| Report output reproducible or explained | REQUIRED (proposal) — `readAsOf`/`reconcile` + `generatedAt`; ledger-movement output reproducible; projection-backed output reproducible given rebuild state (documented). |
| Auditability requirements for future exports | REQUIRED (proposal), delegated to Reporting/Excel/Print + Audit/Jobs (ADR-0009/0012; AR-17/23); export execution and download must be permission-gated and auditable. |

---

## 11. Scalability concerns

1. **No date-leading index on `ledger_entries`** — date-window and unfiltered
   pages are tenant-wide scans + top-N sorts (Task 17A §14 evidence). A future
   date-range-heavy report needs a measured index decision (future task, not
   here).
2. **Deep OFFSET paging** externalizes sorts at depth; keyset pagination should
   be considered for movement paging (proposal).
3. **Dense trial balance** materializes one row per account × period; row caps
   and async escalation must be inherited from reporting-strategy §7.
4. **Hierarchy/summary rollups** recompute the tree per query unless a future
   rebuildable path projection is added (§8.2 seam — a reporting task, gated by
   AR-29/its own ADR if it ever materializes).
5. **Projection reads** are index-served for (org, area, year) and (org,
   account) and (org, period); cross-year series must be assembled in code and
   are unbounded across many years — cap + timeout mandatory.
6. All of the above are **future measurement obligations**; no index,
   migration, or view is added by this task.

---

## 12. Reconciliation requirements (for every future surface)

- Movement rows must reconcile **1:1** with `ledger_entries` over the same
  predicate (Task 17A precedent).
- Balance/trial-balance results must reconcile with the ledger projection
  aggregates; a mismatch is a **defect surfaced** via
  `vw_balance_reconciliation`/`Accounting.Balance.Rebuild`, never a
  report-side edit (AC-I-19).
- Σ debit = Σ credit **exactly zero tolerance** over any closed scope (the
  double-entry invariant, AC-I-07) is a first-line integrity assertion for
  trial-balance surfaces (whenever the scope is scoped to complete documents).
- Time-movement integrity: chronological order follows `document_date` +
  voucher serial; the posting act stays measurable through `posting_timestamp`
  (Class C3 — never conflated).

## 13. Dependency analysis

Consumed (must remain true): Tasks 10.x ledger/document/calendar foundations;
Task 11 (ACCEPTED); Task 12 balance projection (**ACCEPTED WITH FOLLOW-UP**;
ADR-0031 Proposed; P1 real-PG concurrency open and **not** absorbed);
Task 15 reversal foundation (migration present); Task 17A (ACCEPTED) read
source + `Accounting.LedgerMovement.View`; ADR-0009 / reporting-strategy
(Accepted baseline); ADR-0026 / domain contract §19 (AC-D-30/31).

Not-yet-available (and not created here): a shared Reporting module
(registry/execution/limits/read-only role); `Report.<id>.View` registry;
Excel/Print pipelines wired to Reporting; any statutory profile.

Respect-and-do-not-touch: Task 13 (IN PROGRESS), Task 14 (READY FOR REVIEW —
NOT ACCEPTED; ADR-0032 Proposed), Task 16 (BLOCKED — OWNER CONFIRMATION), and
all Open Questions (OQ-03/23/25/27/31/40/41/42/43/49, 62/63).

## 14. OQ-25 / OQ-43 impact

- **OQ-25** gates classification (`account_type`/`is_temporary`/control roles)
  and statutory/statement **layouts**. Consequence for Task 17B: only
  nature-agnostic, ledger-native semantics are specified; no asset/liability/
  equity/revenue/expense rule, no control-role summary, no statement section.
  **Remains OPEN.** *(CONFIRMED BY REPOSITORY — registry row.)*
- **OQ-43** gates Iranian statutory/legal profiles (legal books, timing,
  language/currency, no-deletion, branch obligations, Art. 169, retention).
  Consequence: no legal column set, no 4/6/8-column form, no e-ledger, no
  statutory ordering is designed. **Remains OPEN.** *(CONFIRMED BY REPOSITORY —
  registry row.)*
- Neither OQ is resolved, reclassified, or given a fabricated interim answer by
  this investigation. Any future implementation still requires, per Task 17
  gates: OQ-25/OQ-43 resolution **or** an owner-recorded bounded interim posture
  for the exact slice, then owner authorization.

## 15. Unresolved questions (raised by this investigation, not newly numbered)

These are **narrow Owner-decision questions**, recorded for the brief; none is a
new registered OQ and none pre-empts the registry:

1. (**Q5**) Per-class balance presentation given `account_type` is absent —
   confirm the nature-agnostic `debitTurnover`/`creditTurnover`/`net` slice as
   the only permitted balance semantics until OQ-25.
2. (**Q11/Q12**) Sparse vs dense default for balance/trial-balance surfaces.
3. (**Q14/Q15**) Offset vs keyset pagination for movement sources, and report
   row-cap/timeout defaults per surface.
4. (**Q17/§9**) Permission model for surfaced reports: reuse `Accounting.Balance.View` /
   `Accounting.LedgerMovement.View` or introduce `Report.<id>.View` codes with
   the future Reporting module.
5. (**Q9/Q10**) Whether any non-statutory report requires a “present
   net-of-reversal” or “include closed/sealed periods as-of” switch, and who
   approves its default.
6. Whether the `ReportResponse<T>` envelope and the four-layer boundary are
   adopted as the contract for the future Reporting module.

## 16. Recommended next step

1. **Owner review of this investigation and the brief** (decision list in brief
   §6).
2. **Do not implement.** The next implementation slice (brief §2) remains gated
   by OQ-25/OQ-43 postures **or** an explicitly approved interim scope, exactly
   as Task 17 `brief.md` §7 requires.
3. If a bounded slice is authorized later, the first candidate is an
   **Accounting-owned, non-statutory account-movement and intra-year
   balance/turnover read contract** (layer 1 only), consumed by the (separately
   authorized) Reporting module — not a report UI, not export, not print, not
   statements.

Any capability this analysis found missing (classification, cross-year carry,
statutory profiles, Reporting module, export/print pipelines, e-ledger, dense
trial-balance views) is recorded as a **future task subject to its own gate**,
not started here.

## 17. Explicit implementation boundary

Everything beyond (a) this document, (b) the brief, and (c) justified
status/index documentation is **prohibited** by this task. That boundary
covers: production code; endpoints; services; repositories; projections;
materialized views; migrations or indexes; new permissions in code; report
builders; generic Report Builder (OQ-49); XLSX/CSV; PDF/print; frontend;
electronic books; statutory/statement implementation; AR/AP; cash flow;
workflow/rules engine; universal report tables; EAV/JSONB; microservices;
Redis/infrastructure. If any of those appears necessary, it is documented as a
future task (§16).

## 18. Verification performed (documentation-only)

- `git log -1` = `3322293` (PR #40 merge), confirming the documented baseline.
- All referenced paths exist under the tree (checked via filesystem listing):
  `backend/prisma/schema/accounting.prisma`; migrations
  `20260922000000_accounting_balance_projection` and
  `20260923000000_accounting_document_reversal`; domain files
  `money.ts`, `ledger-movement.ts`, `balance-projection.ts`, `account.ts`,
  `account-code.ts`, `fiscal-year.ts`, `accounting-period.ts`,
  `accounting-permissions.ts`; services/controllers/DTOs
  `ledger-movements.service.ts`, `accounting-balances.service.ts`,
  `accounting-ledger-movements.controller.ts`, `ledger-movement.dto.ts`,
  `account-balance.dto.ts`; kernel `page-query.dto.ts`, `paginated-result.ts`;
  docs `domain-contract.md`, `reporting-strategy.md`, `modules.md`,
  `open-questions.md`, ADRs 0009/0012/0025/0026/0031/0032, task-17 files.
- ADR and OQ references verified: ADR-0009 (Accepted), ADR-0012 (Accepted),
  ADR-0025 (Accepted), ADR-0026 (Accepted), ADR-0031 (Proposed), ADR-0032
  (Proposed); OQ-25, OQ-43 remain OPEN in `docs/open-questions.md`.
- No production file, schema, migration, or dependency is changed (`git diff`
  limited to `docs/`).
- No status is falsely marked ACCEPTED: Task 17A kept ACCEPTED (owner record),
  Task 17 kept FORMALIZED/BLOCKED, this task marked READY FOR REVIEW only.
- No runtime tests are claimed, and none were run — this is a
  documentation-only task (`git diff --check` is the applicable gate).
