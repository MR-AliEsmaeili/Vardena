# Post-C-59 — `forceUnvalued` propagation in the valuation replay

Status: **IMPLEMENTED, locally verified, CI green** (PR
[#128](https://github.com/MR-AliEsmaeili/Vardena/pull/128), branch
`arena/f4b20873-vardena`; both jobs green on `caa0b31`, run
[37651803989](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/37651803989)
— merged by the Product Owner)
Date: 2026-10-07
Baseline: `main` @ `0b36a07777ee1808959eb9032eb981047d4febe6` (merge of PR #127)
Decision ids: PDR-08 OD-RET-02/03/04, PDR-05 OD-VAL-11/12/14
Origin: the defect recorded as a deferred follow-up in
[`c-59c-transfer-coupled-backdated-replay.md`](./c-59c-transfer-coupled-backdated-replay.md)
§10 ("Observed (pre-existing, NOT introduced here …)").

## 1. Problem

A recalculation re-derived a **basis-linked unvalued purchase return** from the
current Moving Weighted Average, inventing exactly the value the posting path
refused to invent:

- `POST /inventory/valuation/recalculations` (one-key `Recalculate`),
- the document backdating path (`repricing: "recalculate"` →
  `InventoryValuationService.recalculateWithin`),
- the Periodic Pricing Operation's per-key replay
  (`recalculateKeyWithinBatch`),
- the coupled two-key backdated transfer replay, for every stored row of
  either key,

all value a key by replaying its stored movement rows. A purchase return whose
receipt basis carried no cost was posted `unvalued` with valuation source
`return_basis` (OD-RET-02/04: you cannot return goods "at the price they were
purchased" when that price was never assigned, and no value may be derived
from the average). The replay **rebuilt that fact correctly and then dropped
its intent one step later**, so the recalculation wrote `-average × quantity`
onto the row and changed its valuation source to `average_cost`. The stored
intent was not merely mis-rendered: once the row said `average_cost`, the fact
could never be rebuilt again — the second recalculation had no way to know the
exit was ever forced.

The defect contradicted the documented contract in
[`c-59-returns-pricing-execution-report.md`](./c-59-returns-pricing-execution-report.md)
§4.1 ("`return_basis` — a Derived Price under OD-PRC-03, **preserved verbatim
by every replay**") and §5 ("`valuation-replay.ts` rebuilds `forceUnvalued`
from a stored `return_basis` row").

## 2. Root cause

`backend/src/modules/inventory/domain/valuation-replay.ts` converts a stored
fact (`ReplayFact`) into the strategy input (`ValuationFact`) in
`toStrategyInput()`. That function cleared `backdated` (correct — the facts are
in order by definition) and copied `movementType`, `baseQuantity`,
`knownValue` and `knownValueSource` — but **not** `forceUnvalued`. The strategy
(`applyMovement`, `moving-weighted-average.ts`) therefore never saw the flag
and took the ordinary outbound branch.

Both replay drivers shared that one function, so the coupled transfer replay
inherited the identical defect — by construction, as the C-59C slice intended,
and it is why the defect lived in exactly one place.

Two adjacent facts made the omission worse rather than harmless:

1. the flag is the only thing distinguishing "no value because the basis had
   none" from "no basis, derive from the average" in the stored row, so once
   the recalculation rewrote the row the intent was unrecoverable;
2. `applyMovement`'s forced exit reports `marksStale` (the exit consumed
   valued stock without attributing value), and both drivers compared the
   row's **status** (`'provisional'`) instead of consulting that answer — so
   even with the flag restored, the key's honest "I am inconsistent" verdict
   would have been discarded and the stale flag cleared by the recalculation.

No other layer loses the flag: the posting path forwards it end to end
(`inventory-business-documents.service.ts` → `MovementValuationPlan` →
`postMovement` → `valueMovement` → `applyMovement`), and `toReplayFact()`
rebuilds it from the stored row.

## 3. Fix

Two changes, both in the shared replay domain (no schema, migration, API or
configuration change):

1. **`toStrategyInput()` propagates the flag verbatim**
   (`...(fact.forceUnvalued === true ? { forceUnvalued: true } : {})`, the
   repository's existing conditional-spread convention). The dispatch is
   explicit and typed; no global state, no hidden context, no second engine.
2. **The drivers keep the key stale from the strategy's own answer**:
   `replay()` (single key) and `replayCoupledTransfer()` (both keys) now fold
   `outcome.marksStale` instead of comparing the valuation status
   (`status === 'provisional'`). In a replay `backdated` is always `false`, so
   this is a strict superset: the only case it adds is the forced exit that
   consumed valued stock — the same verdict the posting path records. Without
   it, a recalculation would have reported an inconsistent key as consistent
   and cleared its `staleSince`.

What deliberately did **not** change: quantity handling (`consume` order,
counters), movement ordering (canonical ledger order), the MWA arithmetic,
ledger authority, organization isolation, the unpaired-transfer-leg guard, and
the behaviour of every fact without the flag.

## 4. Domain behaviour after the fix

For the forced exit, a recalculation now reproduces the posting path exactly:

- the row stays `unvalued`, `total_cost = NULL`, source `return_basis`;
- the quantity effect is unchanged (uncosted stock first, then the valued
  pool — the valuation never gates a quantity posting, OD-VAL-13);
- the key keeps the stale flag the posting path set, and the recalculation's
  per-key run records it (`resultingStatus: stale`);
- the replay writes nothing onto the row: the stored value is what it
  re-derives, so `movementsRevalued` counts zero changes;
- a basis-less purchase return (OD-RET-03) and every ordinary fact keep their
  previous, average-derived behaviour.

## 5. Tests

| Level                                                                  | Test                                                                                                                                                                                                                                                                         | What it pins                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Domain (`domain/valuation-replay.spec.ts`, new `forceUnvalued` suite)  | keeps the exit unvalued; same quantities/order; key stays stale; no stale flag when nothing left the valued pool; the same history WITHOUT the flag (omitted and `false`) is still valued from the average                                                                   | A, B, D-row-level, regression           |
| Domain (`domain/transfer-replay.spec.ts`)                              | the coupled driver gives a stored forced exit the same answer, and keeps that key — and only that key — stale                                                                                                                                                                | the shared dispatch covers both drivers |
| Data chain (`data/inventory-valuation.repository.replay.spec.ts`, NEW) | `buildReplayFacts()` (what `applyReplay` calls) over `MovementRow`s: the flag reaches the strategy, the exit is reproduced, `valuationChanged` reports no write, the position is quantity-identical; a basis-less return row is still re-derived and does not infer the flag | C (caller → replay → valuation)         |
| Live PostgreSQL (`test/inventory-pricing-live.e2e-spec.ts`)            | real HTTP + real repository: unvalued receipt → issue → costed receipt → basis-linked purchase return → `POST /inventory/valuation/recalculations`; the row is still `unvalued`/`return_basis`, `movementsRevalued` is 0, the state stays `stale`, on-hand is unchanged      | D (affected business flow, end to end)  |

Local verification (fast, targeted): the three touched unit specs above,
`typecheck`, `lint`, `format:check`, `git diff --check`. The live-PostgreSQL
suite and the migration rehearsal run only in CI, per the standing local-test
policy. CI re-ran everything on the change commit (`caa0b31`, run
[37651803989](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/37651803989)):
unit tests, e2e including the live suites above, migration rehearsal and the
frontend job — all green.

## 6. Remaining scope (recorded, not fixed here)

- **Reverse Pricing's compensation fold** (`domain/valuation-compensation.ts`,
  `foldPreservedPosition`) does not consult `forceUnvalued`: it folds a
  current-value-less outbound through its own "uncosted first, value parked"
  rule. It emits no movement valuation (the reverse erases values, the next
  Pricing Operation re-derives them), and the key is left stale by design
  (OD-RVP-04/05/06), so this change does not alter it. Whether the fold's
  parked-value intermediate should ever mirror the strategy's removal is an
  OD-RVP question, not a replay-propagation one; **no behaviour changed and
  none is claimed.**
- The `ReplayResult.provisional` / `CoupledTransferReplayResult.provisional`
  **field names** predate this widening (they now mean "the key stays stale",
  driven by `marksStale`). Renaming them would touch both drivers, the run
  writers and the in-memory mirror for cosmetics only; the doc comments state
  the meaning instead.
- OQ-69 (per-movement valuation history sufficiency) stays open and is
  untouched: this fix makes the current fact set replay deterministically, and
  adds no history table.
