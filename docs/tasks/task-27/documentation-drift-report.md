# Task 27 — Documentation Drift Report

**Audited `main` commit:** `cb521f4ba2662f4a4cdac7864cf0c712b6bba816` · **Date:** 2026-09-27 ·
**Status:** READY FOR REVIEW — NOT ACCEPTED

---

## 1. Executive Summary of Drift Status

Task 27 audited the repository for documentation drift following the merges of Task 25 (PR #70), Task 26 (PR #71), and Task 26 Follow-up (PR #72).

Previous high-severity drifts identified in Task 25 (notably DR-01 / SEC-01 and DR-02 / SEC-02) have been fully resolved in the codebase and documentation. The table below provides the authoritative status of all documented drifts.

---

## 2. Drift Inventory and Reconciliation

| Drift ID  | Prior Severity | Document / Location                        | Claim / Finding                                                                                                        | Actual State on `main` @ `cb521f4`                                                                                                                                                         | Resolution / Status in Task 27 |
| --------- | -------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| **DR-01** | CRITICAL       | `docs/security.md` §3                      | Claimed all org-scoped reads/writes passed through `assertOrganizationInScope`, but 37 read surfaces did not (SEC-01). | **RESOLVED.** Task 26 (PR #71) added `assertOrganizationInScope` to all 37 surfaces. Verified by `organization-read-scope-completion.spec.ts` (38 tests PASS). `docs/security.md` updated. | **RESOLVED in Code & Docs**    |
| **DR-02** | HIGH           | `docs/tasks/task-24/` §F-3                 | Claimed no global `APP_GUARD` existed for `DeploymentOrganizationScopeGuard`.                                          | **RESOLVED.** `organization.module.ts:81` confirms `{ provide: APP_GUARD, useClass: DeploymentOrganizationScopeGuard }` is globally active. F-3 error retracted.                           | **RECONCILED in Docs**         |
| **DR-03** | HIGH           | `docs/tasks/task-24/` §F-2                 | Sized the organization-scope read gap at 4 Accounting list surfaces instead of the full 37 surfaces.                   | **RESOLVED.** Task 26 implemented the complete 37-surface remediation across Accounting, Documents, Inventory, Organization, and Workflow modules.                                         | **RESOLVED in Code**           |
| **DR-04** | MEDIUM         | `docs/tasks/task-23/brief.md`              | Pre-implementation report labeled "NOT ADMITTED".                                                                      | **HISTORICAL RECORD.** Task 23 implementation was subsequently merged in PR #66. Historical brief retained as-is; status recorded in task matrix.                                          | **RECONCILED**                 |
| **DR-05** | LOW            | `organization-permissions.ts`              | Doc-comment claimed membership grant did not require grantor membership (contradicting PR #55).                        | **RESOLVED.** Corrected in Task 25 (PR #70) via comment-only update.                                                                                                                       | **RESOLVED in PR #70**         |
| **DR-06** | LOW            | `docs/roadmap/future-task-candidates.md`   | Candidates C-01, C-05, and C-06 still listed as pending investigation/admission.                                       | **RESOLVED.** Reconciled in Task 27: C-05 resolved in PR #70, C-06 resolved in PR #71, C-01 resolved in PR #72.                                                                            | **RESOLVED in Docs**           |
| **DR-07** | MEDIUM         | `docs/accounting/domain-contract.md`       | Header notes document as Proposed/unimplemented despite ADR-0026 being Accepted.                                       | **RECONCILED.** ADR-0026 Accepted status confirmed; domain contract is an evolving architectural baseline. Section 31 addendum clarifies relationship.                                     | **RECONCILED**                 |
| **DR-08** | MEDIUM         | `docs/accounting/task-index.md` §6/§8      | Task 12 labeled "ACCEPTED WITH FOLLOW-UP" while P1 PostgreSQL concurrency check remains open.                          | **RECONCILED.** Documented in STATE.md §7/§8 and Roadmap §7.3 as an open follow-up verification on real PostgreSQL.                                                                        | **RECONCILED**                 |
| **DR-09** | MEDIUM         | `docs/adr/README.md`                       | ADR-0017..0021 Proposed while code was implemented in earlier tasks.                                                   | **RECONCILED.** Formally classified as "Implementation ahead of governance" in `adr-reconciliation.md`; tracked for Owner adoption gate.                                                   | **RECONCILED**                 |
| **DR-10** | LOW            | `docs/roadmap/backend-mvp-roadmap.md` §5.6 | Phase 6.1 listed F-2 list-scope completion as pending.                                                                 | **RESOLVED.** Section 5.6 updated to reflect Task 26 completion of ODR-3 read-scope enforcement.                                                                                           | **RESOLVED in Docs**           |

---

## 3. Residual Verification

- Zero unclassified or unrecorded documentation drift items remain on `main`.
- All governance documents (`STATE.md`, `docs/roadmap/backend-mvp-roadmap.md`, `docs/roadmap/future-task-candidates.md`, `docs/adr/README.md`, `docs/open-questions.md`) are internally consistent and aligned with current repository code.
