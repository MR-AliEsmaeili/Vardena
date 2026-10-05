# OQ-54: Finalized document deletion/editing policy — DECIDED (Option B)

- **Type:** OQ (product/accounting policy decision) → **Decided**
- **Status:** **Decided — Owner decision recorded 2026-10-05 (Option B: edit until Accounting Post, then cancel/correct only).** Permission/approval coupling (§6 item 3) remains open under OQ-13/OQ-26.
- **Owner:** Ali Esmaeili (with accountant + auditor input)
- **Created:** 2026-09-22 · **Decided:** 2026-10-05 (governance re-baseline)
- **Decision ids:** **OD-54-01 … OD-54-11** (register below)
- **Related docs:** PB-BASELINE §16 (scenario), §31; AR-13 (immutability); OQ-13 (approval/negative-stock policy), OQ-27 (accounting correction policy), OQ-36 (master-data deletion), OQ-12 (numbering gaps); ADR-0019/0023 (document foundation); ADR-0039/PDR-05 (valuation, OD-VAL-10…OD-VAL-13); **ADR-0040 (Proposed — backend contract for this decision)**; `docs/architecture/domain/document-architecture.md` §6/§6.1; `docs/frontend/ux/document-editing-and-system-alerts.md` (frontend contract); roadmap Stage 2/3/4

> **What this record is.** The Owner answered the platform-wide question this
> OQ registered. The previously recorded recommendation (Option A, cancel-only)
> is **NOT** the decision — see §Historical record. This record is the single
> canonical product policy for editing/deleting operational business documents
> (warehouse receipts/issues, sales/purchasing documents and their kin). It
> accepts no implementation, promotes no ADR (ADR-0040 stays **Proposed**),
> and does not override the narrower lifecycle decisions already recorded for
> specific document types (e.g. C-50 Material Request).

## Decision (Owner, 2026-10-05) — Option B: edit until Accounting Post, then cancel/correct only

| id | Decision |
|---|---|
| **OD-54-01** | **A document remains editable until Accounting Post.** Before its accounting effect is posted, editing is allowed according to the document's lifecycle rules. "Accounting Post" is the existing accounting boundary: the moment the document's accounting effect exists as a finalized accounting document / ledger entries (ADR-0026 posting contract, contract §15/§16 `draft`/`temporary`/`final` vocabulary — no new state is invented). |
| **OD-54-02** | **After Accounting Post, direct editing is forbidden.** The accounting result is immutable (AR-13). Direct deletion is also forbidden. Correction/reversal/counter-document mechanisms are the only way to change the economic result. |
| **OD-54-03** | **Every pre-post edit must be validated against operational side effects before commit.** No material side effect (inventory balance, Kardex, valuation, Moving Weighted Average, downstream documents, accounting readiness, other operational calculations) may occur silently. |
| **OD-54-04** | **Negative physical inventory resulting from an edit is a hard block.** The edit must fail with a clear business error (item, warehouse, business date that causes the negative balance) and no partial mutation. Confirms OD-VAL-17/ADR-0022 §5 in the edit context. |
| **OD-54-05** | **Valuation-impacting edits require explicit user acknowledgement.** The user chooses: Continue + recalculate/reprice · Continue without repricing · Cancel. Repricing/recalculation never happens silently (reaffirms OD-VAL-11/OD-VAL-12). |
| **OD-54-06** | **Choosing "continue without repricing" must honestly persist a stale valuation state** and generate an administrative/system alert (see the alert requirement below). The user must never be left believing valuation is current. |
| **OD-54-07** | **Business documents are never physically deleted when business history exists** (unchanged from database-strategy §7; consistent with PDR-04 for master data). |
| **OD-54-08** | **Cancelled documents remain visible and auditable** according to the document visibility policy; they are excluded from open/operational reports but never hidden from audit. |
| **OD-54-09** | **Document numbering is never reused** — including the number of a cancelled document. The existing Document Foundation allocation boundary (ADR-0023: in-transaction allocation ledger, no-reuse, accepted gaps) is preserved; no new numbering mechanism is introduced by this decision. Gap policy detail remains OQ-12. |
| **OD-54-10** | **Side-effect detection must be explicit and testable** (a classification step in the edit pipeline — see ADR-0040), never an implicit by-product of persistence. |
| **OD-54-11** | **Material side effects must become visible/alerted.** The product requires a future-compatible administrative alert model for events such as: valuation recalculation required, stale valuation, affected inventory history, blocked edit due to negative stock, failed accounting integration, failed backup, license entering Grace/Read-Only. **The alert center is NOT implemented or authorized by this decision** — the requirement is recorded here and in ADR-0040/the frontend UX contract. |

### Policy, restated operationally

**Before Accounting Post**

- Edit allowed (per document lifecycle rules).
- Operational side effects are evaluated **before** commit.
- The user is explicitly informed about material side effects, in business
  language (OD-VAL-10 wording discipline: never a generic "Are you sure?").
- Negative inventory resulting from the edit **blocks** the operation.
- Valuation-impacting edits require explicit acknowledgement; repricing /
  recalculation never happens silently.

**After Accounting Post**

- Direct edit forbidden. Direct deletion forbidden.
- Correction / reversal / counter-document only.
- The accounting ledger remains immutable.

**Cancelled documents**

- Remain visible/auditable; are not physically deleted; their numbers are not
  reused.

### Side-effect classification (the first-class Vardena rule)

> **No material side effect caused by a user editing an operational document
> may occur silently.**

| Class | Behaviour |
|---|---|
| **Safe change** (no material side effect) | Edit → Validate → Commit. Normal UX, no extra warning. |
| **Valid change with side effect** (e.g. Receipt 100 → 90, stock stays non-negative but subsequent valuation changes) | Detect → explain in business language → state that recalculation/repricing may be required → require explicit choice: **Continue + Recalculate/Reprice** · **Continue without Repricing** (document proceeds if otherwise valid; stale valuation is explicitly represented; an administrative/system alert is generated) · **Cancel**. |
| **Invalid change** (resulting physical stock would go negative, e.g. Receipt 100 → 90 with 95 already issued ⇒ 90 − 95 = −5) | **BLOCK.** No commit, no partial mutation. The error names the item, the warehouse, and the business date that causes the negative balance, and explains that the edit cannot complete without correcting the affected operational history. A generic "Operation failed" is not acceptable. |

Exact UI wording beyond this documented intent is **not** decided here (frontend
contract: `docs/frontend/ux/document-editing-and-system-alerts.md`).

## Consequences (costs this choice accepts)

- **Operational effect reconciliation:** a pre-post edit must reconcile the
  already-applied operational effects (movements, reservations, relations), not
  just the document rows.
- **Inventory replay/recalculation:** valuation-impacting edits pull in the
  bounded replay machinery (OD-VAL-12); the "until posted" boundary makes edit
  paths heavier than create paths.
- **Valuation impact detection:** every edit path needs a side-effect detection
  step with its own tests; detection gaps are defects, not UX polish.
- **Warning UX:** the frontend must carry a real decision dialog (reprice /
  continue / cancel), not a confirm box; wording is a product surface.
- **Alert visibility:** stale valuation and blocked edits must surface in a
  future administrative alert model (OD-54-11) — an extra product surface.
- **Stricter transaction boundaries:** validate → detect → apply → reconcile →
  (optional reprice) → persist must be atomic; a rejected edit leaves the
  database unchanged.
- **More tests:** the acceptance catalogue below is binding for the
  implementing tasks.
- **Cross-module boundary:** "posted?" is a cross-module timing fact; it must
  be expressed through document states + events (AR-07), which is exactly what
  ADR-0040 contracts.

## Implementation gates

| Layer | What is decided vs what remains |
|---|---|
| **Product decision** | This record (OD-54-01…11). Decided by the Owner; canonical. |
| **Backend contract** | ADR-0040 (**Proposed** — acceptance gate: explicit Owner acceptance per `docs/adr/README.md`); detailed contract in `document-architecture.md` §6.1. **Documented, NOT implemented.** |
| **Frontend UX requirement** | `docs/frontend/ux/document-editing-and-system-alerts.md`. **Documented, NOT implemented.** |
| **Future implementation** | No edit pipeline, side-effect detector, alert model, or operational document state machine implementing this policy exists on `main` as of 2026-10-05 (no Receipt/Issue/Sales documents exist yet; C-50 Material Request has its own narrower decided lifecycle). Implementation requires its own gated tasks. |
| **Still open** | Permission/approval coupling for edit/cancel (OQ-13/OQ-26); numbering gap policy detail (OQ-12); accounting correction windows (OQ-27); statutory retention (OQ-43). |

## Acceptance tests the implementation must satisfy (future work — none exist today)

Lifecycle: (1) draft can be edited; (2) a finalized-but-unposted document can be
edited; (3) a posted document cannot be directly edited; (4) a posted document
is changed only by correction/reversal. Inventory: (5) an edit causing negative
stock is rejected; (6) a rejected edit leaves the database unchanged; (7) a
valuation-affecting edit produces an explicit warning; (8) the user can choose
recalculation; (9) the user can explicitly skip recalculation where allowed;
(10) skipped recalculation creates a visible stale-state warning/alert. Audit:
(11) a cancelled document remains visible; (12) numbering is never reused;
(13) no silent side effect exists (every material-effect path is either
acknowledged or blocked).

## Historical record (not the decision)

The record as originally registered (2026-09-22) posed the question, listed
options A (cancel-only, never edit), B (edit until posted, then cancel-only)
and C (per-type configuration), and **recommended A** ("cancel-only, visible,
audited" as default). That recommendation was never an Owner decision. On
2026-10-05 the Owner selected the policy equivalent to **Option B**, as
registered above. Historical references to "cancel-only recommended" in dated
task reports and reconciliations remain valid as history and must not be read
as the decision.

## Related documents

PB-BASELINE §16, §31; AR-13; OQ-12, OQ-13, OQ-26, OQ-27, OQ-36, OQ-43;
ADR-0019/0023/0026/0039/**0040**; PDR-05 (OD-VAL-10…13, 17);
`docs/architecture/domain/document-architecture.md` §6/§6.1;
`docs/frontend/ux/document-editing-and-system-alerts.md`; roadmap Stages 2–4.
