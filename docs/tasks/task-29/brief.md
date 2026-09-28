# Task 29 — VARDENA Base Chart Reconciliation & Accounting Domain Decision Gate

## 0. Task Identity

| Attribute | Value |
|---|---|
| **Task** | 29 |
| **Title** | VARDENA Base Chart Reconciliation & Accounting Domain Decision Gate |
| **Type** | Governance / Domain Reconciliation / Fit-Gap Analysis / Decision Gate |
| **Status** | **READY FOR REVIEW — NOT ACCEPTED** |
| **Audited `main` HEAD (original Task 29)** | `862c85da7aa1fb86cb16d53341fcfd9c39dfa50a` |
| **OD-29-05 Follow-up `main` Baseline** | `280e07e2cbf3f031a4ec178341e5c617576d1189` |
| **Target Branch** | `main` (follow-up work on `arena/01a0e8fd-vardena`; original work on `arena/01a0e4d1-vardena`) |
| **Date** | 2026-09-28 |

**Owner Decision Closure (2026-09-28):** OD-29-01, OD-29-02, OD-29-03, OD-29-04, OD-29-05, and OD-29-06 are now **`DECIDED`**. OD-29-05 is **`DECIDED — OPTION C`**: Statement Classification is an independent, Organization-configurable reporting/presentation concept. Task 29 remains a non-implementation governance task and is not self-accepted. See `owner-decision-closure.md`.

---

## 1. Mission and Purpose

Task 29 is a **governance, domain-reconciliation, fit-gap analysis, and implementation-readiness decision gate** operating on the Vardena repository.

The primary objective is to reconcile the real owner-provided VARDENA Base Chart source artifact with the current Vardena Accounting architecture and determine:
1. What capabilities are already supported by the current Vardena architecture.
2. What represents a pure data/content mapping.
3. What constitutes a domain-model gap.
4. What requires an explicit Owner Decision.
5. What must be deferred to a later implementation task.
6. Whether the existing Base Chart and Coding Structure architecture can support the VARDENA chart without architectural redesign.
7. Whether the repository is ready for a later controlled Base Chart Content Loading & Adoption task.

The final deliverable of this task is an authoritative **decision gate**, NOT a production implementation.

---

## 2. Critical Scope Rules

### 2.1 Allowed
- Inspect repository baseline, schema, migrations, domain models, services, repositories, DTOs, controllers, frontend, ADRs, OQs, and roadmap documents.
- Profile and validate the VARDENA Base Chart source specification and structure.
- Perform fit-gap analysis across Coding Structure, Account Type, Balance Nature, Statement Class, System Account, and Detail Flags.
- Prepare governance decision packs, ADR reconciliations, OQ reconciliations, and implementation readiness matrices.
- Update repository governance files (`STATE.md`) to reflect the Task 29 baseline.

### 2.2 Strictly Prohibited
- NO modification of Prisma schemas or database migrations.
- NO database schema changes, table creation, or DDL execution.
- NO seeding of production database rows or creation of concrete chart accounts.
- NO modification of production domain models, application services, controllers, or DTOs.
- NO changes to permissions, guards, authentication, or organization isolation chokepoints.
- NO changes to runtime posting, accounting, closing, reporting, or document validation behavior.
- NO self-acceptance of Task 29 or ungranted Owner approval fabrication.
- NO implementation of future capabilities (Closing, Carry-Forward, Financial Statements, Memorandum Engine, Detail Validation, etc.).

---

## 3. Repository Baseline Verification

- **Original Task 29 audited `main` HEAD SHA:** `862c85da7aa1fb86cb16d53341fcfd9c39dfa50a` (Merge of PR #75).
- **OD-29-05 follow-up `main` baseline SHA:** `280e07e2cbf3f031a4ec178341e5c617576d1189` (`origin/main` at follow-up start).
- **Latest Merged Governance Baseline:**
  - Task 27 (PR #73): Main Governance Reconciliation & MVP Gate.
  - Task 28 (PR #74): Owner Decision Closure & MVP Implementation Selection Gate.
  - Task 28 Follow-up (PR #75): Formal recording of Owner Decision **OD-27-02** (Base Chart MVP scope boundary: mechanism = MVP, concrete content = NOT MVP-required).
- **Baseline Invariant OD-27-02 Preserved:** The Base Chart mechanism is an MVP capability, while concrete chart-of-accounts content is NOT MVP-required unless separately approved.

---

## 4. Key Findings & Decisions Summary

1. **Coding Structure Compatibility (Finding / Proposition A & I):**
   - The VARDENA hierarchical coding structure ($1$ digit Group + $2$ digits General + $3$ digits Subsidiary $\rightarrow$ cumulative lengths 1, 3, 6; 8 Level 1 roots, 38 Level 2, 218 Level 3) is **DIRECTLY COMPATIBLE** with Vardena's configurable coding engine ($MAX\_DEPTH = 8, MAX\_CODE\_LENGTH = 32$).
   - Posting derives dynamically via `postable ⇒ leaf` (222 leaves including childless Level 2 nodes `307`, `602`, `703`, `704`; 42 non-leaf parents).

2. **Balance Nature / Account Nature (`ماهیت حساب`) Gap (Decision OD-29-01):**
   - Source values observed: `بدهکار` (DEBIT, 171), `بستانکار` (CREDIT, 78), `هردو` (DUAL, 15 in Group 9).
   - Current Vardena model: Restricted to `ACCOUNT_NATURES = ['debit', 'credit']` in `domain/account.ts`.
   - **Conclusion:** **MODEL GAP / IMPLEMENTATION REQUIRED**. OD-29-01 now establishes `DUAL` as the third independent Nature (`DECIDED`); runtime support remains an implementation gap. Nature does not by itself prohibit opposite-side entries.

3. **Account Type (`نوع حساب`) Gap (Decision OD-29-02):**
   - Source values observed: `ترازنامه ای` (152), `سود و زیان` (97), `انتظامی` (15).
   - Current Vardena model: Lacks an `AccountType` concept on `Account` and `BaseChartTemplateNode`.
   - **Conclusion:** **MODEL GAP / IMPLEMENTATION REQUIRED**. OD-29-02 now establishes exactly 3 fixed global types (`BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM`) (`DECIDED`), independent from Nature and immutable after first Posting; runtime support and enforcement remain implementation gaps.

4. **Statement Classification Direction (OD-29-05):**
   - Purpose: Organization-configurable classification/presentation layout for financial reporting outputs without making Chart of Accounts hierarchy the sole source of financial-statement presentation.
   - **Conclusion:** **DECIDED — OPTION C**. Statement Classification is independent from Account Type, Account Nature, Account Hierarchy / Chart of Accounts, Detail / Detail Hierarchy, System Account, and Base Chart Coding Structure. No field, Prisma model, schema, taxonomy, reporting behavior, organization configuration UI, seed data, or implementation is authorized by this decision alone.

5. **System Account Scope (Decision OD-29-06):**
   - **Conclusion:** **NO SYSTEM ACCOUNT CONCEPT IN MVP**. Do not add `isSystem` or equivalent flags, roles, categories, or special Account treatment. Any future need requires a separate Owner Decision and architecture task.

6. **Detail Requirement / Detail Hierarchy (Decision OD-29-03):**
   - Source values: Boolean requirement flags (all `0` in source).
   - **Conclusion:** **MODEL GAP / IMPLEMENTATION REQUIRED**. Detail is a first-class organization-configurable hierarchy independent from Account; Accounts relate at the first Detail level; backend Posting validation enforces required values; used relationship removal is controlled, confirmed, atomic, and audited. Physical persistence and destructive-operation design remain for a separately authorized task.

7. **English Account Title (Decision OD-29-04):**
   - Source field: `عنوان انگليسي حساب`.
   - **Conclusion:** **DEFERRED / NON-MVP**. OD-29-04 is `DECIDED`: English Account Title is not required for MVP and its absence does not block account creation, publication, adoption, or Posting.

8. **Readiness Gate Conclusion:**
   - **Architecture Ready:** YES (Coding Structure, Base Chart Mechanism, Adoption by Copy, Hierarchy, Leaf Posting).
   - **Content Loading Ready:** NO (Blocked by missing domain model gaps: `DUAL` nature OD-29-01 and `AccountType` enum OD-29-02).
