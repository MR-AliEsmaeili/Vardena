# C-59 Correction Sprint — Audit, Fixes, Dedicated Tests & Live Concurrency Evidence

- **Date:** 2026-10-07 · **Branch:** `arena/99c8b15c-vardena` · **PR:** #126
- **Work order:** the owner's correction-sprint prompt (five axes: reverse-fold
  correctness, failed-key retry semantics, dedicated feature tests, live-DB
  concurrency tests, e2e regression + docs + CI).
- **Method:** audit the real code first, trust no prior report; fix only what
  the code proves broken; prove every fix with a dedicated test at the level
  that can actually see it (pure domain / hermetic service / live PostgreSQL).
- **Companion documents:**
  [`c-59-returns-pricing-execution-report.md`](./c-59-returns-pricing-execution-report.md)
  (the slice this corrects) ·
  [PDR-08](../decisions/product/PDR-08-transfer-return-reversal-and-reverse-pricing-valuation.md)
  (OD-RET/OD-RVP/OD-PDP decisions).

---

## 1. Audit findings and fixes

### 1.1 Axis 1 — Reverse Pricing folded a stale snapshot (REAL BUG, FIXED)

`reverseRunWithin` read the key's movement rows BEFORE un-valuing them — the
correct order, since the fold needs the pre-update facts — but then folded the
RAW snapshot. The rows the transaction was erasing still carried the original
run's values in that snapshot, so the fold counted the erased values and
produced the **post-run** position (e.g. 50 units @ 500) instead of the
**pre-run** fold (50 units @ 1000, value parked, key stale). A dead condition
(`row.valuationRunId === input.compensatingRunId`) masked it: the snapshot can
never carry the compensating id, which is only written by the update the
snapshot precedes.

**Fix:** a pure, exported bridge `toCompensationFacts(rows, reversedRunId)` in
`domain/valuation-compensation.ts`. The repository now maps the pre-update
snapshot through it with the **original** run id, which converts exactly the
rows the transaction is un-valuing into the `null`-value facts they are about
to become; survivors pass through verbatim and the pure preserve-fold is
unchanged. No semantics were invented — the fold now finally computes what
OD-RVP-04/06 always described.

**Proof:** `valuation-compensation.spec.ts` (the fold and the bridge,
hand-computed positions, including the exact defect signature `600` vs
`1000`); `inventory-pricing.service.spec.ts` "AXIS 1 (service level)";
`inventory-pricing-live.e2e-spec.ts` "AXIS 1" asserts the real rows
(`total_cost IS NULL`, `valuation_status = 'unvalued'`, compensating run id
stamped) and the real state (50 @ 1000, `stale`) on PostgreSQL.

### 1.2 Axis 2 — a failed (or reversed) run advanced the from-date (REAL GAP, FIXED)

`findLastRunForScope` selected the most recent `pricing_operation` run for the
scope regardless of outcome. A run with failed keys advanced the boundary past
the window those keys lived in, so the next run started AFTER the failed
movements — they were **permanently out of scope** unless someone manually
widened history. The same held for a reversed run.

**Fix (Model C — bounded global completion):** the from-date boundary only
advances from a **completed** run, where _completed_ means
`keys_failed = 0 AND reversed_by_run_id IS NULL`. A run with a failed key, or
a reversed run, leaves the boundary where it was, so the next run re-covers
the window; because the per-key replay is the existing whole-key idempotent
replay, re-covering can only re-price, never double-count. The bounded
50-run history window is unchanged; exhausting it falls back to the beginning
of history (over-cover, never skip). This is the operational definition of
the word "completed" already used by OD-PDP-01 — a clarification, not a new
policy.

**Proof:** `inventory-pricing.service.spec.ts` "AXIS 2" (both halves — failed
key and reversed run — plus the full retry loop: fail → fix the blocker →
re-run → priced, quantities unchanged, boundary advances only after a fully
completed run); `inventory-pricing-live.e2e-spec.ts` "AXIS 2" runs the same
loop against the real SQL and asserts the auditable failed-key outcome row
naming the blocked movement.

### 1.3 Axis 3 (audit bonus) — finalize dropped `basisMovementId` (REAL BUG, FIXED)

`finalizeDocument` re-resolved the stored lines to
`{itemId, quantity, unitId}` only: a drafted, basis-linked return posted
**basis-less** — the purchase return exited unvalued instead of mirroring its
receipt, the basis-linked sales return's explicit amount was refused at the
ledger boundary, and the over-return bound never saw the basis. The feature
shipped with zero finalize-path coverage, which is why this survived.

**Fix:** the stored basis id travels with the line at re-resolution, exactly
as `updateDocument` already did.

**Proof:** thirteen dedicated return tests in
`inventory-business-documents.service.spec.ts` (mirror and exact pro-rata,
unvalued basis, over-return single and cumulative, basis type/item/org
mismatch, commercial amount refused, explicit-amount-without-basis refused,
average re-entry, cold start, quantities, cross-org invisibility) plus the
live pipeline regression which posts a purchase return and a sales return
through real HTTP with real basis locks.

### 1.4 Audited and proven already correct (no fix, by instruction)

- **Transfer-leg replay preservation:** `applyTransfer` settles both legs
  with source `'transfer'`; `applyReplay` only stamps changed rows, so a
  valued transfer leg is never re-derived and never carries a pricing run's
  id — a run cannot un-value a transfer leg. Asserted live in the pipeline
  test (legs keep `valuation_source = 'transfer'` after a run). The
  OD-RVP-07 destination guard is therefore defensive against a state no
  current write path can produce; it is unit-tested directly
  (`reverse_transfer_destination_valued`) rather than live-constructed.
- **Idempotency** of both pricing commands (operation-key replay, unique
  race P2002 → replay-the-winner), **guards** (latest-run, accounting-posted,
  reverse-of-reverse, already-reversed 409 via
  `uq_inventory_pricing_runs_reverses_run`), **quantity invariance**
  (repricing and reversal never touch a quantity column), **lock ordering**
  (run header → valuation states ascending; replay order source-before-
  destination — asserted on the recorded lock order).

## 2. Dedicated tests (axis 3) — three levels

| Level            | File                                                                  | Coverage                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure domain      | `src/modules/inventory/domain/valuation-compensation.spec.ts`         | the compensation fold and the snapshot bridge; the axis-1 defect signature pinned (`600` vs `1000`); on-hand ≡ valued + uncosted invariant                                                                                                                                                                                                                                                                           |
| Hermetic service | `src/modules/inventory/application/inventory-pricing.service.spec.ts` | 18 tests: OD-PDP-01…05 (scope, boundary, range refusal, kind/warehouse/org scoping, lock order, per-key failure, scope_too_large, broken reference, idempotency incl. P2002 race, quantity invariance) and OD-RVP-01…08 (the axis-1 fold at service level, latest-run, accounting-posted, reverse-of-reverse, already-reversed, in-transaction reverse race, transfer-destination guard, idempotency, org isolation) |
| Hermetic service | `inventory-business-documents.service.spec.ts` (returns section)      | 13 tests: OD-RET-01…07 purchase/sales return rules incl. the finalize-basis regression                                                                                                                                                                                                                                                                                                                               |
| Live PostgreSQL  | `test/inventory-pricing-live.e2e-spec.ts`                             | 16 tests over real HTTP + real row locks: the two axes' end-to-end proofs, four concurrency scenarios, accounting eligibility/immutability, and the full receipt → issue → returns → transfer → pricing → accounting-post pipeline                                                                                                                                                                                   |

The hermetic pricing suite's fakes are faithful by construction: the fake
`findLastRunForScope` mirrors the completed-run filter, the fake transaction
rolls back from a snapshot, the operation-key uniqueness throws Prisma's
`P2002`, and the fake `reverseRunWithin` performs the repository's exact
un-valuing write and then runs the REAL pure fold — the live suite pins the
same behavior against the real SQL.

## 3. Live concurrency evidence (axis 4)

All four scenarios run in `test/inventory-pricing-live.e2e-spec.ts` against
real PostgreSQL over real HTTP, each on a private warehouse (private key AND
private scope history):

1. **pricing ↔ pricing** — both whole-key replays are idempotent; either
   both complete or the second is refused `range_not_extending`; one
   movement row, one run stamp, one state answer (50 @ 500), stock unchanged.
2. **pricing ↔ reverse** — the reverse either wins (original marked, the
   concurrent run then re-prices) or is refused `reverse_not_latest_run`;
   either way the key ends at the same priced position.
3. **post ↔ reverse** — a concurrent receipt finalize and a reverse compose
   to the identical state in either interleaving (70 @ 1200): the inbound
   fact joins the pool additively and the erased values park, so order
   cannot change the answer.
4. **reverse ↔ reverse** — exactly one 201 and one 409; one compensating
   run; the original marked once; the key at the pre-run fold once.

The lock order is unchanged from the shipped design (entity row → balance →
valuation state, multi-key sets in fixed ascending order, the pricing-run
header first for reversals), so no deadlock is possible; the four scenarios
exercise it rather than change it.

## 4. Accounting eligibility & immutability (axis 5)

Live-asserted: unpriced and stale documents are refused
`inventory.document.accounting_ineligible` at the boundary; a posted document
replays idempotently; an edit after post is refused
`inventory.document.illegal_transition`; and the pricing run that priced a
posted document can no longer be reversed
(`reverse_accounting_posted`). The migration is untouched by this sprint
(schema comment wording only — no structural change), and CI's
`migrate deploy` + rehearsal remain the authoritative schema proof.

## 5. Domain clarification (recorded, not invented)

**The completed-run definition (OD-PDP-01 operationalization):** a pricing
run is _completed_ when every key it examined was priced (`keys_failed = 0`)
and it has not been reversed since. Only a completed run advances its scope's
from-date. A run with failed keys — or a reversed run — leaves the boundary
in place, so the next run re-covers the window and retries the failed key;
whole-key replay is idempotent, so re-covering can only re-price. Failed
movements are therefore retried, never silently skipped, and always auditable
through the per-key outcome rows. No new decision is required: this is what
"the last completed run" in OD-PDP-01 always meant, now stated so it can be
tested.

## 6. Gates

- `tsc --noEmit` clean · oxlint 0 errors (1 pre-existing warning on main) ·
  prettier clean on all touched files.
- Unit suite: **138 files / 1742 tests PASS** (was 136/1702; +40 dedicated
  tests: 9 domain, 18 pricing service, 13 returns).
- Hermetic e2e: 369 passed; live suites (incl. the new 16-test pricing live
  suite) opt-in via `VARDENA_TEST_DATABASE_URL`, skipped locally, run in CI.
- CI: the authoritative live-Postgres execution (backend job runs
  `migrate deploy`, the migration rehearsal and the live e2e suites).

## 7. Remaining risks (named, none blocking review)

- The reverse fold's parked-value degradation (an unvalued outbound leaves
  its share parked in `total_value` until the next run) is documented
  honesty, not a defect; the next pricing run re-derives it.
- OD-RVP-07's transfer-destination hazard is not live-constructible through
  current write paths (transfer legs are replay-preserved); the guard is
  unit-tested directly and stands as defense-in-depth.
- OQ-24/69/70 remain OPEN as recorded (accounting-side counterparts); the
  backdated-transfer replay and the confirm-flag split remain deferred debt
  from §23, unchanged by this sprint.
