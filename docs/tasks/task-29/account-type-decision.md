# Account Type Domain Decision: Three Global Account Types (OD-29-02)

## 1. Domain Background & Source Reconciliation

In the canonical VARDENA Base Chart artifact (`Pasted markdown(20260927-203801).md`), the field **`نوع حساب`** (Account Type) classifies accounts across three observed values:
- `ترازنامه ای` (152 accounts across Groups 1, 2, 3, 4, 5)
- `سود و زیان` (97 accounts across Groups 6, 7)
- `انتظامی` (15 accounts in Group 9)

Based on this source artifact, **OD-29-02 establishes exactly three fixed global account types** (`DECIDED` 2026-09-28):

```text
AccountType (Official Enum)
├── BALANCE_SHEET   (ترازنامه‌ای)
├── INCOME_STATEMENT (سود و زیان)
└── MEMORANDUM       (انتظامی)
```

---

## 2. Account Type Semantics and Remaining Design Detail

OD-29-02 decides the three value names and the high-level lifecycle semantics stated in `owner-decision-closure.md`. Any more specific behavior in the bullets below is retained as Task 29 analysis/proposal, not promoted to an Owner decision. Detailed closing, opening, carry-forward, reporting, and period-transition policies still require separate Accounting Engine design and implementation.

### 2.1 `BALANCE_SHEET` (`ترازنامه‌ای`)
- **Nature of Account:** Permanent / Real Accounts.
- **Source Scope:** 152 accounts across Assets (Groups 1, 2), Equity (Group 3), and Liabilities (Groups 4, 5).
- **Proposed Domain Behavior:**
  - Balances represent cumulative financial position as of a specific reporting date.
  - Balances carry forward across fiscal years via opening balance documents (`سند افتتاحیه`).
  - Participates in Balance Sheet / Statement of Financial Position reporting (`ترازنامه` / `صورت وضعیت مالی`).
  - Does not close out to zero at fiscal year-end during standard operational closing.

### 2.2 `INCOME_STATEMENT` (`سود و زیان`)
- **Nature of Account:** Temporary / Nominal Accounts.
- **Source Scope:** 97 accounts across Revenues (Group 6) and Costs/Expenses (Group 7).
- **Proposed Domain Behavior:**
  - Measures period financial performance over a bounded time range.
  - Participates in Income Statement / Profit & Loss reporting (`صورت سود و زیان`).
  - At fiscal year-end, closed out to zero through the fiscal closing process, with net result flowing into Equity / Retained Earnings.
  - Does not carry forward balances into the next fiscal year's opening balances.

### 2.3 `MEMORANDUM` (`انتظامی`)
- **Nature of Account:** Off-Balance-Sheet / Tracking Accounts (حساب‌های انتظامی و طرف حساب‌های انتظامی).
- **Source Scope:** 15 accounts in Group 9.
- **Proposed Domain Behavior:**
  - Operates strictly outside the core accounting equation ($\text{Assets} = \text{Liabilities} + \text{Equity}$).
  - Paired in equal debit/credit counter-entries (`حساب انتظامی` and `طرف حساب انتظامی`).
  - Does not contaminate ordinary financial statements (Balance Sheet or Income Statement).
  - Presented exclusively in dedicated memorandum reports and note disclosures.

---

## 3. Four-Way Domain Separation (Proposition D, E, F)

To maintain clean architectural boundaries and avoid domain conflation, the Task 29 Owner decisions keep the following four concepts strictly distinct:

```text
┌─────────────────┐       ┌─────────────────┐
│  Account Type   │       │ Balance Nature  │
│  (نوع حساب)     │  ≠    │ (ماهیت حساب)    │
│                 │       │                 │
│ • BALANCE_SHEET │       │ • DEBIT         │
│ • INCOME_STAT.  │       │ • CREDIT        │
│ • MEMORANDUM    │       │ • DUAL          │
└─────────────────┘       └─────────────────┘
        ≠                          ≠
┌─────────────────┐       ┌─────────────────┐
│ Statement Class │       │ System Account  │
│ (طبقه صورت مالی)│  ≠    │ (حساب سیستمی)   │
│                 │       │                 │
│ • OD-29-05 C    │       │ • Not in MVP    │
│ • Org-config.   │       │   (OD-29-06)    │
└─────────────────┘       └─────────────────┘
```

### Distinction Summary

| Concept | Primary Question Answered | Mutability / Scope | Proposed / Illustrative Values |
|---|---|---|---|
| **Account Type** | *What is the period/closing/reporting lifecycle of this account?* | Fixed Global Enum (Core Domain) | `BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM` (OD-29-02) |
| **Balance Nature** | *What is the normal debit/credit orientation of this account?* | Fixed Global Enum (Core Domain) | `DEBIT`, `CREDIT`, `DUAL` (OD-29-01) |
| **Statement Classification** | *Where does this account appear in financial statement presentation?* | **DECIDED — OPTION C**: independent, Organization-configurable concept | Domain direction only; no Account field, taxonomy, schema, API, report behavior, or implementation authorized |
| **System Account** | *Should an account be specially system-owned?* | Excluded from MVP by OD-29-06 | No `isSystem` or equivalent MVP concept |

---

## 4. Current Vardena Implementation Inspection

An audit of the current codebase confirms:
1. **Prisma Schema (`accounting.prisma`):** Neither `Account` nor `BaseChartTemplateNode` contains an `accountType` or `type` column.
2. **Domain Models (`account.ts`, `base-chart-template.ts`):** No `AccountType` enum or type exists.
3. **DTOs & Controllers:** No API endpoint exposes or accepts `accountType`.

---

## 5. Fit-Gap Classification & Governance Status

| Concept | Current Vardena State | Proposed State | Fit-Gap Classification | Owner Decision Status / Future Task |
|---|---|---|---|---|
| **Account Type Model** | Absent | 3 fixed global values (`BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM`) | **MODEL GAP / IMPLEMENTATION REQUIRED** | OD-29-02 (`DECIDED` 2026-09-28) / implementation pending |
| **Prisma Schema** | Absent on `Account` & `BaseChartTemplateNode` | Persist Account Type with exactly the decided values | **MODEL GAP / IMPLEMENTATION REQUIRED** | OD-29-02 (`DECIDED`) / implementation pending |
| **Base Chart Validation** | No type validation | Validate `type` presence on template authoring | **IMPLEMENTATION REQUIRED** | OD-29-02 (`DECIDED`) / implementation pending |
| **API DTOs** | Absent | Add `type` field to creation/view DTOs | **IMPLEMENTATION REQUIRED** | OD-29-02 (`DECIDED`) / implementation pending |
| **Closing Engine** | Not implemented | Future closing logic consumes `AccountType` | **DEFERRED / FUTURE CAPABILITY** | Post-MVP / Future Task |

---

## 6. Owner Decision Closure (2026-09-28)

OD-29-02 is **`DECIDED`**. Account Type has exactly `BALANCE_SHEET`, `INCOME_STATEMENT`, and `MEMORANDUM`; it is independent of Account Nature and is immutable after the account's first Posting. A later implementation task must define and transactionally enforce the precise persisted first-Posting test. This decision does not itself implement closing, opening, carry-forward, reporting, or period-transition behavior. See `owner-decision-closure.md`.
