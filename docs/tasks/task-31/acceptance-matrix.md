# Task 31 — Acceptance Matrix

**Status:** READY FOR REVIEW — NOT ACCEPTED  
**Scope:** documentation and governance records only

| AC | Status | Evidence | Notes |
|---|---|---|---|
| AC-31-01 Main baseline verified | PASS | `git rev-parse HEAD` = `016ecf09cdae7c64aa4774e857fd0a87e16099d1`; branch based on merged `main` | Baseline recorded. |
| AC-31-02 Task 30 merge verified | PASS | PR #80 merged; merge `016ecf09cdae7c64aa4774e857fd0a87e16099d1` | Matches repository HEAD. |
| AC-31-03 Task 30 implementation evidence reconciled | PASS | Migration path, source paths, tests, Task 30 AC matrix, PR and CI `36478305767` | Implemented/merged distinguished from acceptance. |
| AC-31-04 Owner Decisions reconciled | PASS | Task 28 matrix/record, Task 29 closure, Task 31 state matrix | 7 decided; 9 pending; no decisions invented. |
| AC-31-05 OQs reconciled | PASS | `docs/open-questions.md`, Task 29 OQ record, Task 31 report | OQ-25/36/41/43 remain open where evidence requires. |
| AC-31-06 ADR statuses reconciled | PASS | `docs/adr/README.md`, ADR files, Task 28/29 records | No Proposed ADR promoted. |
| AC-31-07 STATE.md reconciled | PASS | Dated post-Task-30 addendum in `STATE.md` | Historical task ledger preserved. |
| AC-31-08 Roadmap reconciled | PASS | Task 31 gate and matrix; roadmap/OQ boundary references | No roadmap candidate treated as authorization. |
| AC-31-09 Stale Task 28 gate superseded without destroying history | PASS | New `task-31/next-implementation-gate.md`; historical Task 28 file unchanged | Current vs historical authority explicit. |
| AC-31-10 Current implementation gate established | PASS | `docs/tasks/task-31/next-implementation-gate.md` | Blocked — Owner Decision Required. |
| AC-31-11 Treasury/Purchasing boundaries preserved | PASS | Task 31 gate, matrix and STATE addendum | Includes Purchasing→Accounting and Purchasing Reports. |
| AC-31-12 No FaraPayam content promoted | PASS | Scope audit; no seeds/content changes; Task 31 boundary statements | Artifact remains source/compatibility material only. |
| AC-31-13 Statement Classification decided but not implemented | PASS | OD-29-05 Option C; Task 30 AC-30-10; no schema/API/seed | Future Reporting Foundation only. |
| AC-31-14 Task 30 aligned with approved decisions | PASS | Task 30 AC-30-01..11 and implementation report | Nature, Type, Detail, unlink, no System Account verified. |
| AC-31-15 No production/schema/migration/permission/behavior changes introduced | PASS | Task 31 diff is documentation-only; `git diff --check` | No backend/frontend/Prisma/migration/test changes. |
| AC-31-16 Drift findings closed or tracked | PASS | `documentation-drift-report.md` | Historical findings intentionally tracked, not rewritten. |
| AC-31-17 CI/governance validation complete | PASS (repository evidence) | Existing green CI `36478305767`; local markdown/path/diff checks | Task 31 CI is to be authoritative after PR creation. |

**Acceptance conclusion:** all documentation-audit criteria pass for review. This matrix does not claim Owner acceptance of Task 31 before review/merge.
