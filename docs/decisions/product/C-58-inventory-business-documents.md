# C-58 — Inventory business documents

## Owner decision

Receipt, Issue and Transfer do **not** require mandatory approval in C-58/MVP. A user with the required permission may self-finalize. No approval queue, maker/checker, delegation, multi-level approval, or generic Approval Framework is introduced. OQ-13 and OQ-26 remain globally open.

## Lifecycle and boundary

The domain defines `Draft → Operational → Accounting Posted → Immutable`, plus cancellation from Draft or Operational. Drafts have no movement effects and no document number. Every other transition — including `Draft → Accounting Posted` and anything out of `Immutable` or `Cancelled` — is refused with `inventory.document.illegal_transition`.

This contract is now **operational**: document CRUD, movement composition, finalize/accounting-post/seal/cancel commands, the REST surface under `/inventory/business-documents`, and the Persian document screens are implemented and tested (see `docs/tasks/c-58-inventory-business-document-runtime.md` for the implemented slice, its evidence and its limitations).

Receipt cost is optional and is an Inventory valuation assignment, never purchase price; it is accepted only on a single-line receipt, because apportioning one amount across several lines is refused rather than invented. Issue has no manual cost; valuation derives it. Transfer uses two atomic authoritative movement legs through the existing transfer engine and preserves the fail-closed backdated behavior (OQ-67).

Pre-post edits follow the OQ-54/ADR-0040 pipeline (load, validate, detect side effects, apply, reconcile, optional explicit repricing, atomic persist) with a hard negative-stock block. An edit that changes an already-posted effect is refused until the operator supplies both an explicit acknowledgement and an explicit repricing choice — there is no default, and «skip» persists an honestly stale valuation state. After Accounting Post, direct edit/delete is forbidden; correction is a separate explicit document and is not part of C-58. ADR-0040 remains **Proposed**.

Inventory remains license- and permission-protected by the existing backend mechanisms. C-58 does not implement GL, COGS, tax, fiscal closing, or full Inventory-to-Accounting posting.
