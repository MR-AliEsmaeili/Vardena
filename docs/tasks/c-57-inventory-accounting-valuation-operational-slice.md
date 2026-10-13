# C-57 — Inventory Accounting & Valuation Operational Slice

Status: **IMPLEMENTED on branch `arena/01a10d54-vardena` — not Owner-accepted**
Date: 2026-10-05

## 1. Scope

C-57 takes the already-merged valuation foundation (PR #116 / ADR-0039 / PDR-05)
and hardens the operational boundary where warehouse movements create valuation
consequences. It does **not** implement a full Accounting module, COGS posting,
Receipt/Issue business documents, return costing, FIFO/LIFO, landed cost, or the
Inventory UI.

The implementation keeps the single authoritative Inventory movement ledger:
quantity and valuation stay on `inventory.inventory_movements` plus the existing
per-key valuation state. No second inventory ledger, no accounting receipt copy,
and no automatic journal/voucher posting were introduced.

## 2. Canonical decisions referenced

| Decision / question | C-57 treatment |
|---|---|
| PDR-05 / OD-VAL-01…19 | **DECIDED** source for perpetual inventory, Moving Weighted Average, cost-optional receipts, issue cost from the engine, no silent repricing, bounded one-key recalculation, and negative-stock rejection. |
| ADR-0039 | **Proposed architecture** preserved; C-57 adds operational hardening without promoting the ADR. |
| OQ-54 | **DECIDED** edit boundary referenced; no document edit pipeline exists in this slice. |
| OQ-67 | **OPEN**. C-57 does not decide transfer average divergence; it detects backdated transfer valuation impact and fails closed rather than inventing a repricing rule. |
| OQ-68 | **OPEN**. C-57 preserves the existing implemented convention: a reversal uses the original movement's own value. It does not claim Owner acceptance. |
| OQ-69 | **OPEN**. No per-movement valuation-history table was added. |

## 3. Implemented behavior

### 3.1 Repricing authority is explicit

- A backdated normal movement with `repricing = "recalculate"` now requires
  `Inventory.Valuation.Recalculate` **before** the quantity fact is committed.
- Late cost assignment still requires `Inventory.Valuation.AssignCost`.
- If late cost assignment asks for `repricing = "recalculate"`, it now also
  requires `Inventory.Valuation.Recalculate` before any row is changed.
- `repricing = "skip"` remains an explicit, valid choice and persists a stale
  valuation state instead of silently repricing.

### 3.2 Backdated reversals use the same operational valuation gate

- `POST /inventory/movements/{id}/reverse` accepts optional
  `backdateConfirmed` and `repricing` fields.
- A reversal dated before later movements on the same organization + warehouse +
  item is rejected first with `inventory.backdated_document`, then with
  `inventory.repricing_choice_required` if the acknowledgement exists but the
  repricing choice is omitted.
- Choosing `skip` commits the reversal and marks the key `stale`.
- Choosing `recalculate` requires `Inventory.Valuation.Recalculate` before
  commit, then runs the existing bounded one-key recalculation after the
  reversal is posted.
- A reversal cannot be dated before the original movement it reverses
  (`inventory.reversal_date_before_original`).

### 3.3 Moving Weighted Average stale detection for backdated reversals

- The pure Moving Weighted Average strategy now marks a backdated outbound
  reversal stale while preserving the existing implemented reversal convention:
  the reversal still carries the original movement's own value.
- This prevents a backdated reversal from being reported as current when later
  average-derived issues may need explicit recalculation.

### 3.4 Backdated transfers are detected and safely bounded

- Non-backdated transfer valuation remains unchanged: the transfer pair is
  value-neutral and moves the source key's value to the destination key.
- A transfer whose business date is earlier than later movements on either the
  source or destination key is rejected with
  `inventory.backdated_transfer_valuation_unresolved`.
- The error carries source and destination impact summaries (movement date,
  latest movement date, affected movement counts, valued affected counts, stale
  flag).
- This is an intentional fail-closed boundary because OQ-67 is still OPEN and a
  one-key bounded replay cannot safely invent a paired backdated-transfer
  repricing convention.

## 4. API / contract changes

### `POST /api/v1/inventory/movements/{id}/reverse`

Request body additions:

```json
{
  "backdateConfirmed": true,
  "repricing": "recalculate"
}
```

`repricing` values: `"recalculate" | "skip"`.

New / newly used business-rule details:

- `inventory.backdated_document`
- `inventory.repricing_choice_required`
- `inventory.reversal_date_before_original`

### `POST /api/v1/inventory/transfers`

New fail-closed valuation-impact error for blocked backdated transfers:

- `inventory.backdated_transfer_valuation_unresolved`

No transfer cost input was added.

## 5. Tests and local verification

Added / updated coverage:

- `backend/src/modules/inventory/domain/moving-weighted-average.spec.ts`
  - backdated outbound reversal marks the key stale without changing the
    original-value reversal convention.
- `backend/test/inventory-valuation.e2e-spec.ts`
  - backdated reversal requires the same two-step confirmation/repricing gate.
  - backdated transfer is detected and rejected while OQ-67 remains open.
  - late-cost assignment with `repricing = "recalculate"` requires
    `Inventory.Valuation.Recalculate` in addition to AssignCost.

Local verification run:

```text
backend: npm ci --no-audit --no-fund                              PASS
backend: npm run lint                                              PASS with 1 pre-existing accounting warning
backend: npm run format:check                                      PASS
backend: npm run typecheck                                         PASS
backend: npm test                                                  PASS (133 files / 1627 tests)
backend: npm test -- --run src/modules/inventory/domain/moving-weighted-average.spec.ts \
  src/modules/inventory/domain/valuation-replay.spec.ts \
  src/modules/inventory/domain/inventory-valuation.spec.ts \
  src/modules/inventory/application/inventory-cost-support.spec.ts  PASS (58 tests)
backend: npm run test:e2e -- --run test/inventory-valuation.e2e-spec.ts PASS (41 tests)
backend: npm run build                                             PASS
frontend: npm ci --no-audit --no-fund                             PASS
frontend: npm run lint                                             PASS
frontend: npm run format:check                                     PASS
frontend: npm run typecheck                                        PASS
frontend: npm test                                                 PASS (42 files / 305 tests)
frontend: npm run build                                            PASS
```

Pre-existing lint warning (unchanged):

```text
src/modules/accounting/application/coding-structure-accounts.spec.ts:896
eslint(no-unsafe-optional-chaining)
```

## 6. Deferred / open

- **OQ-67 remains OPEN:** C-57 does not implement backdated transfer repricing;
  it blocks that path explicitly and safely.
- **OQ-68 remains OPEN:** the code continues the existing reversal convention
  (undo original value) but does not mark it Owner-resolved.
- **OQ-69 remains OPEN:** no historical valuation-change table was added.
- Inventory → Accounting posting, COGS, tax, GL integration, financial
  statements, fiscal-year accounting, landed cost, FIFO/LIFO/specific
  identification, return costing and UI work remain out of scope.

## 7. Acceptance notes

C-57 preserves these C-54 / PR #116 invariants:

- Existing quantity Kardex order is unchanged: `movementDate → createdAt → id`.
- The Inventory movement ledger remains the single quantity and valuation source
  of truth.
- Receipts do not require a cost; issues do not accept manual cost.
- Missing cost is represented as unvalued / pending or stale state; no zero,
  previous or arbitrary cost is fabricated.
- Repricing is never silent and now also respects the dedicated Recalculate
  permission before side effects are committed.
