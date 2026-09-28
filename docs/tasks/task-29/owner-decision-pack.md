# Task 29 — Owner Decision Pack

## 1. Summary Status of Owner Decisions

| Decision ID  | Area                     | Subject                                                                                                                                                   | Status                          | Gating Effect                                                                                                                                                                                      |
| ------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OD-27-02** | Accounting / Base Chart  | Base Chart MVP Scope Boundary (Mechanism = MVP, Concrete Content = Non-MVP)                                                                               | **DECIDED** (Task 28 Follow-up) | Mechanism unblocked; concrete content gated by separate approval                                                                                                                                   |
| **OD-29-01** | Accounting Domain        | Account Nature: exactly `DEBIT`, `CREDIT`, `DUAL`; `DUAL` is independent; Nature does not prohibit opposite-side entries                                  | **DECIDED** (2026-09-28)        | Runtime support remains an implementation prerequisite for `DUAL` content                                                                                                                          |
| **OD-29-02** | Accounting Domain        | Account Type: exactly `BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM`; immutable after first Posting                                                    | **DECIDED** (2026-09-28)        | Runtime schema and immutability enforcement remain implementation prerequisites                                                                                                                    |
| **OD-29-03** | Accounting / Detail      | First-class organization-configurable Detail hierarchy; first-level Account relationship; backend requirement enforcement; controlled destructive removal | **DECIDED** (2026-09-28)        | Domain baseline fixed; physical model and implementation still require a separate gate                                                                                                             |
| **OD-29-04** | Master Data / i18n       | English Account Title is not required for MVP and its absence blocks no account lifecycle operation                                                       | **DECIDED** (2026-09-28)        | English title is not an MVP or Base Chart blocker                                                                                                                                                  |
| **OD-29-05** | Reporting / Presentation | Statement Classification: independent, Organization-configurable reporting presentation concept (**Option C**)                                            | **DECIDED** (2026-09-28)        | Decouples reporting presentation from Chart of Accounts, Account Type, Account Nature, Detail, System Account and Base Chart Coding Structure; implementation and taxonomy remain separately gated |
| **OD-29-06** | Accounting Domain        | MVP has no System Account concept or system-owned Account flags                                                                                           | **DECIDED** (2026-09-28)        | `isSystem` and equivalent concepts are excluded from MVP                                                                                                                                           |

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

### OD-29-03: Detail Requirement / Detail Hierarchy

- **Status:** **`DECIDED`** (2026-09-28; see `owner-decision-closure.md`)
- **Decision:** Detail is a first-class hierarchy independent from Account, with organization-configurable level count, names, digit lengths, hierarchy, validation, and uniqueness. An Account relates at the first Detail level rather than to every descendant. Required Detail/Dimension values must ultimately be enforced by backend Posting validation.
- **Controlled removal:** Removing a used Account-to-Detail relationship is an explicitly confirmed, atomic, auditable destructive operation that removes affected historical Detail allocations while preserving Account-level turnover. The Owner-provided Persian warning is preserved in the closure record and `detail-flag-mapping.md`.
- **Boundary:** No physical database model, permission, endpoint, UI, allocation storage, or deletion algorithm is decided or implemented here. Generic slots receive no hard-coded business names. Implementation requires a separate authorization gate.

### OD-29-04: English Account Title Scope Boundary

- **Status:** **`DECIDED`** (2026-09-28; see `owner-decision-closure.md`)
- **Decision:** English Account Title is not required in MVP. A Base Chart without it is valid, and its absence must not block account creation, template publication, adoption, or Posting. Any future addition requires a separate decision.
- **Consequences:** No English-title field or validation is required or authorized for MVP; this decision does not itself approve concrete Base Chart content.

### OD-29-05: Statement Classification Scope Boundary

- **Status:** **`DECIDED`** (2026-09-28; Option C; see `owner-decision-closure.md` and `od-29-05-statement-classification-decision-pack.md`)
- **Decision:** Statement Classification is an independent accounting/reporting concept that is configurable per Organization. It is separate from Account Type, Account Nature, Account Hierarchy / Chart of Accounts, Detail / Detail Hierarchy, System Account, and Base Chart Coding Structure.
- **Purpose:** Allows an Organization to define how accounts are classified and presented for financial reporting without making the Chart of Accounts hierarchy itself the sole source of financial-statement presentation.
- **Accounting Core boundary:** Statement Classification is not required for Chart of Accounts, voucher creation, Posting, General Ledger, Account Turnover, Trial Balance, or basic accounting operations. An Organization must not be blocked from Accounting Core merely because Statement Classification is not configured.
- **Boundary:** No default taxonomy, classification names, statutory rules, Iranian legal reporting content, hierarchy depth, versioning/effective-dating, mapping cardinality, unclassified-account behavior, mandatory/optional policy, permission/admin workflow, schema, Prisma model, API, UI, report implementation, migration/seed data, Base Chart content, FaraPayam content, legal/regulatory profile, or production runtime behavior is approved by this decision. Cash Flow and other advanced reporting logic remain separate future design concerns. OQ-25 remains open for concrete content and related unresolved items.

### OD-29-06: System Account

- **Status:** **`DECIDED`** (2026-09-28; see `owner-decision-closure.md`)
- **Decision:** Vardena MVP has no System Account concept. Do not add `isSystem`, `systemAccount`, System Account roles/categories, or system-owned Account flags, and do not treat any Account as a special System Account.
- **Boundary:** A demonstrated future need requires a separate Owner Decision and architecture task. No placeholder field or runtime behavior is authorized now.
