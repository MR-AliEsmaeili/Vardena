# Task 29 — Owner Decision Closure Record

**Date:** 2026-09-28  
**Scope:** OD-29-01, OD-29-02, and OD-29-04  
**Status:** Three decisions recorded as `DECIDED`; no production implementation performed or authorized by this record.

> This record preserves the Owner's explicit decisions. It establishes the domain baseline for later implementation work, but does not itself change runtime behavior, approve the 264-account artifact for production loading, accept Task 29, or close OQ-25 wholesale.

---

## OD-29-01 — Account Nature

**Status:** **`DECIDED`**

Vardena Account Nature has exactly three official, independent values:

- `DEBIT`
- `CREDIT`
- `DUAL`

`DUAL` is an independent Account Nature. It must not be mapped or converted to `DEBIT` or `CREDIT`.

Account Nature describes an account's natural balance orientation. The Accounting Engine may consume it for balance calculation and presentation, detection of a balance contrary to nature, reporting, and accounting controls.

Account Nature is **not** an absolute prohibition on posting an account on the opposite side. For example, an account whose Nature is `DEBIT` may appear on the Credit side of a document when all other posting rules are valid.

The exact policies for posting controls, balance handling, and detection of balances contrary to nature remain future Accounting Engine concerns. This decision does not invent or implement those policies and does not make `DUAL` a bypass for other posting rules.

### Consequences

- The current two-value runtime model is a confirmed implementation gap.
- A later implementation task must add `DUAL` without collapsing it into either existing value and must update all affected domain validation, API contracts, persistence paths, adoption paths, and UI presentation.
- Existing or future opposite-side posting must not be rejected solely because of Account Nature unless a separately approved Accounting Engine policy requires such a control.

---

## OD-29-02 — Account Type

**Status:** **`DECIDED`**

Vardena Account Type has exactly three official values:

- `BALANCE_SHEET`
- `INCOME_STATEMENT`
- `MEMORANDUM`

Account Type is independent of Account Nature.

### `BALANCE_SHEET`

Accounts of this type belong to the balance-sheet lifecycle. Their balances are eligible for carry-forward between fiscal years.

### `INCOME_STATEMENT`

Accounts of this type represent period revenue and expense activity. They must be closed through the fiscal-closing process so the next fiscal period starts from a new performance basis.

### `MEMORANDUM`

Accounts of this type have a reporting and lifecycle behavior separate from the primary financial-statement accounts. They must not be treated as either `BALANCE_SHEET` or `INCOME_STATEMENT` accounts.

The Accounting Engine may consume Account Type to distinguish behavior for financial reporting, trial balance, fiscal closing, opening, carry-forward, and period transition.

**Account Type is immutable after the account's first Posting.** A later implementation task must define the exact persisted evidence and transaction boundary used to identify that first Posting consistently with Vardena's posting lifecycle; this closure record does not silently equate it with an unapproved lifecycle event.

### Consequences

- The absence of Account Type on `Account` and `BaseChartTemplateNode` is a confirmed implementation gap.
- A later schema/domain implementation must preserve all three values as distinct values and enforce post-first-Posting immutability transactionally.
- This decision defines classification and lifecycle semantics; it does not implement fiscal closing, opening, carry-forward, period transition, memorandum reporting, or new Posting policies.

---

## OD-29-04 — English Account Title

**Status:** **`DECIDED`**

Vardena does not require an English Account Title in the MVP.

Therefore:

- an English Account Title field is not mandatory in the Account domain;
- a Base Chart without English Account Titles is valid;
- absence of an English title does not block account creation, template publication, adoption, or Posting; and
- adding such a field in the future requires a separate decision.

### Consequences

- No English-title schema field, migration, validation, API requirement, seed value, or UI requirement is authorized or required for MVP by Task 29.
- English Account Title is not a blocker for a future approved Base Chart content-loading task.
- This decision does not itself approve the owner-provided 264-account artifact for production publication or adoption.

---

## Decisions Not Closed by This Record

The following Task 29 proposals remain **`PENDING OWNER DECISION`**:

- **OD-29-03** — mapping `ACLTafsil1..4` to generic line-level dimension requirements;
- **OD-29-05** — Statement Class scope and deferral; and
- **OD-29-06** — System Account scope and deferral.

OQ-25 remains **OPEN** because approval of the concrete Base Chart artifact, concrete mandatory-account/control-role content, and other previously recorded content and lifecycle questions remain unresolved. OQ-41, OQ-43, OQ-36, and OQ-62 retain their recorded statuses.

## Implementation Boundary

This is a governance/documentation closure only. It records authoritative domain decisions but makes **zero** production code, Prisma schema, migration, seed, permission, guard, API, Accounting Engine, Posting, reporting, or UI changes. A separately authorized implementation task is required before the runtime system can accept `DUAL`, persist Account Type, or enforce Account Type immutability.
