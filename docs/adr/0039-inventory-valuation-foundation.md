# ADR-0039: Inventory Valuation Foundation — Value on the Existing Ledger, Cost-Optional Operations, Explicit Bounded Repricing

Status: Proposed (written with the "Inventory Valuation Foundation + Cost-Optional Warehouse Operations" slice, 2026-10-04; acceptance is the Owner's decision on the review of PR #116 — an implementation agent cannot promote its own ADR)
Date: 2026-10-04

## Context

ADR-0017 makes the append-only movement ledger the source of stock truth and
ADR-0022 implements it — deliberately **without** any monetary field
("Gap accepted: no costing/valuation fields yet (OQ-24 valuation remains
open); the ledger stores quantities, not money"). D-06 further states that the
valuation *method* is configuration consuming the ledger and must not be baked
into the movement table.

PDR-05 (OD-VAL-01…OD-VAL-19) now supplies the missing product decisions:
perpetual inventory, Moving Weighted Average as the only active method,
configuration per organization + item, state at the physical stock key, cost
optional on warehouse receipts, two workspaces over one set of records,
backdating allowed only behind two explicit confirmations, and bounded
deterministic repricing.

What had to be decided architecturally was: **where value lives**, **what
happens when quantity and value disagree**, and **what a recalculation is
allowed to touch**.

## Decision

1. **Value is a column set on the EXISTING ledger, not a second ledger.**
   `inventory_movements` gains `total_cost` (SIGNED, mirroring
   `base_quantity`), `valuation_status`, `valuation_source`, `valued_at` and
   `valuation_run_id`. Inventory value is `SUM(total_cost)` exactly as on-hand
   is `SUM(base_quantity)`. There is no inventory-accounting document table and
   no duplicate receipt/issue row (OD-VAL-08). This does **not** contradict
   D-06: the *method* is still configuration; what lives on the row is the
   *result* — the value that fact actually carried.
2. **No stored `unit_cost`.** A per-unit figure is a rounded presentation of
   `total_cost / base_quantity` and would become a second, divergent truth.
   This is a deliberate deviation from the sketch in
   `inventory-domain-analysis.md` §2.1, which listed `unit_cost` and
   `total_cost`.
3. **Three new tables.** `item_valuation_methods` (effective-dated
   configuration, organization + item, same versioning mechanism as
   `unit_conversions`), `inventory_valuation_states` (the Moving Weighted
   Average position per organization + warehouse + item), and
   `inventory_valuation_runs` (the audit record of every explicit repricing).
4. **The state carries the uncosted quantity explicitly.** A key holds
   `valued_quantity` + `total_value` **and** `uncosted_quantity` — stock that
   physically exists and has no cost yet. Two invariants hold by construction:
   - **(I1)** `balance.on_hand == valued_quantity + uncosted_quantity`, always;
   - **(I2)** `SUM(movement.total_cost) == state.total_value` for every key
     that is not `stale`.
   Valuing uncosted stock at zero would satisfy neither honestly.
5. **Valuation never gates a quantity posting (OD-VAL-13).** Inside the
   posting transaction the strategy either values the movement or records why
   it could not (`unvalued` + a reason derived on read); it has no branch that
   rejects. Negative stock is still rejected — by the quantity policy, not by
   valuation.
6. **Movement `valuation_status` states FINALITY, key `status` states
   HEALTH.** Movement: `unvalued` | `provisional` | `valued`. Key: `valued` |
   `pending_cost` | `stale`, precedence `stale > pending_cost > valued`.
   `stale_since` is **sticky** — only an explicit recalculation clears it,
   because until then the stored numbers really are the wrong ones.
7. **Strategy rules (pure, framework-free, unit-tested).** Inbound with a value
   → valued (order-independent, so a backdated costed receipt is applied but
   marks the key stale); inbound without a value → `unvalued`, joins
   `uncosted_quantity`; issues consume **uncosted stock first**; an issue that
   empties the valued pool takes the whole residual value (so zero quantity
   always means zero value); a transfer is exactly value-neutral and writes
   both legs and both states in one call; a reversal undoes the value the
   ORIGINAL carried, read from the locked original row.
8. **Repricing is a replay, and the replay is idempotent.** `replay(facts)`
   re-applies a key's whole history in the canonical ledger order
   (`movement_date, created_at, id` — the same order C-54's Kardex uses).
   Values a fact carries on its own authority (`entered`, `transfer`,
   `reversal`) are preserved verbatim; only `average_cost` values are
   recomputed. That split is what makes a second run report
   `movementsRevalued: 0` instead of drifting.
8a. **The replay resolves the method PER MOVEMENT, at that movement's own
    business date (OD-VAL-14).** Every `ReplayFact` carries the method
    resolved from the item's effective-dated versions at its `movement_date`,
    and `domain/valuation-replay.ts` asks for a strategy once per fact. A run
    never applies "the method in force today" to history — that would defeat
    the point of effective dating. The `method` column on
    `inventory_valuation_runs` and on `inventory_valuation_states` therefore
    means *the method in force for the key at the moment the run executed*
    (what the key is valued under going forward), **not** the method applied
    to every replayed row; the per-movement history itself is not yet stored
    (**OQ-69**). The dispatch is a closed `switch` over the same closed method
    vocabulary the configuration endpoint validates — not a registry, not
    configuration-driven handlers. A period configured with a method this
    build cannot execute makes the replay **fail closed** with
    `inventory.valuation_method_not_implemented` (naming the method and the
    movement) instead of being silently restated under Moving Weighted
    Average.
9. **Recalculation is bounded by construction (OD-VAL-12).** One
   `(organization, warehouse, item)` key per command — the key is a required
   input, not a filter. The repository reads `RECALCULATION_MOVEMENT_LIMIT + 1`
   rows and refuses an oversize key (`RecalculationTooLargeError` → 422) rather
   than truncating it. Everything commits in one transaction: movement rows,
   state, run record and idempotency row. **Every read the command makes is
   bounded, including the configuration read** — and bounded by the right
   quantity: the method versions are selected as the ones in force at the
   DISTINCT movement dates being replayed (one window branch per date), so
   the result is bounded by how many dates there are, never by how densely
   the item has been reconfigured. A replay of two movements reads two
   versions whether the item has three configuration versions or thirty
   thousand. Both read paths refuse to resolve an instant
   covered by more than one version — checked per date, never by comparing
   row counts — so invalid stored configuration fails the replay closed
   instead of being resolved by picking a winner. The one deliberate
   exception to bounding is the configuration WRITE path, which must see
   every existing window to detect overlaps before they are stored.
10. **Backdating is gated by TWO independent confirmations (OD-VAL-10/11).**
    `backdateConfirmed` **and** an explicit `repricing` choice with no default:
    422 `inventory.backdated_document`, then 422
    `inventory.repricing_choice_required`, each carrying the measured facts
    (how many later movements, how many of them valued). The gate runs AFTER
    the idempotency replay check, so retrying a committed posting replays
    quietly instead of re-asking.
11. **Post-then-reprice is TWO transactions.** When the operator chooses
    `recalculate` on a backdated posting, the quantity commits first; the
    repricing then runs as its own audited command under operation key
    `` `${operationKey}:reprice` `` with trigger `backdated_document`. A failed
    repricing therefore leaves the warehouse's movement standing and the key
    honestly `stale` — the alternative (one transaction) would discard a
    physical fact because a valuation failed, contradicting OD-VAL-13.
12. **Lock order gains a third tier.** `balance → movement row (reversals
    only) → valuation state`, with transfers taking both balances and then
    both valuation states in ascending warehouse-id order. A recalculation
    takes only the last tier, so it can never deadlock with a posting.
13. **Value is a separate authority from quantity.** Four permissions:
    `Inventory.Valuation.{View, Configure, AssignCost, Recalculate}`. Without
    `View` the same records are returned with the monetary fields blanked
    (`toInventoryMovementDto(movement, includeCost)`) — same shape, never a
    different one. Supplying a cost on a posting additionally requires
    `AssignCost` on top of `Movement.Create`. The backdate PREVIEW is gated by
    `Movement.Create`, not by a valuation code: the person about to post must
    see the consequence even if they may not see money, so it returns counts
    and dates only.
14. **Assigning a cost is only ever an ADDITION.** A movement that already
    carries a value is refused with 409; a wrong cost is corrected by reversal,
    exactly like a wrong quantity. The same explicit repricing choice applies,
    and `skip` writes the cost and marks the key stale.
15. **Entered money is exact-or-reject; derived money rounds once.**
    `domain/money.ts` is the single rounding primitive (half-up at scale 2) and
    is used only where the method divides. The rounding residual stays in the
    state, so (I2) cannot drift.
16. **Idempotency extends unchanged.** Two new operation kinds
    (`valuation_cost_assignment`, `valuation_recalculation`) and a `valuation`
    result variant join the existing envelope. The posting request hash now
    includes `enteredCost` (a different amount is different intent) but
    excludes `repricing` and `backdateConfirmed` (decisions about the same
    posting — a retry replays rather than re-asks).

## Consequences

- A warehouse can run without accounting: receipts and issues post with no
  monetary field, and the resulting "stock without a cost" is visible as a
  number (`uncosted_quantity`, status `pending_cost`) instead of being hidden
  behind a zero.
- Inventory Accounting gets a real worklist: `GET
  /inventory/valuation/states?status=pending_cost|stale`.
- A backdated document can never silently restate history, and choosing not to
  reprice leaves an auditable, visible `stale` marker rather than a quiet lie.
- Because repricing after a backdated posting is a second transaction, a key
  can be left `stale` by an infrastructure failure. That is the intended
  trade-off and it is observable (`status`, `staleSince`, and no run row).
- **Gap accepted:** no COGS/journal posting into Accounting, no landed cost, no
  purchase-price linkage, no FIFO/LIFO/Specific Identification, no return
  costing (OD-VAL-19), no lot/serial-level valuation.
- **Gap accepted:** a transfer moves value at the source's average, so two
  warehouses can legitimately hold different averages for the same item
  afterwards. Recorded as OQ-67 rather than resolved by implementation.
- **Gap accepted:** a reversal undoes the original's own value, not the current
  average. Recorded as OQ-68.
- `prisma validate` / `prisma generate` could not run in the authoring sandbox
  (the Prisma engine download is blocked there); schema validity, migration
  deployment and the live-Postgres suites are verified by CI only.

## Links

- Product decisions: [PDR-05](../decisions/product/PDR-05-inventory-valuation-and-cost-optional-operations.md) (OD-VAL-01…OD-VAL-19)
- Builds on: ADR-0017, ADR-0022 (ledger), ADR-0021 (organization scope), ADR-0025 (deployment pin), ADR-0006 (permissions)
- Domain decisions: D-04, D-05, D-06, D-07, D-21, D-26 (`docs/architecture/domain/domain-decisions.md`)
- Open questions: OQ-24 (partially answered), OQ-03/OQ-11 (money precision), OQ-54 (document lifecycle), new OQ-67/OQ-68/OQ-69
- Design: `docs/architecture/domain/inventory-domain-analysis.md` §5
- Implementation: `backend/src/modules/inventory/{domain,data,application,api}/*valuation*`, migration `20261006000000_inventory_valuation_foundation`
- Tests: `backend/src/modules/inventory/domain/moving-weighted-average.spec.ts`, `domain/valuation-method.spec.ts`, `domain/inventory-valuation.spec.ts`, `application/inventory-cost-support.spec.ts`, `backend/test/inventory-valuation.e2e-spec.ts`
