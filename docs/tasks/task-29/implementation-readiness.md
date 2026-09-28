# Implementation Readiness Matrix: VARDENA Base Chart Adoption

## 1. Architectural Readiness vs Production Implementation Readiness

To maintain rigorous governance, this analysis distinguishes between:
- **Architecture Ready:** The foundational design, domain boundaries, invariants, and algorithms exist and can support the requirement without structural redesign.
- **Production Implementation Ready:** The database schemas, migrations, runtime domain models, validators, and DTOs are fully in place to immediately ingest and execute the capability in production.

---

## 2. Comprehensive Implementation Readiness Matrix

| Area | Architecture Ready? | Production Implementation Ready? | Blocker / Missing Element | Future Work / Proposed Task |
|---|---|---|---|---|
| **1. Coding Structure** | **YES** | **YES** | None. Supports depth 8, width 32, dynamic levels ($1+2+3$). | None needed for coding structure. |
| **2. Base Chart Template Mechanism** | **YES** | **YES** | None. Task 23 mechanism implemented and verified on `main`. | None needed for mechanism. |
| **3. Base Chart Content Loading** | **YES** | **NO** | Blocked by missing domain fields (`AccountType`, `DUAL` nature). | Proposed Task 31 (Base Chart Content Loading; blocked on Task 30). |
| **4. Account Type** | **YES** | **NO** | Missing `type` column in Prisma schema, DTOs, and domain models. | Proposed Task 30 (Schema migration & domain enum addition; OD-29-02). |
| **5. Balance Nature** | **YES** | **NO** | Domain validator `isAccountNature` rejects `'dual'`. | Proposed Task 30 (Expand `ACCOUNT_NATURES` to include `dual`; OD-29-01). |
| **6. Statement Class** | **YES** | **NO** | Statement Class model and presentation engine not built. | Future Reporting Foundation Task (Post-MVP; OD-29-05). |
| **7. Detail Requirements (`ACLTafsil1..4`)** | **YES** | **NO** | Generic line-level dimension requirement rules not yet implemented. | Proposed Task 32 (Detail Dimensions & Validation; OD-29-03). |
| **8. System Accounts (`isSystem`)** | **YES** | **NO** | `isSystem` flag absent from models; closing rules not built. | Future Fiscal Year-End Closing Task (OD-29-06). |
| **9. Base Chart Adoption** | **YES** | **YES** | None. Atomic copy adoption planner verified. | Unblocked once template version is published. |
| **10. Ledger Identity Separation** | **YES** | **YES** | None. Invariant 1 verified (`Template.nodeKey ≠ Account.id`). | Fully operational. |

---

## 3. Prerequisite Path & Blocker Clarification

Task 29 clearly distinguishes between **immediate content-loading blockers** and **future detail/dimension architecture**:

### 3.1 Immediate Content-Loading Blockers (Proposed Task 30)
Because the canonical 264-account dataset actively contains 15 `DUAL` accounts in Group 9 and 3 distinct Account Types (152 Balance Sheet, 97 Income Statement, 15 Memorandum), the repository **CANNOT** safely ingest and persist the dataset until the domain model and schema are expanded:

1. **Implementation of decided OD-29-01 (Account Nature):**
   - Expand `ACCOUNT_NATURES` to include `'dual'` in domain validators, DTOs, and frontend badges.
2. **Implementation of decided OD-29-02 (Account Type):**
   - Add `AccountType` enum (`BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM`) to Prisma schema (`Account`, `BaseChartTemplateNode`) and DTOs via a rehearsed migration.

### 3.2 Future/General ACLTafsil Architecture (Proposed Task 32)
- In the canonical source artifact, **100% of the 264 rows have `ACLTafsil1..4 = 0`** (no mandatory detail requirement).
- Therefore, while the long-term generic dimension mapping strategy under **OD-29-03** remains `PENDING OWNER DECISION`, the absence of active detail validation logic does **NOT** block the structural ingestion of this specific 264-row dataset once Prerequisites 1 and 2 are resolved.
- OD-29-03 remains pending and will govern future document-line validation when dimension requirements are enabled.

---

## 4. Proposed Technical Implementation Roadmap

The required implementation sequence follows a strict dependency chain:

```text
┌──────────────────────────────────────────────────────────────┐
│ Task 30 (Proposed): Domain Model & Schema Expansion           │
│ • Add AccountType enum & column                              │
│ • Expand ACCOUNT_NATURES to include 'dual'                   │
│ • Prerequisite: OD-29-01/02 decided; implementation authorized│
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ Task 31 (Proposed): Base Chart Content Ingestion & Template  │
│ • Ingest 264-row VARDENA Base Chart into Template Version    │
│ • Publish template version for organization adoptions        │
│ • Prerequisite: Task 30 completed and merged                 │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ Task 32 (Proposed): Detail Dimension Rules & Line Validation │
│ • Implement AccountDimensionRule for ACLTafsil1..4 mapping   │
│ • Enforce mandatory dimension validation on document lines   │
│ • Prerequisite: Owner Decision OD-29-03                      │
└──────────────────────────────────────────────────────────────┘
```

*(Note: None of these future tasks are authorized by Task 29. Task 29 is a decision gate only).*

---

## 5. Final Verdict

1. **Architecture:** **100% COMPATIBLE** (No architectural redesign required).
2. **Content Ingestion:** **BLOCKED** on implementation of the decided Domain Model Gaps (OD-29-01 and OD-29-02) through a separately authorized task.

---

## 6. Owner Decision Closure Update (2026-09-28)

OD-29-01 and OD-29-02 are **`DECIDED`**, removing the owner-decision ambiguity for the value sets and core semantics. OD-29-04 is also **`DECIDED`**: English Account Title is not an MVP requirement and is not a content-loading blocker. Production readiness remains **NO** until a separately authorized implementation adds `DUAL`, persists Account Type, and enforces Account Type immutability after first Posting. This update does not authorize Task 30 or approve production loading of the 264-account artifact.
