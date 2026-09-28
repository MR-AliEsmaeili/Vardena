# Statement Class Domain Analysis & Architectural Separation

## 1. Domain Concept & Purpose

**`Statement Class`** (طبقه در صورت‌های مالی / طبقه‌بندی گزارشگری) is the architectural mechanism that governs:
> **Where and how an account appears within formal financial-statement presentation and reporting.**

While **`Account Type`** determines period-end closing and carry-forward physics (`BALANCE_SHEET` vs `INCOME_STATEMENT` vs `MEMORANDUM`), **`Statement Class`** governs the visual hierarchy and aggregation structure of the financial reports themselves.

---

## 2. Illustrative Statement Class Categories

*(Note: The reporting lines and categories listed below represent illustrative domain examples / analysis; they are not source-artifact facts and not Owner-approved Vardena requirements).*

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

## 3. Strict Domain Separation: Statement Class vs Account Type (Proposition E)

```text
┌─────────────────────────────────────────────────────────────┐
│                        ACCOUNT NODE                         │
├──────────────────────────────┬──────────────────────────────┤
│ Account Type (نوع حساب)      │ Statement Class (طبقه گزارش) │
├──────────────────────────────┼──────────────────────────────┤
│ • Fixed Global Enum (Prop.)  │ • Organization-Configurable  │
│ • Exactly 3 values (Prop.)   │ • Hierarchical / Multi-level │
│ • Governs closing & ledger   │ • Governs presentation & UI  │
│ • Universal across all orgs  │ • Customizable per industry  │
└──────────────────────────────┴──────────────────────────────┘
```

### Key Principles:
1. **`Statement Class ≠ Account Type`:** Two accounts may share the same `AccountType` (`BALANCE_SHEET`), but belong to completely different statement classes (e.g., `Current Asset` vs `Non-Current Liability`).
2. **Organization-Configurable:** Different organizations may structure their financial statement presentation lines differently. Statement classes should therefore be organization-scoped and configurable, rather than hardcoded in core backend code.
3. **Read-Time Presentation Only:** Statement class mapping does not alter transaction posting rules or the double-entry equation.

---

## 4. Current Vardena Inspection & Fit-Gap Status

- **Prisma Schema (`accounting.prisma`):** No `StatementClass` model, table, or relation exists.
- **Domain & Services:** No statement classification or mapping engine exists.
- **Reporting Surfaces:** Current read reports (`account-statements`, `general-ledger`, `trial-balance`) aggregate via the account tree hierarchy directly (Task 18), without financial statement layout mapping.

### Fit-Gap Classification & Governance Status:
- **Classification:** `DOMAIN/MODEL GAP — FUTURE IMPLEMENTATION REQUIRED` (Post-MVP / Reporting Foundation Phase).
- **Owner Decision:** OD-29-05 (`PENDING OWNER DECISION`).

---

## 5. Owner Decision Closure Boundary (2026-09-28)

OD-29-05 remains **`PENDING OWNER DECISION`**. The categories and organization-configurable model above remain historical Task 29 analysis/proposal only. No final Statement Classification model, Account field, organization configuration, or implementation is authorized.

**Decision Pack (2026-09-28):** the dedicated Owner Decision preparation for OD-29-05 — option analysis (A: none / B: fixed built-in / C: organization-configurable), fit/gap against the current architecture, qualitative decision matrix, and a non-binding recommendation — is recorded in `od-29-05-statement-classification-decision-pack.md`. It decides nothing; OD-29-05 stays `PENDING OWNER DECISION`.
