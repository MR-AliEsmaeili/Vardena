# Coding Structure Fit-Gap Analysis: VARDENA `1 + 2 + 3` vs Vardena Architecture

## 1. Executive Summary

This document performs an exhaustive fit-gap evaluation of the owner-provided VARDENA Coding Structure (`1 + 2 + 3`) against Vardena's existing Coding Structure and Base Chart architecture.

**Key Verdict:** **DIRECTLY COMPATIBLE** (Proposition A & Proposition I Verified).

Vardena's existing configurable coding engine natively supports the VARDENA 3-tier composite coding structure (`1` digit Group + `2` digits General + `3` digits Subsidiary) without requiring any architectural redesign, schema change, or code modification.

---

## 2. VARDENA Structure vs Vardena System Limits

| Parameter                         | Vardena System Capability / Limit                        | VARDENA Specification                          | Fit-Gap Classification                | Evidence Path                                                  |
| --------------------------------- | -------------------------------------------------------- | ---------------------------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| **Max Depth / Level Count**       | Up to **8 levels** (`MAX_CODING_STRUCTURE_DEPTH = 8`)    | **3 levels** (Group, General, Subsidiary)      | **DIRECTLY COMPATIBLE** ($3 \le 8$)   | `backend/src/modules/accounting/domain/coding-structure.ts:80` |
| **Minimum Level Width**           | $\ge 1$ digit (`MIN_LEVEL_DIGIT_LENGTH = 1`)             | Level 1: 1, Level 2: 2, Level 3: 3             | **DIRECTLY COMPATIBLE** (All $\ge 1$) | `backend/src/modules/accounting/domain/coding-structure.ts:83` |
| **Max Code Length**               | Up to **32 characters** (`MAX_ACCOUNT_CODE_LENGTH = 32`) | Level 1: 1, Level 2: 3, Level 3: 6             | **DIRECTLY COMPATIBLE** ($6 \le 32$)  | `backend/src/modules/accounting/domain/coding-structure.ts:81` |
| **Code Character Set**            | ASCII Digits Only (`ACCOUNT_CODE_PATTERN = /^[0-9]+$/`)  | Digits only (`0-9`)                            | **DIRECTLY COMPATIBLE**               | `backend/src/modules/accounting/domain/account-code.ts:31`     |
| **Separator Storage**             | Unstored (Presentation only: `''`, `-`, `/`, `.`)        | Raw unseparated digits stored                  | **DIRECTLY COMPATIBLE**               | `backend/src/modules/accounting/domain/coding-structure.ts:50` |
| **Hierarchical Code Composition** | Prefix-based child extension                             | `1` $\rightarrow$ `101` $\rightarrow$ `101001` | **DIRECTLY COMPATIBLE**               | `backend/src/modules/accounting/domain/account-code.ts:68`     |

---

## 3. Structural Code & Hierarchy Validation

Vardena validates account codes using pure domain functions in `account-code.ts`:

### 3.1 Cumulative Length Validation (`checkAccountCode`)

- **Level 1 (Group / گروه):**
  - Expected Cumulative Length: $1$ digit (8 root codes: `1, 2, 3, 4, 5, 6, 7, 9`)
  - Sample Code: `1`
  - Suffix Width: $1$ digit
  - Parent: `null` (Root)
  - Result: **VALID**
- **Level 2 (General / کل):**
  - Expected Cumulative Length: $1 + 2 = 3$ digits (38 codes)
  - Sample Code: `101`
  - Suffix Width: $2$ digits
  - Parent: `1`
  - Suffix check: `101` starts with `1`, length diff $3 - 1 = 2$.
  - Result: **VALID**
- **Level 3 (Subsidiary / معین):**
  - Expected Cumulative Length: $1 + 2 + 3 = 6$ digits (218 codes)
  - Sample Code: `101001`
  - Suffix Width: $3$ digits
  - Parent: `101`
  - Suffix check: `101001` starts with `101`, length diff $6 - 3 = 3$.
  - Result: **VALID**

### 3.2 Dual-Authority Check (`parent_id` FK + Prefix Consistency)

Vardena enforces that the hierarchy tree authority is the relational `parent_id` / `parentNodeKey`, and the prefix is the mathematical proof. In `checkAccountCode`:

- If an account has `code = '101001'` and `parentCode = '101'`, `input.code.startsWith(input.parentCode)` evaluates to `true`, and `suffixLength === segmentLength` ($3 === 3$) evaluates to `true`.
- If an account code does not match its parent prefix, it is rejected with `'parent_prefix_mismatch'`.

---

## 4. Base Chart Template & Adoption Compatibility

### 4.1 Base Chart Template Compatibility (`planTemplateCompatibility`)

When an organization adopts a Base Chart Template version, `planTemplateCompatibility` in `base-chart-adoption.ts` evaluates:

1. `templateMaxDepth (3) <= configurationLevels.length (3)` $\rightarrow$ PASS.
2. `templateLevels[i].digitLength === configurationLevels[i].digitLength`:
   - Level 1: $1 === 1$ $\rightarrow$ PASS.
   - Level 2: $2 === 2$ $\rightarrow$ PASS.
   - Level 3: $3 === 3$ $\rightarrow$ PASS.
3. Every node code in the template is validated against `checkAccountCode` under the organization's configuration shape.

### 4.2 Leaf Detection & Postability Derivation (`deriveAdoptedPostability`)

Under Vardena's Invariant 2 (OD-20-5 / ADR-0034):

> **Posting = Leaf-only** (`postable ⇒ leaf`).

Crucially, **leaf status is determined solely by the structural absence of child nodes, NOT by level number or code length alone**:

- Any node that possesses child accounts in the adoption set is automatically forced to `isPostable = false`, regardless of template default.
- **Level 1 Nodes (8 roots):** All have children $\rightarrow$ `isPostable = false` (8 accounts).
- **Level 2 Nodes with children (34 accounts):** Have Level 3 children $\rightarrow$ `isPostable = false` (34 accounts).
- **Level 2 Nodes without children (4 accounts):** `307`, `602`, `703`, `704` have no children in the dataset $\rightarrow$ `isPostable = true` (4 accounts).
- **Level 3 Nodes (218 accounts):** Have no children $\rightarrow$ `isPostable = true` (218 accounts).
- **Summary:** Exactly **222 postable leaves** ($218 + 4$) and **42 non-postable aggregate nodes** ($8 + 34$).

### 4.3 Adoption By Copy (`planAdoptionSelection`)

- Template nodes are sorted topologically (Level 1 ascending, then code ascending).
- Adoption writes new organization-owned `Account` records with permanent ULIDs.
- Template identity never enters the ledger entries (`LedgerEntry.accountId` references `Account.id`).

---

## 5. Fit-Gap Assessment Matrix

| Architectural Area                 | Current Implementation Status                                      | VARDENA Requirement                 | Fit-Gap Status          |
| ---------------------------------- | ------------------------------------------------------------------ | ----------------------------------- | ----------------------- |
| **Configurable Level Count**       | Implemented (1 to 8 levels)                                        | 3 levels                            | **DIRECTLY COMPATIBLE** |
| **Configurable Segment Lengths**   | Implemented (dynamic per level)                                    | `1`, `2`, `3`                       | **DIRECTLY COMPATIBLE** |
| **Composite Code Concatenation**   | Implemented (pure digits string)                                   | Composite digit strings             | **DIRECTLY COMPATIBLE** |
| **Prefix / Hierarchy Enforcement** | Implemented (fails if prefix mismatch)                             | Strict hierarchical prefixes        | **DIRECTLY COMPATIBLE** |
| **Account Uniqueness**             | Implemented (`organizationId + code`)                              | Unique codes per organization       | **DIRECTLY COMPATIBLE** |
| **Derived Level Depth**            | Implemented (`root = 1, child = parent.level + 1`)                 | Derived depths 1, 2, 3              | **DIRECTLY COMPATIBLE** |
| **Leaf-Only Posting Enforcement**  | Implemented (`postable ⇒ leaf` derived)                            | 222 postable leaves (218 L3 + 4 L2) | **DIRECTLY COMPATIBLE** |
| **Template Publication Lifecycle** | Implemented (Draft $\rightarrow$ Approved $\rightarrow$ Published) | Versioned template                  | **DIRECTLY COMPATIBLE** |
| **Explicit Adoption by Copy**      | Implemented (Atomic transactional copy)                            | Organization adoption               | **DIRECTLY COMPATIBLE** |

---

## 6. Conclusion

The VARDENA coding scheme `1 + 2 + 3` is **100% architecturally compatible** with Vardena's accounting engine. No architectural redesign or schema change is needed for coding structure representation.
