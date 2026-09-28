# VARDENA Source Artifact Profile

## 1. Artifact Overview

| Attribute | Specification |
|---|---|
| **Source Artifact Name** | `Pasted markdown(20260927-203801).md` |
| **Domain Scope** | Iranian Standard / SME Base Accounting Chart of Accounts |
| **Total Account Rows** | 264 accounts |
| **Hierarchy Depth** | 3 levels (Level 1: Group, Level 2: General / کل, Level 3: Subsidiary / معین) |
| **Segment Coding Pattern** | `1 + 2 + 3` composite segmentation |
| **Primary Language** | Persian (`فارسی`) |
| **Secondary Metadata** | English titles (`عنوان انگلیسی حساب`) |

---

## 2. Field Structure & Attribute Inventory

The source artifact provides ten (10) structured columns for each account record:

| # | Source Column Name (Persian) | Semantic Concept | Data Type | Domain / Allowed Values | Target Vardena Concept |
|---|---|---|---|---|---|
| 1 | `کد حساب` | Account Code | Digits String (1, 3, or 6 chars) | `^[0-9]+$` | `Account.code` / `BaseChartTemplateNode.code` |
| 2 | `عنوان حساب` | Account Title | Unicode Text | Persian string ($\le 200$ chars) | `Account.title` / `BaseChartTemplateNode.title` |
| 3 | `ماهيت حساب` | Account Nature | Closed List (3 values) | `بدهکار`, `بستانکار`, `هردو` | `Account.accountNature` (`debit`, `credit`, `dual`) |
| 4 | `نوع حساب` | Account Type | Closed List (3 values) | `ترازنامه‌ای`, `سود و زیان`, `انتظامی` | `Account.type` (`BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM`) |
| 5 | `عنوان انگليسي حساب` | English Title | ASCII/Latin Text | Optional string | Non-MVP Metadata (Deferred) |
| 6 | `ACLTafsil1` | Detail Level 1 Required | Boolean Flag | `0` (No), `1` (Yes) | Line-level Dimension / Detail Requirement Rule |
| 7 | `ACLTafsil2` | Detail Level 2 Required | Boolean Flag | `0` (No), `1` (Yes) | Line-level Dimension / Detail Requirement Rule |
| 8 | `ACLTafsil3` | Detail Level 3 Required | Boolean Flag | `0` (No), `1` (Yes) | Line-level Dimension / Detail Requirement Rule |
| 9 | `ACLTafsil4` | Detail Level 4 Required | Boolean Flag | `0` (No), `1` (Yes) | Line-level Dimension / Detail Requirement Rule |
| 10 | `وضعيت حساب غيرفعال/فعال` | Active Status | Binary Status | `فعال`, `غیرفعال` | `Account.isActive` / `BaseChartTemplateNode.defaultIsActive` |

---

## 3. Hierarchy & Coding Structure Breakdown

The VARDENA chart utilizes an additive, composite decimal numbering scheme across 3 hierarchical levels:

```text
Level 1: Group (گروه)
└── Length: 1 digit
    └── Example: 1 (دارایی‌های جاری)

Level 2: General / Kol (کل)
└── Suffix: 2 digits
└── Cumulative Length: 1 + 2 = 3 digits
    └── Example: 101 (موجودی نقد و بانک)

Level 3: Subsidiary / Moein (معین)
└── Suffix: 3 digits
└── Cumulative Length: 1 + 2 + 3 = 6 digits
    └── Example: 101001 (صندوق ریالی دفتر مرکزی)
```

### Hierarchy Statistics

| Level Index | Level Title | Segment Width | Cumulative Code Length | Role in Hierarchy | Postability (`isPostable`) | Approximate Row Count |
|---|---|---|---|---|---|---|
| **Level 1** | گروه (Group) | 1 digit | 1 digit | Hierarchy Root / Major Category | `false` (Non-leaf / Aggregation only) | 9 accounts |
| **Level 2** | کل (General) | 2 digits | 3 digits | Intermediate Roll-up Category | `false` (Non-leaf / Aggregation only) | ~40 accounts |
| **Level 3** | معین (Subsidiary) | 3 digits | 6 digits | Posting Account / Detail Parent | `true` (Leaf accounts) | ~215 accounts |
| **Total** | — | — | — | — | — | **264 accounts** |

---

## 4. Account Group Distribution (Level 1 Roots)

The 264 accounts span standard Iranian accounting classification groups (1 through 9):

| Group Code | Major Group Title (Persian) | Standard English Equivalent | Fixed Account Type (`نوع حساب`) | Predominant Nature (`ماهیت حساب`) |
|---|---|---|---|---|
| `1` | دارایی‌های جاری | Current Assets | `BALANCE_SHEET` (`ترازنامه‌ای`) | `DEBIT` / `DUAL` |
| `2` | دارایی‌های غیرجاری | Non-Current Assets | `BALANCE_SHEET` (`ترازنامه‌ای`) | `DEBIT` / `CREDIT` (Accum. Depr.) |
| `3` | بدهی‌های جاری و غیرجاری | Current & Non-Current Liabilities | `BALANCE_SHEET` (`ترازنامه‌ای`) | `CREDIT` / `DUAL` |
| `4` | حقوق صاحبان سهام | Equity / Capital | `BALANCE_SHEET` (`ترازنامه‌ای`) | `CREDIT` / `DUAL` |
| `5` | درآمدها و فروش | Revenues & Sales | `INCOME_STATEMENT` (`سود و زیان`) | `CREDIT` |
| `6` | بهای تمام شده کالای فروش رفته | Cost of Goods Sold / Cost of Services | `INCOME_STATEMENT` (`سود و زیان`) | `DEBIT` |
| `7` | هزینه‌های عمومی، اداری و توزیع | Operating / Administrative Expenses | `INCOME_STATEMENT` (`سود و زیان`) | `DEBIT` |
| `8` | سایر درآمدها و هزینه‌ها / بستن حساب | Non-Operating Items & Closing Accounts | `INCOME_STATEMENT` (`سود و زیان`) | `DEBIT` / `CREDIT` / `DUAL` |
| `9` | حساب‌های انتظامی | Memorandum Accounts | `MEMORANDUM` (`انتظامی`) | `DEBIT` / `CREDIT` / `DUAL` |

---

## 5. Domain Attribute Distributions

### 5.1 Account Nature Distribution (`ماهیت حساب`)
1. **`بدهکار` (DEBIT):** Standard debit-normal accounts (cash, receivables, inventory, plant assets, expenses, COGS, debit memorandum).
2. **`بستانکار` (CREDIT):** Standard credit-normal accounts (payables, loans, equity, sales revenue, non-operating income, credit memorandum contra).
3. **`هردو` (DUAL):** Accounts that may oscillate between debit and credit depending on business transactions (current accounts with partners/shareholders, bank clearing, suspense accounts, clearing/transitory accounts, tax settlement).

### 5.2 Account Type Distribution (`نوع حساب`)
1. **`ترازنامه‌ای` (BALANCE_SHEET):** Permanent accounts (Groups 1–4) whose balances carry forward across fiscal years and constitute the Statement of Financial Position.
2. **`سود و زیان` (INCOME_STATEMENT):** Temporary/performance accounts (Groups 5–8) that measure period financial performance and close into retained earnings at fiscal year-end.
3. **`انتظامی` (MEMORANDUM):** Off-balance-sheet commitment and guarantee tracking accounts (Group 9) that remain outside the primary double-entry accounting equation.

### 5.3 Detail Requirement Distribution (`ACLTafsil1..4`)
- `0`: No detail account or dimension entry is required for document lines using this account.
- `1`: A corresponding analytical detail (Tafsil / Dimension) is strictly required when posting to this account.
  - `ACLTafsil1`: Typically corresponds to Person/Party (Customer, Vendor, Employee).
  - `ACLTafsil2`: Typically corresponds to Cost Center / Department.
  - `ACLTafsil3`: Typically corresponds to Project / Contract.
  - `ACLTafsil4`: Typically corresponds to Bank Account / Detail Sub-item.

### 5.4 Active/Inactive Status (`وضعیت حساب`)
- `فعال`: Active for creation/adoption (maps directly to `isActive = true`).
- `غیرفعال`: Inactive/archived (maps directly to `isActive = false`).

---

## 6. Artifact Integrity & Ingestion Constraints

1. **No Silent Normalization:** All mappings from Persian terms (`بدهکار`, `ترازنامه‌ای`, `فعال`, etc.) to domain enums must be explicit, lossless, and documented.
2. **Postability Derivation:** Postability is NOT merely dictated by code length (6 digits); it is structurally bounded by the `postable ⇒ leaf` invariant.
3. **Scope Governance:** This artifact represents a concrete owner-supplied source dataset for reconciliation; it is NOT yet approved as a universal Vardena standard chart.
