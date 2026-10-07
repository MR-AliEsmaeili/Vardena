# C-59D/C-59E/C-59E+ — Returns, Periodic Pricing, Reverse Pricing & Concurrency Hardening — execution report

Status: **IMPLEMENTATION COMPLETE, CI GREEN; the dedicated-tests debt named
below was closed on 2026-10-07 by the correction sprint** — code and API for
C-59D/E/E+ and the concurrency hardening are implemented, locally verified
(typecheck/lint/format + the full unit suite) and CI-verified on PR #126
(live-DB e2e + migration rehearsal included). At the time this slice landed
the dedicated new unit/integration specs and live-DB concurrency tests were
NOT written yet (§7 names them); they were added, together with the fixes
their live-PostgreSQL execution exposed, by
[`c-59-correction-sprint-report.md`](./c-59-correction-sprint-report.md).
Date started: 2026-10-06
Baseline: `main` @ `082768d733454258d168871a951449e0b8b2b479` (merge of PR #125)

---

## 1. Baseline audit (what `main` actually contains)

Audited against the code, schema, migrations, tests and decision records —
not against any prior report's claims.

| Concern                                                 | State on `main` @ `082768d`                                                                                                                                                                                  | Evidence                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Receipt valuation (C-59A)                               | **DONE** — cost-optional receipt, manual cost as optional valuation assignment, Draft preview of `priced`                                                                                                    | `inventory-business-documents.service.ts`, `inventory-cost-support.ts`, PR #123 |
| Issue valuation (C-59B)                                 | **DONE (by C-58)** — no manual cost, valued by MWA in the posting path                                                                                                                                       | `postDocumentEffect`, `valueMovement`                                           |
| Transfer valuation (C-59C, non-backdated)               | **DONE (by C-58)** — source value flows to destination, atomic two-leg pair                                                                                                                                  | `postTransfer`, `applyTransfer`                                                 |
| Backdated transfer (C-59C)                              | **FAIL-CLOSED** — refused with `inventory.backdated_transfer_valuation_unresolved`; the coupled two-key replay is a named deferred gap (OD-TRF-08/09)                                                        | `assertTransferNotBackdated`                                                    |
| Movement reversal                                       | **DONE** — mirrors the original movement's own value under lock, one-reversal-per-movement unique index, OD-REV-01…06 confirmed                                                                              | `postReversal`                                                                  |
| Post-Accounting-Post correction                         | **NOT STARTED / BLOCKED** — OQ-27 owns the convention                                                                                                                                                        | OD-REV-07                                                                       |
| Purchase Return                                         | **NOT STARTED** — no document kind, no basis link                                                                                                                                                            | `INVENTORY_DOCUMENT_KINDS`                                                      |
| Sales Return                                            | **NOT STARTED** — no document kind, no basis link                                                                                                                                                            | `INVENTORY_DOCUMENT_KINDS`                                                      |
| Periodic Pricing Operation (OD-PRC-05…07, OD-PDP-01…05) | **NOT STARTED** — only the one-key explicit `recalculate` command exists; no batch scope, no per-key/per-document outcome reporting, no run bookkeeping                                                      | `InventoryValuationService.recalculate`                                         |
| Reverse Pricing (OD-RVP-01…08)                          | **NOT STARTED** — no reverse command, no compensating run, no latest-run/accounting/transfer guards                                                                                                          | —                                                                               |
| Accounting eligibility gate (C-59F, OD-PRC-11/12)       | **DONE** — `accountingEligible` derived from Operational AND Priced AND NOT stale; `accountingPostDocument` refuses ineligible documents; document valuation state derived from authoritative movement facts | PR #124/#125                                                                    |
| Pricing/accounting concurrency                          | **NOT STARTED** — the eligibility check and the lifecycle write are two separate reads/writes; nothing serializes Accounting Post against a concurrent valuation change                                      | `accountingPostDocument` → `applyLifecycleOnly`                                 |
| Organization isolation                                  | **DONE** — 404-never-403 on every read/command (verified by live suites)                                                                                                                                     | live e2e specs                                                                  |
| Quantity precision                                      | **DONE** — `numeric(18,4)` exact-or-reject; money stays `numeric(18,2)` (PDR-07 §6)                                                                                                                          | `quantities.ts`, `money.ts`                                                     |

### Newly discovered defect during this audit (pre-existing on `main`)

**The single-key replay leaks organization-level value when it revalues an
unvalued transfer-out leg.** A transfer whose source key held no valued stock
posts both legs `unvalued` (`applyTransfer` values both or neither). If a cost
is later assigned to the source's receipts, the source key's replay values the
`transfer_out` leg at the (new) average — the value leaves the source pool —
while the destination key's `transfer_in` leg stays `unvalued`/uncosted
forever, because the two keys replay independently. The organization's total
inventory value silently drops by the moved amount. This is fixed in this
slice by failing the replay closed with a named reason (see §4.5); the real
fix is the coupled two-key replay owned by C-59C/OD-TRF-08/09.

---

## 2. Task status (before this slice → after this slice)

Honest statuses against the work order's own list (§4):

| Item                                                     | Before                  | After this PR                                                                                                                                                                                                                                |
| -------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-59A Receipt valuation                                  | DONE (merged)           | DONE                                                                                                                                                                                                                                         |
| C-59B Issue valuation                                    | DONE (merged, via C-58) | DONE                                                                                                                                                                                                                                         |
| C-59C Transfer valuation (non-backdated)                 | DONE (merged, via C-58) | DONE                                                                                                                                                                                                                                         |
| C-59C Backdated transfer coupled replay                  | DEFERRED (fail-closed)  | DEFERRED (unchanged, §4.7)                                                                                                                                                                                                                   |
| C-59D Purchase Return                                    | NOT STARTED             | **DONE** — document kind, basis link, basis-locked pro-rata exit value, unvalued-basis exit without an invented value, aggregate over-return guard, no commercial amount ever                                                                |
| C-59D Sales Return                                       | NOT STARTED             | **DONE** — document kind, current-average entry (never the sales price), basis+amount = Manual Price, cold-start refusal                                                                                                                     |
| C-59D Reversal (movement-level)                          | DONE (merged)           | DONE — plus OD-REV-07: reversal refused once the owning document is accounting-posted                                                                                                                                                        |
| C-59E Periodic Pricing Operation                         | NOT STARTED             | **DONE** — scoped batch (org + warehouse(s) + kinds + automatic from-date), one transaction, per-key outcomes with named failing movements, transfer source-before-destination ordering, manual/derived prices preserved, quantity-invariant |
| C-59E+ Reverse Pricing                                   | NOT STARTED             | **DONE** — run-scoped compensating run, latest-run guard, accounting-posted blockers named, transfer-destination guard, quantities untouched, both runs retained forever                                                                     |
| C-59F Accounting eligibility gate                        | DONE (merged)           | DONE                                                                                                                                                                                                                                         |
| Pricing/accounting concurrency serialization             | NOT STARTED             | **DONE** — Accounting Post is one transaction now: document row lock → key valuation-state locks (fixed order) → re-derive eligibility under the locks → write; the eligibility-check race is closed                                         |
| Backdated transfer replay protection                     | fail-closed             | DONE as fail-closed; coupled replay DEFERRED                                                                                                                                                                                                 |
| Dedicated unit tests for the new pricing/return behavior | —                       | **NOT STARTED** (see §7)                                                                                                                                                                                                                     |
| Live-DB / Postgres concurrency tests                     | —                       | NOT STARTED (CI e2e is the existing suite; no new live tests in this PR)                                                                                                                                                                     |
| Documentation                                            | IN PROGRESS             | IN PROGRESS (this file updated; the valuation/pricing narrative doc pass is still open)                                                                                                                                                      |

## 3. Scope of this slice

1. **C-59D** — `purchase_return` and `sales_return` business document kinds
   with an optional per-line basis link, per OD-RET-01…07.
2. **C-59E** — the scoped, operator-initiated, reportable Periodic Pricing
   Operation, per OD-PRC-05…07 and OD-PDP-01…05.
3. **C-59E+** — run-scoped Reverse Pricing with a compensating run, per
   OD-RVP-01…08.
4. **Hardening** — serialize Accounting Post against Reverse Pricing /
   Pricing; fail the single-key replay closed on unvalued transfer legs.
5. **Documentation** — this report, task statuses, decision references.

Explicitly out of scope (unchanged owners): GL/COGS posting (OQ-24/39/42),
post-Accounting-Post correction documents (OQ-27), the purchase-return
settlement variance account (OQ-70 — no agreed-amount field is accepted at
all), the Accounting-side reversal flow (OQ-71), valuation-history
sufficiency (OQ-69), FIFO/LIFO, lot/serial, multi-currency.

## 4. Domain decisions implemented (all pre-decided; nothing invented)

Every rule below cites the decision record that already decided it.

### 4.1 Purchase Return (OD-RET-01…04)

- A first-class business document kind `purchase_return`; an OUTBOUND
  movement type `purchase_return` leaves the warehouse.
- Optional per-line **basis** link to the originating receipt's movement.
- WITH a valid basis: the return leaves at the ORIGINAL receipt's own
  recorded cost — `basis.total_cost × returnedBaseQty ÷ basis.baseQuantity`,
  one division, single sanctioned rounding — recorded with the new
  valuation source `return_basis` (a Derived Price under OD-PRC-03, preserved
  verbatim by every replay). A full-quantity return mirrors the basis value
  exactly.
- The basis must be an inbound movement of a `receipt` business document in
  the same organization, warehouse and item, and the return's base quantity
  may not exceed the basis movement's base quantity (fail closed).
- WITHOUT a basis: current Moving Weighted Average under the existing
  outbound valuation policy (consumes uncosted stock first; unvalued or
  provisional when the average is not meaningful) — the value may equally
  arrive from a later Pricing Operation, exactly like an issue (OD-RET-03,
  OD-PDP-02).
- No manual price and NO agreed/settlement amount is accepted on a purchase
  return: the difference has no decided variance account (OD-RET-04 + OQ-70),
  so the input is refused rather than half-modelled.

### 4.2 Sales Return (OD-RET-05…07)

- A first-class business document kind `sales_return`; an INBOUND movement
  type `sales_return` re-enters stock.
- Inventory cost, never the sales price: without an explicit amount the
  return is valued at the key's current Moving Weighted Average — the average
  is left unchanged by construction (new strategy rule) — and the value is
  recomputed deterministically at its own date by every replay.
- With a basis on the originating issue AND an explicit amount: the amount is
  a Manual Price under OD-PRC-02 (source `entered`), requires
  `Inventory.Valuation.AssignCost`, and — like a receipt cost — is only
  accepted on a single-line document (no apportionment rule exists).
- **Cold start fails closed** (OD-RET-07): a sales return without an explicit
  amount on a key with no valued pool is refused with a named reason
  (`inventory.return.sales_return_cold_start`). Never valued at zero, never
  an invented average.
- A backdated sales return (or one posted while uncosted stock exists on the
  key) carries a provisional value and marks the key stale — the existing
  honesty rules (OD-VAL-10/11), unchanged.

### 4.3 Reversal (OD-REV-01…08) — no new work needed

Movement-level reversal already mirrors the original's own value under lock.
Return documents participate through the existing cancel/edit reconciliation
(reverse + re-post), which uses exactly that path. OD-REV-07/08 boundaries are
unchanged.

### 4.4 Periodic Pricing Operation (OD-PRC-05…07, OD-PDP-01…05)

- A user-initiated, scope-bounded, reportable BATCH, recorded as a new
  `inventory_pricing_runs` header plus one
  `inventory_pricing_run_key_outcomes` row per key.
- Scope: organization + optional warehouse (null = all) + one or more
  document kinds + to-date. The **from-date is automatic** — immediately
  after the last completed run for the same scope (OD-PDP-01), or the
  beginning of history for the first run. The range is half-open
  `(fromDate, toDate]`.
- Keys in scope: the (warehouse, item) keys of movements in range referenced
  by in-scope business documents of the selected kinds. Each key replays its
  WHOLE ledger (the existing bounded per-key recalculation; MWA cannot resume
  mid-history), recorded with the new run trigger `pricing_operation`.
- Per-key ordering enforces OD-PDP-04: a key that is the SOURCE of an
  in-scope transfer is priced before its paired destination key.
- OD-PDP-03: an inbound movement in range with no resolvable value fails that
  KEY with a named reason naming the offending movements — other keys
  proceed; affected documents stay unpriced and accounting-ineligible.
- Never changes quantity, never posts accounting, never blocks a quantity
  posting (OD-PDP-05): the batch takes only valuation-state locks, in
  ascending key order, and is bounded by explicit limits.
- Idempotent: one `inventory_operations` row (`pricing_run`) keyed by the
  caller's operation key; a retry replays the stored batch result.
- Explicit batch limits (refuse larger scopes): max keys per run and the
  existing per-key movement limit.

### 4.5 Reverse Pricing / Compensating Run (OD-RVP-01…08)

- Run-scoped: reverses ONE pricing run (the batch), by id, in the caller's
  organization.
- Latest-run-only per key (OD-RVP-02): if any newer valuation run exists on
  an affected key, the reversal is refused with a named reason.
- Accounting protection (OD-RVP-03): if any business document owning a
  movement valued by the runs being reversed is `accounting_posted` or
  `immutable`, the reversal is refused, naming the blocking documents. Never
  cascades into Accounting.
- Transfer coupling (OD-RVP-07): if the run valued a transfer SOURCE leg and
  the paired destination key has been valued since, the reversal is refused
  with a named reason.
- Quantity invariance (OD-RVP-04): no quantity column, balance row or
  movement quantity is touched; verified structurally and by tests.
- Compensating run (OD-RVP-05): the original run row is retained and marked
  reversed; a compensating `inventory_pricing_runs` row (kind
  `reverse_pricing`) points at it; per key a compensating valuation run is
  recorded and the movements the original run valued are set back to
  `unvalued` (OD-RVP-06) with `valuation_run_id` repointed at the
  compensating run for the audit trail.
- The key's valuation state is recomputed from the surviving facts by a pure
  preserve-fold and marked STALE — "requiring repricing" — until the next
  Pricing Operation.
- Compensating runs are not themselves reversible (reverse a reverse is a new
  pricing run, not another reverse); refused with a named reason.
- Its own permission (OD-RVP-08): `Inventory.Valuation.ReversePricing`. The
  batch Pricing Operation gets `Inventory.Valuation.RunPricing` — a batch
  over many keys is a different authority from the one-key recalculation.

### 4.6 Concurrency hardening

- `accountingPostDocument` becomes ONE transaction: lock the document row
  `FOR UPDATE`, then lock the valuation-state rows of every key the
  document's movements touch (ascending warehouse/item order — the module's
  fixed lock order), re-derive the valuation state from the movement facts
  UNDER those locks, re-check eligibility, then write the lifecycle change.
  A concurrent Reverse Pricing (which takes the same key locks) therefore
  serializes: either the reverse commits first and the Accounting Post is
  refused as ineligible, or the Accounting Post commits first and the reverse
  is refused by its accounting-document guard. Both orders are safe; the
  forbidden interleaving is impossible.
- The single-key replay fails closed when it would VALUE an unvalued
  `transfer_out` leg (the §1 defect): named error, no partial state.

### 4.7 Backdated transfer replay (§20 of the work order)

The existing protection is re-verified and stays: a backdated transfer is
refused (`inventory.backdated_transfer_valuation_unresolved`) because the
coupled two-key valuation replay is not implemented; both legs commit or
neither does (one transaction), so a half-applied transfer is impossible by
construction. Building the coupled replay is C-59C (OD-TRF-08/09) and remains
DEFERRED — it requires coordinated two-key locking and replay, which does not
fit this slice without rushing a correctness-critical mechanism.

### 4.8 `backdateConfirmed` vs `acknowledgeSideEffects` (§21)

Documented technical debt, deliberately NOT split in this slice: the edit
endpoint currently uses `acknowledgeSideEffects` for both the side-effect
acknowledgement and the backdate confirmation. Splitting them is a breaking
API contract change on a shipped endpoint and would double this PR's surface;
it stays recorded as a named follow-up (C-58 post-merge finding #3, C-59A
deferred list) rather than being rushed.

---

## 5. Implementation record

Implemented in this slice (all names are real files on the branch):

- **Domain** (`backend/src/modules/inventory/domain/`): `return-valuation.ts`
  (NEW — the basis pro-rata share: one division at working scale, one
  sanctioned rounding), `valuation-compensation.ts` (NEW — the pure
  value-preserving fold a compensating run applies), `moving-weighted-average.ts`
  (sales-return current-average rule 9 + the `forceUnvalued` basis exit with
  `return_basis` as the recorded source), `valuation-replay.ts` (rebuilds
  `forceUnvalued` from a stored `return_basis` row; the existing
  unvalued-transfer guard unchanged), `inventory-business-document.ts`
  (`purchase_return`/`sales_return` kinds, line `basisMovementId`, the
  sales-return amount-requires-basis rule, `INVENTORY_DOCUMENT_REFERENCE_TYPE`),
  `movement-type.ts` (the two return types, documents-only), `inventory-valuation.ts`
  (pricing-run/trigger/outcome vocabularies + DTOs), `inventory-operation.ts`
  (`pricing_run` / `reverse_pricing` operations, the `pricing` result shape),
  `inventory-valuation-permissions.ts` (`RunPricing`, `ReversePricing`),
  `inventory-pricing.events.ts` (NEW — post-commit identifier-only events).
- **Data** (`…/data/`): `inventory-pricing.repository.ts` (NEW — batch records
  - `FOR UPDATE` run-row lock; no delete exists), `inventory-valuation.repository.ts`
    (`recalculateKeyWithinBatch`, `reverseRunWithin` — lock, un-value the run's
    movements, fold the survivors, compensating run row, key left stale;
    `listRunsForKeyAfter`), `inventory-movements.repository.ts`
    (`findByValuationRun`, `findByReferences`, `listScopedToDocuments` — bounded),
    `inventory-business-documents.repository.ts` (`listHeadersByIds`,
    `listBasisLinkedLines`, `lockDocumentRow`, `lockValuationStateRows`),
    `inventory-locks.ts` (`lockMovementRow` returns the basis quantity;
    `lockValuationStateRowsInOrder` — the ONE multi-key order),
    `inventory-core-rows.ts` (pricing-run rows/delegates, where-clause
    extensions for the new reads).
- **Application** (`…/application/`): `inventory-pricing.service.ts` (NEW —
  `runPricing` and `reversePricing` with every OD-PDP/OD-RVP guard),
  `inventory-business-documents.service.ts` (return kinds end-to-end: basis
  validation, locked-basis valuation + the over-return guard inside the
  posting transaction, the sales-return cold-start refusal, the hardened
  single-transaction Accounting Post), `inventory-movements.service.ts`
  (OD-REV-07 guard), `inventory-cost-support.ts` (a sales return may carry an
  explicit amount).
- **API**: `api/inventory-pricing.controller.ts` (NEW) +
  `api/dto/inventory-pricing.dto.ts` (NEW) — `POST /v1/inventory/pricing/runs`,
  `POST …/runs/reverse`, `GET …/runs`, `GET …/runs/:id`; module wiring in
  `inventory.module.ts`.
- **Database**: migration `20261008000000_inventory_returns_and_pricing_runs`
  (additive only: `basis_movement_id` + org/basis index, the two
  `inventory_pricing_run*` tables; RESTRICT everywhere except outcome→run
  CASCADE) and the matching Prisma schema models. New vocabularies are
  code-defined text — no ALTER TYPE.

## 6. Local verification (run in this workspace, 2026-10-07)

- `npm ci` — ok.
- `npm run typecheck` (tsc --noEmit, includes specs) — **PASS**.
- `npm run lint` (oxlint) — **PASS** (0 errors; the single remaining warning
  is pre-existing on `main` in an accounting spec, untouched by this branch).
- `npm run format:check` (prettier) — **PASS**.
- `npm test` (vitest unit suite) — **136 files / 1702 tests PASS** (baseline
  136/1700; the two vocabulary specs were updated for the new closed-list
  members, no tests deleted).
- `npx prisma validate` — could NOT run in this sandbox (no network to fetch
  the schema-engine binary). The schema was instead validated locally by
  driving the exact wasm schema engine the Prisma CLI bundles (a ~80-line
  harness over `node_modules/prisma/build/prisma_schema_build_bg.wasm`),
  which is how the PR's first CI failure (the one-to-one reversal
  self-relation missing its unique constraint) was reproduced and fixed
  offline; CI's validate/generate/migrate-deploy confirm it.
- `git diff --check` — clean.

## 7. Final verification — implemented vs planned, honestly

**Implemented and locally verified (unit level):** everything in §5 compiles,
the full existing unit suite passes, and the two touched vocabularies
(movement types, valuation permissions) are asserted as closed lists in their
specs.

**NOT implemented in this PR — named, not hidden:**

1. **Dedicated unit/integration specs for the new behavior** (return
   valuation flows through the documents service, pricing-run scope/order/
   failure isolation, reverse-pricing guards, quantity invariance). The
   existing suite covers the touched code paths only as regression (edit
   classification, lifecycle, fake-world posting). This was the largest gap
   at slice time — **closed on 2026-10-07 by the correction sprint** (see
   [`c-59-correction-sprint-report.md`](./c-59-correction-sprint-report.md)):
   +41 dedicated unit tests and a 16-test live-PostgreSQL suite.
2. **Live-DB / Postgres concurrency tests** for the Accounting Post ↔
   Reverse Pricing serialization and the pricing batch (the real `FOR UPDATE`
   behavior is exercised structurally only; the unit fake records the lock
   contract as a no-op). **Closed on 2026-10-07 by the correction sprint**
   (see [`c-59-correction-sprint-report.md`](./c-59-correction-sprint-report.md)):
   all four concurrency scenarios (pricing↔pricing, pricing↔reverse,
   post↔reverse, reverse↔reverse) run against real PostgreSQL.
3. **The valuation/pricing documentation pass** beyond this report (the
   narrative docs for the accounting-eligibility and pricing surfaces).
4. **Coupled backdated-transfer replay** (C-59C) — DEFERRED, unchanged,
   still fail-closed (§4.7).
5. **`backdateConfirmed` vs `acknowledgeSideEffects` split** — recorded
   debt, unchanged (§4.8).

**CI status: GREEN** on PR head `eaa8c2a`
([run 37537658703](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/37537658703)):
backend 3m44s (validate, generate, lint, typecheck, format, unit, build,
`migrate deploy` of the new migration on a fresh Postgres, migration
rehearsal, live-DB e2e) and frontend 2m23s. Two in-flight fixes were needed:
the prisma-validate unique-constraint error above, and the two
closed-vocabulary e2e assertions (document types 6→8, valuation permissions
4→6) — both are registry-growth updates, not weakened checks.
