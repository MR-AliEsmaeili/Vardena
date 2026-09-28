# VARDENA Base Chart Content Validation Report

## 1. Scope & Methodology

This report details the structural, hierarchical, and domain validation of the canonical 264-account VARDENA Base Chart dataset (`Pasted markdown(20260927-203801).md`) across all ten (10) constituent attributes.

---

## 2. Exhaustive Validation Audit (12 Core Checks)

### Check 1: Is every code structurally valid?

- **Status:** **PASS / 100% VALID**
- **Evidence:** All 264 account codes conform strictly to `ACCOUNT_CODE_PATTERN = /^[0-9]+$/` (ASCII digits only; no letters, spaces, or embedded punctuation). Lengths strictly equal 1 (8 accounts), 3 (38 accounts), or 6 (218 accounts).

### Check 2: Is every non-root node connected to a valid parent?

- **Status:** **PASS / 100% CONNECTED**
- **Evidence:**
  - All 38 Level 2 (General / کل) 3-digit codes `Xyy` match an existing Level 1 (Group) root `X`.
  - All 218 Level 3 (Subsidiary / معین) 6-digit codes `Xyyzzz` match an existing Level 2 parent `Xyy`.
  - Prefix validation check `code.startsWith(parentCode)` evaluates to `true` for 100% of non-root nodes.

### Check 3: Are there duplicate codes?

- **Status:** **PASS / ZERO DUPLICATES**
- **Evidence:** Automated set evaluation confirms `len(set(codes)) == 264 == len(codes)`. Uniqueness constraint `(versionId, code)` / `(organizationId, code)` is perfectly satisfied.

### Check 4: Are there malformed codes?

- **Status:** **PASS / ZERO MALFORMED CODES**
- **Evidence:** Segment widths strictly adhere to the $1+2+3$ pattern (Level 1: 1 digit, Level 2: 2 digits suffix, Level 3: 3 digits suffix). No code exceeds `MAX_ACCOUNT_CODE_LENGTH = 32`.

### Check 5: Are there unexpected nature values?

- **Status:** **RECONCILED TO THREE CLOSED DOMAIN VALUES**
- **Evidence:** Distinct values observed in dataset:
  - `بدهکار` (DEBIT): **171 accounts**
  - `بستانکار` (CREDIT): **78 accounts**
  - `هردو` (DUAL): **15 accounts** (all in Group 9: Memorandum)
  - Zero unmapped, invalid, or foreign values exist.

### Check 6: Are there unexpected type values?

- **Status:** **RECONCILED TO THREE CLOSED DOMAIN VALUES**
- **Evidence:** Distinct values observed in dataset:
  - `ترازنامه ای` (BALANCE_SHEET): **152 accounts** (Groups 1–5)
  - `سود و زیان` (INCOME_STATEMENT): **97 accounts** (Groups 6–7)
  - `انتظامی` (MEMORANDUM): **15 accounts** (Group 9)
  - Zero unmapped or foreign types exist.

### Check 7: Are detail flags only 0/1?

- **Status:** **PASS / 100% VALID**
- **Evidence:** All 264 rows have `ACLTafsil1` through `ACLTafsil4` equal to `'0'`. Semantics: `0` = no detail requirement; `1` = detail requirement mandatory on posting lines.

### Check 8: Are status values consistent?

- **Status:** **PASS / 100% CONSISTENT**
- **Evidence:** All 264 rows have status `'1'` (`فعال` / Active), directly mapping to `defaultIsActive = true` / `isActive = true`.

### Check 9: Are there orphan accounts?

- **Status:** **PASS / ZERO ORPHANS**
- **Evidence:**
  - Level 2 orphan count: `0`
  - Level 3 orphan count: `0`
  - The entire dataset forms a fully connected forest rooted at the eight (8) Level 1 Groups: `1`, `2`, `3`, `4`, `5`, `6`, `7`, and `9` (no code `8` exists).

### Check 10: Are there hierarchy anomalies?

- **Status:** **PASS / STRICTLY REGULAR**
- **Evidence:** Depth increases monotonically ($1 \rightarrow 2 \rightarrow 3$). There are zero skipped levels (no Level 1 directly fathering a Level 3 child).

### Check 11: Which nodes are leaves?

- **Status:** **222 LEAF ACCOUNTS**
- **Evidence:**
  - In Vardena, leaf status is structurally derived by the absence of child nodes in the hierarchy.
  - All 218 Level 3 Subsidiary accounts have no children $\rightarrow$ Leaves (`isPostable = true`).
  - Exactly 4 Level 2 General accounts have no Level 3 children in the dataset:
    1. `307` (مازاد تجدید ارزیابی)
    2. `602` (سایر درآمدهای عملیاتی)
    3. `703` (سایر هزینه های عملیاتی)
    4. `704` (سایر هزینه های غیر عملیاتی)
       $\rightarrow$ Leaves (`isPostable = true`).
  - Under Vardena's Invariant 2 (OD-20-5 / ADR-0034), these **222 accounts** derive as postable leaves.

### Check 12: Which nodes are non-leaves?

- **Status:** **42 NON-LEAF ACCOUNTS**
- **Evidence:**
  - All 8 Level 1 Group roots (`1`, `2`, `3`, `4`, `5`, `6`, `7`, `9`) have children $\rightarrow$ Non-leaves (`isPostable = false`).
  - 34 Level 2 General accounts have Level 3 children $\rightarrow$ Non-leaves (`isPostable = false`).
  - Total non-postable aggregation nodes: **42 accounts** ($8 + 34$).
  - In accordance with ADR-0034 / Invariant 2, non-leaf nodes are aggregation nodes only.

---

## 3. Summary Scorecard

| Validation Check                   | Result    | Scope / Count          | Action Required                                                                             |
| ---------------------------------- | --------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| **Code Syntax & Regex**            | PASS      | 264 / 264              | None                                                                                        |
| **Prefix & Hierarchy Integrity**   | PASS      | 264 / 264              | None                                                                                        |
| **Parent Reference Consistency**   | PASS      | 0 orphans              | None                                                                                        |
| **Uniqueness of Keys**             | PASS      | 264 unique codes       | None                                                                                        |
| **Nature Domain Coverage**         | MODEL GAP | 15 `DUAL` accounts     | Expand domain enum to admit `DUAL` (Proposed Task 30)                                       |
| **Type Domain Coverage**           | MODEL GAP | 3 distinct types       | Add `AccountType` model & schema column (Proposed Task 30)                                  |
| **Detail Requirement / Hierarchy** | MODEL GAP | 264 source flags (`0`) | OD-29-03 domain baseline decided; physical model and implementation require a separate gate |
| **Active Lifecycle Status**        | PASS      | 264 / 264 Active       | Direct mapping to `defaultIsActive`                                                         |
