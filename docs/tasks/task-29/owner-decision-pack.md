# Task 29 — Owner Decision Pack

## 1. Summary Status of Owner Decisions

| Decision ID | Area | Subject | Status | Gating Effect |
|---|---|---|---|---|
| **OD-27-02** | Accounting / Base Chart | Base Chart MVP Scope Boundary (Mechanism = MVP, Concrete Content = Non-MVP) | **DECIDED** (Task 28 Follow-up) | Mechanism unblocked; concrete content gated by separate approval |
| **OD-29-01** | Accounting Domain | Account Nature: Expand `ACCOUNT_NATURES` to include `DUAL` (`هردو`) | **PENDING OWNER DECISION** | Blocks loading accounts with `ماهیت = هردو` (15 accounts in Group 9) |
| **OD-29-02** | Accounting Domain | Account Type: Introduce 3 Fixed Global Types (`BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM`) | **PENDING OWNER DECISION** | Blocks schema support for `نوع حساب` (152 BS, 97 IS, 15 Memo) |
| **OD-29-03** | Accounting / Dimensions | Detail Flags: Map `ACLTafsil1..4` to Generic Line-Level Dimension Requirements | **PENDING OWNER DECISION** | Prevents anti-pattern of hardcoding numbered columns |
| **OD-29-04** | Master Data / i18n | English Account Title: Treat `عنوان انگلیسی حساب` as Deferred Non-MVP Metadata | **PENDING OWNER DECISION** | Eliminates English title blocker for MVP |
| **OD-29-05** | Reporting / Presentation | Statement Class: Define Statement Class as Configurable Post-MVP Capability | **PENDING OWNER DECISION** | Decouples reporting presentation from Account Type |
| **OD-29-06** | Accounting / Closing | System Account: Defer `isSystem` Flag to Year-End Closing & Integration Tasks | **PENDING OWNER DECISION** | Prevents premature system-account lock engineering |

---

## 2. Established Decision Record (Preserved)

### OD-27-02: Base Chart MVP Scope Boundary
- **Status:** **`DECIDED`** (Recorded 2026-09-27 in Task 28 follow-up, PR #75).
- **Decision Text:** MVP requires the Base Chart mechanism, but does NOT require a concrete Base Chart content set. The mechanism (template model, version lifecycle, draft $\rightarrow$ approved $\rightarrow$ published $\rightarrow$ superseded, adoption by copy, immutable published versions, no silent mutation, leaf-only posting, read-time aggregation) is part of MVP. No concrete standard chart content may be introduced by implementation inference.

---

## 3. Pending Owner Decisions (Proposals Requiring Owner Approval)

### OD-29-01: Account Nature DUAL Extension
- **Status:** **`PENDING OWNER DECISION`**
- **Proposal:** Expand `ACCOUNT_NATURES` in `domain/account.ts` and related DTOs from `['debit', 'credit']` to `['debit', 'credit', 'dual']`.
- **Rationale:** The authoritative VARDENA Base Chart contains 15 accounts with nature `هردو` (all in Group 9: Memorandum) which exhibit bi-directional normal balance behavior.
- **Consequences:** Unblocks validation for bi-directional accounts without altering core double-entry arithmetic (proposed for implementation in Task 30).

### OD-29-02: Fixed Three Global Account Types
- **Status:** **`PENDING OWNER DECISION`**
- **Proposal:** Adopt the 3-value global account type model: `BALANCE_SHEET` (`ترازنامه‌ای`, 152 accounts), `INCOME_STATEMENT` (`سود و زیان`, 97 accounts), and `MEMORANDUM` (`انتظامی`, 15 accounts). Add `type` column to `Account` and `BaseChartTemplateNode` models.
- **Rationale:** Necessary to support period-end fiscal closing physics, carry-forward logic, and separation of off-balance-sheet memorandum entries.
- **Consequences:** Requires a Prisma migration and DTO updates in a dedicated implementation task (proposed Task 30) before content loading (proposed Task 31).

### OD-29-03: Detail Flags Generic Mapping
- **Status:** **`PENDING OWNER DECISION`**
- **Proposal:** Preserve the source boolean detail-requirement semantics (`0` = no requirement, `1` = required detail code) while mapping them to Vardena's generic line-level dimension requirement model (ADR-0037) rather than creating numbered `requiresDetail1..4` Account columns.
- **Rationale:** Preserves architectural configurability (up to 8 dimensions) and aligns with ADR-0037.
- **Consequences:** Base chart loading will store requirement metadata without polluting the core `Account` table with rigid numbered columns (proposed for implementation in Task 32).

### OD-29-04: English Account Title Scope Boundary
- **Status:** **`PENDING OWNER DECISION`**
- **Proposal:** Treat `عنوان انگليسي حساب` as non-MVP source metadata. Do not create an English title column on the MVP `Account` model.
- **Rationale:** Persian is the primary system language (ADR-0036 / Q11); English translation is non-MVP.
- **Consequences:** Eliminates unnecessary schema width and translation overhead for MVP.

### OD-29-05: Statement Class Scope Boundary
- **Status:** **`PENDING OWNER DECISION`**
- **Proposal:** Maintain `Statement Class` as an organization-configurable reporting presentation concept separate from `AccountType`, and defer its implementation to the post-MVP Reporting Foundation phase.
- **Rationale:** Avoids conflating presentation layouts with ledger closing rules.

### OD-29-06: System Account Scope Boundary
- **Status:** **`PENDING OWNER DECISION`**
- **Proposal:** Defer `isSystem` account locking to the future Fiscal Year-End Closing and Subsystem Integration tasks.
- **Rationale:** Prevents speculative system-account locks before closing algorithms are built.
