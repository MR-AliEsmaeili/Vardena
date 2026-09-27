# Task 28 — Owner Decision Matrix

**Audited `main` HEAD Commit:** `ff4b9f24d1c3797712c88fcd61432c3c315dbf4f` · **Date:** 2026-09-27 ·
**Status:** READY FOR REVIEW — NOT ACCEPTED

> **Governing Rule (STATE.md §1/§6):** The Agent MUST NOT fabricate Owner decisions.
> The only valid states for an Owner Decision are:
> - **DECIDED:** An explicit decision already exists in the repository or has been explicitly provided by the Owner.
> - **PENDING OWNER DECISION:** The decision has not been explicitly made.
> - **NOT APPLICABLE:** The decision is no longer required because an explicit later decision superseded it.

---

## 1. Owner Decision Matrix

| Decision ID | Topic | Current State | Evidence | Decision Required? | Owner Decision | Consequence |
|---|---|---|---|---|---|---|
| **OD-27-01** | Formal Acceptance of Merged Work Backlog (Bootstrap Admin, Task 23, Task 24, Task 25, Task 26, Task 27) | MERGED on `main` with green CI runs across full unit, migration rehearsal, and live-PostgreSQL E2E suites; no formal Owner Acceptance records exist. | PR #64, #66, #67, #70, #71, #72, #73; CI runs `36271122971`, `36298005115`, `36306360274`, `36325486898`, `36337732631`, `36340161605`, `36341552469`. | YES | **PENDING OWNER DECISION** | Merged capabilities remain in `MERGED / READY FOR REVIEW — NOT ACCEPTED` status; code is fully operational on `main` but governance milestone Phase 0 remains open. |
| **OD-27-02** | Base Chart Content Specification and Loading Authorization (OQ-25) | Base Chart *mechanism* is fully implemented and tested (Task 23); Base Chart *content* has 0 rows in migrations or seeds. | `accounting.prisma`, migration `20260926010000_accounting_base_chart`, `base-chart-adoptions.service.ts`, `docs/open-questions.md` (OQ-25 OPEN). | YES | **PENDING OWNER DECISION** | Direct production loading of Base Chart content (Phase 1A) remains BLOCKED. Tenant organizations must construct custom charts or await approved standard SME chart content. |
| **OD-27-03** | Selection of Next Implementation Direction | Foundation, security (ODR-3 complete across 37 surfaces), and Accounting Core are complete on `main`. Four next implementation candidate tracks exist (Phase 1A, Phase 3A/3C, Phase 2A, Phase 6.2/6.3). | `STATE.md` §7/§8, `docs/roadmap/backend-mvp-roadmap.md` §5, `future-task-candidates.md`. | YES | **PENDING OWNER DECISION** | No implementation task is authorized to write production code. Repository remains at governance gate pending Owner track selection. |
| **OD-27-04** | Ratification and Promotion of Implemented-Ahead-of-Governance ADRs | 8 ADRs (ADR-0017, 0018, 0019, 0020, 0021, 0031, 0032, 0038) describe capabilities already implemented and merged on `main`, but retain `Status: Proposed` in `docs/adr/`. | `docs/adr/0017-*.md` through `0038-*.md`, `docs/tasks/task-27/adr-reconciliation.md`. | YES | **PENDING OWNER DECISION** | ADR statuses remain verbatim `Proposed` in ADR registry; implementation status is documented in reconciliation reports without premature promotion. |
| **OD-28-01** | OQ-36 Prerequisites for Base Chart Adoption & Lifecycle | OQ-36 prerequisites (code-reuse policy vs `uq_accounts_organization_id_code`, unused adopted account deletion, code-history producer) recorded in Task 21 §10 remain unresolved. | `docs/tasks/task-21/task-21-governance-baseline.md` §10, `docs/open-questions.md` (OQ-36 OPEN). | YES (when Phase 1A is authorized) | **PENDING OWNER DECISION** | Account deletion posture remains fail-closed `RESTRICT` only; account codes remain immutable from creation. |
| **OD-28-02** | Durable Integration Semantics for System Postings (OQ-39) | In-memory `DomainEventBus` exists; no outbox table (`sync.outbox_events`), worker loop, or persistent queue exists; `worker.service.ts` defers dispatch. | `kernel/events/domain-event-bus.ts`, `worker.service.ts`, ADR-0004, ADR-0005, `docs/open-questions.md` (OQ-39 OPEN). | YES (gates cross-module system posting Phase 4) | **PENDING OWNER DECISION** | System posting automation (Inventory $\rightarrow$ Accounting, Sales $\rightarrow$ Accounting) cannot be implemented until in-process vs outbox delivery semantics are decided. |
| **OD-28-03** | Default System-Generated Posting Mode (OQ-42) | Voucher workflow supports `draft`, `temporary`, and `final` states; default mode for source modules (Direct Final vs Temporary/Review) is undecided. | `accounting.prisma`, `accounting-documents.service.ts`, `docs/open-questions.md` (OQ-42 OPEN). | YES (gates Phase 4 integrations) | **PENDING OWNER DECISION** | System posting remains manual-only via voucher APIs. |
| **OD-28-04** | Inventory Valuation / Costing Method (OQ-24 / OQ-11) | Inventory ledger tracks physical quantities and reservations; no costing method (FIFO, Moving Average, Standard) or cost layers exist on `main`. | `inventory.prisma`, `inventory-movements.service.ts`, `docs/open-questions.md` (OQ-24, OQ-11 OPEN). | YES (gates inventory rial flows & COGS posting) | **PENDING OWNER DECISION** | Full Inventory quantity operations can be designed, but rial valuation flows and automated COGS journals remain blocked. |
| **OD-28-05** | Sales Tax & Invoice Model (OQ-30 / OQ-38) | `sales` module does not exist; `Party` is flat without Iranian tax/economic codes or child contact tables; tax calculation engine is not designed. | `backend/src/modules/organization/`, `docs/open-questions.md` (OQ-30, OQ-38 OPEN). | YES (gates Sales module design Phase 3B) | **PENDING OWNER DECISION** | Sales module implementation remains in pre-design state pending tax and party domain definitions. |
| **OD-28-06** | Iranian Statutory Legal Book Specification (OQ-43) | Read query foundation exists (Task 18); statutory Journal Book (دفتر روزنامه) and General Ledger Book (دفتر کل) official print/export formats are undecided. | `docs/tasks/task-18/`, ADR-0036 Proposed, `docs/open-questions.md` (OQ-43 OPEN). | YES (gates Electronic Books Phase 2B/C-37) | **PENDING OWNER DECISION** | Statutory accounting formats cannot be synthesized without authentic regulatory specifications. |

---

## 2. Summary of Decision States

- **Total Audited Decisions:** 10
- **Decided by Owner:** 0
- **Pending Owner Decision:** 10
- **Not Applicable:** 0
- **Fabricated Decisions:** 0
