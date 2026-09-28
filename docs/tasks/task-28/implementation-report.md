# Task 28 — Implementation Report

## Status

**READY FOR REVIEW — NOT ACCEPTED**

---

## Main SHA

`ff4b9f24d1c3797712c88fcd61432c3c315dbf4f` (Merge of PR #73 / Task 27 on `main`).

---

## Task 28 Follow-up (2026-09-27) — OD-27-02 Owner Decision Recorded

After the original Task 28 audit, the Owner provided an **explicit Owner Decision for OD-27-02 / OQ-25** (MVP scope boundary). It is recorded in this follow-up as a **governance/documentation update only**.

### Decision Recorded (OD-27-02)

> **DECIDED — MVP requires the Base Chart mechanism, but does not require a concrete Base Chart content set.**

- **MVP mechanism scope (provided and retained):** Base Chart template model; versioned template lifecycle; Draft → Approved → Published → Superseded lifecycle; organization adoption semantics; adoption by copy, not live reference; immutable published-version semantics; no silent mutation of an adopted organization chart when the template changes; partial-adoption governance already established by Task 21; separation between Base Chart Template / organization-owned accounts / ledger identity; leaf-only posting invariant; read-time/report-time aggregation.
- **Explicit MVP boundary:** for MVP, do NOT introduce a concrete standard Base Chart content set merely by implementation inference — no standard account codes, Persian account titles, account natures, mandatory-account list, concrete control-role catalog, statutory account requirements, or assumed Iranian accounting chart content. No migration or seed may introduce such content unless a separately approved content artifact exists.
- **Distinction:** **Base Chart mechanism = MVP; concrete Base Chart content = NOT MVP-required.** Base Chart functionality is not removed or deferred — the product must be capable of supporting a Base Chart, while actual accounting content remains organization/domain-owner controlled until an explicit approved content artifact is provided.
- **OQ-25 handling:** OQ-25 is NOT fully resolved — only its MVP-scope question is decided. Content decisions remain explicitly open: concrete Base Chart content values, concrete account codes, Persian titles, account natures, mandatory-account set, concrete control-role catalog/mandatory set, and any other content decisions already identified by Task 21 as unresolved. All prior OQ-25 history is preserved.
- **Task 23 / Task 21 treatment:** unchanged. Task 23 remains the Base Chart mechanism implementation; Task 21 remains the accepted governance baseline. This decision only establishes the MVP boundary between mechanism/capability and concrete accounting content.
- **Governance constraints of the follow-up:** documentation only; no production code, Prisma schema, migrations, or seeds; no standard chart or control-role catalog introduced; no unrelated OQ closed; no unrelated ADR promoted; no next implementation task selected; no additional Owner decisions fabricated.

### Files Changed by This Follow-up (and why)

| File                                                        | Why changed                                                                                                                                                                                                                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/tasks/task-28/owner-decision-matrix.md`               | Record OD-27-02 as `DECIDED` (2026-09-27) with the decision text; update decision-state summary (1 decided / 9 pending).                                                                                                                        |
| `docs/tasks/task-28/owner-decision-record.md`               | Record the full OD-27-02 decision in Decision 1 (mechanism list, MVP boundary, mechanism-vs-content distinction, OQ-25 handling, Task 21/23 treatment) and its consequence; update the decision summary.                                        |
| `docs/tasks/task-28/oq-reconciliation.md`                   | Add the OD-27-02 decision note to the Base Chart gate analysis; correct the "affects MVP?" answer (mechanism only, content not MVP-required); annotate the OQ-25 row as still OPEN with the MVP-scope sub-question decided; extend the summary. |
| `docs/tasks/task-28/implementation-report.md`               | This follow-up record (decision text, changed-file list, verification).                                                                                                                                                                         |
| `docs/tasks/task-28/mvp-implementation-readiness-matrix.md` | Annotate the Base Chart Content row and Track 1 summary: content not MVP-required per OD-27-02; still blocked by OQ-25 content decisions.                                                                                                       |
| `docs/tasks/task-28/next-implementation-gate.md`            | Annotate Track 1 / OD-27-02 references: MVP boundary decided; Track 1 still gated by a separately approved content artifact.                                                                                                                    |
| `docs/open-questions.md`                                    | Append a dated "Task 28 follow-up" note to the OQ-25 row recording OD-27-02; row remains OPEN; all prior notes preserved.                                                                                                                       |
| `STATE.md`                                                  | §7 Task 28 row, §8 Current Task and §9 OQ-25 row updated with the dated OD-27-02 decision record.                                                                                                                                               |
| `docs/roadmap/backend-mvp-roadmap.md`                       | Reconcile statements that tied concrete Base Chart content to the MVP: Phase 1A item, §2.6 blocked-path list, and the Phase 8 gate checklist line now cite OD-27-02 (mechanism required; content not MVP-required).                             |
| `docs/roadmap/backend-mvp-dependency-matrix.md`             | Reconcile the OQ-25 row ("Required before Backend MVP?") with OD-27-02: the concrete content set is not required before Backend MVP; Phase 1A loading remains decision-gated.                                                                   |

**No other file was changed.** Historical inputs (`docs/tasks/task-28/brief.md`, `prompt.md`, `task-acceptance-matrix.md`, `adr-reconciliation.md` and all Task 21/23/27 artifacts) are preserved unchanged as historical records; the authoritative decision state now lives in the decision artifacts above.

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
- **OD-27-02 (Base Chart Content / OQ-25):** `DECIDED (2026-09-27, Task 28 follow-up)` — **MVP requires the Base Chart mechanism, but does not require a concrete Base Chart content set.** The decision records the MVP mechanism scope, the explicit do-not-invent content boundary, and the mechanism-vs-content distinction. It authorizes no implementation, closes no OQ, and leaves the OQ-25 content decisions open. (See the follow-up section above and `owner-decision-record.md` Decision 1.)
- **OD-27-03 (Next Implementation Direction):** `PENDING OWNER DECISION` (Four candidate tracks evaluated).
- **OD-27-04 (ADR Ratification):** `PENDING OWNER DECISION` (8 implemented ADRs remain `Proposed` in registry).
- **Zero fabricated decisions:** No decision has been made on behalf of the Owner; OD-27-02 is recorded from the explicit Owner-provided decision text only.

---

## OQ-25

- **Status:** **OPEN — CONTENT DECISIONS STILL REQUIRED; MVP-scope sub-question DECIDED (OD-27-02, 2026-09-27)**.
- **Reconciliation:** The Base Chart _mechanism_ (Task 23) is verified complete and operational on `main` and is confirmed MVP scope per OD-27-02. Concrete chart _content_ (codes, titles, levels, natures, postability flags, control roles) is **NOT MVP-required**, has 0 rows in migrations or seeds, and must not be introduced by implementation inference — only a separately approved content artifact may introduce it. OQ-25 is therefore **not fully resolved**: the MVP-scope question is decided, while the content-level decisions (content values, account codes, Persian titles, natures, mandatory-account set, control-role catalog/mandatory set, other Task 21 unresolved content items) remain explicitly open.
- **Invariants Preserved:**
  1. _Template identity ≠ Ledger identity_ (Verified)
  2. _Adoption = Copy_ (Verified)
  3. _Posting = Leaf-only_ (Verified)
  4. _Aggregation = Read-time_ (Verified)
- Direct Base Chart content implementation (Phase 1A) remains **BLOCKED** until a separately approved chart content artifact exists. All prior OQ-25 history is preserved.

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
  1. **Track 1 (Phase 1A — Accounting Base Chart Content):** JSON/fixture loader for approved chart nodes through Task 23 API. _(Still gated: OD-27-02 (DECIDED 2026-09-27) settled only the MVP boundary — mechanism in MVP, content not MVP-required; Track 1 is unblocked only when a separately approved content artifact is provided under OQ-25)_.
  2. **Track 2 (Phase 3A/3C — Full Inventory / Warehouse Operational Flow):** Investigation gate for warehouse coding, Material Requests, and quantity Receipt/Issue flows. _(Unblocked if Owner selects Track 2 under OD-27-03)_.
  3. **Track 3 (Phase 2A — Reporting Foundation Design Gate):** Code-defined report registry and pipeline over existing Accounting read queries. _(Unblocked if Owner selects Track 3 under OD-27-03)_.
  4. **Track 4 (Phase 6.2/6.3 — Audit & Identity Session Completion):** Specification gate for persistent audit logs and session management endpoints. _(Unblocked if Owner selects Track 4 under OD-27-03)_.

---

## Authorization State

- **Production Code Authorization:** **NONE**.
- No implementation task is currently authorized to write production code.
- Implementation begins only in the subsequent task (e.g., Task 29) after the Owner accepts Task 28 and issues the specific kickoff prompt.

---

## Remaining Blockers

1. **Owner Decisions:** OD-27-01 (Acceptance Backlog), OD-27-03 (Track Selection), OD-27-04 (ADR Ratification) — all remain `PENDING OWNER DECISION`. **OD-27-02 is decided (2026-09-27) for the MVP scope boundary only**: the MVP proceeds with the Base Chart mechanism and without a concrete content set; a separately approved content artifact is still required before any content loading (Phase 1A) may be authorized.
2. **Domain Open Questions:** OQ-25 (Chart content — content-level decisions remain open; MVP-scope sub-question decided by OD-27-02), OQ-24 (Inventory valuation), OQ-30 (Sales tax), OQ-39 (Integration semantics), OQ-42 (Posting mode), OQ-43 (Statutory book formats).

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
- **2026-09-27 follow-up (OD-27-02 recorded):** `docs/tasks/task-28/owner-decision-matrix.md`, `docs/tasks/task-28/owner-decision-record.md`, `docs/tasks/task-28/oq-reconciliation.md`, `docs/tasks/task-28/mvp-implementation-readiness-matrix.md`, `docs/tasks/task-28/next-implementation-gate.md`, `docs/tasks/task-28/implementation-report.md` (this file), `docs/open-questions.md` (OQ-25 note appended), `STATE.md` (§7/§8/§9), `docs/roadmap/backend-mvp-roadmap.md`, `docs/roadmap/backend-mvp-dependency-matrix.md` — see the follow-up section for the per-file rationale.

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
2. **Owner Action 2 (OD-27-02 / OQ-25 — MVP scope now DECIDED):** The MVP requires the Base Chart mechanism (in place, Task 23) and proceeds **without** a concrete content set. If and when a standard chart is wanted, provide the approved Iranian SME Chart of Accounts specification artifact (a separately approved content artifact) and authorize **Task 29: Base Chart Content Loading (Phase 1A)**; until then no content may be introduced by implementation inference.
3. **Owner Action 3 (OD-27-03):** Select the next implementation track — e.g. **Task 29: Full Inventory / Warehouse Operational Subsystem Investigation Gate (Phase 3A/3C)** or **Task 29: Reporting Foundation Design Gate (Phase 2A)** — noting that Track 1 (Base Chart content) remains available only after a content artifact is approved.

---

## Acceptance

Task 28 is **READY FOR REVIEW — NOT ACCEPTED**.
Explicit Owner review and acceptance are required before proceeding to the next task.
