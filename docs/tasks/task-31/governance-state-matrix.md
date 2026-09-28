# Task 31 — Governance State Matrix

**Baseline:** `016ecf09cdae7c64aa4774e857fd0a87e16099d1`

| Item | Decision | Implementation | Merged | Accepted | Current Status | Evidence | Next Action |
|---|---|---|---|---|---|---|---|
| OD-27-01 | Pending | Earlier backlog exists | Yes, historical PRs | No current acceptance record identified | PENDING OWNER DECISION | Task 28 matrix | Owner acceptance decision |
| OD-27-02 | Decided: mechanism MVP; content not required | Mechanism implemented | Yes, Task 23 history | Historical acceptance distinction retained | DECIDED / MECHANISM IMPLEMENTED / CONTENT OPEN | Task 28 decision record; Base Chart source/models | Keep OQ-25 content open |
| OD-27-03 | Pending next direction | No next track selected | N/A | N/A | PENDING OWNER DECISION | Task 28 matrix; Task 31 gate | Owner selects track |
| OD-27-04 | Pending ADR ratification | Several ADR subjects implemented | Yes, historical work | ADRs remain Proposed | PENDING OWNER DECISION | ADR index; Task 28/31 reconciliation | Owner promotion/rejection decision |
| OD-28-01 | Pending | Not authorized | No | No | PENDING OWNER DECISION | Task 28 matrix | Decide when Base Chart lifecycle work admitted |
| OD-28-02 | Pending | No durable integration semantics | No | No | PENDING OWNER DECISION | Task 28 matrix; OQ-39 | Decide before system posting |
| OD-28-03 | Pending | No automated source posting mode | No | No | PENDING OWNER DECISION | Task 28 matrix; OQ-42 | Decide before integration |
| OD-28-04 | Pending | No valuation engine | No | No | PENDING OWNER DECISION | Task 28 matrix; OQ-24/OQ-11 | Decide before valuation flows |
| OD-28-05 | Pending | Sales module absent | No | No | PENDING OWNER DECISION | Task 28 matrix; OQ-30/OQ-38 | Decide before Sales |
| OD-28-06 | Pending | Legal book specification absent | No | No | PENDING OWNER DECISION | Task 28 matrix; OQ-43 | Decide before statutory implementation |
| OD-29-01 | Decided | Implemented (`DEBIT`, `CREDIT`, `DUAL`; permissive opposite side) | Yes, PR #80 | PR/CI verified; no separate acceptance record found | IMPLEMENTED / MERGED; acceptance distinct | Task 30 AC-30-01/02; PR #80 | No new decision; future posting policies remain open |
| OD-29-02 | Decided | Implemented three Account Types and posted-ledger immutability | Yes, PR #80 | PR/CI verified; no separate acceptance record found | IMPLEMENTED / MERGED; acceptance distinct | Task 30 AC-30-03/04; PR #80 | Future lifecycle/closing rules remain open |
| OD-29-03 | Decided | Implemented Detail hierarchy, linkage, validation, atomic unlink | Yes, PR #80 | PR/CI verified; no separate acceptance record found | IMPLEMENTED / MERGED; acceptance distinct | Task 30 AC-30-05..08; PR #80 | Preserve OQ-41 remaining questions |
| OD-29-04 | Decided | No implementation required for non-MVP English title | N/A | Decision recorded | DECIDED / NON-MVP | Task 29 closure | Separate decision if later needed |
| OD-29-05 | Decided Option C | Not implemented; no Accounting Core schema/API/seed | No | Decision recorded, not implementation acceptance | DECIDED / NOT IMPLEMENTED | Task 29 closure; Task 30 AC-30-10 | Reporting Foundation requires future authorization |
| OD-29-06 | Decided no System Account | Confirmed absent in MVP | Yes, PR #80 audit | PR/CI verified; no separate acceptance record found | IMPLEMENTED BY ABSENCE / MERGED | Task 30 AC-30-09 | Do not add equivalent concepts |
| Task 27 | Governance reconciliation | Documentation artifacts merged historically | Yes, historical | Historical record governs its date | HISTORICAL | `docs/tasks/task-27/` | Use Task 31 for current state |
| Task 28 | Decision/gate reconciliation | Documentation artifacts merged historically | Yes, historical | Historical status retained | HISTORICAL / SUPERSEDED CURRENT GATE | `docs/tasks/task-28/` | Use Task 31 gate |
| Task 29 | Accounting-domain decision gate | Decisions recorded; no implementation at closure | Yes, historical | Historical wording retained | HISTORICAL / DECISIONS IMPLEMENTED LATER | `docs/tasks/task-29/` | Do not rewrite |
| Task 30 | Approved accounting foundation | Account semantics and Detail foundation implemented | Yes, PR #80 / `016ecf0` | No separate Owner acceptance record identified; CI green | IMPLEMENTED / MERGED / READY FOR REVIEW | Task 30 artifacts; CI `36478305767` | Owner review/acceptance if required |
| OQ-25 | Partially decided | Mechanism exists; content not loaded | N/A | Not closed | OPEN | `docs/open-questions.md`; Task 31 report | Keep content decisions open |
| Statement Classification | Option C decided | Not implemented | No | Decision recorded only | DECIDED / NOT IMPLEMENTED | OD-29-05; no schema/API/seed | Future Reporting Foundation gate |
| Base Chart mechanism | OD-27-02 MVP | Implemented | Yes, Task 23 history | Historical acceptance status preserved | IMPLEMENTED | Base Chart models/services/tests | Maintain mechanism |
| Base Chart content | Not decided / not MVP-required | Not loaded; zero content promoted | No | No | BLOCKED / NOT MVP-REQUIRED | OQ-25; Task 28 record | Separate content artifact + authorization |
| Treasury | Outside MVP/post-v1 | Not implemented | No | No | OUTSIDE MVP | Roadmap; STATE.md | No implementation |
| Purchasing | Outside MVP/post-v1 | Not implemented | No | No | OUTSIDE MVP | OQ-16; roadmap; STATE.md | No implementation |
