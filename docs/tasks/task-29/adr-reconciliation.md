# Task 29 — ADR Reconciliation

## 1. Architectural Decision Records Inventory & Alignment

This document reconciles all Architecture Decision Records (ADRs) relevant to the Accounting bounded context, Base Chart, and Chart of Accounts against the findings of Task 29.

**Governance Principle:** No ADR is promoted from `Proposed` to `Accepted` in Task 29 or by the OD-29-05 follow-up. All statuses are faithfully transcribed from repository baseline evidence; the Statement Classification owner decision records domain direction only and does not itself require or create a new ADR.

---

## 2. ADR Status & Reconciliation Table

| ADR Identifier & Title | Current Status | Relation to Task 29 | Reconciled Findings & Status | Owner Decision Required? |
|---|---|---|---|---|
| **ADR-0026: Accounting Bounded Context** | **Accepted** | Defines module boundaries, fiscal calendar ownership, and double-entry ledger | **Confirmed.** Task 29 confirms that all Base Chart and account structures reside strictly within the Accounting bounded context. | No (Already Accepted) |
| **ADR-0028: Accounting Configuration Foundation** | **Accepted** | Single ACTIVE configuration, versioned root, operational freeze | **Confirmed.** VARDENA coding structure ($1+2+3$) configures seamlessly under ADR-0028 versioned roots. | No (Already Accepted) |
| **ADR-0031: Balance Projection** | **Proposed** | Rebuildable turnover-only projection, zero-loss reconciliation | **Confirmed.** Leaf-only posting and turnover projections are unaffected by VARDENA $1+2+3$ coding. | Yes (Pending OD-27-04) |
| **ADR-0032: Accounting Period Close** | **Proposed** | In-transaction closing gate, reopen exception | **Confirmed.** Closing physics will eventually consume the `AccountType` model (`BALANCE_SHEET` vs `INCOME_STATEMENT`). | Yes (Pending OD-27-04) |
| **ADR-0033: Account Identity and Code History** | **Proposed** | `Account.id` is permanent identity; `code` is business address | **Confirmed.** Invariant 1 verified: Base chart templates use `nodeKey` during authoring; adopted ledger entries point to permanent `Account.id`. | Yes (Pending OD-27-04) |
| **ADR-0034: Posting Accounts Are Leaf Accounts; Aggregation Is Read-Time** | **Proposed** | `postable ⇒ leaf`; non-leaf accounts are derived aggregates | **Confirmed.** Task 29 confirms that posting is leaf-only (`postable ⇒ leaf`): 42 non-leaf accounts (8 Level 1 roots + 34 Level 2 parent accounts) are aggregation nodes, while 222 leaf accounts (218 Level 3 accounts + 4 childless Level 2 accounts: `307`, `602`, `703`, `704`) derive as postable leaves. | Yes (Pending OD-27-04) |
| **ADR-0035: Account Code Structure Migration** | **Proposed** | Controlled, audited migration; never rewrites ledger history | **Confirmed.** Initial loading of VARDENA chart establishes clean code shapes without migration retrofits. | Yes (Pending OD-27-04) |
| **ADR-0036: Legal Reporting Architecture** | **Proposed** | Legal Profile layering consuming Core read sources | **Confirmed.** Task 29 confirms English title is non-MVP metadata and statutory book layouts remain in Legal Profiles (ADR-0036). OD-29-05 Option C does not promote this ADR and does not decide statutory taxonomy, Iranian legal rules, Cash Flow, or other advanced reporting logic. | Yes (Pending OD-27-04) |
| **ADR-0037: Accounting Configuration Boundary** | **Proposed** | Base Chart template ownership, consumer-first control roles, line-level dimensions | **Confirmed.** Task 29 confirms proposed mapping of `ACLTafsil1..4` to line-level dimensions per ADR-0037 rather than adding rigid schema columns. OD-29-05 Option C keeps Statement Classification separate from Detail, Base Chart Coding Structure, Account Type, Account Nature, and System Account; no Base Chart content or configuration-schema implementation is approved. | Yes (Pending OD-27-04) |
| **ADR-0038: Installation Bootstrap of Pinned Deployment Organization** | **Proposed** | Provisions pinned deployment org and default admin | **Confirmed.** Unaffected by chart content reconciliation. | Yes (Pending OD-27-04) |

---

## 3. Summary of Governance Actions

1. **No Amendments Required:** None of the existing ADRs require structural amendments. The VARDENA Base Chart aligns directly with the architectural principles established in ADR-0033, ADR-0034, and ADR-0037. OD-29-05 records an Owner domain decision, not an ADR status change.
2. **Promotion Posture:** ADR-0031 through ADR-0038 remain in state **`Proposed`**, pending formal Owner Decision OD-27-04 ratification. No ADR is promoted to Accepted by recording OD-29-05 Option C.
3. **Future ADR Boundary:** If a later task introduces Statement Classification production architecture, Reporting Foundation behavior, statutory Legal Profile behavior, or a new reporting engine, that task must perform its own ADR-governance check; this follow-up does not pre-accept those designs.
