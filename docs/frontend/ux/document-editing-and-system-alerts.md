# FE-UX — Document Editing, System Alerts, Report Builder & License Read-Only UX Contracts

**Status:** ACTIVE — UX contract (documentation only; **no UI is implemented or
authorized by this document**)
**Date:** 2026-10-05 (product & architecture governance re-baseline)
**Governance:** derived from Owner decisions **OD-54-01…11**
([OQ-54](../../decisions/product/OQ-54-finalized-document-deletion-editing.md)),
**OD-VAL-10…13** ([PDR-05](../../decisions/product/PDR-05-inventory-valuation-and-cost-optional-operations.md)),
the OQ-49 Report Builder decision
([OQ-49](../../decisions/product/OQ-49-report-builder-mvp-depth.md)) and the
OQ-45 license decision
([OQ-45](../../decisions/product/OQ-45-license-expiry-behavior.md)).
Aligned with `docs/frontend/standards.md` (v2.2), `ux-flow-matrix.md`,
`feedback-standard.md` and `persian-ux-writing-standard.md`. Backend contract:
ADR-0040 (Proposed) + `docs/architecture/domain/document-architecture.md` §6.1.

> Frontend checks are UX only (AR-21): every rule here is enforced by the
> backend; the UI's job is to make the backend's decisions visible, honest and
> understandable. Exact Persian wording is governed by
> `persian-ux-writing-standard.md` and is **not** fixed by this contract beyond
> the documented intent and the Persian vocabulary already fixed by PDR-05 §6.

## 1. Document editing UX (OQ-54)

| Requirement | Contract |
|---|---|
| Edit allowed before Accounting Post | Edit affordances are available on documents whose accounting effect is not yet posted, per the document's lifecycle rules. A posted document shows **no** edit affordance; it offers correction/reversal/counter-document entry points only. |
| Safe change | No extra warning beyond normal validation UX. Edit → validate → save. |
| Warning before material side effects | When the backend classifies an edit as *valid with material side effect* (inventory balance, Kardex, valuation/Moving Weighted Average, downstream documents, accounting readiness), the UI must present a **blocking decision dialog before commit** — never a toast, never after the fact. |
| Clear business-language warning | The warning explains the concrete business consequence (what changes, which stock/valuation is affected, that recalculation/repricing may be required). Generic "آیا مطمئن هستید؟" is forbidden (OD-VAL-10 discipline). |
| Explicit three-way choice | Where valuation is impacted the dialog offers exactly: **Continue + Recalculate/Reprice** (قیمت‌گذاری مجدد) · **Continue without Repricing** · **Cancel**. There is **no default/pre-selected choice** (OD-VAL-11). Repricing never happens silently. |
| Continue without repricing | The UI must represent the resulting **stale valuation** state explicitly (ارزش‌گذاری نامعتبر — نیازمند قیمت‌گذاری مجدد) wherever the affected values are shown, and the user must be told an administrative alert was generated. The user is never left believing valuation is current (OD-54-06). |
| Negative inventory hard block | When an edit would make physical stock negative, the UI shows a **blocking business error** naming: the affected item, the affected warehouse, and the business date that causes the negative balance — and states that the edit cannot complete without correcting the affected operational history. A generic «عملیات ناموفق بود» is **not acceptable**. There is no override. |
| Cancelled documents | Remain visible in lists/audit views with an explicit cancelled state; the UI never hides them or reuses their numbers. |

## 2. Management / administrative alerts (future surface — contract only)

A future management/admin UI must surface material system warnings. **Do not
implement it now**; this section fixes the UX contract so backend events are
designed against it.

- Events that must be surfaceable: valuation recalculation required; stale
  valuation; blocked inventory operation (negative stock); affected inventory
  history after a backdated/edited document; failed accounting integration;
  failed backup; license entering Grace or Read-Only.
- Alerts are **persistent and visible** to the responsible administrative
  persona until addressed — not transient toasts.
- Each alert states the business consequence and the recovery path in business
  language (Persian, per the writing standard).
- Alerts are permission-aware (RBAC): shown only to users entitled to act.

## 3. Report Builder UX scope (OQ-49 — MVP = A + controlled subset of B)

- **Standard ERP reports** (Accounting, Inventory, Sales, Purchasing,
  Management per the final MVP report catalogue) are code-defined registry
  reports rendered through the standard reporting pipeline (ADR-0009).
- **Controlled customization only:** filters, date ranges, selectable
  *permitted* columns, sorting, limited (single-column) grouping, saved report
  configurations, Excel export.
- **Forbidden in MVP UX:** any arbitrary SQL surface, unrestricted query
  designer, unrestricted formula engine, full BI designer, unrestricted
  drag-and-drop report designer. The UI must not expose unapproved entities or
  columns (backend allowlist is authoritative — AR-21, PB-BASELINE §17.2).

## 4. License Grace / Read-Only UX (OQ-45 — decided 2026-10-15)

- On expiry enter **Grace for 14 calendar days**, showing truthful reason/status
  and warning while normal authorized operation continues. Use authoritative
  license-time semantics, not browser clock/countdown policy. Grace extension
  needs Owner authorization plus a valid Owner-issued signed artifact; no local bypass.
- After Grace, all existing users may log in under normal auth and existing
  permissions for document/report views, printing and Excel export. License
  status, renewal and approved administrative/recovery backup remain accessible.
  Read-Only grants no additional permission and never rewrites users/data/history.
- Disable/explain business creation/modification, Accounting Post and inventory/
  accounting mutation controls. **Backend/API and relevant asynchronous paths
  must enforce the same restrictions**; frontend controls alone are not enforcement.
- Read-Only never logs users out. Valid renewal plus revalidation restores only
  previously authorized operation without data/permission reconstruction.
- Emergency restriction is a different reason/path, not expiry Grace: normal
  commercial access may be blocked, but an independently reachable authenticated
  administrator license/recovery interface remains required. Ordinary renewal,
  restart or clock correction never clears an unrelated emergency restriction.
- Dates, deadlines, history/audit and filters across Owner and customer screens
  follow [the global Jalali-first contract](../../datetime.md) §0.
- These are required UX behaviors, **not implemented enforcement**. Follow
  [PDR-11 §§9–10/20](../../decisions/product/PDR-11-vardena-licensing-product-requirements.md)
  for acceptance criteria, engineering gaps and security/protocol follow-ups.

## 5. Acceptance criteria for the future implementations (frontend)

1. A pre-post document shows edit affordances; a posted document shows none.
2. A side-effect edit cannot be committed from the UI without an explicit
   choice in the decision dialog; no choice is pre-selected.
3. The negative-stock block message contains item + warehouse + business date.
4. Skipping repricing renders the stale-valuation marker on affected values.
5. Cancelled documents render with a cancelled badge and remain listed.
6. Read-Only mode renders every mutation affordance disabled with an
   explanation; no mutation request can be issued from the UI.
7. Report customization UI exposes only backend-allowlisted entities/columns.
