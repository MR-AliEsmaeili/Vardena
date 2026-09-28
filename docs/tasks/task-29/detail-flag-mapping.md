# Detail Requirement Flags (`ACLTafsil1..4`) Mapping & Semantics

## 1. Source Artifact Semantics

The VARDENA source artifact contains four boolean flag columns:
- `ACLTafsil1`
- `ACLTafsil2`
- `ACLTafsil3`
- `ACLTafsil4`

### Verified Source Value & Meaning:
- In the canonical 264-row source artifact (`Pasted markdown(20260927-203801).md`), **100% of rows have value `'0'`** for `ACLTafsil1`, `ACLTafsil2`, `ACLTafsil3`, and `ACLTafsil4`.
- **`0`**: No corresponding detail requirement. When posting to this account, detail entry is not required.
- **`1`**: A corresponding detail code is required whenever the account is used in an accounting document/turnover line.

These fields represent **source-level boolean detail-requirement constraints**, not merely informational text comments.

---

## 2. Source Scope Boundary & Reclassification of Legacy Inferences

### Critical Governance Boundary:
The source artifact establishes strictly that `ACLTafsil1..4` are numbered boolean detail-requirement flags (`0` or `1`). **The source artifact does NOT establish fixed business identities** (such as Party, Cost Center, Project, or Bank) for flags 1 through 4.

Any legacy industry conventions (e.g. associating level 1 with parties or level 2 with cost centers in specific legacy software products) are external conventions and are **NOT part of the authoritative VARDENA Base Chart specification**.

### Task 29 Core Finding:
> `ACLTafsil1..4` are source-level boolean detail-requirement flags. Their runtime mapping to Vardena's generic Accounting Detail / Dimension / Control Role architecture requires a separate domain decision and implementation design.

---

## 3. Vardena Architecture Alignment (ADR-0037 & Proposed OD-29-03)

### 3.1 Architectural Principles
1. **No Rigid Numbered Columns (Anti-Pattern):** Vardena **MUST NOT** add rigid schema columns like `requiresDetail1`, `requiresDetail2`, `requiresDetail3`, `requiresDetail4` to `Account` or `BaseChartTemplateNode`.
2. **Generic Configurable Dimension Architecture:** Vardena models analytical detail through **Accounting Detail Dimensions** (up to 8 configurable dimensions per ADR-0037) and **Account-Dimension Requirement Rules**:
   ```text
   AccountDetailRequirement (or AccountDimensionRule)
   ├── accountId (FK -> Account)
   ├── dimensionId (FK -> AccountingDimension)
   └── requirementLevel: REQUIRED | OPTIONAL | FORBIDDEN
   ```
3. **Line-Level Validation:** Document lines capture dimension assignments in typed child structures (`AccountingDocumentLineDimension`), validated at posting time against active rules.

---

## 4. Fit-Gap & Mapping Strategy

| Source Column | Source Definition | Target Vardena Representation (Proposed) | Fit-Gap Classification | Owner Decision Status |
|---|---|---|---|---|
| **`ACLTafsil1`** | Boolean Detail Requirement 1 (`0`/`1`) | Generic Account-Dimension Requirement Rule (`REQUIRED`/`OPTIONAL`) | **MODEL GAP / IMPLEMENTATION REQUIRED** | OD-29-03 (`PENDING OWNER DECISION`) |
| **`ACLTafsil2`** | Boolean Detail Requirement 2 (`0`/`1`) | Generic Account-Dimension Requirement Rule (`REQUIRED`/`OPTIONAL`) | **MODEL GAP / IMPLEMENTATION REQUIRED** | OD-29-03 (`PENDING OWNER DECISION`) |
| **`ACLTafsil3`** | Boolean Detail Requirement 3 (`0`/`1`) | Generic Account-Dimension Requirement Rule (`REQUIRED`/`OPTIONAL`) | **MODEL GAP / IMPLEMENTATION REQUIRED** | OD-29-03 (`PENDING OWNER DECISION`) |
| **`ACLTafsil4`** | Boolean Detail Requirement 4 (`0`/`1`) | Generic Account-Dimension Requirement Rule (`REQUIRED`/`OPTIONAL`) | **MODEL GAP / IMPLEMENTATION REQUIRED** | OD-29-03 (`PENDING OWNER DECISION`) |

---

## 5. Implementation Recommendations (Future Task 32)

1. **Base Template Storage:** Ingest `ACLTafsil1..4` boolean flags as raw template node metadata or unassigned requirement slots.
2. **Adoption-Time Mapping:** When an organization adopts the template, map template requirement slots to organization-specific active dimensions (e.g., Dimension 1 $\rightarrow$ Dimension Slot 1).
3. **Posting-Time Enforcement:** Document line validation verifies that any mandatory dimensions for an account are populated on document lines prior to posting.
