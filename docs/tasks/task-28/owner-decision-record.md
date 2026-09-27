# Task 28 — Owner Decision Record

**Audited `main` HEAD Commit:** `ff4b9f24d1c3797712c88fcd61432c3c315dbf4f` · **Date:** 2026-09-27 ·
**Status:** READY FOR REVIEW — NOT ACCEPTED

> **Governing Rule (STATE.md §1/§6):** The Agent does not fabricate Owner decisions or manufacture acceptance.
> Where explicit Owner decisions have not yet been recorded in the repository, this record strictly marks them as `PENDING OWNER DECISION`.
> Owner decisions that have been explicitly provided by the Owner are recorded as `DECIDED` (2026-09-27 follow-up: OD-27-02, Decision 1 below).

---

## Decision Summary

**Update (2026-09-27, Task 28 follow-up):** The Owner has explicitly decided **OD-27-02** (Base Chart / OQ-25 — MVP scope boundary): **DECIDED — MVP requires the Base Chart mechanism, but does not require a concrete Base Chart content set.** The full decision is recorded in Decision 1 below. This decision records an MVP scope boundary only: it authorizes no implementation, closes no OQ (OQ-25 remains OPEN for content-level decisions), changes no production code, and leaves Task 23 (mechanism) and Task 21 (accepted governance baseline) intact.

All remaining decision areas — OD-27-01, OD-27-03, OD-27-04 (identified by Task 27), along with supporting domain decisions (OD-28-01 through OD-28-06; OQ-36, OQ-39, OQ-42, OQ-24, OQ-30, OQ-43) — remain in state **`PENDING OWNER DECISION`**.

No production implementation capability is authorized to proceed without explicit Owner resolution.

---

## Decision 1 — Base Chart / OQ-25

### Current Evidence
1. The **Base Chart mechanism** is fully implemented and tested in `main` (Task 23, PR #66). It provides complete versioning, template hierarchy, and explicit organization adoption via `POST /api/v1/accounting/adopt-base-chart`.
2. The **Base Chart content** contains **0 rows** across all 17 migrations and repository seeds. No default chart accounts (Asset, Liability, Equity, Revenue, Expense) or account codes are packaged in the codebase.
3. The four structural invariants are preserved:
   - **Template identity ≠ Ledger identity:** Template nodes in `accounting.base_chart_template_nodes` are copied into organization `accounting.accounts`. Ledger entries reference only `Account.id`.
   - **Adoption = Copy:** Adoption creates organization-owned copies. Later template updates do not mutate existing organization accounts.
   - **Posting = Leaf-only:** Posting is strictly limited to leaf accounts (`isPostable = true`, no child accounts).
   - **Aggregation = Read-time:** Parent account balances are computed on-the-fly during read queries.
4. `docs/open-questions.md` registers **OQ-25** as **OPEN** (substantially narrowed by Tasks 20 and 21, but content values and control-role catalog remain open).
5. Task 21 §10 records three OQ-36 prerequisites for adoption: code reuse policy, deletion eligibility for unused adopted accounts, and code history coexistence.

### Decision Required
Owner and accounting domain authorization of:
1. Standard Iranian SME chart account structure (Level 1 Group, Level 2 General/Kol, Level 3 Subsidiary/Moein, Level 4 Detail/Tafsili).
2. The specific account codes, Persian titles, account natures (DEBIT / CREDIT / EITHER), and default leaf postability flags.
3. Authorization to load this content artifact into template tables through the Task 23 API mechanism (Phase 1A).

*(Historical note: items 1–3 above remain undecided — the 2026-09-27 decision below decides only the MVP scope boundary between mechanism and content.)*

### Owner Decision

**`DECIDED` (2026-09-27 — Task 28 follow-up, explicit Owner Decision)**

> **DECIDED — MVP requires the Base Chart mechanism, but does not require a concrete Base Chart content set.**

**1. The MVP shall provide and retain the Base Chart mechanism**, including:
- Base Chart template model
- versioned template lifecycle
- Draft → Approved → Published → Superseded lifecycle
- organization adoption semantics
- adoption by copy, not live reference
- immutable published-version semantics
- no silent mutation of an adopted organization chart when the template changes
- partial-adoption governance already established by Task 21
- separation between:
  - Base Chart Template
  - organization-owned accounts
  - ledger identity
- leaf-only posting invariant
- read-time/report-time aggregation

**2. Explicit MVP boundary.** For MVP, DO NOT introduce a concrete standard Base Chart content set merely by implementation inference. Specifically, do NOT invent or seed:
- standard account codes
- Persian account titles
- account natures
- mandatory-account list
- concrete control-role catalog
- statutory account requirements
- assumed Iranian accounting chart content

No migration or seed should introduce such content unless a separately approved content artifact exists.

**3. Meaning of the decision.** **Base Chart mechanism = MVP. Concrete Base Chart content = NOT MVP-required.** This does NOT mean Base Chart functionality is removed or deferred. The product must be capable of supporting a Base Chart, while the actual accounting content remains organization/domain-owner controlled until an explicit approved content artifact is provided.

**4. OQ-25 handling.** OQ-25 is NOT fully resolved. Its MVP-scope question is now decided, while the following content decisions remain explicitly open unless already resolved elsewhere: concrete Base Chart content values; concrete account codes; Persian titles; account natures; the mandatory-account set; the concrete control-role catalog/mandatory set; and any other content decisions already identified by Task 21 as unresolved. All existing OQ-25 history is preserved; no historical decision is overwritten.

**5. Task 23 / Task 21 treatment.** This decision does NOT reinterpret Task 23 or Task 21. Task 23 remains the implementation of the Base Chart mechanism. Task 21 remains the accepted governance baseline for Base Chart structure and adoption semantics. This decision only establishes the MVP boundary between (1) mechanism/capability and (2) concrete accounting content.

### Consequence
- Base Chart **mechanism** is confirmed as MVP scope (implemented and merged via Task 23; its formal acceptance remains a separate matter under OD-27-01).
- Base Chart **content** loading (Phase 1A) remains **BLOCKED** until a separately approved content artifact exists; no content may be introduced by implementation inference, and no migration or seed may introduce content without such an artifact.
- **OQ-25 remains OPEN** — only its MVP-scope sub-question is decided; all content-level decisions (codes, Persian titles, natures, mandatory-account set, control-role catalog/mandatory set, other Task 21 unresolved content items) remain open.
- Tenant organizations continue to construct custom charts manually or to await a future approved standard chart artifact.
- Downstream automated posting rules (Phase 1G / Phase 4) continue to require the remaining OQ-25 content decisions (concrete control-role catalog/mapping) before being wired to concrete accounts.

---

## Decision 2 — Next Implementation Direction

### Current Evidence
1. **Foundation & Security:** Fully established on `main`. Task 26 / PR #71 remediated SEC-01 across all 37 organization-scoped read surfaces. PR #72 provisioned the default system administrator organization membership (ADR-0038 Proposed). Global `DeploymentOrganizationScopeGuard` is verified active as `APP_GUARD`.
2. **Accounting Core:** Fully established on `main`. Vouchers, atomic posting, immutable ledger entries, turnover balance projection (Task 12), period close enforcement (Task 14), document reversal (Task 15), four bounded read queries (Tasks 17A, 17B, 18), configuration coherence (Task 19 ODR-1), chart tree (Task 19 ODR-2), and Base Chart adoption mechanism (Task 23) are all merged and green in CI.
3. **Inventory Core:** Movement ledger, balances, reservations, and transfers are established (ADR-0022). Operational warehouse documents (Material Request, Receipt, Issue) and valuation flows remain pending.
4. **Sales & Integrations:** `sales` module does not exist; integration event bus lacks consumer and durable outbox.
5. **Candidate Analysis:** Four distinct candidate tracks have been evaluated:
   - **Candidate Track 1 (Phase 1A):** Base Chart Content Loading & Adoption.
   - **Candidate Track 2 (Phase 3A/3C):** Full Inventory / Warehouse Operational Subsystem Investigation Gate.
   - **Candidate Track 3 (Phase 2A):** Reporting Foundation & Code-Defined Report Registry Design Gate.
   - **Candidate Track 4 (Phase 6.2/6.3):** Audit Module & Identity Session Management Specification Gate.

### Decision Required
Owner selection and explicit authorization of which candidate track shall form the next active task brief.

### Owner Decision
`PENDING OWNER DECISION`

### Consequence
- The repository state remains in **`IMPLEMENTATION BLOCKED — OWNER DECISION REQUIRED`**.
- No Agent is authorized to implement production code on any candidate track until the Owner selects the track and issues the approved prompt.

---

## Decision 3 — ADR Status

### Current Evidence
1. There are **37 ADR files** in `docs/adr/` (ADR-0027 is a deliberate non-existent gap).
2. **22 ADRs are Accepted:** ADR-0001 through ADR-0016, ADR-0022, ADR-0023, ADR-0024, ADR-0025, ADR-0026, ADR-0028.
3. **8 ADRs are Proposed but Implemented on `main`:**
   - `ADR-0017` (Inventory Ledger as Source of Truth) — Implemented in Task 9.5
   - `ADR-0018` (Bounded, Versioned Workflow) — Implemented in Task 9
   - `ADR-0019` (Document Foundation and Relations) — Implemented in Task 8
   - `ADR-0020` (Organizational Scope and Master Data) — Implemented in Task 6 / 19
   - `ADR-0021` (Organization-Scoped Master Data) — Implemented in Task 6 / 19
   - `ADR-0031` (Accounting Balance Projection) — Implemented in Task 12
   - `ADR-0032` (Accounting Period Close Enforcement) — Implemented in Task 14
   - `ADR-0038` (Installation Bootstrap of Pinned Deployment Organization) — Implemented in PR #72
4. **7 ADRs are Proposed and Not Yet Implemented:** ADR-0029, 0030, 0033, 0034, 0035, 0036, 0037.

### Decision Required
Owner decision whether to formally promote the 8 implemented ADRs to `Accepted` in repository documentation.

### Owner Decision
`PENDING OWNER DECISION`

### Consequence
- ADR statuses in `docs/adr/` remain verbatim `Proposed`.
- Task reconciliation documents record that the underlying capabilities are implemented and tested, without altering ADR registry files ahead of Owner action.

---

## Decision 4 — Other Blocking Decisions

### Current Evidence
1. **Durable Integration Semantics (OQ-39):** In-memory event bus exists, but cross-module transactions and durable outbox persistence (`sync.outbox_events`, worker dispatch) are not implemented.
2. **Posting Mode Policy (OQ-42):** Voucher lifecycle supports `draft`, `temporary`, and `final`, but default posting mode for automated source events is undecided.
3. **Inventory Costing & Valuation (OQ-24 / OQ-11):** No valuation engine (FIFO, Moving Average) exists on `main`.
4. **Sales Tax & Invoice Model (OQ-30 / OQ-38):** No sales tax engine, VAT tables, or detailed customer contact models exist.
5. **Iranian Statutory Book Specifications (OQ-43):** Statutory Journal Book and General Ledger formats are not yet finalized.

### Decision Required
Owner and domain decisions for each respective area prior to opening their implementation gates.

### Owner Decision
`PENDING OWNER DECISION`

### Consequence
- Cross-module system posting (Phase 4), Sales module implementation (Phase 3B), and Electronic Books (Phase 2B / C-37) remain gated behind their respective domain decisions.
