# Next Implementation Gate Specification

**Status:** **IMPLEMENTATION BLOCKED — OWNER DECISION REQUIRED**
**Audited `main` HEAD Commit:** `ff4b9f24d1c3797712c88fcd61432c3c315dbf4f` · **Date:** 2026-09-27

---

## 1. Selected Capability

**Current Gate State:** `IMPLEMENTATION BLOCKED — OWNER DECISION REQUIRED`

There is currently **NO authorized next production implementation task**.
All core candidate areas require prior Owner decisions (OD-27-01, OD-27-03, OD-27-04; the MVP-scope part of OD-27-02 was decided 2026-09-27 — see §4) and unresolved domain Open Questions (OQ-25, OQ-24, OQ-30, OQ-39, OQ-42, OQ-43).

However, based on repository readiness and architectural dependencies, four prioritized candidate tracks have been prepared for Owner selection:

- **Primary Candidate Track 1 (Phase 1A — Accounting Base Chart Content):** Controlled loading of approved Iranian SME chart template nodes via the Task 23 mechanism. *(Still gated: OD-27-02 (DECIDED 2026-09-27) settled only the MVP boundary — mechanism in MVP, concrete content NOT MVP-required; Track 1 remains blocked until a separately approved content artifact exists under OQ-25.)*
- **Alternative Candidate Track 2 (Phase 3A/3C — Full Inventory / Warehouse Operational Flow):** Investigation gate for operational warehouse coding, product master enhancements, Material Requests, and quantity Receipt/Issue flows. *(Unblocked by Owner priority selection under OD-27-03)*.
- **Alternative Candidate Track 3 (Phase 2A — Reporting Foundation Design Gate):** Code-defined report registry and pipeline over existing Accounting read queries per ADR-0009. *(Unblocked by Owner priority selection under OD-27-03)*.
- **Alternative Candidate Track 4 (Phase 6.2/6.3 — Audit & Identity Session Completion):** Specification gate for persistent `audit_logs` store and self/admin session management endpoints. *(Unblocked by Owner priority selection under OD-27-03)*.

---

## 2. Why It Is Dependency-Ready (or Blocked)

### Track 1 (Phase 1A — Base Chart Content Loading)
- **Why technical foundation is ready:** Task 23 Base Chart mechanism is merged on `main`. Template creation, versioning, publishing, node hierarchy, and copy-on-adoption are fully functional and tested in live PostgreSQL E2E.
- **Why implementation is BLOCKED:** Base Chart *content* has 0 rows in the codebase. OQ-25 is OPEN. The Agent cannot invent chart codes, account names, natures, or level structures.
- **What unlocks it:** Owner providing or approving the standard Iranian SME Chart of Accounts specification artifact.

### Track 2 (Phase 3A/3C — Full Inventory / Warehouse Operational Flow)
- **Why technical foundation is ready:** Inventory Core (ADR-0022 Accepted) provides movement ledger, balances, reservations, and transfers. Documents Foundation (ADR-0023 Accepted) provides numbering series and relations. Workflow Foundation (ADR-0024 Accepted) provides state transitions.
- **Why implementation is BLOCKED:** Requires an initial Investigation Gate to formalize domain contracts and boundaries before writing code. Valuation method (OQ-24) remains open for rial flows.
- **What unlocks it:** Owner selection of Track 2 to authorize an investigation task for operational quantity flows.

### Track 3 (Phase 2A — Reporting Foundation Design Gate)
- **Why technical foundation is ready:** ADR-0009 (Accepted) establishes module-owned read queries and raw SQL views. Tasks 17A, 17B, 18, and 19 (ODR-2) implemented all four core Accounting read queries with pagination, bounding, allow-lists, and independent permissions.
- **Why implementation is BLOCKED:** Requires an architectural design gate to formalize the code registry pattern without admitting a generic visual report builder (OQ-49).
- **What unlocks it:** Owner selection of Track 3.

---

## 3. Existing Foundation

1. **Security & Organization Isolation:**
   - ODR-3 principal-bound organization authorization (`assertOrganizationInScope`) is 100% enforced across all 37 read surfaces (Task 26 / PR #71) and write paths (Task 19).
   - Global `DeploymentOrganizationScopeGuard` is active as `APP_GUARD` in `organization.module.ts:81`.
   - Default system administrator (`مدیر`) has verified ODR-3 membership in the pinned deployment organization (PR #72 / ADR-0038 Proposed).
2. **Accounting Core:**
   - 8 module database schemas; 17 SQL migrations; 52 Prisma models; 134 registered permissions.
   - Vouchers (draft/temporary/final), immutable ledger entries, turnover balance projection (Task 12), period close gates (Task 14), and reversal counter-documents (Task 15).
   - Base Chart mechanism (Task 23): `BaseChartTemplate`, `BaseChartTemplateVersion`, `BaseChartTemplateLevel`, `BaseChartTemplateNode`, `BaseChartAdoption`.

---

## 4. Required Owner Decisions

To authorize any of the candidate tracks, the Owner must resolve:

1. **OD-27-01:** Formal acceptance of merged work items (Bootstrap Admin, Task 23, Task 24, Task 25, Task 26).
2. **OD-27-02 (for Track 1):** Approval of the Base Chart content specification (OQ-25) and OQ-36 lifecycle prerequisites. *(Update 2026-09-27: the MVP-scope part of OD-27-02 is DECIDED — mechanism in MVP, concrete content not MVP-required. The content-artifact approval itself remains required for Track 1 and is NOT granted by that decision.)*
3. **OD-27-03:** Explicit selection of the authorized track for the next task brief.
4. **OD-27-04:** Ratification of implemented-ahead-of-governance ADRs (ADR-0017..0021, 0031, 0032, 0038).

---

## 5. Accepted ADRs

The next gate builds upon the following accepted architectural baselines:
- `ADR-0001`: Modular Monolith (9 modules, vertical slices)
- `ADR-0002`: Fixed Technology Stack (NestJS 12, TS 6, Prisma 7, PG 16, React 19)
- `ADR-0006` / `ADR-0016`: Granular RBAC, fail-closed authorization, no permission cache
- `ADR-0007`: Server-side opaque sessions
- `ADR-0008`: Single database, schema per module, ULIDs
- `ADR-0009`: Reporting via module views and scoped raw SQL
- `ADR-0014`: OpenAPI contract served at `/api/docs`
- `ADR-0015`: Backend foundation conventions (standard error envelope, correlation IDs)
- `ADR-0022`: Inventory Core movement ledger and rebuildable balances
- `ADR-0023`: Document foundation (numbering series, allocations, relations)
- `ADR-0024`: Reusable workflow foundation
- `ADR-0025`: Deployment organization pin
- `ADR-0026`: Accounting bounded context and fiscal ownership
- `ADR-0028`: Accounting configuration foundation (single ACTIVE, operational freeze)

---

## 6. Resolved OQs

- **OQ-64:** Operational Freeze Definition (Resolved in Task 13).

---

## 7. Remaining OQs

The following OQs remain load-bearing and must NOT be silently bypassed:
- **OQ-25:** Base Chart account codes, Persian titles, levels, and control roles.
- **OQ-24 / OQ-11:** Inventory valuation method and opening stock rules.
- **OQ-30 / OQ-38:** Sales tax model and party legal identifiers.
- **OQ-36:** Master data lifecycle (code reuse vs `uq_*` constraints, unused adopted account deletion).
- **OQ-39:** Durable cross-module integration delivery semantics (in-process vs outbox).
- **OQ-42:** System-generated posting default mode (Mode A vs Mode B).
- **OQ-43:** Iranian statutory accounting legal book formats (Article 95).
- **OQ-49:** Report Builder MVP depth (confirmed code-defined registry only).

---

## 8. Security Constraints

1. **ODR-3 Preservation:** Every new endpoint must enforce `OrganizationsService.assertOrganizationInScope` following `requireAllPermissions`.
2. **Permission-First Ordering:** RBAC permissions must be verified BEFORE organization scope assertions.
3. **Fail-Closed Semantics:** Unauthenticated calls return 401; non-member organization access returns 404.
4. **No Wildcards / No Bypasses:** Zero administrative wildcards, superuser flags, or hidden bypass mechanisms.
5. **Single-Organization Deployment Pin:** Must respect `DEPLOYMENT_ORGANIZATION_ID` when configured.

---

## 9. Architecture Constraints

1. **Modular Monolith:** All changes remain within NestJS module boundaries (`api`, `application`, `domain`, `data`).
2. **Schema Isolation:** No cross-module Prisma queries or foreign keys between different PostgreSQL schemas.
3. **Immutable History:** Accounting ledger entries and document reversal chains remain append-only and strictly immutable.
4. **Base Chart Invariants:**
   - Template identity ≠ Ledger identity
   - Adoption = Copy
   - Posting = Leaf-only
   - Aggregation = Read-time
5. **No Microservices / No External Broker:** All communications remain in-process or DB-backed.

---

## 10. Explicit Non-Goals

The next implementation task MUST NOT include:
- **Treasury:** Cash, bank, cheques, settlement, bank reconciliation remain strictly **POST-MVP / OUT OF MVP**.
- **Purchasing:** Supplier purchase orders, purchase invoices, purchasing lifecycle remain strictly **POST-MVP / OUT OF MVP**.
- **Purchasing $\rightarrow$ Accounting:** Post-MVP.
- **Purchasing Reports:** Post-MVP.
- **Generic Visual Report Builder:** Out of scope.
- **Code Structure Migration Service (ADR-0035):** Not authorized.
- **External Taxpayer System Adapters:** Integration boundary deferred.

---

## 11. Required Implementation Boundaries

### If Track 1 (Phase 1A — Base Chart Content) is selected:
- **Scope:** Parse and load the Owner-approved chart content artifact into `accounting.base_chart_template_nodes` via existing `BaseChartAdoptionsService` / `BaseChartTemplatesService`.
- **Database Impact:** 0 migrations, 0 Prisma schema changes (uses existing models).
- **API Impact:** 0 new endpoints (uses existing template/version endpoints).
- **Verification:** Unit tests for content tree parsing + live-PostgreSQL E2E testing of complete organization adoption.

### If Track 2 (Phase 3A/3C — Full Inventory Operational Subsystem) is selected:
- **Scope:** Investigation gate first. Define operational document types (Material Request, Warehouse Receipt quantity, Warehouse Issue quantity), warehouse master data extensions, and workflow bindings on top of existing Inventory Core.
- **Valuation Boundary:** Restrict first operational slice to physical quantities; defer rial costing until OQ-24 resolution.

---

## 12. Required Verification

- **Local Fast Checks:** Lint (0 errors), Typecheck (clean), Format check (clean), Unit tests (all passing), Build (clean).
- **CI Verification:** GitHub Actions `CI` workflow (`backend` + `frontend` jobs) must complete successfully on the PR head, including live-PostgreSQL E2E and migration rehearsals.
- **Zero Production Drift:** `git diff` must be audited against scope boundaries.

---

## 13. Definition of Ready (DoR)

A candidate task is READY for implementation kickoff only when:
1. An explicit Owner Decision selects the candidate track and provides any required domain inputs (e.g. approved chart JSON for Track 1).
2. The task brief and prompt are documented in `docs/tasks/task-NN/`.
3. Blocking OQs for that specific track are formally resolved or bounded.
4. Acceptance criteria and verification commands are unambiguously specified.

---

## 14. Definition of Done (DoD)

The next implementation task is DONE only when:
1. All task-specific acceptance criteria are verified with passing tests.
2. 100% of unit and E2E test suites pass locally and in GitHub CI.
3. No security regressions exist (ODR-3 and permission-first verified).
4. Full implementation report and review documents are committed.
5. Owner review concludes with explicit `ACCEPTED` record before merge.

---

## 15. Expected Next Task

- **Task Number:** Task 29
- **Expected Nature:** Dependent on Owner Decision OD-27-03:
  - If Base Chart Content is approved $\rightarrow$ **Task 29: Base Chart Content Loading & Adoption Rehearsal (Phase 1A)**.
  - If Inventory is prioritized $\rightarrow$ **Task 29: Full Inventory / Warehouse Operational Subsystem Investigation Gate (Phase 3A/3C)**.
  - If Reporting is prioritized $\rightarrow$ **Task 29: Reporting Foundation & Code-Defined Registry Design Gate (Phase 2A)**.
  - If Security is prioritized $\rightarrow$ **Task 29: Audit Module & Identity Session Management Specification Gate (Phase 6.2/6.3)**.
- **Governing Rule:** Task 29 implementation MUST NOT start until the Owner provides the explicit kickoff prompt.
