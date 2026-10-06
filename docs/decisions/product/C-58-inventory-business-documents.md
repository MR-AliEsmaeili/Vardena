# C-58 — Inventory business documents

## Owner decision

Receipt, Issue and Transfer do **not** require mandatory approval in C-58/MVP. A user with the required permission may self-finalize. No approval queue, maker/checker, delegation, multi-level approval, or generic Approval Framework is introduced. OQ-13 and OQ-26 remain globally open.

## Lifecycle and boundary

`Draft → Operational → Accounting Posted → Immutable`. Drafts have no movement effects. Operationalization validates organization, permissions, licensing, lines, conversion and stock policy, then uses the existing caller-owned transaction seam from PR #120 to commit the document effect, authoritative movement ledger, valuation state, lifecycle and idempotency together. Any failure rolls everything back.

Receipt cost is optional and is an Inventory valuation assignment, never purchase price. Issue has no manual cost; valuation derives it. Transfer is two atomic authoritative movement legs and preserves the fail-closed backdated behavior (OQ-67).

Before Accounting Post, material edits reconcile the old effect and replacement inside one transaction; negative stock is a hard block and the old document remains unchanged on failure. After Accounting Post, direct edit/delete is forbidden; history and numbering remain, with correction/reversal only where supported. Valuation-impacting backdated edits must be explicit and bounded; repricing is never silent (OQ-68/OQ-69 remain open).

Inventory remains license- and permission-protected by the existing backend mechanisms. C-58 does not implement GL, COGS, tax, fiscal closing, or full Inventory-to-Accounting posting.
