# Task 29 — Open Questions (OQ) Reconciliation

## 1. Principles of OQ Governance

Per repository rule **AG-09**:
1. Open Questions are **never invented or closed wholesale** without explicit Owner decisions.
2. A task may only resolve specific sub-questions for which authoritative evidence or explicit decisions exist.
3. If an open question contains unresolved sub-aspects, its official status **REMAINS OPEN**.

---

## 2. Reconciled Open Questions

### 2.1 OQ-25: Chart of Accounts & Base Chart
- **Recorded Status:** **`OPEN`**
- **Sub-Questions Resolved in Prior Tasks:**
  - Task 20 (OD-20-1..OD-20-5): Base Chart mechanism as versioned template; consumer-first control roles; leaf-only posting; read-time aggregation.
  - Task 21: Base Chart governance baseline, template node field set, explicit copy adoption.
  - Task 28 Follow-up (OD-27-02): MVP requires Base Chart mechanism; concrete content set is NOT MVP-required.
- **Sub-Questions Resolved in Task 29:**
  - **Coding Compatibility:** VARDENA $1+2+3$ (Group 1, General 2, Subsidiary 3) is confirmed **directly compatible** with Vardena's configurable coding engine.
  - **Nature Domain Scope:** Resolved that `ماهیت حساب` requires admitting `DUAL` (`هردو`) alongside `DEBIT` and `CREDIT` (OD-29-01).
  - **Account Type Scope:** Resolved that `نوع حساب` consists of three fixed global types: `BALANCE_SHEET`, `INCOME_STATEMENT`, and `MEMORANDUM` (OD-29-02).
  - **English Title Scope:** Resolved that `عنوان انگلیسی حساب` is non-MVP metadata (OD-29-04).
- **Sub-Questions Remaining OPEN:**
  - Formal Owner approval of the VARDENA 264-account dataset as an approved template.
  - Production implementation of `AccountType` and `DUAL` nature in Prisma schema and domain services.
  - Mandatory control-role catalog and statutory account lists.
  - Deletion vs deactivation guards for unused accounts (OQ-36).
- **Final OQ-25 Status:** **`REMAINS OPEN`** (Preserved as Open; not closed).

---

### 2.2 OQ-41: Detail Dimensions (`تفصیلی`)
- **Recorded Status:** **`OPEN`**
- **Task 29 Findings:**
  - The source artifact's `ACLTafsil1..4` boolean flags map conceptually to line-level dimension requirement rules (`REQUIRED` / `FORBIDDEN` / `OPTIONAL`) per ADR-0037.
  - Hardcoding `requiresDetail1..4` columns on `Account` is rejected as an anti-pattern.
- **Sub-Questions Remaining OPEN:**
  - Exact dimension count per organization, UI dimension picker, dimension master-data bindings, and posting validation engine.
- **Final OQ-41 Status:** **`REMAINS OPEN`**.

---

### 2.3 OQ-43: Iranian Statutory Requirements & Reporting
- **Recorded Status:** **`OPEN`**
- **Task 29 Findings:**
  - Confirmed that English account title is non-MVP metadata.
  - Confirmed that statutory book layouts (`دفتر روزنامه`, `دفتر کل`) remain decoupled from core Base Chart loading and reside in the Legal Profile layer (ADR-0036).
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

Task 29 substantially narrows the domain ambiguities of **OQ-25** and **OQ-41** without prematurely closing them. All Open Questions remain faithfully tracked in `docs/open-questions.md`.
