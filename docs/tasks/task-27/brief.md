# Task 27 — Main Governance Reconciliation & MVP Gate

## 0. Task Identity

| Attribute | Value |
|---|---|
| **Task** | 27 |
| **Title** | Main Governance Reconciliation & MVP Gate |
| **Type** | Governance / Repository Audit / Documentation Reconciliation / MVP Readiness Gate |
| **Status** | **READY FOR REVIEW — NOT ACCEPTED** |
| **Audited `main` HEAD** | `cb521f4ba2662f4a4cdac7864cf0c712b6bba816` |
| **Target Branch** | `main` (work on `arena/01a0e41a-vardena`) |
| **Date** | 2026-09-27 |

---

## 1. Mission and Context

Perform a **main-based governance reconciliation and MVP readiness audit** following the merge of Task 26 / PR #71 (`e7fe80d04620170733ad9672d991ffd576607a5a`) and the subsequent Task 26 follow-up / PR #72 (`cb521f4ba2662f4a4cdac7864cf0c712b6bba816`).

The objective is to establish an accurate, evidence-backed picture of the repository as it exists **today on `main`**, reconcile documentation with actual implementation, verify the complete resolution of previous security findings (notably Task 25 SEC-01 and SEC-02), eliminate documentation drift, verify MVP boundaries (confirming Treasury and Purchasing remain deferred/post-MVP), and produce an authoritative Owner Decision Pack and candidate analysis for the next implementation gate.

This task is **NOT a feature implementation task**. The primary source of truth is the actual repository state on `main`.

---

## 2. Hard Scope Boundaries

### 2.1 Allowed

- Complete inspection of source code, tests, migrations, permissions, guards, module registrations, CI workflows, and Git history on `main`.
- Inspection of all task documentation, ADRs, OQs, `STATE.md`, roadmap documents, and security architecture.
- Creation and update of governance and documentation artifacts required by Task 27.
- Correction of factually stale documentation.
- Production of main-based reconciliation reports, capability matrices, and owner decision packs.
- Identification of blocking dependencies and actionable implementation candidates for future gates.

### 2.2 Forbidden

- NO implementation of new business capabilities or API endpoints.
- NO modification of production behavior or database schema / migrations.
- NO addition or modification of permissions, roles, or authorization guards.
- NO implementation of Base Chart content or accounting seed data.
- NO closing of Open Questions (OQs) or promotion of ADRs.
- NO invention of Owner Decisions or unauthorized task acceptances.
- NO drive-by refactoring or test mutation to conceal non-compliance.
- NO silent rewriting of historical audit findings.

---

## 3. Audited Baseline and Key Merges

- **Current `main` HEAD:** `cb521f4ba2662f4a4cdac7864cf0c712b6bba816`
- **Task 26 Merge Commit (PR #71):** `e7fe80d04620170733ad9672d991ffd576607a5a` (ODR-3 read-scope completion across 37 surfaces)
- **Task 26 Follow-up Merge Commit (PR #72):** `cb521f4ba2662f4a4cdac7864cf0c712b6bba816` (Default system administrator organization membership + bootstrap closure; ADR-0038 Proposed)
- **Task 25 Merge Commit (PR #70):** `e3c053f6a0c3735d8690251e9b04d4e32250b686` (Main-based governance audit @ `80944ce`)
- **Backend MVP Roadmap Merge Commit (PR #69):** `80944ce112dc16fd834585f8a4c2d83906547480`
- **Task 24 Merge Commits (PR #67 / #68):** `2aae5fba99671639fec4bffeb8877d3bcad09b6a` / `c654be916fe75e25ff2862900994c86aa1c20892`
- **Task 23 Merge Commit (PR #66):** `7754aaa2c96766963d4619f484ae4e20f10c711a` (Base Chart mechanism)
- **Task 22 Acceptance Merge Commit (PR #65):** `778a9d4bbfc313204c379f095f5e7b68e4487a7f`
- **Bootstrap System Administrator Merge Commit (PR #64):** `21306e53fd8e4c0c8db82338a2be75d3b8477eff`

---

## 4. Key Findings Summary

1. **Task 26 ODR-3 Read-Scope Completion (SEC-01 Remediated):** All 37 surfaces (28 list + 9 detail methods) identified in Task 25 SEC-01 now explicitly enforce `OrganizationsService.assertOrganizationInScope` immediately following their `requireAllPermissions` check. Permission-first ordering is 100% verified.
2. **Global Deployment Organization Scope Guard (SEC-02 Clarified):** Confirmed active as `APP_GUARD` in `backend/src/modules/organization/organization.module.ts:81`. Task 24's finding F-3 was factually erroneous and is formally retracted.
3. **Base Chart Distinction:** Base Chart *mechanism* (templates, versions, publish, adoption copy, leaf-only posting, read-time aggregation) is fully implemented and tested (Task 23); Base Chart *content* is NOT approved/implemented (0 seed rows in 17 migrations; OQ-25 remains OPEN).
4. **MVP Scope Boundary:** Treasury and Purchasing remain strictly outside MVP. No microservices, no workflow designer, no EAV, no generic cross-module DB access, no wildcard bypass.
5. **Governance State:** 22 ADRs Accepted, 15 ADRs Proposed. OQ-01..OQ-63 OPEN, OQ-64 RESOLVED. Tasks 23, 24, 25, 26 and Bootstrap Admin are MERGED / READY FOR REVIEW — NOT ACCEPTED.

---

## 5. Deliverables

```text
docs/tasks/task-27/
├── brief.md
├── prompt.md
├── main-based-reconciliation-report.md
├── task-acceptance-matrix.md
├── adr-reconciliation.md
├── oq-reconciliation.md
├── documentation-drift-report.md
├── owner-decision-pack.md
└── implementation-report.md
```

Also updated:
- `STATE.md`
- `docs/roadmap/backend-mvp-roadmap.md`
- `docs/roadmap/future-task-candidates.md`
