# Detail Requirement Flags (`ACLTafsil1..4`) Mapping & Semantics

## 1. Source Artifact Semantics

The VARDENA source artifact contains four boolean flag columns:
- `ACLTafsil1`
- `ACLTafsil2`
- `ACLTafsil3`
- `ACLTafsil4`

### Clarified Semantics:
- **`0`**: No detail account relation / no requirement. When posting to this account, detail entry is not required.
- **`1`**: Relation / requirement exists. When this account is referenced on an accounting document line, the corresponding analytical detail (Tafsil / Dimension) **MUST** be supplied.

These flags are **active posting constraints**, not merely informational text comments.

---

## 2. Iranian SME Detail Architecture vs Vardena Architecture

In traditional Iranian legacy systems (e.g., FaraPayam, Rayvarz, Sepidar), accounts are linked to multi-level floating detail accounts (`تفصیلی شناور` / `تفصیلی سطوح ۱ تا ۴`):
- **سطح ۱ (Level 1 Detail):** Parties (Customers, Vendors, Employees, Shareholder accounts).
- **سطح ۲ (Level 2 Detail):** Cost Centers / Operational Departments.
- **سطح ۳ (Level 3 Detail):** Projects / Work Orders / Contracts.
- **سطح ۴ (Level 4 Detail):** Bank Accounts / Treasury Funds / Cash Desks / Analytical Tags.

---

## 3. Vardena Architecture Alignment (ADR-0037 & Domain Contract)

### 3.1 Architectural Principles (ADR-0037 §8, §9)
1. **No Rigid Numbered Columns (Anti-Pattern):** Vardena **MUST NOT** add columns like `requiresDetail1`, `requiresDetail2`, `requiresDetail3`, `requiresDetail4` to `Account` or `BaseChartTemplateNode`.
2. **Generic Dimension Architecture:** Vardena models analytical detail through **Accounting Detail Dimensions** (up to 8 configurable dimensions per contract §10/§11) and **Account-Dimension Requirement Rules**:
   ```text
   AccountDetailRequirement (or AccountDimensionRule)
   ├── accountId (FK -> Account)
   ├── dimensionId (FK -> AccountingDimension)
   └── requirementLevel: REQUIRED | OPTIONAL | FORBIDDEN
   ```
3. **Consumer-First Control Roles (OD-20-2 / OD-20-3):** Control roles attach to accounts via independent effective-dated mappings rather than fixed schema fields.
4. **Line-Level Assignments:** Document lines capture dimension assignments in typed child structures (`AccountingDocumentLineDimension`), validated at posting time.

---

## 4. Fit-Gap & Mapping Strategy

| Source Column | Conceptual Domain Meaning | Target Vardena Representation | Fit-Gap Classification |
|---|---|---|---|
| **`ACLTafsil1`** | Party / Customer / Vendor Detail Required | Dimension 1 Requirement (`REQUIRED`) | **MODEL GAP / IMPLEMENTATION REQUIRED** |
| **`ACLTafsil2`** | Cost Center / Department Detail Required | Dimension 2 Requirement (`REQUIRED`) | **MODEL GAP / IMPLEMENTATION REQUIRED** |
| **`ACLTafsil3`** | Project / Contract Detail Required | Dimension 3 Requirement (`REQUIRED`) | **MODEL GAP / IMPLEMENTATION REQUIRED** |
| **`ACLTafsil4`** | Bank / Sub-item Detail Required | Dimension 4 Requirement (`REQUIRED`) | **MODEL GAP / IMPLEMENTATION REQUIRED** |

---

## 5. Implementation Roadmap for Detail Validation

1. **Base Chart Loading Phase:**
   - Template authoring / loading should ingest `ACLTafsil1..4` as template node dimension requirement metadata or retain it in a structured requirement payload.
2. **Adoption Phase:**
   - When an organization adopts the template, the adoption planner maps these flags to organization-scoped `AccountDimensionRequirement` rules based on the organization's active dimension configuration.
3. **Posting Phase:**
   - Document finalization validates that document lines provide the mandatory dimension entries before committing to the ledger.
