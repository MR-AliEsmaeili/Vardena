# C-59 Correction Sprint — Audit, Fixes, Dedicated Tests & Live Concurrency Evidence

- **Date:** 2026-10-07 (round 1: audit + fixes + tests; round 2: the
  migration/schema correction and the live-PostgreSQL execution it unblocked)
  · **Branch:** `arena/99c8b15c-vardena` · **PR:** #126
- **Work order:** the owner's correction-sprint prompt (five axes: reverse-fold
  correctness, failed-key retry semantics, dedicated feature tests, live-DB
  concurrency tests, e2e regression + docs + CI), then the owner's final
  correction order (fix the `created_by` migration/schema mismatch first,
  verify the database from a clean state, rerun the live suite, fix every
  remaining genuine failure until CI is green).
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

## 1a. Round 2 — the migration correction and what live PostgreSQL then exposed

CI on round 1's head (`0a23956`) was red: every Reverse Pricing call returned
`500`. The owner's order named the first root cause; reproducing the whole
live suite locally (embedded PostgreSQL 18.4, all 28 migrations applied from
zero, real generated Prisma client) then exposed two more genuine defects the
first red run had masked. All were cascade failures of the reverse path —
not eleven independent bugs.

### 1a.1 Migration/schema defect — the missing audit columns (FIXED)

`20261008000000_inventory_returns_and_pricing_runs` created
`inventory.inventory_pricing_runs` and
`inventory.inventory_pricing_run_key_outcomes` **without** the `created_by` /
`updated_by` audit columns — the two new tables were the only audit-bearing
inventory tables without them (`inventory_valuation_runs`,
`inventory_valuation_states`, `inventory_movements`,
`inventory_business_documents` all carry nullable `created_by TEXT` /
`updated_by TEXT`, no FK). The Prisma models lacked the fields too, while the
repository's row types (`PricingRunRow`/`PricingRunKeyOutcomeRow`, both
`& AuditColumns`) and `lockRunRow`'s raw `SELECT` list expected them. The
reverse path died on its first statement: `lockRunRow` selects `created_by`
→ `column "created_by" does not exist` → 500 on every reverse. The pricing
path never touches those columns, which is why pricing tests passed.

Why nothing caught it: the hand-written delegate interfaces (the fake/stub
client's contract) can't see the real client's columns, `prisma validate`
checks the schema against itself (not against the migrations), and the
hermetic fakes have no schema at all. Only a real database can see this
class — the live suite is the guard.

**Fix (in place — the migration is branch-local and unmerged; in-place
correction follows the repository's own precedent, commit `5cd4763` fixed
this same migration in place during the slice; CI databases are ephemeral
per run, so no environment holds the old checksum):**

- migration: `"created_by" text, "updated_by" text` added to both tables;
- models: `createdBy String? @map("created_by")` / `updatedBy String?
@map("updated_by")` on `InventoryPricingRun` and
  `InventoryPricingRunKeyOutcome`, exactly the sibling style;
- the audit contract completed the way every sibling write path already
  works: `PricingRunCreate`/`PricingRunKeyOutcomeCreate` carry
  `createdBy` (the actor, wired from both command paths) and
  `markRunReversed` stamps `updatedBy`.

Fresh-database verification: all 28 migrations applied from zero on a clean
PostgreSQL; `information_schema` confirms `created_by`/`updated_by` exist,
nullable `text`, on both tables; `prisma validate` and `prisma generate`
pass; runtime access proven by the passing reverses (`lockRunRow` selects
the columns). An "already-migrated" upgrade path does not exist to test:
the migration has never been merged and every database that ever ran it was
destroyed with its CI job.

### 1a.2 FK-order defect — the compensating run row was created too late (FIXED)

`reverseRunWithin` un-valued the movements (stamping
`valuation_run_id = compensatingRunId`) BEFORE inserting the compensating
`inventory_valuation_runs` row — violating
`fk_inventory_movements_valuation_run` inside the same transaction. Every
reverse against a real database failed on the first movement update; the
hermetic fakes enforce no foreign keys, and before the live suite existed no
real database ever ran a reverse. **Fix:** statement order inside the same
transaction — snapshot → pure fold → create the compensating run row → stamp
the movements (FK satisfied) → write the state. No new transaction boundary,
no change to the fold (it still reads the pre-update snapshot through
`toCompensationFacts`).

### 1a.3 Concurrency hole — an empty run stranded a stale key behind the boundary (FIXED)

Under pricing↔reverse concurrency there is an interleaving where the pricing
run reads its automatic from-date BEFORE the reverse commits: its window
then legitimately contains no movement and it completes EMPTY — while the
reverse leaves the key STALE and demanding repricing (OD-RVP-06). The empty
run used to count as "completed" and advanced the boundary past the stale
key's movements, making the required repricing unreachable — a state that
demands work the system can no longer perform. **Fix:** the completed-run
definition gains its last clause — a run advances the scope's from-date only
when it priced every key it examined (`keysFailed = 0`), **examined at least
one key** (`keysExamined > 0`), and has not been reversed. Over-cover-safe
by the same argument as the bounded history window; pinned by a dedicated
hermetic test (the empty run does not advance) and by the live
pricing↔reverse test, which now models both legitimate interleavings and
PROVES the stale key is recovered by the next run.

### 1a.4 API-surface gap — returns were unreachable over HTTP (FIXED)

`InventoryDocumentLineInputDto` carried only `itemId`/`quantity`/`unitId` —
no `basisMovementId`. The service layer fully supports basis-linked lines
(the entire C-59D returns contract, including the round-1 finalize fix), but
no HTTP caller could send one: a purchase return without a basis is refused
by the domain (`inventory.return.basis_missing`), so the purchase-return
kind was entirely unusable through the API. The live pipeline test found it
as a `400`. **Fix:** the optional, ULID-validated `basisMovementId` field on
the line DTO (shared by create and update), described as returns-only; the
service's existing validation (`basisNotAcceptedForDocumentKind` etc.)
enforces the rest.

### 1a.5 Test corrections (each with its reason — tests were wrong, not the domain)

- **reverse_not_latest_run:** the "newer run" was an empty no-op — the
  automatic from-date starts after the previous run's `toDate`, so now-dated
  movements are out of every subsequent window and the second run examined
  nothing. Rebuilt through the front door: a future-`businessDate` issue
  inside the second run's window, which prices the key and creates the
  newer per-key valuation the guard exists for.
- **pricing↔reverse:** "either order ends at the priced position" was too
  strong — the empty-run interleaving legitimately ends STALE at the pre-run
  fold. The test now accepts exactly the two consistent outcomes and, for
  the stale one, proves recovery (the next run's from-date is null and it
  re-prices).
- **accounting eligibility:** the "stale document" case was constructed via
  a key-level `assignCost(..., 'skip')` — but the established eligibility
  contract is document-level (operational AND fully-priced movements AND
  NOT header `valuationStale`); a key-level inconsistency is not a document
  gate. Rebuilt via the established path: an edit whose repricing is
  explicitly skipped flags the document and the boundary refuses it. The
  edit-after-post code is `inventory.document.accounting_posted_is_immutable`
  (the specific domain code), not the generic `illegal_transition`.
- **pipeline:** unchanged — its 400 WAS the DTO gap above.

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
  prettier clean on all touched files · `prisma validate` + `prisma generate`
  pass (real client, client engine).
- Unit suite: **138 files / 1743 tests PASS** (was 136/1702; +41 dedicated
  tests: 9 domain, 19 pricing service, 13 returns).
- **Live PostgreSQL (local, embedded 18.4, round 2):** all 28 migrations
  applied from a clean database (audit columns verified in
  `information_schema`), system-admin bootstrap, then the FULL e2e config
  against the real database: **48 files / 562 tests PASS** — the new 16-test
  pricing live suite (three consecutive green runs), the existing
  business-documents live suite, kardex, licensing and RBAC live suites.
- CI: same suite set, authoritative (backend job runs `migrate deploy`,
  the migration rehearsal and the live e2e suites on a fresh service
  container). **GREEN on the final correction head `325c099`** —
  [run 37582663933](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/37582663933):
  backend 4m24s (Prisma validate, generate, lint, typecheck, format check,
  unit tests, build, `migrate deploy` of the corrected migration on a fresh
  Postgres, bootstrap, migration rehearsal, and the full live-DB e2e suites
  — including this sprint's 16-test pricing live suite), frontend 1m46s.
  (Round 1's head `0a23956` was red — the migration defect of §1a.1; its
  eleven failing live tests were that defect's cascade, not eleven bugs.)

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

---

## Verdict

**READY FOR REVIEW** — migration/schema consistent and verified from a clean
database, all local gates green (statics, 1743 unit tests, 562 e2e tests
against real PostgreSQL including all four concurrency scenarios), CI green
on the final head, documentation reconciled, no known defect remaining.
