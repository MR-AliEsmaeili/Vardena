# Task 29 — Owner Decision Closure Record

**Date:** 2026-09-28  
**Scope:** OD-29-01, OD-29-02, OD-29-03, OD-29-04, OD-29-05, OD-29-06
**Status:** All six OD-29-01..OD-29-06 decisions recorded as `DECIDED`; OD-29-05 is `DECIDED — OPTION C`.

> This record preserves the Owner's explicit decisions. It establishes the domain baseline for later implementation work, but does not itself change runtime behavior, approve the 264-account artifact for production loading, accept Task 29, close OQ-25 wholesale, promote an ADR, or authorize Task 30, Statement Classification implementation, Reporting Foundation implementation, or any other implementation task.

---

## OD-29-01 — Account Nature

**Status:** **`DECIDED`**

Vardena Account Nature has exactly three official, independent values:

- `DEBIT`
- `CREDIT`
- `DUAL`

`DUAL` is an independent Account Nature. It must not be mapped or converted to `DEBIT` or `CREDIT`.

Account Nature describes an account's natural balance orientation. The Accounting Domain may consume it for natural balance, balance-side interpretation, detection and reporting of a balance opposite to natural nature, accounting reporting, and future accounting policies.

Account Nature is **not** an absolute prohibition on posting an account on the opposite side. For example, a `DEBIT`-nature account may legitimately have a Credit posting when that posting represents a decrease, reversal, or another otherwise-valid accounting event.

Detailed Posting Engine policies remain future implementation concerns. This decision does not invent or implement those policies and does not make `DUAL` a bypass for other posting rules.

### Consequences

- The current two-value runtime model is a confirmed implementation gap.
- A future, separately authorized implementation task must add `DUAL` without collapsing it into either existing value.
- Posting must not be documented as invalid solely because its side differs from Account Nature.

---

## OD-29-02 — Account Type

**Status:** **`DECIDED`**

Vardena Account Type has exactly three official values:

- `BALANCE_SHEET`
- `INCOME_STATEMENT`
- `MEMORANDUM`

Account Type is independent of Account Nature.

### `BALANCE_SHEET`

Used for accounts whose balances belong to the balance-sheet lifecycle and may be carried forward into the next fiscal period.

### `INCOME_STATEMENT`

Used for revenue/expense-style accounts whose period activity participates in fiscal closing and does not simply carry forward as the same period activity into the next fiscal period.

### `MEMORANDUM`

Used for memorandum accounts whose accounting and reporting lifecycle is distinct from ordinary Balance Sheet and Income Statement accounts.

Account Type is relevant to future Accounting Engine behavior including financial reporting, trial balance behavior, fiscal closing, opening, carry-forward, and fiscal-period transition.

**Account Type is immutable after the account's first Posting.** A future implementation task must define the exact persisted evidence and transaction boundary used to identify that first Posting consistently with Vardena's posting lifecycle.

### Consequences

- The absence of Account Type on the runtime model is a confirmed implementation gap.
- A future, separately authorized implementation task must preserve all three values and enforce post-first-Posting immutability transactionally.
- This decision does not implement fiscal closing, opening, carry-forward, period transition, memorandum reporting, or new Posting policies.

---

## OD-29-03 — Detail Requirement / Detail Hierarchy

**Status:** **`DECIDED`**

Vardena must support a first-class **Detail hierarchy** independent from the Account hierarchy. Detail coding is configurable by Organization and must support:

- a configurable number of Detail levels;
- configurable digit length for each level;
- a configurable name for each level;
- hierarchical parent/child relationships; and
- code validation and uniqueness consistent with the configured Detail structure.

The following is illustrative only and must not be hard-coded:

```text
Detail Level 1
└── 01 = اشخاص
    ├── 01001 = علی
    ├── 01002 = رضا
    └── 01003 = شرکت X
```

No generic Detail slot may be hard-coded to semantic names such as Customer, Vendor, Project, Cost Center, Bank, or Party by this decision.

### Account-to-Detail Relationship

An Account is associated with a Detail at the **first Detail level**, not with every individual leaf Detail. If an Account is related to a first-level Detail group, valid descendants of that group are available to the Account subject to the applicable Detail rules.

The architecture must not create one Account relationship for every individual descendant unless a future, separately approved requirement requires it.

### Detail Requirement During Posting

An Account may require one or more Detail/Dimension values when used in an accounting document. The Accounting Domain/backend must ultimately enforce required values during Posting validation; UI assistance is not an authorization boundary and direct API/backend use must not bypass the rule.

### Controlled Removal of an Account-to-Detail Relationship

The system must eventually provide an explicit operation to remove an Account-to-Detail relationship. This is a controlled destructive data operation, not a simple configuration-row deletion, when historical accounting documents contain affected Detail allocations.

Before execution, the user must receive an explicit confirmation warning preserving this source meaning:

> این تغییر باعث حذف ارتباط بین تفصیلی و کد حساب می‌شود و تمامی گردش‌های تفصیلی در سندهایی که کدحساب مدنظر گردش داشته باشد حذف خواهد شد . قبل از انجام این کار از دیتا بیس بکاپ بگیرید

If the user cancels, nothing changes. If the user confirms, the future approved operation must:

1. remove the Account-to-Detail relationship;
2. remove historical Detail allocations associated with that Account according to the approved domain operation;
3. handle all affected locations and references consistently;
4. preserve the Account's own accounting turnover;
5. execute atomically, leaving no partial destructive result; and
6. be auditable with, at minimum, actor, timestamp, Account, Detail relationship, and operation performed.

### Implementation Boundary

This decision specifies domain constraints only. It does **not** define the physical database model for Detail hierarchy or historical allocations, implement backend Posting validation, define permissions, add a UI, or implement destructive deletion. Those concerns require a separately authorized architecture and implementation task.

---

## OD-29-04 — English Account Title

**Status:** **`DECIDED`**

Vardena does not require an English Account Title in the MVP.

Therefore:

- an English Account Title field is not mandatory in the Account domain;
- a Base Chart without English Account Titles is valid;
- absence of an English title does not block account creation, template publication, adoption, or Posting; and
- adding such a field in the future requires a separate decision.

This decision does not itself approve the owner-provided 264-account artifact for production publication or adoption.

---

## OD-29-06 — System Account

**Status:** **`DECIDED`**

Vardena MVP will **not** have a System Account concept. The MVP must not add or infer:

- `isSystem`;
- `systemAccount`;
- System Account roles;
- System Account categories; or
- system-owned Account flags.

No Account is treated as a special System Account in the current MVP architecture. If a future Accounting Engine requirement demonstrates a real need for system-managed accounts, it requires a separate future Owner Decision and architecture task.

This decision does not prevent future Accounting Engine features from being designed; it prevents Task 29 and the current MVP from inventing a System Account classification in advance of such an approved need.

---

## OD-29-05 — Statement Classification

**Status:** **`DECIDED`**
**Selected Option:** **Option C — Organization-configurable Statement Classification**

The Owner explicitly selected **Option C**.

Statement Classification is an independent accounting/reporting concept that is configurable per Organization. It is separate from:

- Account Type;
- Account Nature;
- Account Hierarchy / Chart of Accounts;
- Detail / Detail Hierarchy;
- System Account; and
- Base Chart Coding Structure.

The purpose of Statement Classification is to allow an Organization to define how accounts are classified and presented for financial reporting without making the Chart of Accounts hierarchy itself the sole source of financial-statement presentation.

### OD-29-05 Scope Boundary

This decision records only the architectural direction: **Statement Classification is an independent, Organization-configurable concept**.

It does **not** decide or authorize any default classification taxonomy, default classification names, statutory classification rules, Iranian statutory reporting requirements, number of classification levels, classification hierarchy/versioning, effective dating, mapping cardinality, whether one Account may have multiple classifications, behavior of unclassified accounts, mandatory-vs-optional organization policy, permissions, admin workflow, database schema, Prisma model, API contract, frontend/UI, reporting implementation, migration/seed data, Base Chart content, FaraPayam compatibility, legal/regulatory profile, or production runtime behavior.

### Accounting Core Boundary

Statement Classification is **not required** for the basic operation of Accounting Core. The following remain conceptually independent from Statement Classification:

- Chart of Accounts;
- voucher creation;
- Posting;
- General Ledger;
- Account Turnover;
- Trial Balance; and
- basic accounting operations.

No Organization may be treated as unable to use Accounting Core merely because Statement Classification has not yet been configured. The exact runtime behavior of future financial reports when no classification exists remains a future Reporting Foundation decision.

### Relationship to Financial Statements

Statement Classification is primarily relevant to classified/presentational financial statements, including concepts such as Balance Sheet / Statement of Financial Position and Income Statement.

This decision does **not** claim that Statement Classification alone solves Cash Flow reporting or any other advanced reporting requirement. Cash Flow and other advanced reporting logic remain separate future design concerns.

### Illustrative Example Only — Not Vardena Taxonomy

```text
Chart of Accounts

101001  Cash
101002  Bank
101003  Accounts Receivable
102001  Equipment
201001  Accounts Payable
301001  Capital
401001  Service Revenue
501001  Salary Expense
```

Separately, an Organization may define a reporting classification such as:

```text
Statement Classification

Statement of Financial Position
├── Current Assets
├── Non-Current Assets
├── Current Liabilities
├── Non-Current Liabilities
└── Equity

Income Statement
├── Operating Revenue
└── Operating Expense
```

This example is illustrative only. It is **not** Vardena's official/default taxonomy, does not approve any Base Chart content, and must not be converted into seed data or production records.

OQ-25 remains **OPEN** because approval of the concrete Base Chart artifact, concrete mandatory-account/control-role content, concrete Statement Classification taxonomy/content, and other previously recorded content and lifecycle questions remain unresolved. OQ-41 is narrowed by OD-29-03 but remains open for physical persistence, authorization, operational safeguards, and implementation design. OQ-43, OQ-36, and OQ-62 retain their recorded statuses.

## Implementation Authorization Boundary

This is a governance/documentation closure only. It records authoritative domain decisions but makes **zero** production code, Prisma schema, migration, seed, permission, guard, API, Accounting Engine, Posting, reporting, destructive data-operation, Base Chart content, FaraPayam loading, or UI changes.

**Task 30 is NOT authorized by these decisions.** The decisions remove Owner Decision blockers only. Task 30, Detail implementation, Statement Classification implementation, Reporting Foundation implementation, Base Chart content loading, and every other production change require their own explicit implementation authorization/gate.

OD-29-05 does not introduce a System Account concept (OD-29-06 remains unchanged) and does not introduce an English Account Title field (OD-29-04 remains unchanged).
