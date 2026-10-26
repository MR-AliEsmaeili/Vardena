# INV-01 — Movement reversal (checkpoint, 2026-10-26)

**Status:** Implemented for single non-transfer movements; final archive-wide PR verification remains pending.

## Backend contract, not UI assumptions

`POST /inventory/movements/:id/reverse` (201) requires `Inventory.Movement.Reverse`, scoped by the **query** `organizationId`; its `ReverseInventoryMovementDto` accepts `operationKey` (body), optional BusinessDate `movementDate`, `backdateConfirmed` and `repricing`. There is **no `reason` field**. The server creates a separate mirror (`reversal_in`/`reversal_out`) with negative base quantity, copying the original unit/conversion/reference/reason; UI neither modifies the original nor resolves a conversion again. Transfer legs require a pair and cannot be offered on this endpoint. The backend's original row is still visible; if already reversed, the backend rejects a second reversal.

## Rules and error presentation

| Backend condition | UI |
| --- | --- |
| `transferId` / `transfer_*` | Row shows a non-actionable explanation; `409` subcode `inventory.transfer.reverse_pair_required` maps to the same explanation on races. |
| Accounting-posted or immutable owner document | `422 inventory.reversal.accounting_posted` maps to domain guidance. |
| Date before original movement | Canonical day check disables submit; backend `422 inventory.reversal_date_before_original` remains authoritative. |
| Backdated without confirmation | Backend `422 inventory.backdated_document` opens existing two-step impact/choice dialogs; **no confirmation or choice default**. |
| Backdated without repricing choice | Backend `422 inventory.repricing_choice_required` uses the same two-step decision. |
| `recalculate` without Valuation.Recalculate | Recalculate radio disabled; 403 maps to permission guidance; backend still authorizes. |
| Already reversed | Backend emits **no structured subcode** for this 409; UI compares only its exact known English phrase to classify, but never displays the phrase. If that phrase changes, fallback is safe generic conflict. |
| Negative stock | `422 inventory.insufficient_stock` maps measured `onHand`/`requested` through shared quantity formatter. |
| Reused operation key with different request | Other 409 maps to operation-key conflict. The key is held in `useRef` for manual and backdate retries and is never put in a header. |

The shared inventory invalidator refreshes movements, Kardex, stock balances, and the valuation-state prefix for all filters in this organization; the frontend has no separate per-key valuation detail query. The list retains server pagination/filtering in the URL.

**Coverage caveat:** `GET /inventory/movements/:id` still has no standalone detail UI. The coverage row remains PARTIAL for that independent endpoint even though this task's reversal flow is implemented; XC-01 must reconcile the final grouping honestly.

## Test execution matrix

| Gate | Environment | Result |
| --- | --- | --- |
| Focused unit/component tests (row permissions, transfer/mirror exclusions, exact scoped body, two-step backdating, stable key, 409 and 422 mapping, invalidation) | FAST-LOCAL | Passed on this checkpoint. |
| Full typecheck/lint/format/unit/build/date-contract/doc-links | FAST-LOCAL | Passed: typecheck, lint, format:check, 758 unit tests / 108 files, build, date guard and 1,337 relative documentation links (0 broken). |
| Browser E2E and any live DB tests | CI-HEAVY | Pending GitHub run for this branch; not verified yet. |

No heavy E2E/live-DB test was executed locally unless explicitly authorized.
