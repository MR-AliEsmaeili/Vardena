# Task 29 — Owner Decision Pack

## 1. Summary Status of Owner Decisions

| Decision ID | Area | Subject | Status | Gating Effect |
|---|---|---|---|---|
| **OD-27-02** | Accounting / Base Chart | Base Chart MVP Scope Boundary (Mechanism = MVP, Concrete Content = Non-MVP) | **DECIDED** (Task 28 Follow-up) | Mechanism unblocked; concrete content gated by separate approval |
| **OD-29-01** | Accounting Domain | Account Nature: exactly `DEBIT`, `CREDIT`, `DUAL`; `DUAL` is independent; Nature does not prohibit opposite-side entries | **DECIDED** (2026-09-28) | Runtime support remains an implementation prerequisite for `DUAL` content |
| **OD-29-02** | Accounting Domain | Account Type: exactly `BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM`; immutable after first Posting | **DECIDED** (2026-09-28) | Runtime schema and immutability enforcement remain implementation prerequisites |
| **OD-29-03** | Accounting / Dimensions | Detail Flags: Map `ACLTafsil1..4` to Generic Line-Level Dimension Requirements | **PENDING OWNER DECISION** | Prevents anti-pattern of hardcoding numbered columns |
| **OD-29-04** | Master Data / i18n | English Account Title is not required for MVP and its absence blocks no account lifecycle operation | **DECIDED** (2026-09-28) | English title is not an MVP or Base Chart blocker |
| **OD-29-05** | Reporting / Presentation | Statement Class: Define Statement Class as Configurable Post-MVP Capability | **PENDING OWNER DECISION** | Decouples reporting presentation from Account Type |
| **OD-29-06** | Accounting / Closing | System Account: Defer `isSystem` Flag to Year-End Closing & Integration Tasks | **PENDING OWNER DECISION** | Prevents premature system-account lock engineering |

---

## 2. Established Decision Record (Preserved)

### OD-27-02: Base Chart MVP Scope Boundary
- **Status:** **`DECIDED`** (Recorded 2026-09-27 in Task 28 follow-up, PR #75).
- **Decision Text:** MVP requires the Base Chart mechanism, but does NOT require a concrete Base Chart content set. The mechanism (template model, version lifecycle, draft $\rightarrow$ approved $\rightarrow$ published $\rightarrow$ superseded, adoption by copy, immutable published versions, no silent mutation, leaf-only posting, read-time aggregation) is part of MVP. No concrete standard chart content may be introduced by implementation inference.

---

## 3. Task 29 Decision Details

### OD-29-01: Account Nature
- **Status:** **`DECIDED`** (2026-09-28; see `owner-decision-closure.md`)
- **Decision:** Account Nature has exactly three independent values: `DEBIT`, `CREDIT`, and `DUAL`. `DUAL` must not be mapped to another Nature. Nature expresses natural balance orientation and may be consumed by balance display, contrary-balance detection, reporting, and controls. It does not absolutely prohibit an entry on the opposite document side.
- **Boundary:** Exact Posting, balance, and contrary-nature policies remain for a later Accounting Engine task. Runtime support for `DUAL` is still not implemented.

### OD-29-02: Fixed Three Global Account Types
- **Status:** **`DECIDED`** (2026-09-28; see `owner-decision-closure.md`)
- **Decision:** Account Type has exactly three values: `BALANCE_SHEET`, `INCOME_STATEMENT`, and `MEMORANDUM`. Type is independent of Nature. It governs the relevant reporting, fiscal-closing, opening, carry-forward, and period-transition lifecycle. Account Type is immutable after the account's first Posting.
- **Boundary:** Runtime schema support, a precise persisted first-Posting test, and transactional immutability enforcement require a separately authorized implementation task. Closing and carry-forward engines are not implemented by this decision.

### OD-29-03: Detail Flags Generic Mapping
- **Status:** **`PENDING OWNER DECISION`**
- **Proposal:** Preserve the source boolean detail-requirement semantics (`0` = no requirement, `1` = required detail code) while mapping them to Vardena's generic line-level dimension requirement model (ADR-0037) rather than creating numbered `requiresDetail1..4` Account columns.
- **Rationale:** Preserves architectural configurability (up to 8 dimensions) and aligns with ADR-0037.
- **Consequences:** Base chart loading will store requirement metadata without polluting the core `Account` table with rigid numbered columns (proposed for implementation in Task 32).

### OD-29-04: English Account Title Scope Boundary
- **Status:** **`DECIDED`** (2026-09-28; see `owner-decision-closure.md`)
- **Decision:** English Account Title is not required in MVP. A Base Chart without it is valid, and its absence must not block account creation, template publication, adoption, or Posting. Any future addition requires a separate decision.
- **Consequences:** No English-title field or validation is required or authorized for MVP; this decision does not itself approve concrete Base Chart content.

### OD-29-05: Statement Class Scope Boundary
- **Status:** **`PENDING OWNER DECISION`**
- **Proposal:** Maintain `Statement Class` as an organization-configurable reporting presentation concept separate from `AccountType`, and defer its implementation to the post-MVP Reporting Foundation phase.
- **Rationale:** Avoids conflating presentation layouts with ledger closing rules.

### OD-29-06: System Account Scope Boundary
- **Status:** **`PENDING OWNER DECISION`**
- **Proposal:** Defer `isSystem` account locking to the future Fiscal Year-End Closing and Subsystem Integration tasks.
- **Rationale:** Prevents speculative system-account locks before closing algorithms are built.
