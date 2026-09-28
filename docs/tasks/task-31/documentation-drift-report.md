# Task 31 — Documentation Drift Report

**Baseline:** `016ecf09cdae7c64aa4774e857fd0a87e16099d1`  
**Status:** READY FOR REVIEW — NOT ACCEPTED

| Severity | Document | Section / statement | Actual repository state | Required correction | Corrected in Task 31? |
|---|---|---|---|---|---|
| HIGH | `docs/tasks/task-28/next-implementation-gate.md` | Current gate says implementation is blocked before Task 29 and presents Task 29 as the expected next task. | Task 29 decisions and Task 30 are now recorded; Task 30 is implemented and merged. | Establish a dated current gate without rewriting Task 28 history. | Yes, superseded by `task-31/next-implementation-gate.md`; historical file intentionally untouched. |
| HIGH | `docs/tasks/task-29/implementation-readiness.md` | Proposed Task 30 and later Base Chart ingestion sequence describe pre-Task-30 model gaps. | Task 30 is implemented/merged; Base Chart content remains not MVP-required and content loading remains blocked. | Treat Task 29 readiness as historical and use Task 31 for current status. | Yes, current contradiction is explicitly reconciled in Task 31; historical file untouched. |
| HIGH | `STATE.md` | Pre-Task-30 state and task ledger do not provide a single concise post-Task-30 current gate. | PR #80 is merged at the audited baseline; current OD/OQ and scope boundaries need a dated addendum. | Add smallest dated current-state addendum; preserve historical ledger. | Yes. |
| MEDIUM | `docs/tasks/task-29/owner-decision-closure.md` | Says Task 30 was not authorized. | That was correct at Task 29 closure; Task 30 was subsequently authorized and merged by PR #80. | Preserve historical wording and cross-reference the current Task 31 state. | Yes, handled by Task 31 report; historical file untouched. |
| MEDIUM | `docs/tasks/task-28/owner-decision-matrix.md` | Matrix is dated before Task 29/30 and lists only its then-audited decisions. | OD-29 decisions are recorded later; Task 30 implementation is now merged. | Do not mutate historical matrix; use Task 31's consolidated matrix. | Yes, current matrix added; historical file untouched. |
| LOW | `docs/tasks/task-30/implementation-report.md` | Uses “passing” and implementation language but is not itself a separate Owner acceptance record. | PR #80 merge and CI are verified; acceptance must remain distinct from merge. | Preserve report and state distinction explicitly. | Yes, clarified in Task 31 artifacts; Task 30 report untouched. |
| INFORMATIONAL | `docs/open-questions.md` | OQ-25 and OQ-41 contain long historical annotations. | They remain open despite adjacent decisions/implementation. | Keep open status and avoid false closure. | Yes, recorded in reconciliation; source registry unchanged. |
| INFORMATIONAL | `docs/adr/README.md` and ADR files | Some Proposed ADRs describe implemented capabilities. | Proposed status remains truthful until separately promoted. | Do not auto-promote. | Yes, recorded; files intentionally untouched. |

No critical production-documentation defect was found that can be corrected without changing historical meaning. Remaining historical wording is intentional and tracked rather than rewritten.
