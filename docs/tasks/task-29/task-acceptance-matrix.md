# Task 29 — Acceptance Matrix

| Criterion | Requirement / Check | Verification Evidence | Status |
|---|---|---|---|
| **AC-01** | Latest `main` inspected | Commit `862c85da7aa1fb86cb16d53341fcfd9c39dfa50a` (Merge of PR #75) verified as baseline HEAD. | **PASS** |
| **AC-02** | Task 27 & Task 28 governance state reconciled | Inspected `docs/tasks/task-27/` and `docs/tasks/task-28/`; confirmed all previous baseline outcomes. | **PASS** |
| **AC-03** | OD-27-02 preserved | Preserved: Base Chart mechanism is MVP; concrete chart content is NOT MVP-required. | **PASS** |
| **AC-04** | VARDENA source artifact profiled | Documented exact 264 rows, 10 column attributes, and value ranges in `source-artifact-profile.md`. | **PASS** |
| **AC-05** | 264-account dataset structurally validated | 12 core structural checks performed and documented in `content-validation-report.md`. | **PASS** |
| **AC-06** | 1+2+3 coding structure reconciled with Vardena | Verified compatibility with `CodingStructureVersion`, `checkAccountCode`, and `planTemplateCompatibility` in `coding-fit-gap.md`. | **PASS** |
| **AC-07** | Account Type reconciled as three fixed global types | Reconciled `BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM` in `account-type-decision.md`. | **PASS** |
| **AC-08** | Balance Nature reconciled as Debit/Credit/Dual | Reconciled `بدهکار` $\rightarrow$ `DEBIT`, `بستانکار` $\rightarrow$ `CREDIT`, `هردو` $\rightarrow$ `DUAL` in `account-nature-decision.md`. | **PASS** |
| **AC-09** | Account Type and Balance Nature explicitly separated | Verified orthogonality: Type (closing/period behavior) vs Nature (balance orientation). | **PASS** |
| **AC-10** | Statement Classification analyzed and Owner Decision recorded | Defined presentation mapping role in `statement-class-analysis.md`; separated from Account Type, Account Nature, Account Hierarchy / Chart of Accounts, Detail, System Account, and Base Chart Coding Structure; OD-29-05 recorded as **DECIDED — OPTION C**. | **PASS** |
| **AC-11** | System Account decision reconciled | Preserved the historical analysis and recorded OD-29-06: MVP has no `isSystem` or equivalent System Account concept. | **PASS** |
| **AC-12** | Detail hierarchy and requirements reconciled | Recorded OD-29-03 hierarchy, first-level Account relationship, backend enforcement, and controlled-removal constraints while leaving physical design unimplemented. | **PASS** |
| **AC-13** | English Title classified as non-MVP | Recorded the Owner decision that `عنوان انگلیسی حساب` is not required for MVP and its absence blocks no lifecycle operation (OD-29-04). | **PASS** |
| **AC-14** | No production implementation performed | Verified 0 production code/schema/migration/API/guard/test modifications in git diff. | **PASS** |
| **AC-15** | OQ-25 not incorrectly closed | Recorded Task 29 findings and proposals; OQ-25 officially remains **OPEN** in `oq-reconciliation.md`. | **PASS** |
| **AC-16** | Relevant ADRs reconciled | Audited ADR-0026..ADR-0038 in `adr-reconciliation.md`; no ADR promoted without Owner approval. | **PASS** |
| **AC-17** | Owner decisions clearly marked | Cataloged decisions accurately: OD-27-02 and OD-29-01/02/03/04/05/06 `DECIDED`; OD-29-05 is **DECIDED — OPTION C**, with closure in `owner-decision-closure.md` and `od-29-05-statement-classification-decision-pack.md`. | **PASS** |
| **AC-18** | Future implementation dependencies identified | Recorded future dependencies without authorization; Task 30 and Detail implementation each retain a separate gate in `implementation-readiness.md`. | **PASS** |
| **AC-19** | No invented chart content | No synthetic codes, Persian titles, or statutory rules invented; source artifact used as truth. | **PASS** |
| **AC-20** | Task is ready for human review | All documentation complete, internally consistent, and formatted for human review. | **PASS** |

---

## Final Gate Verification

- **Task Status:** **`READY FOR REVIEW — NOT ACCEPTED`**
- **Production Modifications:** **0 files**
- **Owner Decision Matrix:** OD-29-05 updated from `PENDING OWNER DECISION` to **`DECIDED — OPTION C`**
- **Documentation Deliverables:** **17 files** under `docs/tasks/task-29/` (including the Owner decision closure record and OD-29-05 decision pack)
