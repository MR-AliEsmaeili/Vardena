# OQ-54: Finalized document deletion/editing policy

- **Type:** OQ (product/accounting policy decision)
- **Status:** Open
- **Owner:** Ali Esmaeili (with accountant + auditor input)
- **Created:** 2026-09-22
- **Priority:** High · **Blocks policy posture for Sales/Inventory stages** (Stage 0/2)
- **Related docs:** PB-BASELINE §16 (scenario), §31; AR-13 (immutability); OQ-13 (approval/negative-stock policy), OQ-27 (accounting correction policy), OQ-36 (master-data deletion), OQ-12 (numbering gaps); ADR-0019/0023 (document foundation); roadmap Stage 2/3/4

## Context

The repo has decided architecture-level truths: accounting journal entries and
ledger entries are **immutable**; corrections are counter-documents (AR-13;
OQ-27 governs correction windows); transactional documents are **canceled by
state transition, never soft-deleted** (database-strategy §7); the accounting
contract refuses reopen for final documents. What is **not decided is the
product policy for finalized operational documents** — sales invoices, warehouse
receipts/issues *before* they become accounting entries, and the interplay when
they already have:

1. May a finalized (but not yet posted) sales invoice be edited? deleted?
   canceled only?
2. May a warehouse receipt/issue be edited or canceled after stock has moved?
3. If a document was posted to accounting (system-posted, once OQ-39/OQ-42
   activate), is editing ever possible, or only correction documents?
4. Does cancellation of a numbered document leave an intentional numbering gap
   (OQ-12), and is the canceled document retained visible (audit) or hidden?
5. Who may edit/cancel (permission model: same role? creator? supervisor?) and
   does the decided workflow approval policy (OQ-26/OQ-13) gate it?

## Why this matters

- Every operational module (Sales, Inventory) implements its state machine
  against this policy; building before deciding risks rework of endpoints,
  permissions, and UI.
- Cancellation semantics touch audit integrity (documents disappearing vs
  canceled-and-visible) and statutory expectations (OQ-43: no deletion from
  legal books).
- It decides the *default posture* the MVP scenario assumes: the §16 scenario
  says "register warehouse receipt … register sale" without stating what happens
  on a mistake.

## Exact decision required

1. Single unified policy or per-document-type policy (receipt vs issue vs
   invoice)?
2. Allowed transitions for finalized documents: `cancel` only? `edit-until-
   posted`? none (correction documents only)?
3. Visibility of canceled documents; numbering-gap acceptance (OQ-12 link).
4. Permission model for cancel/edit and any supervisor/approval coupling
   (OQ-13/OQ-26).

## Options

| Option | Advantages | Disadvantages |
|---|---|---|
| **A. Cancel-only, never edit, canceled stay visible** (accounting-style discipline everywhere) | Uniform; audit-clean; matches immutability culture; simplest to reason about | Users expect edit-before-post; stricter than some competitors |
| **B. Edit allowed until posted/canceled, then cancel-only** | Familiar UX; fewer canceled-document noise | "Until posted" boundary must be enforced cross-module (Sales ↔ Accounting timing); riskier inventory arithmetic |
| **C. Per-type policy configured per organization** | Flexibility | Most complex; config surface + validation matrix; errors likely |

## Risks

- Option B's cross-module timing boundary ("posted?") is exactly the kind of
  hidden coupling AR-07 forbids unless expressed via document states + events.
- Statutory exposure if cancellation is allowed to *hide* records that belong in
  legal books (OQ-43).

## Dependencies

- OQ-13 (approval states — does cancel require approval?), OQ-27 (accounting
  corrections), OQ-12 (numbering gaps), OQ-43 (statutory retention).
- Document Foundation capabilities (ADR-0019/0023) — states and relations
  already exist; this is policy, not mechanism.

## Recommended option

**A as the default (cancel-only, visible, audited), with B permitted only for
document types the owner explicitly names as draft-friendly** (e.g. sales
quotes). **Recommendation only — owner + accountant decide.**

## Questions requiring product owner confirmation

1. Is cancel-only the universal default, or do you want edit-until-posted for
   sales/inventory documents?
2. Must canceled documents remain visible in lists (with a "canceled" badge),
   or only in audit views?
3. Does cancellation require approval (supervisor) or just permission?

## Decision deadline or dependency

Before Sales/Inventory operational stages build their state machines (Stage 2/3
gate); ideally resolved in Stage 0 with the other policy OQs.

## Related documents

PB-BASELINE §16, §31; AR-13; OQ-12, OQ-13, OQ-26, OQ-27, OQ-36, OQ-43;
ADR-0019/0023; roadmap Stages 2–4.
