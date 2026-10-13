# Task 28 — MVP Implementation Readiness Matrix

**Audited `main` HEAD Commit:** `ff4b9f24d1c3797712c88fcd61432c3c315dbf4f` · **Date:** 2026-09-27 ·
**Status:** READY FOR REVIEW — NOT ACCEPTED

> **Governing Rule (Prompt §11/§12):** This matrix evaluates every Vardena capability against the eight mandatory readiness criteria.
> A capability is **IMPLEMENTATION READY** (`YES`) ONLY if all eight criteria are met:
> 1. Foundation exists
> 2. Domain decision is complete
> 3. ADR is ready (Accepted or explicitly authorized)
> 4. No blocking OQ remains
> 5. Security is ready
> 6. MVP scope includes it
> 7. Owner authorization exists
> 8. Implementation boundaries are clear
>
> If any criterion is missing, the capability is **NOT IMPLEMENTATION READY**.
> Allowed status values: `YES` · `NO` · `PARTIAL` · `N/A` · `PENDING OWNER DECISION`.

---

## 1. Capability Implementation Readiness Matrix

| Capability | Foundation Exists | Domain Decision Complete | ADR Ready | OQ Blocker | Security Ready | Owner Authorization | Implementation Ready |
|---|---|---|---|---|---|---|---|
| **Identity & Session Management** | YES | PARTIAL | YES (ADR-0007) | NO | YES (ODR-3) | PENDING OWNER DECISION | **NO (Specification Gate Ready)** |
| **Users & Granular RBAC** | YES | YES | YES (ADR-0006, 0016) | NO | YES (Fail-closed) | YES (Implemented) | **N/A (Already Merged)** |
| **Organization & Master Data** | YES | YES | YES (ADR-0020, 0021, 0025, 0038) | NO | YES (ODR-3 complete across 37 surfaces) | YES (Implemented) | **N/A (Already Merged)** |
| **Documents Foundation** | YES | YES | YES (ADR-0019, 0023) | NO | YES (ODR-3) | YES (Implemented) | **N/A (Already Merged)** |
| **Workflow Foundation** | YES | YES | YES (ADR-0018, 0024) | NO | YES (ODR-3) | YES (Implemented) | **N/A (Already Merged)** |
| **Accounting Core (Vouchers, Ledger, Periods, Reversal)** | YES | YES | YES (ADR-0026, 0028, 0031, 0032) | NO | YES (ODR-3) | YES (Implemented) | **N/A (Already Merged)** |
| **Base Chart Mechanism (Templates & Adoption Copy)** | YES | YES | YES (ADR-0037 Proposed, Task 21 Accepted) | NO | YES (ODR-3) | YES (Task 23 Merged) | **N/A (Already Merged)** |
| **Base Chart Content (Standard Iranian SME Chart)** | YES (Mechanism exists) | NO (Chart structure/codes undecided) | PARTIAL (ADR-0037 Proposed) | YES (OQ-25, OQ-36) | YES (ODR-3) | PENDING OWNER DECISION — **OD-27-02 (2026-09-27): content NOT required for MVP; loading only with a separately approved content artifact** | **NO (Blocked by OQ-25 content decisions; not an MVP requirement per OD-27-02)** |
| **Account Lifecycle & Code History** | PARTIAL | NO | PARTIAL (ADR-0033 Proposed) | YES (OQ-36) | YES | PENDING OWNER DECISION | **NO (Blocked by OQ-36)** |
| **Control Roles (Catalog & Account Mapping)** | PARTIAL | NO | PARTIAL (ADR-0037 Proposed) | YES (OQ-25, Consumer missing) | YES | PENDING OWNER DECISION | **NO (Blocked by OQ-25 & Consumer)** |
| **Detail Dimensions (Line-Level Analytical Assignments)** | PARTIAL | NO | PARTIAL (ADR-0037 Proposed) | YES (OQ-41) | YES | PENDING OWNER DECISION | **NO (Blocked by OQ-41)** |
| **Corrections Beyond Reversal (Replacement / Adjustment)** | PARTIAL | NO | NO | YES (OQ-27, OQ-23) | YES | PENDING OWNER DECISION | **NO (Blocked by OQ-27)** |
| **Year-Transition & Opening Carry-Forward** | PARTIAL | NO | NO (ADR-0031 excludes carry-forward) | YES (OQ-23) | YES | PENDING OWNER DECISION | **NO (Blocked by OQ-23)** |
| **Posting Rules & Account Mapping Engine** | PARTIAL | NO | NO | YES (OQ-24, 25, 30, 39, 42) | YES | PENDING OWNER DECISION | **NO (Blocked by multiple OQs)** |
| **Inventory Core (Movements, Balances, Reservations)** | YES | YES | YES (ADR-0017, 0022) | NO | YES (ODR-3) | YES (Implemented) | **N/A (Already Merged)** |
| **Full Inventory / Warehouse: Operational Flows (Master, Request, Receipt/Issue)** | YES (Core ledger exists) | PARTIAL (Operational flow designs ready) | YES (ADR-0022, ADR-0023) | PARTIAL (OQ-29, OQ-54) | YES (ODR-3) | PENDING OWNER DECISION | **NO (Investigation Gate Ready)** |
| **Inventory Valuation & Costing (Rial Kardex & COGS)** | PARTIAL | NO | NO | YES (OQ-24, OQ-11) | YES | PENDING OWNER DECISION | **NO (Blocked by OQ-24)** |
| **Inventory $\rightarrow$ Accounting Integration** | PARTIAL (Event bus exists) | NO | YES (ADR-0005) | YES (OQ-24, 25, 39, 42) | YES | PENDING OWNER DECISION | **NO (Blocked by OQ-39 & OQ-24)** |
| **Party / Customer Foundation** | YES (Flat party exists) | PARTIAL | YES (ADR-0020, 0021) | PARTIAL (OQ-38 for details) | YES (ODR-3) | PENDING OWNER DECISION | **NO (Investigation Gate Ready)** |
| **Sales Module (Invoicing, Pricing, Taxes, Lifecycle)** | NO (No `sales` module) | NO | NO | YES (OQ-30, 34, 35, 38, 54) | PARTIAL | PENDING OWNER DECISION | **NO (Requires Investigation Gate)** |
| **Sales $\rightarrow$ Accounting Integration** | NO | NO | NO | YES (OQ-30, 39, 42, 25) | PARTIAL | PENDING OWNER DECISION | **NO (Blocked by Sales & OQ-39)** |
| **Reporting Foundation (Code-Defined Registry & Pipeline)** | YES (4 read queries exist) | PARTIAL (Existing queries valid; new layouts pending) | YES (ADR-0009) | PARTIAL (OQ-49 confirms registry) | YES (ODR-3) | PENDING OWNER DECISION | **NO (Design Gate Ready)** |
| **Electronic Books / Iranian Statutory Reporting** | PARTIAL (Ledger/GL queries exist) | NO | PARTIAL (ADR-0036 Proposed) | YES (OQ-43) | YES | PENDING OWNER DECISION | **NO (Blocked by OQ-43)** |
| **Audit Module (Append-Only Persistent Log)** | PARTIAL (Audit columns/events exist; no module) | PARTIAL | YES (ADR-0006, `security.md`) | PARTIAL (OQ-17, OQ-14) | YES | PENDING OWNER DECISION | **NO (Specification Gate Ready)** |
| **Background Worker / Outbox / Jobs** | PARTIAL (Worker startup exists; no dispatch loop) | PARTIAL | YES (ADR-0004, 0010) | YES (OQ-39 gates outbox necessity) | YES | PENDING OWNER DECISION | **NO (Demand-Driven Dependency)** |
| **Treasury (Cash, Bank, Cheque, Payment/Receipt)** | NO | NO | N/A | N/A | N/A | NO (POST-MVP / OUT OF MVP) | **NO (OUT OF MVP)** |
| **Purchasing Core & Purchase Invoicing** | NO | NO | N/A | YES (OQ-16: post-v1) | N/A | NO (POST-MVP / OUT OF MVP) | **NO (OUT OF MVP)** |
| **Purchasing $\rightarrow$ Accounting** | NO | NO | N/A | N/A | N/A | NO (POST-MVP / OUT OF MVP) | **NO (OUT OF MVP)** |
| **Purchasing Reports** | NO | NO | N/A | N/A | N/A | NO (POST-MVP / OUT OF MVP) | **NO (OUT OF MVP)** |

---

## 2. Summary of Implementation Readiness

> **OD-27-02 note (2026-09-27, Task 28 follow-up):** the Owner decided the MVP requires the Base Chart **mechanism** (already merged — Task 23) but **not** a concrete Base Chart **content** set. This changes no readiness verdict above: Base Chart Content remains blocked by the OQ-25 content decisions and is no longer treated as an MVP requirement.

- **Capabilities Implementation-Ready for Production Code:** **0**
- **Capabilities Ready for Investigation / Design Gate:** **4**
  1. *Track 1 (Phase 1A):* Base Chart Content Loading — **optional, not MVP-required per OD-27-02 (2026-09-27)**; gated by a separately approved content artifact and the remaining OQ-25 content decisions.
  2. *Track 2 (Phase 3A/3C):* Full Inventory / Warehouse Operational Subsystem Investigation Gate.
  3. *Track 3 (Phase 2A):* Reporting Foundation & Code-Defined Report Registry Design Gate.
  4. *Track 4 (Phase 6.2/6.3):* Audit Module Scope & Identity Session Management Specification Gate.
- **Capabilities Blocked by Domain Decisions / OQs:** **10** (Base Chart Content, Dimensions, Costing, Posting Rules, Sales, Integrations, Statutory Books, etc.).
- **Capabilities Explicitly OUT OF MVP:** **4** (Treasury, Purchasing, Purchasing $\rightarrow$ Accounting, Purchasing Reports).
- **Core Conclusion:** Active production coding is **BLOCKED — OWNER DECISION REQUIRED** (OD-27-01/OD-27-03/OD-27-04 and the domain OQ gates remain pending).
