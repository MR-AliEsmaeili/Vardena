# System Account Domain Analysis and Owner Decision (OD-29-06)

## 1. Historical Task 29 Analysis

Task 29 originally analyzed a possible `System Account` / `isSystem` concept as a classification for accounts controlled by automated processes. The analysis was explicitly illustrative, was not derived from the 264-account source artifact, and was submitted as OD-29-06 pending Owner decision.

Repository inspection confirmed that neither `Account` nor `BaseChartTemplateNode` has an `isSystem` field and current Posting validation has no System Account rule.

This historical analysis is preserved as evidence of the considered proposal; it is not the selected MVP model.

---

## 2. Owner Decision Closure

**OD-29-06 Status:** **`DECIDED`** (2026-09-28)

Vardena MVP will **not** have a System Account concept.

The MVP must not add:

- `isSystem`;
- `systemAccount`;
- System Account roles;
- System Account categories; or
- system-owned Account flags.

No Account is treated as a special System Account in the current MVP architecture. System status must not be inferred from an Account title, Account Type, Account Nature, control role, or any other existing property.

---

## 3. Future Boundary

If a future Accounting Engine capability demonstrates a concrete need for system-managed accounts, that capability requires a separate Owner Decision and architecture task. OD-29-06 does not pre-authorize such a concept and does not permit adding a placeholder flag now.

This record changes governance only. It removes the earlier `isSystem` proposal from the MVP direction and makes no production schema, API, Posting, permission, or UI change.
