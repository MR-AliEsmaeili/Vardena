# Vardena — MVP Scope Proposal v1

## Document metadata

| Field | Value |
|---|---|
| Document ID | MVP-SCOPE |
| Version | 1.0 (proposal) |
| Status | **Proposed — pending product-owner approval** |
| Owner | Ali Esmaeili |
| Created | 2026-09-22 |
| Derived from | PB-BASELINE v1 (`product-business-decision-baseline-v1.md`), OQ-44…OQ-61, ADR-0029/0030 (proposed) |
| Related | `development-roadmap-v1.md` · `docs/open-questions.md` · `docs/decisions/product/README.md` · `docs/accounting/task-index.md` |

> This is a **proposal**. Nothing here is approved scope until the product
> owner ratifies it together with the Stage-0 gate decisions (OQ-49 Report
> Builder depth, OQ-60 acceptance thresholds, ADR-0029/0030 ratification).

## 0. Scope test and classification

A feature belongs in MVP **only** if it satisfies at least one of:

- **T1** — required by the reference business scenario (PB-BASELINE §16);
- **T2** — a required platform foundation;
- **T3** — a legal/compliance necessity;
- **T4** — explicitly confirmed by the owner as MVP-critical.

Classifications used below: **A** must be operational in MVP · **B** platform
foundation (present, not necessarily user-facing) · **C** explicitly excluded ·
**D** dependent on unresolved decisions · **E** candidate for post-MVP.

Statuses: `Shipped` (exists in repo today), `Partial` (exists, gaps listed),
`To build`, `Blocked by OQ`.

## 1. Reference scenario coverage map

| Scenario step | Covered by | Status |
|---|---|---|
| Login | Identity (ADR-0007) | Shipped |
| Define company | Organization module (ADR-0020/0021/0025) | Shipped |
| Define fiscal year | Accounting fiscal years/periods (Task 10.2) | Shipped |
| Configure system | Organization config + accounting configuration (ADR-0028) | Shipped (foundation) |
| Define accounting coding structure | Coding structure versions + levels (Task 10.3, ADR-0028) | Shipped |
| Define accounts and details | Chart of accounts (Task 10.3); "details" = detail dimensions (**OQ-41 open** — manual detail-item dimension may be deferred; account tree alone satisfies the scenario) | Shipped / D (OQ-41) |
| Define products and units | Inventory items + units (OQ-29 conversion rules) | Shipped (foundation) / gaps in Stage 3 |
| Enter opening inventory | Inventory receipt with opening flag / opening-balance flow (OQ-11 opening-balance rule for accounting) | Partial — Stage 3 |
| Register warehouse receipt | Inventory receipts (ADR-0017/0022) | Shipped (core) |
| Register warehouse issue | Inventory issues (ADR-0017/0022) | Shipped (core) |
| Register sale | Sales documents (parties, invoice minimal set) | To build — Stage 4 |
| Generate accounting entry | Manual voucher path Shipped (Tasks 10.4–10.8); **system-posted sale→journal is blocked by OQ-39/OQ-42** (durable delivery + posting mode) — MVP fallback: manual voucher entry by the accountant | Shipped (manual) / D (OQ-39, OQ-42) |
| Finalize accounting document | Voucher `draft→temporary→final` + atomic posting + ledger (Task 10.4–10.8) | Shipped |
| Inventory reports | Reporting pipeline + inventory views (ADR-0009) | Partial — Stage 5 |
| Sales reports | Reporting pipeline + sales views | To build — Stage 5 |
| Profit and loss report | Accounting balances + reports — **blocked by OQ-25 (layouts) and OQ-43 (statutory) in minimal form**; minimal revenue/expense/caption P&L over ledger entries is the proposed MVP interpretation | To build — Stage 5 / D (OQ-25, OQ-43) |
| Create a custom report | Report Builder — **depth = OQ-49** | D (OQ-49) |

**Interpretation rule (recorded, not assumed):** where an OQ blocks a step's
"full" form, the MVP proposal includes the *minimal decided mechanism* (e.g.
manual voucher instead of automatic posting) and registers the dependency —
it does not invent the unresolved behavior.

---

## 2. Category A — Must be operational in MVP

| Feature ID | Feature name | Status | Business value | Dependencies | Acceptance criteria (MVP) | Open decisions | Risk |
|---|---|---|---|---|---|---|---|
| A-01 | Login / session management | Shipped | Entry gate; security | ADR-0007 | Login, logout, lockout, revocation per security.md; denial tests | None | Low |
| A-02 | Organization & company setup | Shipped | Multi-company scenario step 2 | ADR-0020/0021/0025 | Create organization; deployment pin works; org-scoped data isolation tests pass | OQ-01 posture (single-org deployment) stands | Low |
| A-03 | Fiscal year & period management | Shipped | Scenario step 3; accounting basis | Task 10.2; ADR-0026 | Create year (dates), periods; state transitions permission-gated; stored resolution | OQ-23 (policy: year-start/layout defaults) — mechanism sufficient for MVP | Low |
| A-04 | Accounting configuration (levels & coding structure) | Shipped | Scenario steps 4–5 | ADR-0028; Task 10.3 | Define levels/digit lengths; single ACTIVE config; freeze after operational use (caller lands with posting task) | None beyond ADR-0028 | Low |
| A-05 | Chart of accounts | Shipped | Scenario step 5 | ADR-0028; Task 10.3 | Account tree create/edit/deactivate; postable-leaf rule; unique codes; version isolation | OQ-25 (control roles/mandatory accounts) — chart works without them for MVP | Medium |
| A-06 | Accounting vouchers (manual) | Shipped | Scenario steps 11–12 core | Tasks 10.4–10.8 | Voucher CRUD draft→temporary→final; balanced lines; numbering via Document Foundation; immutable final; corrections per current contract | OQ-12 (numbering policy), OQ-27 (correction windows) — mechanisms sufficient | Medium |
| A-07 | Posting & ledger | Shipped | Scenario step 12 | Tasks 10.5–10.8 | Posting readiness; atomic finalize; one ledger entry per line; idempotent | OQ-39/OQ-42 gate only *system* posting, not manual | Medium |
| A-08 | Items & units (products) | Partial | Scenario step 6 | Inventory core; OQ-29 | Item CRUD with kinds/capabilities; unit definitions; conversions with rounding rules | OQ-29 (precision/rounding sign-off), OQ-33 (kind list) — gap tasks in Stage 3 | Medium |
| A-09 | Warehouses & branches (scope) | Shipped (foundation) | Scenario step 6 | ADR-0022; OQ-22 posture | Warehouse CRUD; branch assignment; branch-scoped availability | OQ-22 final wording stands | Low |
| A-10 | Opening inventory entry | To build | Scenario step 7 | A-08, A-09, A-22 | Opening receipt flow producing correct stock-on-hand with cost | OQ-24 (costing method) affects cost capture; opening *accounting* balances = OQ-11 | Medium |
| A-11 | Warehouse receipts | Shipped (core) | Scenario step 8 | ADR-0017/0022 | Receipt → ledger movement; availability update; validation; negative stock rejected by default | OQ-24 (default policy confirmed) | Low |
| A-12 | Warehouse issues | Shipped (core) | Scenario step 9 | ADR-0017/0022 | Issue with stock validation; cost capture (method per OQ-24) | OQ-24 | Medium |
| A-13 | Parties (customers) | Shipped (foundation) | Sales prerequisite | organization.parties | Party CRUD customer/supplier flags | OQ-38 (legal identifiers for e-invoice later) — MVP works without | Low |
| A-14 | Sales documents (minimal set) | To build | Scenario step 10; revenue | A-08, A-13; document foundation (ADR-0019/0023) | Customer invoice (order optional): lines, quantities, prices, per-line tax snapshot fields, document numbering; state machine per OQ-54 outcome | OQ-30 (tax fields shape), OQ-34 (pricing), OQ-35 (credit — warning only), **OQ-54 (cancel/edit policy)** | High |
| A-15 | Sales document print | To build (minimal) | Practical usability | ADR-0012 print system | One printable invoice template | OQ-02 (labels/locale) | Low |
| A-16 | Inventory reports | Partial | Scenario step 14 | Reporting pipeline; inventory views | Stock on hand, movements, availability by warehouse — view regression tests | None blocking | Low |
| A-17 | Sales reports | To build | Scenario step 15 | Reporting pipeline; sales views | Sales by period/customer/item; totals reconcile to invoices | OQ-30 (tax columns) | Medium |
| A-18 | Profit & loss report (minimal) | To build | Scenario step 16; accounting credibility | A-07 ledger; balances candidate | Revenue/expense caption report over ledger entries for a period; balances projection per accounting task-index candidate | **OQ-25/OQ-43 (caption/layout minimal form)** | High |
| A-19 | Report Builder (MVP depth) | Blocked by OQ | Scenario step 17; differentiator | OQ-49; reporting pipeline; semantic-entity registry | Level per OQ-49 outcome (recommended B: composition over approved entities; saved, versioned, permission-bound) | **OQ-49** | High |
| A-20 | Dashboard | To build | Usability; situational awareness | Reporting pipeline; customization module (ADR-0013) | Default dashboard: a few KPI/report widgets; user-configurable layout persisted | None | Low |
| A-21 | Excel import (master data) | Shipped (foundation) | Migration onboarding | ADR-0011 | Validated import for items/parties at minimum | None | Low |
| A-22 | Excel export | Shipped (confirmed) | Data ownership; reporting | ADR-0009 §6 | Export of all MVP reports/lists | OQ-46 (beyond-MVP completeness) | Low |
| A-23 | Audit logging (MVP surface) | Shipped (foundation) | Trust; security | AR-23 | Sensitive MVP actions audited (auth, RBAC, accounting writes, inventory movements, sales lifecycle, exports of flagged reports) | OQ-17 (retention values) | Low |
| A-24 | Backup/restore (customer-visible) | To build | Data safety; trust | database-strategy §14; OQ-52/53 | Scheduled auto-backup; customer-admin "backup now"; controlled restore path; **pre-migration auto-backup wired into update flow** | OQ-52 (targets), OQ-53 (self-service degree) | High |
| A-25 | License foundation (enforcement-off) | Blocked by ADR | PD-17 platform capability | **ADR-0030 (proposed)** | License record + module enablement read + admin view; **no blocking behavior** | **ADR-0030 ratification; OQ-45 (behavior)** | Medium |
| A-26 | Persian-context UX baseline | To build | Non-specialist usability | OQ-02 | RTL layout; i18n dictionary; Jalali display where OQ-02 decides; Persian labels | **OQ-02 (language/calendar)** | Medium |
| A-27 | Security hardening pass | To build | Release qualification | AG-06/AG-13 | Denial-path tests for every MVP endpoint; session lifecycle tests; rate limits configured; security review done | None | Medium |

**Operational modules in MVP:** Accounting (A-03…A-07, A-18), Inventory
(A-08…A-12, A-16), Sales (A-13…A-15, A-17), Reporting/Report Builder
(A-16…A-19, A-20).

## 3. Category B — Platform foundation (present, supporting)

| Feature ID | Feature name | Status | Notes |
|---|---|---|---|
| B-01 | RBAC (roles, granular permissions, enforcement) | Shipped | ADR-0006/0016; every MVP endpoint declares permissions |
| B-02 | Document Foundation | Shipped | ADR-0019/0023 — numbering, relations, states used by vouchers & sales |
| B-03 | Workflow Foundation | Shipped | ADR-0018/0024 — available for approval policies when OQ-13/OQ-26 decide content |
| B-04 | Integration foundation (outbox + adapter ports) | Shipped | ADR-0004; taxpayer/legacy adapters land later behind it |
| B-05 | Jobs (DB-backed queue) | Shipped | ADR-0010 — carries async reports, backup schedules |
| B-06 | Notifications (in-app) | Shipped (foundation) | Per OQ-15 interim posture |
| B-07 | Customization (preferences) | Shipped | ADR-0013 — table/grid/dashboard state |
| B-08 | Print system | Shipped (foundation) | ADR-0012 — invoice template rides on it |
| B-09 | OpenAPI contract | Shipped | ADR-0014 — frontend types derived |
| B-10 | Docker Compose deployment | Shipped (strategy) | architecture.md §10; install runbook is Stage 6 work |
| B-11 | Licensing *record* (foundation) | Blocked by ADR | ADR-0030 — see A-25 (foundation is both A and B; enforcement is neither) |
| B-12 | Machine/API access (foundation) | Blocked by ADR | ADR-0029 — schema/mechanism may land post-MVP; MVP UI does not need it. Kept in B so license/API activation reads one coherent model |

## 4. Category C — Explicitly excluded from MVP

| Feature ID | Item | Reason for exclusion | Revisit |
|---|---|---|---|
| C-01 | Purchasing module | Post-MVP (OQ-16 posture: manual receipts cover the gap) | Stage 7 |
| C-02 | Payroll / HR | Future module (OQ-32) | Post-MVP |
| C-03 | Taxpayer System submission/adapter | Release boundary OQ-51; only document-model readiness (tax fields, ids, correction links) is in MVP via A-14 | Stage 4 |
| C-04 | Multi-device offline sync | OPEN/HIGH complexity — excluded (OQ-44) | OQ-44 |
| C-05 | Multi-currency operations (revaluation, FX P/L, currency reporting) | Single-currency MVP; seams dormant (OQ-47/OQ-48) | Stage 7 |
| C-06 | Public API program & webhooks | ADR-0029 mechanism only; no webhooks/public program (OQ-50) | Stage 7 |
| C-07 | Marketplace / third-party extensions | Deliberately unfinalized (OQ-57) | Post-MVP |
| C-08 | SaaS / multi-tenant hosting | Architectural possibility only (PB §9) | Strategic review |
| C-09 | CRM / ticketing products | Separate tools initially (OQ-61) | Stage 8 |
| C-10 | Two-book accounting | Separately analyzed (OQ-56) | Post-MVP |
| C-11 | Branch cost-center accounting / allocation engine | Deferred (OQ-55; allocation engine rejected in domain analysis) | Stage 7 |
| C-12 | Multi-branch advanced capabilities (branch-level approval routing, branch P&L) | Directional only (PB §20) | Stage 7 |
| C-13 | guided onboarding/help content | Optional polish (PB §25) | Post-MVP |
| C-14 | Scheduling & delivery of reports | Vision item (PB §17.1), not scenario-required | Post-MVP |
| C-15 | Consolidation across installations | Deferred (OQ-31/OQ-59) | Strategic |
| C-16 | Customer impersonation / support "login as" | **Prohibited in v1** (PB §22) | Only via explicit future decision |
| C-17 | License enforcement (blocking) | Not until OQ-45 decides behavior | Stage 8 |
| C-18 | Legacy (FaraPayam) adapter | Contract unknown (OQ-04); bootstrap import remains a manual data-migration task per integrations.md §6 | On demand |

## 5. Category D — Dependent on unresolved decisions (in-MVP items whose *form* is not final)

| Feature ID | Item | Depends on | MVP fallback (if unresolved at build time) |
|---|---|---|---|
| D-01 | Sale → accounting entry (system posting) | **OQ-39** (durable delivery), **OQ-42** (posting mode) | Manual voucher entry by accountant (mechanism shipped, Tasks 10.4–10.8) |
| D-02 | Detail dimensions on voucher lines | **OQ-41** (requiredness/binding) | Account-tree-only postings; dimension columns absent |
| D-03 | Report Builder depth | **OQ-49** | Registry reports + saved filters/columns (level A) |
| D-04 | P&L report layout | **OQ-25/OQ-43** (minimal captions) | Simple revenue/expense/caption report over ledger; statutory layouts wait |
| D-05 | Document cancel/edit posture for sales/inventory | **OQ-54** | Cancel-only (recommended default; *not* assumed decided — implementation waits for the answer or the owner's explicit interim choice) |
| D-06 | UI language/calendar | **OQ-02** | i18n dictionary + formatters built; display defaults follow the decision |
| D-07 | Tax fields on sales documents | **OQ-30** | Snapshot fields reserved, no rates invented |
| D-08 | Backup targets & restore self-service | **OQ-52/OQ-53** | Foundation behavior per database-strategy §14; targets displayed when ratified |
| D-09 | License record semantics | **ADR-0030 ratification** | None — feature does not start until ratified (no assumption-based implementation) |
| D-10 | Opening accounting balances | **OQ-11** | Opening *inventory* via receipts; opening *accounting* balances wait or land as manual opening voucher (contract §6.4 mechanism exists) |

## 6. Category E — Candidates for post-MVP

Purchasing (C-01) · Treasury/cash management · Payroll/HR (C-02) ·
Taxpayer slices 2–3 (C-03) · Multi-currency activation (C-05) ·
Webhooks/API surface (C-06) · Fixed assets · Cost accounting/allocation ·
Report Builder levels C/D (per OQ-49) · Scheduling/delivery (C-14) ·
Branch deep capabilities (C-11/C-12) · Two-book architecture (C-10) ·
Marketplace/ecosystem (C-07) · SaaS (C-08).

## 7. MVP acceptance gates

| Gate | Criterion (from PB §30 / OQ-60) | Source |
|---|---|---|
| G1 | §16 reference scenario end-to-end on clean install, non-specialist test user | OQ-60 ratifies numbers |
| G2 | Accounting invariants: balanced documents, 1:1 ledger lines, corrections only via counter-documents | AR-13; task-index §3 |
| G3 | Inventory invariants: stock = ledger replay; negative stock rejected by default | ADR-0017/0022; OQ-24 |
| G4 | LAN-only operation: scenario completes with internet disabled; outbox queues external work | PB §10.1 |
| G5 | Backup/restore drill: scheduled + on-demand backup; controlled restore succeeds; restore never license-blocked | OQ-52/OQ-53 |
| G6 | Security: 100% denial-path coverage MVP endpoints; audit rows for sensitive actions; pen-test executed | PB §22; AG-13 |
| G7 | Install: trained operator, clean install ≤ ratified minutes, from runbook | OQ-60 |
| G8 | No open P0/P1 per ratified definitions | OQ-60 |

**Non-goals for the MVP** = Category C, verbatim. The MVP does not expand
because a capability was mentioned as desirable anywhere in the clarifications;
the four-entry test (§0) governs.

## 8. Out-of-scope disclaimer

This proposal implements no code, no migrations, no UI, and no tests. It is
the scope *contract* for roadmap Stages 1–6 and remains a proposal until
explicitly approved by the product owner.
