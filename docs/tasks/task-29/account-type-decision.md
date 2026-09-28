# Account Type Domain Decision: Fixed Global Account Types

## 1. Domain Background & Definition

In Iranian accounting and the VARDENA Base Chart artifact, **`نوع حساب`** (Account Type) defines the lifecycle, closing behavior, and financial statement participation of an account.

The domain architecture establishes exactly **three fixed global account types**:

```text
AccountType
├── BALANCE_SHEET   (ترازنامه‌ای)
├── INCOME_STATEMENT (سود و زیان)
└── MEMORANDUM       (انتظامی)
```

---

## 2. Detailed Semantics of the Three Fixed Account Types

### 2.1 `BALANCE_SHEET` (`ترازنامه‌ای`)
- **Nature of Account:** Permanent / Real Accounts.
- **Underlying Entities:** Assets (دارایی‌ها), Liabilities (بدهی‌ها), and Equity/Capital (حقوق صاحبان سهام / سرمایه).
- **Core Domain Behavior:**
  - Balances represent cumulative financial position as of a specific reporting date.
  - Balances **carry forward** automatically from one fiscal year to the next via the opening balance document (`سند افتتاحیه`).
  - Participates in Balance Sheet / Statement of Financial Position reporting (`ترازنامه` / `صورت وضعیت مالی`).
  - Does **NOT** close out to zero at fiscal year-end during standard operational closing.

### 2.2 `INCOME_STATEMENT` (`سود و زیان`)
- **Nature of Account:** Temporary / Nominal Accounts.
- **Underlying Entities:** Sales & Revenues (درآمدها), Cost of Goods Sold / Cost of Services (بهای تمام شده), Operating & Administrative Expenses (هزینه‌ها), and Non-Operating Income/Expenses.
- **Core Domain Behavior:**
  - Measures period financial performance over a specific bounded time range.
  - Participates in Income Statement / Profit & Loss reporting (`صورت سود و زیان`).
  - At fiscal year-end, these accounts are **closed out to zero** through the fiscal closing process (`سند بستن حساب‌های موقت / سود و زیان جاری`), with net result flowing into Retained Earnings / Equity.
  - Does **NOT** carry forward balances into the next fiscal year's opening balances.

### 2.3 `MEMORANDUM` (`انتظامی`)
- **Nature of Account:** Off-Balance-Sheet / Tracking Accounts (حساب‌های انتظامی و طرف حساب‌های انتظامی).
- **Underlying Entities:** Performance bonds, bank guarantees, collateral received/given, promissory notes, and off-balance-sheet commitments.
- **Core Domain Behavior:**
  - Operates **strictly outside** the core accounting equation ($\text{Assets} = \text{Liabilities} + \text{Equity}$).
  - Paired in equal debit/credit counter-entries (`حساب انتظامی` and `طرف حساب انتظامی`).
  - Must **NOT contaminate** ordinary financial statements (Balance Sheet or Income Statement).
  - Presented exclusively in dedicated memorandum reports and financial note disclosures.

---

## 3. Four-Way Domain Separation (Proposition D, E, F)

To maintain clean architectural boundaries and avoid domain conflation, the following four concepts MUST remain strictly distinct:

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

| Concept | Primary Question Answered | Mutability / Scope | Sample Values |
|---|---|---|---|
| **Account Type** | *What is the period/closing/reporting lifecycle of this account?* | Fixed Global Enum (Core Domain) | `BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM` |
| **Balance Nature** | *What is the normal debit/credit orientation of this account?* | Fixed Global Enum (Core Domain) | `DEBIT`, `CREDIT`, `DUAL` |
| **Statement Class** | *Where does this account appear in financial statement presentation?* | Organization-Configurable (Presentation) | `Current Asset`, `Operating Expense`, etc. |
| **System Account** | *Is this account reserved/controlled for automated system posting?* | Core System Flag | `isSystem: boolean` |

---

## 4. Current Vardena Implementation Inspection

An audit of the current codebase confirms:
1. **Prisma Schema (`accounting.prisma`):** Neither `Account` nor `BaseChartTemplateNode` contains an `accountType` or `type` column.
2. **Domain Models (`account.ts`, `base-chart-template.ts`):** No `AccountType` enum or type exists.
3. **DTOs & Controllers:** No API endpoint exposes or accepts `accountType`.

---

## 5. Fit-Gap Classification

| Concept | Current Vardena State | Required State | Classification |
|---|---|---|---|
| **Account Type Model** | Absent | 3 fixed global values (`BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM`) | **MODEL GAP / IMPLEMENTATION REQUIRED** |
| **Prisma Schema** | Absent on `Account` & `BaseChartTemplateNode` | Add `type AccountType` enum or `VarChar(32)` column | **MODEL GAP / IMPLEMENTATION REQUIRED** |
| **Base Chart Validation** | No type validation | Validate `type` presence on template authoring | **IMPLEMENTATION REQUIRED** |
| **API DTOs** | Absent | Add `type` field to creation/view DTOs | **IMPLEMENTATION REQUIRED** |
| **Closing Engine** | Not implemented (Future task) | Future closing logic consumes `AccountType` | **DEFERRED / FUTURE CAPABILITY** |
