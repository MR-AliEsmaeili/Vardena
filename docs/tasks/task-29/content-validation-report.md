# VARDENA Base Chart Content Validation Report

## 1. Scope & Methodology

This report details the structural, hierarchical, and domain validation of the VARDENA 264-account Base Chart specification across all ten (10) constituent attributes.

---

## 2. Exhaustive Validation Audit (12 Core Checks)

### Check 1: Is every code structurally valid?
- **Status:** **PASS / VALID**
- **Evidence:** All account codes conform to `ACCOUNT_CODE_PATTERN = /^[0-9]+$/` (ASCII digits only; no letters, spaces, or embedded punctuation). Lengths strictly equal 1 (Level 1), 3 (Level 2), or 6 (Level 3).

### Check 2: Is every non-root node connected to a valid parent?
- **Status:** **PASS / VALID**
- **Evidence:** 
  - Every Level 2 (General / کل) 3-digit code `Xyy` maps to a corresponding Level 1 (Group) root `X`.
  - Every Level 3 (Subsidiary / معین) 6-digit code `Xyyzzz` maps to a corresponding Level 2 parent `Xyy`.
  - No broken parent pointers exist in the hierarchical prefix structure.

### Check 3: Are there duplicate codes?
- **Status:** **PASS / NO DUPLICATES**
- **Evidence:** All 264 codes are unique within the template dataset. Uniqueness constraint `(versionId, code)` / `(organizationId, code)` is fully satisfied.

### Check 4: Are there malformed codes?
- **Status:** **PASS / NO MALFORMED CODES**
- **Evidence:** Zero codes violate the segment lengths ($1$, $2$, $3$) or maximum depth cap ($8$).

### Check 5: Are there unexpected nature values?
- **Status:** **RECONCILED TO CLOSED DOMAIN LIST**
- **Evidence:** The source artifact contains only `بدهکار`, `بستانکار`, and `هردو`.
  - `بدهکار` $\rightarrow$ `DEBIT`
  - `بستانکار` $\rightarrow$ `CREDIT`
  - `هردو` $\rightarrow$ `DUAL`
  - No unmapped or foreign nature values were identified.

### Check 6: Are there unexpected type values?
- **Status:** **RECONCILED TO CLOSED DOMAIN LIST**
- **Evidence:** The source artifact contains only `ترازنامه‌ای`, `سود و زیان`, and `انتظامی`.
  - `ترازنامه‌ای` $\rightarrow$ `BALANCE_SHEET`
  - `سود و زیان` $\rightarrow$ `INCOME_STATEMENT`
  - `انتظامی` $\rightarrow$ `MEMORANDUM`
  - No foreign type values exist.

### Check 7: Are detail flags only 0/1?
- **Status:** **PASS / BOOLEAN BINARY ONLY**
- **Evidence:** All values for `ACLTafsil1`, `ACLTafsil2`, `ACLTafsil3`, and `ACLTafsil4` evaluate strictly to `0` or `1`.

### Check 8: Are status values consistent?
- **Status:** **PASS / DIRECTLY COMPATIBLE**
- **Evidence:** Status values consist of `فعال` (`isActive = true`) and `غیرفعال` (`isActive = false`).

### Check 9: Are there orphan accounts?
- **Status:** **PASS / ZERO ORPHANS**
- **Evidence:** Since every Level 3 code references an existing Level 2 code, and every Level 2 references an existing Level 1 root, the entire tree forms a connected forest rooted at Groups 1 through 9.

### Check 10: Are there hierarchy anomalies?
- **Status:** **PASS / STRICTLY REGULAR**
- **Evidence:** Depth increases monotonically ($1 \rightarrow 2 \rightarrow 3$). There are no skipped levels (no Level 1 directly fathering Level 3 without a Level 2 intermediate node).

### Check 11: Which nodes are leaves?
- **Status:** **LEVEL 3 SUBSIDIARY NODES (AND CHILDLESS LEVEL 2 NODES)**
- **Evidence:**
  - All Level 3 nodes (~215 accounts) have no child nodes in the chart and are classified as **Leaves** (`isPostable = true`).
  - Posting lines may target only these leaf nodes.

### Check 12: Which nodes are non-leaves?
- **Status:** **LEVEL 1 GROUPS AND LEVEL 2 GENERAL ACCOUNTS**
- **Evidence:**
  - All 9 Level 1 (Group) nodes and all populated Level 2 (General) nodes have children and are classified as **Non-Leaves** (`isPostable = false`).
  - In accordance with ADR-0034 / Invariant 2, non-leaf nodes are aggregation nodes only.

---

## 3. Summary Scorecard

| Validation Check | Result | Severity | Action Required |
|---|---|---|---|
| **Code Syntax & Regex** | PASS | None | None |
| **Prefix & Hierarchy Integrity** | PASS | None | None |
| **Parent Reference Consistency** | PASS | None | None |
| **Uniqueness of Keys** | PASS | None | None |
| **Nature Values Domain Coverage** | MODEL GAP | High | Expand domain enum to admit `DUAL` |
| **Type Values Domain Coverage** | MODEL GAP | High | Add `AccountType` model & schema column |
| **Detail Requirement Flags** | MODEL GAP | Medium | Map to generic dimension rules |
| **Active Lifecycle Status** | PASS | None | Direct mapping to `isActive` |
