# Account Type Domain Proposal: Three Global Account Types (OD-29-02)

## 1. Domain Background & Source Reconciliation

In the canonical VARDENA Base Chart artifact (`Pasted markdown(20260927-203801).md`), the field **`نوع حساب`** (Account Type) classifies accounts across three observed values:
- `ترازنامه ای` (152 accounts across Groups 1, 2, 3, 4, 5)
- `سود و زیان` (97 accounts across Groups 6, 7)
- `انتظامی` (15 accounts in Group 9)

Based on this source artifact, **Task 29 reconciles and proposes three fixed global account types** under **OD-29-02** (`PENDING OWNER DECISION`):

```text
AccountType (Proposed Enum)
├── BALANCE_SHEET   (ترازنامه‌ای)
├── INCOME_STATEMENT (سود و زیان)
└── MEMORANDUM       (انتظامی)
```

---

## 2. Detailed Semantics of the Proposed Account Types

*(Note: The lifecycle descriptions below represent illustrative domain analysis and design proposals; they are not direct source-artifact text and not Owner-approved Vardena requirements until OD-29-02 is ratified).*

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

To maintain clean architectural boundaries and avoid domain conflation, Task 29 proposes keeping the following four concepts strictly distinct:

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
│ • Org-defined   │       │ • isSystem      │
│ • Configurable  │       │   (boolean)     │
└─────────────────┘       └─────────────────┘
```

### Distinction Summary

| Concept | Primary Question Answered | Mutability / Scope | Proposed / Illustrative Values |
|---|---|---|---|
| **Account Type** | *What is the period/closing/reporting lifecycle of this account?* | Fixed Global Enum (Core Domain) | `BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM` (OD-29-02) |
| **Balance Nature** | *What is the normal debit/credit orientation of this account?* | Fixed Global Enum (Core Domain) | `DEBIT`, `CREDIT`, `DUAL` (OD-29-01) |
| **Statement Class** | *Where does this account appear in financial statement presentation?* | Organization-Configurable (Presentation) | Illustrative: Current Assets, Operating Expenses (OD-29-05) |
| **System Account** | *Is this account reserved/controlled for automated system posting?* | Core System Flag | `isSystem: boolean` (OD-29-06) |

---

## 4. Current Vardena Implementation Inspection

An audit of the current codebase confirms:
1. **Prisma Schema (`accounting.prisma`):** Neither `Account` nor `BaseChartTemplateNode` contains an `accountType` or `type` column.
2. **Domain Models (`account.ts`, `base-chart-template.ts`):** No `AccountType` enum or type exists.
3. **DTOs & Controllers:** No API endpoint exposes or accepts `accountType`.

---

## 5. Fit-Gap Classification & Governance Status

| Concept | Current Vardena State | Proposed State | Fit-Gap Classification | Owner Decision Status |
|---|---|---|---|---|
| **Account Type Model** | Absent | 3 fixed global values (`BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM`) | **MODEL GAP / IMPLEMENTATION REQUIRED** | OD-29-02 (`PENDING OWNER DECISION`) |
| **Prisma Schema** | Absent on `Account` & `BaseChartTemplateNode` | Add `type AccountType` enum or `VarChar(32)` column | **MODEL GAP / IMPLEMENTATION REQUIRED** | OD-29-02 (`PENDING OWNER DECISION`) |
| **Base Chart Validation** | No type validation | Validate `type` presence on template authoring | **IMPLEMENTATION REQUIRED** | OD-29-02 (`PENDING OWNER DECISION`) |
| **API DTOs** | Absent | Add `type` field to creation/view DTOs | **IMPLEMENTATION REQUIRED** | OD-29-02 (`PENDING OWNER DECISION`) |
| **Closing Engine** | Not implemented | Future closing logic consumes `AccountType` | **DEFERRED / FUTURE CAPABILITY** | Post-MVP / Future Task |
