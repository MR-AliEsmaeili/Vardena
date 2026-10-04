# PDR-05: Inventory valuation foundation and cost-optional warehouse operations (OQ-24 — partial)

- **Type:** PDR (Product Decision Record) · decision ids **OD-VAL-01 … OD-VAL-19**
- **Status:** **Decided** — Owner decisions recorded 2026-10-04, transcribed from the work order for the "Inventory Valuation Foundation + Cost-Optional Warehouse Operations" implementation task
- **Decided by:** Repository Owner (Ali Esmaeili), explicit decision text recorded in the work order
- **Owner of the remaining questions:** Accountant + inventory expert (OQ-24 stays **OPEN**)
- **Registry row:** [`docs/open-questions.md`](../../open-questions.md) — **OQ-24 remains OPEN** (partially resolved; see §4)
- **Recording baseline:** `main` @ `1e3d407fd3f08650e0e70353f96b277e80ef03fd` (merge of PR #115)
- **Related records:** ADR-0039 (this slice's architecture) · ADR-0022 (inventory core ledger, Accepted) · ADR-0017 (ledger as source of truth) · D-04/D-05/D-06/D-07/D-21/D-26 in [`domain-decisions.md`](../../architecture/domain/domain-decisions.md) · PDR-01 / OD-C47-01 (quantity exactness) · OQ-03 (money precision) · OQ-11 · OQ-54

> Unlike PDR-01…PDR-04, the work order that carried these decisions **also
> authorized the implementation of this slice**. This record is therefore the
> decision source for the code in `backend/src/modules/inventory/**` that cites
> `OD-VAL-xx`, and ADR-0039 is its architectural counterpart. Implementation and
> a green pipeline still do **not** constitute acceptance (STATE.md §6:
> MERGED ≠ ACCEPTED), and this record does not close OQ-24.

## 1. Question decided

OQ-24 (verbatim registry text): *"Inventory valuation and stock policy: which
costing method (moving weighted average / FIFO / standard), how returns,
adjustments and negative stock affect cost, and whether negative stock is
permitted at all."*

The Owner answered the **method**, the **configuration scope**, the **state
granularity**, the **operational relationship between quantity and cost**, the
**backdating/recalculation policy** and the **negative-stock posture**. Returns
costing was explicitly left unanswered (OD-VAL-19).

## 2. Decision register (OD-VAL-01 … OD-VAL-19)

| id | Decision | Why it is not inferable from the code |
|---|---|---|
| **OD-VAL-01** | **Perpetual inventory.** Inventory value is maintained continuously as movements are posted, not computed by a periodic end-of-period count. | A periodic model would be an equally valid ERP posture; nothing in the ledger implies which one is wanted. |
| **OD-VAL-02** | **Moving Weighted Average is the ONLY active valuation method of the MVP.** FIFO, LIFO and Specific Identification are not implemented and must not be offered. | The method is a business policy, not a technical preference. |
| **OD-VAL-03** | **Method configuration scope = Organization + Item.** Not global-only, and not per warehouse. | Scope determines the shape of the configuration table; it cannot be guessed. |
| **OD-VAL-04** | **Valuation state is keyed at the physical stock granularity:** organization + warehouse + item — the same key the balance projection uses. | Organization-wide averaging and per-warehouse averaging give different numbers for the same facts. |
| **OD-VAL-05** | **Cost is NOT required on a warehouse receipt.** A receipt with no monetary value is a complete, valid posting. | This is the load-bearing decision of the slice: it says an operational reality (goods arrive before prices do) outranks accounting convenience. |
| **OD-VAL-06** | **A cost may be supplied LATER for stock that was received without one,** without re-posting or editing the quantity fact. | Late pricing is a product capability, not a technical consequence. |
| **OD-VAL-07** | **A warehouse issue never requires an operator-entered cost.** Outbound value is derived by the item's valuation method. | Prevents per-document costing policy decided by whoever is at the keyboard. |
| **OD-VAL-08** | **Warehouse Operations and Inventory Accounting are two UX workspaces over the SAME records.** No second ledger, no duplicated inventory document, no parallel "accounting receipt". | Two workspaces could equally have been built as two datasets; the Owner forbade that. |
| **OD-VAL-09** | **Purchase price ≠ inventory cost.** Purchasing may later inform the cost; it never owns it. | Many ERPs equate the two; this one must not. |
| **OD-VAL-10** | **Backdated documents are allowed, but must be DETECTED and explicitly CONFIRMED,** with a warning that explains the business consequence in Persian — never a generic "Are you sure?". | Allowing, blocking, or silently accepting backdating are three different products. |
| **OD-VAL-11** | **A SECOND, separate, explicit decision is required: recalculate the affected valuation, or not.** There is no default. "Do not recalculate" must honestly persist an inconsistent (stale) valuation state rather than pretend the numbers are right. | The honesty requirement — a visibly wrong number over a silently wrong one — is a product value judgement. |
| **OD-VAL-12** | **Recalculation must be deterministic, transaction-safe and BOUNDED.** There is no "recalculate everything" command. | An unbounded repricing is the easiest thing to build and the hardest thing to live with. |
| **OD-VAL-13** | **Quantity posting and valuation are separate concerns.** Valuation never blocks, delays or rejects a quantity fact; a missing or broken valuation must never lose a warehouse movement. | Decides what happens when the two disagree — the most consequential rule in the slice. |
| **OD-VAL-14** | **Valuation-method configuration is EFFECTIVE-DATED.** Versions are inserted and superseded, never edited in place, and a document dated in the past resolves the version that was in force then. | Same mechanism as D-21/OD-C47-01 for conversions, but it is an independent decision for valuation. |
| **OD-VAL-15** | **Opening Balance stays CALCULATED** (derived from the ledger, no fabricated "opening movement" row). **Initial Inventory is a real, explicit business event** when it happens. | A fake opening movement is a common shortcut; it was explicitly rejected. |
| **OD-VAL-16** | **Money precision is exact-or-reject for entered amounts.** An amount a human typed is never rounded; rounding exists only where the method itself derives a value from a division, and the residual stays in the state so `SUM(movement value) == state value` cannot drift. | Mirrors OD-C47-01 for quantities, but money cannot refuse to round everywhere — the boundary had to be decided. |
| **OD-VAL-17** | **Negative physical inventory is REJECTED for the MVP** (existing fail-closed policy confirmed in the valuation context). | Confirms, in the valuation context, the posture ADR-0022 §5 adopted as interim. |
| **OD-VAL-18** | **No fake options.** A valuation method that is not implemented must never be offered in the UI, accepted by the API, or stored as configuration. | The alternative — accept it now, implement it later — is a common and damaging shortcut. |
| **OD-VAL-19** | **Return costing is NOT built now and NOT foreclosed.** Returns are recorded as a future concern with no interim rule invented. | Prevents an accidental de-facto return-costing rule emerging from the reversal implementation. |

## 3. What this decision does NOT decide

Per the Owner's instruction, nothing beyond the register above is closed. Still **OPEN**:

| Sub-question | Status after OD-VAL-01…19 |
|---|---|
| Return costing (at what value does returned stock re-enter?) | **OPEN** — OD-VAL-19 explicitly defers it; the reversal rule (undo the original's own value) must **not** be read as the return rule |
| COGS / journal posting of inventory value into Accounting | **OPEN** — out of scope by the work order; Inventory owns valuation, Accounting owns posting (ADR-0005, OQ-39/OQ-42) |
| Landed cost, freight, duties, purchase-price variance | **OPEN** — not modelled anywhere |
| Money precision and currency for valuation beyond `numeric(18,2)` | **OPEN** — owned by OQ-03/OQ-11; this record only decides exact-or-reject at the entry boundary |
| Whether a per-warehouse average may diverge from a sibling warehouse's average after a transfer, and whether that is acceptable to the accountant | **OPEN** — new **OQ-67** |
| Whether a reversal must always undo the original's own value, or the current average | **OPEN** — new **OQ-68**; the implementation uses the original's own value and says so |
| Per-movement valuation history (who changed which value, when, to what) beyond the run record | **OPEN** — new **OQ-69** |
| Standard costing, revaluation, write-down/NRV, inventory ageing | **OPEN** — not requested, not implemented |
| Whether `Inventory.Valuation.View` is the right split for every persona (e.g. a branch manager) | **OPEN** — the permission exists; its assignment policy is an administrative decision |
| Lot/serial/expiry-level valuation | **OPEN** — tracked items are refused by the posting path today (ADR-0022) |

## 4. Effect on OQ-24

OQ-24 **remains OPEN**. It is partially resolved: the *method*, *scope*,
*granularity*, *negative-stock posture* and the *operational relationship
between quantity and cost* now have explicit Owner answers; *returns*,
*COGS/journal posting*, *landed cost* and *valuation precision/currency* do not.
The registry row is updated in place with this record's id — no duplicate
registry is created.

## 5. Implementation evidence (fact, not acceptance)

| Decided element | Evidence |
|---|---|
| OD-VAL-01/02/18 | `backend/src/modules/inventory/domain/valuation-method.ts` (`VALUATION_METHODS` vs `ACTIVE_VALUATION_METHODS`, `inactiveMethodMessage`), 422 on configuring an inactive method |
| OD-VAL-03/14 | `inventory.item_valuation_methods` (organization + item + `valid_from`), `data/item-valuation-methods.repository.ts`, `resolveValuationMethodAt` |
| OD-VAL-04 | `inventory.inventory_valuation_states` unique on `(organization_id, warehouse_id, item_id)` |
| OD-VAL-05/07/16 | `application/inventory-cost-support.ts`, `domain/money.ts`, DTO `unitCost`/`totalCost` optional and inbound-only |
| OD-VAL-06 | `POST /inventory/valuation/movements/{id}/cost` (`InventoryValuationRepository.assignCost`) |
| OD-VAL-08 | `total_cost` + status columns live ON `inventory.inventory_movements`; no new document or ledger table |
| OD-VAL-09 | schema comment on `inventory_movements.total_cost`; no purchasing coupling exists |
| OD-VAL-10/11 | `domain/backdating.ts`, `InventoryValuationService.requireBackdateDecisions`, `GET /inventory/valuation/backdate-check`, codes `inventory.backdated_document` / `inventory.repricing_choice_required` |
| OD-VAL-12 | `RECALCULATION_MOVEMENT_LIMIT`, one-key `POST /inventory/valuation/recalculations`, `RecalculationTooLargeError` |
| OD-VAL-13 | valuation runs inside the posting transaction but can only produce "unvalued"; the backdated repricing runs as a SECOND transaction after the quantity commit |
| OD-VAL-15 | no opening-movement row exists anywhere; balances stay derived |
| OD-VAL-17 | unchanged `violatesNegativePolicy` gate, re-asserted by `test/inventory-valuation.e2e-spec.ts` |
| OD-VAL-19 | recorded here and in ADR-0039 §Consequences; no return path implemented |

## 6. Persian vocabulary fixed by this record

User-facing terms (frontend i18n, UX docs — technical architecture stays English):

| English (technical) | Persian (user-facing) |
|---|---|
| Inventory receipt | رسید انبار |
| Inventory issue | صادره انبار |
| Inventory cost / valuation value | قیمت تمام‌شده |
| Moving Weighted Average | میانگین موزون متحرک |
| Recalculation / repricing | قیمت‌گذاری مجدد |
| Uncosted stock (received without a cost) | موجودی بدون قیمت تمام‌شده |
| Stale valuation (inconsistent, needs repricing) | ارزش‌گذاری نامعتبر (نیازمند قیمت‌گذاری مجدد) |
| Backdated document | سند با تاریخ گذشته |
| Valuation method | روش قیمت‌گذاری موجودی |
| Warehouse Operations (workspace) | عملیات انبار |
| Inventory Accounting (workspace) | حسابداری انبار |
