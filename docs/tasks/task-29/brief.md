# Task 29 — VARDENA Base Chart Reconciliation & Accounting Domain Decision Gate

## 0. Task Identity

| Attribute | Value |
|---|---|
| **Task** | 29 |
| **Title** | VARDENA Base Chart Reconciliation & Accounting Domain Decision Gate |
| **Type** | Governance / Domain Reconciliation / Fit-Gap Analysis / Decision Gate |
| **Status** | **READY FOR REVIEW — NOT ACCEPTED** |
| **Audited `main` HEAD** | `862c85da7aa1fb86cb16d53341fcfd9c39dfa50a` |
| **Target Branch** | `main` (work on `arena/01a0e4d1-vardena`) |
| **Date** | 2026-09-28 |

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

- **Current `main` HEAD SHA:** `862c85da7aa1fb86cb16d53341fcfd9c39dfa50a` (Merge of PR #75).
- **Latest Merged Governance Baseline:**
  - Task 27 (PR #73): Main Governance Reconciliation & MVP Gate.
  - Task 28 (PR #74): Owner Decision Closure & MVP Implementation Selection Gate.
  - Task 28 Follow-up (PR #75): Formal recording of Owner Decision **OD-27-02** (Base Chart MVP scope boundary: mechanism = MVP, concrete content = NOT MVP-required).
- **Baseline Invariant OD-27-02 Preserved:** The Base Chart mechanism is an MVP capability, while concrete chart-of-accounts content is NOT MVP-required unless separately approved.

---

## 4. Key Findings Summary

1. **Coding Structure Compatibility (Proposition A / Proposition I):**
   - The VARDENA hierarchical coding structure:
     - Level 1 (Group): 1 digit (e.g. `1`)
     - Level 2 (General): 2 digits appended (e.g. `1 + 01 = 101`, cumulative length 3)
     - Level 3 (Subsidiary): 3 digits appended (e.g. `1 + 01 + 001 = 101001`, cumulative length 6)
   - **Conclusion:** **DIRECTLY COMPATIBLE**. Vardena's configurable Coding Structure mechanism (`MAX_DEPTH = 8`, `MAX_CODE_LENGTH = 32`, dynamic level segment widths, prefix validation, and leaf-only postability derivation) natively supports the VARDENA `1+2+3` structure without any architectural changes.

2. **Balance Nature / Account Nature (`ماهیت حساب`) Gap (Proposition B):**
   - Source values: `بدهکار` (DEBIT), `بستانکار` (CREDIT), `هردو` (DUAL).
   - Current Vardena model: Restricted to `ACCOUNT_NATURES = ['debit', 'credit']` in `backend/src/modules/accounting/domain/account.ts`, `BaseChartTemplate`, `AccountsService`, and DTOs.
   - **Conclusion:** **MODEL GAP / IMPLEMENTATION REQUIRED**. `DUAL` (`هردو`) must be officially admitted into the domain type definition, validation pipelines, and DTO contracts.

3. **Account Type (`نوع حساب`) Gap (Proposition C / Proposition D):**
   - Source values represent three fixed global account types:
     - `ترازنامه‌ای` $\rightarrow$ `BALANCE_SHEET`
     - `سود و زیان` $\rightarrow$ `INCOME_STATEMENT`
     - `انتظامی` $\rightarrow$ `MEMORANDUM`
   - Current Vardena model: Completely lacks an `AccountType` concept or field on `Account` and `BaseChartTemplateNode`.
   - **Conclusion:** **MODEL GAP / IMPLEMENTATION REQUIRED**. A 3-value enum `AccountType` must be introduced to the domain model and schema in a future implementation task.

4. **Statement Class Separation (Proposition E):**
   - Purpose: Organization-configurable presentation hierarchy / categorization for financial statements (Balance Sheet / Income Statement presentation).
   - **Conclusion:** **DOMAIN/MODEL GAP — FUTURE IMPLEMENTATION REQUIRED** (post-MVP / reporting design). Must remain separate from the fixed global `AccountType`.

5. **System Account Separation (Proposition F):**
   - Purpose: Distinguish system-controlled accounts (`isSystem`) from user-postable accounts.
   - **Conclusion:** **FUTURE MODEL GAP**. Not present in current models; deferred to future closing/system integration tasks.

6. **Detail Flags (`ACLTafsil1..4`) Mapping (Proposition G):**
   - Source values: Boolean requirement flags (`0` = no requirement, `1` = required detail on posting).
   - **Conclusion:** **MODEL GAP / IMPLEMENTATION REQUIRED**. Maps conceptually to Vardena's generic line-level dimension requirement rules (ADR-0037) rather than hardcoded `requiresDetail1..4` columns.

7. **English Account Title (Proposition H):**
   - Source field: `عنوان انگليسي حساب`.
   - **Conclusion:** **DEFERRED / NON-MVP**. Retained as source-only metadata.

8. **Readiness Gate Conclusion:**
   - **Architecture Ready:** YES (Coding Structure, Base Chart Mechanism, Adoption by Copy, Hierarchy, Leaf Posting).
   - **Content Loading Ready:** NO (Blocked by missing domain fields: `DUAL` nature, `AccountType` enum, and detail requirement mapping).
