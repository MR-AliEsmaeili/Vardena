# Task 28 — Implementation Report

## Status

**READY FOR REVIEW — NOT ACCEPTED**

---

## Main SHA

`ff4b9f24d1c3797712c88fcd61432c3c315dbf4f` (Merge of PR #73 / Task 27 on `main`).

---

## Task 27 Verification

Task 27 was merged into `main` via PR #73 at commit `ff4b9f24d1c3797712c88fcd61432c3c315dbf4f`.
- **CI Run 36341552469:** SUCCESS (`frontend` in 56s, `backend` in 3m48s covering Prisma validate/generate, lint, typecheck, format check, unit tests, build, migrate deploy, bootstrap system administrator, migration rehearsal, and all live-PostgreSQL E2E suites).
- **Security Baseline:** Confirmed that all 37 organization-scoped read surfaces enforce `assertOrganizationInScope` following `requireAllPermissions`, global `DeploymentOrganizationScopeGuard` is active as `APP_GUARD`, and default system administrator (`مدیر`) has verified ODR-3 membership in the pinned deployment organization.
- **Scope Verification:** Treasury, Purchasing, Purchasing $\rightarrow$ Accounting, and Purchasing Reports remain strictly outside MVP.

---

## Owner Decisions

All four core Owner Decision areas identified in Task 27 (OD-27-01 through OD-27-04), as well as supporting domain decisions (OD-28-01 through OD-28-06), were reconciled:
- **OD-27-01 (Acceptance Backlog):** `PENDING OWNER DECISION` (Bootstrap Admin, Tasks 23–27 remain `MERGED / READY FOR REVIEW — NOT ACCEPTED`).
- **OD-27-02 (Base Chart Content / OQ-25):** `PENDING OWNER DECISION` (Base Chart mechanism merged, 0 content rows).
- **OD-27-03 (Next Implementation Direction):** `PENDING OWNER DECISION` (Four candidate tracks evaluated).
- **OD-27-04 (ADR Ratification):** `PENDING OWNER DECISION` (8 implemented ADRs remain `Proposed` in registry).
- **Zero fabricated decisions:** No decision has been made on behalf of the Owner.

---

## OQ-25

- **Status:** **OPEN — DOMAIN/OWNER DECISION REQUIRED**.
- **Reconciliation:** The Base Chart *mechanism* (Task 23) is verified complete and operational on `main`. However, standard Iranian SME chart *content* (codes, titles, levels, natures, postability flags, control roles) has 0 rows in migrations or seeds.
- **Invariants Preserved:**
  1. *Template identity ≠ Ledger identity* (Verified)
  2. *Adoption = Copy* (Verified)
  3. *Posting = Leaf-only* (Verified)
  4. *Aggregation = Read-time* (Verified)
- Direct Base Chart content implementation (Phase 1A) remains **BLOCKED BY OQ-25** until an approved chart artifact is provided.

---

## ADR Status

- **Total ADR files in repository:** 37 (ADR-0027 is a deliberate gap).
- **Accepted ADRs:** 22 (ADR-0001..0016, ADR-0022..0026, ADR-0028).
- **Proposed ADRs:** 15 (ADR-0017..0021, ADR-0029..0038).
- **Implemented ahead of governance:** 8 ADRs (ADR-0017, 0018, 0019, 0020, 0021, 0031, 0032, 0038) are implemented in code and tested in CI, but remain verbatim `Proposed` in `docs/adr/` pending explicit Owner promotion under OD-27-04.

---

## MVP Dependency State

- **Foundation & RBAC:** Foundation is complete, verified, and fail-closed.
- **Accounting Core:** Vouchers, ledger, balance projection, periods, reversals, and 4 read queries are complete.
- **Inventory Core:** Movement ledger and physical balances exist; operational warehouse documents and valuation methods remain open.
- **Sales:** `sales` module does not exist; requires an investigation gate for tax, pricing, credit, and party details.
- **Integrations:** Event bus exists in-memory; cross-module durable delivery (OQ-39) and posting mode (OQ-42) remain open.
- **Post-MVP Exclusions:** Treasury and Purchasing remain strictly out of MVP.

---

## Next Implementation Gate

- **Gate Outcome:** **`IMPLEMENTATION BLOCKED — OWNER DECISION REQUIRED`**.
- **Candidate Tracks Prepared for Owner Selection:**
  1. **Track 1 (Phase 1A — Accounting Base Chart Content):** JSON/fixture loader for approved chart nodes through Task 23 API. *(Unblocked if Owner approves OD-27-02 / OQ-25)*.
  2. **Track 2 (Phase 3A/3C — Full Inventory / Warehouse Operational Flow):** Investigation gate for warehouse coding, Material Requests, and quantity Receipt/Issue flows. *(Unblocked if Owner selects Track 2 under OD-27-03)*.
  3. **Track 3 (Phase 2A — Reporting Foundation Design Gate):** Code-defined report registry and pipeline over existing Accounting read queries. *(Unblocked if Owner selects Track 3 under OD-27-03)*.
  4. **Track 4 (Phase 6.2/6.3 — Audit & Identity Session Completion):** Specification gate for persistent audit logs and session management endpoints. *(Unblocked if Owner selects Track 4 under OD-27-03)*.

---

## Authorization State

- **Production Code Authorization:** **NONE**.
- No implementation task is currently authorized to write production code.
- Implementation begins only in the subsequent task (e.g., Task 29) after the Owner accepts Task 28 and issues the specific kickoff prompt.

---

## Remaining Blockers

1. **Owner Decisions:** OD-27-01 (Acceptance Backlog), OD-27-02 (Chart Content), OD-27-03 (Track Selection), OD-27-04 (ADR Ratification).
2. **Domain Open Questions:** OQ-25 (Chart content), OQ-24 (Inventory valuation), OQ-30 (Sales tax), OQ-39 (Integration semantics), OQ-42 (Posting mode), OQ-43 (Statutory book formats).

---

## Files Added

- `docs/tasks/task-28/brief.md`
- `docs/tasks/task-28/prompt.md`
- `docs/tasks/task-28/owner-decision-matrix.md`
- `docs/tasks/task-28/owner-decision-record.md`
- `docs/tasks/task-28/mvp-implementation-readiness-matrix.md`
- `docs/tasks/task-28/next-implementation-gate.md`
- `docs/tasks/task-28/adr-reconciliation.md`
- `docs/tasks/task-28/oq-reconciliation.md`
- `docs/tasks/task-28/task-acceptance-matrix.md`
- `docs/tasks/task-28/implementation-report.md`

---

## Files Updated

- `STATE.md` (Synchronized with Task 28 baseline and findings).

---

## Production Code Changes

**NONE** (0 lines of production code changed; 0 files modified in `backend/src/` or `frontend/src/`).

---

## Schema / Migration Changes

**NONE** (0 Prisma models modified, 0 SQL migrations added).

---

## Permission Changes

**NONE** (Total permissions remain 134; 0 added, removed, or modified).

---

## Architecture Changes

**NONE** (Modular monolith, 8 schemas, ODR-3 authorization, and deployment pin architecture preserved intact).

---

## CI Evidence

- **Baseline Merge CI Run 36341552469 (`main` @ `ff4b9f2`):** SUCCESS
  - `frontend` job `108682516150`: SUCCESS (56s)
  - `backend` job `108682516230`: SUCCESS (3m48s) — covering Prisma validate/generate, lint, typecheck, format, 108 unit spec files / 1,267 tests, build, `migrate deploy`, `bootstrap:system-admin`, migration rehearsal, and all 34 E2E spec files on live PostgreSQL.

---

## Final Recommendation

1. **Owner Action 1 (OD-27-01 & OD-27-04):** Review and formally accept merged tasks (Bootstrap Admin, Tasks 23–27) and ratify implemented ADRs.
2. **Owner Action 2 (OD-27-02 / OQ-25):** If standard chart content is ready, provide the approved Iranian SME Chart of Accounts specification and authorize **Task 29: Base Chart Content Loading (Phase 1A)**.
3. **Owner Action 3 (OD-27-03 Alternative):** If chart content is still being finalized, authorize **Task 29: Full Inventory / Warehouse Operational Subsystem Investigation Gate (Phase 3A/3C)** or **Task 29: Reporting Foundation Design Gate (Phase 2A)**.

---

## Acceptance

Task 28 is **READY FOR REVIEW — NOT ACCEPTED**.
Explicit Owner review and acceptance are required before proceeding to the next task.
