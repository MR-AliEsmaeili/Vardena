# VARDENA Source Artifact Profile

## 1. Artifact Overview

| Attribute                  | Specification                                                                |
| -------------------------- | ---------------------------------------------------------------------------- |
| **Source Artifact Name**   | `Pasted markdown(20260927-203801).md`                                        |
| **Domain Scope**           | Iranian Standard / SME Base Accounting Chart of Accounts                     |
| **Total Account Rows**     | Exactly 264 accounts                                                         |
| **Hierarchy Depth**        | 3 levels (Level 1: Group, Level 2: General / کل, Level 3: Subsidiary / معین) |
| **Segment Coding Pattern** | `1 + 2 + 3` composite segmentation (lengths: 1, 3, 6)                        |
| **Primary Language**       | Persian (`فارسی`)                                                            |
| **Secondary Metadata**     | English titles (`عنوان انگلیسی حساب`)                                        |

---

## 2. Field Structure & Attribute Inventory

The source artifact provides ten (10) structured columns for each account record:

| #   | Source Column Name (Persian) | Semantic Concept          | Data Type                        | Domain / Observed Values                               | Target Vardena Concept                                             |
| --- | ---------------------------- | ------------------------- | -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| 1   | `کد حساب`                    | Account Code              | Digits String (1, 3, or 6 chars) | `^[0-9]+$` (100% digits)                               | `Account.code` / `BaseChartTemplateNode.code`                      |
| 2   | `عنوان حساب`                 | Account Title             | Unicode Text                     | Persian string ($\le 200$ chars)                       | `Account.title` / `BaseChartTemplateNode.title`                    |
| 3   | `ماهيت حساب`                 | Account Nature            | Closed List (3 values)           | `بدهکار` (171), `بستانکار` (78), `هردو` (15)           | `Account.accountNature` (`debit`, `credit`, `dual`)                |
| 4   | `نوع حساب`                   | Account Type              | Closed List (3 values)           | `ترازنامه ای` (152), `سود و زیان` (97), `انتظامی` (15) | `Account.type` (`BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM`) |
| 5   | `عنوان انگليسي حساب`         | English Title             | ASCII/Latin Text                 | Blank in this dataset                                  | Not required for MVP (OD-29-04 `DECIDED`)                          |
| 6   | `ACLTafsil1`                 | Detail Requirement Flag 1 | Boolean Flag                     | `0` (100% `0` in source)                               | Line-level Detail Requirement Rule                                 |
| 7   | `ACLTafsil2`                 | Detail Requirement Flag 2 | Boolean Flag                     | `0` (100% `0` in source)                               | Line-level Detail Requirement Rule                                 |
| 8   | `ACLTafsil3`                 | Detail Requirement Flag 3 | Boolean Flag                     | `0` (100% `0` in source)                               | Line-level Detail Requirement Rule                                 |
| 9   | `ACLTafsil4`                 | Detail Requirement Flag 4 | Boolean Flag                     | `0` (100% `0` in source)                               | Line-level Detail Requirement Rule                                 |
| 10  | `وضعيت حساب غيرفعال/فعال`    | Active Status             | Binary Status                    | `1` (100% Active in source)                            | `Account.isActive` / `BaseChartTemplateNode.defaultIsActive`       |

---

## 3. Hierarchy & Coding Structure Breakdown

The VARDENA chart utilizes an additive, composite decimal numbering scheme across 3 hierarchical levels:

```text
Level 1: Group (گروه)
└── Length: 1 digit
    └── Example: 1 (دارایی های غیرجاری), 2 (دارایی های جاری)

Level 2: General / Kol (کل)
└── Suffix: 2 digits
└── Cumulative Length: 1 + 2 = 3 digits
    └── Example: 101 (دارایی های ثابت مشهود), 205 (موجودی نقد)

Level 3: Subsidiary / Moein (معین)
└── Suffix: 3 digits
└── Cumulative Length: 1 + 2 + 3 = 6 digits
    └── Example: 101001 (زمین), 205001 (موجودی نزد صندوق ریالی)
```

### Hierarchy Statistics (Verified by Automated Parsing)

| Level Index | Level Title       | Segment Width | Cumulative Code Length | Role in Hierarchy               | Total Rows | Leaf Accounts                  | Non-Leaf Accounts |
| ----------- | ----------------- | ------------- | ---------------------- | ------------------------------- | ---------- | ------------------------------ | ----------------- |
| **Level 1** | گروه (Group)      | 1 digit       | 1 digit                | Hierarchy Root / Major Category | 8          | 0                              | 8                 |
| **Level 2** | کل (General)      | 2 digits      | 3 digits               | Intermediate Category / Roll-up | 38         | 4 (`307`, `602`, `703`, `704`) | 34                |
| **Level 3** | معین (Subsidiary) | 3 digits      | 6 digits               | Posting Account / Detail Parent | 218        | 218                            | 0                 |
| **Total**   | —                 | —             | —                      | —                               | **264**    | **222**                        | **42**            |

### Structural Leaf Rule vs Code Length

In Vardena's accounting architecture, **leaf status is determined solely by the absence of child nodes in the hierarchy, NOT by code length or level number alone**.

- All 8 Level 1 nodes have children $\rightarrow$ **Non-leaf** (8 accounts).
- 34 Level 2 nodes have Level 3 children $\rightarrow$ **Non-leaf** (34 accounts).
- Exactly 4 Level 2 nodes have no children in the source dataset:
  1. `307` (مازاد تجدید ارزیابی - Revaluation Surplus)
  2. `602` (سایر درآمدهای عملیاتی - Other Operating Revenues)
  3. `703` (سایر هزینه های عملیاتی - Other Operating Expenses)
  4. `704` (سایر هزینه های غیر عملیاتی - Other Non-Operating Expenses)
     $\rightarrow$ **Leaf accounts** (`isPostable = true`, 4 accounts).
- All 218 Level 3 nodes have no children $\rightarrow$ **Leaf accounts** (`isPostable = true`, 218 accounts).
- **Total Postable Leaves:** $218 + 4 = \mathbf{222}$ accounts.
- **Total Non-Postable Aggregate Nodes:** $8 + 34 = \mathbf{42}$ accounts.

---

## 4. Account Group Distribution (8 Level 1 Roots)

The 264 accounts span exactly eight (8) major classification groups (Root codes `1, 2, 3, 4, 5, 6, 7, 9`):

| Group Code | Group Title (Persian)    | Standard English Translation | Total Accounts | Level 2 Nodes | Level 3 Nodes | Total Leaves (Postable)         | Fixed Account Type (`نوع حساب`) | Nature Distribution (`ماهیت حساب`) |
| ---------- | ------------------------ | ---------------------------- | -------------- | ------------- | ------------- | ------------------------------- | ------------------------------- | ---------------------------------- |
| `1`        | دارایی های غیرجاری       | Non-Current Assets           | 35             | 6             | 28            | 28                              | `BALANCE_SHEET`                 | `DEBIT` (29) / `CREDIT` (6)*       |
| `2`        | دارایی های جاری          | Current Assets               | 63             | 6             | 56            | 56                              | `BALANCE_SHEET`                 | `DEBIT` (63)                       |
| `3`        | حقوق مالکانه             | Equity / Capital             | 22             | 8             | 13            | 14 (`307` is L2 leaf)           | `BALANCE_SHEET`                 | `CREDIT` (22)                      |
| `4`        | بدهی های غیرجاری         | Non-Current Liabilities      | 10             | 3             | 6             | 6                               | `BALANCE_SHEET`                 | `CREDIT` (10)                      |
| `5`        | بدهی های جاری            | Current Liabilities          | 22             | 5             | 16            | 16                              | `BALANCE_SHEET`                 | `CREDIT` (22)                      |
| `6`        | درآمدها                  | Revenues & Sales             | 18             | 3             | 14            | 15 (`602` is L2 leaf)           | `INCOME_STATEMENT`              | `CREDIT` (18)                      |
| `7`        | بهای تمام شده و هزینه ها | Costs & Expenses             | 79             | 5             | 73            | 75 (`703`, `704` are L2 leaves) | `INCOME_STATEMENT`              | `DEBIT` (79)                       |
| `9`        | انتظامی                  | Memorandum Accounts          | 15             | 2             | 12            | 12                              | `MEMORANDUM`                    | `DUAL` (15)                        |
| **Total**  | —                        | —                            | **264**        | **38**        | **218**       | **222**                         | —                               | —                                  |

_\*Note: The 6 Credit accounts in Group 1 are contra-asset accumulated depreciation/amortization accounts (`101011..101015`, `104011`)._

---

## 5. Domain Attribute Distributions

### 5.1 Account Nature Distribution (`ماهیت حساب`)

1. **`بدهکار` (DEBIT):** **171 accounts** (64.8%). Comprises all Current Assets (63), non-contra Non-Current Assets (29), and Costs/Expenses (79).
2. **`بستانکار` (CREDIT):** **78 accounts** (29.5%). Comprises Contra-Assets (6), Equity (22), Non-Current Liabilities (10), Current Liabilities (22), and Revenues (18).
3. **`هردو` (DUAL):** **15 accounts** (5.7%). Comprises all 15 Memorandum accounts in Group 9.

### 5.2 Account Type Distribution (`نوع حساب`)

1. **`ترازنامه ای` (BALANCE_SHEET):** **152 accounts** (57.6%). Permanent accounts across Groups 1, 2, 3, 4, 5.
2. **`سود و زیان` (INCOME_STATEMENT):** **97 accounts** (36.7%). Temporary accounts across Groups 6 and 7.
3. **`انتظامی` (MEMORANDUM):** **15 accounts** (5.7%). Off-balance-sheet tracking accounts in Group 9.

### 5.3 Detail Requirement Distribution (`ACLTafsil1..4`)

- All 264 rows have `ACLTafsil1 = 0`, `ACLTafsil2 = 0`, `ACLTafsil3 = 0`, `ACLTafsil4 = 0` in this base template artifact.
- Semantics: `0` = no detail requirement; `1` = mandatory detail requirement on posting lines.
- The source artifact does not define semantic business roles (e.g., Party, Cost Center) for flags 1–4; they represent generic boolean requirement slots.

### 5.4 Active/Inactive Status (`وضعیت حساب`)

- All 264 rows have status `1` (Active), mapping directly to `defaultIsActive = true` / `isActive = true`.

---

## 6. Artifact Integrity & Ingestion Constraints

1. **Zero Orphans:** 100% of Level 2 codes match a Level 1 root; 100% of Level 3 codes match a Level 2 parent.
2. **Zero Code Duplicates:** All 264 codes are unique.
3. **No Unmapped Values:** All natures and types map to closed, well-defined domain concepts.
