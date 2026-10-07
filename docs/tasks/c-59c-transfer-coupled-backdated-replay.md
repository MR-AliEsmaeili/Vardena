# C-59C — Transfer operational flow: coupled backdated valuation replay

Status: Implemented — locally verified; CI verification pending
Date: 2026-10-07
Baseline: `main` @ `047f5ea94e284e4db23816eee0976190279ff50e` (merge of PR #126)
Branch: `arena/6e2e35f1-vardena`
Decision ids: PDR-08 §2 (OD-TRF-01…09), PDR-05 OD-VAL-10/11/12/14

## 1. Problem

A backdated transfer currently fails closed with
`inventory.backdated_transfer_valuation_unresolved`
(`InventoryTransfersService.assertTransferNotBackdated`, also used by the
C-58 Transfer document finalize). The transfer itself is already safe: both
legs are written in one transaction, so a half-applied transfer is impossible.
What is missing is the **coupled two-key valuation replay** OD-TRF-09 assigns
to this slice: the convention is decided (OD-TRF-01 source-side valuation,
OD-TRF-02 exact value-neutrality, OD-TRF-05 the pair is one atomic valuation
unit), but a legitimate backdated transfer cannot be valued, because valuing it
requires replaying the SOURCE key and the DESTINATION key together and deriving
the destination leg's value from the source-side result.

The current single-key replay cannot do that. It refuses
(`UnvaluedTransferReplayError`) to VALUE a `transfer_out` leg that would
consume valued stock, because doing so on one key alone would strand the moved
value on the other side of the pair.

## 2. Business contract (unchanged, now implemented for the backdated case)

- the transfer is valued **source-side**; the destination leg receives exactly
  the source-derived transfer value (OD-TRF-01);
- the pair is **exactly value-neutral** at organization level — the uncosted
  part of the quantity stays uncosted on the other side (OD-TRF-02);
- per-warehouse averages legitimately diverge afterwards (OD-TRF-03);
- a transfer **never accepts a manual cost** (OD-TRF-06);
- if the source cannot be valued, **both** legs stay `unvalued` and the pair is
  not accounting-eligible, while the quantity effect is still posted and final
  (OD-TRF-07);
- the pair is **one atomic valuation unit**; partial valuation is not a
  representable state (OD-TRF-05).

## 3. Decisions used, and the one derived gate

Decided elsewhere, applied here:

- **OD-VAL-10/11 (backdating gate).** A document dated before the key's latest
  movement requires the operator's explicit acknowledgement; the transfer
  endpoint had none because it refused outright. The transfer now asks the
  **same first question** (`backdateConfirmed`), refused with the same stable
  code `inventory.backdated_document` and the measured assessment of BOTH keys.
- **C-57 hardening precedent.** Restating existing values is a valuation
  authority: a confirmed backdated transfer therefore additionally requires
  `Inventory.Valuation.Recalculate` before any write. This is the same rule the
  movements path applies to `repricing: "recalculate"` and the document path
  applies to a backdated document.
- **OD-VAL-12 (bounded replay).** The coupled replay is bounded exactly like a
  recalculation: one key at a time, `RECALCULATION_MOVEMENT_LIMIT` movements,
  no unbounded read, no scope parameter.

**No second backdating question is offered for a transfer.** OD-VAL-11's second
question ("recalculate now, or leave the values stale?") exists because a
backdated movement can be *posted anyway* with its old numbers left in place.
For a transfer there is no equivalent choice: the pair's own value must come
from the source position **at the transfer date** (OD-TRF-01), and leaving the
source key stale while writing the legs would contradict OD-TRF-05 (the pair is
one valuation unit). The coupled replay is therefore mandatory for a supported
backdated transfer, not an optional repricing. This is an interpretation of
existing decisions, not a new business rule; if the owner wants a "skip" route
for transfers, it belongs in a separate decision.

## 4. Implementation

### 4.1 New pure driver — `domain/transfer-replay.ts`

`replayCoupledTransfer({ entries, transfer })` folds **both keys' histories in
one pass** in the canonical ledger order (`movementDate, createdAt, id` — the
same total order the Kardex and the single-key replay use), applying:

- each stored fact to its own key with the **same strategy dispatch the
  single-key replay uses** (`valuationStrategyFor` over the fact's own
  method), and
- the transfer pair, at its own position, with the pair arithmetic that already
  owns this contract: `applyTransfer` (source consumes, destination receives
  exactly the removed value and the same uncosted split, both legs FINAL).

No arithmetic is duplicated: the pair's value, the uncosted split and the
value-neutrality come from `moving-weighted-average.ts`, the module that
already implements them for the posting path. Consequence: for a transfer that
is NOT backdated the coupled replay produces exactly what the incremental
posting path writes (asserted in `transfer-replay.spec.ts`).

Stored transfer legs from **other** pairs keep the single-key replay's existing
treatment (valued legs are preserved as facts; an unvalued `transfer_out` leg
that would consume valued stock still fails closed — the shared guard,
`assertUnpairedTransferLegIsReplayable`, is used by both drivers).

### 4.2 Orchestration — `data/inventory-transfer-replay.ts`

Runs inside the transfer posting's transaction, after both keys' balance rows
and both keys' valuation-state rows are locked:

1. decide backdating from the LOCKED state (both keys' latest movement date);
2. read the source key's movements (bounded), resolve each movement's method at
   its own business date (`readMethodVersions`, the C-57 bounded read);
3. build the merged step list with the new out leg at its canonical position,
   call `replayCoupledTransfer`, **persist the source key** (changed movement
   rows, one `inventory_valuation_runs` row with trigger `backdated_document`,
   the state row) and return the out leg's columns;
4. replay + persist the destination key the same way, with the in leg carrying
   the source-derived value and uncosted split;
5. hand both legs' columns back to `postTransfer`, which inserts the two
   movement rows and adjusts both balances in the same transaction.

Failure at step 4 rolls back step 3's writes with the whole transaction — no
source-only and no destination-only outcome exists.

### 4.3 Locking

Unchanged discipline, reused: `lockBalanceRow` (ascending warehouse) →
`lockValuationStateRowsInOrder` (ascending `(warehouse, item)`) → movement
rows. The coupled replay introduces no second lock-ordering convention and
takes no lock the incremental path did not already take.

### 4.4 Replay horizon and bounds

A backdated transfer's value depends on the source position **at its date**,
and every later movement's value depends on where the pair is inserted, so the
coupled horizon is each key's whole history — the same horizon (and the same
`RECALCULATION_MOVEMENT_LIMIT` bound, refusing with
`inventory.recalculation_too_large`) a recalculation uses. Configuration is
read per distinct replayed date (`readMethodVersions`), so the read stays
bounded by movements, not by configuration density (C-57 hardening).

### 4.5 Stale / valuation state

Preserved, not collapsed: the replay clears `staleSince` only through the same
`writeValuationState` seam a recalculation uses (a replay re-establishes
consistency; a key whose facts are still provisional stays stale), lifecycle
status is untouched, no accounting document is created, reversed or mutated,
and no movement quantity is written.

### 4.6 API surface

`POST /v1/inventory/transfers` keeps its request/response shape and gains ONE
optional field: `backdateConfirmed` (same name and meaning as the movement
endpoint). The document path already carries `backdateConfirmed` on finalize.
No internal valuation field is exposed; all amounts remain backend-owned exact
decimal strings.

## 5. Fail-closed residuals (still named refusals, never a generic 500)

- a stored unvalued `transfer_out` leg of ANOTHER transfer that the coupled
  replay would have to VALUE (it would consume valued stock after the new pair
  is inserted): `inventory.transfer_replay_unpaired_leg`, naming the blocking
  movement and its transfer, and saying that pricing both keys of that transfer
  is the remedy. The counterpart warehouse is NOT guessed: it lives on a key
  that is not part of this replay (`counterpartWarehouseId: null`), and the
  transfer's own legs expose it through `GET /inventory/movements?transferId=`;
- a key with more movements than the bounded replay allows:
  `inventory.recalculation_too_large`;
- a period whose configured method is not implemented:
  `inventory.valuation_method_not_implemented`;
- a backdated transfer that is not confirmed, or was confirmed but the key
  became backdated between the assessment and the locked write:
  `inventory.backdated_document` (with both keys' assessments) — a retry with
  the confirmation resolves it;
- ambiguous stored method configuration at a replayed date stays a server fault
  (`AmbiguousValuationMethodError`), exactly as in the recalculation path.

## 6. Explicit non-goals

No FIFO/LIFO/specific identification/lot-serial valuation, no manufacturing, no
landed cost, no multi-currency, no GL posting/COGS/tax, no purchasing, no
treasury, no generic document architecture, no universal EAV, no new service,
no second ledger, no second valuation authority. `backdateConfirmed` vs
`acknowledgeSideEffects` (C-58 finding #3) is **not** redesigned here; OQ-69
stays open.

## 7. Migration

**None.** No schema change: the replay writes the existing columns, uses the
existing `backdated_document` run trigger (a code-defined vocabulary stored as
text) and the existing movement/state/run tables.

## 8. Tests

- `domain/transfer-replay.spec.ts` (new, pure): ordinary pair value
  (100 @ 10 → 40 = 400/400); destination with an independent different average
  still receives the source-derived value; backdated insertion with later
  movements on both keys (both histories recomputed, values stay coupled);
  uncosted split stays uncosted on the destination (OD-TRF-02); unvalued source
  → both legs `unvalued` (OD-TRF-07); the other-pair guard fails closed; parity
  with the incremental `applyTransfer` posting when nothing is backdated;
  canonical-order independence (already-ordered input is not re-sorted by
  anything else).
- `backend/test/inventory-valuation.e2e-spec.ts` (in-memory HTTP journey): the
  old refusal assertion is replaced by the confirmation refusal
  (`inventory.backdated_document` naming both keys), the permission refusal for
  a confirmed backdated transfer, and a successful confirmed backdated transfer
  whose two keys are recomputed and stay coupled.
- `backend/test/inventory-business-documents-live.e2e-spec.ts` (live
  PostgreSQL, real repository path): a confirmed backdated transfer document
  finalize whose two keys are recomputed and stay coupled — the transfer is
  valued from the source position ON ITS DATE, the destination's later movement
  is restated, both states are consistent, and an unconfirmed finalize is
  refused with `inventory.backdated_document` naming both keys while writing
  nothing.

## 9. Verification evidence

Local (this working tree, before the commit; the commit SHA/PR/CI are added by
the implementation report once CI has run):

| Command (from `backend/` unless noted) | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean after every edit |
| `npm run lint` | 0 errors, 1 pre-existing warning (`accounting/application/coding-structure-accounts.spec.ts:896`, present on `main`) |
| `npm run format:check` | clean |
| `npm test` | **139 files / 1756 tests PASS** (was 1754 on the baseline: +2 net from the three new C-59C service tests replacing the one retired gate test) |
| `npm run test:e2e` | **26 files / 372 tests PASS, 22 files / 194 skipped** (the skipped ones are the live-PostgreSQL suites; no PostgreSQL binary exists in this sandbox) |
| `npx vitest run src/modules/inventory/domain/transfer-replay.spec.ts` | 11/11 |
| `npx vitest run src/modules/inventory/application/inventory-business-documents.service.spec.ts` | 57/57 |
| `npx vitest run --config ./vitest.config.e2e.ts test/inventory-valuation.e2e-spec.ts` | 44/44 |
| frontend `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, `npm test` | clean, clean, clean, **48 files / 342 tests PASS** |
| `git diff --check` | clean |

The live-PostgreSQL suites were then executed **in this sandbox** against a
real database: an embedded PostgreSQL 18.4 instance (`@embedded-postgres`),
all 28 migrations applied, a locally generated Prisma client and the
system-administrator bootstrap, running the FULL e2e config:

| Command | Result |
|---|---|
| `VARDENA_TEST_DATABASE_URL=… npm run test:e2e` | **48 files / 566 tests PASS** — every live suite, including the new coupled-replay live test (18/18 in `inventory-business-documents-live.e2e-spec.ts`) |

### 9.1 The first CI head failed — and why (real defect, fixed)

CI run [37595239576](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/37595239576)
(head `1b5af2b`) went red on the new live test only: the confirmed backdated
finalize returned **500** instead of 200.

Root cause: `persistSide` patched the restated movement rows
(`valuation_run_id = <new run>`) BEFORE inserting the
`inventory_valuation_runs` row. `inventory_movements.valuation_run_id` is a real
foreign key (`fk_inventory_movements_valuation_run`), so on PostgreSQL every
confirmed backdated transfer violated it — while the in-memory fake, which has
no constraints, could not see it. `applyReplay` (the recalculation path) has
always written the run row first; this slice's orchestration did not.

Fix: `persistSide` now writes the run row FIRST, then the movement patches, then
the state (the `applyReplay` order), and the in-memory mirror additionally
enforces the FK order (`requireRunRow`) so the same class of mistake cannot
pass the hermetic suites again. Re-verified: the live suite and the full live
e2e config are green locally, and CI was re-run on the fixed head.

This is the same failure class the C-59 correction sprint's Reverse Pricing
work hit (stamping movements with a run id before the run existed) — recorded
here because it is the second occurrence.

## 10. Deferred / observed

- `backdateConfirmed` vs `acknowledgeSideEffects`: unchanged, still deferred.
- OQ-69 (per-movement valuation history sufficiency): stays open; this slice
  adds no history table and does not make the transfer replay indistinguishable
  from a Pricing Operation (different trigger, different command).
- Observed (pre-existing, NOT introduced here, flagged for a separate fix):
  `domain/valuation-replay.ts`'s single-key `replay()` does not propagate a
  stored fact's `forceUnvalued` flag (a basis-linked unvalued purchase return
  is therefore valued from the average on recalculation, contradicting
  OD-RET-02/04). The shared fact→strategy dispatch extracted by this slice keeps
  both drivers identical by construction, so the defect stays in ONE place and
  the coupled path cannot silently diverge from the single-key path. Fixing it
  changes C-59D recalculation behaviour and is out of this slice's scope.
- Frontend: the transfer form has no backdate confirmation dialog yet; the
  backend refusal is additive and the existing error mapping still renders a
  safe message. Wiring the two-step dialog for transfers is a UI follow-up.
