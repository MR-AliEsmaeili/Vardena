# C-59A — Receipt operational slice

Status: Implemented
Date: 2026-10-06
Baseline: `main` @ `ce5fe621b989a080026bf0ff2f82a6a022c15e6a`

## Scope and repository truth

C-58 already supplied the executable Receipt path, so C-59A hardens that path
rather than creating a second document or ledger implementation. Receipt uses
`/inventory/business-documents`, `InventoryMovementsRepository`, the existing
balance and Moving Weighted Average valuation writes, Inventory Kardex, the
Documents numbering authority, and the caller-owned transaction introduced by
PR #120.

## Receipt valuation state

The response now exposes the OD-PRC-12 valuation axis separately from lifecycle:

- Receipt without manual cost: `valuationState = unpriced`.
- Receipt with a valid manual cost: `valuationState = priced`.
- A Receipt can be `status = operational` and `valuationState = unpriced`.
- The current Receipt contract is single-line when cost is supplied, therefore
  C-59A cannot produce `partially_priced`; the value remains in the shared enum
  for later document/pricing slices.
- Issue and Transfer return `null` in this field until their own C-59 slices
  compose their movement-level valuation facts. C-59A does not guess those
  rules.

The state is derived from the Receipt's authoritative optional cost source; it
is not persisted as a parallel valuation ledger. The Accounting eligibility
command is deliberately not changed in C-59A. Enforcing `unpriced` as an
Accounting boundary remains C-59F, as recorded by PDR-07 and the C-59 readiness
plan. No GL, journal, COGS, or Pricing Operation is added here.

## Atomic operational effect

Finalize still allocates the number through the existing independent Numbering
boundary. One caller-owned Inventory transaction then commits or rolls back the
Receipt movement, balance projection, movement valuation status/value,
idempotency operation, line-to-movement link, and `draft → operational` state
change. Kardex sees the Receipt through that same authoritative movement row.

## Verification coverage

C-59A adds explicit assertions for:

- priced and unpriced Receipt states, independent from lifecycle;
- an unpriced Receipt becoming Operational with quantity/balance effects and an
  `unvalued` movement;
- a manually priced Receipt becoming Operational with its entered value;
- Kardex visibility through the authoritative ledger;
- four-decimal quantity rejection.

The existing focused and live-PostgreSQL suites continue to cover idempotent
finalize, concurrent finalize, organization isolation, invalid warehouse/item/
unit/conversion, illegal transitions, negative-stock invariants, and full
rollback with no movement, balance, operation key, line link, or state change.

## Deferred

- C-59F: enforce Accounting eligibility from complete document valuation state.
- Pricing Operation and Reverse Pricing.
- Multi-line Receipt cost apportionment (no approved rounding rule; still
  fail-closed).
- Separate `backdateConfirmed` from `acknowledgeSideEffects` on operational
  edits; not a blocker for Draft → Operational and still tracked by the C-58
  post-merge finding.
- Issue, Transfer, Return, reversal extensions, GL/COGS, tax, lot/serial, FIFO,
  and LIFO.
