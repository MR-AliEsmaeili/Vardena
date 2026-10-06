# C-58 — Inventory business documents

## Owner decision

Receipt, Issue and Transfer do **not** require mandatory approval in C-58/MVP. A user with the required permission may self-finalize. No approval queue, maker/checker, delegation, multi-level approval, or generic Approval Framework is introduced. OQ-13 and OQ-26 remain globally open.

## Lifecycle and boundary

The domain defines `Draft → Operational → Accounting Posted → Immutable`, plus cancellation from Draft or Operational. Drafts have no movement effects and no document number. Every other transition — including `Draft → Accounting Posted` and anything out of `Immutable` or `Cancelled` — is refused with `inventory.document.illegal_transition`.

This contract is now **operational**: document CRUD, movement composition, finalize/accounting-post/seal/cancel commands, the REST surface under `/inventory/business-documents`, and the Persian document screens are implemented and tested (see `docs/tasks/c-58-inventory-business-document-runtime.md` for the implemented slice, its evidence and its limitations).

Receipt cost is optional and is an Inventory valuation assignment, never purchase price; it is accepted only on a single-line receipt, because apportioning one amount across several lines is refused rather than invented. Issue has no manual cost; valuation derives it. Transfer uses two atomic authoritative movement legs through the existing transfer engine and preserves the fail-closed backdated behavior (OQ-67).

Pre-post edits follow the OQ-54/ADR-0040 pipeline (load, validate, detect side effects, apply, reconcile, optional explicit repricing, atomic persist) with a hard negative-stock block. An edit that changes an already-posted effect is refused until the operator supplies both an explicit acknowledgement and an explicit repricing choice — there is no default, and «skip» persists an honestly stale valuation state. After Accounting Post, direct edit/delete is forbidden; correction is a separate explicit document and is not part of C-58. ADR-0040 remains **Proposed**.

## Transaction boundaries

The inventory effect of a command — movement legs, balance deltas, valuation-state writes, an explicitly requested repricing and the document's own state change — is **one transaction**. A failure anywhere in it rolls all of it back; the document is either fully posted and repriced, or untouched.

Document **numbering is a separate transactional boundary** and is not covered by that rollback. `NumberingService` stays the single numbering authority and owns its own transaction, so the number is allocated before the inventory transaction and survives a failed finalize. The guarantee is the allocation key, which is the document id: the same document always replays the same number, a different finalized document always receives a different number, and a number is never silently reused. A failed finalize leaves a draft with no number and an allocation reserved for it; a crash in between leaves an unused allocation (a gap), never a duplicate.

Inventory remains license- and permission-protected by the existing backend mechanisms. C-58 does not implement GL, COGS, tax, fiscal closing, or full Inventory-to-Accounting posting.

## Post-merge verification (2026-10-06)

PR #122 (`feat(inventory): implement C-58 business document runtime`) is
**MERGED** — merged 2026-10-06T09:49:21Z by the Owner, head SHA
`39d06f768cb4d5aa41b742cb44d3cdfce6c5ca3f`, merge commit
`d0dc28691a646a1ea194a35cc233e04a58b7d459`, which **is** the current `main`
head. CI on that head SHA was green (`backend` SUCCESS, `frontend` SUCCESS,
run `37444676807`).

**It carried no human review.** `reviewDecision` is empty, there are zero
reviews and zero review comments; the single PR comment is an automated notice
that the Codex reviewer had exhausted its usage limit. **MERGED ≠ ACCEPTED**
(STATE.md §6) applies with full force here: this slice was merged and
CI-green, not reviewed and not accepted.

A post-merge review was performed on `main` (Git truth, not the PR
description). Findings:

| # | Finding | Status |
|---|---|---|
| 1 | **Finalize on a CANCELLED document returned 200 instead of refusing.** The idempotency guard short-circuited on `status !== 'draft' && operationKey === finalizeKey`; cancellation keeps the finalize operation key for audit, so `cancelled → operational` was reported as a successful replay. No stock was ever moved by this path, so there was no data defect — the API simply reported success for a refused lifecycle step | **FIXED** — the guard is now gated on `hasLedgerEffect(status)`; regression test added |
| 2 | **`accountingPostDocument` does not enforce the Accounting eligibility gate.** It records the boundary without checking valuation completeness, so an unpriced or `valuationStale` document can be moved to `accounting_posted` — after which it is immutable and no longer cancellable, with no correction path implemented | **OPEN implementation gap** against PDR-07 / OD-PRC-11. Assigned to **C-59F**. Not fixed here: adding the gate is new C-59 behaviour, and C-59 is not authorized by this task |
| 3 | **The edit path reuses `acknowledgeSideEffects` as the backdate confirmation.** `updateDocument` passes `backdateConfirmed: input.acknowledgeSideEffects === true` into `assertPostingAllowed`, so editing a backdated operational document never shows the backdating-specific warning OD-VAL-10 requires. The operator still gives two answers (acknowledge + explicit repricing), so OD-VAL-11 holds; what is lost is the distinct backdating question and its measured facts | **OPEN** — a separate `backdateConfirmed` field on the edit command plus the matching dialog. Backend + frontend change; deliberately **not** done here to avoid scope expansion. Assigned to C-59 |

Verified sound in the same review: the lifecycle transition table (every legal
and illegal pair, including `draft → accounting_posted`); the one caller-owned
transaction for finalize/edit/cancel with the repricing replay **inside** it;
numbering as a separate, documented transactional boundary keyed on the
document id; organization scoping on every read and command, answering 404
rather than 403; permission separation (document ≠ movement ≠ transfer ≠
valuation authority); the negative-stock gate reusing the existing
`resolveEffectivePolicy` path with no C-58 bypass; and reuse of
`InventoryMovementsRepository` / `InventoryTransfersService` /
`InventoryValuationService` with no second ledger, no duplicate balance
arithmetic and no duplicate numbering implementation.
