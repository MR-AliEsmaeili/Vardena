# Statement Class Domain Analysis & Architectural Separation

## 1. Domain Concept & Purpose

**`Statement Class`** (طبقه در صورت‌های مالی / طبقه‌بندی گزارشگری) is the architectural mechanism that governs:

> **Where and how an account appears within formal financial-statement presentation and reporting.**

While **`Account Type`** determines period-end closing and carry-forward physics (`BALANCE_SHEET` vs `INCOME_STATEMENT` vs `MEMORANDUM`), **`Statement Class`** is the separate presentation/grouping concept for financial reports. Exact hierarchy, level count, mapping cardinality, and report runtime behavior remain future design decisions.

---

## 2. Illustrative Statement Class Categories

_(Note: The reporting lines and categories listed below are illustrative examples only; they are not source-artifact facts, not Vardena's official/default taxonomy, and not Owner-approved content for seed data or production records)._

### Illustrative Balance Sheet Presentation Lines (`ترازنامه / صورت وضعیت مالی`)

- **دارایی‌های جاری (Current Assets):** Cash, Receivables, Inventories, Prepayments.
- **دارایی‌های غیرجاری (Non-Current Assets):** Property, Plant & Equipment (PPE), Intangibles, Long-Term Investments.
- **بدهی‌های جاری (Current Liabilities):** Trade Payables, Short-Term Borrowings, Tax Payables.
- **بدهی‌های غیرجاری (Non-Current Liabilities):** Long-Term Provisions, Long-Term Debt.
- **حقوق مالکانه (Equity):** Capital, Reserves, Retained Earnings.

### Illustrative Income Statement Presentation Lines (`صورت سود و زیان`)

- **درآمدهای عملیاتی (Operating Revenues)**
- **بهای تمام شده درآمدهای عملیاتی (Cost of Goods / Services Sold)**
- **هزینه‌های عمومی و اداری (General & Administrative Expenses)**
- **سایر درآمدها و هزینه‌های عملیاتی (Other Operating Items)**
- **هزینه‌های مالی (Finance Costs)**
- **مالیات بر درآمد (Income Tax)**

---

## 3. Strict Domain Separation: Statement Class vs Account Type (OD-29-05)

```text
┌─────────────────────────────────────────────────────────────┐
│                        ACCOUNT NODE                         │
├──────────────────────────────┬──────────────────────────────┤
│ Account Type (نوع حساب)      │ Statement Class (طبقه گزارش) │
├──────────────────────────────┼──────────────────────────────┤
│ • Fixed Global Enum         │ • Organization-Configurable  │
│ • Exactly 3 values          │ • Direction decided only     │
│ • Governs closing & ledger   │ • Supports presentation      │
│ • Universal across all orgs  │ • Customizable per industry  │
└──────────────────────────────┴──────────────────────────────┘
```

### Key Principles:

1. **`Statement Class ≠ Account Type`:** Two accounts may share the same `AccountType` (`BALANCE_SHEET`), but belong to completely different statement classes (e.g., `Current Asset` vs `Non-Current Liability`).
2. **Organization-Configurable (OD-29-05 Option C):** Different organizations may structure their financial statement presentation lines differently. Statement classes are therefore recorded as organization-scoped and configurable in the domain direction, rather than hardcoded in core backend code.
3. **Accounting Core Independence:** Statement Classification does not alter transaction posting rules, the double-entry equation, Chart of Accounts operation, General Ledger, Account Turnover, or Trial Balance. Future report runtime behavior remains separately gated.

---

## 4. Current Vardena Inspection & Fit-Gap Status

- **Prisma Schema (`accounting.prisma`):** No `StatementClass` model, table, or relation exists.
- **Domain & Services:** No statement classification or mapping engine exists.
- **Reporting Surfaces:** Current read reports (`account-statements`, `general-ledger`, `trial-balance`) aggregate via the account tree hierarchy directly (Task 18), without financial statement layout mapping.

### Fit-Gap Classification & Governance Status:

- **Classification:** `DECISION DIRECTION RECORDED — FUTURE DESIGN / IMPLEMENTATION GATED` (Reporting Foundation and any production implementation require separate authorization).
- **Owner Decision:** OD-29-05 (`DECIDED — OPTION C`, 2026-09-28).

---

## 5. Owner Decision Closure Boundary (2026-09-28)

OD-29-05 is **`DECIDED — OPTION C`**. The Owner selected **Organization-configurable Statement Classification** as the domain direction.

Statement Classification is independent from Account Type, Account Nature, Account Hierarchy / Chart of Accounts, Detail / Detail Hierarchy, System Account, and Base Chart Coding Structure. It exists to support classification/presentation of financial reporting outputs, especially classified/presentational statements such as the Balance Sheet / Statement of Financial Position and Income Statement.

This decision does **not** authorize implementation. No Account field, Prisma model, migration, API, permission, guard, UI, report implementation, seed data, Base Chart content, FaraPayam content, statutory/legal rule, default taxonomy, classification levels, mapping cardinality, effective dating/versioning, unclassified-account behavior, or admin workflow is decided here.

Statement Classification is not required for basic Accounting Core operation: Chart of Accounts, voucher creation, Posting, General Ledger, Account Turnover, Trial Balance, and basic accounting operations remain conceptually independent. The exact runtime behavior of future financial reports when no Statement Classification exists remains a future Reporting Foundation decision. Cash Flow and other advanced reporting logic remain separate future design concerns.

The illustrative categories in §2 are examples only and are **not** Vardena's official/default Statement Classification taxonomy. They must not be converted into seed data or production records.

**Decision Pack (2026-09-28):** `od-29-05-statement-classification-decision-pack.md` preserves the pre-decision option analysis (A: none / B: fixed built-in / C: organization-configurable) and now records the Owner's final decision: **DECIDED — OPTION C**.
