# Statement Class Domain Analysis & Architectural Separation

## 1. Domain Concept & Purpose

**`Statement Class`** (طبقه در صورت‌های مالی / طبقه‌بندی گزارشگری) is the architectural mechanism that governs:
> **Where and how an account appears within formal financial-statement presentation and statutory financial reports.**

While **`Account Type`** determines period-end closing and carry-forward physics (`BALANCE_SHEET` vs `INCOME_STATEMENT` vs `MEMORANDUM`), **`Statement Class`** governs the visual hierarchy and aggregation structure of the financial reports themselves.

---

## 2. Typical Statement Class Categories

In standard Iranian reporting and IFRS/National Accounting Standards, financial statement presentation relies on standard or organization-tailored categories:

### Balance Sheet Statement Classes (`ترازنامه / صورت وضعیت مالی`)
- **دارایی‌های جاری (Current Assets):** Cash & Cash Equivalents, Trade Receivables, Inventories, Prepayments.
- **دارایی‌های غیرجاری (Non-Current Assets):** Property, Plant & Equipment (PPE), Intangible Assets, Long-Term Investments.
- **بدهی‌های جاری (Current Liabilities):** Trade Payables, Short-Term Loans, Tax Payables, Accruals.
- **بدهی‌های غیرجاری (Non-Current Liabilities):** Long-Term Provisions, Long-Term Borrowings.
- **حقوق مالکانه (Equity):** Share Capital, Legal Reserve, Retained Earnings.

### Income Statement Statement Classes (`صورت سود و زیان`)
- **درآمدهای عملیاتی (Operating Revenues / Sales)**
- **بهای تمام شده درآمدهای عملیاتی (Cost of Goods Sold / Cost of Sales)**
- **هزینه‌های عمومی، اداری و فروش (Selling, General & Administrative Expenses)**
- **سایر درآمدها و هزینه‌های عملیاتی (Other Operating Income / Expense)**
- **هزینه‌های مالی (Finance Costs)**
- **سایر درآمدها و هزینه‌های غیرعملیاتی (Non-Operating Items)**
- **مالیات بر درآمد (Income Tax Expense)**

---

## 3. Strict Domain Separation: Statement Class vs Account Type (Proposition E)

```text
┌─────────────────────────────────────────────────────────────┐
│                        ACCOUNT NODE                         │
├──────────────────────────────┬──────────────────────────────┤
│ Account Type (نوع حساب)      │ Statement Class (طبقه گزارش) │
├──────────────────────────────┼──────────────────────────────┤
│ • Fixed Global Enum          │ • Organization-Configurable  │
│ • Exactly 3 values           │ • Hierarchical / Multi-level │
│ • Governs closing & ledger   │ • Governs presentation & UI  │
│ • Universal across all orgs  │ • Customizable per industry  │
└──────────────────────────────┴──────────────────────────────┘
```

### Key Principles:
1. **`Statement Class ≠ Account Type`:** Two accounts may share the same `AccountType` (`BALANCE_SHEET`), but belong to completely different statement classes (e.g., `Current Asset` vs `Non-Current Liability`).
2. **Organization-Configurable:** Different organizations (manufacturing vs service vs retail) may structure their financial statement presentation lines differently. Statement classes should therefore be organization-scoped and configurable, rather than hardcoded in core backend code.
3. **Read-Time Presentation Only:** Statement class mapping does not alter transaction posting rules or the double-entry equation.

---

## 4. Current Vardena Inspection & Fit-Gap Status

- **Prisma Schema (`accounting.prisma`):** No `StatementClass` model, table, or relation exists.
- **Domain & Services:** No statement classification or mapping engine exists.
- **Reporting Surfaces:** Current read reports (`account-statements`, `general-ledger`, `trial-balance`) aggregate via the account tree hierarchy directly (Task 18), without financial statement layout mapping.

### Fit-Gap Classification:
`DOMAIN/MODEL GAP — FUTURE IMPLEMENTATION REQUIRED` (Post-MVP / Reporting Foundation Phase).
