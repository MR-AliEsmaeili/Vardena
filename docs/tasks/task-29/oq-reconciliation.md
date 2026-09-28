# Task 29 — Open Questions (OQ) Reconciliation

## 1. Principles of OQ Governance

Per repository rule **AG-09**:
1. Open Questions are **never invented or closed wholesale** without explicit Owner decisions.
2. A task may only record evidence, proposals, and sub-findings; it must not convert proposals into accepted Owner Decisions.
3. If an open question contains unresolved sub-aspects or pending owner decisions, its official status **REMAINS OPEN**.

---

## 2. Reconciled Open Questions

### 2.1 OQ-25: Chart of Accounts & Base Chart
- **Recorded Status:** **`OPEN`**
- **Sub-Questions Resolved in Prior Tasks (Owner Decisions):**
  - Task 20 (OD-20-1..OD-20-5): Base Chart mechanism as versioned template; consumer-first control roles; leaf-only posting; read-time aggregation.
  - Task 21: Base Chart governance baseline, template node field set, explicit copy adoption.
  - Task 28 Follow-up (OD-27-02): MVP requires Base Chart mechanism; concrete content set is NOT MVP-required.
- **Task 29 Findings and Owner Decision Closure (2026-09-28):**
  - **Coding Compatibility (Finding):** VARDENA $1+2+3$ (Group 1 digit, General 2 digits, Subsidiary 3 digits; cumulative 1, 3, 6) is verified **directly compatible** with Vardena's configurable coding engine.
  - **Nature Domain Scope (DECIDED — OD-29-01):** Account Nature has exactly `DEBIT`, `CREDIT`, and independent `DUAL`. Nature expresses natural balance orientation and does not by itself prohibit opposite-side entries. Detailed Accounting Engine policies remain future work.
  - **Account Type Scope (DECIDED — OD-29-02):** Account Type has exactly `BALANCE_SHEET`, `INCOME_STATEMENT`, and `MEMORANDUM`, independent from Nature, and is immutable after first Posting. Runtime persistence and enforcement remain unimplemented.
  - **English Title Scope (DECIDED — OD-29-04):** English Account Title is not required for MVP; a Base Chart without it is valid, and its absence blocks neither creation, publication, adoption, nor Posting.
- **Sub-Questions Remaining OPEN:**
  - Formal Owner approval of the VARDENA 264-account dataset as an approved template.
  - Production implementation of the decided `AccountType` and `DUAL` nature model in Prisma schema and domain services, including transactional Account Type immutability after first Posting (future separately authorized task).
  - Mandatory control-role catalog and statutory account lists.
  - Deletion vs deactivation guards for unused accounts (OQ-36).
- **Final OQ-25 Status:** **`REMAINS OPEN`** (Preserved as Open; not closed).

---

### 2.2 OQ-41: Detail Dimensions (`تفصیلی`)
- **Recorded Status:** **`OPEN`**
- **Task 29 Findings & Proposals (Owner Approval Pending):**
  - The source artifact's `ACLTafsil1..4` boolean flags are identified as source-level boolean detail-requirement constraints (`0` = no requirement, `1` = required detail code).
  - Task 29 proposes mapping these flags conceptually to generic line-level dimension requirement rules (`REQUIRED` / `FORBIDDEN` / `OPTIONAL`) per ADR-0037 rather than creating numbered columns (`requiresDetail1..4`); submitted as proposal **OD-29-03** (`PENDING OWNER DECISION`).
- **Sub-Questions Remaining OPEN:**
  - Exact dimension count per organization, UI dimension picker, dimension master-data bindings, and posting validation engine.
- **Final OQ-41 Status:** **`REMAINS OPEN`**.

---

### 2.3 OQ-43: Iranian Statutory Requirements & Reporting
- **Recorded Status:** **`OPEN`**
- **Task 29 Findings & Proposals:**
  - English account title is Owner-decided as not required for MVP (OD-29-04); its absence is not a statutory or lifecycle blocker.
  - Statutory book layouts (`دفتر روزنامه`, `دفتر کل`) remain decoupled from core Base Chart loading and reside in the Legal Profile layer (ADR-0036).
- **Final OQ-43 Status:** **`REMAINS OPEN`**.

---

### 2.4 OQ-36: Master-Data Lifecycle (Deletion vs Freeze)
- **Recorded Status:** **`OPEN`**
- **Task 29 Findings:**
  - Reconciled with Base Chart template nodes: Template drafts are fully mutable; published versions are immutable.
  - Adopted organization accounts remain freeze-over-delete (`isActive = false`), with no physical deletion of used accounts.
- **Final OQ-36 Status:** **`REMAINS OPEN`**.

---

### 2.5 OQ-62: Configuration Pin Coherence
- **Recorded Status:** **`OPEN`**
- **Task 29 Findings:**
  - ODR-1 pin coherence (`planPinCoherence`) is verified. Adoption of a 3-level Base Chart template ($1+2+3$) creates an ODR-1-coherent configuration and coding structure version.
- **Final OQ-62 Status:** **`REMAINS OPEN`**.

---

## 3. Conclusion

Task 29 provides concrete findings and proposals for **OQ-25** and **OQ-41** while strictly maintaining their open governance status. All Open Questions remain faithfully tracked as **`OPEN`** in `docs/open-questions.md`.

---

## 4. Closure Note

The 2026-09-28 Owner decision closes only OD-29-01, OD-29-02, and OD-29-04. It narrows OQ-25 but does not close it: concrete artifact approval, mandatory/control-role content, and other recorded sub-questions remain open. OD-29-03 remains pending, so OQ-41 is unchanged.
