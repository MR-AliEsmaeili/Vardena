# C-58 — Inventory business documents

## Owner decision

Receipt, Issue and Transfer do **not** require mandatory approval in C-58/MVP. A user with the required permission may self-finalize. No approval queue, maker/checker, delegation, multi-level approval, or generic Approval Framework is introduced. OQ-13 and OQ-26 remain globally open.

## Lifecycle and boundary

The domain foundation defines `Draft → Operational → Accounting Posted → Immutable`. Drafts have no movement effects in the intended contract. The current implementation contains the typed aggregate rules and persistence foundation; runtime document CRUD, movement composition, accounting-post command integration, and frontend document screens remain to be wired before this contract can be described as operational.

Receipt cost is optional and is an Inventory valuation assignment, never purchase price. Issue has no manual cost; valuation derives it. Transfer is intended to use two atomic authoritative movement legs and preserve the fail-closed backdated behavior (OQ-67).

The intended pre-post edit behavior is atomic reconciliation with a hard negative-stock block. After Accounting Post, direct edit/delete is forbidden. These behaviors require the pending application-service and integration-test implementation.

Inventory remains license- and permission-protected by the existing backend mechanisms. C-58 does not implement GL, COGS, tax, fiscal closing, or full Inventory-to-Accounting posting.
