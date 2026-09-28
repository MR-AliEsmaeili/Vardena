# Task 31 — Current Next Implementation Gate

**Authority:** current post-Task-30 governance state  
**Status:** **BLOCKED — OWNER DECISION REQUIRED**  
**Baseline:** `016ecf09cdae7c64aa4774e857fd0a87e16099d1` (PR #80 merge)

## 1. Implemented

- Accounting Core foundations already merged, including the Base Chart **mechanism** (template/version lifecycle, adoption by copy, published immutability, organization ownership separated from ledger identity, leaf-only posting and read-time aggregation).
- Task 30 implementation of Account Nature (`DEBIT`, `CREDIT`, `DUAL`), Account Type (`BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM`), configurable Detail hierarchy and Account-to-Level-1 Detail Group foundation, posting-boundary validation, and confirmed absence of System Account concepts.
- Organization isolation and existing accounting authorization foundations remain in place.

Evidence: PR #80, merge `016ecf09cdae7c64aa4774e857fd0a87e16099d1`, CI `36478305767`, Task 30 artifacts and source paths listed in the reconciliation report.

## 2. Decided but not implemented

- **OD-29-05 = Option C:** organization-configurable Statement Classification, independent from Chart, Account Type, Nature, Detail and System Account. No taxonomy, schema, API, UI, seed or Reporting Foundation behavior is approved by that decision.
- Concrete Base Chart content is not MVP-required under OD-27-02. OQ-25 content questions remain open.

## 3. Open and blocked matters

- OD-27-01, OD-27-03 and OD-27-04 remain pending.
- OD-28-01..OD-28-06 remain pending.
- OQ-25, OQ-36, OQ-41 and OQ-43 remain open in the affected areas; other registry OQs retain their recorded statuses.
- No evidence selects a next production track or authorizes a new implementation task after Task 30.

## 4. Legitimate next capability

No production capability can be selected by the Auditor. The next legitimate implementation task is **not yet selected**. A future Owner-authorized task may be prepared only after the Owner selects a track and supplies/ratifies any required domain decisions and scope.

Therefore the current gate is:

> **BLOCKED — OWNER DECISION REQUIRED: select and explicitly authorize the next implementation direction.**

The authority for that selection is the Repository Owner through a recorded Owner Decision and approved task brief/prompt. A roadmap candidate, historical recommendation, green CI, or this document is not authorization.

## 5. Must not be implemented yet

Until that authority exists, do not implement:

- Base Chart concrete content, standard codes/titles/natures, statutory catalogues, account seeds, or FaraPayam content;
- Statement Classification or Reporting Foundation;
- Inventory→Accounting, Sales, Purchasing, Purchasing→Accounting, Purchasing Reports, or Treasury;
- any cross-module posting requiring OQ-39/OQ-42 decisions;
- any capability that would rewrite historical governance or promote a Proposed ADR.

Treasury, Purchasing, Purchasing→Accounting and Purchasing Reports remain outside MVP/post-v1 boundaries as recorded by the roadmap and OQ-16. This gate does not re-admit them.
