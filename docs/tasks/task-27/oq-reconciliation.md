# Task 27 — Open Question Reconciliation Matrix

**Audited `main` commit:** `cb521f4ba2662f4a4cdac7864cf0c712b6bba816` · **Date:** 2026-09-27 ·
**Status:** READY FOR REVIEW — NOT ACCEPTED

> **Source of truth:** `docs/open-questions.md` — **OQ-01 … OQ-63 in the Open table**, **OQ-64 in Resolved** (2026-09-23, Task 13).
>
> **No OQ is closed, opened, reworded, renumbered or reclassified by this audit.**
> Merged code on `main` never closes an OQ without an explicit Owner Decision. No OQ is invented.

---

## 1. Key Gating Open Questions for MVP and Subsequent Stages

| OQ | Area | Question Summary | Current Status | MVP Gating Role | Implementation State on `main` | Required Owner / Domain Decision |
|---|---|---|---|---|---|---|
| **OQ-25** | Accounting | Chart of accounts: coding scheme/levels, mandatory control accounts/roles, per-account dimension requirements, statutory layouts | **OPEN** | **Gating Base Chart CONTENT and Control Roles** | The **mechanism** is implemented (Task 23: templates, versions, explicit adoption, leaf-only posting, read-time aggregation). **Zero content rows** exist in migrations or seeds. | Owner/accountant approval of standard account codes, Persian titles, level structure, and mandatory control roles. |
| **OQ-23** | Accounting | Fiscal calendar: year start (Gregorian vs Jalali-aligned), period layout, close/reopen policy, posting into closed periods, year-end/opening entries | **OPEN** | Blocks year-transition and opening carry-forward | Organization fiscal years/periods exist; period close is enforced in code (Task 14); cross-year opening carry-forward is explicitly deferred (ADR-0031 §4/§9). | Calendar alignment policy, reopen authority, statutory year-end rules. |
| **OQ-24** | Inventory / Accounting | Inventory valuation / costing method (standard, moving average, FIFO, weighted average); returns, adjustments, negative stock | **OPEN** | **Gating Inventory $\rightarrow$ Accounting integration** | Inventory Core records physical quantities and reservations; no costing method, cost layers, or automated COGS journal generation exists. | Approved costing method, valuation timing, negative-stock policy. |
| **OQ-27** | Accounting | Correction policy: reversal window, reversal across closed periods, never-correctable documents, reporting obligations | **OPEN** | Blocks correction policies beyond simple reversal | Document reversal counter-documents are implemented (Task 15 / PR #33); time windows and cross-period policies are not implemented. | Correction time windows, cross-period rules, non-correctable document classes. |
| **OQ-30** | Sales / Tax | Tax model: which taxes, inclusive/exclusive, rounding, exemptions, liability/input accounts, statutory invoice content | **OPEN** | **Gating Sales Module and Electronic Books** | Zero tax models, tables, or calculation services exist in `main`. | Complete tax model, VAT rates, rounding rules, tax authority invoice specifications. |
| **OQ-34** | Sales | Pricing and discounts: price lists, currency rules, override authority, promotions | **OPEN** | Gating Sales pricing engine | Zero pricing tables or services exist. | Price list model, discount governance, price override permissions. |
| **OQ-35** | Sales / Party | Customer credit control: limit enforcement, scope, aging, overrides | **OPEN** | Gating Sales credit check | `Party` is a flat table without credit limit fields or exposure tracking. | Credit limit model, credit check blocking vs warning posture. |
| **OQ-36** | Master Data | Master-data lifecycle: is `is_active` enough, is deletion ever allowed, soft vs hard, code reuse, case sensitivity | **OPEN** | Gating account code history, code reuse, and master data retirement | No DELETE endpoints exist for master data; `is_active` disabling only; `RESTRICT` foreign keys throughout. | Code reuse rules, pre-use deletion vs post-use immutability rules. |
| **OQ-38** | Party | Party detail: contacts, addresses, bank accounts, Iranian legal identifiers and validation | **OPEN** | Gating Party/Customer completion (Phase 3A) | `organization.parties` is a single flat table (`code`, `display_name`, legal fields); no child contacts or bank account tables. | Required child entities for MVP, national ID / economic code validation rules. |
| **OQ-39** | Architecture / Sync | Durable integration semantics: transactional in-process subscription vs durable outbox; rejection handling; event delivery | **OPEN** | **Gating all system-generated accounting integrations** | In-memory `DomainEventBus` exists; no outbox table or background dispatch loop; `worker.service.ts` defers event processing. | In-process vs outbox delivery semantics for inter-module workflows. |
| **OQ-40** | Accounting | Financial areas: how many per organization, shared vs per-area chart, user↔area grants, default area, consolidation | **OPEN** | Scope model policy | `FinancialArea` is organization-scoped; per-user access grants are not modeled. | Area usage policy, per-user financial area access control decision. |
| **OQ-41** | Accounting | Detail dimensions (تفصیلی): count, required/optional/forbidden per account, master-data binding, authoring authority | **OPEN** | Gating line-level dimensional accounting | Line-level boundary decided by OD-20-6; no dimension tables, columns, or services exist on `main`. | Dimension count (4 vs n), binding to master data (parties, cost centers, projects). |
| **OQ-42** | Accounting | System-generated posting policy: direct-final (Mode A) vs temporary/approval (Mode B); default; approval authority; rejection | **OPEN** | **Gating system posting automation** | Voucher workflow supports `draft`, `temporary`, and `final` states; no automated source-module posting exists. | Default posting mode for Sales and Inventory events. |
| **OQ-43** | Accounting / Legal | Iranian statutory requirements: Article 95 legal books, sealing, chronology, Persian/IRR, no-deletion, e-invoicing | **OPEN** | **Gating Electronic Books / Legal Accounting** | Append-only ledger entries and reversal counter-documents satisfy foundational auditability; statutory journal book format is pending. | Statutory book layout and electronic format specifications. |
| **OQ-49** | Reporting | Report Builder MVP depth (registry-only $\rightarrow$ visual builder) | **OPEN** | Gating reporting scope boundary | Accounting owns bounded read APIs (17A, 17B, 18, 19); generic Report Builder is excluded from MVP. | Confirmation of code-defined registry approach (ADR-0009). |
| **OQ-54** | Documents | Finalized document deletion/editing policy: cancel-only vs edit-until-posted | **OPEN** | Gating document cancellation workflow | Accounting vouchers are immutable once finalized (reversal-only); business document cancel workflow pending. | Cancellation state machine and numbering gap policy. |
| **OQ-62** | Accounting | Account pin coherence: `coding_structure_version_id` vs `accounting_configuration_id` | **OPEN** | Gating legacy account pin repair | ODR-1 enforces coherence on writes (Task 19 ACCEPTED); legacy divergent rows are not repaired. | Policy on repairing pre-existing legacy divergent accounts. |
| **OQ-63** | Accounting | Legacy fallback level shape (Group 2 / Detail 3 vs newest superseded) | **OPEN** | Gating configuration backfill ratification | Default 2+3 is applied by Task 11 migration; rehearsal verified in CI. | Ratification of 2+3 fallback configuration default. |

---

## 2. Status of Identity / Governance OQs Reconciled by Recent Tasks

- **OQ-01 / OQ-22 (Tenancy & Deployment Scope):** ODR-3 principal-bound organization authorization is **100% enforced** across all 37 read surfaces (Task 26 / PR #71) and write surfaces (Task 19). The product question (single-org on-premise vs multi-org) remains **OPEN** as an architectural baseline, but security is fail-closed.
- **OQ-14 (Occupational Roles):** PR #64 and PR #72 provisioned the installation-bootstrap `System Administrator` role and default organization membership. Occupational roles (Accountant, Warehouse, Sales, Auditor) remain **OPEN** and must not be invented without domain input.
- **OQ-19 (Administrator Safety & Lockout):** Fresh install provisioning is implemented via `bootstrap:system-admin` (PR #64/72). Self-disable protection, self-role-removal, and last-administrator lockout remain **OPEN**.
- **OQ-64 (Operational Freeze Definition):** **RESOLVED (2026-09-23, Task 13)** in `docs/open-questions.md`.
